use std::collections::BTreeMap;

use chrono::{DateTime, NaiveDate, Utc};
use serde::{Deserialize, Serialize};
use uuid::Uuid;

use super::{AppError, AppResult};

pub const GOOGLE_TASK_TITLE_MAX_CHARS: usize = 1_024;
pub const GOOGLE_TASK_NOTES_MAX_CHARS: usize = 8_192;

#[derive(Debug, Clone, PartialEq, Eq, Serialize, Deserialize)]
#[serde(rename_all = "camelCase", deny_unknown_fields)]
pub struct GoogleTaskSnapshot {
    pub title: String,
    pub notes: String,
    pub due_date: Option<NaiveDate>,
    pub completed: bool,
    pub parent_ticket_id: Option<Uuid>,
    pub task_list_id: Uuid,
}

impl GoogleTaskSnapshot {
    pub fn validate_for_push(&self) -> AppResult<()> {
        let title_length = self.title.chars().count();
        if !(1..=GOOGLE_TASK_TITLE_MAX_CHARS).contains(&title_length) {
            return Err(validation(
                "Google Tasksへ同期するタイトルは1〜1,024文字にしてください。",
                "ローカルの全文は保持されています。タイトルを確認して再試行してください。",
            ));
        }
        if self.notes.chars().count() > GOOGLE_TASK_NOTES_MAX_CHARS {
            return Err(validation(
                "説明がGoogle Tasksの上限8,192文字を超えています。",
                "ローカルの全文は保持されています。同期するには説明を短くしてください。",
            ));
        }
        Ok(())
    }
}

#[derive(Debug, Clone, Copy, PartialEq, Eq, Serialize, Deserialize)]
#[serde(rename_all = "snake_case")]
pub enum GoogleTaskSyncState {
    NotConnected,
    ScopeMissing,
    Disabled,
    Never,
    Syncing,
    Synced,
    Pending,
    Offline,
    RetryScheduled,
    Conflict,
    AuthRequired,
    Unsupported,
    ValidationRequired,
}

#[derive(Debug, Clone, PartialEq, Eq, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct GoogleTaskList {
    pub id: Uuid,
    pub display_name: String,
    pub selected: bool,
    pub default_write_target: bool,
    pub sync_state: String,
    pub last_success_at: Option<DateTime<Utc>>,
    pub next_retry_at: Option<DateTime<Utc>>,
    pub last_error_category: Option<String>,
}

#[derive(Debug, Clone, PartialEq, Eq, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct GoogleTasksConnection {
    pub enabled: bool,
    pub scope_granted: bool,
    pub state: GoogleTaskSyncState,
    pub task_lists: Vec<GoogleTaskList>,
    pub mapped_ticket_count: u64,
    pub pending_outbox_count: u64,
    pub conflict_count: u64,
    pub selected_list_count: u64,
    pub last_success_at: Option<DateTime<Utc>>,
    pub next_retry_at: Option<DateTime<Utc>>,
}

#[derive(Debug, Clone, PartialEq, Eq, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct TicketGoogleTaskStatus {
    pub ticket_id: Uuid,
    pub state: GoogleTaskSyncState,
    pub task_list_id: Option<Uuid>,
    pub task_list_name: Option<String>,
    pub last_sync_at: Option<DateTime<Utc>>,
    pub error_category: Option<String>,
    pub pending_operation: Option<String>,
    pub conflict_count: u64,
}

#[derive(Debug, Clone, PartialEq, Eq, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct GoogleTaskConflict {
    pub id: Uuid,
    pub ticket_id: Uuid,
    pub ticket_title: String,
    pub field_name: String,
    pub base_value: serde_json::Value,
    pub local_value: serde_json::Value,
    pub google_value: serde_json::Value,
    pub conflict_type: String,
    pub detected_at: DateTime<Utc>,
}

#[derive(Debug, Clone, Copy, PartialEq, Eq, Deserialize)]
#[serde(rename_all = "snake_case")]
pub enum GoogleTaskConflictResolution {
    Local,
    Google,
    Detach,
    DeleteLocal,
}

#[derive(Debug, Clone, PartialEq, Eq)]
pub struct GoogleTaskMerge {
    pub merged: GoogleTaskSnapshot,
    pub conflicts:
        BTreeMap<&'static str, (serde_json::Value, serde_json::Value, serde_json::Value)>,
}

pub fn merge_google_task(
    base: &GoogleTaskSnapshot,
    local: &GoogleTaskSnapshot,
    remote: &GoogleTaskSnapshot,
) -> GoogleTaskMerge {
    let mut merged = base.clone();
    let mut conflicts = BTreeMap::new();
    merge_field(
        "title",
        &base.title,
        &local.title,
        &remote.title,
        &mut merged.title,
        &mut conflicts,
    );
    merge_field(
        "notes",
        &base.notes,
        &local.notes,
        &remote.notes,
        &mut merged.notes,
        &mut conflicts,
    );
    merge_field(
        "due",
        &base.due_date,
        &local.due_date,
        &remote.due_date,
        &mut merged.due_date,
        &mut conflicts,
    );
    merge_field(
        "completed",
        &base.completed,
        &local.completed,
        &remote.completed,
        &mut merged.completed,
        &mut conflicts,
    );
    merge_field(
        "parent",
        &base.parent_ticket_id,
        &local.parent_ticket_id,
        &remote.parent_ticket_id,
        &mut merged.parent_ticket_id,
        &mut conflicts,
    );
    merge_field(
        "tasklist",
        &base.task_list_id,
        &local.task_list_id,
        &remote.task_list_id,
        &mut merged.task_list_id,
        &mut conflicts,
    );
    GoogleTaskMerge { merged, conflicts }
}

fn merge_field<T>(
    name: &'static str,
    base: &T,
    local: &T,
    remote: &T,
    output: &mut T,
    conflicts: &mut BTreeMap<
        &'static str,
        (serde_json::Value, serde_json::Value, serde_json::Value),
    >,
) where
    T: Clone + PartialEq + Serialize,
{
    if local == remote {
        *output = local.clone();
    } else if local == base {
        *output = remote.clone();
    } else if remote == base {
        *output = local.clone();
    } else {
        conflicts.insert(
            name,
            (
                serde_json::to_value(base).unwrap_or(serde_json::Value::Null),
                serde_json::to_value(local).unwrap_or(serde_json::Value::Null),
                serde_json::to_value(remote).unwrap_or(serde_json::Value::Null),
            ),
        );
        *output = local.clone();
    }
}

fn validation(message: &str, recovery: &str) -> AppError {
    AppError::Validation {
        message: message.into(),
        recovery: recovery.into(),
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    fn snapshot() -> GoogleTaskSnapshot {
        GoogleTaskSnapshot {
            title: "Base".into(),
            notes: "Notes".into(),
            due_date: NaiveDate::from_ymd_opt(2026, 8, 3),
            completed: false,
            parent_ticket_id: None,
            task_list_id: Uuid::nil(),
        }
    }

    #[test]
    fn disjoint_fields_merge_without_loss() {
        let base = snapshot();
        let mut local = base.clone();
        local.title = "Local".into();
        let mut remote = base.clone();
        remote.due_date = NaiveDate::from_ymd_opt(2026, 8, 4);
        let result = merge_google_task(&base, &local, &remote);
        assert!(result.conflicts.is_empty());
        assert_eq!(result.merged.title, "Local");
        assert_eq!(result.merged.due_date, NaiveDate::from_ymd_opt(2026, 8, 4));
    }

    #[test]
    fn same_field_divergence_is_never_silently_overwritten() {
        let base = snapshot();
        let mut local = base.clone();
        local.title = "Local".into();
        let mut remote = base.clone();
        remote.title = "Google".into();
        let result = merge_google_task(&base, &local, &remote);
        assert_eq!(result.merged.title, "Local");
        assert!(result.conflicts.contains_key("title"));
    }

    #[test]
    fn notes_over_google_limit_are_rejected_without_truncation() {
        let mut value = snapshot();
        value.notes = "あ".repeat(GOOGLE_TASK_NOTES_MAX_CHARS + 1);
        assert!(matches!(
            value.validate_for_push(),
            Err(AppError::Validation { .. })
        ));
        assert_eq!(value.notes.chars().count(), GOOGLE_TASK_NOTES_MAX_CHARS + 1);
    }
}
