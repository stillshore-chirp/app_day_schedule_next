use chrono::{Duration, LocalResult, NaiveDate, NaiveDateTime, NaiveTime, TimeZone, Utc};
use chrono_tz::Tz;
use sqlx::{Row, sqlite::SqliteRow};
use uuid::Uuid;

use crate::domain::{
    AppError, AppResult, DayTemplate, DayTemplateDraft, FreeAlarm, FreeAlarmDraft, Priority,
    QuickBlock, QuickBlockDraft, Schedule, ScheduleDraft, ScheduleStatus, SyncStatus,
    TemplateApplyMode, TemplateBlock, TemplatePreview, TemplatePreviewItem,
};

use super::database::{insert_history, insert_schedule, row_to_schedule, update_schedule_row};
use super::{ChangeResult, Database};

impl Database {
    pub async fn list_templates(&self) -> AppResult<Vec<DayTemplate>> {
        let rows = sqlx::query("SELECT * FROM templates ORDER BY sort_order, name, id")
            .fetch_all(&self.pool)
            .await
            .map_err(|error| AppError::database("template-list", error))?;
        let mut templates = Vec::with_capacity(rows.len());
        for row in rows {
            let id = parse_uuid(row.get::<&str, _>("id"), "template-id")?;
            let block_rows = sqlx::query(
                "SELECT * FROM template_blocks WHERE template_id = ? ORDER BY start_minute, sort_order, id",
            )
            .bind(id.to_string())
            .fetch_all(&self.pool)
            .await
            .map_err(|error| AppError::database("template-block-list", error))?;
            templates.push(template_from_row(
                &row,
                block_rows
                    .iter()
                    .map(block_from_row)
                    .collect::<AppResult<_>>()?,
            )?);
        }
        Ok(templates)
    }

    pub async fn save_template(
        &self,
        id: Option<Uuid>,
        expected_version: Option<u64>,
        mut draft: DayTemplateDraft,
    ) -> AppResult<DayTemplate> {
        draft.validate()?;
        let now = Utc::now().to_rfc3339();
        let mut transaction = self
            .pool
            .begin()
            .await
            .map_err(|error| AppError::database("template-save-begin", error))?;
        let template_id = id.unwrap_or_else(Uuid::new_v4);
        let (is_builtin, sort_order, version) = if id.is_some() {
            let current = sqlx::query(
                "SELECT name, is_builtin, sort_order, version FROM templates WHERE id = ?",
            )
            .bind(template_id.to_string())
            .fetch_optional(&mut *transaction)
            .await
            .map_err(|error| AppError::database("template-read-for-update", error))?
            .ok_or_else(template_not_found)?;
            let current_version = current.get::<i64, _>("version").max(0) as u64;
            if expected_version != Some(current_version) {
                return Err(version_conflict("テンプレート"));
            }
            let builtin = current.get::<bool, _>("is_builtin");
            if builtin && draft.name != current.get::<String, _>("name") {
                return Err(AppError::Validation {
                    message: "既定テンプレートの名前は変更できません。".into(),
                    recovery: "内容だけを編集するか、新しいテンプレートを作成してください。".into(),
                });
            }
            sqlx::query(
                "UPDATE templates SET name = ?, description = ?, color = ?, weekdays_mask = ?, version = version + 1, updated_at_utc = ? WHERE id = ? AND version = ?",
            )
            .bind(&draft.name)
            .bind(&draft.description)
            .bind(&draft.color)
            .bind(i64::from(draft.weekdays_mask))
            .bind(&now)
            .bind(template_id.to_string())
            .bind(current_version as i64)
            .execute(&mut *transaction)
            .await
            .map_err(|error| AppError::database("template-update", error))?;
            (
                builtin,
                current.get::<i64, _>("sort_order") as i32,
                current_version + 1,
            )
        } else {
            let next_order: i64 =
                sqlx::query_scalar("SELECT COALESCE(MAX(sort_order), -1) + 1 FROM templates")
                    .fetch_one(&mut *transaction)
                    .await
                    .map_err(|error| AppError::database("template-sort-order", error))?;
            sqlx::query(
                "INSERT INTO templates(id, name, description, color, weekdays_mask, is_builtin, sort_order, version, created_at_utc, updated_at_utc) VALUES (?, ?, ?, ?, ?, 0, ?, 0, ?, ?)",
            )
            .bind(template_id.to_string())
            .bind(&draft.name)
            .bind(&draft.description)
            .bind(&draft.color)
            .bind(i64::from(draft.weekdays_mask))
            .bind(next_order)
            .bind(&now)
            .bind(&now)
            .execute(&mut *transaction)
            .await
            .map_err(|error| AppError::database("template-insert", error))?;
            (false, next_order as i32, 0)
        };
        sqlx::query("DELETE FROM template_blocks WHERE template_id = ?")
            .bind(template_id.to_string())
            .execute(&mut *transaction)
            .await
            .map_err(|error| AppError::database("template-block-replace", error))?;
        let mut blocks = Vec::with_capacity(draft.blocks.len());
        for (sort_order, block) in draft.blocks.into_iter().enumerate() {
            let id = Uuid::new_v4();
            sqlx::query(
                "INSERT INTO template_blocks(id, template_id, title, start_minute, duration_minutes, color, project, category, sort_order) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)",
            )
            .bind(id.to_string())
            .bind(template_id.to_string())
            .bind(&block.title)
            .bind(i64::from(block.start_minute))
            .bind(i64::from(block.duration_minutes))
            .bind(&block.color)
            .bind(&block.project)
            .bind(&block.category)
            .bind(sort_order as i64)
            .execute(&mut *transaction)
            .await
            .map_err(|error| AppError::database("template-block-insert", error))?;
            blocks.push(TemplateBlock {
                id,
                title: block.title,
                start_minute: block.start_minute,
                duration_minutes: block.duration_minutes,
                color: block.color,
                project: block.project,
                category: block.category,
                sort_order: sort_order as i32,
            });
        }
        transaction
            .commit()
            .await
            .map_err(|error| AppError::database("template-save-commit", error))?;
        Ok(DayTemplate {
            id: template_id,
            name: draft.name,
            description: draft.description,
            color: draft.color,
            weekdays_mask: draft.weekdays_mask,
            is_builtin,
            sort_order,
            version,
            blocks,
        })
    }

    pub async fn delete_template(&self, id: Uuid, expected_version: u64) -> AppResult<()> {
        let result =
            sqlx::query("DELETE FROM templates WHERE id = ? AND version = ? AND is_builtin = 0")
                .bind(id.to_string())
                .bind(expected_version as i64)
                .execute(&self.pool)
                .await
                .map_err(|error| AppError::database("template-delete", error))?;
        if result.rows_affected() == 1 {
            Ok(())
        } else {
            Err(AppError::Conflict {
                message: "テンプレートを削除できませんでした。".into(),
                recovery:
                    "既定テンプレートは削除できません。その他は一覧を更新して再試行してください。"
                        .into(),
            })
        }
    }

    pub async fn reorder_templates(&self, ids: &[Uuid]) -> AppResult<()> {
        self.reorder_library("templates", ids).await
    }

    pub async fn list_quick_blocks(&self) -> AppResult<Vec<QuickBlock>> {
        let rows = sqlx::query("SELECT * FROM quick_blocks ORDER BY sort_order, id")
            .fetch_all(&self.pool)
            .await
            .map_err(|error| AppError::database("quick-block-list", error))?;
        rows.iter().map(quick_block_from_row).collect()
    }

    pub async fn save_quick_block(
        &self,
        id: Option<Uuid>,
        expected_version: Option<u64>,
        mut draft: QuickBlockDraft,
    ) -> AppResult<QuickBlock> {
        draft.validate()?;
        let now = Utc::now().to_rfc3339();
        let id = id.unwrap_or_else(Uuid::new_v4);
        let (version, sort_order) = if let Some(expected) = expected_version {
            let existing_order: Option<i64> = sqlx::query_scalar(
                "SELECT sort_order FROM quick_blocks WHERE id = ? AND version = ?",
            )
            .bind(id.to_string())
            .bind(expected as i64)
            .fetch_optional(&self.pool)
            .await
            .map_err(|error| AppError::database("quick-block-read-for-update", error))?;
            let Some(order) = existing_order else {
                return Err(version_conflict("Quick Block"));
            };
            let result = sqlx::query(
                "UPDATE quick_blocks SET title = ?, start_minute = ?, duration_minutes = ?, time_zone = ?, color = ?, project = ?, category = ?, start_notification_minutes = ?, end_notification_minutes = ?, is_active = ?, version = version + 1, updated_at_utc = ? WHERE id = ? AND version = ?",
            )
            .bind(&draft.title)
            .bind(i64::from(draft.start_minute))
            .bind(i64::from(draft.duration_minutes))
            .bind(&draft.timezone_id)
            .bind(&draft.color)
            .bind(&draft.project)
            .bind(&draft.category)
            .bind(draft.start_notification_minutes.map(i64::from))
            .bind(draft.end_notification_minutes.map(i64::from))
            .bind(draft.is_active)
            .bind(&now)
            .bind(id.to_string())
            .bind(expected as i64)
            .execute(&self.pool)
            .await
            .map_err(|error| AppError::database("quick-block-update", error))?;
            if result.rows_affected() != 1 {
                return Err(version_conflict("Quick Block"));
            }
            (expected + 1, order as i32)
        } else {
            let order: i64 =
                sqlx::query_scalar("SELECT COALESCE(MAX(sort_order), -1) + 1 FROM quick_blocks")
                    .fetch_one(&self.pool)
                    .await
                    .map_err(|error| AppError::database("quick-block-sort-order", error))?;
            sqlx::query(
                "INSERT INTO quick_blocks(id, title, start_minute, duration_minutes, time_zone, color, project, category, start_notification_minutes, end_notification_minutes, is_active, sort_order, version, created_at_utc, updated_at_utc) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, 0, ?, ?)",
            )
            .bind(id.to_string())
            .bind(&draft.title)
            .bind(i64::from(draft.start_minute))
            .bind(i64::from(draft.duration_minutes))
            .bind(&draft.timezone_id)
            .bind(&draft.color)
            .bind(&draft.project)
            .bind(&draft.category)
            .bind(draft.start_notification_minutes.map(i64::from))
            .bind(draft.end_notification_minutes.map(i64::from))
            .bind(draft.is_active)
            .bind(order)
            .bind(&now)
            .bind(&now)
            .execute(&self.pool)
            .await
            .map_err(|error| AppError::database("quick-block-insert", error))?;
            (0, order as i32)
        };
        Ok(QuickBlock {
            id,
            draft,
            sort_order,
            version,
        })
    }

    pub async fn delete_quick_block(&self, id: Uuid, expected_version: u64) -> AppResult<()> {
        delete_versioned(
            &self.pool,
            "quick_blocks",
            id,
            expected_version,
            "Quick Block",
        )
        .await
    }

    pub async fn reorder_quick_blocks(&self, ids: &[Uuid]) -> AppResult<()> {
        self.reorder_library("quick_blocks", ids).await
    }

    pub async fn list_free_alarms(&self) -> AppResult<Vec<FreeAlarm>> {
        let rows = sqlx::query("SELECT * FROM free_alarms ORDER BY sort_order, minute_of_day, id")
            .fetch_all(&self.pool)
            .await
            .map_err(|error| AppError::database("alarm-list", error))?;
        rows.iter().map(free_alarm_from_row).collect()
    }

    pub async fn save_free_alarm(
        &self,
        id: Option<Uuid>,
        expected_version: Option<u64>,
        mut draft: FreeAlarmDraft,
    ) -> AppResult<FreeAlarm> {
        draft.validate()?;
        let now = Utc::now().to_rfc3339();
        let id = id.unwrap_or_else(Uuid::new_v4);
        let (version, sort_order) = if let Some(expected) = expected_version {
            let existing_order: Option<i64> = sqlx::query_scalar(
                "SELECT sort_order FROM free_alarms WHERE id = ? AND version = ?",
            )
            .bind(id.to_string())
            .bind(expected as i64)
            .fetch_optional(&self.pool)
            .await
            .map_err(|error| AppError::database("alarm-read-for-update", error))?;
            let Some(order) = existing_order else {
                return Err(version_conflict("アラーム"));
            };
            sqlx::query(
                "UPDATE free_alarms SET label = ?, minute_of_day = ?, time_zone = ?, weekdays_mask = ?, enabled = ?, version = version + 1, updated_at_utc = ? WHERE id = ? AND version = ?",
            )
            .bind(&draft.label)
            .bind(i64::from(draft.minute_of_day))
            .bind(&draft.timezone_id)
            .bind(i64::from(draft.weekdays_mask))
            .bind(draft.enabled)
            .bind(&now)
            .bind(id.to_string())
            .bind(expected as i64)
            .execute(&self.pool)
            .await
            .map_err(|error| AppError::database("alarm-update", error))?;
            (expected + 1, order as i32)
        } else {
            let order: i64 =
                sqlx::query_scalar("SELECT COALESCE(MAX(sort_order), -1) + 1 FROM free_alarms")
                    .fetch_one(&self.pool)
                    .await
                    .map_err(|error| AppError::database("alarm-sort-order", error))?;
            sqlx::query(
                "INSERT INTO free_alarms(id, label, minute_of_day, time_zone, weekdays_mask, enabled, sort_order, version, created_at_utc, updated_at_utc) VALUES (?, ?, ?, ?, ?, ?, ?, 0, ?, ?)",
            )
            .bind(id.to_string())
            .bind(&draft.label)
            .bind(i64::from(draft.minute_of_day))
            .bind(&draft.timezone_id)
            .bind(i64::from(draft.weekdays_mask))
            .bind(draft.enabled)
            .bind(order)
            .bind(&now)
            .bind(&now)
            .execute(&self.pool)
            .await
            .map_err(|error| AppError::database("alarm-insert", error))?;
            (0, order as i32)
        };
        Ok(FreeAlarm {
            id,
            draft,
            sort_order,
            version,
        })
    }

    pub async fn delete_free_alarm(&self, id: Uuid, expected_version: u64) -> AppResult<()> {
        delete_versioned(&self.pool, "free_alarms", id, expected_version, "アラーム").await
    }

    pub async fn reorder_free_alarms(&self, ids: &[Uuid]) -> AppResult<()> {
        self.reorder_library("free_alarms", ids).await
    }

    async fn reorder_library(&self, table: &'static str, ids: &[Uuid]) -> AppResult<()> {
        if ids.is_empty() || ids.len() > 10_000 {
            return Err(AppError::Validation {
                message: "並べ替え対象が正しくありません。".into(),
                recovery: "一覧を更新してから再試行してください。".into(),
            });
        }
        let count_sql = match table {
            "templates" => "SELECT COUNT(*) FROM templates",
            "quick_blocks" => "SELECT COUNT(*) FROM quick_blocks",
            "free_alarms" => "SELECT COUNT(*) FROM free_alarms",
            _ => {
                return Err(AppError::database(
                    "library-reorder-table",
                    "unsupported table",
                ));
            }
        };
        let update_sql = match table {
            "templates" => {
                "UPDATE templates SET sort_order = ?, version = version + 1, updated_at_utc = ? WHERE id = ?"
            }
            "quick_blocks" => {
                "UPDATE quick_blocks SET sort_order = ?, version = version + 1, updated_at_utc = ? WHERE id = ?"
            }
            "free_alarms" => {
                "UPDATE free_alarms SET sort_order = ?, version = version + 1, updated_at_utc = ? WHERE id = ?"
            }
            _ => unreachable!(),
        };
        let expected: i64 = sqlx::query_scalar(count_sql)
            .fetch_one(&self.pool)
            .await
            .map_err(|error| AppError::database("library-reorder-count", error))?;
        let unique = ids
            .iter()
            .copied()
            .collect::<std::collections::HashSet<_>>();
        if ids.len() as i64 != expected || unique.len() != ids.len() {
            return Err(AppError::Conflict {
                message: "一覧が別の操作で更新されています。".into(),
                recovery: "一覧を更新してから並べ替え直してください。".into(),
            });
        }
        let now = Utc::now().to_rfc3339();
        let mut transaction = self
            .pool
            .begin()
            .await
            .map_err(|error| AppError::database("library-reorder-begin", error))?;
        for (index, id) in ids.iter().enumerate() {
            let result = sqlx::query(update_sql)
                .bind(index as i64)
                .bind(&now)
                .bind(id.to_string())
                .execute(&mut *transaction)
                .await
                .map_err(|error| AppError::database("library-reorder-update", error))?;
            if result.rows_affected() != 1 {
                return Err(version_conflict("一覧"));
            }
        }
        transaction
            .commit()
            .await
            .map_err(|error| AppError::database("library-reorder-commit", error))?;
        Ok(())
    }

    pub async fn preview_template(
        &self,
        template_id: Uuid,
        date: NaiveDate,
        timezone_id: &str,
    ) -> AppResult<TemplatePreview> {
        let template = self
            .list_templates()
            .await?
            .into_iter()
            .find(|item| item.id == template_id)
            .ok_or_else(template_not_found)?;
        let timezone = timezone_id
            .parse::<Tz>()
            .map_err(|_| AppError::Validation {
                message: "タイムゾーンを確認できませんでした。".into(),
                recovery: "設定で有効なIANAタイムゾーンを選び直してください。".into(),
            })?;
        let items = template
            .blocks
            .iter()
            .map(|block| preview_item(block, date, timezone, timezone_id))
            .collect::<AppResult<Vec<_>>>()?;
        let day_start = resolve_local(timezone, NaiveDateTime::new(date, NaiveTime::MIN))?;
        let next_date = date.succ_opt().ok_or_else(|| AppError::Validation {
            message: "対象日の範囲が正しくありません。".into(),
            recovery: "別の日付を選び直してください。".into(),
        })?;
        let day_end = resolve_local(timezone, NaiveDateTime::new(next_date, NaiveTime::MIN))?;
        let total_existing: i64 = sqlx::query_scalar(
            "SELECT COUNT(*) FROM schedule_items WHERE start_at_utc < ? AND end_at_utc > ? AND deleted_at_utc IS NULL",
        )
        .bind(day_end.to_rfc3339())
        .bind(day_start.to_rfc3339())
        .fetch_one(&self.pool)
        .await
        .map_err(|error| AppError::database("template-preview-existing", error))?;
        let local_candidates: i64 = sqlx::query_scalar(
            "SELECT COUNT(*) FROM schedule_items WHERE start_at_utc < ? AND end_at_utc > ? AND deleted_at_utc IS NULL AND sync_status = 'local_only' AND NOT EXISTS (SELECT 1 FROM sync_mappings WHERE sync_mappings.schedule_item_id = schedule_items.id)",
        )
        .bind(day_end.to_rfc3339())
        .bind(day_start.to_rfc3339())
        .fetch_one(&self.pool)
        .await
        .map_err(|error| AppError::database("template-preview-replace", error))?;
        let mut overlapping_item_count = 0;
        for item in &items {
            let overlaps: bool = sqlx::query_scalar(
                "SELECT EXISTS(SELECT 1 FROM schedule_items WHERE start_at_utc < ? AND end_at_utc > ? AND deleted_at_utc IS NULL)",
            )
            .bind(item.end_utc.to_rfc3339())
            .bind(item.start_utc.to_rfc3339())
            .fetch_one(&self.pool)
            .await
            .map_err(|error| AppError::database("template-preview-overlap", error))?;
            if overlaps {
                overlapping_item_count += 1;
            }
        }
        Ok(TemplatePreview {
            items,
            overlapping_item_count,
            local_replace_candidate_count: local_candidates.max(0) as u64,
            external_preserved_count: total_existing.saturating_sub(local_candidates).max(0) as u64,
            sync_target: "この端末（ローカル）".into(),
        })
    }

    pub async fn apply_template(
        &self,
        template_id: Uuid,
        date: NaiveDate,
        timezone_id: &str,
        mode: TemplateApplyMode,
    ) -> AppResult<ChangeResult> {
        let template = self
            .list_templates()
            .await?
            .into_iter()
            .find(|item| item.id == template_id)
            .ok_or_else(template_not_found)?;
        let timezone = timezone_id
            .parse::<Tz>()
            .map_err(|_| AppError::Validation {
                message: "タイムゾーンを確認できませんでした。".into(),
                recovery: "設定で有効なIANAタイムゾーンを選び直してください。".into(),
            })?;
        let previews = template
            .blocks
            .iter()
            .map(|block| preview_item(block, date, timezone, timezone_id))
            .collect::<AppResult<Vec<_>>>()?;
        let day_start = resolve_local(timezone, NaiveDateTime::new(date, NaiveTime::MIN))?;
        let day_end = resolve_local(
            timezone,
            NaiveDateTime::new(
                date.succ_opt().ok_or_else(|| AppError::Validation {
                    message: "対象日の範囲が正しくありません。".into(),
                    recovery: "別の日付を選び直してください。".into(),
                })?,
                NaiveTime::MIN,
            ),
        )?;

        let mut transaction = self.begin_mutation().await?;
        let action_id = Uuid::new_v4();
        let now = Utc::now();
        let mut changed_ids = Vec::new();

        if mode == TemplateApplyMode::Replace {
            let rows = sqlx::query(
                "SELECT * FROM schedule_items WHERE start_at_utc < ? AND end_at_utc > ? AND deleted_at_utc IS NULL AND sync_status = 'local_only' AND NOT EXISTS (SELECT 1 FROM sync_mappings WHERE sync_mappings.schedule_item_id = schedule_items.id)",
            )
            .bind(day_end.to_rfc3339())
            .bind(day_start.to_rfc3339())
            .fetch_all(&mut *transaction)
            .await
            .map_err(|error| AppError::database("template-replace-read", error))?;
            for row in rows {
                let before = row_to_schedule(&row)?;
                let mut after = before.clone();
                after.version += 1;
                after.deleted_at = Some(now);
                after.sync_status = if before.sync_status == SyncStatus::LocalOnly {
                    SyncStatus::LocalOnly
                } else {
                    SyncStatus::Pending
                };
                update_schedule_row(&mut transaction, &after, now).await?;
                insert_history(
                    &mut transaction,
                    action_id,
                    "delete",
                    Some(&before),
                    Some(&after),
                    now,
                )
                .await?;
                changed_ids.push(after.id);
            }
        }

        for (block, preview) in template.blocks.iter().zip(previews.iter()) {
            let schedule = Schedule {
                id: Uuid::new_v4(),
                draft: ScheduleDraft {
                    title: block.title.clone(),
                    description: format!("テンプレート「{}」から適用", template.name),
                    location: String::new(),
                    start_utc: preview.start_utc,
                    end_utc: preview.end_utc,
                    timezone_id: timezone_id.into(),
                    all_day: false,
                    all_day_start_date: None,
                    all_day_end_date_exclusive: None,
                    status: ScheduleStatus::Scheduled,
                    project: block.project.clone(),
                    category: block.category.clone(),
                    tags: Vec::new(),
                    color: block.color.clone(),
                    priority: Priority::Normal,
                    recurrence_rule: None,
                    recurrence_exdates: Vec::new(),
                    start_notification_minutes: None,
                    end_notification_minutes: None,
                },
                sync_status: SyncStatus::LocalOnly,
                version: 0,
                deleted_at: None,
            };
            insert_schedule(&mut transaction, &schedule, now).await?;
            insert_history(
                &mut transaction,
                action_id,
                "create",
                None,
                Some(&schedule),
                now,
            )
            .await?;
            changed_ids.push(schedule.id);
        }
        transaction
            .commit()
            .await
            .map_err(|error| AppError::database("template-apply-commit", error))?;
        self.change_result(changed_ids).await
    }
}

fn preview_item(
    block: &TemplateBlock,
    date: NaiveDate,
    timezone: Tz,
    timezone_id: &str,
) -> AppResult<TemplatePreviewItem> {
    let local_start =
        NaiveDateTime::new(date, NaiveTime::MIN) + Duration::minutes(i64::from(block.start_minute));
    let local_end = local_start + Duration::minutes(i64::from(block.duration_minutes));
    Ok(TemplatePreviewItem {
        title: block.title.clone(),
        start_utc: resolve_local(timezone, local_start)?,
        end_utc: resolve_local(timezone, local_end)?,
        timezone_id: timezone_id.into(),
        color: block.color.clone(),
    })
}

fn resolve_local(timezone: Tz, value: NaiveDateTime) -> AppResult<chrono::DateTime<Utc>> {
    match timezone.from_local_datetime(&value) {
        LocalResult::Single(value) => Ok(value.with_timezone(&Utc)),
        LocalResult::None => Err(AppError::Validation {
            message: "夏時間の切替により存在しない時刻が含まれています。".into(),
            recovery: "プレビューへ戻り、該当ブロックの時刻を変更してください。".into(),
        }),
        LocalResult::Ambiguous(_, _) => Err(AppError::Validation {
            message: "夏時間の切替により時刻が2通りに解釈できます。".into(),
            recovery: "プレビューへ戻り、どちらの時刻か明示できるよう開始時刻を変更してください。"
                .into(),
        }),
    }
}

async fn delete_versioned(
    pool: &sqlx::SqlitePool,
    table: &'static str,
    id: Uuid,
    expected_version: u64,
    label: &'static str,
) -> AppResult<()> {
    let sql = match table {
        "quick_blocks" => "DELETE FROM quick_blocks WHERE id = ? AND version = ?",
        "free_alarms" => "DELETE FROM free_alarms WHERE id = ? AND version = ?",
        _ => return Err(AppError::database("delete-table", "unknown table")),
    };
    let result = sqlx::query(sql)
        .bind(id.to_string())
        .bind(expected_version as i64)
        .execute(pool)
        .await
        .map_err(|error| AppError::database("versioned-delete", error))?;
    if result.rows_affected() == 1 {
        Ok(())
    } else {
        Err(version_conflict(label))
    }
}

fn template_from_row(row: &SqliteRow, blocks: Vec<TemplateBlock>) -> AppResult<DayTemplate> {
    Ok(DayTemplate {
        id: parse_uuid(row.get::<&str, _>("id"), "template-id")?,
        name: row.get("name"),
        description: row.get("description"),
        color: row.get("color"),
        weekdays_mask: row.get::<i64, _>("weekdays_mask") as u8,
        is_builtin: row.get("is_builtin"),
        sort_order: row.get::<i64, _>("sort_order") as i32,
        version: row.get::<i64, _>("version").max(0) as u64,
        blocks,
    })
}

fn block_from_row(row: &SqliteRow) -> AppResult<TemplateBlock> {
    Ok(TemplateBlock {
        id: parse_uuid(row.get::<&str, _>("id"), "template-block-id")?,
        title: row.get("title"),
        start_minute: row.get::<i64, _>("start_minute") as u16,
        duration_minutes: row.get::<i64, _>("duration_minutes") as u16,
        color: row.get("color"),
        project: row.get("project"),
        category: row.get("category"),
        sort_order: row.get::<i64, _>("sort_order") as i32,
    })
}

fn quick_block_from_row(row: &SqliteRow) -> AppResult<QuickBlock> {
    Ok(QuickBlock {
        id: parse_uuid(row.get::<&str, _>("id"), "quick-block-id")?,
        draft: QuickBlockDraft {
            title: row.get("title"),
            start_minute: row.get::<i64, _>("start_minute") as u16,
            duration_minutes: row.get::<i64, _>("duration_minutes") as u16,
            timezone_id: row.get("time_zone"),
            color: row.get("color"),
            project: row.get("project"),
            category: row.get("category"),
            start_notification_minutes: row
                .get::<Option<i64>, _>("start_notification_minutes")
                .map(|value| value as u16),
            end_notification_minutes: row
                .get::<Option<i64>, _>("end_notification_minutes")
                .map(|value| value as u16),
            is_active: row.get("is_active"),
        },
        sort_order: row.get::<i64, _>("sort_order") as i32,
        version: row.get::<i64, _>("version").max(0) as u64,
    })
}

fn free_alarm_from_row(row: &SqliteRow) -> AppResult<FreeAlarm> {
    Ok(FreeAlarm {
        id: parse_uuid(row.get::<&str, _>("id"), "alarm-id")?,
        draft: FreeAlarmDraft {
            label: row.get("label"),
            minute_of_day: row.get::<i64, _>("minute_of_day") as u16,
            timezone_id: row.get("time_zone"),
            weekdays_mask: row.get::<i64, _>("weekdays_mask") as u8,
            enabled: row.get("enabled"),
        },
        sort_order: row.get::<i64, _>("sort_order") as i32,
        version: row.get::<i64, _>("version").max(0) as u64,
    })
}

fn parse_uuid(value: &str, context: &'static str) -> AppResult<Uuid> {
    Uuid::parse_str(value).map_err(|error| AppError::database(context, error))
}

fn version_conflict(label: &str) -> AppError {
    AppError::Conflict {
        message: format!("{label}が別の操作で更新されています。"),
        recovery: "一覧を更新してから変更を適用し直してください。".into(),
    }
}

fn template_not_found() -> AppError {
    AppError::NotFound {
        message: "テンプレートが見つかりません。".into(),
        recovery: "一覧を更新してください。".into(),
    }
}

#[cfg(test)]
mod tests {
    use chrono::{NaiveDate, TimeZone};

    use super::*;
    use crate::domain::library::TemplateBlockDraft;

    #[tokio::test]
    async fn builtin_template_cannot_be_renamed_or_deleted() {
        let database = Database::open_memory().await.unwrap();
        let builtin = database.list_templates().await.unwrap().remove(0);
        let draft = DayTemplateDraft {
            name: "別名".into(),
            description: builtin.description.clone(),
            color: builtin.color.clone(),
            weekdays_mask: builtin.weekdays_mask,
            blocks: vec![],
        };
        assert!(
            database
                .save_template(Some(builtin.id), Some(builtin.version), draft)
                .await
                .is_err()
        );
        assert!(
            database
                .delete_template(builtin.id, builtin.version)
                .await
                .is_err()
        );
    }

    #[tokio::test]
    async fn template_blocks_replace_atomically() {
        let database = Database::open_memory().await.unwrap();
        let created = database
            .save_template(
                None,
                None,
                DayTemplateDraft {
                    name: "平日".into(),
                    description: String::new(),
                    color: "#336699".into(),
                    weekdays_mask: 31,
                    blocks: vec![TemplateBlockDraft {
                        title: "作業".into(),
                        start_minute: 540,
                        duration_minutes: 60,
                        color: "#336699".into(),
                        project: String::new(),
                        category: String::new(),
                    }],
                },
            )
            .await
            .unwrap();
        assert_eq!(created.blocks.len(), 1);
        assert_eq!(database.list_templates().await.unwrap().len(), 2);
    }

    #[tokio::test]
    async fn library_reorder_requires_the_complete_current_set_and_persists_order() {
        let database = Database::open_memory().await.unwrap();
        let first = database
            .save_free_alarm(
                None,
                None,
                FreeAlarmDraft {
                    label: "A".into(),
                    minute_of_day: 480,
                    timezone_id: "Asia/Tokyo".into(),
                    weekdays_mask: 127,
                    enabled: true,
                },
            )
            .await
            .unwrap();
        let second = database
            .save_free_alarm(
                None,
                None,
                FreeAlarmDraft {
                    label: "B".into(),
                    minute_of_day: 540,
                    timezone_id: "Asia/Tokyo".into(),
                    weekdays_mask: 127,
                    enabled: true,
                },
            )
            .await
            .unwrap();
        assert!(database.reorder_free_alarms(&[second.id]).await.is_err());
        database
            .reorder_free_alarms(&[second.id, first.id])
            .await
            .unwrap();
        let reordered = database.list_free_alarms().await.unwrap();
        assert_eq!(reordered[0].id, second.id);
        assert_eq!(reordered[1].id, first.id);
        assert_eq!(reordered[0].version, second.version + 1);
    }

    #[tokio::test]
    async fn template_apply_is_one_undoable_action() {
        let database = Database::open_memory().await.unwrap();
        let template = database
            .save_template(
                None,
                None,
                DayTemplateDraft {
                    name: "適用".into(),
                    description: String::new(),
                    color: "#336699".into(),
                    weekdays_mask: 127,
                    blocks: vec![TemplateBlockDraft {
                        title: "A".into(),
                        start_minute: 540,
                        duration_minutes: 60,
                        color: "#336699".into(),
                        project: String::new(),
                        category: String::new(),
                    }],
                },
            )
            .await
            .unwrap();
        let date = NaiveDate::from_ymd_opt(2026, 7, 20).unwrap();
        let result = database
            .apply_template(template.id, date, "Asia/Tokyo", TemplateApplyMode::Add)
            .await
            .unwrap();
        assert_eq!(result.changed_ids.len(), 1);
        database.undo().await.unwrap();
        let (items, _) = database
            .list_schedules(crate::domain::ScheduleQuery {
                start_utc: Utc.with_ymd_and_hms(2026, 7, 19, 15, 0, 0).unwrap(),
                end_utc: Utc.with_ymd_and_hms(2026, 7, 20, 15, 0, 0).unwrap(),
                search: None,
                include_deleted: false,
                limit: 500,
                offset: 0,
                status: None,
                project: None,
                category: None,
                tag: None,
                priority: None,
                sync_status: None,
                sync_target: None,
                completion: "all".into(),
                sort_by: "start".into(),
                sort_descending: false,
            })
            .await
            .unwrap();
        assert!(items.is_empty());
    }

    #[tokio::test]
    async fn template_preview_rejects_dst_gap_instead_of_shifting() {
        let database = Database::open_memory().await.unwrap();
        let template = database
            .save_template(
                None,
                None,
                DayTemplateDraft {
                    name: "DST".into(),
                    description: String::new(),
                    color: "#336699".into(),
                    weekdays_mask: 127,
                    blocks: vec![TemplateBlockDraft {
                        title: "存在しない時刻".into(),
                        start_minute: 150,
                        duration_minutes: 30,
                        color: "#336699".into(),
                        project: String::new(),
                        category: String::new(),
                    }],
                },
            )
            .await
            .unwrap();
        assert!(
            database
                .preview_template(
                    template.id,
                    NaiveDate::from_ymd_opt(2026, 3, 29).unwrap(),
                    "Europe/Berlin",
                )
                .await
                .is_err()
        );
    }
}
