use std::{
    collections::HashSet,
    fs,
    future::Future,
    path::Path,
    sync::atomic::{AtomicBool, AtomicU64, Ordering},
    time::Duration as StdDuration,
};

use base64::{Engine, engine::general_purpose::URL_SAFE_NO_PAD};
use chrono::{DateTime, Duration, LocalResult, NaiveDate, NaiveTime, TimeZone, Utc};
use keyring::Entry;
use rand::RngCore;
use reqwest::{Client, StatusCode, Url};
use serde::{Deserialize, Serialize};
use serde_json::Value;
use sha2::{Digest, Sha256};
use sqlx::Row;
use tokio::{
    io::{AsyncReadExt, AsyncWriteExt},
    net::TcpListener,
    time::timeout,
};
use uuid::Uuid;

use crate::{
    application::OperationCancellation,
    domain::{
        AppError, AppResult, GoogleTasksConnection, Priority, Schedule, ScheduleDraft,
        ScheduleStatus, SyncStatus, SyncSummary,
    },
};

use super::{
    Database,
    database::{insert_schedule, row_to_schedule, update_schedule_row},
    google_tasks::{
        TASKS_SCOPE, fetch_and_persist_task_lists_for_oauth, reconcile_google_tasks_full,
        sync_google_tasks,
    },
};

const KEYRING_SERVICE: &str = "com.stillshorechirp.dayschedulenext.google";
const OAUTH_CLIENT_USER: &str = "oauth-client";
const BUILT_IN_OAUTH_CLIENT_USER: &str = "oauth-built-in-client";
const CALENDAR_SCOPE: &str = "https://www.googleapis.com/auth/calendar.events";
const CALENDAR_LIST_SCOPE: &str = "https://www.googleapis.com/auth/calendar.calendarlist.readonly";
const GOOGLE_AUTH_URI: &str = "https://accounts.google.com/o/oauth2/v2/auth";
const GOOGLE_TOKEN_URI: &str = "https://oauth2.googleapis.com/token";
const GOOGLE_CALENDAR_API_ROOT: &str = "https://www.googleapis.com/calendar/v3/";
const GOOGLE_CALENDAR_LIST_URL: &str =
    "https://www.googleapis.com/calendar/v3/users/me/calendarList";
const GOOGLE_EVENTS_PAGE_SIZE: &str = "250";
const GOOGLE_SYNC_RETRY_SECONDS: i64 = 5 * 60;
const MAX_OAUTH_FILE_BYTES: u64 = 1024 * 1024;
const LOOPBACK_TIMEOUT_SECONDS: u64 = 180;
const BUILT_IN_OAUTH_CLIENT_ID: Option<&str> = option_env!("DAY_SCHEDULE_GOOGLE_OAUTH_CLIENT_ID");
static OAUTH_IN_PROGRESS: AtomicBool = AtomicBool::new(false);
static OAUTH_ATTEMPT_GENERATION: AtomicU64 = AtomicU64::new(0);

#[derive(Debug, Clone, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct OAuthConfigResult {
    pub configured: bool,
    pub client_id_hint: String,
    pub scopes: [&'static str; 3],
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
    pub tasks: GoogleTasksConnection,
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
    pub event_readable: bool,
    pub sync_state: String,
    pub last_error_category: Option<String>,
    pub next_retry_at: Option<String>,
}

#[derive(Debug, Clone, Copy, Deserialize)]
#[serde(rename_all = "snake_case")]
pub enum DisconnectMode {
    KeepLocal,
    DeleteMappedLocal,
}

#[derive(Debug, Deserialize)]
struct OAuthFile {
    installed: OAuthInstalled,
}

#[derive(Debug, Deserialize)]
struct OAuthInstalled {
    client_id: String,
    #[serde(default)]
    client_secret: String,
    auth_uri: String,
    token_uri: String,
    redirect_uris: Vec<String>,
}

#[derive(Debug, Clone)]
struct OAuthConfig {
    client_id: String,
    client_secret: String,
    auth_uri: String,
    token_uri: String,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
struct TokenSecret {
    access_token: String,
    refresh_token: String,
    expires_at: DateTime<Utc>,
}

#[derive(Debug)]
struct OAuthAccountTarget {
    account_id: Uuid,
    credential_key: String,
    existing: bool,
}

#[derive(Debug, Deserialize)]
struct ProvisionedOAuthClient {
    client_id: String,
    client_secret: String,
}

#[derive(Debug, Deserialize)]
struct TokenResponse {
    access_token: String,
    #[serde(default)]
    refresh_token: Option<String>,
    expires_in: i64,
    #[serde(default)]
    scope: String,
}

#[derive(Debug, Clone, Copy, PartialEq, Eq)]
enum OAuthFailureCategory {
    CallbackTimeout,
    CallbackInvalid,
    AccessDenied,
    PolicyDenied,
    AttemptCancelled,
    TokenNetwork,
    TokenInvalidClient,
    TokenInvalidGrant,
    TokenRedirectUri,
    TokenRejected,
    TokenResponseInvalid,
    TokenScopeInvalid,
    RefreshTokenMissing,
    CredentialStoreFailed,
    AccountPersistenceFailed,
    CalendarFetchFailed,
    TasksFetchFailed,
}

impl OAuthFailureCategory {
    const fn as_str(self) -> &'static str {
        match self {
            Self::CallbackTimeout => "oauth_callback_timeout",
            Self::CallbackInvalid => "oauth_callback_invalid",
            Self::AccessDenied => "oauth_access_denied",
            Self::PolicyDenied => "oauth_policy_denied",
            Self::AttemptCancelled => "oauth_attempt_cancelled",
            Self::TokenNetwork => "oauth_token_network",
            Self::TokenInvalidClient => "oauth_token_invalid_client",
            Self::TokenInvalidGrant => "oauth_token_invalid_grant",
            Self::TokenRedirectUri => "oauth_token_redirect_uri",
            Self::TokenRejected => "oauth_token_rejected",
            Self::TokenResponseInvalid => "oauth_token_response_invalid",
            Self::TokenScopeInvalid => "oauth_token_scope_invalid",
            Self::RefreshTokenMissing => "oauth_refresh_token_missing",
            Self::CredentialStoreFailed => "oauth_credential_store_failed",
            Self::AccountPersistenceFailed => "oauth_account_persistence_failed",
            Self::CalendarFetchFailed => "oauth_calendar_fetch_failed",
            Self::TasksFetchFailed => "oauth_tasks_fetch_failed",
        }
    }
}

#[derive(Debug, Deserialize)]
struct OAuthErrorResponse {
    error: String,
}

#[derive(Debug, Deserialize)]
#[serde(rename_all = "camelCase")]
struct CalendarListPage {
    #[serde(default)]
    items: Vec<RemoteCalendar>,
    next_page_token: Option<String>,
}

#[derive(Debug, Deserialize)]
#[serde(rename_all = "camelCase")]
struct RemoteCalendar {
    id: String,
    summary: String,
    #[serde(default = "default_color")]
    background_color: String,
    #[serde(default = "default_timezone")]
    time_zone: String,
    access_role: String,
    #[serde(default)]
    selected: bool,
    #[serde(default)]
    primary: bool,
}

#[derive(Debug, Deserialize)]
#[serde(rename_all = "camelCase")]
struct EventListPage {
    #[serde(default)]
    items: Vec<Value>,
    next_page_token: Option<String>,
    next_sync_token: Option<String>,
}

#[derive(Debug, Clone, PartialEq, Eq)]
enum HttpFailure {
    Auth,
    Forbidden,
    NotFound,
    Conflict(Option<Value>),
    Gone,
    Retryable(Option<u64>),
    Permanent,
}

impl Database {
    pub async fn delete_google_secrets(&self) -> AppResult<()> {
        let credential_keys: Vec<Option<String>> =
            sqlx::query_scalar("SELECT credential_key FROM google_accounts")
                .fetch_all(&self.pool)
                .await
                .map_err(|error| AppError::database("google-secret-keys", error))?;
        for key in credential_keys.into_iter().flatten() {
            delete_keyring(key).await?;
        }
        delete_keyring(OAUTH_CLIENT_USER.to_owned()).await
    }

    pub async fn import_google_oauth_config(&self, path: &Path) -> AppResult<OAuthConfigResult> {
        let metadata = fs::metadata(path)
            .map_err(|error| AppError::database("google-config-metadata", error))?;
        if !metadata.is_file() || metadata.len() == 0 || metadata.len() > MAX_OAUTH_FILE_BYTES {
            return Err(validation(
                "OAuth JSONのサイズが正しくありません。",
                "Google Cloudから取得した1MB以下のDesktop app JSONを選んでください。",
            ));
        }
        let bytes =
            fs::read(path).map_err(|error| AppError::database("google-config-read", error))?;
        let parsed: OAuthFile = serde_json::from_slice(&bytes).map_err(|_| {
            validation(
                "OAuth JSONを解析できません。",
                "Google CloudのOAuthクライアント種別がDesktop appであることを確認してください。",
            )
        })?;
        validate_oauth_installed(&parsed.installed)?;
        let client_secret = parsed.installed.client_secret.clone();
        store_keyring(OAUTH_CLIENT_USER.to_owned(), client_secret).await?;
        sqlx::query(
            "INSERT INTO google_oauth_config(singleton, client_id, auth_uri, token_uri, configured_at_utc) VALUES (1, ?, ?, ?, ?) ON CONFLICT(singleton) DO UPDATE SET client_id = excluded.client_id, auth_uri = excluded.auth_uri, token_uri = excluded.token_uri, configured_at_utc = excluded.configured_at_utc",
        )
        .bind(&parsed.installed.client_id)
        .bind(&parsed.installed.auth_uri)
        .bind(&parsed.installed.token_uri)
        .bind(Utc::now().to_rfc3339())
        .execute(&self.pool)
        .await
        .map_err(|error| AppError::database("google-config-save", error))?;
        Ok(OAuthConfigResult {
            configured: true,
            client_id_hint: client_id_hint(&parsed.installed.client_id),
            scopes: [CALENDAR_SCOPE, CALENDAR_LIST_SCOPE, TASKS_SCOPE],
        })
    }

    pub async fn begin_google_oauth(&self) -> AppResult<OAuthBeginResult> {
        if OAUTH_IN_PROGRESS.swap(true, Ordering::SeqCst) {
            return Err(AppError::Conflict {
                message: "Google接続はすでに進行中です。".into(),
                recovery: "ブラウザの接続を完了するか、3分待ってから再試行してください。".into(),
            });
        }
        let attempt_id = OAUTH_ATTEMPT_GENERATION.fetch_add(1, Ordering::SeqCst) + 1;
        let result = async {
            sqlx::query(
                "INSERT INTO app_meta(key, value, updated_at_utc) VALUES ('google_last_error', 'none', ?) ON CONFLICT(key) DO UPDATE SET value = excluded.value, updated_at_utc = excluded.updated_at_utc",
            )
            .bind(Utc::now().to_rfc3339())
            .execute(&self.pool)
            .await
            .map_err(|error| AppError::database("google-oauth-error-clear", error))?;
            self.prepare_oauth_flow(attempt_id).await
        }
        .await;
        if result.is_err() {
            OAUTH_IN_PROGRESS.store(false, Ordering::SeqCst);
        }
        result
    }

    pub fn cancel_google_oauth_attempt(&self) {
        if OAUTH_IN_PROGRESS.swap(false, Ordering::SeqCst) {
            OAUTH_ATTEMPT_GENERATION.fetch_add(1, Ordering::SeqCst);
        }
    }

    async fn prepare_oauth_flow(&self, attempt_id: u64) -> AppResult<OAuthBeginResult> {
        let config = self.oauth_config().await?;
        let listener = TcpListener::bind(("127.0.0.1", 0))
            .await
            .map_err(|error| AppError::database("oauth-loopback-bind", error))?;
        let port = listener
            .local_addr()
            .map_err(|error| AppError::database("oauth-loopback-address", error))?
            .port();
        let verifier = random_base64url(48);
        let challenge = URL_SAFE_NO_PAD.encode(Sha256::digest(verifier.as_bytes()));
        let state = random_base64url(32);
        let redirect_uri = format!("http://127.0.0.1:{port}/oauth/callback");
        let mut authorization_url = Url::parse(&config.auth_uri).map_err(|_| {
            validation(
                "OAuth認証URLが正しくありません。",
                "OAuth JSONを選び直してください。",
            )
        })?;
        authorization_url
            .query_pairs_mut()
            .append_pair("client_id", &config.client_id)
            .append_pair("redirect_uri", &redirect_uri)
            .append_pair("response_type", "code")
            .append_pair(
                "scope",
                &format!("{CALENDAR_SCOPE} {CALENDAR_LIST_SCOPE} {TASKS_SCOPE}"),
            )
            .append_pair("access_type", "offline")
            .append_pair("prompt", "consent")
            .append_pair("code_challenge", &challenge)
            .append_pair("code_challenge_method", "S256")
            .append_pair("state", &state);
        let database = self.clone();
        tokio::spawn(async move {
            let outcome = complete_oauth(
                database.clone(),
                listener,
                config,
                verifier,
                state,
                redirect_uri,
                attempt_id,
            )
            .await;
            if oauth_attempt_is_current(attempt_id) {
                let category = outcome.err().map_or("none", OAuthFailureCategory::as_str);
                let _ = sqlx::query(
                    "INSERT INTO app_meta(key, value, updated_at_utc) VALUES ('google_last_error', ?, ?) ON CONFLICT(key) DO UPDATE SET value = excluded.value, updated_at_utc = excluded.updated_at_utc",
                )
                .bind(category)
                .bind(Utc::now().to_rfc3339())
                .execute(&database.pool)
                .await;
                OAUTH_IN_PROGRESS.store(false, Ordering::SeqCst);
            }
        });
        Ok(OAuthBeginResult {
            authorization_url: authorization_url.into(),
            expires_at: Utc::now() + Duration::seconds(LOOPBACK_TIMEOUT_SECONDS as i64),
        })
    }

    pub async fn google_connection(&self) -> AppResult<GoogleConnection> {
        let stored_configured: bool = sqlx::query_scalar(
            "SELECT EXISTS(SELECT 1 FROM google_oauth_config WHERE singleton = 1)",
        )
        .fetch_one(&self.pool)
        .await
        .map_err(|error| AppError::database("google-status-config", error))?;
        let configured = if stored_configured {
            true
        } else {
            built_in_oauth_config(BUILT_IN_OAUTH_CLIENT_ID)?.is_some()
        };
        let account = sqlx::query(
            "SELECT id, display_label, status FROM google_accounts WHERE status != 'disconnected' ORDER BY updated_at_utc DESC LIMIT 1",
        )
        .fetch_optional(&self.pool)
        .await
        .map_err(|error| AppError::database("google-status-account", error))?;
        let (state, account_id, display_label) = if OAUTH_IN_PROGRESS.load(Ordering::SeqCst) {
            ("connecting", None, None)
        } else if let Some(account) = account {
            let status: String = account.get("status");
            (
                if status == "connected" {
                    "connected"
                } else {
                    "auth_required"
                },
                Some(parse_uuid(account.get::<&str, _>("id"))?),
                Some(account.get("display_label")),
            )
        } else if configured {
            ("configured", None, None)
        } else {
            ("not_configured", None, None)
        };
        let calendars = self.google_calendars().await?;
        let last_error = sqlx::query_scalar::<_, String>(
            "SELECT value FROM app_meta WHERE key = 'google_last_error' AND value != 'none'",
        )
        .fetch_optional(&self.pool)
        .await
        .map_err(|error| AppError::database("google-status-error", error))?;
        let mapped_schedule_count: i64 =
            sqlx::query_scalar("SELECT COUNT(DISTINCT schedule_item_id) FROM sync_mappings")
                .fetch_one(&self.pool)
                .await
                .map_err(|error| AppError::database("google-status-mapped", error))?;
        Ok(GoogleConnection {
            configured,
            state,
            account_id,
            display_label,
            calendars,
            last_error,
            mapped_schedule_count: mapped_schedule_count.max(0) as u64,
            tasks: self.google_tasks_connection().await?,
        })
    }

    pub async fn google_calendars(&self) -> AppResult<Vec<GoogleCalendar>> {
        let rows = sqlx::query(
            "SELECT id, display_name, color, time_zone, access_role, selected, default_write_target, sync_state, last_error_category, next_retry_at_utc FROM google_calendars ORDER BY default_write_target DESC, display_name, id",
        )
        .fetch_all(&self.pool)
        .await
        .map_err(|error| AppError::database("google-calendar-list", error))?;
        rows.iter()
            .map(|row| {
                let role: String = row.get("access_role");
                Ok(GoogleCalendar {
                    id: parse_uuid(row.get::<&str, _>("id"))?,
                    display_name: row.get("display_name"),
                    color: row.get("color"),
                    timezone_id: row.get("time_zone"),
                    writable: matches!(role.as_str(), "owner" | "writer"),
                    event_readable: role != "freeBusyReader",
                    access_role: role,
                    selected: row.get("selected"),
                    default_write_target: row.get("default_write_target"),
                    sync_state: row.get("sync_state"),
                    last_error_category: row.get("last_error_category"),
                    next_retry_at: row.get("next_retry_at_utc"),
                })
            })
            .collect()
    }

    pub async fn update_google_calendar(
        &self,
        id: Uuid,
        selected: bool,
        default_write_target: bool,
    ) -> AppResult<GoogleCalendar> {
        let mut transaction = self
            .pool
            .begin()
            .await
            .map_err(|error| AppError::database("google-calendar-update-begin", error))?;
        let role: String =
            sqlx::query_scalar("SELECT access_role FROM google_calendars WHERE id = ?")
                .bind(id.to_string())
                .fetch_optional(&mut *transaction)
                .await
                .map_err(|error| AppError::database("google-calendar-role", error))?
                .ok_or_else(|| AppError::NotFound {
                    message: "Googleカレンダーが見つかりません。".into(),
                    recovery: "カレンダー一覧を更新してください。".into(),
                })?;
        if selected && role == "freeBusyReader" {
            return Err(validation(
                "空き時間のみ参照できるカレンダーは予定同期の対象にできません。",
                "Google側で予定詳細の読み取り権限を付与するか、別のカレンダーを選んでください。",
            ));
        }
        if default_write_target && !matches!(role.as_str(), "owner" | "writer") {
            return Err(validation(
                "読み取り専用カレンダーは新規予定の同期先にできません。",
                "ownerまたはwriterのカレンダーを選んでください。",
            ));
        }
        if default_write_target {
            sqlx::query("UPDATE google_calendars SET default_write_target = 0")
                .execute(&mut *transaction)
                .await
                .map_err(|error| AppError::database("google-calendar-default-clear", error))?;
        }
        sqlx::query(
            "UPDATE google_calendars SET selected = ?, default_write_target = ? WHERE id = ?",
        )
        .bind(selected || default_write_target)
        .bind(default_write_target)
        .bind(id.to_string())
        .execute(&mut *transaction)
        .await
        .map_err(|error| AppError::database("google-calendar-update", error))?;
        transaction
            .commit()
            .await
            .map_err(|error| AppError::database("google-calendar-update-commit", error))?;
        self.google_calendars()
            .await?
            .into_iter()
            .find(|calendar| calendar.id == id)
            .ok_or_else(|| AppError::database("google-calendar-updated-missing", "missing"))
    }

    pub async fn disconnect_google(&self, mode: DisconnectMode) -> AppResult<u64> {
        self.disconnect_google_with(mode, delete_keyring).await
    }

    async fn disconnect_google_with<F, Fut>(
        &self,
        mode: DisconnectMode,
        delete_credential: F,
    ) -> AppResult<u64>
    where
        F: FnOnce(String) -> Fut,
        Fut: Future<Output = AppResult<()>>,
    {
        let account = sqlx::query(
            "SELECT id, credential_key FROM google_accounts WHERE status != 'disconnected' LIMIT 1",
        )
        .fetch_optional(&self.pool)
        .await
        .map_err(|error| AppError::database("google-disconnect-account", error))?;
        let Some(account) = account else {
            return Ok(0);
        };
        let account_id: String = account.get("id");
        let credential_key: Option<String> = account.get("credential_key");
        if let Some(key) = credential_key {
            delete_credential(key).await?;
        }
        let mapped_count: i64 = sqlx::query_scalar(
            "SELECT COUNT(DISTINCT schedule_item_id) FROM sync_mappings m JOIN google_calendars c ON c.id = m.calendar_id WHERE c.account_id = ?",
        )
        .bind(&account_id)
        .fetch_one(&self.pool)
        .await
        .map_err(|error| AppError::database("google-disconnect-count", error))?;
        let mut transaction = self
            .pool
            .begin()
            .await
            .map_err(|error| AppError::database("google-disconnect-begin", error))?;
        sqlx::query(
            "UPDATE schedule_items SET sync_status = 'local_only' WHERE id IN (SELECT entity_id FROM sync_outbox WHERE entity_type = 'schedule' AND completed_at_utc IS NULL)",
        )
        .execute(&mut *transaction)
        .await
        .map_err(|error| AppError::database("google-disconnect-pending-local", error))?;
        if matches!(mode, DisconnectMode::DeleteMappedLocal) {
            sqlx::query(
                "UPDATE schedule_items SET deleted_at_utc = ?, version = version + 1, sync_status = 'local_only', updated_at_utc = ? WHERE id IN (SELECT m.schedule_item_id FROM sync_mappings m JOIN google_calendars c ON c.id = m.calendar_id WHERE c.account_id = ?)",
            )
            .bind(Utc::now().to_rfc3339())
            .bind(Utc::now().to_rfc3339())
            .bind(&account_id)
            .execute(&mut *transaction)
            .await
            .map_err(|error| AppError::database("google-disconnect-delete-local", error))?;
        } else {
            sqlx::query(
                "UPDATE schedule_items SET sync_status = 'local_only' WHERE id IN (SELECT m.schedule_item_id FROM sync_mappings m JOIN google_calendars c ON c.id = m.calendar_id WHERE c.account_id = ?)",
            )
            .bind(&account_id)
            .execute(&mut *transaction)
            .await
            .map_err(|error| AppError::database("google-disconnect-keep-local", error))?;
        }
        sqlx::query(
            "UPDATE sync_outbox SET completed_at_utc = ?, error_category = 'disconnected' WHERE completed_at_utc IS NULL",
        )
        .bind(Utc::now().to_rfc3339())
        .execute(&mut *transaction)
        .await
        .map_err(|error| AppError::database("google-disconnect-outbox", error))?;
        sqlx::query("DELETE FROM google_accounts WHERE id = ?")
            .bind(&account_id)
            .execute(&mut *transaction)
            .await
            .map_err(|error| AppError::database("google-disconnect-delete-account", error))?;
        transaction
            .commit()
            .await
            .map_err(|error| AppError::database("google-disconnect-commit", error))?;
        Ok(mapped_count.max(0) as u64)
    }

    pub async fn run_google_sync(
        &self,
        cancellation: &OperationCancellation,
    ) -> AppResult<SyncSummary> {
        let result = async {
            cancellation.check()?;
            record_google_sync_stage(self, "access_token").await?;
            sqlx::query(
                "UPDATE google_accounts SET next_retry_at_utc = NULL WHERE status = 'connected'",
            )
            .execute(&self.pool)
            .await
            .map_err(|error| AppError::database("sync-retry-clear", error))?;
            let client = Client::builder()
                .timeout(StdDuration::from_secs(30))
                .build()
                .map_err(|error| AppError::database("sync-http-client", error))?;
            let (account_id, access_token) = self.valid_access_token(&client).await?;
            cancellation.check()?;
            record_google_sync_stage(self, "calendar_list").await?;
            fetch_and_persist_calendars(
                self,
                &client,
                account_id,
                &access_token,
                Some(cancellation),
            )
            .await?;
            record_google_sync_stage(self, "push").await?;
            push_due_outbox(self, &client, &access_token, cancellation).await?;
            record_google_sync_stage(self, "pull").await?;
            pull_selected_calendars(self, &client, &access_token, cancellation).await?;
            record_google_sync_stage(self, "tasks").await?;
            sync_google_tasks(self, &client, account_id, &access_token, cancellation).await?;
            cancellation.check()?;
            record_google_sync_stage(self, "finalize").await?;
            let now = Utc::now().to_rfc3339();
            let has_incomplete_remote: bool = sqlx::query_scalar(
                "SELECT EXISTS(SELECT 1 FROM google_calendars WHERE account_id = ? AND selected = 1 AND sync_state != 'synced')
                 OR EXISTS(SELECT 1 FROM google_task_lists l JOIN google_tasks_config c ON c.singleton = 1 WHERE l.google_account_id = ? AND c.enabled = 1 AND l.selected = 1 AND l.sync_state != 'synced')
                 OR EXISTS(SELECT 1 FROM google_task_outbox WHERE completed_at_utc IS NULL)
                 OR EXISTS(SELECT 1 FROM google_task_conflicts WHERE resolved_at_utc IS NULL)",
            )
            .bind(account_id.to_string())
            .bind(account_id.to_string())
            .fetch_one(&self.pool)
            .await
            .map_err(|error| AppError::database("sync-account-remote-state", error))?;
            if has_incomplete_remote {
                sqlx::query(
                    "UPDATE google_accounts SET status = 'connected', next_retry_at_utc = NULL, updated_at_utc = ? WHERE id = ?",
                )
                .bind(&now)
                .bind(account_id.to_string())
                .execute(&self.pool)
                .await
                .map_err(|error| AppError::database("sync-account-partial", error))?;
            } else {
                sqlx::query(
                    "UPDATE google_accounts SET status = 'connected', last_completed_at_utc = ?, next_retry_at_utc = NULL, updated_at_utc = ? WHERE id = ?",
                )
                .bind(&now)
                .bind(&now)
                .bind(account_id.to_string())
                .execute(&self.pool)
                .await
                .map_err(|error| AppError::database("sync-account-complete", error))?;
            }
            record_google_sync_stage(self, "idle").await?;
            self.sync_summary().await
        }
        .await;
        if let Err(error) = &result {
            if matches!(error, AppError::Cancelled { .. }) {
                let _ = record_google_sync_stage(self, "cancelled").await;
            } else {
                let now = Utc::now();
                let retry_at = now + Duration::seconds(GOOGLE_SYNC_RETRY_SECONDS);
                let _ = sqlx::query(
                    "UPDATE google_accounts SET next_retry_at_utc = ?, updated_at_utc = ? WHERE status = 'connected'",
                )
                .bind(retry_at.to_rfc3339())
                .bind(now.to_rfc3339())
                .execute(&self.pool)
                .await;
            }
        }
        result
    }

    pub async fn run_google_tasks_full_reconcile(
        &self,
        cancellation: &OperationCancellation,
    ) -> AppResult<GoogleTasksConnection> {
        let client = Client::builder()
            .timeout(StdDuration::from_secs(30))
            .build()
            .map_err(|error| AppError::database("tasks-reconcile-http-client", error))?;
        let (account_id, access_token) = self.valid_access_token(&client).await?;
        reconcile_google_tasks_full(self, &client, account_id, &access_token, cancellation).await?;
        self.google_tasks_connection().await
    }

    async fn valid_access_token(&self, client: &Client) -> AppResult<(Uuid, String)> {
        let row = sqlx::query(
            "SELECT id, credential_key FROM google_accounts WHERE status IN ('connected', 'auth_required') ORDER BY updated_at_utc DESC LIMIT 1",
        )
        .fetch_optional(&self.pool)
        .await
        .map_err(|error| AppError::database("sync-account-read", error))?
        .ok_or_else(|| validation(
            "Googleアカウントが接続されていません。",
            "設定からGoogleへ接続してください。",
        ))?;
        let account_id = parse_uuid(row.get::<&str, _>("id"))?;
        let credential_key: String =
            row.get::<Option<String>, _>("credential_key")
                .ok_or_else(|| {
                    unavailable(
                        "Google認証情報の参照がありません。",
                        "Googleへ再接続してください。",
                    )
                })?;
        let mut token: TokenSecret =
            serde_json::from_str(&load_keyring(credential_key.clone()).await?).map_err(|_| {
                unavailable(
                    "OS秘密ストアのGoogle認証情報を解析できません。",
                    "Googleへ再接続してください。",
                )
            })?;
        if token.access_token.len() > 16_384
            || token.refresh_token.is_empty()
            || token.refresh_token.len() > 16_384
        {
            return Err(unavailable(
                "Google認証情報が正しくありません。",
                "Googleへ再接続してください。",
            ));
        }
        if token.expires_at > Utc::now() + Duration::seconds(90) {
            return Ok((account_id, token.access_token));
        }
        let config = self.oauth_config().await?;
        let mut form = vec![
            ("client_id", config.client_id.as_str()),
            ("refresh_token", token.refresh_token.as_str()),
            ("grant_type", "refresh_token"),
        ];
        if !config.client_secret.is_empty() {
            form.push(("client_secret", config.client_secret.as_str()));
        }
        let response = client
            .post(config.token_uri)
            .form(&form)
            .send()
            .await
            .map_err(|_| {
                unavailable(
                    "Googleトークンを更新できません。",
                    "ネットワークを確認して同期を再試行してください。",
                )
            })?;
        if matches!(
            response.status(),
            StatusCode::BAD_REQUEST | StatusCode::UNAUTHORIZED
        ) {
            mark_auth_required(self, account_id).await?;
            return Err(unavailable(
                "Googleへの再認証が必要です。",
                "ローカル予定は保持されています。設定からGoogleへ再接続してください。",
            ));
        }
        if !response.status().is_success() {
            return Err(unavailable(
                "Googleトークンを更新できません。",
                "時間を置いて同期を再試行してください。",
            ));
        }
        let refreshed: TokenResponse = response.json().await.map_err(|_| {
            unavailable(
                "Googleのトークン応答を解析できません。",
                "Googleへ再接続してください。",
            )
        })?;
        validate_token_response(&refreshed)?;
        token.access_token = refreshed.access_token;
        token.expires_at = Utc::now() + Duration::seconds(refreshed.expires_in.max(60));
        store_keyring(
            credential_key,
            serde_json::to_string(&token)
                .map_err(|error| AppError::database("sync-token-encode", error))?,
        )
        .await?;
        Ok((account_id, token.access_token))
    }

    async fn oauth_config(&self) -> AppResult<OAuthConfig> {
        let row = sqlx::query(
            "SELECT client_id, auth_uri, token_uri FROM google_oauth_config WHERE singleton = 1",
        )
        .fetch_optional(&self.pool)
        .await
        .map_err(|error| AppError::database("google-config-load", error))?;
        if let Some(row) = row {
            let auth_uri: String = row.get("auth_uri");
            let token_uri: String = row.get("token_uri");
            validate_google_endpoint(&auth_uri, "accounts.google.com")?;
            validate_google_endpoint(&token_uri, "oauth2.googleapis.com")?;
            return Ok(OAuthConfig {
                client_id: row.get("client_id"),
                client_secret: load_keyring(OAUTH_CLIENT_USER.to_owned()).await?,
                auth_uri,
                token_uri,
            });
        }
        let mut config = built_in_oauth_config(BUILT_IN_OAUTH_CLIENT_ID)?.ok_or_else(|| {
            validation(
                "このビルドではGoogle カレンダーへ接続できません。",
                "ローカル予定はそのまま利用できます。OAuth設定を含む個人用ビルドを利用してください。",
            )
        })?;
        config.client_secret = load_provisioned_oauth_secret(&config.client_id).await?;
        Ok(config)
    }
}

async fn complete_oauth(
    database: Database,
    listener: TcpListener,
    config: OAuthConfig,
    verifier: String,
    expected_state: String,
    redirect_uri: String,
    attempt_id: u64,
) -> Result<(), OAuthFailureCategory> {
    let (mut socket, _) = timeout(
        StdDuration::from_secs(LOOPBACK_TIMEOUT_SECONDS),
        listener.accept(),
    )
    .await
    .map_err(|_| OAuthFailureCategory::CallbackTimeout)?
    .map_err(|_| OAuthFailureCategory::CallbackInvalid)?;
    let mut buffer = vec![0_u8; 16_384];
    let count = timeout(StdDuration::from_secs(10), socket.read(&mut buffer))
        .await
        .map_err(|_| OAuthFailureCategory::CallbackTimeout)?
        .map_err(|_| OAuthFailureCategory::CallbackInvalid)?;
    let request =
        std::str::from_utf8(&buffer[..count]).map_err(|_| OAuthFailureCategory::CallbackInvalid)?;
    let target = request
        .lines()
        .next()
        .and_then(|line| line.split_whitespace().nth(1))
        .ok_or(OAuthFailureCategory::CallbackInvalid)?;
    let callback = Url::parse(&format!("http://127.0.0.1{target}"))
        .map_err(|_| OAuthFailureCategory::CallbackInvalid)?;
    let parameters = callback
        .query_pairs()
        .collect::<std::collections::HashMap<_, _>>();
    let state = parameters
        .get("state")
        .map(|value| value.as_ref())
        .unwrap_or("");
    let code = parameters
        .get("code")
        .map(|value| value.as_ref())
        .unwrap_or("");
    let callback_error = parameters.get("error").map(|value| value.as_ref());
    let success = callback_error.is_none()
        && !code.is_empty()
        && constant_time_eq(state.as_bytes(), expected_state.as_bytes());
    let response_body = if success {
        "<!doctype html><meta charset=utf-8><title>接続を確認中</title><p>Day Schedule Next で接続を確認しています。このタブは閉じられます。</p>"
    } else {
        "<!doctype html><meta charset=utf-8><title>接続できませんでした</title><p>接続を確認できませんでした。アプリへ戻って再試行してください。</p>"
    };
    let response = format!(
        "HTTP/1.1 {}\r\nContent-Type: text/html; charset=utf-8\r\nContent-Length: {}\r\nConnection: close\r\nCache-Control: no-store\r\n\r\n{}",
        if success { "200 OK" } else { "400 Bad Request" },
        response_body.len(),
        response_body
    );
    socket
        .write_all(response.as_bytes())
        .await
        .map_err(|_| OAuthFailureCategory::CallbackInvalid)?;
    if !success {
        return Err(match callback_error {
            Some("access_denied") => OAuthFailureCategory::AccessDenied,
            Some("admin_policy_enforced" | "org_internal") => OAuthFailureCategory::PolicyDenied,
            _ => OAuthFailureCategory::CallbackInvalid,
        });
    }
    ensure_oauth_attempt_is_current(attempt_id)
        .map_err(|_| OAuthFailureCategory::AttemptCancelled)?;
    let client = Client::builder()
        .timeout(StdDuration::from_secs(30))
        .build()
        .map_err(|_| OAuthFailureCategory::TokenNetwork)?;
    let mut form = vec![
        ("client_id", config.client_id.as_str()),
        ("code", code),
        ("code_verifier", verifier.as_str()),
        ("grant_type", "authorization_code"),
        ("redirect_uri", redirect_uri.as_str()),
    ];
    if !config.client_secret.is_empty() {
        form.push(("client_secret", config.client_secret.as_str()));
    }
    let response = client
        .post(&config.token_uri)
        .form(&form)
        .send()
        .await
        .map_err(|_| OAuthFailureCategory::TokenNetwork)?;
    if !response.status().is_success() {
        let category = response
            .json::<OAuthErrorResponse>()
            .await
            .ok()
            .map(|body| token_failure_category(&body.error))
            .unwrap_or(OAuthFailureCategory::TokenRejected);
        return Err(category);
    }
    let token: TokenResponse = response
        .json()
        .await
        .map_err(|_| OAuthFailureCategory::TokenResponseInvalid)?;
    validate_token_response(&token).map_err(|_| OAuthFailureCategory::TokenScopeInvalid)?;
    ensure_oauth_attempt_is_current(attempt_id)
        .map_err(|_| OAuthFailureCategory::AttemptCancelled)?;
    let account = oauth_account_target(&database)
        .await
        .map_err(|_| OAuthFailureCategory::AccountPersistenceFailed)?;
    let refresh_token = match token.refresh_token {
        Some(value) => value,
        None if account.existing => {
            let previous = load_keyring(account.credential_key.clone())
                .await
                .map_err(|_| OAuthFailureCategory::RefreshTokenMissing)?;
            serde_json::from_str::<TokenSecret>(&previous)
                .map_err(|_| OAuthFailureCategory::RefreshTokenMissing)?
                .refresh_token
        }
        None => return Err(OAuthFailureCategory::RefreshTokenMissing),
    };
    let secret = TokenSecret {
        access_token: token.access_token,
        refresh_token,
        expires_at: Utc::now() + Duration::seconds(token.expires_in.max(60)),
    };
    if account.existing {
        // Validate both APIs before replacing the credential used by an existing
        // Calendar connection. A partial grant or Tasks failure keeps the old
        // credential usable.
        fetch_and_persist_calendars(
            &database,
            &client,
            account.account_id,
            &secret.access_token,
            None,
        )
        .await
        .map_err(|_| OAuthFailureCategory::CalendarFetchFailed)?;
        fetch_and_persist_task_lists_for_oauth(
            &database,
            &client,
            account.account_id,
            &secret.access_token,
        )
        .await
        .map_err(|_| OAuthFailureCategory::TasksFetchFailed)?;
        store_keyring(
            account.credential_key.clone(),
            serde_json::to_string(&secret)
                .map_err(|_| OAuthFailureCategory::CredentialStoreFailed)?,
        )
        .await
        .map_err(|_| OAuthFailureCategory::CredentialStoreFailed)?;
        persist_connected_account(&database, &account, &Utc::now().to_rfc3339())
            .await
            .map_err(|_| OAuthFailureCategory::AccountPersistenceFailed)
    } else {
        if store_keyring(
            account.credential_key.clone(),
            serde_json::to_string(&secret)
                .map_err(|_| OAuthFailureCategory::CredentialStoreFailed)?,
        )
        .await
        .is_err()
        {
            return Err(OAuthFailureCategory::CredentialStoreFailed);
        }
        let provision_result = async {
            persist_connected_account(&database, &account, &Utc::now().to_rfc3339())
                .await
                .map_err(|_| OAuthFailureCategory::AccountPersistenceFailed)?;
            fetch_and_persist_calendars(
                &database,
                &client,
                account.account_id,
                &secret.access_token,
                None,
            )
            .await
            .map_err(|_| OAuthFailureCategory::CalendarFetchFailed)?;
            fetch_and_persist_task_lists_for_oauth(
                &database,
                &client,
                account.account_id,
                &secret.access_token,
            )
            .await
            .map_err(|_| OAuthFailureCategory::TasksFetchFailed)
        }
        .await;
        if let Err(category) = provision_result {
            let _ = sqlx::query("DELETE FROM google_accounts WHERE id = ?")
                .bind(account.account_id.to_string())
                .execute(&database.pool)
                .await;
            let _ = delete_keyring(account.credential_key).await;
            return Err(category);
        }
        Ok(())
    }
}

async fn oauth_account_target(database: &Database) -> AppResult<OAuthAccountTarget> {
    let existing = sqlx::query(
        "SELECT id, credential_key FROM google_accounts WHERE status != 'disconnected' ORDER BY updated_at_utc DESC LIMIT 1",
    )
    .fetch_optional(&database.pool)
    .await
    .map_err(|error| AppError::database("oauth-account-read", error))?;
    if let Some(existing) = existing {
        let account_id = parse_uuid(existing.get("id"))?;
        let credential_key = existing
            .get::<Option<String>, _>("credential_key")
            .unwrap_or_else(|| format!("google-account-{account_id}"));
        return Ok(OAuthAccountTarget {
            account_id,
            credential_key,
            existing: true,
        });
    }
    let account_id = Uuid::new_v4();
    Ok(OAuthAccountTarget {
        account_id,
        credential_key: format!("google-account-{account_id}"),
        existing: false,
    })
}

async fn persist_connected_account(
    database: &Database,
    account: &OAuthAccountTarget,
    now: &str,
) -> AppResult<()> {
    let scopes = serde_json::json!([CALENDAR_SCOPE, CALENDAR_LIST_SCOPE, TASKS_SCOPE]).to_string();
    let mut transaction = database
        .pool
        .begin()
        .await
        .map_err(|error| AppError::database("oauth-account-begin", error))?;
    if account.existing {
        let updated = sqlx::query(
            "UPDATE google_accounts SET display_label = 'Google Calendar', scopes_json = ?, status = 'connected', updated_at_utc = ?, credential_key = ? WHERE id = ?",
        )
        .bind(&scopes)
        .bind(now)
        .bind(&account.credential_key)
        .bind(account.account_id.to_string())
        .execute(&mut *transaction)
        .await
        .map_err(|error| AppError::database("oauth-account-update", error))?;
        if updated.rows_affected() != 1 {
            return Err(AppError::database(
                "oauth-account-update-missing",
                "account disappeared during OAuth completion",
            ));
        }
    } else {
        sqlx::query(
            "INSERT INTO google_accounts(id, display_label, scopes_json, status, created_at_utc, updated_at_utc, credential_key) VALUES (?, 'Google Calendar', ?, 'connected', ?, ?, ?)",
        )
        .bind(account.account_id.to_string())
        .bind(&scopes)
        .bind(now)
        .bind(now)
        .bind(&account.credential_key)
        .execute(&mut *transaction)
        .await
        .map_err(|error| AppError::database("oauth-account-insert", error))?;
    }
    transaction
        .commit()
        .await
        .map_err(|error| AppError::database("oauth-account-commit", error))
}

async fn fetch_and_persist_calendars(
    database: &Database,
    client: &Client,
    account_id: Uuid,
    access_token: &str,
    cancellation: Option<&OperationCancellation>,
) -> AppResult<()> {
    fetch_and_persist_calendars_at(
        database,
        client,
        account_id,
        access_token,
        cancellation,
        GOOGLE_CALENDAR_LIST_URL,
    )
    .await
}

async fn fetch_and_persist_calendars_at(
    database: &Database,
    client: &Client,
    account_id: Uuid,
    access_token: &str,
    cancellation: Option<&OperationCancellation>,
    calendar_list_url: &str,
) -> AppResult<()> {
    let mut page_token: Option<String> = None;
    let mut calendars = Vec::new();
    loop {
        check_optional_cancellation(cancellation)?;
        let mut url = Url::parse(calendar_list_url)
            .map_err(|error| AppError::database("calendar-list-url", error))?;
        url.query_pairs_mut().append_pair("maxResults", "250");
        if let Some(token) = &page_token {
            url.query_pairs_mut().append_pair("pageToken", token);
        }
        let response = client
            .get(url)
            .bearer_auth(access_token)
            .send()
            .await
            .map_err(|_| {
                unavailable(
                    "Googleカレンダー一覧を取得できません。",
                    "ネットワークを確認して再試行してください。",
                )
            })?;
        if !response.status().is_success() {
            if response.status() == StatusCode::UNAUTHORIZED {
                mark_auth_required(database, account_id).await?;
                return Err(unavailable(
                    "Googleへの再認証が必要です。",
                    "ローカル予定は保持されています。設定から再接続してください。",
                ));
            }
            return Err(unavailable(
                "Googleカレンダー一覧を取得できません。",
                "接続状態を確認して再試行してください。",
            ));
        }
        let page: CalendarListPage = response.json().await.map_err(|_| {
            unavailable(
                "Googleカレンダー一覧を解析できません。",
                "同期を再試行してください。",
            )
        })?;
        check_optional_cancellation(cancellation)?;
        calendars.extend(page.items);
        page_token = page.next_page_token;
        if page_token.is_none() {
            break;
        }
    }
    if calendars.len() > 10_000 {
        return Err(validation(
            "Googleカレンダーの件数が安全な上限を超えています。",
            "同期対象を整理してから再接続してください。",
        ));
    }
    let mut transaction = database
        .pool
        .begin()
        .await
        .map_err(|error| AppError::database("calendar-list-save-begin", error))?;
    let already_has_default: i64 = sqlx::query_scalar(
        "SELECT EXISTS(SELECT 1 FROM google_calendars WHERE default_write_target = 1)",
    )
    .fetch_one(&mut *transaction)
    .await
    .map_err(|error| AppError::database("calendar-list-default-check", error))?;
    let mut may_assign_primary_default = already_has_default == 0;
    for remote in calendars {
        check_optional_cancellation(cancellation)?;
        validate_remote_calendar(&remote)?;
        let local_id = sqlx::query_scalar::<_, String>(
            "SELECT id FROM google_calendars WHERE account_id = ? AND remote_calendar_id = ?",
        )
        .bind(account_id.to_string())
        .bind(&remote.id)
        .fetch_optional(&mut *transaction)
        .await
        .map_err(|error| AppError::database("calendar-list-existing", error))?
        .unwrap_or_else(|| Uuid::new_v4().to_string());
        let writable = matches!(remote.access_role.as_str(), "owner" | "writer");
        let event_readable = can_read_event_details(&remote.access_role);
        let make_default = may_assign_primary_default && remote.primary && writable;
        if make_default {
            may_assign_primary_default = false;
        }
        sqlx::query(
            "INSERT INTO google_calendars(id, account_id, remote_calendar_id, display_name, color, time_zone, access_role, selected, default_write_target) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?) ON CONFLICT(account_id, remote_calendar_id) DO UPDATE SET display_name = excluded.display_name, color = excluded.color, time_zone = excluded.time_zone, access_role = excluded.access_role, selected = CASE WHEN excluded.access_role = 'freeBusyReader' THEN 0 ELSE google_calendars.selected END, default_write_target = CASE WHEN excluded.access_role = 'freeBusyReader' THEN 0 ELSE google_calendars.default_write_target END",
        )
        .bind(local_id)
        .bind(account_id.to_string())
        .bind(remote.id)
        .bind(remote.summary)
        .bind(remote.background_color)
        .bind(remote.time_zone)
        .bind(remote.access_role)
        .bind(event_readable && (remote.selected || remote.primary))
        .bind(make_default)
        .execute(&mut *transaction)
        .await
        .map_err(|error| AppError::database("calendar-list-upsert", error))?;
    }
    check_optional_cancellation(cancellation)?;
    transaction
        .commit()
        .await
        .map_err(|error| AppError::database("calendar-list-save-commit", error))?;
    Ok(())
}

async fn push_due_outbox(
    database: &Database,
    client: &Client,
    access_token: &str,
    cancellation: &OperationCancellation,
) -> AppResult<()> {
    cancellation.check()?;
    let rows = sqlx::query(
        "SELECT id, entity_id, entity_version, operation, attempt_count FROM sync_outbox WHERE completed_at_utc IS NULL AND next_attempt_at_utc <= ? ORDER BY created_at_utc, id LIMIT 100",
    )
    .bind(Utc::now().to_rfc3339())
    .fetch_all(&database.pool)
    .await
    .map_err(|error| AppError::database("sync-outbox-list", error))?;
    for row in rows {
        cancellation.check()?;
        let outbox_id: String = row.get("id");
        let schedule_id = parse_uuid(row.get::<&str, _>("entity_id"))?;
        let operation: String = row.get("operation");
        let attempts = row.get::<i64, _>("attempt_count").max(0) as u32;
        match push_one_outbox(database, client, access_token, schedule_id, &operation).await {
            Ok(()) => {
                sqlx::query(
                    "UPDATE sync_outbox SET completed_at_utc = ?, error_category = NULL WHERE id = ?",
                )
                .bind(Utc::now().to_rfc3339())
                .bind(&outbox_id)
                .execute(&database.pool)
                .await
                .map_err(|error| AppError::database("sync-outbox-complete", error))?;
            }
            Err(HttpFailure::Auth) => {
                let account_id: Option<String> = sqlx::query_scalar(
                    "SELECT id FROM google_accounts WHERE status != 'disconnected' LIMIT 1",
                )
                .fetch_optional(&database.pool)
                .await
                .map_err(|error| AppError::database("sync-auth-account", error))?;
                if let Some(account_id) = account_id {
                    mark_auth_required(database, parse_uuid(&account_id)?).await?;
                }
                mark_outbox_failure(database, &outbox_id, attempts, "auth_required", None).await?;
                return Err(unavailable(
                    "Googleへの再認証が必要です。",
                    "ローカル予定は保持されています。設定からGoogleへ再接続してください。",
                ));
            }
            Err(HttpFailure::Conflict(remote)) => {
                if save_outbox_conflict(database, schedule_id, remote).await? {
                    mark_outbox_failure(database, &outbox_id, attempts, "conflict", None).await?;
                } else {
                    mark_outbox_failure(database, &outbox_id, attempts, "merged", Some(0)).await?;
                }
            }
            Err(HttpFailure::Retryable(retry_after)) => {
                mark_outbox_failure(database, &outbox_id, attempts, "retryable", retry_after)
                    .await?;
            }
            Err(HttpFailure::Forbidden) => {
                if let Some(calendar_id) = sqlx::query_scalar::<_, String>(
                    "SELECT calendar_id FROM sync_mappings WHERE schedule_item_id = ? LIMIT 1",
                )
                .bind(schedule_id.to_string())
                .fetch_optional(&database.pool)
                .await
                .map_err(|error| AppError::database("sync-outbox-permission-calendar", error))?
                {
                    mark_calendar_unavailable(database, &calendar_id, "permission").await?;
                }
                mark_outbox_failure(database, &outbox_id, attempts, "permission", None).await?;
            }
            Err(HttpFailure::NotFound) => {
                if let Some(calendar_id) = sqlx::query_scalar::<_, String>(
                    "SELECT calendar_id FROM sync_mappings WHERE schedule_item_id = ? LIMIT 1",
                )
                .bind(schedule_id.to_string())
                .fetch_optional(&database.pool)
                .await
                .map_err(|error| AppError::database("sync-outbox-missing-calendar", error))?
                {
                    mark_calendar_unavailable(database, &calendar_id, "not_found").await?;
                }
                mark_outbox_failure(database, &outbox_id, attempts, "not_found", None).await?;
            }
            Err(HttpFailure::Gone | HttpFailure::Permanent) => {
                mark_outbox_failure(database, &outbox_id, attempts, "permanent", None).await?;
            }
        }
        cancellation.check()?;
    }
    Ok(())
}

async fn push_one_outbox(
    database: &Database,
    client: &Client,
    access_token: &str,
    schedule_id: Uuid,
    operation: &str,
) -> Result<(), HttpFailure> {
    let schedule_row = sqlx::query("SELECT * FROM schedule_items WHERE id = ?")
        .bind(schedule_id.to_string())
        .fetch_optional(&database.pool)
        .await
        .map_err(|_| HttpFailure::Retryable(None))?;
    let Some(schedule_row) = schedule_row else {
        return Ok(());
    };
    let schedule = row_to_schedule(&schedule_row).map_err(|_| HttpFailure::Permanent)?;
    let mapping = sqlx::query(
        "SELECT m.calendar_id, m.remote_event_id, m.etag, c.remote_calendar_id FROM sync_mappings m JOIN google_calendars c ON c.id = m.calendar_id WHERE m.schedule_item_id = ? LIMIT 1",
    )
    .bind(schedule_id.to_string())
    .fetch_optional(&database.pool)
    .await
    .map_err(|_| HttpFailure::Retryable(None))?;
    let (calendar_id, remote_calendar_id, remote_event_id, known_etag) = if let Some(mapping) =
        mapping
    {
        (
            mapping.get::<String, _>("calendar_id"),
            mapping.get::<String, _>("remote_calendar_id"),
            mapping.get::<String, _>("remote_event_id"),
            mapping.get::<Option<String>, _>("etag"),
        )
    } else {
        let calendar = sqlx::query(
            "SELECT id, remote_calendar_id FROM google_calendars WHERE default_write_target = 1 AND selected = 1 AND access_role IN ('owner', 'writer') LIMIT 1",
        )
        .fetch_optional(&database.pool)
        .await
        .map_err(|_| HttpFailure::Retryable(None))?
        .ok_or(HttpFailure::Permanent)?;
        (
            calendar.get("id"),
            calendar.get("remote_calendar_id"),
            google_event_id(schedule_id),
            None,
        )
    };
    let event_url = event_url(&remote_calendar_id, Some(&remote_event_id))
        .map_err(|_| HttpFailure::Permanent)?;
    if operation == "delete" {
        if known_etag.is_none() {
            return Ok(());
        }
        let current = client
            .get(event_url.clone())
            .bearer_auth(access_token)
            .send()
            .await
            .map_err(|_| HttpFailure::Retryable(None))?;
        if current.status() == StatusCode::NOT_FOUND {
            return finalize_remote_success(
                database,
                &schedule,
                &calendar_id,
                &remote_event_id,
                None,
            )
            .await
            .map_err(|_| HttpFailure::Retryable(None));
        }
        if !current.status().is_success() {
            return Err(classify_http(&current));
        }
        let current_etag = current
            .headers()
            .get("etag")
            .and_then(|value| value.to_str().ok())
            .map(str::to_owned);
        if known_etag.is_some() && current_etag != known_etag {
            return Err(HttpFailure::Conflict(Some(
                response_json_limited(current).await?,
            )));
        }
        let mut request = client.delete(event_url).bearer_auth(access_token);
        if let Some(etag) = &known_etag {
            request = request.header("If-Match", etag);
        }
        let response = request
            .send()
            .await
            .map_err(|_| HttpFailure::Retryable(None))?;
        if response.status().is_success() || response.status() == StatusCode::NOT_FOUND {
            return finalize_remote_success(
                database,
                &schedule,
                &calendar_id,
                &remote_event_id,
                None,
            )
            .await
            .map_err(|_| HttpFailure::Retryable(None));
        }
        if response.status() == StatusCode::PRECONDITION_FAILED {
            return Err(HttpFailure::Conflict(
                fetch_remote_event(client, access_token, &remote_calendar_id, &remote_event_id)
                    .await?,
            ));
        }
        return Err(classify_http(&response));
    }
    let result = if known_etag.is_some() {
        let current = client
            .get(event_url.clone())
            .bearer_auth(access_token)
            .send()
            .await
            .map_err(|_| HttpFailure::Retryable(None))?;
        if current.status() == StatusCode::NOT_FOUND {
            create_remote_event(
                client,
                access_token,
                &remote_calendar_id,
                &schedule,
                &remote_event_id,
            )
            .await?
        } else if current.status().is_success() {
            let current_etag = current
                .headers()
                .get("etag")
                .and_then(|value| value.to_str().ok())
                .map(str::to_owned);
            if known_etag.is_some() && current_etag != known_etag {
                return Err(HttpFailure::Conflict(Some(
                    response_json_limited(current).await?,
                )));
            }
            let mut remote = response_json_limited(current).await?;
            apply_owned_fields(&mut remote, &schedule, &remote_event_id)
                .map_err(|_| HttpFailure::Permanent)?;
            let mut request = client
                .put(event_url)
                .bearer_auth(access_token)
                .json(&remote);
            if let Some(etag) = &known_etag {
                request = request.header("If-Match", etag);
            }
            let response = request
                .send()
                .await
                .map_err(|_| HttpFailure::Retryable(None))?;
            if !response.status().is_success() {
                if response.status() == StatusCode::PRECONDITION_FAILED {
                    return Err(HttpFailure::Conflict(
                        fetch_remote_event(
                            client,
                            access_token,
                            &remote_calendar_id,
                            &remote_event_id,
                        )
                        .await?,
                    ));
                }
                return Err(classify_http(&response));
            }
            response_json_limited(response).await?
        } else {
            return Err(classify_http(&current));
        }
    } else {
        create_remote_event(
            client,
            access_token,
            &remote_calendar_id,
            &schedule,
            &remote_event_id,
        )
        .await?
    };
    finalize_remote_success(
        database,
        &schedule,
        &calendar_id,
        &remote_event_id,
        Some(&result),
    )
    .await
    .map_err(|_| HttpFailure::Retryable(None))
}

async fn fetch_remote_event(
    client: &Client,
    access_token: &str,
    calendar_id: &str,
    event_id: &str,
) -> Result<Option<Value>, HttpFailure> {
    let response = client
        .get(event_url(calendar_id, Some(event_id)).map_err(|_| HttpFailure::Permanent)?)
        .bearer_auth(access_token)
        .send()
        .await
        .map_err(|_| HttpFailure::Retryable(None))?;
    if response.status() == StatusCode::NOT_FOUND {
        return Ok(None);
    }
    if !response.status().is_success() {
        return Err(classify_http(&response));
    }
    response_json_limited(response).await.map(Some)
}

async fn create_remote_event(
    client: &Client,
    access_token: &str,
    remote_calendar_id: &str,
    schedule: &Schedule,
    event_id: &str,
) -> Result<Value, HttpFailure> {
    let url = event_url(remote_calendar_id, None).map_err(|_| HttpFailure::Permanent)?;
    let mut body = serde_json::json!({});
    apply_owned_fields(&mut body, schedule, event_id).map_err(|_| HttpFailure::Permanent)?;
    let response = client
        .post(url)
        .bearer_auth(access_token)
        .json(&body)
        .send()
        .await
        .map_err(|_| HttpFailure::Retryable(None))?;
    if response.status() == StatusCode::CONFLICT {
        let existing = client
            .get(
                event_url(remote_calendar_id, Some(event_id))
                    .map_err(|_| HttpFailure::Permanent)?,
            )
            .bearer_auth(access_token)
            .send()
            .await
            .map_err(|_| HttpFailure::Retryable(None))?;
        if !existing.status().is_success() {
            return Err(classify_http(&existing));
        }
        return response_json_limited(existing).await;
    }
    if !response.status().is_success() {
        return Err(classify_http(&response));
    }
    response_json_limited(response).await
}

async fn finalize_remote_success(
    database: &Database,
    schedule: &Schedule,
    calendar_id: &str,
    remote_event_id: &str,
    remote: Option<&Value>,
) -> AppResult<()> {
    let etag = remote
        .and_then(|value| value.get("etag"))
        .and_then(Value::as_str);
    let updated = remote
        .and_then(|value| value.get("updated"))
        .and_then(Value::as_str);
    let base_json = serde_json::to_string(&schedule.draft)
        .map_err(|error| AppError::database("sync-base-encode", error))?;
    let base_hash = format!("{:x}", Sha256::digest(base_json.as_bytes()));
    let mut transaction = database
        .pool
        .begin()
        .await
        .map_err(|error| AppError::database("sync-finalize-begin", error))?;
    if remote.is_some() {
        sqlx::query(
            "INSERT INTO sync_mappings(schedule_item_id, calendar_id, remote_event_id, etag, remote_updated_at_utc, base_snapshot_json, base_hash) VALUES (?, ?, ?, ?, ?, ?, ?) ON CONFLICT(schedule_item_id, calendar_id) DO UPDATE SET remote_event_id = excluded.remote_event_id, etag = excluded.etag, remote_updated_at_utc = excluded.remote_updated_at_utc, base_snapshot_json = excluded.base_snapshot_json, base_hash = excluded.base_hash",
        )
        .bind(schedule.id.to_string())
        .bind(calendar_id)
        .bind(remote_event_id)
        .bind(etag)
        .bind(updated)
        .bind(&base_json)
        .bind(&base_hash)
        .execute(&mut *transaction)
        .await
        .map_err(|error| AppError::database("sync-mapping-save", error))?;
    }
    sqlx::query("UPDATE schedule_items SET sync_status = 'synced' WHERE id = ?")
        .bind(schedule.id.to_string())
        .execute(&mut *transaction)
        .await
        .map_err(|error| AppError::database("sync-schedule-complete", error))?;
    transaction
        .commit()
        .await
        .map_err(|error| AppError::database("sync-finalize-commit", error))?;
    Ok(())
}

async fn pull_selected_calendars(
    database: &Database,
    client: &Client,
    access_token: &str,
    cancellation: &OperationCancellation,
) -> AppResult<()> {
    pull_selected_calendars_at(
        database,
        client,
        access_token,
        cancellation,
        GOOGLE_CALENDAR_API_ROOT,
    )
    .await
}

async fn pull_selected_calendars_at(
    database: &Database,
    client: &Client,
    access_token: &str,
    cancellation: &OperationCancellation,
    api_root: &str,
) -> AppResult<()> {
    cancellation.check()?;
    let calendars = sqlx::query(
        "SELECT id, remote_calendar_id, access_role, sync_token FROM google_calendars WHERE selected = 1 AND access_role != 'freeBusyReader' ORDER BY remote_calendar_id, id",
    )
    .fetch_all(&database.pool)
    .await
    .map_err(|error| AppError::database("sync-calendar-list", error))?;
    record_google_sync_stage(database, "pull_calendars_loaded").await?;
    for calendar in calendars {
        cancellation.check()?;
        let local_id: String = calendar.get("id");
        let remote_id: String = calendar.get("remote_calendar_id");
        let role: String = calendar.get("access_role");
        let sync_token: Option<String> = calendar.get("sync_token");
        match pull_one_calendar_at(
            database,
            client,
            access_token,
            CalendarPullRequest {
                local_calendar_id: &local_id,
                remote_calendar_id: &remote_id,
                access_role: &role,
                initial_sync_token: sync_token.as_deref(),
                api_root,
            },
            cancellation,
        )
        .await
        {
            Ok(()) => {}
            Err(error @ AppError::Cancelled { .. }) | Err(error @ AppError::Database { .. }) => {
                return Err(error);
            }
            Err(error) => {
                let state: String =
                    sqlx::query_scalar("SELECT sync_state FROM google_calendars WHERE id = ?")
                        .bind(&local_id)
                        .fetch_one(&database.pool)
                        .await
                        .map_err(|database_error| {
                            AppError::database("sync-calendar-failure-state", database_error)
                        })?;
                if state == "auth_required" {
                    return Err(error);
                }
                if !matches!(state.as_str(), "retry_scheduled" | "unavailable") {
                    return Err(error);
                }
            }
        }
    }
    Ok(())
}

async fn record_google_sync_stage(database: &Database, stage: &str) -> AppResult<()> {
    sqlx::query(
        "INSERT INTO app_meta(key, value, updated_at_utc) VALUES ('google_sync_stage', ?, ?) ON CONFLICT(key) DO UPDATE SET value = excluded.value, updated_at_utc = excluded.updated_at_utc",
    )
    .bind(stage)
    .bind(Utc::now().to_rfc3339())
    .execute(&database.pool)
    .await
    .map_err(|error| AppError::database("sync-stage", error))?;
    Ok(())
}

#[derive(Clone, Copy)]
struct CalendarPullRequest<'a> {
    local_calendar_id: &'a str,
    remote_calendar_id: &'a str,
    access_role: &'a str,
    initial_sync_token: Option<&'a str>,
    api_root: &'a str,
}

async fn pull_one_calendar_at(
    database: &Database,
    client: &Client,
    access_token: &str,
    request: CalendarPullRequest<'_>,
    cancellation: &OperationCancellation,
) -> AppResult<()> {
    let previous_state: String =
        sqlx::query_scalar("SELECT sync_state FROM google_calendars WHERE id = ?")
            .bind(request.local_calendar_id)
            .fetch_one(&database.pool)
            .await
            .map_err(|error| AppError::database("sync-calendar-previous-state", error))?;
    let stable_previous_state = if previous_state == "syncing" {
        if request.initial_sync_token.is_some() {
            "synced"
        } else {
            "never"
        }
    } else {
        previous_state.as_str()
    };
    sqlx::query(
        "UPDATE google_calendars SET sync_state = 'syncing', last_sync_attempt_at_utc = ?, next_retry_at_utc = NULL, last_error_category = NULL WHERE id = ?",
    )
    .bind(Utc::now().to_rfc3339())
    .bind(request.local_calendar_id)
    .execute(&database.pool)
    .await
    .map_err(|error| AppError::database("sync-calendar-attempt", error))?;

    let result =
        pull_one_calendar_pages(database, client, access_token, request, cancellation).await;
    if let Err(error) = &result {
        let current_state: String =
            sqlx::query_scalar("SELECT sync_state FROM google_calendars WHERE id = ?")
                .bind(request.local_calendar_id)
                .fetch_one(&database.pool)
                .await
                .map_err(|database_error| {
                    AppError::database("sync-calendar-current-state", database_error)
                })?;
        if current_state == "syncing" {
            match error {
                AppError::Cancelled { .. } | AppError::Database { .. } => {
                    restore_calendar_sync_state(
                        database,
                        request.local_calendar_id,
                        stable_previous_state,
                    )
                    .await?;
                }
                AppError::Validation { .. }
                | AppError::Conflict { .. }
                | AppError::NotFound { .. } => {
                    mark_calendar_unavailable(database, request.local_calendar_id, "validation")
                        .await?;
                }
                AppError::Unavailable { .. } => {
                    mark_calendar_retry(database, request.local_calendar_id, "network", None)
                        .await?;
                }
            }
        }
    }
    result
}

async fn pull_one_calendar_pages(
    database: &Database,
    client: &Client,
    access_token: &str,
    request: CalendarPullRequest<'_>,
    cancellation: &OperationCancellation,
) -> AppResult<()> {
    let calendar_timezone_id: String =
        sqlx::query_scalar("SELECT time_zone FROM google_calendars WHERE id = ?")
            .bind(request.local_calendar_id)
            .fetch_one(&database.pool)
            .await
            .map_err(|error| AppError::database("sync-calendar-timezone", error))?;
    let mut sync_token = request.initial_sync_token.map(str::to_owned);
    let mut retried_full = false;
    loop {
        cancellation.check()?;
        let is_full_sync = sync_token.is_none();
        let mut page_token: Option<String> = None;
        let mut final_sync_token: Option<String> = None;
        let mut staged_events = Vec::new();
        loop {
            cancellation.check()?;
            let mut url = event_url_at(request.api_root, request.remote_calendar_id, None)?;
            {
                let mut query = url.query_pairs_mut();
                query
                    .append_pair("showDeleted", "true")
                    .append_pair("singleEvents", "false")
                    .append_pair("maxResults", GOOGLE_EVENTS_PAGE_SIZE);
                if let Some(token) = &sync_token {
                    query.append_pair("syncToken", token);
                }
                if let Some(token) = &page_token {
                    query.append_pair("pageToken", token);
                }
            }
            record_google_sync_stage(database, "pull_request").await?;
            let response = client.get(url).bearer_auth(access_token).send().await;
            let response = match response {
                Ok(response) => response,
                Err(_) => {
                    mark_calendar_retry(database, request.local_calendar_id, "network", None)
                        .await?;
                    return Err(unavailable(
                        "Google差分同期へ接続できません。",
                        "ローカル編集は保存されています。ネットワーク復帰後に再試行してください。",
                    ));
                }
            };
            if response.status() == StatusCode::GONE && sync_token.is_some() && !retried_full {
                sync_token = None;
                retried_full = true;
                break;
            }
            if !response.status().is_success() {
                let failure = classify_http(&response);
                match failure {
                    HttpFailure::Auth => {
                        let account_id: String = sqlx::query_scalar(
                            "SELECT account_id FROM google_calendars WHERE id = ?",
                        )
                        .bind(request.local_calendar_id)
                        .fetch_one(&database.pool)
                        .await
                        .map_err(|error| AppError::database("sync-calendar-account", error))?;
                        mark_auth_required(database, parse_uuid(&account_id)?).await?;
                    }
                    HttpFailure::Forbidden => {
                        mark_calendar_unavailable(
                            database,
                            request.local_calendar_id,
                            "permission",
                        )
                        .await?;
                    }
                    HttpFailure::NotFound => {
                        mark_calendar_unavailable(database, request.local_calendar_id, "not_found")
                            .await?;
                    }
                    HttpFailure::Retryable(retry_after) => {
                        let category = if response.status() == StatusCode::TOO_MANY_REQUESTS {
                            "rate_limited"
                        } else {
                            "server"
                        };
                        mark_calendar_retry(
                            database,
                            request.local_calendar_id,
                            category,
                            retry_after,
                        )
                        .await?;
                    }
                    HttpFailure::Permanent | HttpFailure::Conflict(_) | HttpFailure::Gone => {
                        mark_calendar_unavailable(
                            database,
                            request.local_calendar_id,
                            "validation",
                        )
                        .await?;
                    }
                }
                return Err(sync_failure_error(failure, "Google同期"));
            }
            let page_value = match response_json_limited(response).await {
                Ok(value) => value,
                Err(failure) => {
                    match failure {
                        HttpFailure::Retryable(retry_after) => {
                            mark_calendar_retry(
                                database,
                                request.local_calendar_id,
                                "network",
                                retry_after,
                            )
                            .await?;
                        }
                        _ => {
                            mark_calendar_unavailable(
                                database,
                                request.local_calendar_id,
                                "validation",
                            )
                            .await?;
                        }
                    }
                    return Err(sync_failure_error(failure, "Googleイベント一覧"));
                }
            };
            record_google_sync_stage(database, "pull_response").await?;
            let page: EventListPage = serde_json::from_value(page_value).map_err(|_| {
                validation(
                    "Googleイベント一覧を解析できません。",
                    "同期トークンは更新していません。時間を置いて再試行してください。",
                )
            })?;
            cancellation.check()?;
            if staged_events.len() + page.items.len() > 100_000 {
                return Err(validation(
                    "1回の同期イベント数が安全な上限を超えました。",
                    "同期対象カレンダーを分けてください。",
                ));
            }
            staged_events.extend(page.items);
            page_token = page.next_page_token;
            if page_token.is_none() {
                final_sync_token = page.next_sync_token;
                break;
            }
        }
        if retried_full && sync_token.is_none() && final_sync_token.is_none() {
            continue;
        }
        record_google_sync_stage(database, "pull_apply").await?;
        let mut transaction = database
            .pool
            .begin()
            .await
            .map_err(|error| AppError::database("sync-pull-begin", error))?;
        let seen_remote_event_ids = staged_events
            .iter()
            .filter_map(|event| event.get("id").and_then(Value::as_str))
            .map(str::to_owned)
            .collect::<HashSet<_>>();
        staged_events.sort_by_key(|event| event.get("recurringEventId").is_some());
        for event in staged_events {
            cancellation.check()?;
            apply_remote_event(
                &mut transaction,
                request.local_calendar_id,
                request.access_role,
                &calendar_timezone_id,
                event,
            )
            .await?;
        }
        if is_full_sync {
            reconcile_missing_remote_events(
                &mut transaction,
                request.local_calendar_id,
                request.access_role,
                &calendar_timezone_id,
                &seen_remote_event_ids,
            )
            .await?;
        }
        let final_token = final_sync_token.ok_or_else(|| {
            validation(
                "GoogleからnextSyncTokenを受け取れませんでした。",
                "同期トークンは更新していません。再試行してください。",
            )
        })?;
        cancellation.check()?;
        let completed_at = Utc::now().to_rfc3339();
        sqlx::query(
            "UPDATE google_calendars SET sync_token = ?, sync_state = 'synced', last_sync_completed_at_utc = ?, next_retry_at_utc = NULL, last_error_category = NULL WHERE id = ?",
        )
            .bind(final_token)
            .bind(completed_at)
            .bind(request.local_calendar_id)
            .execute(&mut *transaction)
            .await
            .map_err(|error| AppError::database("sync-token-save", error))?;
        cancellation.check()?;
        transaction
            .commit()
            .await
            .map_err(|error| AppError::database("sync-pull-commit", error))?;
        return Ok(());
    }
}

async fn restore_calendar_sync_state(
    database: &Database,
    calendar_id: &str,
    state: &str,
) -> AppResult<()> {
    sqlx::query(
        "UPDATE google_calendars SET sync_state = ?, next_retry_at_utc = NULL, last_error_category = NULL WHERE id = ?",
    )
    .bind(state)
    .bind(calendar_id)
    .execute(&database.pool)
    .await
    .map_err(|error| AppError::database("sync-calendar-restore-state", error))?;
    Ok(())
}

async fn mark_calendar_unavailable(
    database: &Database,
    calendar_id: &str,
    category: &str,
) -> AppResult<()> {
    sqlx::query(
        "UPDATE google_calendars SET sync_state = 'unavailable', next_retry_at_utc = NULL, last_error_category = ? WHERE id = ?",
    )
    .bind(category)
    .bind(calendar_id)
    .execute(&database.pool)
    .await
    .map_err(|error| AppError::database("sync-calendar-unavailable", error))?;
    Ok(())
}

async fn mark_calendar_retry(
    database: &Database,
    calendar_id: &str,
    category: &str,
    retry_after: Option<u64>,
) -> AppResult<()> {
    let delay = retry_after
        .unwrap_or(GOOGLE_SYNC_RETRY_SECONDS as u64)
        .min(86_400);
    let retry_at = Utc::now() + Duration::seconds(delay as i64);
    sqlx::query(
        "UPDATE google_calendars SET sync_state = 'retry_scheduled', next_retry_at_utc = ?, last_error_category = ? WHERE id = ?",
    )
    .bind(retry_at.to_rfc3339())
    .bind(category)
    .bind(calendar_id)
    .execute(&database.pool)
    .await
    .map_err(|error| AppError::database("sync-calendar-retry", error))?;
    Ok(())
}

async fn reconcile_missing_remote_events(
    transaction: &mut sqlx::Transaction<'_, sqlx::Sqlite>,
    calendar_id: &str,
    access_role: &str,
    calendar_timezone_id: &str,
    seen_remote_event_ids: &HashSet<String>,
) -> AppResult<()> {
    let mappings = sqlx::query(
        "SELECT m.remote_event_id, s.recurrence_series_id, s.recurrence_original_start_utc FROM sync_mappings m JOIN schedule_items s ON s.id = m.schedule_item_id WHERE m.calendar_id = ? ORDER BY m.remote_event_id",
    )
    .bind(calendar_id)
    .fetch_all(&mut **transaction)
    .await
    .map_err(|error| AppError::database("sync-full-mapping-list", error))?;
    for mapping in mappings {
        let remote_event_id: String = mapping.get("remote_event_id");
        if seen_remote_event_ids.contains(&remote_event_id) {
            continue;
        }
        let recurrence_series_id: Option<String> = mapping.get("recurrence_series_id");
        let recurrence_original_start: Option<String> =
            mapping.get("recurrence_original_start_utc");
        if let (Some(series_id), Some(original_start)) =
            (recurrence_series_id, recurrence_original_start)
        {
            let original_start = DateTime::parse_from_rfc3339(&original_start).map_err(|_| {
                validation(
                    "ローカルの再発例外時刻が正しくありません。",
                    "同期トークンは更新していません。診断を確認してください。",
                )
            })?;
            set_master_exdate(
                transaction,
                parse_uuid(&series_id)?,
                original_start.with_timezone(&Utc),
                false,
            )
            .await?;
        }
        apply_remote_event_independent(
            transaction,
            calendar_id,
            access_role,
            calendar_timezone_id,
            serde_json::json!({
                "id": remote_event_id,
                "status": "cancelled",
            }),
        )
        .await?;
    }
    Ok(())
}

fn check_optional_cancellation(cancellation: Option<&OperationCancellation>) -> AppResult<()> {
    cancellation.map_or(Ok(()), OperationCancellation::check)
}

async fn apply_remote_event(
    transaction: &mut sqlx::Transaction<'_, sqlx::Sqlite>,
    calendar_id: &str,
    access_role: &str,
    calendar_timezone_id: &str,
    event: Value,
) -> AppResult<()> {
    if event
        .get("recurringEventId")
        .and_then(Value::as_str)
        .is_some()
    {
        return apply_remote_recurrence_exception(
            transaction,
            calendar_id,
            access_role,
            calendar_timezone_id,
            event,
        )
        .await;
    }
    apply_remote_event_independent(
        transaction,
        calendar_id,
        access_role,
        calendar_timezone_id,
        event,
    )
    .await
}

async fn apply_remote_recurrence_exception(
    transaction: &mut sqlx::Transaction<'_, sqlx::Sqlite>,
    calendar_id: &str,
    access_role: &str,
    calendar_timezone_id: &str,
    event: Value,
) -> AppResult<()> {
    let recurring_event_id = event
        .get("recurringEventId")
        .and_then(Value::as_str)
        .filter(|value| !value.is_empty() && value.len() <= 1_024)
        .ok_or_else(|| {
            validation(
                "Google再発例外の系列IDが正しくありません。",
                "同期トークンは更新していません。Google側の系列を確認してください。",
            )
        })?;
    let original_start = google_original_start(&event, calendar_timezone_id)?;
    let master_schedule_id: String = sqlx::query_scalar(
        "SELECT schedule_item_id FROM sync_mappings WHERE calendar_id = ? AND remote_event_id = ?",
    )
    .bind(calendar_id)
    .bind(recurring_event_id)
    .fetch_optional(&mut **transaction)
    .await
    .map_err(|error| AppError::database("sync-recurrence-master-mapping", error))?
    .ok_or_else(|| {
        validation(
            "Google再発例外の親系列を確認できません。",
            "同期トークンは更新していません。対象カレンダーを再同期してください。",
        )
    })?;
    let master_schedule_id = parse_uuid(&master_schedule_id)?;
    set_master_exdate(transaction, master_schedule_id, original_start, true).await?;

    let cancelled = event.get("status").and_then(Value::as_str) == Some("cancelled");
    if cancelled {
        let has_mapping: bool = sqlx::query_scalar(
            "SELECT EXISTS(SELECT 1 FROM sync_mappings WHERE calendar_id = ? AND remote_event_id = ?)",
        )
        .bind(calendar_id)
        .bind(
            event
                .get("id")
                .and_then(Value::as_str)
                .unwrap_or_default(),
        )
        .fetch_one(&mut **transaction)
        .await
        .map_err(|error| AppError::database("sync-recurrence-cancel-mapping", error))?;
        if !has_mapping {
            return Ok(());
        }
    }

    let remote_event_id = event
        .get("id")
        .and_then(Value::as_str)
        .map(str::to_owned)
        .ok_or_else(|| {
            validation(
                "Google再発例外のIDが正しくありません。",
                "同期トークンは更新していません。Google側の系列を確認してください。",
            )
        })?;
    apply_remote_event_independent(
        transaction,
        calendar_id,
        access_role,
        calendar_timezone_id,
        event,
    )
    .await?;
    if !cancelled {
        sqlx::query(
            "UPDATE schedule_items SET recurrence_series_id = ?, recurrence_original_start_utc = ? WHERE id = (SELECT schedule_item_id FROM sync_mappings WHERE calendar_id = ? AND remote_event_id = ?)",
        )
        .bind(master_schedule_id.to_string())
        .bind(original_start.to_rfc3339())
        .bind(calendar_id)
        .bind(remote_event_id)
        .execute(&mut **transaction)
        .await
        .map_err(|error| AppError::database("sync-recurrence-exception-link", error))?;
    }
    Ok(())
}

async fn set_master_exdate(
    transaction: &mut sqlx::Transaction<'_, sqlx::Sqlite>,
    master_schedule_id: Uuid,
    original_start: DateTime<Utc>,
    present: bool,
) -> AppResult<()> {
    let pending: bool = sqlx::query_scalar(
        "SELECT EXISTS(SELECT 1 FROM sync_outbox WHERE entity_id = ? AND completed_at_utc IS NULL)",
    )
    .bind(master_schedule_id.to_string())
    .fetch_one(&mut **transaction)
    .await
    .map_err(|error| AppError::database("sync-recurrence-master-pending", error))?;
    if pending {
        return Err(AppError::Conflict {
            message: "ローカル編集中の再発系列にGoogle側の例外変更があります。".into(),
            recovery: "競合を確認してから対象カレンダーを再同期してください。".into(),
        });
    }
    let master_row = sqlx::query("SELECT * FROM schedule_items WHERE id = ?")
        .bind(master_schedule_id.to_string())
        .fetch_optional(&mut **transaction)
        .await
        .map_err(|error| AppError::database("sync-recurrence-master-read", error))?
        .ok_or_else(|| AppError::database("sync-recurrence-master-missing", "missing"))?;
    let mut master = row_to_schedule(&master_row)?;
    if !master.draft.is_recurring() {
        return Err(validation(
            "Google再発例外の親予定が繰り返し系列ではありません。",
            "同期トークンは更新していません。対象カレンダーを再同期してください。",
        ));
    }
    let changed = if present {
        if master.draft.recurrence_exdates.contains(&original_start) {
            false
        } else {
            master.draft.recurrence_exdates.push(original_start);
            true
        }
    } else {
        let before = master.draft.recurrence_exdates.len();
        master
            .draft
            .recurrence_exdates
            .retain(|value| *value != original_start);
        before != master.draft.recurrence_exdates.len()
    };
    if changed {
        master.draft.recurrence_exdates.sort();
        master.draft.recurrence_exdates.dedup();
        master.version += 1;
        update_schedule_row(transaction, &master, Utc::now()).await?;
    }
    Ok(())
}

fn google_original_start(event: &Value, calendar_timezone_id: &str) -> AppResult<DateTime<Utc>> {
    let original = event
        .get("originalStartTime")
        .and_then(Value::as_object)
        .ok_or_else(|| {
            validation(
                "Google再発例外の元の開始時刻がありません。",
                "同期トークンは更新していません。Google側の系列を確認してください。",
            )
        })?;
    if let Some(value) = original.get("dateTime").and_then(Value::as_str) {
        return DateTime::parse_from_rfc3339(value)
            .map(|value| value.with_timezone(&Utc))
            .map_err(|_| {
                validation(
                    "Google再発例外の元の開始instantが正しくありません。",
                    "同期トークンは更新していません。Google側の系列を確認してください。",
                )
            });
    }
    let date = original
        .get("date")
        .and_then(Value::as_str)
        .ok_or_else(|| {
            validation(
                "Google再発例外の元の日付がありません。",
                "同期トークンは更新していません。Google側の系列を確認してください。",
            )
        })?;
    let date = NaiveDate::parse_from_str(date, "%Y-%m-%d").map_err(|_| {
        validation(
            "Google再発例外の元の日付が正しくありません。",
            "同期トークンは更新していません。Google側の系列を確認してください。",
        )
    })?;
    let timezone_id = original
        .get("timeZone")
        .and_then(Value::as_str)
        .unwrap_or(calendar_timezone_id);
    let timezone: chrono_tz::Tz = timezone_id.parse().map_err(|_| {
        validation(
            "Google再発例外のIANAタイムゾーンが正しくありません。",
            "同期トークンは更新していません。Google側の系列を確認してください。",
        )
    })?;
    local_datetime_to_utc(
        timezone,
        date.and_time(NaiveTime::MIN),
        "Google再発例外の日付がDST境界で曖昧です。",
    )
}

async fn apply_remote_event_independent(
    transaction: &mut sqlx::Transaction<'_, sqlx::Sqlite>,
    calendar_id: &str,
    access_role: &str,
    calendar_timezone_id: &str,
    event: Value,
) -> AppResult<()> {
    let remote_event_id = event
        .get("id")
        .and_then(Value::as_str)
        .filter(|value| !value.is_empty() && value.len() <= 1_024)
        .ok_or_else(|| {
            validation(
                "GoogleイベントIDが正しくありません。",
                "同期トークンは更新していません。再試行してください。",
            )
        })?;
    let cancelled = event.get("status").and_then(Value::as_str) == Some("cancelled");
    let mapping = sqlx::query(
        "SELECT schedule_item_id, etag, remote_updated_at_utc, base_snapshot_json FROM sync_mappings WHERE calendar_id = ? AND remote_event_id = ?",
    )
    .bind(calendar_id)
    .bind(remote_event_id)
    .fetch_optional(&mut **transaction)
    .await
    .map_err(|error| AppError::database("sync-remote-mapping", error))?;
    if let Some(mapping) = mapping {
        let schedule_id = parse_uuid(mapping.get::<&str, _>("schedule_item_id"))?;
        let local_row = sqlx::query("SELECT * FROM schedule_items WHERE id = ?")
            .bind(schedule_id.to_string())
            .fetch_optional(&mut **transaction)
            .await
            .map_err(|error| AppError::database("sync-remote-local-read", error))?
            .ok_or_else(|| AppError::database("sync-remote-local-missing", "missing"))?;
        let local = row_to_schedule(&local_row)?;
        let has_pending: bool = sqlx::query_scalar(
            "SELECT EXISTS(SELECT 1 FROM sync_outbox WHERE entity_id = ? AND completed_at_utc IS NULL)",
        )
        .bind(schedule_id.to_string())
        .fetch_one(&mut **transaction)
        .await
        .map_err(|error| AppError::database("sync-remote-pending", error))?;
        let remote_etag = event.get("etag").and_then(Value::as_str);
        let changed_remote = remote_etag != mapping.get::<Option<String>, _>("etag").as_deref();
        if has_pending && changed_remote {
            if !cancelled {
                let base: ScheduleDraft =
                    serde_json::from_str(mapping.get::<&str, _>("base_snapshot_json"))
                        .map_err(|error| AppError::database("sync-conflict-base-decode", error))?;
                let mut remote = remote_event_to_draft_in_timezone(&event, calendar_timezone_id)?;
                remote.validate()?;
                let (mut merged, fields) = merge_schedule_drafts(&base, &local.draft, &remote)?;
                if fields.is_empty() {
                    merged.validate()?;
                    let updated = Schedule {
                        id: local.id,
                        draft: merged,
                        sync_status: SyncStatus::Pending,
                        version: local.version + 1,
                        deleted_at: local.deleted_at,
                    };
                    update_schedule_row(transaction, &updated, Utc::now()).await?;
                    update_mapping_from_remote(
                        transaction,
                        schedule_id,
                        calendar_id,
                        remote_event_id,
                        &remote,
                        &event,
                    )
                    .await?;
                    return Ok(());
                }
                let remote_json = serde_json::json!({ "draft": remote, "event": event });
                let field_refs = fields.iter().map(String::as_str).collect::<Vec<_>>();
                save_conflict(
                    transaction,
                    schedule_id,
                    calendar_id,
                    mapping.get::<&str, _>("base_snapshot_json"),
                    &local,
                    &remote_json,
                    &field_refs,
                )
                .await?;
                if let Some(remote_event) = remote_json.get("event") {
                    update_mapping_from_remote(
                        transaction,
                        schedule_id,
                        calendar_id,
                        remote_event_id,
                        &remote,
                        remote_event,
                    )
                    .await?;
                }
                return Ok(());
            }
            save_conflict(
                transaction,
                schedule_id,
                calendar_id,
                mapping.get::<&str, _>("base_snapshot_json"),
                &local,
                &event,
                if cancelled {
                    &["delete"][..]
                } else {
                    &["remote_change"][..]
                },
            )
            .await?;
            return Ok(());
        }
        if cancelled {
            if local.draft.is_recurring() {
                let linked_pending: bool = sqlx::query_scalar(
                    "SELECT EXISTS(SELECT 1 FROM schedule_items s JOIN sync_outbox o ON o.entity_id = s.id WHERE s.recurrence_series_id = ? AND o.completed_at_utc IS NULL)",
                )
                .bind(schedule_id.to_string())
                .fetch_one(&mut **transaction)
                .await
                .map_err(|error| AppError::database("sync-series-delete-pending", error))?;
                if linked_pending {
                    return Err(AppError::Conflict {
                        message: "Googleで削除された再発系列に、未同期のローカル例外があります。"
                            .into(),
                        recovery: "ローカル変更を確認してから対象カレンダーを再同期してください。"
                            .into(),
                    });
                }
                let now = Utc::now().to_rfc3339();
                sqlx::query(
                    "UPDATE schedule_items SET deleted_at_utc = ?, sync_status = 'synced', version = version + 1, updated_at_utc = ? WHERE recurrence_series_id = ? AND deleted_at_utc IS NULL",
                )
                .bind(&now)
                .bind(&now)
                .bind(schedule_id.to_string())
                .execute(&mut **transaction)
                .await
                .map_err(|error| AppError::database("sync-series-delete-exceptions", error))?;
            }
            sqlx::query(
                "UPDATE schedule_items SET deleted_at_utc = ?, sync_status = 'synced', version = version + 1, updated_at_utc = ? WHERE id = ?",
            )
            .bind(Utc::now().to_rfc3339())
            .bind(Utc::now().to_rfc3339())
            .bind(schedule_id.to_string())
            .execute(&mut **transaction)
            .await
            .map_err(|error| AppError::database("sync-remote-delete", error))?;
            update_mapping_from_remote(
                transaction,
                schedule_id,
                calendar_id,
                remote_event_id,
                &local.draft,
                &event,
            )
            .await?;
            return Ok(());
        }
        let mut draft = remote_event_to_draft_in_timezone(&event, calendar_timezone_id)?;
        draft.validate()?;
        let read_only = !matches!(access_role, "owner" | "writer")
            || event_is_read_only(&event)
            || !draft.recurrence_supplemental_lines.is_empty();
        let updated = Schedule {
            id: local.id,
            draft,
            sync_status: if read_only {
                SyncStatus::ReadOnly
            } else {
                SyncStatus::Synced
            },
            version: local.version + 1,
            deleted_at: None,
        };
        update_schedule_row(transaction, &updated, Utc::now()).await?;
        update_mapping_from_remote(
            transaction,
            schedule_id,
            calendar_id,
            remote_event_id,
            &updated.draft,
            &event,
        )
        .await?;
        return Ok(());
    }
    if cancelled {
        return Ok(());
    }
    let mut draft = remote_event_to_draft_in_timezone(&event, calendar_timezone_id)?;
    draft.validate()?;
    let requested_id = event
        .pointer("/extendedProperties/private/dayScheduleNextLocalId")
        .and_then(Value::as_str)
        .and_then(|value| Uuid::parse_str(value).ok());
    let id = if let Some(requested) = requested_id {
        let exists: bool =
            sqlx::query_scalar("SELECT EXISTS(SELECT 1 FROM schedule_items WHERE id = ?)")
                .bind(requested.to_string())
                .fetch_one(&mut **transaction)
                .await
                .map_err(|error| AppError::database("sync-remote-local-id-check", error))?;
        if exists { Uuid::new_v4() } else { requested }
    } else {
        Uuid::new_v4()
    };
    let read_only = !matches!(access_role, "owner" | "writer")
        || event_is_read_only(&event)
        || !draft.recurrence_supplemental_lines.is_empty();
    let schedule = Schedule {
        id,
        draft,
        sync_status: if read_only {
            SyncStatus::ReadOnly
        } else {
            SyncStatus::Synced
        },
        version: 0,
        deleted_at: None,
    };
    insert_schedule(transaction, &schedule, Utc::now()).await?;
    update_mapping_from_remote(
        transaction,
        schedule.id,
        calendar_id,
        remote_event_id,
        &schedule.draft,
        &event,
    )
    .await
}

async fn update_mapping_from_remote(
    transaction: &mut sqlx::Transaction<'_, sqlx::Sqlite>,
    schedule_id: Uuid,
    calendar_id: &str,
    remote_event_id: &str,
    base: &ScheduleDraft,
    event: &Value,
) -> AppResult<()> {
    let base_json = serde_json::to_string(base)
        .map_err(|error| AppError::database("sync-remote-base-encode", error))?;
    let base_hash = format!("{:x}", Sha256::digest(base_json.as_bytes()));
    sqlx::query(
        "INSERT INTO sync_mappings(schedule_item_id, calendar_id, remote_event_id, etag, remote_updated_at_utc, base_snapshot_json, base_hash) VALUES (?, ?, ?, ?, ?, ?, ?) ON CONFLICT(schedule_item_id, calendar_id) DO UPDATE SET remote_event_id = excluded.remote_event_id, etag = excluded.etag, remote_updated_at_utc = excluded.remote_updated_at_utc, base_snapshot_json = excluded.base_snapshot_json, base_hash = excluded.base_hash",
    )
    .bind(schedule_id.to_string())
    .bind(calendar_id)
    .bind(remote_event_id)
    .bind(event.get("etag").and_then(Value::as_str))
    .bind(event.get("updated").and_then(Value::as_str))
    .bind(base_json)
    .bind(base_hash)
    .execute(&mut **transaction)
    .await
    .map_err(|error| AppError::database("sync-remote-mapping-save", error))?;
    Ok(())
}

async fn save_conflict(
    transaction: &mut sqlx::Transaction<'_, sqlx::Sqlite>,
    schedule_id: Uuid,
    calendar_id: &str,
    base_json: &str,
    local: &Schedule,
    remote: &Value,
    fields: &[&str],
) -> AppResult<()> {
    let local_json = serde_json::to_string(local)
        .map_err(|error| AppError::database("sync-conflict-local", error))?;
    let remote_json = serde_json::to_string(remote)
        .map_err(|error| AppError::database("sync-conflict-remote", error))?;
    let fields_json = serde_json::to_string(fields)
        .map_err(|error| AppError::database("sync-conflict-fields", error))?;
    sqlx::query(
        "INSERT INTO sync_conflicts(id, schedule_item_id, calendar_id, base_json, local_json, remote_json, fields_json, status, created_at_utc) VALUES (?, ?, ?, ?, ?, ?, ?, 'unresolved', ?)",
    )
    .bind(Uuid::new_v4().to_string())
    .bind(schedule_id.to_string())
    .bind(calendar_id)
    .bind(base_json)
    .bind(local_json)
    .bind(remote_json)
    .bind(fields_json)
    .bind(Utc::now().to_rfc3339())
    .execute(&mut **transaction)
    .await
    .map_err(|error| AppError::database("sync-conflict-save", error))?;
    sqlx::query("UPDATE schedule_items SET sync_status = 'conflict' WHERE id = ?")
        .bind(schedule_id.to_string())
        .execute(&mut **transaction)
        .await
        .map_err(|error| AppError::database("sync-conflict-mark", error))?;
    Ok(())
}

async fn save_outbox_conflict(
    database: &Database,
    schedule_id: Uuid,
    remote_event: Option<Value>,
) -> AppResult<bool> {
    let mapping = sqlx::query(
        "SELECT calendar_id, remote_event_id, base_snapshot_json FROM sync_mappings WHERE schedule_item_id = ? LIMIT 1",
    )
    .bind(schedule_id.to_string())
    .fetch_optional(&database.pool)
    .await
    .map_err(|error| AppError::database("sync-outbox-conflict-mapping", error))?;
    let Some(mapping) = mapping else {
        return Ok(false);
    };
    let row = sqlx::query("SELECT * FROM schedule_items WHERE id = ?")
        .bind(schedule_id.to_string())
        .fetch_one(&database.pool)
        .await
        .map_err(|error| AppError::database("sync-outbox-conflict-local", error))?;
    let local = row_to_schedule(&row)?;
    let mut transaction = database
        .pool
        .begin()
        .await
        .map_err(|error| AppError::database("sync-outbox-conflict-begin", error))?;
    let calendar_id = mapping.get::<&str, _>("calendar_id");
    let remote_event_id = mapping.get::<&str, _>("remote_event_id");
    let base_json = mapping.get::<&str, _>("base_snapshot_json");
    let Some(remote_event) = remote_event else {
        save_conflict(
            &mut transaction,
            schedule_id,
            calendar_id,
            base_json,
            &local,
            &serde_json::json!({ "deleted": true }),
            &["delete"],
        )
        .await?;
        transaction
            .commit()
            .await
            .map_err(|error| AppError::database("sync-outbox-conflict-commit", error))?;
        return Ok(true);
    };
    let mut remote = remote_event_to_draft(&remote_event)?;
    remote.validate()?;
    let base: ScheduleDraft = serde_json::from_str(base_json)
        .map_err(|error| AppError::database("sync-outbox-conflict-base", error))?;
    if local.deleted_at.is_some() {
        let remote_json = serde_json::json!({ "draft": remote, "event": remote_event });
        save_conflict(
            &mut transaction,
            schedule_id,
            calendar_id,
            base_json,
            &local,
            &remote_json,
            &["delete"],
        )
        .await?;
        update_mapping_from_remote(
            &mut transaction,
            schedule_id,
            calendar_id,
            remote_event_id,
            &remote,
            remote_json
                .get("event")
                .ok_or_else(|| AppError::database("sync-outbox-conflict-event", "missing event"))?,
        )
        .await?;
        transaction
            .commit()
            .await
            .map_err(|error| AppError::database("sync-outbox-conflict-commit", error))?;
        return Ok(true);
    }
    let (mut merged, fields) = merge_schedule_drafts(&base, &local.draft, &remote)?;
    if fields.is_empty() {
        merged.validate()?;
        let updated = Schedule {
            id: local.id,
            draft: merged,
            sync_status: SyncStatus::Pending,
            version: local.version + 1,
            deleted_at: None,
        };
        update_schedule_row(&mut transaction, &updated, Utc::now()).await?;
        update_mapping_from_remote(
            &mut transaction,
            schedule_id,
            calendar_id,
            remote_event_id,
            &remote,
            &remote_event,
        )
        .await?;
        transaction
            .commit()
            .await
            .map_err(|error| AppError::database("sync-outbox-merge-commit", error))?;
        return Ok(false);
    }
    let remote_json = serde_json::json!({ "draft": remote, "event": remote_event });
    let field_refs = fields.iter().map(String::as_str).collect::<Vec<_>>();
    save_conflict(
        &mut transaction,
        schedule_id,
        calendar_id,
        base_json,
        &local,
        &remote_json,
        &field_refs,
    )
    .await?;
    update_mapping_from_remote(
        &mut transaction,
        schedule_id,
        calendar_id,
        remote_event_id,
        &remote,
        remote_json
            .get("event")
            .ok_or_else(|| AppError::database("sync-outbox-conflict-event", "missing event"))?,
    )
    .await?;
    transaction
        .commit()
        .await
        .map_err(|error| AppError::database("sync-outbox-conflict-commit", error))?;
    Ok(true)
}

fn remote_event_to_draft(event: &Value) -> AppResult<ScheduleDraft> {
    remote_event_to_draft_in_timezone(event, "UTC")
}

fn remote_event_to_draft_in_timezone(
    event: &Value,
    calendar_timezone_id: &str,
) -> AppResult<ScheduleDraft> {
    let title = bounded_string(event.get("summary"), "(タイトルなし)", 200);
    let description = bounded_string(event.get("description"), "", 10_000);
    let location = bounded_string(event.get("location"), "", 500);
    let start = event
        .get("start")
        .and_then(Value::as_object)
        .ok_or_else(|| {
            validation(
                "Googleイベントの開始時刻がありません。",
                "同期トークンは更新していません。再試行してください。",
            )
        })?;
    let end = event.get("end").and_then(Value::as_object).ok_or_else(|| {
        validation(
            "Googleイベントの終了時刻がありません。",
            "同期トークンは更新していません。再試行してください。",
        )
    })?;
    let (start_utc, end_utc, timezone_id, all_day, all_day_start_date, all_day_end_date_exclusive) =
        if let (Some(start_date), Some(end_date)) = (
            start.get("date").and_then(Value::as_str),
            end.get("date").and_then(Value::as_str),
        ) {
            let timezone_id = start
                .get("timeZone")
                .or_else(|| end.get("timeZone"))
                .and_then(Value::as_str)
                .unwrap_or(calendar_timezone_id)
                .to_owned();
            let timezone: chrono_tz::Tz = timezone_id.parse().map_err(|_| {
                validation(
                    "Google終日予定のタイムゾーンが正しくありません。",
                    "同期トークンは更新していません。再試行してください。",
                )
            })?;
            let start_date = NaiveDate::parse_from_str(start_date, "%Y-%m-%d").map_err(|_| {
                validation(
                    "Google終日予定の開始日が正しくありません。",
                    "同期トークンは更新していません。再試行してください。",
                )
            })?;
            let end_date = NaiveDate::parse_from_str(end_date, "%Y-%m-%d").map_err(|_| {
                validation(
                    "Google終日予定の終了日が正しくありません。",
                    "同期トークンは更新していません。再試行してください。",
                )
            })?;
            let start_local = timezone.from_local_datetime(&start_date.and_time(NaiveTime::MIN));
            let end_local = timezone.from_local_datetime(&end_date.and_time(NaiveTime::MIN));
            match (start_local, end_local) {
                (LocalResult::Single(start), LocalResult::Single(end)) if start < end => (
                    start.with_timezone(&Utc),
                    end.with_timezone(&Utc),
                    timezone_id,
                    true,
                    Some(start_date),
                    Some(end_date),
                ),
                _ => {
                    return Err(validation(
                        "Google終日予定がDST境界で曖昧です。",
                        "このイベントは取り込まず、カレンダー側で日付を確認してください。",
                    ));
                }
            }
        } else {
            let start_value = start
                .get("dateTime")
                .and_then(Value::as_str)
                .ok_or_else(|| {
                    validation(
                        "Googleイベントの開始instantがありません。",
                        "同期トークンは更新していません。再試行してください。",
                    )
                })?;
            let end_value = end.get("dateTime").and_then(Value::as_str).ok_or_else(|| {
                validation(
                    "Googleイベントの終了instantがありません。",
                    "同期トークンは更新していません。再試行してください。",
                )
            })?;
            let timezone_id = start
                .get("timeZone")
                .or_else(|| end.get("timeZone"))
                .and_then(Value::as_str)
                .unwrap_or(calendar_timezone_id)
                .to_owned();
            if timezone_id.parse::<chrono_tz::Tz>().is_err() {
                return Err(validation(
                    "GoogleイベントのIANAタイムゾーンが正しくありません。",
                    "同期トークンは更新していません。再試行してください。",
                ));
            }
            let start_utc = DateTime::parse_from_rfc3339(start_value)
                .map(|value| value.with_timezone(&Utc))
                .map_err(|_| {
                    validation(
                        "Googleイベントの開始instantが正しくありません。",
                        "同期トークンは更新していません。再試行してください。",
                    )
                })?;
            let end_utc = DateTime::parse_from_rfc3339(end_value)
                .map(|value| value.with_timezone(&Utc))
                .map_err(|_| {
                    validation(
                        "Googleイベントの終了instantが正しくありません。",
                        "同期トークンは更新していません。再試行してください。",
                    )
                })?;
            (start_utc, end_utc, timezone_id, false, None, None)
        };
    let recurrence = event
        .get("recurrence")
        .and_then(Value::as_array)
        .map(Vec::as_slice)
        .unwrap_or_default();
    let recurrence_lines = recurrence
        .iter()
        .map(|value| {
            value.as_str().ok_or_else(|| {
                validation(
                    "Google繰り返し設定が正しくありません。",
                    "同期トークンは更新していません。Google側の系列を確認してください。",
                )
            })
        })
        .collect::<AppResult<Vec<_>>>()?;
    let rule_lines = recurrence_lines
        .iter()
        .filter(|value| value.starts_with("RRULE:"))
        .copied()
        .collect::<Vec<_>>();
    if recurrence_lines.iter().any(|value| {
        !value.starts_with("RRULE:")
            && !value.starts_with("RDATE")
            && !value.starts_with("EXRULE:")
            && !value.starts_with("EXDATE")
    }) {
        return Err(validation(
            "このGoogle繰り返し設定には未対応の要素があります。",
            "予定を変更せず同期を停止しました。Google側の系列を確認してください。",
        ));
    }
    let recurrence_rule = rule_lines
        .first()
        .map(|value| value.trim_start_matches("RRULE:").to_owned());
    let first_rule = rule_lines.first().copied();
    let recurrence_supplemental_lines = recurrence_lines
        .iter()
        .filter(|value| {
            !value.starts_with("EXDATE") && first_rule.is_none_or(|first| **value != first)
        })
        .map(|value| (*value).to_owned())
        .collect::<Vec<_>>();
    let mut recurrence_exdates = Vec::new();
    for line in recurrence_lines
        .iter()
        .filter(|value| value.starts_with("EXDATE"))
    {
        recurrence_exdates.extend(parse_google_exdate_line(line, calendar_timezone_id)?);
    }
    Ok(ScheduleDraft {
        title,
        description,
        location,
        start_utc,
        end_utc,
        timezone_id,
        all_day,
        all_day_start_date,
        all_day_end_date_exclusive,
        status: ScheduleStatus::Scheduled,
        project: String::new(),
        category: String::new(),
        tags: Vec::new(),
        color: "#6F96F4".into(),
        priority: Priority::Normal,
        recurrence_rule,
        recurrence_supplemental_lines,
        recurrence_exdates,
        start_notification_minutes: None,
        end_notification_minutes: None,
    })
}

fn parse_google_exdate_line(
    line: &str,
    calendar_timezone_id: &str,
) -> AppResult<Vec<DateTime<Utc>>> {
    let (property, values) = line.split_once(':').ok_or_else(|| {
        validation(
            "Google繰り返し例外の形式が正しくありません。",
            "同期トークンは更新していません。Google側の系列を確認してください。",
        )
    })?;
    if !property.starts_with("EXDATE") {
        return Err(validation(
            "Google繰り返し例外の形式が正しくありません。",
            "同期トークンは更新していません。Google側の系列を確認してください。",
        ));
    }
    let timezone_id = property
        .split(';')
        .find_map(|part| part.strip_prefix("TZID="))
        .unwrap_or(calendar_timezone_id);
    let timezone: chrono_tz::Tz = timezone_id.parse().map_err(|_| {
        validation(
            "Google繰り返し例外のIANAタイムゾーンが正しくありません。",
            "同期トークンは更新していません。Google側の系列を確認してください。",
        )
    })?;
    let date_only = property
        .split(';')
        .any(|part| part.eq_ignore_ascii_case("VALUE=DATE"));
    values
        .split(',')
        .map(|value| {
            if date_only {
                let date = NaiveDate::parse_from_str(value, "%Y%m%d").map_err(|_| {
                    validation(
                        "Google繰り返し例外の日付が正しくありません。",
                        "同期トークンは更新していません。Google側の系列を確認してください。",
                    )
                })?;
                return local_datetime_to_utc(
                    timezone,
                    date.and_time(NaiveTime::MIN),
                    "Google繰り返し例外の日付がDST境界で曖昧です。",
                );
            }
            if value.ends_with('Z') {
                return chrono::NaiveDateTime::parse_from_str(value, "%Y%m%dT%H%M%SZ")
                    .map(|value| Utc.from_utc_datetime(&value))
                    .map_err(|_| {
                        validation(
                            "Google繰り返し例外の時刻が正しくありません。",
                            "同期トークンは更新していません。Google側の系列を確認してください。",
                        )
                    });
            }
            let local =
                chrono::NaiveDateTime::parse_from_str(value, "%Y%m%dT%H%M%S").map_err(|_| {
                    validation(
                        "Google繰り返し例外のローカル時刻が正しくありません。",
                        "同期トークンは更新していません。Google側の系列を確認してください。",
                    )
                })?;
            local_datetime_to_utc(
                timezone,
                local,
                "Google繰り返し例外のローカル時刻がDST境界で曖昧です。",
            )
        })
        .collect()
}

fn local_datetime_to_utc(
    timezone: chrono_tz::Tz,
    local: chrono::NaiveDateTime,
    message: &str,
) -> AppResult<DateTime<Utc>> {
    match timezone.from_local_datetime(&local) {
        LocalResult::Single(value) => Ok(value.with_timezone(&Utc)),
        LocalResult::Ambiguous(_, _) | LocalResult::None => Err(validation(
            message,
            "同期トークンは更新していません。Google側の系列を確認してください。",
        )),
    }
}

fn merge_schedule_drafts(
    base: &ScheduleDraft,
    local: &ScheduleDraft,
    remote: &ScheduleDraft,
) -> AppResult<(ScheduleDraft, Vec<String>)> {
    let base_value = serde_json::to_value(base)
        .map_err(|error| AppError::database("sync-merge-base-encode", error))?;
    let local_value = serde_json::to_value(local)
        .map_err(|error| AppError::database("sync-merge-local-encode", error))?;
    let remote_value = serde_json::to_value(remote)
        .map_err(|error| AppError::database("sync-merge-remote-encode", error))?;
    let base_object = base_value
        .as_object()
        .ok_or_else(|| AppError::database("sync-merge-base", "not an object"))?;
    let local_object = local_value
        .as_object()
        .ok_or_else(|| AppError::database("sync-merge-local", "not an object"))?;
    let remote_object = remote_value
        .as_object()
        .ok_or_else(|| AppError::database("sync-merge-remote", "not an object"))?;
    let mut merged = serde_json::Map::new();
    let mut conflicts = Vec::new();
    for (field, base_field) in base_object {
        let local_field = local_object.get(field).unwrap_or(base_field);
        let remote_field = remote_object.get(field).unwrap_or(base_field);
        let selected = if local_field == remote_field {
            local_field
        } else if local_field == base_field {
            remote_field
        } else if remote_field == base_field {
            local_field
        } else {
            conflicts.push(field.clone());
            local_field
        };
        merged.insert(field.clone(), selected.clone());
    }
    let draft = serde_json::from_value(Value::Object(merged))
        .map_err(|error| AppError::database("sync-merge-decode", error))?;
    Ok((draft, conflicts))
}

fn apply_owned_fields(event: &mut Value, schedule: &Schedule, event_id: &str) -> AppResult<()> {
    let object = event.as_object_mut().ok_or_else(|| {
        validation(
            "Googleイベントを更新できる形式ではありません。",
            "同期を再試行してください。",
        )
    })?;
    object.insert("id".into(), Value::String(event_id.to_owned()));
    object.insert(
        "summary".into(),
        Value::String(schedule.draft.title.clone()),
    );
    object.insert(
        "description".into(),
        Value::String(schedule.draft.description.clone()),
    );
    object.insert(
        "location".into(),
        Value::String(schedule.draft.location.clone()),
    );
    if schedule.draft.all_day {
        let start_date = schedule.draft.all_day_start_date.ok_or_else(|| {
            validation(
                "終日予定のローカル開始日がありません。",
                "予定を編集して日付を保存し直してください。",
            )
        })?;
        let end_date = schedule.draft.all_day_end_date_exclusive.ok_or_else(|| {
            validation(
                "終日予定の排他的終了日がありません。",
                "予定を編集して日付を保存し直してください。",
            )
        })?;
        object.insert(
            "start".into(),
            serde_json::json!({ "date": start_date.to_string(), "timeZone": schedule.draft.timezone_id }),
        );
        object.insert(
            "end".into(),
            serde_json::json!({ "date": end_date.to_string(), "timeZone": schedule.draft.timezone_id }),
        );
    } else {
        object.insert(
            "start".into(),
            serde_json::json!({ "dateTime": schedule.draft.start_utc.to_rfc3339(), "timeZone": schedule.draft.timezone_id }),
        );
        object.insert(
            "end".into(),
            serde_json::json!({ "dateTime": schedule.draft.end_utc.to_rfc3339(), "timeZone": schedule.draft.timezone_id }),
        );
    }
    if schedule.draft.is_recurring() {
        let mut recurrence = schedule
            .draft
            .recurrence_rule
            .as_ref()
            .map(|rule| vec![format!("RRULE:{rule}")])
            .unwrap_or_default();
        recurrence.extend(schedule.draft.recurrence_supplemental_lines.iter().cloned());
        if !schedule.draft.recurrence_exdates.is_empty() {
            recurrence.push(format!(
                "EXDATE:{}",
                schedule
                    .draft
                    .recurrence_exdates
                    .iter()
                    .map(|value| value.format("%Y%m%dT%H%M%SZ").to_string())
                    .collect::<Vec<_>>()
                    .join(",")
            ));
        }
        object.insert(
            "recurrence".into(),
            serde_json::to_value(recurrence)
                .map_err(|error| AppError::database("google-recurrence-encode", error))?,
        );
    } else {
        object.remove("recurrence");
    }
    let extended = object
        .entry("extendedProperties")
        .or_insert_with(|| serde_json::json!({}));
    let extended_object = extended.as_object_mut().ok_or_else(|| {
        validation(
            "Googleイベントの拡張プロパティが正しくありません。",
            "同期を中止しました。Google側のイベントを確認してください。",
        )
    })?;
    let private = extended_object
        .entry("private")
        .or_insert_with(|| serde_json::json!({}));
    let private_object = private.as_object_mut().ok_or_else(|| {
        validation(
            "Googleイベントのprivate拡張プロパティが正しくありません。",
            "同期を中止しました。Google側のイベントを確認してください。",
        )
    })?;
    private_object.insert(
        "dayScheduleNextLocalId".into(),
        Value::String(schedule.id.to_string()),
    );
    private_object.insert("dayScheduleNextSchema".into(), Value::String("9".into()));
    Ok(())
}

fn event_is_read_only(event: &Value) -> bool {
    !matches!(
        event.get("eventType").and_then(Value::as_str),
        None | Some("default")
    )
}

fn can_read_event_details(access_role: &str) -> bool {
    matches!(access_role, "owner" | "writer" | "reader")
}

fn bounded_string(value: Option<&Value>, fallback: &str, maximum: usize) -> String {
    value
        .and_then(Value::as_str)
        .unwrap_or(fallback)
        .chars()
        .take(maximum)
        .collect()
}

fn event_url(calendar_id: &str, event_id: Option<&str>) -> AppResult<Url> {
    event_url_at(GOOGLE_CALENDAR_API_ROOT, calendar_id, event_id)
}

fn event_url_at(api_root: &str, calendar_id: &str, event_id: Option<&str>) -> AppResult<Url> {
    if calendar_id.is_empty()
        || calendar_id.len() > 1_024
        || event_id.is_some_and(|id| id.is_empty() || id.len() > 1_024)
    {
        return Err(validation(
            "Google識別子が正しくありません。",
            "カレンダー一覧を更新してください。",
        ));
    }
    let mut url =
        Url::parse(api_root).map_err(|error| AppError::database("google-api-url", error))?;
    {
        let mut segments = url
            .path_segments_mut()
            .map_err(|_| AppError::database("google-api-path", "cannot be base"))?;
        segments.pop_if_empty();
        segments.extend(["calendars", calendar_id, "events"]);
        if let Some(event_id) = event_id {
            segments.push(event_id);
        }
    }
    Ok(url)
}

async fn response_json_limited(response: reqwest::Response) -> Result<Value, HttpFailure> {
    if response
        .content_length()
        .is_some_and(|length| length > 10 * 1024 * 1024)
    {
        return Err(HttpFailure::Permanent);
    }
    let bytes = response
        .bytes()
        .await
        .map_err(|_| HttpFailure::Retryable(None))?;
    if bytes.len() > 10 * 1024 * 1024 {
        return Err(HttpFailure::Permanent);
    }
    serde_json::from_slice(&bytes).map_err(|_| HttpFailure::Permanent)
}

fn classify_http(response: &reqwest::Response) -> HttpFailure {
    match response.status() {
        StatusCode::UNAUTHORIZED => HttpFailure::Auth,
        StatusCode::FORBIDDEN => HttpFailure::Forbidden,
        StatusCode::NOT_FOUND => HttpFailure::NotFound,
        StatusCode::PRECONDITION_FAILED => HttpFailure::Conflict(None),
        StatusCode::GONE => HttpFailure::Gone,
        StatusCode::TOO_MANY_REQUESTS => HttpFailure::Retryable(retry_after_seconds(response)),
        status if status.is_server_error() => HttpFailure::Retryable(retry_after_seconds(response)),
        _ => HttpFailure::Permanent,
    }
}

fn retry_after_seconds(response: &reqwest::Response) -> Option<u64> {
    response
        .headers()
        .get("retry-after")
        .and_then(|value| value.to_str().ok())
        .and_then(|value| value.parse::<u64>().ok())
        .map(|value| value.min(86_400))
}

async fn mark_outbox_failure(
    database: &Database,
    outbox_id: &str,
    prior_attempts: u32,
    category: &str,
    retry_after: Option<u64>,
) -> AppResult<()> {
    let attempts = prior_attempts.saturating_add(1);
    let exponential = 2_u64.saturating_pow(attempts.min(12)).min(3_600);
    let jitter = u64::from(rand::random::<u8>()) % 31;
    let delay = retry_after.unwrap_or(exponential + jitter);
    let next = Utc::now() + Duration::seconds(delay as i64);
    let mut transaction = database
        .pool
        .begin()
        .await
        .map_err(|error| AppError::database("sync-outbox-failure-begin", error))?;
    sqlx::query(
        "UPDATE sync_outbox SET attempt_count = ?, next_attempt_at_utc = ?, error_category = ? WHERE id = ?",
    )
    .bind(i64::from(attempts))
    .bind(next.to_rfc3339())
    .bind(category)
    .bind(outbox_id)
    .execute(&mut *transaction)
    .await
    .map_err(|error| AppError::database("sync-outbox-failure", error))?;
    let sync_status = match category {
        "auth_required" => "auth_required",
        "conflict" => "conflict",
        "merged" => "pending",
        _ => "retry_scheduled",
    };
    sqlx::query(
        "UPDATE schedule_items SET sync_status = ? WHERE id = (SELECT entity_id FROM sync_outbox WHERE id = ?)",
    )
    .bind(sync_status)
    .bind(outbox_id)
    .execute(&mut *transaction)
    .await
    .map_err(|error| AppError::database("sync-outbox-failure-status", error))?;
    transaction
        .commit()
        .await
        .map_err(|error| AppError::database("sync-outbox-failure-commit", error))
}

async fn mark_auth_required(database: &Database, account_id: Uuid) -> AppResult<()> {
    sqlx::query(
        "UPDATE google_accounts SET status = 'auth_required', updated_at_utc = ? WHERE id = ?",
    )
    .bind(Utc::now().to_rfc3339())
    .bind(account_id.to_string())
    .execute(&database.pool)
    .await
    .map_err(|error| AppError::database("sync-auth-required", error))?;
    sqlx::query(
        "UPDATE google_calendars SET sync_state = 'auth_required', next_retry_at_utc = NULL, last_error_category = 'auth' WHERE account_id = ?",
    )
    .bind(account_id.to_string())
    .execute(&database.pool)
    .await
    .map_err(|error| AppError::database("sync-auth-calendars", error))?;
    sqlx::query(
        "UPDATE schedule_items SET sync_status = 'auth_required' WHERE id IN (SELECT schedule_item_id FROM sync_mappings)",
    )
    .execute(&database.pool)
    .await
    .map_err(|error| AppError::database("sync-auth-schedules", error))?;
    Ok(())
}

fn sync_failure_error(failure: HttpFailure, operation: &str) -> AppError {
    match failure {
        HttpFailure::Auth => unavailable(
            "Googleへの再認証が必要です。",
            "ローカル予定は保持されています。設定から再接続してください。",
        ),
        HttpFailure::Forbidden => unavailable(
            "このGoogleカレンダーを読み取る権限がありません。",
            "ローカル予定は保持されています。カレンダーの共有権限または同期対象を確認してください。",
        ),
        HttpFailure::NotFound => unavailable(
            "このGoogleカレンダーを確認できません。",
            "ローカル予定は保持されています。カレンダーが削除されていないか確認してください。",
        ),
        HttpFailure::Gone => unavailable(
            "Google同期トークンが無効です。",
            "対象カレンダーだけを安全にフル同期します。もう一度同期してください。",
        ),
        HttpFailure::Conflict(_) => AppError::Conflict {
            message: format!("{operation}で同時変更を検出しました。"),
            recovery: "競合画面でローカルとGoogleの値を確認してください。".into(),
        },
        HttpFailure::Retryable(_) => unavailable(
            &format!("{operation}を一時的に完了できません。"),
            "ローカル予定は保存されています。自動再試行または手動同期を利用してください。",
        ),
        HttpFailure::Permanent => unavailable(
            &format!("{operation}の応答を安全に処理できません。"),
            "同期トークンは更新していません。時間を置いて再試行してください。",
        ),
    }
}

fn google_event_id(id: Uuid) -> String {
    const ALPHABET: &[u8; 32] = b"0123456789abcdefghijklmnopqrstuv";
    let bytes = id.as_bytes();
    let mut output = String::with_capacity(26);
    let mut buffer = 0_u32;
    let mut bits = 0_u8;
    for byte in bytes {
        buffer = (buffer << 8) | u32::from(*byte);
        bits += 8;
        while bits >= 5 {
            bits -= 5;
            output.push(ALPHABET[((buffer >> bits) & 31) as usize] as char);
        }
    }
    if bits > 0 {
        output.push(ALPHABET[((buffer << (5 - bits)) & 31) as usize] as char);
    }
    format!("dsn{output}")
}

fn validate_oauth_installed(value: &OAuthInstalled) -> AppResult<()> {
    if value.client_id.len() < 10
        || value.client_id.len() > 500
        || value.client_secret.len() > 2_000
        || value.redirect_uris.len() > 20
    {
        return Err(validation(
            "OAuth Desktop app設定の値が正しくありません。",
            "Google CloudからJSONを取得し直してください。",
        ));
    }
    validate_google_endpoint(&value.auth_uri, "accounts.google.com")?;
    validate_google_endpoint(&value.token_uri, "oauth2.googleapis.com")?;
    if !value
        .redirect_uris
        .iter()
        .any(|uri| uri == "http://localhost" || uri.starts_with("http://127.0.0.1"))
    {
        return Err(validation(
            "OAuth JSONにDesktop app用のloopback redirect URIがありません。",
            "OAuthクライアント種別をDesktop appとして作り直してください。",
        ));
    }
    Ok(())
}

fn built_in_oauth_config(client_id: Option<&str>) -> AppResult<Option<OAuthConfig>> {
    let Some(client_id) = client_id else {
        return Ok(None);
    };
    if client_id.len() < 30
        || client_id.len() > 500
        || client_id.trim() != client_id
        || !client_id.ends_with(".apps.googleusercontent.com")
        || !client_id
            .bytes()
            .all(|byte| byte.is_ascii_alphanumeric() || matches!(byte, b'-' | b'.' | b'_'))
    {
        return Err(validation(
            "このビルドのGoogle OAuth設定が正しくありません。",
            "ローカル予定はそのまま利用できます。Desktop OAuth client IDを確認して再ビルドしてください。",
        ));
    }
    Ok(Some(OAuthConfig {
        client_id: client_id.to_owned(),
        client_secret: String::new(),
        auth_uri: GOOGLE_AUTH_URI.to_owned(),
        token_uri: GOOGLE_TOKEN_URI.to_owned(),
    }))
}

fn validate_google_endpoint(value: &str, expected_host: &str) -> AppResult<()> {
    let url = Url::parse(value).map_err(|_| {
        validation(
            "OAuthエンドポイントが正しくありません。",
            "OAuth JSONを選び直してください。",
        )
    })?;
    if url.scheme() != "https"
        || url.host_str() != Some(expected_host)
        || !url.username().is_empty()
        || url.password().is_some()
    {
        return Err(validation(
            "OAuthエンドポイントがGoogle公式URLではありません。",
            "外部から入手したJSONを使わず、Google Cloudから取得してください。",
        ));
    }
    Ok(())
}

fn validate_token_response(token: &TokenResponse) -> AppResult<()> {
    let granted: HashSet<&str> = token.scope.split_whitespace().collect();
    let missing_required_scope = !token.scope.is_empty()
        && ![CALENDAR_SCOPE, CALENDAR_LIST_SCOPE, TASKS_SCOPE]
            .iter()
            .all(|scope| granted.contains(scope));
    if token.access_token.is_empty()
        || token.access_token.len() > 16_384
        || token.expires_in <= 0
        || missing_required_scope
    {
        return Err(unavailable(
            "Googleから必要な権限のトークンを受け取れませんでした。",
            "同意画面でカレンダー権限を確認して再接続してください。",
        ));
    }
    Ok(())
}

fn validate_remote_calendar(calendar: &RemoteCalendar) -> AppResult<()> {
    if calendar.id.is_empty()
        || calendar.id.len() > 1_024
        || calendar.summary.chars().count() > 500
        || calendar.background_color.len() > 20
        || calendar.time_zone.len() > 100
        || calendar.time_zone.parse::<TzCompat>().is_err()
        || !matches!(
            calendar.access_role.as_str(),
            "owner" | "writer" | "reader" | "freeBusyReader"
        )
    {
        return Err(validation(
            "Googleカレンダー一覧に不正な値が含まれています。",
            "同期を中止しました。時間を置いて再試行してください。",
        ));
    }
    Ok(())
}

async fn load_provisioned_oauth_secret(expected_client_id: &str) -> AppResult<String> {
    let encoded = load_keyring(BUILT_IN_OAUTH_CLIENT_USER.to_owned())
        .await
        .map_err(|_| {
            validation(
                "この端末のGoogle OAuth資格情報が未設定です。",
                "追跡外の環境変数からprovision-google-oauthを実行して、OS秘密ストアへ登録してください。",
            )
        })?;
    parse_provisioned_oauth_secret(&encoded, expected_client_id)
}

fn parse_provisioned_oauth_secret(encoded: &str, expected_client_id: &str) -> AppResult<String> {
    let provisioned: ProvisionedOAuthClient = serde_json::from_str(encoded).map_err(|_| {
        validation(
            "OS秘密ストアのGoogle OAuth資格情報が正しくありません。",
            "provision-google-oauthをもう一度実行してください。",
        )
    })?;
    if provisioned.client_id != expected_client_id
        || !(8..=2_000).contains(&provisioned.client_secret.len())
        || provisioned.client_secret.trim() != provisioned.client_secret
        || provisioned
            .client_secret
            .bytes()
            .any(|byte| byte.is_ascii_control())
    {
        return Err(validation(
            "OS秘密ストアのGoogle OAuth資格情報がこのビルドと一致しません。",
            "同じDesktop appのclient IDとclient secretでprovision-google-oauthを実行してください。",
        ));
    }
    Ok(provisioned.client_secret)
}

#[derive(Debug)]
struct TzCompat;

impl std::str::FromStr for TzCompat {
    type Err = ();

    fn from_str(value: &str) -> Result<Self, Self::Err> {
        value.parse::<chrono_tz::Tz>().map(|_| Self).map_err(|_| ())
    }
}

async fn store_keyring(user: String, secret: String) -> AppResult<()> {
    tokio::task::spawn_blocking(move || {
        Entry::new(KEYRING_SERVICE, &user)
            .and_then(|entry| entry.set_password(&secret))
            .map_err(|_| {
                unavailable(
                    "OS秘密ストアへ認証情報を保存できません。",
                    "OSの資格情報ストアを利用可能にして再試行してください。",
                )
            })
    })
    .await
    .map_err(|error| AppError::database("keyring-save-task", error))?
}

async fn load_keyring(user: String) -> AppResult<String> {
    tokio::task::spawn_blocking(move || {
        Entry::new(KEYRING_SERVICE, &user)
            .and_then(|entry| entry.get_password())
            .map_err(|_| {
                unavailable(
                    "OS秘密ストアからOAuth設定を取得できません。",
                    "Googleへ再接続してください。独自のOAuth設定を使う場合は設定画面から読み込み直してください。",
                )
            })
    })
    .await
    .map_err(|error| AppError::database("keyring-read-task", error))?
}

async fn delete_keyring(user: String) -> AppResult<()> {
    tokio::task::spawn_blocking(move || {
        let entry = Entry::new(KEYRING_SERVICE, &user).map_err(|_| {
            unavailable(
                "OS秘密ストアを開けません。",
                "OSの資格情報ストアを確認してください。",
            )
        })?;
        match entry.delete_credential() {
            Ok(()) | Err(keyring::Error::NoEntry) => Ok(()),
            Err(_) => Err(unavailable(
                "OS秘密ストアからGoogle認証情報を削除できません。",
                "接続は保持されています。OSの資格情報ストアを確認して再試行してください。",
            )),
        }
    })
    .await
    .map_err(|error| AppError::database("keyring-delete-task", error))?
}

fn random_base64url(bytes: usize) -> String {
    let mut buffer = vec![0_u8; bytes];
    rand::rng().fill_bytes(&mut buffer);
    URL_SAFE_NO_PAD.encode(buffer)
}

fn client_id_hint(value: &str) -> String {
    let suffix = value
        .chars()
        .rev()
        .take(8)
        .collect::<String>()
        .chars()
        .rev()
        .collect::<String>();
    format!("…{suffix}")
}

fn parse_uuid(value: &str) -> AppResult<Uuid> {
    Uuid::parse_str(value).map_err(|error| AppError::database("google-uuid", error))
}

fn constant_time_eq(left: &[u8], right: &[u8]) -> bool {
    if left.len() != right.len() {
        return false;
    }
    left.iter()
        .zip(right)
        .fold(0_u8, |difference, (a, b)| difference | (a ^ b))
        == 0
}

fn oauth_attempt_is_current(attempt_id: u64) -> bool {
    OAUTH_ATTEMPT_GENERATION.load(Ordering::SeqCst) == attempt_id
}

fn token_failure_category(error: &str) -> OAuthFailureCategory {
    match error {
        "invalid_client" => OAuthFailureCategory::TokenInvalidClient,
        "invalid_grant" => OAuthFailureCategory::TokenInvalidGrant,
        "redirect_uri_mismatch" => OAuthFailureCategory::TokenRedirectUri,
        _ => OAuthFailureCategory::TokenRejected,
    }
}

fn ensure_oauth_attempt_is_current(attempt_id: u64) -> AppResult<()> {
    if oauth_attempt_is_current(attempt_id) {
        Ok(())
    } else {
        Err(AppError::Conflict {
            message: "このGoogle接続要求は取り消されています。".into(),
            recovery: "設定画面から新しい接続を完了してください。".into(),
        })
    }
}

fn validation(message: &str, recovery: &str) -> AppError {
    AppError::Validation {
        message: message.into(),
        recovery: recovery.into(),
    }
}

fn unavailable(message: &str, recovery: &str) -> AppError {
    AppError::Unavailable {
        message: message.into(),
        recovery: recovery.into(),
        retryable: true,
    }
}

fn default_color() -> String {
    "#6F96F4".into()
}

fn default_timezone() -> String {
    "UTC".into()
}

#[cfg(test)]
mod tests {
    use super::*;
    use crate::domain::SyncSummaryState;

    struct MockHttpResponse {
        status: &'static str,
        headers: Vec<(&'static str, &'static str)>,
        body: String,
    }

    impl MockHttpResponse {
        fn json(status: &'static str, body: Value) -> Self {
            Self {
                status,
                headers: vec![("Content-Type", "application/json")],
                body: body.to_string(),
            }
        }
    }

    async fn spawn_http_sequence(
        responses: Vec<MockHttpResponse>,
    ) -> (String, tokio::task::JoinHandle<Vec<String>>) {
        let listener = TcpListener::bind("127.0.0.1:0").await.unwrap();
        let address = listener.local_addr().unwrap();
        let handle = tokio::spawn(async move {
            let mut requests = Vec::new();
            for response in responses {
                let (mut stream, _) = listener.accept().await.unwrap();
                let mut request = Vec::new();
                let mut buffer = [0_u8; 2_048];
                loop {
                    let read = stream.read(&mut buffer).await.unwrap();
                    if read == 0 {
                        break;
                    }
                    request.extend_from_slice(&buffer[..read]);
                    if request.windows(4).any(|window| window == b"\r\n\r\n") {
                        break;
                    }
                }
                let request_line = String::from_utf8_lossy(&request)
                    .lines()
                    .next()
                    .unwrap_or_default()
                    .to_owned();
                requests.push(request_line);
                let extra_headers = response
                    .headers
                    .iter()
                    .map(|(name, value)| format!("{name}: {value}\r\n"))
                    .collect::<String>();
                let reply = format!(
                    "HTTP/1.1 {}\r\n{}Content-Length: {}\r\nConnection: close\r\n\r\n{}",
                    response.status,
                    extra_headers,
                    response.body.len(),
                    response.body
                );
                stream.write_all(reply.as_bytes()).await.unwrap();
                stream.shutdown().await.unwrap();
            }
            requests
        });
        (format!("http://{address}/calendar/v3/"), handle)
    }

    async fn seed_calendar(database: &Database, sync_token: Option<&str>) -> String {
        let account_id = Uuid::new_v4().to_string();
        let calendar_id = Uuid::new_v4().to_string();
        let now = Utc::now().to_rfc3339();
        sqlx::query(
            "INSERT INTO google_accounts(id, display_label, scopes_json, status, created_at_utc, updated_at_utc) VALUES (?, 'Synthetic Google', '[]', 'connected', ?, ?)",
        )
        .bind(&account_id)
        .bind(&now)
        .bind(&now)
        .execute(&database.pool)
        .await
        .unwrap();
        sqlx::query(
            "INSERT INTO google_calendars(id, account_id, remote_calendar_id, display_name, color, time_zone, access_role, selected, default_write_target, sync_token) VALUES (?, ?, 'synthetic-calendar', 'Synthetic calendar', '#6F96F4', 'UTC', 'owner', 1, 1, ?)",
        )
        .bind(&calendar_id)
        .bind(account_id)
        .bind(sync_token)
        .execute(&database.pool)
        .await
        .unwrap();
        calendar_id
    }

    async fn seed_additional_calendar(
        database: &Database,
        remote_calendar_id: &str,
        access_role: &str,
    ) -> String {
        let account_id: String = sqlx::query_scalar("SELECT id FROM google_accounts LIMIT 1")
            .fetch_one(&database.pool)
            .await
            .unwrap();
        let calendar_id = Uuid::new_v4().to_string();
        sqlx::query(
            "INSERT INTO google_calendars(id, account_id, remote_calendar_id, display_name, color, time_zone, access_role, selected, default_write_target) VALUES (?, ?, ?, 'Additional calendar', '#6F96F4', 'Asia/Tokyo', ?, 1, 0)",
        )
        .bind(&calendar_id)
        .bind(account_id)
        .bind(remote_calendar_id)
        .bind(access_role)
        .execute(&database.pool)
        .await
        .unwrap();
        calendar_id
    }

    fn local_draft() -> ScheduleDraft {
        ScheduleDraft {
            title: "Synthetic local schedule".into(),
            description: String::new(),
            location: String::new(),
            start_utc: Utc.with_ymd_and_hms(2026, 7, 20, 0, 0, 0).unwrap(),
            end_utc: Utc.with_ymd_and_hms(2026, 7, 20, 1, 0, 0).unwrap(),
            timezone_id: "UTC".into(),
            all_day: false,
            all_day_start_date: None,
            all_day_end_date_exclusive: None,
            status: ScheduleStatus::Scheduled,
            project: String::new(),
            category: String::new(),
            tags: Vec::new(),
            color: "#6F96F4".into(),
            priority: Priority::Normal,
            recurrence_rule: None,
            recurrence_supplemental_lines: Vec::new(),
            recurrence_exdates: Vec::new(),
            start_notification_minutes: None,
            end_notification_minutes: None,
        }
    }

    fn remote_event(id: &str, title: &str) -> Value {
        serde_json::json!({
            "id": id,
            "etag": format!("etag-{id}"),
            "updated": "2026-07-20T00:00:00Z",
            "summary": title,
            "description": "synthetic fixture",
            "location": "Synthetic room",
            "status": "confirmed",
            "start": { "dateTime": "2026-07-20T00:00:00Z", "timeZone": "UTC" },
            "end": { "dateTime": "2026-07-20T01:00:00Z", "timeZone": "UTC" }
        })
    }

    fn merge_draft() -> ScheduleDraft {
        serde_json::from_value(serde_json::json!({
            "title": "Base",
            "description": "description",
            "location": "",
            "startUtc": "2026-07-20T00:00:00Z",
            "endUtc": "2026-07-20T01:00:00Z",
            "timezoneId": "Asia/Tokyo",
            "allDay": false,
            "status": "scheduled",
            "project": "",
            "category": "",
            "tags": [],
            "color": "#6F96F4",
            "priority": "normal",
            "recurrenceRule": null,
            "startNotificationMinutes": null,
            "endNotificationMinutes": null
        }))
        .unwrap()
    }

    #[test]
    fn desktop_oauth_json_requires_official_endpoints_and_loopback() {
        let valid = OAuthInstalled {
            client_id: "synthetic-client-id.apps.googleusercontent.com".into(),
            client_secret: "synthetic-secret".into(),
            auth_uri: "https://accounts.google.com/o/oauth2/auth".into(),
            token_uri: "https://oauth2.googleapis.com/token".into(),
            redirect_uris: vec!["http://localhost".into()],
        };
        assert!(validate_oauth_installed(&valid).is_ok());
        let mut invalid = valid;
        invalid.token_uri = "https://example.invalid/token".into();
        assert!(validate_oauth_installed(&invalid).is_err());
    }

    #[test]
    fn built_in_oauth_client_uses_official_endpoints_without_a_secret() {
        let config =
            built_in_oauth_config(Some("synthetic-desktop-client.apps.googleusercontent.com"))
                .unwrap()
                .unwrap();

        assert_eq!(
            config.client_id,
            "synthetic-desktop-client.apps.googleusercontent.com"
        );
        assert!(config.client_secret.is_empty());
        assert_eq!(
            config.auth_uri,
            "https://accounts.google.com/o/oauth2/v2/auth"
        );
        assert_eq!(config.token_uri, "https://oauth2.googleapis.com/token");
    }

    #[test]
    fn built_in_oauth_client_rejects_malformed_ids() {
        assert!(built_in_oauth_config(None).unwrap().is_none());
        assert!(built_in_oauth_config(Some("not-a-desktop-client")).is_err());
        assert!(built_in_oauth_config(Some("contains space.apps.googleusercontent.com")).is_err());
    }

    #[test]
    fn provisioned_oauth_secret_must_match_the_built_client_id() {
        let client_id = "synthetic-desktop-client.apps.googleusercontent.com";
        let encoded = serde_json::json!({
            "client_id": client_id,
            "client_secret": "<redacted>"
        })
        .to_string();
        assert_eq!(
            parse_provisioned_oauth_secret(&encoded, client_id).unwrap(),
            "<redacted>"
        );
        assert!(
            parse_provisioned_oauth_secret(
                &encoded,
                "another-desktop-client.apps.googleusercontent.com"
            )
            .is_err()
        );
    }

    #[tokio::test]
    async fn reauthentication_updates_account_without_deleting_calendars() {
        let database = Database::open_memory().await.unwrap();
        let calendar_id = seed_calendar(&database, Some("preserved-token")).await;
        let original_account_id: String =
            sqlx::query_scalar("SELECT account_id FROM google_calendars WHERE id = ?")
                .bind(&calendar_id)
                .fetch_one(&database.pool)
                .await
                .unwrap();

        let account = oauth_account_target(&database).await.unwrap();
        assert!(account.existing);
        assert_eq!(account.account_id.to_string(), original_account_id);
        persist_connected_account(&database, &account, &Utc::now().to_rfc3339())
            .await
            .unwrap();

        let calendar_count: i64 =
            sqlx::query_scalar("SELECT COUNT(*) FROM google_calendars WHERE id = ?")
                .bind(&calendar_id)
                .fetch_one(&database.pool)
                .await
                .unwrap();
        let stored_sync_token: Option<String> =
            sqlx::query_scalar("SELECT sync_token FROM google_calendars WHERE id = ?")
                .bind(&calendar_id)
                .fetch_one(&database.pool)
                .await
                .unwrap();
        let stored_status: String =
            sqlx::query_scalar("SELECT status FROM google_accounts WHERE id = ?")
                .bind(account.account_id.to_string())
                .fetch_one(&database.pool)
                .await
                .unwrap();
        assert_eq!(calendar_count, 1);
        assert_eq!(stored_sync_token.as_deref(), Some("preserved-token"));
        assert_eq!(stored_status, "connected");
    }

    #[tokio::test]
    async fn unauthorized_calendar_list_marks_the_account_for_reauthentication() {
        let database = Database::open_memory().await.unwrap();
        let calendar_id = seed_calendar(&database, Some("preserved-token")).await;
        let account_id: String =
            sqlx::query_scalar("SELECT account_id FROM google_calendars WHERE id = ?")
                .bind(&calendar_id)
                .fetch_one(&database.pool)
                .await
                .unwrap();
        let (api_root, server) = spawn_http_sequence(vec![MockHttpResponse::json(
            "401 Unauthorized",
            serde_json::json!({}),
        )])
        .await;

        let result = fetch_and_persist_calendars_at(
            &database,
            &Client::new(),
            parse_uuid(&account_id).unwrap(),
            "synthetic-access-token",
            None,
            &format!("{api_root}users/me/calendarList"),
        )
        .await;
        server.await.unwrap();

        assert!(result.is_err());
        let states: (String, String, Option<String>) = sqlx::query_as(
            "SELECT a.status, c.sync_state, c.sync_token FROM google_accounts a JOIN google_calendars c ON c.account_id = a.id WHERE c.id = ?",
        )
        .bind(calendar_id)
        .fetch_one(&database.pool)
        .await
        .unwrap();
        assert_eq!(
            states,
            (
                "auth_required".into(),
                "auth_required".into(),
                Some("preserved-token".into())
            )
        );
    }

    #[tokio::test]
    async fn calendar_list_never_selects_a_free_busy_only_calendar_for_event_sync() {
        let database = Database::open_memory().await.unwrap();
        let existing_calendar = seed_calendar(&database, None).await;
        let account_id: String =
            sqlx::query_scalar("SELECT account_id FROM google_calendars WHERE id = ?")
                .bind(existing_calendar)
                .fetch_one(&database.pool)
                .await
                .unwrap();
        let (api_root, server) = spawn_http_sequence(vec![MockHttpResponse::json(
            "200 OK",
            serde_json::json!({
                "items": [{
                    "id": "synthetic-free-busy",
                    "summary": "Free busy only",
                    "backgroundColor": "#6F96F4",
                    "timeZone": "Asia/Tokyo",
                    "accessRole": "freeBusyReader",
                    "selected": true,
                    "primary": false
                }]
            }),
        )])
        .await;

        fetch_and_persist_calendars_at(
            &database,
            &Client::new(),
            parse_uuid(&account_id).unwrap(),
            "synthetic-access-token",
            None,
            &format!("{api_root}users/me/calendarList"),
        )
        .await
        .unwrap();
        server.await.unwrap();

        let selected: bool = sqlx::query_scalar(
            "SELECT selected FROM google_calendars WHERE account_id = ? AND remote_calendar_id = 'synthetic-free-busy'",
        )
        .bind(account_id)
        .fetch_one(&database.pool)
        .await
        .unwrap();
        assert!(!selected);
    }

    #[test]
    fn pkce_and_state_use_high_entropy_url_safe_values() {
        let first = random_base64url(48);
        let second = random_base64url(48);
        assert_ne!(first, second);
        assert!(first.len() >= 64);
        assert!(
            first
                .bytes()
                .all(|byte| byte.is_ascii_alphanumeric() || matches!(byte, b'-' | b'_'))
        );
    }

    #[test]
    fn google_event_id_is_stable_and_base32hex() {
        let id = Uuid::parse_str("550e8400-e29b-41d4-a716-446655440000").unwrap();
        let first = google_event_id(id);
        assert_eq!(first, google_event_id(id));
        assert!(first.starts_with("dsn"));
        assert!(
            first
                .bytes()
                .all(|byte| matches!(byte, b'0'..=b'9' | b'a'..=b'v'))
        );
    }

    #[test]
    fn three_way_merge_auto_combines_non_overlapping_fields() {
        let base = merge_draft();
        let mut local = base.clone();
        local.title = "Local title".into();
        let mut remote = base.clone();
        remote.location = "Remote room".into();
        let (merged, conflicts) = merge_schedule_drafts(&base, &local, &remote).unwrap();
        assert!(conflicts.is_empty());
        assert_eq!(merged.title, "Local title");
        assert_eq!(merged.location, "Remote room");
    }

    #[test]
    fn three_way_merge_reports_same_field_conflict() {
        let base = merge_draft();
        let mut local = base.clone();
        local.title = "Local title".into();
        let mut remote = base.clone();
        remote.title = "Remote title".into();
        let (_, conflicts) = merge_schedule_drafts(&base, &local, &remote).unwrap();
        assert_eq!(conflicts, vec!["title"]);
    }

    #[tokio::test]
    async fn mock_sync_pages_initial_events_then_applies_incremental_delete_atomically() {
        let database = Database::open_memory().await.unwrap();
        let calendar_id = seed_calendar(&database, None).await;
        let (api_root, server) = spawn_http_sequence(vec![
            MockHttpResponse::json(
                "200 OK",
                serde_json::json!({
                    "items": [remote_event("event-a", "Page one")],
                    "nextPageToken": "page-two"
                }),
            ),
            MockHttpResponse::json(
                "200 OK",
                serde_json::json!({
                    "items": [remote_event("event-b", "Page two")],
                    "nextSyncToken": "sync-one"
                }),
            ),
        ])
        .await;
        pull_one_calendar_at(
            &database,
            &Client::new(),
            "synthetic-access-token",
            CalendarPullRequest {
                local_calendar_id: &calendar_id,
                remote_calendar_id: "synthetic-calendar",
                access_role: "owner",
                initial_sync_token: None,
                api_root: &api_root,
            },
            &OperationCancellation::default(),
        )
        .await
        .unwrap();
        let requests = server.await.unwrap();
        assert_eq!(requests.len(), 2);
        assert!(requests[0].starts_with("GET /calendar/v3/calendars/synthetic-calendar/events?"));
        assert!(!requests[0].contains("pageToken"));
        assert!(requests[0].contains("showDeleted=true"));
        assert!(requests[0].contains("singleEvents=false"));
        assert!(requests[0].contains("maxResults=250"));
        assert!(!requests[0].contains("fields="));
        assert!(requests[1].contains("pageToken=page-two"));
        let schedule_count: i64 =
            sqlx::query_scalar("SELECT COUNT(*) FROM schedule_items WHERE deleted_at_utc IS NULL")
                .fetch_one(&database.pool)
                .await
                .unwrap();
        let token: String =
            sqlx::query_scalar("SELECT sync_token FROM google_calendars WHERE id = ?")
                .bind(&calendar_id)
                .fetch_one(&database.pool)
                .await
                .unwrap();
        assert_eq!(schedule_count, 2);
        assert_eq!(token, "sync-one");

        let (api_root, server) = spawn_http_sequence(vec![MockHttpResponse::json(
            "200 OK",
            serde_json::json!({
                "items": [{ "id": "event-a", "etag": "etag-deleted", "status": "cancelled" }],
                "nextSyncToken": "sync-two"
            }),
        )])
        .await;
        pull_one_calendar_at(
            &database,
            &Client::new(),
            "synthetic-access-token",
            CalendarPullRequest {
                local_calendar_id: &calendar_id,
                remote_calendar_id: "synthetic-calendar",
                access_role: "owner",
                initial_sync_token: Some("sync-one"),
                api_root: &api_root,
            },
            &OperationCancellation::default(),
        )
        .await
        .unwrap();
        let requests = server.await.unwrap();
        assert!(requests[0].contains("syncToken=sync-one"));
        let deleted_count: i64 = sqlx::query_scalar(
            "SELECT COUNT(*) FROM schedule_items WHERE deleted_at_utc IS NOT NULL",
        )
        .fetch_one(&database.pool)
        .await
        .unwrap();
        let token: String =
            sqlx::query_scalar("SELECT sync_token FROM google_calendars WHERE id = ?")
                .bind(&calendar_id)
                .fetch_one(&database.pool)
                .await
                .unwrap();
        assert_eq!(deleted_count, 1);
        assert_eq!(token, "sync-two");
    }

    #[test]
    fn google_recurrence_set_parts_are_imported_without_silent_loss() {
        let mut event = remote_event("recurrence-set", "Recurrence set");
        event["recurrence"] = serde_json::json!([
            "RRULE:FREQ=DAILY;COUNT=3",
            "RDATE;TZID=UTC:20260723T000000",
            "EXRULE:FREQ=WEEKLY;BYDAY=SU",
            "EXDATE:20260721T000000Z"
        ]);

        let mut draft = remote_event_to_draft(&event).unwrap();
        draft.validate().unwrap();

        assert_eq!(draft.recurrence_rule.as_deref(), Some("FREQ=DAILY;COUNT=3"));
        assert_eq!(
            draft.recurrence_supplemental_lines,
            [
                "EXRULE:FREQ=WEEKLY;BYDAY=SU",
                "RDATE;TZID=UTC:20260723T000000"
            ]
        );
        assert_eq!(
            draft.recurrence_exdates,
            [Utc.with_ymd_and_hms(2026, 7, 21, 0, 0, 0).unwrap()]
        );

        let schedule = Schedule {
            id: Uuid::new_v4(),
            draft,
            sync_status: SyncStatus::ReadOnly,
            version: 1,
            deleted_at: None,
        };
        let mut encoded = serde_json::json!({});
        apply_owned_fields(&mut encoded, &schedule, "recurrence-set").unwrap();
        assert_eq!(
            encoded["recurrence"],
            serde_json::json!([
                "RRULE:FREQ=DAILY;COUNT=3",
                "EXRULE:FREQ=WEEKLY;BYDAY=SU",
                "RDATE;TZID=UTC:20260723T000000",
                "EXDATE:20260721T000000Z"
            ])
        );
    }

    #[test]
    fn google_ordinal_byday_rule_is_imported() {
        let mut event = remote_event("ordinal-byday", "Ordinal weekday");
        event["recurrence"] = serde_json::json!(["RRULE:FREQ=MONTHLY;COUNT=3;BYDAY=-1MO;WKST=SU"]);

        let mut draft = remote_event_to_draft(&event).unwrap();
        draft.validate().unwrap();
    }

    #[tokio::test]
    async fn complex_google_recurrence_commits_the_event_and_next_sync_token() {
        let database = Database::open_memory().await.unwrap();
        let calendar_id = seed_calendar(&database, None).await;
        let mut event = remote_event("complex-recurrence", "Complex recurrence");
        event["recurrence"] = serde_json::json!([
            "RRULE:FREQ=DAILY;COUNT=3",
            "RRULE:FREQ=MONTHLY;COUNT=2;BYDAY=-1MO;WKST=SU",
            "RDATE;TZID=UTC:20260723T000000",
            "EXRULE:FREQ=WEEKLY;BYDAY=SU",
            "EXDATE:20260721T000000Z"
        ]);
        let (api_root, server) = spawn_http_sequence(vec![MockHttpResponse::json(
            "200 OK",
            serde_json::json!({
                "items": [event],
                "nextSyncToken": "complex-recurrence-token"
            }),
        )])
        .await;

        pull_one_calendar_at(
            &database,
            &Client::new(),
            "synthetic-access-token",
            CalendarPullRequest {
                local_calendar_id: &calendar_id,
                remote_calendar_id: "synthetic-calendar",
                access_role: "owner",
                initial_sync_token: None,
                api_root: &api_root,
            },
            &OperationCancellation::default(),
        )
        .await
        .unwrap();
        server.await.unwrap();

        let stored: (String, String, String, String, String) = sqlx::query_as(
            "SELECT s.sync_status, s.recurrence_rule, s.recurrence_supplemental_lines_json, c.sync_state, c.sync_token FROM schedule_items s JOIN sync_mappings m ON m.schedule_item_id = s.id JOIN google_calendars c ON c.id = m.calendar_id WHERE m.calendar_id = ? AND m.remote_event_id = 'complex-recurrence'",
        )
        .bind(calendar_id)
        .fetch_one(&database.pool)
        .await
        .unwrap();

        assert_eq!(stored.0, "read_only");
        assert_eq!(stored.1, "FREQ=DAILY;COUNT=3");
        assert_eq!(
            serde_json::from_str::<Vec<String>>(&stored.2).unwrap(),
            [
                "EXRULE:FREQ=WEEKLY;BYDAY=SU",
                "RDATE;TZID=UTC:20260723T000000",
                "RRULE:FREQ=MONTHLY;COUNT=2;BYDAY=-1MO;WKST=SU"
            ]
        );
        assert_eq!(stored.3, "synced");
        assert_eq!(stored.4, "complex-recurrence-token");
    }

    #[tokio::test]
    async fn unrepresentable_recurrence_preserves_the_previous_token_and_events() {
        let database = Database::open_memory().await.unwrap();
        let calendar_id = seed_calendar(&database, None).await;
        let (initial_root, initial_server) = spawn_http_sequence(vec![MockHttpResponse::json(
            "200 OK",
            serde_json::json!({
                "items": [remote_event("preserved-event", "Preserved event")],
                "nextSyncToken": "preserved-token"
            }),
        )])
        .await;
        pull_one_calendar_at(
            &database,
            &Client::new(),
            "synthetic-access-token",
            CalendarPullRequest {
                local_calendar_id: &calendar_id,
                remote_calendar_id: "synthetic-calendar",
                access_role: "owner",
                initial_sync_token: None,
                api_root: &initial_root,
            },
            &OperationCancellation::default(),
        )
        .await
        .unwrap();
        initial_server.await.unwrap();

        let mut event = remote_event("period-rdate", "Period RDATE");
        event["recurrence"] = serde_json::json!([
            "RRULE:FREQ=DAILY;COUNT=2",
            "RDATE;VALUE=PERIOD:20260723T000000Z/20260723T020000Z"
        ]);
        let (invalid_root, invalid_server) = spawn_http_sequence(vec![MockHttpResponse::json(
            "200 OK",
            serde_json::json!({
                "items": [event],
                "nextSyncToken": "must-not-commit"
            }),
        )])
        .await;
        let result = pull_one_calendar_at(
            &database,
            &Client::new(),
            "synthetic-access-token",
            CalendarPullRequest {
                local_calendar_id: &calendar_id,
                remote_calendar_id: "synthetic-calendar",
                access_role: "owner",
                initial_sync_token: Some("preserved-token"),
                api_root: &invalid_root,
            },
            &OperationCancellation::default(),
        )
        .await;
        invalid_server.await.unwrap();

        let calendar: (String, String) =
            sqlx::query_as("SELECT sync_state, sync_token FROM google_calendars WHERE id = ?")
                .bind(&calendar_id)
                .fetch_one(&database.pool)
                .await
                .unwrap();
        let active_mapped_count: i64 = sqlx::query_scalar(
            "SELECT COUNT(*) FROM schedule_items s JOIN sync_mappings m ON m.schedule_item_id = s.id WHERE m.calendar_id = ? AND s.deleted_at_utc IS NULL",
        )
        .bind(calendar_id)
        .fetch_one(&database.pool)
        .await
        .unwrap();

        assert!(matches!(result, Err(AppError::Validation { .. })));
        assert_eq!(calendar, ("unavailable".into(), "preserved-token".into()));
        assert_eq!(active_mapped_count, 1);
    }

    #[tokio::test]
    async fn moved_recurrence_exception_is_linked_and_excludes_the_original_occurrence() {
        let database = Database::open_memory().await.unwrap();
        let calendar_id = seed_calendar(&database, None).await;
        let mut master = remote_event("series-master", "Recurring master");
        master["recurrence"] = serde_json::json!(["RRULE:FREQ=DAILY;COUNT=3"]);
        let mut moved = remote_event("series-moved-instance", "Moved instance");
        moved["recurringEventId"] = serde_json::json!("series-master");
        moved["originalStartTime"] =
            serde_json::json!({ "dateTime": "2026-07-21T00:00:00Z", "timeZone": "UTC" });
        moved["start"] =
            serde_json::json!({ "dateTime": "2026-07-21T02:00:00Z", "timeZone": "UTC" });
        moved["end"] = serde_json::json!({ "dateTime": "2026-07-21T03:00:00Z", "timeZone": "UTC" });
        let (api_root, server) = spawn_http_sequence(vec![MockHttpResponse::json(
            "200 OK",
            serde_json::json!({
                // The API does not promise master-before-exception ordering.
                "items": [moved, master],
                "nextSyncToken": "recurrence-token"
            }),
        )])
        .await;

        pull_one_calendar_at(
            &database,
            &Client::new(),
            "synthetic-access-token",
            CalendarPullRequest {
                local_calendar_id: &calendar_id,
                remote_calendar_id: "synthetic-calendar",
                access_role: "owner",
                initial_sync_token: None,
                api_root: &api_root,
            },
            &OperationCancellation::default(),
        )
        .await
        .unwrap();
        server.await.unwrap();

        let master_id: String = sqlx::query_scalar(
            "SELECT schedule_item_id FROM sync_mappings WHERE calendar_id = ? AND remote_event_id = 'series-master'",
        )
        .bind(&calendar_id)
        .fetch_one(&database.pool)
        .await
        .unwrap();
        let exception_row = sqlx::query(
            "SELECT s.recurrence_series_id, s.recurrence_original_start_utc FROM schedule_items s JOIN sync_mappings m ON m.schedule_item_id = s.id WHERE m.calendar_id = ? AND m.remote_event_id = 'series-moved-instance'",
        )
        .bind(&calendar_id)
        .fetch_one(&database.pool)
        .await
        .unwrap();
        let master_exdates: String =
            sqlx::query_scalar("SELECT recurrence_exdates_json FROM schedule_items WHERE id = ?")
                .bind(&master_id)
                .fetch_one(&database.pool)
                .await
                .unwrap();

        assert_eq!(
            exception_row.get::<Option<String>, _>("recurrence_series_id"),
            Some(master_id)
        );
        assert_eq!(
            exception_row
                .get::<Option<String>, _>("recurrence_original_start_utc")
                .as_deref(),
            Some("2026-07-21T00:00:00+00:00")
        );
        assert!(master_exdates.contains("2026-07-21T00:00:00Z"));
    }

    #[tokio::test]
    async fn cancelled_recurrence_exception_excludes_the_occurrence_without_a_standalone_item() {
        let database = Database::open_memory().await.unwrap();
        let calendar_id = seed_calendar(&database, None).await;
        let mut master = remote_event("cancel-series-master", "Recurring master");
        master["recurrence"] = serde_json::json!(["RRULE:FREQ=DAILY;COUNT=3"]);
        let cancelled = serde_json::json!({
            "id": "cancelled-instance",
            "status": "cancelled",
            "recurringEventId": "cancel-series-master",
            "originalStartTime": {
                "dateTime": "2026-07-21T00:00:00Z",
                "timeZone": "UTC"
            }
        });
        let (api_root, server) = spawn_http_sequence(vec![MockHttpResponse::json(
            "200 OK",
            serde_json::json!({
                "items": [cancelled, master],
                "nextSyncToken": "cancel-token"
            }),
        )])
        .await;

        pull_one_calendar_at(
            &database,
            &Client::new(),
            "synthetic-access-token",
            CalendarPullRequest {
                local_calendar_id: &calendar_id,
                remote_calendar_id: "synthetic-calendar",
                access_role: "owner",
                initial_sync_token: None,
                api_root: &api_root,
            },
            &OperationCancellation::default(),
        )
        .await
        .unwrap();
        server.await.unwrap();

        let master_exdates: String = sqlx::query_scalar(
            "SELECT s.recurrence_exdates_json FROM schedule_items s JOIN sync_mappings m ON m.schedule_item_id = s.id WHERE m.calendar_id = ? AND m.remote_event_id = 'cancel-series-master'",
        )
        .bind(&calendar_id)
        .fetch_one(&database.pool)
        .await
        .unwrap();
        let standalone_count: i64 = sqlx::query_scalar(
            "SELECT COUNT(*) FROM sync_mappings WHERE calendar_id = ? AND remote_event_id = 'cancelled-instance'",
        )
        .bind(&calendar_id)
        .fetch_one(&database.pool)
        .await
        .unwrap();

        assert!(master_exdates.contains("2026-07-21T00:00:00Z"));
        assert_eq!(standalone_count, 0);
    }

    #[tokio::test]
    async fn full_sync_missing_exception_restores_the_master_occurrence() {
        let database = Database::open_memory().await.unwrap();
        let calendar_id = seed_calendar(&database, None).await;
        let mut master = remote_event("reset-series-master", "Recurring master");
        master["recurrence"] = serde_json::json!(["RRULE:FREQ=DAILY;COUNT=3"]);
        let mut moved = remote_event("reset-series-instance", "Moved instance");
        moved["recurringEventId"] = serde_json::json!("reset-series-master");
        moved["originalStartTime"] =
            serde_json::json!({ "dateTime": "2026-07-21T00:00:00Z", "timeZone": "UTC" });
        let (initial_root, initial_server) = spawn_http_sequence(vec![MockHttpResponse::json(
            "200 OK",
            serde_json::json!({
                "items": [master.clone(), moved],
                "nextSyncToken": "initial-reset-token"
            }),
        )])
        .await;
        pull_one_calendar_at(
            &database,
            &Client::new(),
            "synthetic-access-token",
            CalendarPullRequest {
                local_calendar_id: &calendar_id,
                remote_calendar_id: "synthetic-calendar",
                access_role: "owner",
                initial_sync_token: None,
                api_root: &initial_root,
            },
            &OperationCancellation::default(),
        )
        .await
        .unwrap();
        initial_server.await.unwrap();

        let (reset_root, reset_server) = spawn_http_sequence(vec![MockHttpResponse::json(
            "200 OK",
            serde_json::json!({
                "items": [master],
                "nextSyncToken": "reset-token"
            }),
        )])
        .await;
        pull_one_calendar_at(
            &database,
            &Client::new(),
            "synthetic-access-token",
            CalendarPullRequest {
                local_calendar_id: &calendar_id,
                remote_calendar_id: "synthetic-calendar",
                access_role: "owner",
                initial_sync_token: None,
                api_root: &reset_root,
            },
            &OperationCancellation::default(),
        )
        .await
        .unwrap();
        reset_server.await.unwrap();

        let master_exdates: String = sqlx::query_scalar(
            "SELECT s.recurrence_exdates_json FROM schedule_items s JOIN sync_mappings m ON m.schedule_item_id = s.id WHERE m.calendar_id = ? AND m.remote_event_id = 'reset-series-master'",
        )
        .bind(&calendar_id)
        .fetch_one(&database.pool)
        .await
        .unwrap();
        let exception_deleted: Option<String> = sqlx::query_scalar(
            "SELECT s.deleted_at_utc FROM schedule_items s JOIN sync_mappings m ON m.schedule_item_id = s.id WHERE m.calendar_id = ? AND m.remote_event_id = 'reset-series-instance'",
        )
        .bind(&calendar_id)
        .fetch_one(&database.pool)
        .await
        .unwrap();

        assert_eq!(master_exdates, "[]");
        assert!(exception_deleted.is_some());
    }

    #[tokio::test]
    async fn deleted_recurrence_master_also_deletes_linked_remote_exceptions() {
        let database = Database::open_memory().await.unwrap();
        let calendar_id = seed_calendar(&database, None).await;
        let mut master = remote_event("deleted-series-master", "Recurring master");
        master["recurrence"] = serde_json::json!(["RRULE:FREQ=DAILY;COUNT=3"]);
        let mut moved = remote_event("deleted-series-instance", "Moved instance");
        moved["recurringEventId"] = serde_json::json!("deleted-series-master");
        moved["originalStartTime"] =
            serde_json::json!({ "dateTime": "2026-07-21T00:00:00Z", "timeZone": "UTC" });
        let (initial_root, initial_server) = spawn_http_sequence(vec![MockHttpResponse::json(
            "200 OK",
            serde_json::json!({
                "items": [master, moved],
                "nextSyncToken": "series-before-delete"
            }),
        )])
        .await;
        pull_one_calendar_at(
            &database,
            &Client::new(),
            "synthetic-access-token",
            CalendarPullRequest {
                local_calendar_id: &calendar_id,
                remote_calendar_id: "synthetic-calendar",
                access_role: "owner",
                initial_sync_token: None,
                api_root: &initial_root,
            },
            &OperationCancellation::default(),
        )
        .await
        .unwrap();
        initial_server.await.unwrap();

        let (delete_root, delete_server) = spawn_http_sequence(vec![MockHttpResponse::json(
            "200 OK",
            serde_json::json!({
                "items": [{
                    "id": "deleted-series-master",
                    "status": "cancelled",
                    "etag": "deleted-master-etag"
                }],
                "nextSyncToken": "series-after-delete"
            }),
        )])
        .await;
        pull_one_calendar_at(
            &database,
            &Client::new(),
            "synthetic-access-token",
            CalendarPullRequest {
                local_calendar_id: &calendar_id,
                remote_calendar_id: "synthetic-calendar",
                access_role: "owner",
                initial_sync_token: Some("series-before-delete"),
                api_root: &delete_root,
            },
            &OperationCancellation::default(),
        )
        .await
        .unwrap();
        delete_server.await.unwrap();

        let active_count: i64 = sqlx::query_scalar(
            "SELECT COUNT(*) FROM schedule_items s JOIN sync_mappings m ON m.schedule_item_id = s.id WHERE m.calendar_id = ? AND s.deleted_at_utc IS NULL",
        )
        .bind(calendar_id)
        .fetch_one(&database.pool)
        .await
        .unwrap();
        assert_eq!(active_count, 0);
    }

    #[test]
    fn event_and_exdate_use_the_calendar_timezone_when_the_event_omits_one() {
        let mut event = remote_event("timezone-fallback", "Timezone fallback");
        event["start"] = serde_json::json!({ "dateTime": "2026-07-20T09:00:00+09:00" });
        event["end"] = serde_json::json!({ "dateTime": "2026-07-20T10:00:00+09:00" });
        event["recurrence"] = serde_json::json!([
            "RRULE:FREQ=DAILY;COUNT=3",
            "EXDATE;TZID=Asia/Tokyo:20260721T090000"
        ]);

        let draft = remote_event_to_draft_in_timezone(&event, "Asia/Tokyo").unwrap();

        assert_eq!(draft.timezone_id, "Asia/Tokyo");
        assert_eq!(
            draft.recurrence_exdates,
            vec![Utc.with_ymd_and_hms(2026, 7, 21, 0, 0, 0).unwrap()]
        );
    }

    #[tokio::test]
    async fn forbidden_calendar_does_not_block_another_selected_calendar() {
        let database = Database::open_memory().await.unwrap();
        let forbidden_calendar = seed_calendar(&database, None).await;
        sqlx::query(
            "UPDATE google_calendars SET remote_calendar_id = 'forbidden-calendar' WHERE id = ?",
        )
        .bind(&forbidden_calendar)
        .execute(&database.pool)
        .await
        .unwrap();
        let readable_calendar =
            seed_additional_calendar(&database, "readable-calendar", "reader").await;
        let (api_root, server) = spawn_http_sequence(vec![
            MockHttpResponse::json("403 Forbidden", serde_json::json!({})),
            MockHttpResponse::json(
                "200 OK",
                serde_json::json!({
                    "items": [remote_event("readable-event", "Readable event")],
                    "nextSyncToken": "readable-token"
                }),
            ),
        ])
        .await;

        pull_selected_calendars_at(
            &database,
            &Client::new(),
            "synthetic-access-token",
            &OperationCancellation::default(),
            &api_root,
        )
        .await
        .unwrap();
        server.await.unwrap();

        let forbidden_state: (String, Option<String>, Option<String>) = sqlx::query_as(
            "SELECT sync_state, last_error_category, sync_token FROM google_calendars WHERE id = ?",
        )
        .bind(forbidden_calendar)
        .fetch_one(&database.pool)
        .await
        .unwrap();
        let readable_state: (String, Option<String>, Option<String>) = sqlx::query_as(
            "SELECT sync_state, last_error_category, sync_token FROM google_calendars WHERE id = ?",
        )
        .bind(readable_calendar)
        .fetch_one(&database.pool)
        .await
        .unwrap();

        assert_eq!(
            forbidden_state,
            ("unavailable".into(), Some("permission".into()), None)
        );
        assert_eq!(
            readable_state,
            ("synced".into(), None, Some("readable-token".into()))
        );
        assert_eq!(
            database.sync_summary().await.unwrap().state,
            SyncSummaryState::CalendarUnavailable
        );
    }

    #[tokio::test]
    async fn transient_calendar_failure_preserves_token_and_does_not_block_another_calendar() {
        for (status, headers, expected_category) in [
            (
                "429 Too Many Requests",
                vec![("Retry-After", "120")],
                "rate_limited",
            ),
            ("503 Service Unavailable", Vec::new(), "server"),
        ] {
            let database = Database::open_memory().await.unwrap();
            let retry_calendar = seed_calendar(&database, Some("preserved-token")).await;
            sqlx::query(
                "UPDATE google_calendars SET remote_calendar_id = 'a-retry-calendar' WHERE id = ?",
            )
            .bind(&retry_calendar)
            .execute(&database.pool)
            .await
            .unwrap();
            let readable_calendar =
                seed_additional_calendar(&database, "z-readable-calendar", "reader").await;
            let (api_root, server) = spawn_http_sequence(vec![
                MockHttpResponse {
                    status,
                    headers,
                    body: "{}".into(),
                },
                MockHttpResponse::json(
                    "200 OK",
                    serde_json::json!({
                        "items": [remote_event("transient-readable-event", "Readable event")],
                        "nextSyncToken": "readable-token"
                    }),
                ),
            ])
            .await;

            pull_selected_calendars_at(
                &database,
                &Client::new(),
                "synthetic-access-token",
                &OperationCancellation::default(),
                &api_root,
            )
            .await
            .unwrap();
            server.await.unwrap();

            let retry_state: (String, Option<String>, Option<String>, Option<String>) =
                sqlx::query_as(
                    "SELECT sync_state, last_error_category, sync_token, next_retry_at_utc FROM google_calendars WHERE id = ?",
                )
                .bind(retry_calendar)
                .fetch_one(&database.pool)
                .await
                .unwrap();
            let readable_state: (String, Option<String>) =
                sqlx::query_as("SELECT sync_state, sync_token FROM google_calendars WHERE id = ?")
                    .bind(readable_calendar)
                    .fetch_one(&database.pool)
                    .await
                    .unwrap();

            assert_eq!(retry_state.0, "retry_scheduled");
            assert_eq!(retry_state.1.as_deref(), Some(expected_category));
            assert_eq!(retry_state.2.as_deref(), Some("preserved-token"));
            assert!(retry_state.3.is_some());
            assert_eq!(
                readable_state,
                ("synced".into(), Some("readable-token".into()))
            );
            assert_eq!(
                database.sync_summary().await.unwrap().state,
                SyncSummaryState::RetryScheduled
            );
        }
    }

    #[tokio::test]
    async fn unauthorized_calendar_aborts_the_batch_and_marks_account_for_reauthentication() {
        let database = Database::open_memory().await.unwrap();
        seed_calendar(&database, None).await;
        let untouched_calendar =
            seed_additional_calendar(&database, "untouched-calendar", "reader").await;
        let (api_root, server) = spawn_http_sequence(vec![MockHttpResponse::json(
            "401 Unauthorized",
            serde_json::json!({}),
        )])
        .await;

        let result = pull_selected_calendars_at(
            &database,
            &Client::new(),
            "synthetic-access-token",
            &OperationCancellation::default(),
            &api_root,
        )
        .await;
        server.await.unwrap();

        assert!(result.is_err());
        let account_status: String =
            sqlx::query_scalar("SELECT status FROM google_accounts LIMIT 1")
                .fetch_one(&database.pool)
                .await
                .unwrap();
        let untouched_state: String =
            sqlx::query_scalar("SELECT sync_state FROM google_calendars WHERE id = ?")
                .bind(untouched_calendar)
                .fetch_one(&database.pool)
                .await
                .unwrap();
        assert_eq!(account_status, "auth_required");
        assert_eq!(untouched_state, "auth_required");
    }

    #[tokio::test]
    async fn expired_sync_token_retries_full_without_committing_the_stale_token() {
        let database = Database::open_memory().await.unwrap();
        let calendar_id = seed_calendar(&database, None).await;
        let (initial_api_root, initial_server) = spawn_http_sequence(vec![MockHttpResponse::json(
            "200 OK",
            serde_json::json!({
                "items": [remote_event("removed-before-resync", "Removed remotely")],
                "nextSyncToken": "initial-token"
            }),
        )])
        .await;
        pull_one_calendar_at(
            &database,
            &Client::new(),
            "synthetic-access-token",
            CalendarPullRequest {
                local_calendar_id: &calendar_id,
                remote_calendar_id: "synthetic-calendar",
                access_role: "owner",
                initial_sync_token: None,
                api_root: &initial_api_root,
            },
            &OperationCancellation::default(),
        )
        .await
        .unwrap();
        initial_server.await.unwrap();
        sqlx::query("UPDATE google_calendars SET sync_token = 'stale-token' WHERE id = ?")
            .bind(&calendar_id)
            .execute(&database.pool)
            .await
            .unwrap();
        let (api_root, server) = spawn_http_sequence(vec![
            MockHttpResponse::json("410 Gone", serde_json::json!({ "error": "gone" })),
            MockHttpResponse::json(
                "200 OK",
                serde_json::json!({ "items": [], "nextSyncToken": "fresh-token" }),
            ),
        ])
        .await;
        pull_one_calendar_at(
            &database,
            &Client::new(),
            "synthetic-access-token",
            CalendarPullRequest {
                local_calendar_id: &calendar_id,
                remote_calendar_id: "synthetic-calendar",
                access_role: "owner",
                initial_sync_token: Some("stale-token"),
                api_root: &api_root,
            },
            &OperationCancellation::default(),
        )
        .await
        .unwrap();
        let requests = server.await.unwrap();
        assert!(requests[0].contains("syncToken=stale-token"));
        assert!(!requests[1].contains("syncToken"));
        let token: String =
            sqlx::query_scalar("SELECT sync_token FROM google_calendars WHERE id = ?")
                .bind(calendar_id)
                .fetch_one(&database.pool)
                .await
                .unwrap();
        assert_eq!(token, "fresh-token");
        let deleted_count: i64 = sqlx::query_scalar(
            "SELECT COUNT(*) FROM schedule_items WHERE deleted_at_utc IS NOT NULL",
        )
        .fetch_one(&database.pool)
        .await
        .unwrap();
        assert_eq!(deleted_count, 1);
    }

    #[tokio::test]
    async fn full_resync_preserves_pending_local_edit_as_a_delete_conflict() {
        let database = Database::open_memory().await.unwrap();
        let calendar_id = seed_calendar(&database, None).await;
        let (initial_api_root, initial_server) = spawn_http_sequence(vec![MockHttpResponse::json(
            "200 OK",
            serde_json::json!({
                "items": [remote_event("pending-local-event", "Remote base")],
                "nextSyncToken": "initial-token"
            }),
        )])
        .await;
        pull_one_calendar_at(
            &database,
            &Client::new(),
            "synthetic-access-token",
            CalendarPullRequest {
                local_calendar_id: &calendar_id,
                remote_calendar_id: "synthetic-calendar",
                access_role: "owner",
                initial_sync_token: None,
                api_root: &initial_api_root,
            },
            &OperationCancellation::default(),
        )
        .await
        .unwrap();
        initial_server.await.unwrap();
        let schedule_id: String =
            sqlx::query_scalar("SELECT schedule_item_id FROM sync_mappings WHERE calendar_id = ?")
                .bind(&calendar_id)
                .fetch_one(&database.pool)
                .await
                .unwrap();
        let schedule_id = parse_uuid(&schedule_id).unwrap();
        let schedule = database.schedule(schedule_id).await.unwrap();
        let mut local_draft = schedule.draft;
        local_draft.title = "Pending local edit".into();
        database
            .update_schedule(schedule_id, schedule.version, local_draft)
            .await
            .unwrap();
        sqlx::query("UPDATE google_calendars SET sync_token = 'stale-token' WHERE id = ?")
            .bind(&calendar_id)
            .execute(&database.pool)
            .await
            .unwrap();

        let (api_root, server) = spawn_http_sequence(vec![
            MockHttpResponse::json("410 Gone", serde_json::json!({ "error": "gone" })),
            MockHttpResponse::json(
                "200 OK",
                serde_json::json!({ "items": [], "nextSyncToken": "fresh-token" }),
            ),
        ])
        .await;
        pull_one_calendar_at(
            &database,
            &Client::new(),
            "synthetic-access-token",
            CalendarPullRequest {
                local_calendar_id: &calendar_id,
                remote_calendar_id: "synthetic-calendar",
                access_role: "owner",
                initial_sync_token: Some("stale-token"),
                api_root: &api_root,
            },
            &OperationCancellation::default(),
        )
        .await
        .unwrap();
        server.await.unwrap();

        let preserved = database.schedule(schedule_id).await.unwrap();
        assert_eq!(preserved.draft.title, "Pending local edit");
        assert!(preserved.deleted_at.is_none());
        assert_eq!(preserved.sync_status, SyncStatus::Conflict);
        let conflict_count: i64 = sqlx::query_scalar(
            "SELECT COUNT(*) FROM sync_conflicts WHERE schedule_item_id = ? AND status = 'unresolved'",
        )
        .bind(schedule_id.to_string())
        .fetch_one(&database.pool)
        .await
        .unwrap();
        assert_eq!(conflict_count, 1);
    }

    #[tokio::test]
    async fn http_matrix_classifies_reauth_conflict_rate_limit_and_server_failure() {
        let responses = vec![
            MockHttpResponse::json("401 Unauthorized", serde_json::json!({})),
            MockHttpResponse::json("403 Forbidden", serde_json::json!({})),
            MockHttpResponse::json("404 Not Found", serde_json::json!({})),
            MockHttpResponse::json("412 Precondition Failed", serde_json::json!({})),
            MockHttpResponse {
                status: "429 Too Many Requests",
                headers: vec![("Retry-After", "120")],
                body: "{}".into(),
            },
            MockHttpResponse::json("503 Service Unavailable", serde_json::json!({})),
        ];
        let (api_root, server) = spawn_http_sequence(responses).await;
        let client = Client::new();
        let mut failures = Vec::new();
        for path in [
            "reauth",
            "forbidden",
            "not-found",
            "conflict",
            "rate",
            "server",
        ] {
            let response = client
                .get(format!("{api_root}{path}"))
                .send()
                .await
                .unwrap();
            failures.push(classify_http(&response));
        }
        server.await.unwrap();
        assert_eq!(failures[0], HttpFailure::Auth);
        assert_eq!(failures[1], HttpFailure::Forbidden);
        assert_eq!(failures[2], HttpFailure::NotFound);
        assert_eq!(failures[3], HttpFailure::Conflict(None));
        assert_eq!(failures[4], HttpFailure::Retryable(Some(120)));
        assert_eq!(failures[5], HttpFailure::Retryable(None));
    }

    #[test]
    fn free_busy_reader_cannot_read_event_details() {
        assert!(can_read_event_details("owner"));
        assert!(can_read_event_details("writer"));
        assert!(can_read_event_details("reader"));
        assert!(!can_read_event_details("freeBusyReader"));
    }

    #[tokio::test]
    async fn offline_pull_preserves_the_previous_sync_token() {
        let database = Database::open_memory().await.unwrap();
        let calendar_id = seed_calendar(&database, Some("preserved-token")).await;
        let listener = TcpListener::bind("127.0.0.1:0").await.unwrap();
        let address = listener.local_addr().unwrap();
        drop(listener);
        let result = pull_one_calendar_at(
            &database,
            &Client::new(),
            "synthetic-access-token",
            CalendarPullRequest {
                local_calendar_id: &calendar_id,
                remote_calendar_id: "synthetic-calendar",
                access_role: "owner",
                initial_sync_token: Some("preserved-token"),
                api_root: &format!("http://{address}/calendar/v3/"),
            },
            &OperationCancellation::default(),
        )
        .await;
        assert!(matches!(result, Err(AppError::Unavailable { .. })));
        let token: String =
            sqlx::query_scalar("SELECT sync_token FROM google_calendars WHERE id = ?")
                .bind(calendar_id)
                .fetch_one(&database.pool)
                .await
                .unwrap();
        assert_eq!(token, "preserved-token");
    }

    #[tokio::test]
    async fn cancelled_pull_preserves_events_and_sync_token_without_network_access() {
        let database = Database::open_memory().await.unwrap();
        let calendar_id = seed_calendar(&database, Some("preserved-token")).await;
        let cancellation = OperationCancellation::default();
        cancellation.cancel();

        let result = pull_one_calendar_at(
            &database,
            &Client::new(),
            "synthetic-access-token",
            CalendarPullRequest {
                local_calendar_id: &calendar_id,
                remote_calendar_id: "synthetic-calendar",
                access_role: "owner",
                initial_sync_token: Some("preserved-token"),
                api_root: "http://127.0.0.1:1/calendar/v3/",
            },
            &cancellation,
        )
        .await;

        assert!(matches!(result, Err(AppError::Cancelled { .. })));
        let token: String =
            sqlx::query_scalar("SELECT sync_token FROM google_calendars WHERE id = ?")
                .bind(calendar_id)
                .fetch_one(&database.pool)
                .await
                .unwrap();
        assert_eq!(token, "preserved-token");
        let schedule_count: i64 = sqlx::query_scalar("SELECT COUNT(*) FROM schedule_items")
            .fetch_one(&database.pool)
            .await
            .unwrap();
        assert_eq!(schedule_count, 0);
    }

    #[tokio::test]
    async fn disconnect_cancels_pending_outbox_and_keeps_unsent_schedule_local() {
        let database = Database::open_memory().await.unwrap();
        seed_calendar(&database, None).await;
        let schedule = database.create_schedule(local_draft()).await.unwrap();
        let pending_before: i64 =
            sqlx::query_scalar("SELECT COUNT(*) FROM sync_outbox WHERE completed_at_utc IS NULL")
                .fetch_one(&database.pool)
                .await
                .unwrap();
        assert_eq!(pending_before, 1);

        database
            .disconnect_google(DisconnectMode::KeepLocal)
            .await
            .unwrap();

        let pending_after: i64 =
            sqlx::query_scalar("SELECT COUNT(*) FROM sync_outbox WHERE completed_at_utc IS NULL")
                .fetch_one(&database.pool)
                .await
                .unwrap();
        assert_eq!(pending_after, 0);
        assert_eq!(
            database.schedule(schedule.id).await.unwrap().sync_status,
            SyncStatus::LocalOnly
        );
        let account_count: i64 = sqlx::query_scalar("SELECT COUNT(*) FROM google_accounts")
            .fetch_one(&database.pool)
            .await
            .unwrap();
        assert_eq!(account_count, 0);
    }

    #[tokio::test]
    async fn disconnect_keeps_account_and_local_state_when_keyring_deletion_fails() {
        let database = Database::open_memory().await.unwrap();
        seed_calendar(&database, None).await;
        sqlx::query("UPDATE google_accounts SET credential_key = 'synthetic-key'")
            .execute(&database.pool)
            .await
            .unwrap();
        let schedule = database.create_schedule(local_draft()).await.unwrap();

        let result = database
            .disconnect_google_with(DisconnectMode::KeepLocal, |_| async {
                Err(unavailable(
                    "OS秘密ストアからGoogle認証情報を削除できません。",
                    "接続は保持されています。OSの資格情報ストアを確認して再試行してください。",
                ))
            })
            .await;

        assert!(matches!(result, Err(AppError::Unavailable { .. })));
        let account_count: i64 = sqlx::query_scalar("SELECT COUNT(*) FROM google_accounts")
            .fetch_one(&database.pool)
            .await
            .unwrap();
        let pending_count: i64 =
            sqlx::query_scalar("SELECT COUNT(*) FROM sync_outbox WHERE completed_at_utc IS NULL")
                .fetch_one(&database.pool)
                .await
                .unwrap();
        assert_eq!(account_count, 1);
        assert_eq!(pending_count, 1);
        assert_eq!(
            database.schedule(schedule.id).await.unwrap().sync_status,
            SyncStatus::Pending
        );
    }

    #[test]
    fn oauth_token_errors_are_reduced_to_non_sensitive_failure_categories() {
        assert_eq!(
            token_failure_category("invalid_client").as_str(),
            "oauth_token_invalid_client"
        );
        assert_eq!(
            token_failure_category("invalid_grant").as_str(),
            "oauth_token_invalid_grant"
        );
        assert_eq!(
            token_failure_category("redirect_uri_mismatch").as_str(),
            "oauth_token_redirect_uri"
        );
        assert_eq!(
            token_failure_category("unexpected_server_detail").as_str(),
            "oauth_token_rejected"
        );
    }
}
