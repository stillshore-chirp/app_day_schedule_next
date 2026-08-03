use serde::Deserialize;
use uuid::Uuid;

use crate::domain::{
    AppError, AppResult, GoogleTaskConflict, GoogleTaskConflictResolution, GoogleTaskList,
    GoogleTasksConnection, TicketGoogleTaskStatus,
};

use super::Database;

#[derive(Debug, Deserialize)]
#[serde(rename_all = "camelCase", deny_unknown_fields)]
pub struct GoogleTaskListUpdate {
    pub id: Uuid,
    pub selected: bool,
    pub default_write_target: bool,
}

#[derive(Debug, Deserialize)]
#[serde(rename_all = "camelCase", deny_unknown_fields)]
pub struct TicketGoogleTaskTargetUpdate {
    pub ticket_id: Uuid,
    pub task_list_id: Option<Uuid>,
    #[serde(default)]
    pub delete_remote: bool,
    pub operation_id: Uuid,
}

#[derive(Debug, Clone, Deserialize)]
#[serde(rename_all = "camelCase", deny_unknown_fields)]
pub struct GoogleTaskConflictResolveRequest {
    pub conflict_id: Uuid,
    pub resolution: GoogleTaskConflictResolution,
    pub operation_id: Uuid,
}

impl Database {
    pub async fn google_tasks_background_due(
        &self,
        _now: chrono::DateTime<chrono::Utc>,
    ) -> AppResult<bool> {
        Ok(false)
    }

    pub async fn google_tasks_connection(&self) -> AppResult<GoogleTasksConnection> {
        Err(disabled())
    }

    pub async fn set_google_tasks_enabled(
        &self,
        _enabled: bool,
    ) -> AppResult<GoogleTasksConnection> {
        Err(disabled())
    }

    pub async fn update_google_task_list(
        &self,
        _request: GoogleTaskListUpdate,
    ) -> AppResult<GoogleTaskList> {
        Err(disabled())
    }

    pub async fn ticket_google_task_statuses(
        &self,
        _ticket_ids: &[Uuid],
    ) -> AppResult<Vec<TicketGoogleTaskStatus>> {
        Err(disabled())
    }

    pub async fn update_ticket_google_task_target(
        &self,
        _request: TicketGoogleTaskTargetUpdate,
    ) -> AppResult<TicketGoogleTaskStatus> {
        Err(disabled())
    }

    pub async fn google_task_conflicts(&self) -> AppResult<Vec<GoogleTaskConflict>> {
        Err(disabled())
    }

    pub async fn resolve_google_task_conflict(
        &self,
        _request: GoogleTaskConflictResolveRequest,
    ) -> AppResult<TicketGoogleTaskStatus> {
        Err(disabled())
    }
}

fn disabled() -> AppError {
    AppError::Unavailable {
        message: "このビルドではGoogle Tasks同期が無効です。".into(),
        recovery: "google-sync機能を有効にした正式ビルドを利用してください。ローカルTicketはそのまま使えます。".into(),
        retryable: false,
    }
}
