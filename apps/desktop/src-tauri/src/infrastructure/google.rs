use std::{
    fs,
    path::Path,
    sync::atomic::{AtomicBool, Ordering},
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

use crate::domain::{
    AppError, AppResult, Priority, Schedule, ScheduleDraft, ScheduleStatus, SyncStatus, SyncSummary,
};

use super::{
    Database,
    database::{insert_schedule, row_to_schedule, update_schedule_row},
};

const KEYRING_SERVICE: &str = "com.stillshorechirp.dayschedulenext.google";
const OAUTH_CLIENT_USER: &str = "oauth-client";
const CALENDAR_SCOPE: &str = "https://www.googleapis.com/auth/calendar.events";
const CALENDAR_LIST_SCOPE: &str = "https://www.googleapis.com/auth/calendar.calendarlist.readonly";
const GOOGLE_CALENDAR_API_ROOT: &str = "https://www.googleapis.com/calendar/v3/";
const MAX_OAUTH_FILE_BYTES: u64 = 1024 * 1024;
const LOOPBACK_TIMEOUT_SECONDS: u64 = 180;
static OAUTH_IN_PROGRESS: AtomicBool = AtomicBool::new(false);

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

#[derive(Debug, Deserialize)]
struct TokenResponse {
    access_token: String,
    #[serde(default)]
    refresh_token: Option<String>,
    expires_in: i64,
    #[serde(default)]
    scope: String,
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
            scopes: [CALENDAR_SCOPE, CALENDAR_LIST_SCOPE],
        })
    }

    pub async fn begin_google_oauth(&self) -> AppResult<OAuthBeginResult> {
        if OAUTH_IN_PROGRESS.swap(true, Ordering::SeqCst) {
            return Err(AppError::Conflict {
                message: "Google接続はすでに進行中です。".into(),
                recovery: "ブラウザの接続を完了するか、3分待ってから再試行してください。".into(),
            });
        }
        let result = self.prepare_oauth_flow().await;
        if result.is_err() {
            OAUTH_IN_PROGRESS.store(false, Ordering::SeqCst);
        }
        result
    }

    async fn prepare_oauth_flow(&self) -> AppResult<OAuthBeginResult> {
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
            .append_pair("scope", &format!("{CALENDAR_SCOPE} {CALENDAR_LIST_SCOPE}"))
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
            )
            .await;
            let category = if outcome.is_ok() {
                "none"
            } else {
                "oauth_failed"
            };
            let _ = sqlx::query(
                "INSERT INTO app_meta(key, value, updated_at_utc) VALUES ('google_last_error', ?, ?) ON CONFLICT(key) DO UPDATE SET value = excluded.value, updated_at_utc = excluded.updated_at_utc",
            )
            .bind(category)
            .bind(Utc::now().to_rfc3339())
            .execute(&database.pool)
            .await;
            OAUTH_IN_PROGRESS.store(false, Ordering::SeqCst);
        });
        Ok(OAuthBeginResult {
            authorization_url: authorization_url.into(),
            expires_at: Utc::now() + Duration::seconds(LOOPBACK_TIMEOUT_SECONDS as i64),
        })
    }

    pub async fn google_connection(&self) -> AppResult<GoogleConnection> {
        let configured: bool = sqlx::query_scalar(
            "SELECT EXISTS(SELECT 1 FROM google_oauth_config WHERE singleton = 1)",
        )
        .fetch_one(&self.pool)
        .await
        .map_err(|error| AppError::database("google-status-config", error))?;
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
        })
    }

    pub async fn google_calendars(&self) -> AppResult<Vec<GoogleCalendar>> {
        let rows = sqlx::query(
            "SELECT id, display_name, color, time_zone, access_role, selected, default_write_target FROM google_calendars ORDER BY default_write_target DESC, display_name, id",
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
                    access_role: role,
                    selected: row.get("selected"),
                    default_write_target: row.get("default_write_target"),
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
        sqlx::query("DELETE FROM google_accounts WHERE id = ?")
            .bind(&account_id)
            .execute(&mut *transaction)
            .await
            .map_err(|error| AppError::database("google-disconnect-delete-account", error))?;
        transaction
            .commit()
            .await
            .map_err(|error| AppError::database("google-disconnect-commit", error))?;
        if let Some(key) = credential_key {
            delete_keyring(key).await?;
        }
        Ok(mapped_count.max(0) as u64)
    }

    pub async fn run_google_sync(&self) -> AppResult<SyncSummary> {
        let client = Client::builder()
            .timeout(StdDuration::from_secs(30))
            .build()
            .map_err(|error| AppError::database("sync-http-client", error))?;
        let (account_id, access_token) = self.valid_access_token(&client).await?;
        fetch_and_persist_calendars(self, &client, account_id, &access_token).await?;
        push_due_outbox(self, &client, &access_token).await?;
        pull_selected_calendars(self, &client, &access_token).await?;
        let now = Utc::now().to_rfc3339();
        sqlx::query(
            "UPDATE google_accounts SET status = 'connected', last_completed_at_utc = ?, next_retry_at_utc = NULL, updated_at_utc = ? WHERE id = ?",
        )
        .bind(&now)
        .bind(&now)
        .bind(account_id.to_string())
        .execute(&self.pool)
        .await
        .map_err(|error| AppError::database("sync-account-complete", error))?;
        self.sync_summary().await
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
        .map_err(|error| AppError::database("google-config-load", error))?
        .ok_or_else(|| {
            validation(
                "Google OAuth設定がありません。",
                "Google CloudからDesktop appのOAuth JSONを先に読み込んでください。",
            )
        })?;
        Ok(OAuthConfig {
            client_id: row.get("client_id"),
            client_secret: load_keyring(OAUTH_CLIENT_USER.to_owned()).await?,
            auth_uri: row.get("auth_uri"),
            token_uri: row.get("token_uri"),
        })
    }
}

async fn complete_oauth(
    database: Database,
    listener: TcpListener,
    config: OAuthConfig,
    verifier: String,
    expected_state: String,
    redirect_uri: String,
) -> AppResult<()> {
    let (mut socket, _) = timeout(
        StdDuration::from_secs(LOOPBACK_TIMEOUT_SECONDS),
        listener.accept(),
    )
    .await
    .map_err(|_| {
        unavailable(
            "Google接続が時間切れになりました。",
            "接続をもう一度開始してください。",
        )
    })?
    .map_err(|error| AppError::database("oauth-loopback-accept", error))?;
    let mut buffer = vec![0_u8; 16_384];
    let count = timeout(StdDuration::from_secs(10), socket.read(&mut buffer))
        .await
        .map_err(|_| {
            unavailable(
                "Googleからの応答が時間切れになりました。",
                "接続をもう一度開始してください。",
            )
        })?
        .map_err(|error| AppError::database("oauth-loopback-read", error))?;
    let request = std::str::from_utf8(&buffer[..count]).map_err(|_| {
        validation(
            "Googleからの応答を解析できません。",
            "接続をもう一度開始してください。",
        )
    })?;
    let target = request
        .lines()
        .next()
        .and_then(|line| line.split_whitespace().nth(1))
        .ok_or_else(|| {
            validation(
                "Googleからの応答が正しくありません。",
                "接続をもう一度開始してください。",
            )
        })?;
    let callback = Url::parse(&format!("http://127.0.0.1{target}")).map_err(|_| {
        validation(
            "Googleからの応答URLが正しくありません。",
            "接続をもう一度開始してください。",
        )
    })?;
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
    let success = !code.is_empty() && constant_time_eq(state.as_bytes(), expected_state.as_bytes());
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
        .map_err(|error| AppError::database("oauth-loopback-write", error))?;
    if !success {
        return Err(validation(
            "Google接続のstateまたは認可コードを確認できません。",
            "接続を最初からやり直してください。",
        ));
    }
    let client = Client::builder()
        .timeout(StdDuration::from_secs(30))
        .build()
        .map_err(|error| AppError::database("oauth-http-client", error))?;
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
        .map_err(|_| {
            unavailable(
                "Googleへの接続に失敗しました。",
                "ネットワークを確認して再試行してください。",
            )
        })?;
    if !response.status().is_success() {
        return Err(unavailable(
            "Googleの認可コードをトークンへ交換できませんでした。",
            "接続を最初からやり直してください。",
        ));
    }
    let token: TokenResponse = response.json().await.map_err(|_| {
        unavailable(
            "Googleのトークン応答を解析できません。",
            "接続をやり直してください。",
        )
    })?;
    validate_token_response(&token)?;
    let refresh_token = token.refresh_token.ok_or_else(|| {
        unavailable(
            "オフライン利用用のrefresh tokenを受け取れませんでした。",
            "Googleアカウントの接続許可を取り消してから、もう一度接続してください。",
        )
    })?;
    let account_id = Uuid::new_v4();
    let credential_key = format!("google-account-{account_id}");
    let secret = TokenSecret {
        access_token: token.access_token,
        refresh_token,
        expires_at: Utc::now() + Duration::seconds(token.expires_in.max(60)),
    };
    store_keyring(
        credential_key.clone(),
        serde_json::to_string(&secret)
            .map_err(|error| AppError::database("oauth-secret-encode", error))?,
    )
    .await?;
    let now = Utc::now().to_rfc3339();
    sqlx::query("DELETE FROM google_accounts WHERE status != 'disconnected'")
        .execute(&database.pool)
        .await
        .map_err(|error| AppError::database("oauth-account-clear", error))?;
    sqlx::query(
        "INSERT INTO google_accounts(id, display_label, scopes_json, status, created_at_utc, updated_at_utc, credential_key) VALUES (?, 'Google Calendar', ?, 'connected', ?, ?, ?)",
    )
    .bind(account_id.to_string())
    .bind(serde_json::json!([CALENDAR_SCOPE, CALENDAR_LIST_SCOPE]).to_string())
    .bind(&now)
    .bind(&now)
    .bind(&credential_key)
    .execute(&database.pool)
    .await
    .map_err(|error| AppError::database("oauth-account-save", error))?;
    fetch_and_persist_calendars(&database, &client, account_id, &secret.access_token).await
}

async fn fetch_and_persist_calendars(
    database: &Database,
    client: &Client,
    account_id: Uuid,
    access_token: &str,
) -> AppResult<()> {
    let mut page_token: Option<String> = None;
    let mut calendars = Vec::new();
    loop {
        let mut url = Url::parse("https://www.googleapis.com/calendar/v3/users/me/calendarList")
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
        let make_default = may_assign_primary_default && remote.primary && writable;
        if make_default {
            may_assign_primary_default = false;
        }
        sqlx::query(
            "INSERT INTO google_calendars(id, account_id, remote_calendar_id, display_name, color, time_zone, access_role, selected, default_write_target) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?) ON CONFLICT(account_id, remote_calendar_id) DO UPDATE SET display_name = excluded.display_name, color = excluded.color, time_zone = excluded.time_zone, access_role = excluded.access_role",
        )
        .bind(local_id)
        .bind(account_id.to_string())
        .bind(remote.id)
        .bind(remote.summary)
        .bind(remote.background_color)
        .bind(remote.time_zone)
        .bind(remote.access_role)
        .bind(remote.selected || remote.primary)
        .bind(make_default)
        .execute(&mut *transaction)
        .await
        .map_err(|error| AppError::database("calendar-list-upsert", error))?;
    }
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
) -> AppResult<()> {
    let rows = sqlx::query(
        "SELECT id, entity_id, entity_version, operation, attempt_count FROM sync_outbox WHERE completed_at_utc IS NULL AND next_attempt_at_utc <= ? ORDER BY created_at_utc, id LIMIT 100",
    )
    .bind(Utc::now().to_rfc3339())
    .fetch_all(&database.pool)
    .await
    .map_err(|error| AppError::database("sync-outbox-list", error))?;
    for row in rows {
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
            Err(HttpFailure::Gone | HttpFailure::Permanent) => {
                mark_outbox_failure(database, &outbox_id, attempts, "permanent", None).await?;
            }
        }
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
) -> AppResult<()> {
    let calendars = sqlx::query(
        "SELECT id, remote_calendar_id, access_role, sync_token FROM google_calendars WHERE selected = 1 ORDER BY id",
    )
    .fetch_all(&database.pool)
    .await
    .map_err(|error| AppError::database("sync-calendar-list", error))?;
    for calendar in calendars {
        let local_id: String = calendar.get("id");
        let remote_id: String = calendar.get("remote_calendar_id");
        let role: String = calendar.get("access_role");
        let sync_token: Option<String> = calendar.get("sync_token");
        pull_one_calendar(
            database,
            client,
            access_token,
            &local_id,
            &remote_id,
            &role,
            sync_token.as_deref(),
        )
        .await?;
    }
    Ok(())
}

async fn pull_one_calendar(
    database: &Database,
    client: &Client,
    access_token: &str,
    local_calendar_id: &str,
    remote_calendar_id: &str,
    access_role: &str,
    initial_sync_token: Option<&str>,
) -> AppResult<()> {
    pull_one_calendar_at(
        database,
        client,
        access_token,
        CalendarPullRequest {
            local_calendar_id,
            remote_calendar_id,
            access_role,
            initial_sync_token,
            api_root: GOOGLE_CALENDAR_API_ROOT,
        },
    )
    .await
}

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
) -> AppResult<()> {
    let mut sync_token = request.initial_sync_token.map(str::to_owned);
    let mut retried_full = false;
    loop {
        let mut page_token: Option<String> = None;
        let mut final_sync_token: Option<String> = None;
        let mut staged_events = Vec::new();
        loop {
            let mut url = event_url_at(request.api_root, request.remote_calendar_id, None)?;
            {
                let mut query = url.query_pairs_mut();
                query
                    .append_pair("showDeleted", "true")
                    .append_pair("singleEvents", "false")
                    .append_pair("maxResults", "2500");
                if let Some(token) = &sync_token {
                    query.append_pair("syncToken", token);
                }
                if let Some(token) = &page_token {
                    query.append_pair("pageToken", token);
                }
            }
            let response = client
                .get(url)
                .bearer_auth(access_token)
                .send()
                .await
                .map_err(|_| {
                    unavailable(
                        "Google差分同期へ接続できません。",
                        "ローカル編集は保存されています。ネットワーク復帰後に再試行してください。",
                    )
                })?;
            if response.status() == StatusCode::GONE && sync_token.is_some() && !retried_full {
                sync_token = None;
                retried_full = true;
                break;
            }
            if !response.status().is_success() {
                return Err(sync_http_error(&response));
            }
            let page_value = response_json_limited(response)
                .await
                .map_err(|failure| sync_failure_error(failure, "Googleイベント一覧"))?;
            let page: EventListPage = serde_json::from_value(page_value).map_err(|_| {
                validation(
                    "Googleイベント一覧を解析できません。",
                    "同期トークンは更新していません。時間を置いて再試行してください。",
                )
            })?;
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
        let mut transaction = database
            .pool
            .begin()
            .await
            .map_err(|error| AppError::database("sync-pull-begin", error))?;
        for event in staged_events {
            apply_remote_event(
                &mut transaction,
                request.local_calendar_id,
                request.access_role,
                event,
            )
            .await?;
        }
        let final_token = final_sync_token.ok_or_else(|| {
            validation(
                "GoogleからnextSyncTokenを受け取れませんでした。",
                "同期トークンは更新していません。再試行してください。",
            )
        })?;
        sqlx::query("UPDATE google_calendars SET sync_token = ? WHERE id = ?")
            .bind(final_token)
            .bind(request.local_calendar_id)
            .execute(&mut *transaction)
            .await
            .map_err(|error| AppError::database("sync-token-save", error))?;
        transaction
            .commit()
            .await
            .map_err(|error| AppError::database("sync-pull-commit", error))?;
        return Ok(());
    }
}

async fn apply_remote_event(
    transaction: &mut sqlx::Transaction<'_, sqlx::Sqlite>,
    calendar_id: &str,
    access_role: &str,
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
                let mut remote = remote_event_to_draft(&event)?;
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
        let mut draft = remote_event_to_draft(&event)?;
        draft.validate()?;
        let read_only = !matches!(access_role, "owner" | "writer") || event_is_read_only(&event);
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
    let mut draft = remote_event_to_draft(&event)?;
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
    let read_only = !matches!(access_role, "owner" | "writer") || event_is_read_only(&event);
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
                .unwrap_or("UTC")
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
                .unwrap_or("UTC")
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
    let recurrence_rule = event
        .get("recurrence")
        .and_then(Value::as_array)
        .and_then(|values| {
            values
                .iter()
                .filter_map(Value::as_str)
                .find(|value| value.starts_with("RRULE:"))
        })
        .map(|value| value.trim_start_matches("RRULE:").to_owned());
    let recurrence_exdates = event
        .get("recurrence")
        .and_then(Value::as_array)
        .into_iter()
        .flatten()
        .filter_map(Value::as_str)
        .filter_map(|value| value.strip_prefix("EXDATE:"))
        .flat_map(|value| value.split(','))
        .map(|value| {
            DateTime::parse_from_str(value, "%Y%m%dT%H%M%SZ")
                .map(|value| value.with_timezone(&Utc))
                .map_err(|_| {
                    validation(
                        "Google繰り返し例外の時刻が正しくありません。",
                        "同期トークンは更新していません。Google側の系列を確認してください。",
                    )
                })
        })
        .collect::<AppResult<Vec<_>>>()?;
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
        recurrence_exdates,
        start_notification_minutes: None,
        end_notification_minutes: None,
    })
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
    if let Some(rule) = &schedule.draft.recurrence_rule {
        let mut recurrence = vec![format!("RRULE:{rule}")];
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
        StatusCode::UNAUTHORIZED | StatusCode::FORBIDDEN => HttpFailure::Auth,
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
        "UPDATE schedule_items SET sync_status = 'auth_required' WHERE id IN (SELECT schedule_item_id FROM sync_mappings)",
    )
    .execute(&database.pool)
    .await
    .map_err(|error| AppError::database("sync-auth-schedules", error))?;
    Ok(())
}

fn sync_http_error(response: &reqwest::Response) -> AppError {
    sync_failure_error(classify_http(response), "Google同期")
}

fn sync_failure_error(failure: HttpFailure, operation: &str) -> AppError {
    match failure {
        HttpFailure::Auth => unavailable(
            "Googleへの再認証が必要です。",
            "ローカル予定は保持されています。設定から再接続してください。",
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
    if token.access_token.is_empty()
        || token.access_token.len() > 16_384
        || token.expires_in <= 0
        || (!token.scope.is_empty()
            && (!token
                .scope
                .split_whitespace()
                .any(|scope| scope == CALENDAR_SCOPE)
                || !token
                    .scope
                    .split_whitespace()
                    .any(|scope| scope == CALENDAR_LIST_SCOPE)))
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
                    "OAuth JSONを読み込み直してください。",
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
        )
        .await
        .unwrap();
        let requests = server.await.unwrap();
        assert_eq!(requests.len(), 2);
        assert!(!requests[0].contains("pageToken"));
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

    #[tokio::test]
    async fn expired_sync_token_retries_full_without_committing_the_stale_token() {
        let database = Database::open_memory().await.unwrap();
        let calendar_id = seed_calendar(&database, Some("stale-token")).await;
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
    }

    #[tokio::test]
    async fn http_matrix_classifies_reauth_conflict_rate_limit_and_server_failure() {
        let responses = vec![
            MockHttpResponse::json("401 Unauthorized", serde_json::json!({})),
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
        for path in ["reauth", "conflict", "rate", "server"] {
            let response = client
                .get(format!("{api_root}{path}"))
                .send()
                .await
                .unwrap();
            failures.push(classify_http(&response));
        }
        server.await.unwrap();
        assert_eq!(failures[0], HttpFailure::Auth);
        assert_eq!(failures[1], HttpFailure::Conflict(None));
        assert_eq!(failures[2], HttpFailure::Retryable(Some(120)));
        assert_eq!(failures[3], HttpFailure::Retryable(None));
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
}
