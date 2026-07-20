use std::{
    fs,
    path::{Path, PathBuf},
    str::FromStr,
    sync::Arc,
    time::Duration,
};

use chrono::{DateTime, SecondsFormat, Utc};
use serde::Serialize;
use sqlx::{
    Row, Sqlite, SqlitePool, Transaction,
    sqlite::{SqliteConnectOptions, SqliteJournalMode, SqlitePoolOptions, SqliteRow},
};
use uuid::Uuid;

use crate::domain::{
    AppError, AppResult, FocusPhase, Priority, RecurrenceEditScope, Schedule,
    ScheduleClassificationPatch, ScheduleDraft, ScheduleQuery, ScheduleStatus, Settings,
    SyncStatus, SyncSummary, SyncSummaryState, expand_recurrence,
};

static MIGRATOR: sqlx::migrate::Migrator = sqlx::migrate!("./migrations");

#[derive(Clone)]
pub struct Database {
    pub(crate) pool: SqlitePool,
    pub(crate) path: Option<Arc<PathBuf>>,
}

#[derive(Debug, Clone)]
pub struct FocusRecord {
    pub id: Uuid,
    pub schedule_item_id: Option<Uuid>,
    pub phase: FocusPhase,
    pub previous_phase: Option<FocusPhase>,
    pub started_at: DateTime<Utc>,
    pub accumulated_seconds: u64,
    pub cycle: u32,
}

#[derive(Debug, Clone, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct FocusHistoryItem {
    pub id: Uuid,
    pub session_id: Uuid,
    pub schedule_item_id: Option<Uuid>,
    pub event: String,
    pub from_phase: Option<FocusPhase>,
    pub to_phase: Option<FocusPhase>,
    pub elapsed_seconds: u64,
    pub occurred_at: DateTime<Utc>,
}

#[derive(Debug, Clone, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct FocusHistoryReport {
    pub work_seconds: u64,
    pub entries: Vec<FocusHistoryItem>,
}

#[derive(Debug, Clone, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct DiagnosticsSnapshot {
    pub app_version: String,
    pub schema_version: u32,
    pub database_state: &'static str,
    pub schedule_count: u64,
    pub deleted_count: u64,
    pub outbox_count: u64,
    pub conflict_count: u64,
    pub last_backup_at: Option<DateTime<Utc>>,
    pub integrity: &'static str,
}

#[derive(Debug, Clone, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct ChangeResult {
    pub changed_ids: Vec<Uuid>,
    pub undo_available: bool,
    pub redo_available: bool,
}

impl Database {
    pub async fn open(path: &Path) -> AppResult<Self> {
        let options = SqliteConnectOptions::from_str(&format!("sqlite:{}", path.display()))
            .map_err(|error| AppError::database("connect-options", error))?
            .create_if_missing(true)
            .foreign_keys(true)
            .journal_mode(SqliteJournalMode::Wal)
            .busy_timeout(Duration::from_secs(5));
        let pool = SqlitePoolOptions::new()
            .max_connections(5)
            .connect_with(options)
            .await
            .map_err(|error| AppError::database("open", error))?;
        MIGRATOR
            .run(&pool)
            .await
            .map_err(|error| AppError::database("migration", error))?;
        let database = Self {
            pool,
            path: Some(Arc::new(path.to_path_buf())),
        };
        database.backfill_all_day_local_dates().await?;
        database.integrity_check().await?;
        Ok(database)
    }

    #[cfg(test)]
    pub async fn open_memory() -> AppResult<Self> {
        let options = SqliteConnectOptions::from_str("sqlite::memory:")
            .map_err(|error| AppError::database("test-options", error))?
            .create_if_missing(true)
            .foreign_keys(true);
        let pool = SqlitePoolOptions::new()
            .max_connections(1)
            .connect_with(options)
            .await
            .map_err(|error| AppError::database("test-open", error))?;
        MIGRATOR
            .run(&pool)
            .await
            .map_err(|error| AppError::database("test-migration", error))?;
        let database = Self { pool, path: None };
        database.backfill_all_day_local_dates().await?;
        Ok(database)
    }

    async fn backfill_all_day_local_dates(&self) -> AppResult<()> {
        let rows = sqlx::query(
            "SELECT id, start_at_utc, end_at_utc, time_zone FROM schedule_items WHERE all_day = 1",
        )
        .fetch_all(&self.pool)
        .await
        .map_err(|error| AppError::database("all-day-backfill-read", error))?;
        if rows.is_empty() {
            return Ok(());
        }
        let mut transaction = self
            .pool
            .begin()
            .await
            .map_err(|error| AppError::database("all-day-backfill-begin", error))?;
        for row in rows {
            let timezone_id: String = row.get("time_zone");
            let timezone = timezone_id
                .parse::<chrono_tz::Tz>()
                .map_err(|error| AppError::database("all-day-backfill-timezone", error))?;
            let start = parse_datetime(row.get("start_at_utc"), "all-day-backfill-start")?;
            let end = parse_datetime(row.get("end_at_utc"), "all-day-backfill-end")?;
            let start_date = start.with_timezone(&timezone).date_naive();
            let end_date = end.with_timezone(&timezone).date_naive();
            if start_date >= end_date {
                return Err(AppError::database(
                    "all-day-backfill-range",
                    "exclusive end date must be after start date",
                ));
            }
            sqlx::query(
                "UPDATE schedule_items SET all_day_start_date = ?, all_day_end_date_exclusive = ? WHERE id = ?",
            )
            .bind(start_date.to_string())
            .bind(end_date.to_string())
            .bind(row.get::<&str, _>("id"))
            .execute(&mut *transaction)
            .await
            .map_err(|error| AppError::database("all-day-backfill-update", error))?;
        }
        transaction
            .commit()
            .await
            .map_err(|error| AppError::database("all-day-backfill-commit", error))
    }

    pub async fn integrity_check(&self) -> AppResult<()> {
        let result: String = sqlx::query_scalar("PRAGMA quick_check")
            .fetch_one(&self.pool)
            .await
            .map_err(|error| AppError::database("integrity-query", error))?;
        if result == "ok" {
            Ok(())
        } else {
            Err(AppError::Unavailable {
                message: "ローカルデータベースの整合性確認が必要です。".into(),
                recovery: "アプリを閉じ、診断画面の案内に従ってバックアップから復旧してください。"
                    .into(),
                retryable: false,
            })
        }
    }

    pub async fn delete_all_user_data(&self) -> AppResult<u64> {
        let staged_backup = self.stage_backups_for_deletion()?;
        let result = self.delete_all_user_data_transaction().await;
        match result {
            Ok(deleted_schedules) => {
                if let Some((_, staged)) = staged_backup
                    && staged.is_dir()
                {
                    fs::remove_dir_all(&staged).map_err(|error| AppError::Unavailable {
                        message: "ローカルデータは削除しましたが、退避したバックアップを消去できませんでした。".into(),
                        recovery: format!(
                            "アプリを終了し、バックアップ領域の権限を確認してから削除を再実行してください（詳細: {error}）。"
                        ),
                        retryable: true,
                    })?;
                }
                Ok(deleted_schedules)
            }
            Err(error) => {
                if let Some((original, staged)) = staged_backup
                    && staged.is_dir()
                    && !original.exists()
                {
                    fs::rename(&staged, &original).map_err(|restore_error| {
                        AppError::Unavailable {
                            message: "データ削除を確定できず、バックアップ領域の復元にも失敗しました。".into(),
                            recovery: format!(
                                "アプリを終了してバックアップ領域を保護し、診断を確認してください（詳細: {restore_error}）。"
                            ),
                            retryable: false,
                        }
                    })?;
                }
                Err(error)
            }
        }
    }

    fn stage_backups_for_deletion(&self) -> AppResult<Option<(PathBuf, PathBuf)>> {
        let Some(database_path) = self.path.as_deref() else {
            return Ok(None);
        };
        let parent = database_path
            .parent()
            .ok_or_else(|| AppError::database("data-delete-parent", "missing parent"))?;
        let original = parent.join("backups");
        let staged = parent.join(".backups-deleting");
        if staged.exists() {
            fs::remove_dir_all(&staged)
                .map_err(|error| AppError::database("data-delete-stale-backups", error))?;
        }
        if !original.exists() {
            return Ok(None);
        }
        fs::rename(&original, &staged)
            .map_err(|error| AppError::database("data-delete-stage-backups", error))?;
        Ok(Some((original, staged)))
    }

    async fn delete_all_user_data_transaction(&self) -> AppResult<u64> {
        let deleted_schedules: i64 = sqlx::query_scalar("SELECT COUNT(*) FROM schedule_items")
            .fetch_one(&self.pool)
            .await
            .map_err(|error| AppError::database("data-delete-count", error))?;
        let default_settings = serde_json::to_string(&Settings::default())
            .map_err(|error| AppError::database("data-delete-settings-encode", error))?;
        let now = timestamp(Utc::now());
        let mut transaction = self
            .pool
            .begin()
            .await
            .map_err(|error| AppError::database("data-delete-begin", error))?;
        for (step, statement) in [
            ("diagnostics", "DELETE FROM diagnostic_events"),
            ("focus-history", "DELETE FROM focus_history"),
            ("focus-sessions", "DELETE FROM focus_sessions"),
            (
                "notification-deliveries",
                "DELETE FROM notification_deliveries",
            ),
            ("notification-rules", "DELETE FROM notification_rules"),
            ("sync-conflicts", "DELETE FROM sync_conflicts"),
            ("sync-mappings", "DELETE FROM sync_mappings"),
            ("sync-outbox", "DELETE FROM sync_outbox"),
            ("google-calendars", "DELETE FROM google_calendars"),
            ("google-accounts", "DELETE FROM google_accounts"),
            ("google-oauth-config", "DELETE FROM google_oauth_config"),
            ("history", "DELETE FROM change_history"),
            ("schedules", "DELETE FROM schedule_items"),
            ("template-blocks", "DELETE FROM template_blocks"),
            (
                "custom-templates",
                "DELETE FROM templates WHERE is_builtin = 0",
            ),
            ("quick-blocks", "DELETE FROM quick_blocks"),
            ("free-alarms", "DELETE FROM free_alarms"),
            ("projects", "DELETE FROM projects"),
            ("categories", "DELETE FROM categories"),
            ("tags", "DELETE FROM tags"),
            ("backup-history", "DELETE FROM backup_history"),
            ("window-state", "DELETE FROM window_states"),
        ] {
            sqlx::query(statement)
                .execute(&mut *transaction)
                .await
                .map_err(|error| AppError::database(step, error))?;
        }
        sqlx::query(
            "UPDATE templates SET name = '基本', description = '削除できない既定の一日のテンプレート', color = '#6F96F4', weekdays_mask = 127, sort_order = 0, version = version + 1, updated_at_utc = ? WHERE is_builtin = 1",
        )
        .bind(&now)
        .execute(&mut *transaction)
        .await
        .map_err(|error| AppError::database("data-delete-builtin-template", error))?;
        sqlx::query(
            "INSERT INTO settings(key, value_json, updated_at_utc) VALUES ('application', ?, ?) ON CONFLICT(key) DO UPDATE SET value_json = excluded.value_json, updated_at_utc = excluded.updated_at_utc",
        )
        .bind(default_settings)
        .bind(&now)
        .execute(&mut *transaction)
        .await
        .map_err(|error| AppError::database("data-delete-settings", error))?;
        transaction
            .commit()
            .await
            .map_err(|error| AppError::database("data-delete-commit", error))?;
        Ok(deleted_schedules.max(0) as u64)
    }

    pub async fn settings(&self) -> AppResult<Settings> {
        let json: String =
            sqlx::query_scalar("SELECT value_json FROM settings WHERE key = 'application'")
                .fetch_one(&self.pool)
                .await
                .map_err(|error| AppError::database("settings-read", error))?;
        serde_json::from_str(&json).map_err(|error| AppError::database("settings-decode", error))
    }

    pub async fn window_always_on_top(&self, label: &str) -> AppResult<bool> {
        let state: Option<String> =
            sqlx::query_scalar("SELECT state_json FROM window_states WHERE window_label = ?")
                .bind(label)
                .fetch_optional(&self.pool)
                .await
                .map_err(|error| AppError::database("window-state-read", error))?;
        let Some(state) = state else {
            return Ok(false);
        };
        let value: serde_json::Value = serde_json::from_str(&state)
            .map_err(|error| AppError::database("window-state-decode", error))?;
        Ok(value
            .get("alwaysOnTop")
            .and_then(serde_json::Value::as_bool)
            .unwrap_or(false))
    }

    pub async fn save_window_always_on_top(&self, label: &str, value: bool) -> AppResult<()> {
        let json = serde_json::json!({ "alwaysOnTop": value }).to_string();
        sqlx::query(
            "INSERT INTO window_states(window_label, state_json, updated_at_utc) VALUES (?, ?, ?) ON CONFLICT(window_label) DO UPDATE SET state_json = excluded.state_json, updated_at_utc = excluded.updated_at_utc",
        )
        .bind(label)
        .bind(json)
        .bind(timestamp(Utc::now()))
        .execute(&self.pool)
        .await
        .map_err(|error| AppError::database("window-state-save", error))?;
        Ok(())
    }

    pub async fn save_settings(&self, settings: &Settings) -> AppResult<Settings> {
        settings.validate()?;
        let json = serde_json::to_string(settings)
            .map_err(|error| AppError::database("settings-encode", error))?;
        sqlx::query(
            "UPDATE settings SET value_json = ?, updated_at_utc = ? WHERE key = 'application'",
        )
        .bind(json)
        .bind(timestamp(Utc::now()))
        .execute(&self.pool)
        .await
        .map_err(|error| AppError::database("settings-update", error))?;
        Ok(settings.clone())
    }

    pub async fn list_schedules(
        &self,
        mut query: ScheduleQuery,
    ) -> AppResult<(Vec<Schedule>, u64)> {
        query.validate()?;
        let start = timestamp(query.start_utc);
        let end = timestamp(query.end_utc);
        let search = query.search.as_deref();
        let fts_search = search
            .filter(|value| supports_trigram_search(value))
            .map(fts_query)
            .transpose()?;
        let like_search = search
            .filter(|value| !supports_trigram_search(value))
            .map(normalize_plain_search)
            .map(|value| format!("%{}%", escape_like(&value)));
        let status = query.status.map(ScheduleStatus::as_str);
        let priority = query.priority.map(Priority::as_str);
        let sync_status = query.sync_status.map(SyncStatus::as_str);

        let rows = sqlx::query(
            r#"
            SELECT s.* FROM schedule_items s
            WHERE (s.recurrence_rule IS NOT NULL OR (s.start_at_utc < ? AND s.end_at_utc > ?))
              AND (? OR s.deleted_at_utc IS NULL)
              AND (? IS NULL
                OR (? IS NOT NULL AND s.rowid IN (
                  SELECT rowid FROM schedule_items_fts WHERE schedule_items_fts MATCH ?
                ))
                OR (? IS NOT NULL AND (
                  s.title LIKE ? ESCAPE '\' OR s.description LIKE ? ESCAPE '\'
                  OR s.location LIKE ? ESCAPE '\' OR s.project LIKE ? ESCAPE '\'
                  OR s.category LIKE ? ESCAPE '\' OR s.tags_json LIKE ? ESCAPE '\'
                ))
              )
              AND (? IS NULL OR s.status = ?)
              AND (? IS NULL OR s.project = ?)
              AND (? IS NULL OR s.category = ?)
              AND (? IS NULL OR EXISTS (
                SELECT 1 FROM json_each(s.tags_json) WHERE json_each.value = ?
              ))
              AND (? IS NULL OR s.priority = ?)
              AND (? IS NULL OR s.sync_status = ?)
              AND (? IS NULL OR EXISTS (
                SELECT 1
                FROM sync_mappings m
                JOIN google_calendars c ON c.id = m.calendar_id
                WHERE m.schedule_item_id = s.id AND c.display_name = ?
              ))
              AND (? != 'open' OR s.status NOT IN ('completed', 'cancelled'))
              AND (? != 'completed' OR s.status = 'completed')
            ORDER BY start_at_utc ASC, end_at_utc ASC, id ASC
            "#,
        )
        .bind(&end)
        .bind(&start)
        .bind(query.include_deleted)
        .bind(search)
        .bind(fts_search.as_deref())
        .bind(fts_search.as_deref())
        .bind(like_search.as_deref())
        .bind(like_search.as_deref())
        .bind(like_search.as_deref())
        .bind(like_search.as_deref())
        .bind(like_search.as_deref())
        .bind(like_search.as_deref())
        .bind(like_search.as_deref())
        .bind(status)
        .bind(status)
        .bind(query.project.as_deref())
        .bind(query.project.as_deref())
        .bind(query.category.as_deref())
        .bind(query.category.as_deref())
        .bind(query.tag.as_deref())
        .bind(query.tag.as_deref())
        .bind(priority)
        .bind(priority)
        .bind(sync_status)
        .bind(sync_status)
        .bind(query.sync_target.as_deref())
        .bind(query.sync_target.as_deref())
        .bind(&query.completion)
        .bind(&query.completion)
        .fetch_all(&self.pool)
        .await
        .map_err(|error| AppError::database("schedule-list", error))?;

        let mut items = Vec::new();
        let mut updated_by_id = std::collections::HashMap::new();
        let expansion_limit = usize::try_from(query.limit.saturating_add(query.offset))
            .unwrap_or(500)
            .max(1);
        for row in &rows {
            let schedule = row_to_schedule(row)?;
            updated_by_id.insert(
                schedule.id,
                parse_datetime(row.get("updated_at_utc"), "schedule-list-updated")?,
            );
            if schedule.draft.recurrence_rule.is_some() && schedule.deleted_at.is_none() {
                let expanded =
                    expand_recurrence(&schedule, query.start_utc, query.end_utc, expansion_limit)?;
                for occurrence in expanded.items {
                    let mut occurrence_schedule = schedule.clone();
                    occurrence_schedule.draft.start_utc = occurrence.start_utc;
                    occurrence_schedule.draft.end_utc = occurrence.end_utc;
                    items.push(occurrence_schedule);
                }
            } else {
                items.push(schedule);
            }
        }
        items.sort_by(|left, right| {
            let ordering = match query.sort_by.as_str() {
                "end" => left.draft.end_utc.cmp(&right.draft.end_utc),
                "updated" => updated_by_id
                    .get(&left.id)
                    .cmp(&updated_by_id.get(&right.id)),
                "priority" => {
                    priority_rank(left.draft.priority).cmp(&priority_rank(right.draft.priority))
                }
                "title" => left.draft.title.cmp(&right.draft.title),
                _ => left.draft.start_utc.cmp(&right.draft.start_utc),
            }
            .then(left.draft.start_utc.cmp(&right.draft.start_utc))
            .then(left.id.cmp(&right.id));
            if query.sort_descending {
                ordering.reverse()
            } else {
                ordering
            }
        });
        let total = items.len() as u64;
        let start_index = usize::try_from(query.offset)
            .unwrap_or(usize::MAX)
            .min(items.len());
        let end_index = start_index
            .saturating_add(usize::try_from(query.limit).unwrap_or(500))
            .min(items.len());
        Ok((items[start_index..end_index].to_vec(), total))
    }

    #[cfg(test)]
    pub async fn schedule(&self, id: Uuid) -> AppResult<Schedule> {
        let row = sqlx::query("SELECT * FROM schedule_items WHERE id = ?")
            .bind(id.to_string())
            .fetch_optional(&self.pool)
            .await
            .map_err(|error| AppError::database("schedule-read", error))?
            .ok_or_else(not_found)?;
        row_to_schedule(&row)
    }

    pub async fn create_schedule(&self, mut draft: ScheduleDraft) -> AppResult<Schedule> {
        draft.validate()?;
        let now = Utc::now();
        let mut transaction = self.begin_mutation().await?;
        let has_sync_target = has_default_write_target(&mut transaction).await?;
        let schedule = Schedule {
            id: Uuid::new_v4(),
            draft,
            sync_status: if has_sync_target {
                SyncStatus::Pending
            } else {
                SyncStatus::LocalOnly
            },
            version: 0,
            deleted_at: None,
        };
        insert_schedule(&mut transaction, &schedule, now).await?;
        insert_history(
            &mut transaction,
            Uuid::new_v4(),
            "create",
            None,
            Some(&schedule),
            now,
        )
        .await?;
        if has_sync_target {
            enqueue_outbox(&mut transaction, &schedule, "create", now).await?;
        }
        transaction
            .commit()
            .await
            .map_err(|error| AppError::database("create-commit", error))?;
        Ok(schedule)
    }

    #[cfg(test)]
    pub async fn update_schedule(
        &self,
        id: Uuid,
        expected_version: u64,
        draft: ScheduleDraft,
    ) -> AppResult<Schedule> {
        self.update_schedule_scoped(
            id,
            expected_version,
            draft,
            RecurrenceEditScope::Series,
            None,
        )
        .await
    }

    pub async fn update_schedule_scoped(
        &self,
        id: Uuid,
        expected_version: u64,
        mut draft: ScheduleDraft,
        scope: RecurrenceEditScope,
        occurrence_start_utc: Option<DateTime<Utc>>,
    ) -> AppResult<Schedule> {
        draft.validate()?;
        let mut transaction = self.begin_mutation().await?;
        let before = fetch_schedule(&mut transaction, id).await?;
        if before.deleted_at.is_some() || before.version != expected_version {
            return Err(version_conflict());
        }
        if matches!(before.sync_status, SyncStatus::ReadOnly) {
            return Err(AppError::Validation {
                message: "このGoogle予定は読み取り専用です。".into(),
                recovery: "予定を複製して通常のローカル予定として編集してください。".into(),
            });
        }
        let has_sync_target = has_default_write_target(&mut transaction).await?;
        if before.draft.recurrence_rule.is_some()
            && let Some(occurrence_start) = occurrence_start_utc
        {
            match scope {
                RecurrenceEditScope::This => {
                    let result = update_single_occurrence(
                        &mut transaction,
                        &before,
                        draft,
                        occurrence_start,
                        has_sync_target,
                    )
                    .await?;
                    transaction
                        .commit()
                        .await
                        .map_err(|error| AppError::database("update-occurrence-commit", error))?;
                    return Ok(result);
                }
                RecurrenceEditScope::Following if occurrence_start > before.draft.start_utc => {
                    let result = split_recurring_series(
                        &mut transaction,
                        &before,
                        draft,
                        occurrence_start,
                        has_sync_target,
                    )
                    .await?;
                    transaction
                        .commit()
                        .await
                        .map_err(|error| AppError::database("update-following-commit", error))?;
                    return Ok(result);
                }
                RecurrenceEditScope::Series => {
                    let start_delta = draft.start_utc - occurrence_start;
                    let duration = draft.end_utc - draft.start_utc;
                    draft.start_utc = before.draft.start_utc + start_delta;
                    draft.end_utc = draft.start_utc + duration;
                }
                RecurrenceEditScope::Following => {}
            }
        }
        let after = Schedule {
            id,
            draft,
            sync_status: if matches!(before.sync_status, SyncStatus::LocalOnly) && !has_sync_target
            {
                SyncStatus::LocalOnly
            } else {
                SyncStatus::Pending
            },
            version: expected_version + 1,
            deleted_at: None,
        };
        update_schedule_row(&mut transaction, &after, Utc::now()).await?;
        insert_history(
            &mut transaction,
            Uuid::new_v4(),
            "update",
            Some(&before),
            Some(&after),
            Utc::now(),
        )
        .await?;
        if has_sync_target || !matches!(before.sync_status, SyncStatus::LocalOnly) {
            enqueue_outbox(&mut transaction, &after, "update", Utc::now()).await?;
        }
        transaction
            .commit()
            .await
            .map_err(|error| AppError::database("update-commit", error))?;
        Ok(after)
    }

    pub async fn bulk_classify_schedules(
        &self,
        mut ids: Vec<Uuid>,
        patch: ScheduleClassificationPatch,
    ) -> AppResult<ChangeResult> {
        ids.sort_unstable();
        ids.dedup();
        if ids.is_empty() || ids.len() > 500 || patch.is_empty() {
            return Err(AppError::Validation {
                message: "一括変更の対象または変更内容がありません。".into(),
                recovery: "1〜500件の予定を選び、変更する分類を1つ以上指定してください。".into(),
            });
        }
        let mut transaction = self.begin_mutation().await?;
        let has_sync_target = has_default_write_target(&mut transaction).await?;
        let action_id = Uuid::new_v4();
        let now = Utc::now();
        for id in &ids {
            let before = fetch_schedule(&mut transaction, *id).await?;
            if before.deleted_at.is_some() {
                return Err(not_found());
            }
            if matches!(before.sync_status, SyncStatus::ReadOnly) {
                return Err(AppError::Validation {
                    message: "選択した予定に読み取り専用のGoogle予定が含まれます。".into(),
                    recovery: "読み取り専用予定を選択から外し、もう一度実行してください。".into(),
                });
            }
            let mut after = before.clone();
            patch.apply_to(&mut after.draft);
            after.draft.validate()?;
            after.version += 1;
            after.sync_status = pending_status(&before, has_sync_target);
            update_schedule_row(&mut transaction, &after, now).await?;
            insert_history(
                &mut transaction,
                action_id,
                "bulk",
                Some(&before),
                Some(&after),
                now,
            )
            .await?;
            if has_sync_target || !matches!(before.sync_status, SyncStatus::LocalOnly) {
                enqueue_outbox(&mut transaction, &after, "update", now).await?;
            }
        }
        transaction
            .commit()
            .await
            .map_err(|error| AppError::database("bulk-classify-commit", error))?;
        self.change_result(ids).await
    }

    pub async fn delete_schedule_scoped(
        &self,
        id: Uuid,
        expected_version: u64,
        recurrence_scope: RecurrenceEditScope,
        occurrence_start_utc: Option<DateTime<Utc>>,
    ) -> AppResult<ChangeResult> {
        let mut transaction = self.begin_mutation().await?;
        let before = fetch_schedule(&mut transaction, id).await?;
        if before.deleted_at.is_some() || before.version != expected_version {
            return Err(version_conflict());
        }
        if matches!(before.sync_status, SyncStatus::ReadOnly) {
            return Err(AppError::Validation {
                message: "このGoogle予定は読み取り専用です。".into(),
                recovery: "Google側で変更するか、複製した予定を編集してください。".into(),
            });
        }
        let now = Utc::now();
        let has_sync_target = has_default_write_target(&mut transaction).await?;
        if before.draft.recurrence_rule.is_some()
            && let Some(occurrence_start) = occurrence_start_utc
        {
            let updated = match recurrence_scope {
                RecurrenceEditScope::This => {
                    let mut updated = before.clone();
                    updated.version += 1;
                    updated.sync_status = pending_status(&before, has_sync_target);
                    updated.draft.recurrence_exdates.push(occurrence_start);
                    updated.draft.recurrence_exdates.sort();
                    updated.draft.recurrence_exdates.dedup();
                    Some(updated)
                }
                RecurrenceEditScope::Following if occurrence_start > before.draft.start_utc => {
                    let mut updated = before.clone();
                    updated.version += 1;
                    updated.sync_status = pending_status(&before, has_sync_target);
                    updated.draft.recurrence_rule = Some(rule_ending_before(
                        before.draft.recurrence_rule.as_deref().ok_or_else(|| {
                            AppError::database("recurrence-delete-rule", "missing")
                        })?,
                        occurrence_start,
                    ));
                    updated
                        .draft
                        .recurrence_exdates
                        .retain(|value| *value < occurrence_start);
                    Some(updated)
                }
                RecurrenceEditScope::Series | RecurrenceEditScope::Following => None,
            };
            if let Some(updated) = updated {
                update_schedule_row(&mut transaction, &updated, now).await?;
                insert_history(
                    &mut transaction,
                    Uuid::new_v4(),
                    "update",
                    Some(&before),
                    Some(&updated),
                    now,
                )
                .await?;
                if has_sync_target || !matches!(before.sync_status, SyncStatus::LocalOnly) {
                    enqueue_outbox(&mut transaction, &updated, "update", now).await?;
                }
                transaction
                    .commit()
                    .await
                    .map_err(|error| AppError::database("delete-occurrence-commit", error))?;
                return self.change_result(vec![id]).await;
            }
        }
        let mut after = before.clone();
        after.version += 1;
        after.deleted_at = Some(now);
        after.sync_status =
            if matches!(before.sync_status, SyncStatus::LocalOnly) && !has_sync_target {
                SyncStatus::LocalOnly
            } else {
                SyncStatus::Pending
            };
        update_schedule_row(&mut transaction, &after, now).await?;
        insert_history(
            &mut transaction,
            Uuid::new_v4(),
            "delete",
            Some(&before),
            Some(&after),
            now,
        )
        .await?;
        if has_sync_target || !matches!(before.sync_status, SyncStatus::LocalOnly) {
            enqueue_outbox(&mut transaction, &after, "delete", now).await?;
        }
        transaction
            .commit()
            .await
            .map_err(|error| AppError::database("delete-commit", error))?;
        self.change_result(vec![id]).await
    }

    pub(super) async fn begin_mutation(&self) -> AppResult<Transaction<'_, Sqlite>> {
        let mut transaction = self
            .pool
            .begin()
            .await
            .map_err(|error| AppError::database("transaction-begin", error))?;
        // A new branch of history invalidates redo entries.
        sqlx::query("DELETE FROM change_history WHERE undone = 1")
            .execute(&mut *transaction)
            .await
            .map_err(|error| AppError::database("history-prune", error))?;
        Ok(transaction)
    }

    pub async fn undo(&self) -> AppResult<ChangeResult> {
        let mut transaction = self
            .pool
            .begin()
            .await
            .map_err(|error| AppError::database("undo-begin", error))?;
        let action_id: Option<String> = sqlx::query_scalar(
            "SELECT action_id FROM change_history WHERE undone = 0 ORDER BY id DESC LIMIT 1",
        )
        .fetch_optional(&mut *transaction)
        .await
        .map_err(|error| AppError::database("undo-read", error))?;
        let Some(action_id) = action_id else {
            transaction
                .rollback()
                .await
                .map_err(|error| AppError::database("undo-empty-rollback", error))?;
            return self.change_result(Vec::new()).await;
        };
        let rows = sqlx::query(
            "SELECT entity_id, before_json FROM change_history WHERE action_id = ? ORDER BY id DESC",
        )
        .bind(&action_id)
        .fetch_all(&mut *transaction)
        .await
        .map_err(|error| AppError::database("undo-group-read", error))?;
        let mut changed_ids = Vec::with_capacity(rows.len());
        for row in rows {
            let entity_id = parse_uuid(row.get::<&str, _>("entity_id"), "undo-entity")?;
            let before_json: Option<String> = row.get("before_json");
            apply_snapshot(&mut transaction, entity_id, before_json.as_deref(), true).await?;
            reconcile_history_sync(&mut transaction, entity_id, Utc::now()).await?;
            changed_ids.push(entity_id);
        }
        sqlx::query("UPDATE change_history SET undone = 1 WHERE action_id = ?")
            .bind(action_id)
            .execute(&mut *transaction)
            .await
            .map_err(|error| AppError::database("undo-mark", error))?;
        transaction
            .commit()
            .await
            .map_err(|error| AppError::database("undo-commit", error))?;
        self.change_result(changed_ids).await
    }

    pub async fn redo(&self) -> AppResult<ChangeResult> {
        let mut transaction = self
            .pool
            .begin()
            .await
            .map_err(|error| AppError::database("redo-begin", error))?;
        let action_id: Option<String> = sqlx::query_scalar(
            "SELECT action_id FROM change_history WHERE undone = 1 ORDER BY id ASC LIMIT 1",
        )
        .fetch_optional(&mut *transaction)
        .await
        .map_err(|error| AppError::database("redo-read", error))?;
        let Some(action_id) = action_id else {
            transaction
                .rollback()
                .await
                .map_err(|error| AppError::database("redo-empty-rollback", error))?;
            return self.change_result(Vec::new()).await;
        };
        let rows = sqlx::query(
            "SELECT entity_id, after_json FROM change_history WHERE action_id = ? ORDER BY id ASC",
        )
        .bind(&action_id)
        .fetch_all(&mut *transaction)
        .await
        .map_err(|error| AppError::database("redo-group-read", error))?;
        let mut changed_ids = Vec::with_capacity(rows.len());
        for row in rows {
            let entity_id = parse_uuid(row.get::<&str, _>("entity_id"), "redo-entity")?;
            let after_json: String = row.get("after_json");
            apply_snapshot(&mut transaction, entity_id, Some(&after_json), false).await?;
            reconcile_history_sync(&mut transaction, entity_id, Utc::now()).await?;
            changed_ids.push(entity_id);
        }
        sqlx::query("UPDATE change_history SET undone = 0 WHERE action_id = ?")
            .bind(action_id)
            .execute(&mut *transaction)
            .await
            .map_err(|error| AppError::database("redo-mark", error))?;
        transaction
            .commit()
            .await
            .map_err(|error| AppError::database("redo-commit", error))?;
        self.change_result(changed_ids).await
    }

    pub(super) async fn change_result(&self, changed_ids: Vec<Uuid>) -> AppResult<ChangeResult> {
        let undo_available: i64 =
            sqlx::query_scalar("SELECT EXISTS(SELECT 1 FROM change_history WHERE undone = 0)")
                .fetch_one(&self.pool)
                .await
                .map_err(|error| AppError::database("undo-availability", error))?;
        let redo_available: i64 =
            sqlx::query_scalar("SELECT EXISTS(SELECT 1 FROM change_history WHERE undone = 1)")
                .fetch_one(&self.pool)
                .await
                .map_err(|error| AppError::database("redo-availability", error))?;
        Ok(ChangeResult {
            changed_ids,
            undo_available: undo_available != 0,
            redo_available: redo_available != 0,
        })
    }

    pub async fn active_focus(&self) -> AppResult<Option<FocusRecord>> {
        let row = sqlx::query(
            "SELECT * FROM focus_sessions WHERE ended_at_utc IS NULL ORDER BY started_at_utc DESC LIMIT 1",
        )
        .fetch_optional(&self.pool)
        .await
        .map_err(|error| AppError::database("focus-read", error))?;
        row.map(|row| {
            Ok(FocusRecord {
                id: parse_uuid(row.get::<&str, _>("id"), "focus-id")?,
                schedule_item_id: row
                    .get::<Option<String>, _>("schedule_item_id")
                    .map(|value| parse_uuid(&value, "focus-schedule-id"))
                    .transpose()?,
                phase: FocusPhase::try_from(row.get::<&str, _>("phase"))?,
                previous_phase: row
                    .get::<Option<String>, _>("previous_phase")
                    .map(|value| FocusPhase::try_from(value.as_str()))
                    .transpose()?,
                started_at: parse_datetime(row.get::<&str, _>("started_at_utc"), "focus-start")?,
                accumulated_seconds: row.get::<i64, _>("accumulated_seconds").max(0) as u64,
                cycle: row.get::<i64, _>("cycle").max(0) as u32,
            })
        })
        .transpose()
    }

    pub async fn insert_focus(&self, record: &FocusRecord) -> AppResult<()> {
        let mut transaction = self
            .pool
            .begin()
            .await
            .map_err(|error| AppError::database("focus-insert-begin", error))?;
        sqlx::query(
            r#"INSERT INTO focus_sessions(
                id, schedule_item_id, phase, previous_phase, started_at_utc, accumulated_seconds, cycle
            ) VALUES (?, ?, ?, ?, ?, ?, ?)"#,
        )
        .bind(record.id.to_string())
        .bind(record.schedule_item_id.map(|value| value.to_string()))
        .bind(record.phase.as_str())
        .bind(record.previous_phase.map(FocusPhase::as_str))
        .bind(timestamp(record.started_at))
        .bind(record.accumulated_seconds as i64)
        .bind(i64::from(record.cycle))
        .execute(&mut *transaction)
        .await
        .map_err(|error| AppError::database("focus-insert", error))?;
        insert_focus_history(
            &mut transaction,
            record,
            "start",
            None,
            Some(record.phase),
            0,
            record.started_at,
        )
        .await?;
        transaction
            .commit()
            .await
            .map_err(|error| AppError::database("focus-insert-commit", error))
    }

    pub async fn update_focus(
        &self,
        record: &FocusRecord,
        event: &'static str,
        elapsed_seconds: u64,
    ) -> AppResult<()> {
        let mut transaction = self
            .pool
            .begin()
            .await
            .map_err(|error| AppError::database("focus-update-begin", error))?;
        let previous =
            sqlx::query("SELECT phase FROM focus_sessions WHERE id = ? AND ended_at_utc IS NULL")
                .bind(record.id.to_string())
                .fetch_one(&mut *transaction)
                .await
                .map_err(|error| AppError::database("focus-update-before", error))?;
        let previous_phase = FocusPhase::try_from(previous.get::<&str, _>("phase"))?;
        sqlx::query(
            "UPDATE focus_sessions SET phase = ?, previous_phase = ?, started_at_utc = ?, accumulated_seconds = ?, cycle = ? WHERE id = ? AND ended_at_utc IS NULL",
        )
        .bind(record.phase.as_str())
        .bind(record.previous_phase.map(FocusPhase::as_str))
        .bind(timestamp(record.started_at))
        .bind(record.accumulated_seconds as i64)
        .bind(i64::from(record.cycle))
        .bind(record.id.to_string())
        .execute(&mut *transaction)
        .await
        .map_err(|error| AppError::database("focus-update", error))?;
        insert_focus_history(
            &mut transaction,
            record,
            event,
            Some(previous_phase),
            Some(record.phase),
            elapsed_seconds,
            record.started_at,
        )
        .await?;
        transaction
            .commit()
            .await
            .map_err(|error| AppError::database("focus-update-commit", error))
    }

    pub async fn end_focus(
        &self,
        id: Uuid,
        now: DateTime<Utc>,
        elapsed_seconds: u64,
    ) -> AppResult<()> {
        let mut transaction = self
            .pool
            .begin()
            .await
            .map_err(|error| AppError::database("focus-end-begin", error))?;
        let previous =
            sqlx::query("SELECT * FROM focus_sessions WHERE id = ? AND ended_at_utc IS NULL")
                .bind(id.to_string())
                .fetch_one(&mut *transaction)
                .await
                .map_err(|error| AppError::database("focus-end-before", error))?;
        let previous_phase = FocusPhase::try_from(previous.get::<&str, _>("phase"))?;
        let record = FocusRecord {
            id,
            schedule_item_id: previous
                .get::<Option<String>, _>("schedule_item_id")
                .map(|value| parse_uuid(&value, "focus-end-schedule"))
                .transpose()?,
            phase: previous_phase,
            previous_phase: None,
            started_at: now,
            accumulated_seconds: previous.get::<i64, _>("accumulated_seconds").max(0) as u64,
            cycle: previous.get::<i64, _>("cycle").max(0) as u32,
        };
        sqlx::query(
            "UPDATE focus_sessions SET ended_at_utc = ? WHERE id = ? AND ended_at_utc IS NULL",
        )
        .bind(timestamp(now))
        .bind(id.to_string())
        .execute(&mut *transaction)
        .await
        .map_err(|error| AppError::database("focus-end", error))?;
        insert_focus_history(
            &mut transaction,
            &record,
            "stop",
            Some(previous_phase),
            None,
            elapsed_seconds,
            now,
        )
        .await?;
        transaction
            .commit()
            .await
            .map_err(|error| AppError::database("focus-end-commit", error))
    }

    pub async fn focus_history(
        &self,
        start_utc: DateTime<Utc>,
        end_utc: DateTime<Utc>,
    ) -> AppResult<FocusHistoryReport> {
        let work_seconds: i64 = sqlx::query_scalar(
            "SELECT COALESCE(SUM(elapsed_seconds), 0) FROM focus_history WHERE occurred_at_utc >= ? AND occurred_at_utc < ? AND from_phase = 'working'",
        )
        .bind(timestamp(start_utc))
        .bind(timestamp(end_utc))
        .fetch_one(&self.pool)
        .await
        .map_err(|error| AppError::database("focus-history-total", error))?;
        let rows = sqlx::query(
            "SELECT * FROM focus_history WHERE occurred_at_utc >= ? AND occurred_at_utc < ? ORDER BY occurred_at_utc DESC, id DESC LIMIT 100",
        )
        .bind(timestamp(start_utc))
        .bind(timestamp(end_utc))
        .fetch_all(&self.pool)
        .await
        .map_err(|error| AppError::database("focus-history-list", error))?;
        let entries = rows
            .iter()
            .map(|row| {
                Ok(FocusHistoryItem {
                    id: parse_uuid(row.get("id"), "focus-history-id")?,
                    session_id: parse_uuid(row.get("session_id"), "focus-history-session")?,
                    schedule_item_id: row
                        .get::<Option<String>, _>("schedule_item_id")
                        .map(|value| parse_uuid(&value, "focus-history-schedule"))
                        .transpose()?,
                    event: row.get("event"),
                    from_phase: row
                        .get::<Option<String>, _>("from_phase")
                        .map(|value| FocusPhase::try_from(value.as_str()))
                        .transpose()?,
                    to_phase: row
                        .get::<Option<String>, _>("to_phase")
                        .map(|value| FocusPhase::try_from(value.as_str()))
                        .transpose()?,
                    elapsed_seconds: row.get::<i64, _>("elapsed_seconds").max(0) as u64,
                    occurred_at: parse_datetime(
                        row.get("occurred_at_utc"),
                        "focus-history-occurred",
                    )?,
                })
            })
            .collect::<AppResult<Vec<_>>>()?;
        Ok(FocusHistoryReport {
            work_seconds: work_seconds.max(0) as u64,
            entries,
        })
    }

    pub async fn focus_work_seconds(&self, schedule_item_id: Uuid) -> AppResult<u64> {
        let work_seconds: i64 = sqlx::query_scalar(
            "SELECT COALESCE(SUM(elapsed_seconds), 0) FROM focus_history WHERE schedule_item_id = ? AND from_phase = 'working'",
        )
        .bind(schedule_item_id.to_string())
        .fetch_one(&self.pool)
        .await
        .map_err(|error| AppError::database("focus-schedule-total", error))?;
        Ok(work_seconds.max(0) as u64)
    }

    pub async fn sync_summary(&self) -> AppResult<SyncSummary> {
        let pending_count: i64 =
            sqlx::query_scalar("SELECT COUNT(*) FROM sync_outbox WHERE completed_at_utc IS NULL")
                .fetch_one(&self.pool)
                .await
                .map_err(|error| AppError::database("sync-pending", error))?;
        let conflict_count: i64 =
            sqlx::query_scalar("SELECT COUNT(*) FROM sync_conflicts WHERE status = 'unresolved'")
                .fetch_one(&self.pool)
                .await
                .map_err(|error| AppError::database("sync-conflicts", error))?;
        let account_status: Option<String> = sqlx::query_scalar(
            "SELECT status FROM google_accounts ORDER BY created_at_utc LIMIT 1",
        )
        .fetch_optional(&self.pool)
        .await
        .map_err(|error| AppError::database("sync-account", error))?;
        let state = if conflict_count > 0 {
            SyncSummaryState::Conflict
        } else if account_status.as_deref() == Some("auth_required") {
            SyncSummaryState::AuthRequired
        } else if account_status.as_deref() != Some("connected") {
            SyncSummaryState::Disconnected
        } else if pending_count > 0 {
            SyncSummaryState::Pending
        } else {
            SyncSummaryState::Synced
        };
        let next_retry: Option<String> = sqlx::query_scalar(
            "SELECT MIN(next_attempt_at_utc) FROM sync_outbox WHERE completed_at_utc IS NULL AND attempt_count > 0",
        )
        .fetch_one(&self.pool)
        .await
        .map_err(|error| AppError::database("sync-retry", error))?;
        Ok(SyncSummary {
            state,
            pending_count: pending_count.max(0) as u64,
            conflict_count: conflict_count.max(0) as u64,
            last_completed_at: None,
            next_retry_at: next_retry
                .as_deref()
                .map(|value| parse_datetime(value, "sync-retry-date"))
                .transpose()?,
        })
    }

    pub async fn diagnostics(&self, app_version: &str) -> AppResult<DiagnosticsSnapshot> {
        let schedule_count: i64 =
            sqlx::query_scalar("SELECT COUNT(*) FROM schedule_items WHERE deleted_at_utc IS NULL")
                .fetch_one(&self.pool)
                .await
                .map_err(|error| AppError::database("diagnostics-schedules", error))?;
        let deleted_count: i64 = sqlx::query_scalar(
            "SELECT COUNT(*) FROM schedule_items WHERE deleted_at_utc IS NOT NULL",
        )
        .fetch_one(&self.pool)
        .await
        .map_err(|error| AppError::database("diagnostics-deleted", error))?;
        let outbox_count: i64 =
            sqlx::query_scalar("SELECT COUNT(*) FROM sync_outbox WHERE completed_at_utc IS NULL")
                .fetch_one(&self.pool)
                .await
                .map_err(|error| AppError::database("diagnostics-outbox", error))?;
        let conflict_count: i64 =
            sqlx::query_scalar("SELECT COUNT(*) FROM sync_conflicts WHERE status = 'unresolved'")
                .fetch_one(&self.pool)
                .await
                .map_err(|error| AppError::database("diagnostics-conflicts", error))?;
        let last_backup: Option<String> =
            sqlx::query_scalar("SELECT MAX(created_at_utc) FROM backup_history WHERE verified = 1")
                .fetch_one(&self.pool)
                .await
                .map_err(|error| AppError::database("diagnostics-backup", error))?;
        self.integrity_check().await?;
        Ok(DiagnosticsSnapshot {
            app_version: app_version.into(),
            schema_version: 10,
            database_state: "ready",
            schedule_count: schedule_count.max(0) as u64,
            deleted_count: deleted_count.max(0) as u64,
            outbox_count: outbox_count.max(0) as u64,
            conflict_count: conflict_count.max(0) as u64,
            last_backup_at: last_backup
                .as_deref()
                .map(|value| parse_datetime(value, "diagnostics-backup-date"))
                .transpose()?,
            integrity: "ok",
        })
    }
}

pub(super) async fn insert_schedule(
    transaction: &mut Transaction<'_, Sqlite>,
    schedule: &Schedule,
    now: DateTime<Utc>,
) -> AppResult<()> {
    sqlx::query(
        r#"INSERT INTO schedule_items(
          id, title, description, location, start_at_utc, end_at_utc, time_zone,
          all_day, status, project, category, tags_json, color, sync_status,
          version, deleted_at_utc, created_at_utc, updated_at_utc, priority, recurrence_rule,
          recurrence_exdates_json,
          start_notification_minutes, end_notification_minutes,
          all_day_start_date, all_day_end_date_exclusive
        ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)"#,
    )
    .bind(schedule.id.to_string())
    .bind(&schedule.draft.title)
    .bind(&schedule.draft.description)
    .bind(&schedule.draft.location)
    .bind(timestamp(schedule.draft.start_utc))
    .bind(timestamp(schedule.draft.end_utc))
    .bind(&schedule.draft.timezone_id)
    .bind(schedule.draft.all_day)
    .bind(schedule.draft.status.as_str())
    .bind(&schedule.draft.project)
    .bind(&schedule.draft.category)
    .bind(
        serde_json::to_string(&schedule.draft.tags)
            .map_err(|error| AppError::database("tags-encode", error))?,
    )
    .bind(&schedule.draft.color)
    .bind(schedule.sync_status.as_str())
    .bind(schedule.version as i64)
    .bind(schedule.deleted_at.map(timestamp))
    .bind(timestamp(now))
    .bind(timestamp(now))
    .bind(schedule.draft.priority.as_str())
    .bind(&schedule.draft.recurrence_rule)
    .bind(
        serde_json::to_string(&schedule.draft.recurrence_exdates)
            .map_err(|error| AppError::database("recurrence-exdates-encode", error))?,
    )
    .bind(schedule.draft.start_notification_minutes.map(i64::from))
    .bind(schedule.draft.end_notification_minutes.map(i64::from))
    .bind(
        schedule
            .draft
            .all_day_start_date
            .map(|value| value.to_string()),
    )
    .bind(
        schedule
            .draft
            .all_day_end_date_exclusive
            .map(|value| value.to_string()),
    )
    .execute(&mut **transaction)
    .await
    .map_err(|error| AppError::database("schedule-insert", error))?;
    Ok(())
}

pub(super) async fn update_schedule_row(
    transaction: &mut Transaction<'_, Sqlite>,
    schedule: &Schedule,
    now: DateTime<Utc>,
) -> AppResult<()> {
    let result = sqlx::query(
        r#"UPDATE schedule_items SET
          title = ?, description = ?, location = ?, start_at_utc = ?, end_at_utc = ?,
          time_zone = ?, all_day = ?, status = ?, project = ?, category = ?, tags_json = ?,
          color = ?, sync_status = ?, version = ?, deleted_at_utc = ?, updated_at_utc = ?,
          priority = ?, recurrence_rule = ?, recurrence_exdates_json = ?, start_notification_minutes = ?,
          end_notification_minutes = ?, all_day_start_date = ?, all_day_end_date_exclusive = ?
        WHERE id = ?"#,
    )
    .bind(&schedule.draft.title)
    .bind(&schedule.draft.description)
    .bind(&schedule.draft.location)
    .bind(timestamp(schedule.draft.start_utc))
    .bind(timestamp(schedule.draft.end_utc))
    .bind(&schedule.draft.timezone_id)
    .bind(schedule.draft.all_day)
    .bind(schedule.draft.status.as_str())
    .bind(&schedule.draft.project)
    .bind(&schedule.draft.category)
    .bind(
        serde_json::to_string(&schedule.draft.tags)
            .map_err(|error| AppError::database("tags-update-encode", error))?,
    )
    .bind(&schedule.draft.color)
    .bind(schedule.sync_status.as_str())
    .bind(schedule.version as i64)
    .bind(schedule.deleted_at.map(timestamp))
    .bind(timestamp(now))
    .bind(schedule.draft.priority.as_str())
    .bind(&schedule.draft.recurrence_rule)
    .bind(
        serde_json::to_string(&schedule.draft.recurrence_exdates)
            .map_err(|error| AppError::database("recurrence-exdates-update-encode", error))?,
    )
    .bind(schedule.draft.start_notification_minutes.map(i64::from))
    .bind(schedule.draft.end_notification_minutes.map(i64::from))
    .bind(schedule.draft.all_day_start_date.map(|value| value.to_string()))
    .bind(
        schedule
            .draft
            .all_day_end_date_exclusive
            .map(|value| value.to_string()),
    )
    .bind(schedule.id.to_string())
    .execute(&mut **transaction)
    .await
    .map_err(|error| AppError::database("schedule-update", error))?;
    if result.rows_affected() == 1 {
        Ok(())
    } else {
        Err(not_found())
    }
}

async fn fetch_schedule(
    transaction: &mut Transaction<'_, Sqlite>,
    id: Uuid,
) -> AppResult<Schedule> {
    let row = sqlx::query("SELECT * FROM schedule_items WHERE id = ?")
        .bind(id.to_string())
        .fetch_optional(&mut **transaction)
        .await
        .map_err(|error| AppError::database("schedule-transaction-read", error))?
        .ok_or_else(not_found)?;
    row_to_schedule(&row)
}

pub(super) async fn insert_history(
    transaction: &mut Transaction<'_, Sqlite>,
    action_id: Uuid,
    action: &'static str,
    before: Option<&Schedule>,
    after: Option<&Schedule>,
    now: DateTime<Utc>,
) -> AppResult<()> {
    let entity_id = after.or(before).map(|item| item.id).ok_or_else(|| {
        AppError::database("history-entity", "before and after cannot both be empty")
    })?;
    sqlx::query(
        "INSERT INTO change_history(action_id, entity_type, entity_id, action, before_json, after_json, created_at_utc) VALUES (?, 'schedule', ?, ?, ?, ?, ?)",
    )
    .bind(action_id.to_string())
    .bind(entity_id.to_string())
    .bind(action)
    .bind(before.map(serde_json::to_string).transpose().map_err(|error| AppError::database("history-before", error))?)
    .bind(after.map(serde_json::to_string).transpose().map_err(|error| AppError::database("history-after", error))?)
    .bind(timestamp(now))
    .execute(&mut **transaction)
    .await
    .map_err(|error| AppError::database("history-insert", error))?;
    Ok(())
}

async fn insert_focus_history(
    transaction: &mut Transaction<'_, Sqlite>,
    record: &FocusRecord,
    event: &'static str,
    from_phase: Option<FocusPhase>,
    to_phase: Option<FocusPhase>,
    elapsed_seconds: u64,
    occurred_at: DateTime<Utc>,
) -> AppResult<()> {
    sqlx::query(
        "INSERT INTO focus_history(id, session_id, schedule_item_id, event, from_phase, to_phase, elapsed_seconds, occurred_at_utc) VALUES (?, ?, ?, ?, ?, ?, ?, ?)",
    )
    .bind(Uuid::new_v4().to_string())
    .bind(record.id.to_string())
    .bind(record.schedule_item_id.map(|value| value.to_string()))
    .bind(event)
    .bind(from_phase.map(FocusPhase::as_str))
    .bind(to_phase.map(FocusPhase::as_str))
    .bind(elapsed_seconds as i64)
    .bind(timestamp(occurred_at))
    .execute(&mut **transaction)
    .await
    .map_err(|error| AppError::database("focus-history-insert", error))?;
    Ok(())
}

async fn update_single_occurrence(
    transaction: &mut Transaction<'_, Sqlite>,
    before: &Schedule,
    mut exception_draft: ScheduleDraft,
    occurrence_start: DateTime<Utc>,
    has_sync_target: bool,
) -> AppResult<Schedule> {
    let now = Utc::now();
    let action_id = Uuid::new_v4();
    let mut master = before.clone();
    master.version += 1;
    master.sync_status = pending_status(before, has_sync_target);
    master.draft.recurrence_exdates.push(occurrence_start);
    master.draft.recurrence_exdates.sort();
    master.draft.recurrence_exdates.dedup();
    update_schedule_row(transaction, &master, now).await?;
    insert_history(
        transaction,
        action_id,
        "update",
        Some(before),
        Some(&master),
        now,
    )
    .await?;

    exception_draft.recurrence_rule = None;
    exception_draft.recurrence_exdates.clear();
    let exception = Schedule {
        id: Uuid::new_v4(),
        draft: exception_draft,
        sync_status: if has_sync_target {
            SyncStatus::Pending
        } else {
            SyncStatus::LocalOnly
        },
        version: 0,
        deleted_at: None,
    };
    insert_schedule(transaction, &exception, now).await?;
    sqlx::query(
        "UPDATE schedule_items SET recurrence_series_id = ?, recurrence_original_start_utc = ? WHERE id = ?",
    )
    .bind(before.id.to_string())
    .bind(timestamp(occurrence_start))
    .bind(exception.id.to_string())
    .execute(&mut **transaction)
    .await
    .map_err(|error| AppError::database("occurrence-exception-link", error))?;
    insert_history(
        transaction,
        action_id,
        "create",
        None,
        Some(&exception),
        now,
    )
    .await?;
    if has_sync_target || !matches!(before.sync_status, SyncStatus::LocalOnly) {
        enqueue_outbox(transaction, &master, "update", now).await?;
        enqueue_outbox(transaction, &exception, "create", now).await?;
    }
    Ok(exception)
}

async fn split_recurring_series(
    transaction: &mut Transaction<'_, Sqlite>,
    before: &Schedule,
    mut following_draft: ScheduleDraft,
    occurrence_start: DateTime<Utc>,
    has_sync_target: bool,
) -> AppResult<Schedule> {
    let now = Utc::now();
    let action_id = Uuid::new_v4();
    let mut previous = before.clone();
    previous.version += 1;
    previous.sync_status = pending_status(before, has_sync_target);
    previous.draft.recurrence_rule = Some(rule_ending_before(
        before
            .draft
            .recurrence_rule
            .as_deref()
            .ok_or_else(|| AppError::database("recurrence-split-rule", "missing"))?,
        occurrence_start,
    ));
    previous
        .draft
        .recurrence_exdates
        .retain(|value| *value < occurrence_start);
    update_schedule_row(transaction, &previous, now).await?;
    insert_history(
        transaction,
        action_id,
        "update",
        Some(before),
        Some(&previous),
        now,
    )
    .await?;

    if following_draft.recurrence_rule.is_none() {
        following_draft.recurrence_rule = before.draft.recurrence_rule.clone();
    }
    following_draft
        .recurrence_exdates
        .retain(|value| *value >= occurrence_start);
    let following = Schedule {
        id: Uuid::new_v4(),
        draft: following_draft,
        sync_status: if has_sync_target {
            SyncStatus::Pending
        } else {
            SyncStatus::LocalOnly
        },
        version: 0,
        deleted_at: None,
    };
    insert_schedule(transaction, &following, now).await?;
    insert_history(
        transaction,
        action_id,
        "create",
        None,
        Some(&following),
        now,
    )
    .await?;
    if has_sync_target || !matches!(before.sync_status, SyncStatus::LocalOnly) {
        enqueue_outbox(transaction, &previous, "update", now).await?;
        enqueue_outbox(transaction, &following, "create", now).await?;
    }
    Ok(following)
}

fn pending_status(before: &Schedule, has_sync_target: bool) -> SyncStatus {
    if matches!(before.sync_status, SyncStatus::LocalOnly) && !has_sync_target {
        SyncStatus::LocalOnly
    } else {
        SyncStatus::Pending
    }
}

fn rule_ending_before(rule: &str, occurrence_start: DateTime<Utc>) -> String {
    let mut parts = rule
        .split(';')
        .filter(|part| !part.starts_with("UNTIL=") && !part.starts_with("COUNT="))
        .map(str::to_owned)
        .collect::<Vec<_>>();
    let until = occurrence_start - chrono::Duration::seconds(1);
    parts.push(format!("UNTIL={}", until.format("%Y%m%dT%H%M%SZ")));
    parts.join(";")
}

pub(super) async fn has_default_write_target(
    transaction: &mut Transaction<'_, Sqlite>,
) -> AppResult<bool> {
    sqlx::query_scalar(
        "SELECT EXISTS(SELECT 1 FROM google_calendars c JOIN google_accounts a ON a.id = c.account_id WHERE c.default_write_target = 1 AND c.selected = 1 AND c.access_role IN ('owner', 'writer') AND a.status = 'connected')",
    )
    .fetch_one(&mut **transaction)
    .await
    .map_err(|error| AppError::database("sync-target-check", error))
}

pub(super) async fn enqueue_outbox(
    transaction: &mut Transaction<'_, Sqlite>,
    schedule: &Schedule,
    operation: &'static str,
    now: DateTime<Utc>,
) -> AppResult<()> {
    let idempotency_key = format!("schedule:{}:{}:{operation}", schedule.id, schedule.version);
    sqlx::query(
        "INSERT OR IGNORE INTO sync_outbox(id, entity_type, entity_id, entity_version, operation, idempotency_key, attempt_count, next_attempt_at_utc, created_at_utc) VALUES (?, 'schedule', ?, ?, ?, ?, 0, ?, ?)",
    )
    .bind(Uuid::new_v4().to_string())
    .bind(schedule.id.to_string())
    .bind(schedule.version as i64)
    .bind(operation)
    .bind(idempotency_key)
    .bind(timestamp(now))
    .bind(timestamp(now))
    .execute(&mut **transaction)
    .await
    .map_err(|error| AppError::database("sync-outbox-enqueue", error))?;
    Ok(())
}

async fn apply_snapshot(
    transaction: &mut Transaction<'_, Sqlite>,
    entity_id: Uuid,
    snapshot_json: Option<&str>,
    undo_create: bool,
) -> AppResult<()> {
    if let Some(snapshot_json) = snapshot_json {
        let mut schedule: Schedule = serde_json::from_str(snapshot_json)
            .map_err(|error| AppError::database("history-decode", error))?;
        let current_version: i64 =
            sqlx::query_scalar("SELECT version FROM schedule_items WHERE id = ?")
                .bind(entity_id.to_string())
                .fetch_one(&mut **transaction)
                .await
                .map_err(|error| AppError::database("history-current-version", error))?;
        schedule.version = u64::try_from(current_version)
            .map_err(|error| AppError::database("history-current-version-range", error))?
            .saturating_add(1);
        update_schedule_row(transaction, &schedule, Utc::now()).await
    } else if undo_create {
        let result = sqlx::query(
            "UPDATE schedule_items SET deleted_at_utc = ?, version = version + 1, updated_at_utc = ? WHERE id = ?",
        )
        .bind(timestamp(Utc::now()))
        .bind(timestamp(Utc::now()))
        .bind(entity_id.to_string())
        .execute(&mut **transaction)
        .await
        .map_err(|error| AppError::database("history-remove-created", error))?;
        if result.rows_affected() == 1 {
            Ok(())
        } else {
            Err(not_found())
        }
    } else {
        Err(AppError::database(
            "history-empty-snapshot",
            "missing snapshot",
        ))
    }
}

async fn reconcile_history_sync(
    transaction: &mut Transaction<'_, Sqlite>,
    entity_id: Uuid,
    now: DateTime<Utc>,
) -> AppResult<()> {
    sqlx::query(
        "UPDATE sync_outbox SET completed_at_utc = ?, error_category = 'superseded' WHERE entity_id = ? AND completed_at_utc IS NULL",
    )
    .bind(timestamp(now))
    .bind(entity_id.to_string())
    .execute(&mut **transaction)
    .await
    .map_err(|error| AppError::database("history-outbox-supersede", error))?;

    let mapped: bool =
        sqlx::query_scalar("SELECT EXISTS(SELECT 1 FROM sync_mappings WHERE schedule_item_id = ?)")
            .bind(entity_id.to_string())
            .fetch_one(&mut **transaction)
            .await
            .map_err(|error| AppError::database("history-sync-mapping", error))?;
    let has_sync_target = mapped || has_default_write_target(transaction).await?;
    let mut schedule = fetch_schedule(transaction, entity_id).await?;
    if has_sync_target && !matches!(schedule.sync_status, SyncStatus::ReadOnly) {
        schedule.sync_status = SyncStatus::Pending;
        update_schedule_row(transaction, &schedule, now).await?;
        let operation = if schedule.deleted_at.is_some() {
            "delete"
        } else if mapped {
            "update"
        } else {
            "create"
        };
        enqueue_outbox(transaction, &schedule, operation, now).await?;
    } else if !matches!(schedule.sync_status, SyncStatus::ReadOnly) {
        schedule.sync_status = SyncStatus::LocalOnly;
        update_schedule_row(transaction, &schedule, now).await?;
    }
    Ok(())
}

pub(super) fn row_to_schedule(row: &SqliteRow) -> AppResult<Schedule> {
    let tags: Vec<String> = serde_json::from_str(row.get::<&str, _>("tags_json"))
        .map_err(|error| AppError::database("tags-decode", error))?;
    Ok(Schedule {
        id: parse_uuid(row.get::<&str, _>("id"), "schedule-id")?,
        draft: ScheduleDraft {
            title: row.get("title"),
            description: row.get("description"),
            location: row.get("location"),
            start_utc: parse_datetime(row.get::<&str, _>("start_at_utc"), "schedule-start")?,
            end_utc: parse_datetime(row.get::<&str, _>("end_at_utc"), "schedule-end")?,
            timezone_id: row.get("time_zone"),
            all_day: row.get("all_day"),
            all_day_start_date: row
                .get::<Option<String>, _>("all_day_start_date")
                .as_deref()
                .map(|value| parse_date(value, "schedule-all-day-start"))
                .transpose()?,
            all_day_end_date_exclusive: row
                .get::<Option<String>, _>("all_day_end_date_exclusive")
                .as_deref()
                .map(|value| parse_date(value, "schedule-all-day-end"))
                .transpose()?,
            status: ScheduleStatus::try_from(row.get::<&str, _>("status"))?,
            project: row.get("project"),
            category: row.get("category"),
            tags,
            color: row.get("color"),
            priority: Priority::try_from(row.get::<&str, _>("priority"))?,
            recurrence_rule: row.get("recurrence_rule"),
            recurrence_exdates: serde_json::from_str(row.get("recurrence_exdates_json"))
                .map_err(|error| AppError::database("recurrence-exdates-decode", error))?,
            start_notification_minutes: row
                .get::<Option<i64>, _>("start_notification_minutes")
                .map(|value| value.max(0) as u16),
            end_notification_minutes: row
                .get::<Option<i64>, _>("end_notification_minutes")
                .map(|value| value.max(0) as u16),
        },
        sync_status: SyncStatus::try_from(row.get::<&str, _>("sync_status"))?,
        version: row.get::<i64, _>("version").max(0) as u64,
        deleted_at: row
            .get::<Option<String>, _>("deleted_at_utc")
            .as_deref()
            .map(|value| parse_datetime(value, "schedule-deleted"))
            .transpose()?,
    })
}

fn timestamp(value: DateTime<Utc>) -> String {
    value.to_rfc3339_opts(SecondsFormat::Millis, true)
}

const fn priority_rank(value: Priority) -> u8 {
    match value {
        Priority::Low => 0,
        Priority::Normal => 1,
        Priority::High => 2,
        Priority::Urgent => 3,
    }
}

fn fts_query(value: &str) -> AppResult<String> {
    let terms = value
        .split_whitespace()
        .take(20)
        .map(|term| term.trim_matches(|character: char| !character.is_alphanumeric()))
        .filter(|term| !term.is_empty())
        .map(|term| format!("\"{}\"*", term.replace('"', "\"\"")))
        .collect::<Vec<_>>();
    if terms.is_empty() {
        return Err(AppError::Validation {
            message: "検索語を入力してください。".into(),
            recovery: "文字を1つ以上入力するか、検索欄を空に戻してください。".into(),
        });
    }
    Ok(terms.join(" AND "))
}

fn supports_trigram_search(value: &str) -> bool {
    value
        .split_whitespace()
        .map(|term| term.trim_matches(|character: char| !character.is_alphanumeric()))
        .filter(|term| !term.is_empty())
        .all(|term| term.chars().count() >= 3)
}

fn normalize_plain_search(value: &str) -> String {
    value
        .trim_matches(|character: char| !character.is_alphanumeric())
        .to_owned()
}

fn escape_like(value: &str) -> String {
    value
        .replace('\\', "\\\\")
        .replace('%', "\\%")
        .replace('_', "\\_")
}

fn parse_datetime(value: &str, context: &'static str) -> AppResult<DateTime<Utc>> {
    DateTime::parse_from_rfc3339(value)
        .map(|value| value.with_timezone(&Utc))
        .map_err(|error| AppError::database(context, error))
}

fn parse_date(value: &str, context: &'static str) -> AppResult<chrono::NaiveDate> {
    chrono::NaiveDate::parse_from_str(value, "%Y-%m-%d")
        .map_err(|error| AppError::database(context, error))
}

fn parse_uuid(value: &str, context: &'static str) -> AppResult<Uuid> {
    Uuid::parse_str(value).map_err(|error| AppError::database(context, error))
}

fn not_found() -> AppError {
    AppError::NotFound {
        message: "予定が見つかりません。".into(),
        recovery: "一覧を更新してください。別の画面で削除された可能性があります。".into(),
    }
}

fn version_conflict() -> AppError {
    AppError::Conflict {
        message: "予定が別の操作で更新されています。".into(),
        recovery:
            "最新の内容を確認し、変更を適用し直してください。ローカルの入力は保持されています。"
                .into(),
    }
}

#[cfg(test)]
mod tests {
    use chrono::{Duration, TimeZone};

    use super::*;

    fn draft(title: &str) -> ScheduleDraft {
        ScheduleDraft {
            title: title.into(),
            description: String::new(),
            location: String::new(),
            start_utc: Utc.with_ymd_and_hms(2026, 7, 20, 0, 0, 0).unwrap(),
            end_utc: Utc.with_ymd_and_hms(2026, 7, 20, 1, 0, 0).unwrap(),
            timezone_id: "Asia/Tokyo".into(),
            all_day: false,
            all_day_start_date: None,
            all_day_end_date_exclusive: None,
            status: ScheduleStatus::Scheduled,
            project: String::new(),
            category: String::new(),
            tags: vec![],
            color: "#6F96F4".into(),
            priority: Priority::Normal,
            recurrence_rule: None,
            recurrence_exdates: Vec::new(),
            start_notification_minutes: None,
            end_notification_minutes: None,
        }
    }

    async fn connect_default_calendar(database: &Database) {
        let now = Utc::now().to_rfc3339();
        let account_id = Uuid::new_v4();
        sqlx::query("INSERT INTO google_accounts(id, display_label, scopes_json, status, created_at_utc, updated_at_utc) VALUES (?, 'Test', '[]', 'connected', ?, ?)")
            .bind(account_id.to_string())
            .bind(&now)
            .bind(&now)
            .execute(&database.pool)
            .await
            .unwrap();
        sqlx::query("INSERT INTO google_calendars(id, account_id, remote_calendar_id, display_name, color, time_zone, access_role, selected, default_write_target) VALUES (?, ?, 'primary', 'Primary', '#6F96F4', 'Asia/Tokyo', 'owner', 1, 1)")
            .bind(Uuid::new_v4().to_string())
            .bind(account_id.to_string())
            .execute(&database.pool)
            .await
            .unwrap();
    }

    #[tokio::test]
    async fn migration_crud_and_history_are_atomic() {
        let database = Database::open_memory().await.unwrap();
        let created = database.create_schedule(draft("初期")).await.unwrap();
        let updated = database
            .update_schedule(created.id, created.version, draft("更新"))
            .await
            .unwrap();
        assert_eq!(updated.version, 1);
        assert_eq!(
            database.schedule(created.id).await.unwrap().draft.title,
            "更新"
        );

        database.undo().await.unwrap();
        assert_eq!(
            database.schedule(created.id).await.unwrap().draft.title,
            "初期"
        );
        database.redo().await.unwrap();
        assert_eq!(
            database.schedule(created.id).await.unwrap().draft.title,
            "更新"
        );
    }

    #[tokio::test]
    async fn undo_supersedes_stale_delete_outbox_and_enqueues_compensating_update() {
        let database = Database::open_memory().await.unwrap();
        connect_default_calendar(&database).await;
        let created = database
            .create_schedule(draft("同期済み予定"))
            .await
            .unwrap();
        let calendar_id: String =
            sqlx::query_scalar("SELECT id FROM google_calendars WHERE default_write_target = 1")
                .fetch_one(&database.pool)
                .await
                .unwrap();
        sqlx::query("UPDATE sync_outbox SET completed_at_utc = ? WHERE entity_id = ?")
            .bind(Utc::now().to_rfc3339())
            .bind(created.id.to_string())
            .execute(&database.pool)
            .await
            .unwrap();
        sqlx::query(
            "INSERT INTO sync_mappings(schedule_item_id, calendar_id, remote_event_id, etag, base_snapshot_json, base_hash) VALUES (?, ?, 'synthetic-event', 'etag-1', '{}', 'synthetic-hash')",
        )
        .bind(created.id.to_string())
        .bind(calendar_id)
        .execute(&database.pool)
        .await
        .unwrap();
        sqlx::query("UPDATE schedule_items SET sync_status = 'synced' WHERE id = ?")
            .bind(created.id.to_string())
            .execute(&database.pool)
            .await
            .unwrap();

        database
            .delete_schedule_scoped(
                created.id,
                created.version,
                RecurrenceEditScope::Series,
                None,
            )
            .await
            .unwrap();
        database.undo().await.unwrap();

        let restored = database.schedule(created.id).await.unwrap();
        assert!(restored.deleted_at.is_none());
        assert_eq!(restored.version, 2);
        assert_eq!(restored.sync_status, SyncStatus::Pending);
        let pending_delete_count: i64 = sqlx::query_scalar(
            "SELECT COUNT(*) FROM sync_outbox WHERE entity_id = ? AND operation = 'delete' AND completed_at_utc IS NULL",
        )
        .bind(created.id.to_string())
        .fetch_one(&database.pool)
        .await
        .unwrap();
        assert_eq!(pending_delete_count, 0);
        let pending_update_version: i64 = sqlx::query_scalar(
            "SELECT entity_version FROM sync_outbox WHERE entity_id = ? AND operation = 'update' AND completed_at_utc IS NULL",
        )
        .bind(created.id.to_string())
        .fetch_one(&database.pool)
        .await
        .unwrap();
        assert_eq!(pending_update_version, 2);
    }

    #[tokio::test]
    async fn bulk_classification_is_atomic_and_undoes_as_one_action() {
        let database = Database::open_memory().await.unwrap();
        let first = database.create_schedule(draft("一括A")).await.unwrap();
        let second = database.create_schedule(draft("一括B")).await.unwrap();
        let result = database
            .bulk_classify_schedules(
                vec![first.id, second.id, first.id],
                ScheduleClassificationPatch {
                    project: Some(" 新プロジェクト ".into()),
                    category: Some("分類".into()),
                    tags: Some(vec!["重要".into(), "重要".into(), "確認".into()]),
                    color: Some("#123ABC".into()),
                    priority: Some(Priority::Urgent),
                },
            )
            .await
            .unwrap();
        assert_eq!(result.changed_ids.len(), 2);
        for id in [first.id, second.id] {
            let updated = database.schedule(id).await.unwrap();
            assert_eq!(updated.draft.project, "新プロジェクト");
            assert_eq!(updated.draft.category, "分類");
            assert_eq!(updated.draft.tags, vec!["確認", "重要"]);
            assert_eq!(updated.draft.priority, Priority::Urgent);
        }
        let undo = database.undo().await.unwrap();
        assert_eq!(undo.changed_ids.len(), 2);
        assert_eq!(database.schedule(first.id).await.unwrap().draft.project, "");
        assert_eq!(
            database.schedule(second.id).await.unwrap().draft.project,
            ""
        );
    }

    #[tokio::test]
    async fn focus_transitions_and_work_totals_are_persisted_atomically() {
        let database = Database::open_memory().await.unwrap();
        let schedule = database.create_schedule(draft("Focus対象")).await.unwrap();
        let started = Utc.with_ymd_and_hms(2026, 7, 20, 0, 0, 0).unwrap();
        let mut record = FocusRecord {
            id: Uuid::new_v4(),
            schedule_item_id: Some(schedule.id),
            phase: FocusPhase::Working,
            previous_phase: None,
            started_at: started,
            accumulated_seconds: 0,
            cycle: 0,
        };
        database.insert_focus(&record).await.unwrap();
        record.previous_phase = Some(FocusPhase::Working);
        record.phase = FocusPhase::Paused;
        record.started_at = started + Duration::minutes(25);
        database
            .update_focus(&record, "pause", 1_500)
            .await
            .unwrap();
        record.previous_phase = None;
        record.phase = FocusPhase::Working;
        record.started_at = started + Duration::minutes(26);
        database.update_focus(&record, "resume", 0).await.unwrap();
        database
            .end_focus(record.id, started + Duration::minutes(51), 1_500)
            .await
            .unwrap();

        let report = database
            .focus_history(started, started + Duration::days(1))
            .await
            .unwrap();
        assert_eq!(report.work_seconds, 50 * 60);
        assert_eq!(
            database.focus_work_seconds(schedule.id).await.unwrap(),
            50 * 60
        );
        assert_eq!(report.entries.len(), 4);
        assert_eq!(report.entries[0].event, "stop");
        assert!(database.active_focus().await.unwrap().is_none());
    }

    #[tokio::test]
    async fn stale_version_does_not_partially_apply() {
        let database = Database::open_memory().await.unwrap();
        let created = database.create_schedule(draft("初期")).await.unwrap();
        database
            .update_schedule(created.id, created.version, draft("先の変更"))
            .await
            .unwrap();
        assert!(
            database
                .update_schedule(created.id, created.version, draft("古い変更"))
                .await
                .is_err()
        );
        assert_eq!(
            database.schedule(created.id).await.unwrap().draft.title,
            "先の変更"
        );
    }

    #[tokio::test]
    async fn list_uses_half_open_overlap_and_caps_large_pages() {
        let database = Database::open_memory().await.unwrap();
        database.create_schedule(draft("隣接A")).await.unwrap();
        let mut second = draft("隣接B");
        second.start_utc += Duration::hours(1);
        second.end_utc += Duration::hours(1);
        database.create_schedule(second).await.unwrap();
        let (items, total) = database
            .list_schedules(ScheduleQuery {
                start_utc: Utc.with_ymd_and_hms(2026, 7, 20, 1, 0, 0).unwrap(),
                end_utc: Utc.with_ymd_and_hms(2026, 7, 20, 2, 0, 0).unwrap(),
                search: None,
                include_deleted: false,
                limit: 5_000,
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
        assert_eq!(total, 1);
        assert_eq!(items[0].draft.title, "隣接B");
    }

    #[tokio::test]
    async fn full_text_search_finds_all_supported_fields_and_escapes_syntax() {
        let database = Database::open_memory().await.unwrap();
        let mut value = draft("設計レビュー");
        value.description = "次期リリースの確認".into();
        value.location = "会議室A".into();
        value.project = "デスクトップ".into();
        value.category = "品質".into();
        value.tags = vec!["重要".into()];
        database.create_schedule(value).await.unwrap();
        for search in [
            "設計",
            "リリース",
            "会議室",
            "デスクトップ",
            "品質",
            "重要",
            "\"設計",
        ] {
            let (_, total) = database
                .list_schedules(ScheduleQuery {
                    start_utc: Utc.with_ymd_and_hms(2026, 7, 19, 0, 0, 0).unwrap(),
                    end_utc: Utc.with_ymd_and_hms(2026, 7, 21, 0, 0, 0).unwrap(),
                    search: Some(search.into()),
                    include_deleted: false,
                    limit: 100,
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
            assert_eq!(total, 1, "search field: {search}");
        }
    }

    #[tokio::test]
    async fn list_filters_tag_and_priority_without_partial_matches() {
        let database = Database::open_memory().await.unwrap();
        let mut matching = draft("一致");
        matching.tags = vec!["重要".into(), "出荷".into()];
        matching.priority = Priority::Urgent;
        database.create_schedule(matching).await.unwrap();
        let mut other = draft("非一致");
        other.tags = vec!["重要事項".into()];
        other.priority = Priority::Urgent;
        database.create_schedule(other).await.unwrap();

        let (items, total) = database
            .list_schedules(ScheduleQuery {
                start_utc: Utc.with_ymd_and_hms(2026, 7, 19, 0, 0, 0).unwrap(),
                end_utc: Utc.with_ymd_and_hms(2026, 7, 21, 0, 0, 0).unwrap(),
                search: None,
                include_deleted: false,
                limit: 100,
                offset: 0,
                status: None,
                project: None,
                category: None,
                tag: Some("重要".into()),
                priority: Some(Priority::Urgent),
                sync_status: None,
                sync_target: None,
                completion: "all".into(),
                sort_by: "start".into(),
                sort_descending: false,
            })
            .await
            .unwrap();
        assert_eq!(total, 1);
        assert_eq!(items[0].draft.title, "一致");
    }

    #[tokio::test]
    async fn indexed_search_over_50k_rows_stays_within_the_150ms_target() {
        let database = Database::open_memory().await.unwrap();
        sqlx::query(
            r#"
            WITH RECURSIVE seq(value) AS (
              SELECT 1
              UNION ALL
              SELECT value + 1 FROM seq WHERE value < 50000
            )
            INSERT INTO schedule_items(
              id, title, description, location, start_at_utc, end_at_utc, time_zone,
              all_day, status, project, category, tags_json, color, sync_status,
              version, created_at_utc, updated_at_utc, priority, recurrence_exdates_json
            )
            SELECT
              '00000000-0000-4000-8000-' || printf('%012d', value),
              CASE WHEN value = 4242 THEN 'needle4242' ELSE '通常予定' END,
              '', '', '2026-07-20T00:00:00.000Z', '2026-07-20T01:00:00.000Z',
              'Asia/Tokyo', 0, 'scheduled', '', '', '[]', '#6F96F4', 'local_only',
              0, '2026-07-20T00:00:00.000Z', '2026-07-20T00:00:00.000Z', 'normal', '[]'
            FROM seq
            "#,
        )
        .execute(&database.pool)
        .await
        .unwrap();
        let query = ScheduleQuery {
            start_utc: Utc.with_ymd_and_hms(2026, 7, 19, 0, 0, 0).unwrap(),
            end_utc: Utc.with_ymd_and_hms(2026, 7, 21, 0, 0, 0).unwrap(),
            search: Some("needle4242".into()),
            include_deleted: false,
            limit: 100,
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
        };
        database.list_schedules(query.clone()).await.unwrap();
        let mut samples = Vec::new();
        for _ in 0..20 {
            let started = std::time::Instant::now();
            let (items, total) = database.list_schedules(query.clone()).await.unwrap();
            samples.push(started.elapsed());
            assert_eq!(total, 1);
            assert_eq!(items[0].draft.title, "needle4242");
        }
        samples.sort();
        let p95 = samples[18];
        assert!(
            p95 < std::time::Duration::from_millis(150),
            "50k-row search p95 was {p95:?}"
        );
    }

    #[tokio::test]
    async fn all_day_local_dates_roundtrip_without_utc_date_inference() {
        let database = Database::open_memory().await.unwrap();
        let mut value = draft("終日");
        value.timezone_id = "Pacific/Kiritimati".into();
        value.all_day = true;
        value.all_day_start_date = Some(chrono::NaiveDate::from_ymd_opt(2026, 7, 20).unwrap());
        value.all_day_end_date_exclusive =
            Some(chrono::NaiveDate::from_ymd_opt(2026, 7, 22).unwrap());
        value.start_utc = Utc.with_ymd_and_hms(2026, 7, 19, 10, 0, 0).unwrap();
        value.end_utc = Utc.with_ymd_and_hms(2026, 7, 21, 10, 0, 0).unwrap();

        let created = database.create_schedule(value).await.unwrap();
        assert_eq!(
            created.draft.all_day_start_date,
            Some(chrono::NaiveDate::from_ymd_opt(2026, 7, 20).unwrap())
        );
        assert_eq!(
            database
                .schedule(created.id)
                .await
                .unwrap()
                .draft
                .all_day_end_date_exclusive,
            Some(chrono::NaiveDate::from_ymd_opt(2026, 7, 22).unwrap())
        );
    }

    #[tokio::test]
    async fn connected_default_calendar_enqueues_idempotent_outbox_with_local_commit() {
        let database = Database::open_memory().await.unwrap();
        connect_default_calendar(&database).await;
        let created = database.create_schedule(draft("同期予定")).await.unwrap();
        assert_eq!(created.sync_status, SyncStatus::Pending);
        let count: i64 = sqlx::query_scalar("SELECT COUNT(*) FROM sync_outbox")
            .fetch_one(&database.pool)
            .await
            .unwrap();
        assert_eq!(count, 1);
    }

    #[tokio::test]
    async fn updating_one_recurring_occurrence_is_atomic_and_undoable() {
        let database = Database::open_memory().await.unwrap();
        connect_default_calendar(&database).await;
        let mut recurring = draft("日次系列");
        recurring.recurrence_rule = Some("FREQ=DAILY;COUNT=5".into());
        let created = database.create_schedule(recurring).await.unwrap();
        let occurrence_start = created.draft.start_utc + Duration::days(2);
        let mut exception = created.draft.clone();
        exception.title = "今回だけ変更".into();
        exception.start_utc = occurrence_start + Duration::minutes(30);
        exception.end_utc = exception.start_utc + Duration::hours(1);

        let updated = database
            .update_schedule_scoped(
                created.id,
                created.version,
                exception,
                RecurrenceEditScope::This,
                Some(occurrence_start),
            )
            .await
            .unwrap();

        assert_ne!(updated.id, created.id);
        assert!(updated.draft.recurrence_rule.is_none());
        let master = database.schedule(created.id).await.unwrap();
        assert_eq!(master.draft.recurrence_exdates, vec![occurrence_start]);
        let linked_master: String =
            sqlx::query_scalar("SELECT recurrence_series_id FROM schedule_items WHERE id = ?")
                .bind(updated.id.to_string())
                .fetch_one(&database.pool)
                .await
                .unwrap();
        assert_eq!(linked_master, created.id.to_string());
        let outbox_count: i64 = sqlx::query_scalar("SELECT COUNT(*) FROM sync_outbox")
            .fetch_one(&database.pool)
            .await
            .unwrap();
        assert_eq!(outbox_count, 3, "create + master update + exception create");

        database.undo().await.unwrap();
        assert!(
            database
                .schedule(created.id)
                .await
                .unwrap()
                .draft
                .recurrence_exdates
                .is_empty()
        );
        assert!(
            database
                .schedule(updated.id)
                .await
                .unwrap()
                .deleted_at
                .is_some()
        );
    }

    #[tokio::test]
    async fn updating_following_occurrences_splits_the_series_without_overlap() {
        let database = Database::open_memory().await.unwrap();
        let mut recurring = draft("週次系列");
        recurring.recurrence_rule = Some("FREQ=WEEKLY;COUNT=8".into());
        let created = database.create_schedule(recurring).await.unwrap();
        let occurrence_start = created.draft.start_utc + Duration::weeks(3);
        let mut following = created.draft.clone();
        following.title = "以降を変更".into();
        following.start_utc = occurrence_start;
        following.end_utc = occurrence_start + Duration::hours(2);

        let split = database
            .update_schedule_scoped(
                created.id,
                created.version,
                following,
                RecurrenceEditScope::Following,
                Some(occurrence_start),
            )
            .await
            .unwrap();

        assert_ne!(split.id, created.id);
        assert_eq!(split.draft.start_utc, occurrence_start);
        assert_eq!(
            split.draft.recurrence_rule.as_deref(),
            Some("FREQ=WEEKLY;COUNT=8")
        );
        let previous = database.schedule(created.id).await.unwrap();
        assert_eq!(
            previous.draft.recurrence_rule.as_deref(),
            Some("FREQ=WEEKLY;UNTIL=20260809T235959Z")
        );
    }

    #[tokio::test]
    async fn deleting_one_occurrence_keeps_the_series_and_records_an_exdate() {
        let database = Database::open_memory().await.unwrap();
        let mut recurring = draft("削除範囲");
        recurring.recurrence_rule = Some("FREQ=DAILY;COUNT=5".into());
        let created = database.create_schedule(recurring).await.unwrap();
        let occurrence_start = created.draft.start_utc + Duration::days(1);

        database
            .delete_schedule_scoped(
                created.id,
                created.version,
                RecurrenceEditScope::This,
                Some(occurrence_start),
            )
            .await
            .unwrap();

        let remaining = database.schedule(created.id).await.unwrap();
        assert!(remaining.deleted_at.is_none());
        assert_eq!(remaining.draft.recurrence_exdates, vec![occurrence_start]);
        assert_eq!(remaining.version, created.version + 1);
    }

    #[tokio::test]
    async fn deleting_all_user_data_is_atomic_and_restores_safe_defaults() {
        let database = Database::open_memory().await.unwrap();
        connect_default_calendar(&database).await;
        database.create_schedule(draft("削除対象")).await.unwrap();
        let mut settings = database.settings().await.unwrap();
        settings.focus_work_minutes = 90;
        settings.last_template_id = Some(Uuid::new_v4());
        database.save_settings(&settings).await.unwrap();
        let now = Utc::now().to_rfc3339();
        sqlx::query(
            "INSERT INTO templates(id, name, description, color, weekdays_mask, is_builtin, sort_order, version, created_at_utc, updated_at_utc) VALUES (?, '追加', '', '#6F96F4', 127, 0, 1, 0, ?, ?)",
        )
        .bind(Uuid::new_v4().to_string())
        .bind(&now)
        .bind(&now)
        .execute(&database.pool)
        .await
        .unwrap();

        assert_eq!(database.delete_all_user_data().await.unwrap(), 1);
        for table in [
            "schedule_items",
            "change_history",
            "google_accounts",
            "google_calendars",
            "sync_outbox",
            "focus_sessions",
            "notification_deliveries",
            "backup_history",
            "diagnostic_events",
        ] {
            let count: i64 = sqlx::query_scalar(&format!("SELECT COUNT(*) FROM {table}"))
                .fetch_one(&database.pool)
                .await
                .unwrap();
            assert_eq!(count, 0, "table {table}");
        }
        let templates: i64 = sqlx::query_scalar("SELECT COUNT(*) FROM templates")
            .fetch_one(&database.pool)
            .await
            .unwrap();
        assert_eq!(templates, 1);
        assert_eq!(database.settings().await.unwrap(), Settings::default());
    }
}
