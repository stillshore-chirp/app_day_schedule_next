use std::path::Path;

use chrono::{DateTime, Utc};
use serde::{Deserialize, Serialize};
use uuid::Uuid;

use crate::{
    application::OperationCancellation,
    domain::{AppError, AppResult, SyncSummary},
};

use super::Database;

#[derive(Debug, Clone, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct OAuthConfigResult {
    pub configured: bool,
    pub client_id_hint: String,
    pub scopes: [&'static str; 2],
}

#[derive(Debug, Clone, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct OAuthBeginResult {
    pub authorization_url: String,
    pub expires_at: DateTime<Utc>,
}

#[derive(Debug, Clone, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct GoogleConnection {
    pub configured: bool,
    pub state: &'static str,
    pub account_id: Option<Uuid>,
    pub display_label: Option<String>,
    pub calendars: Vec<GoogleCalendar>,
    pub last_error: Option<String>,
    pub mapped_schedule_count: u64,
}

#[derive(Debug, Clone, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct GoogleCalendar {
    pub id: Uuid,
    pub display_name: String,
    pub color: String,
    pub timezone_id: String,
    pub access_role: String,
    pub selected: bool,
    pub default_write_target: bool,
    pub writable: bool,
}

#[derive(Debug, Clone, Copy, Deserialize)]
#[serde(rename_all = "snake_case")]
pub enum DisconnectMode {
    KeepLocal,
    DeleteMappedLocal,
}

impl Database {
    pub async fn delete_google_secrets(&self) -> AppResult<()> {
        Ok(())
    }

    pub async fn import_google_oauth_config(&self, _path: &Path) -> AppResult<OAuthConfigResult> {
        Err(disabled())
    }

    pub async fn begin_google_oauth(&self) -> AppResult<OAuthBeginResult> {
        Err(disabled())
    }

    pub async fn google_connection(&self) -> AppResult<GoogleConnection> {
        Ok(GoogleConnection {
            configured: false,
            state: "feature_disabled",
            account_id: None,
            display_label: None,
            calendars: Vec::new(),
            last_error: None,
            mapped_schedule_count: 0,
        })
    }

    pub async fn update_google_calendar(
        &self,
        _id: Uuid,
        _selected: bool,
        _default_write_target: bool,
    ) -> AppResult<GoogleCalendar> {
        Err(disabled())
    }

    pub async fn disconnect_google(&self, _mode: DisconnectMode) -> AppResult<u64> {
        Err(disabled())
    }

    pub async fn run_google_sync(
        &self,
        cancellation: &OperationCancellation,
    ) -> AppResult<SyncSummary> {
        cancellation.check()?;
        self.sync_summary().await
    }
}

fn disabled() -> AppError {
    AppError::Unavailable {
        message: "このビルドではGoogle同期が無効です。".into(),
        recovery: "google-sync機能を有効にした正式ビルドを利用してください。ローカル予定はそのまま使えます。".into(),
        retryable: false,
    }
}
