use chrono::{DateTime, Utc};
use serde::{Deserialize, Serialize};
use serde_json::Value;
use sqlx::Row;
use uuid::Uuid;

use crate::domain::{AppError, AppResult, Schedule, ScheduleDraft, SyncStatus};

use super::{
    Database,
    database::{enqueue_outbox, insert_history, row_to_schedule, update_schedule_row},
};

#[derive(Debug, Clone, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct SyncQueueItem {
    pub id: Uuid,
    pub schedule_id: Uuid,
    pub title: String,
    pub operation: String,
    pub attempt_count: u32,
    pub next_attempt_at: DateTime<Utc>,
    pub error_category: Option<String>,
}

#[derive(Debug, Clone, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct SyncConflictItem {
    pub id: Uuid,
    pub schedule_id: Uuid,
    pub title: String,
    pub calendar_name: String,
    pub fields: Vec<SyncConflictField>,
    pub deletion_conflict: bool,
    pub created_at: DateTime<Utc>,
}

#[derive(Debug, Clone, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct SyncConflictField {
    pub field: String,
    pub local_value: Value,
    pub remote_value: Value,
}

#[derive(Debug, Clone, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct ConflictChoice {
    pub field: String,
    pub source: ConflictSource,
}

#[derive(Debug, Clone, Copy, Deserialize, PartialEq, Eq)]
#[serde(rename_all = "snake_case")]
pub enum ConflictSource {
    Local,
    Remote,
}

impl Database {
    pub async fn sync_queue_items(&self) -> AppResult<Vec<SyncQueueItem>> {
        let rows = sqlx::query(
            "SELECT o.id, o.entity_id, s.title, o.operation, o.attempt_count, o.next_attempt_at_utc, o.error_category FROM sync_outbox o JOIN schedule_items s ON s.id = o.entity_id WHERE o.completed_at_utc IS NULL ORDER BY o.next_attempt_at_utc, o.created_at_utc LIMIT 500",
        )
        .fetch_all(&self.pool)
        .await
        .map_err(|error| AppError::database("sync-queue-list", error))?;
        rows.into_iter()
            .map(|row| {
                Ok(SyncQueueItem {
                    id: parse_uuid(row.get("id"), "sync-queue-id")?,
                    schedule_id: parse_uuid(row.get("entity_id"), "sync-queue-schedule")?,
                    title: row.get("title"),
                    operation: row.get("operation"),
                    attempt_count: row.get::<i64, _>("attempt_count").max(0) as u32,
                    next_attempt_at: parse_datetime(
                        row.get("next_attempt_at_utc"),
                        "sync-queue-next-attempt",
                    )?,
                    error_category: row.get("error_category"),
                })
            })
            .collect()
    }

    pub async fn retry_sync_queue(&self, id: Option<Uuid>) -> AppResult<u64> {
        let now = Utc::now().to_rfc3339();
        let result = if let Some(id) = id {
            sqlx::query(
                "UPDATE sync_outbox SET next_attempt_at_utc = ?, error_category = NULL WHERE id = ? AND completed_at_utc IS NULL",
            )
            .bind(&now)
            .bind(id.to_string())
            .execute(&self.pool)
            .await
        } else {
            sqlx::query(
                "UPDATE sync_outbox SET next_attempt_at_utc = ?, error_category = NULL WHERE completed_at_utc IS NULL",
            )
            .bind(&now)
            .execute(&self.pool)
            .await
        }
        .map_err(|error| AppError::database("sync-queue-retry", error))?;
        sqlx::query(
            "UPDATE schedule_items SET sync_status = 'pending' WHERE id IN (SELECT entity_id FROM sync_outbox WHERE completed_at_utc IS NULL)",
        )
        .execute(&self.pool)
        .await
        .map_err(|error| AppError::database("sync-queue-retry-status", error))?;
        Ok(result.rows_affected())
    }

    pub async fn sync_conflicts(&self) -> AppResult<Vec<SyncConflictItem>> {
        let rows = sqlx::query(
            "SELECT f.id, f.schedule_item_id, f.local_json, f.remote_json, f.fields_json, f.created_at_utc, s.title, c.display_name FROM sync_conflicts f JOIN schedule_items s ON s.id = f.schedule_item_id JOIN google_calendars c ON c.id = f.calendar_id WHERE f.status = 'unresolved' ORDER BY f.created_at_utc DESC LIMIT 500",
        )
        .fetch_all(&self.pool)
        .await
        .map_err(|error| AppError::database("sync-conflict-list", error))?;
        rows.into_iter().map(conflict_row).collect()
    }

    pub async fn resolve_sync_conflict(
        &self,
        conflict_id: Uuid,
        choices: Vec<ConflictChoice>,
    ) -> AppResult<Schedule> {
        let mut transaction = self
            .pool
            .begin()
            .await
            .map_err(|error| AppError::database("sync-conflict-resolve-begin", error))?;
        let row = sqlx::query(
            "SELECT f.schedule_item_id, f.base_json, f.local_json, f.remote_json, f.fields_json FROM sync_conflicts f WHERE f.id = ? AND f.status = 'unresolved'",
        )
        .bind(conflict_id.to_string())
        .fetch_optional(&mut *transaction)
        .await
        .map_err(|error| AppError::database("sync-conflict-resolve-read", error))?
        .ok_or_else(|| AppError::NotFound {
            message: "未解決の競合が見つかりません。".into(),
            recovery: "競合一覧を更新してください。".into(),
        })?;
        let schedule_id = parse_uuid(row.get("schedule_item_id"), "sync-conflict-schedule")?;
        let current_row = sqlx::query("SELECT * FROM schedule_items WHERE id = ?")
            .bind(schedule_id.to_string())
            .fetch_one(&mut *transaction)
            .await
            .map_err(|error| AppError::database("sync-conflict-current", error))?;
        let before = row_to_schedule(&current_row)?;
        let recorded_local: Schedule = serde_json::from_str(row.get("local_json"))
            .map_err(|error| AppError::database("sync-conflict-local-decode", error))?;
        let fields: Vec<String> = serde_json::from_str(row.get("fields_json"))
            .map_err(|error| AppError::database("sync-conflict-fields-decode", error))?;
        let remote_value: Value = serde_json::from_str(row.get("remote_json"))
            .map_err(|error| AppError::database("sync-conflict-remote-decode", error))?;

        let mut after = before.clone();
        if fields.iter().any(|field| field == "delete") {
            let source = choice_for(&choices, "delete")?;
            if source == ConflictSource::Remote {
                complete_schedule_outbox(&mut transaction, schedule_id).await?;
                if let Ok(mut draft) = remote_draft(&remote_value) {
                    draft.validate()?;
                    after.draft = draft;
                    after.deleted_at = None;
                    after.sync_status = SyncStatus::Synced;
                    after.version += 1;
                } else {
                    after.deleted_at = Some(Utc::now());
                    after.sync_status = SyncStatus::Synced;
                    after.version += 1;
                }
            } else {
                after.sync_status = SyncStatus::Pending;
                after.version += 1;
                complete_schedule_outbox(&mut transaction, schedule_id).await?;
                if recorded_local.deleted_at.is_some() {
                    after.deleted_at = Some(Utc::now());
                    enqueue_outbox(&mut transaction, &after, "delete", Utc::now()).await?;
                } else {
                    after.deleted_at = None;
                    sqlx::query("DELETE FROM sync_mappings WHERE schedule_item_id = ?")
                        .bind(schedule_id.to_string())
                        .execute(&mut *transaction)
                        .await
                        .map_err(|error| {
                            AppError::database("sync-conflict-restore-mapping", error)
                        })?;
                    enqueue_outbox(&mut transaction, &after, "create", Utc::now()).await?;
                }
            }
        } else {
            let base: ScheduleDraft = serde_json::from_str(row.get("base_json"))
                .map_err(|error| AppError::database("sync-conflict-base-decode", error))?;
            let remote = remote_draft(&remote_value)?;
            let draft = resolve_draft(&base, &recorded_local.draft, &remote, &fields, &choices)?;
            let mut validated = draft;
            validated.validate()?;
            after.draft = validated;
            after.deleted_at = None;
            after.version += 1;
            complete_schedule_outbox(&mut transaction, schedule_id).await?;
            if after.draft == remote {
                after.sync_status = SyncStatus::Synced;
            } else {
                after.sync_status = SyncStatus::Pending;
                enqueue_outbox(&mut transaction, &after, "update", Utc::now()).await?;
            }
        }
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
        sqlx::query(
            "UPDATE sync_conflicts SET status = 'resolved', resolved_at_utc = ? WHERE id = ?",
        )
        .bind(Utc::now().to_rfc3339())
        .bind(conflict_id.to_string())
        .execute(&mut *transaction)
        .await
        .map_err(|error| AppError::database("sync-conflict-resolve-mark", error))?;
        transaction
            .commit()
            .await
            .map_err(|error| AppError::database("sync-conflict-resolve-commit", error))?;
        Ok(after)
    }
}

fn conflict_row(row: sqlx::sqlite::SqliteRow) -> AppResult<SyncConflictItem> {
    let local: Schedule = serde_json::from_str(row.get("local_json"))
        .map_err(|error| AppError::database("sync-conflict-list-local", error))?;
    let remote_value: Value = serde_json::from_str(row.get("remote_json"))
        .map_err(|error| AppError::database("sync-conflict-list-remote", error))?;
    let fields: Vec<String> = serde_json::from_str(row.get("fields_json"))
        .map_err(|error| AppError::database("sync-conflict-list-fields", error))?;
    let remote = remote_draft(&remote_value).ok();
    let local_value = serde_json::to_value(&local.draft)
        .map_err(|error| AppError::database("sync-conflict-list-local-value", error))?;
    let remote_draft_value = remote
        .as_ref()
        .map(serde_json::to_value)
        .transpose()
        .map_err(|error| AppError::database("sync-conflict-list-remote-value", error))?;
    let deletion_conflict = fields
        .iter()
        .any(|field| matches!(field.as_str(), "delete" | "etag"));
    let visible_fields = fields
        .iter()
        .map(|field| SyncConflictField {
            field: field.clone(),
            local_value: if deletion_conflict {
                Value::String(
                    if local.deleted_at.is_some() {
                        "削除"
                    } else {
                        "保持"
                    }
                    .into(),
                )
            } else {
                local_value.get(field).cloned().unwrap_or(Value::Null)
            },
            remote_value: if deletion_conflict {
                Value::String(if remote.is_some() { "保持" } else { "削除" }.into())
            } else {
                remote_draft_value
                    .as_ref()
                    .and_then(|value| value.get(field))
                    .cloned()
                    .unwrap_or(Value::Null)
            },
        })
        .collect();
    Ok(SyncConflictItem {
        id: parse_uuid(row.get("id"), "sync-conflict-id")?,
        schedule_id: parse_uuid(row.get("schedule_item_id"), "sync-conflict-schedule")?,
        title: row.get("title"),
        calendar_name: row.get("display_name"),
        fields: visible_fields,
        deletion_conflict,
        created_at: parse_datetime(row.get("created_at_utc"), "sync-conflict-created")?,
    })
}

fn resolve_draft(
    base: &ScheduleDraft,
    local: &ScheduleDraft,
    remote: &ScheduleDraft,
    conflict_fields: &[String],
    choices: &[ConflictChoice],
) -> AppResult<ScheduleDraft> {
    let base = serde_json::to_value(base)
        .map_err(|error| AppError::database("sync-resolution-base", error))?;
    let local = serde_json::to_value(local)
        .map_err(|error| AppError::database("sync-resolution-local", error))?;
    let remote = serde_json::to_value(remote)
        .map_err(|error| AppError::database("sync-resolution-remote", error))?;
    let base = base
        .as_object()
        .ok_or_else(|| AppError::database("sync-resolution-base-object", "invalid"))?;
    let local = local
        .as_object()
        .ok_or_else(|| AppError::database("sync-resolution-local-object", "invalid"))?;
    let remote = remote
        .as_object()
        .ok_or_else(|| AppError::database("sync-resolution-remote-object", "invalid"))?;
    let mut result = serde_json::Map::new();
    for (field, base_value) in base {
        let local_value = local.get(field).unwrap_or(base_value);
        let remote_value = remote.get(field).unwrap_or(base_value);
        let selected = if conflict_fields.iter().any(|value| value == field) {
            match choice_for(choices, field)? {
                ConflictSource::Local => local_value,
                ConflictSource::Remote => remote_value,
            }
        } else if local_value == base_value {
            remote_value
        } else {
            local_value
        };
        result.insert(field.clone(), selected.clone());
    }
    serde_json::from_value(Value::Object(result))
        .map_err(|error| AppError::database("sync-resolution-decode", error))
}

fn remote_draft(value: &Value) -> AppResult<ScheduleDraft> {
    let draft = value.get("draft").unwrap_or(value);
    serde_json::from_value(draft.clone()).map_err(|_| AppError::Validation {
        message: "Google側の競合内容を安全に読み取れません。".into(),
        recovery: "再同期して競合一覧を更新してください。ローカル予定は保持されています。".into(),
    })
}

fn choice_for(choices: &[ConflictChoice], field: &str) -> AppResult<ConflictSource> {
    choices
        .iter()
        .find(|choice| choice.field == field)
        .map(|choice| choice.source)
        .ok_or_else(|| AppError::Validation {
            message: format!("競合項目「{field}」の採用元を選んでください。"),
            recovery: "この端末またはGoogleの値を選んでから確定してください。".into(),
        })
}

async fn complete_schedule_outbox(
    transaction: &mut sqlx::Transaction<'_, sqlx::Sqlite>,
    schedule_id: Uuid,
) -> AppResult<()> {
    sqlx::query(
        "UPDATE sync_outbox SET completed_at_utc = ?, error_category = NULL WHERE entity_id = ? AND completed_at_utc IS NULL",
    )
    .bind(Utc::now().to_rfc3339())
    .bind(schedule_id.to_string())
    .execute(&mut **transaction)
    .await
    .map_err(|error| AppError::database("sync-resolution-outbox", error))?;
    Ok(())
}

fn parse_uuid(value: &str, operation: &'static str) -> AppResult<Uuid> {
    Uuid::parse_str(value).map_err(|error| AppError::database(operation, error))
}

fn parse_datetime(value: &str, operation: &'static str) -> AppResult<DateTime<Utc>> {
    DateTime::parse_from_rfc3339(value)
        .map(|value| value.with_timezone(&Utc))
        .map_err(|error| AppError::database(operation, error))
}
