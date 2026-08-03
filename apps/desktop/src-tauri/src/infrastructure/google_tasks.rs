use std::time::Duration as StdDuration;

use chrono::{DateTime, Duration, NaiveDate, SecondsFormat, Utc};
use reqwest::{Client, StatusCode, Url};
use serde::{Deserialize, Serialize};
use sqlx::{Row, Sqlite, Transaction, sqlite::SqliteRow};
use uuid::Uuid;

use crate::application::OperationCancellation;
use crate::domain::google_tasks::{GoogleTaskSnapshot, merge_google_task};
use crate::domain::{
    AppError, AppResult, GoogleTaskConflict, GoogleTaskConflictResolution, GoogleTaskList,
    GoogleTaskSyncState, GoogleTasksConnection, TicketGoogleTaskStatus,
};

use super::Database;

pub(crate) const TASKS_SCOPE: &str = "https://www.googleapis.com/auth/tasks";
const GOOGLE_TASKS_API_ROOT: &str = "https://tasks.googleapis.com/tasks/v1/";
const TASK_PAGE_SIZE: u32 = 100;
const WATERMARK_OVERLAP_SECONDS: i64 = 120;
const MAX_REMOTE_ID_BYTES: usize = 2_048;
const MAX_LIST_TITLE_CHARS: usize = 1_024;
const RETRY_BASE_SECONDS: i64 = 60;
const RETRY_MAX_SECONDS: i64 = 6 * 60 * 60;

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

#[derive(Debug, Clone, Deserialize)]
struct RemoteTaskListPage {
    #[serde(default)]
    items: Vec<RemoteTaskList>,
    #[serde(default, rename = "nextPageToken")]
    next_page_token: Option<String>,
}

#[derive(Debug, Clone, Deserialize)]
struct RemoteTaskList {
    id: String,
    #[serde(default)]
    etag: String,
    title: String,
}

#[derive(Debug, Clone, Deserialize, Serialize)]
struct RemoteTask {
    id: String,
    #[serde(default)]
    etag: String,
    #[serde(default)]
    title: String,
    #[serde(default)]
    notes: String,
    #[serde(default)]
    status: String,
    #[serde(default)]
    due: Option<String>,
    #[serde(default)]
    completed: Option<String>,
    #[serde(default)]
    deleted: bool,
    #[serde(default)]
    hidden: bool,
    #[serde(default)]
    parent: Option<String>,
    #[serde(default)]
    position: String,
    #[serde(default)]
    updated: String,
    #[serde(default, rename = "assignmentInfo")]
    assignment_info: Option<serde_json::Value>,
}

#[derive(Debug, Clone, Deserialize)]
struct RemoteTaskPage {
    #[serde(default)]
    items: Vec<RemoteTask>,
    #[serde(default, rename = "nextPageToken")]
    next_page_token: Option<String>,
}

#[derive(Debug, Clone)]
struct StoredTaskList {
    id: Uuid,
    remote_id: String,
    watermark: Option<DateTime<Utc>>,
    last_full_sync: Option<DateTime<Utc>>,
}

#[derive(Debug, Clone)]
struct OutboxItem {
    id: Uuid,
    ticket_id: Uuid,
    operation: String,
    target_list_id: Option<Uuid>,
    attempt_count: u32,
}

pub(crate) async fn sync_google_tasks(
    database: &Database,
    client: &Client,
    account_id: Uuid,
    access_token: &str,
    cancellation: &OperationCancellation,
) -> AppResult<()> {
    let connection = database.google_tasks_connection().await?;
    if !connection.enabled {
        return Ok(());
    }
    if !connection.scope_granted {
        return Err(AppError::Unavailable {
            message: "Google Tasks権限が不足しています。".into(),
            recovery: "設定からCalendar + Tasksの権限をまとめて再同意してください。".into(),
            retryable: false,
        });
    }
    cancellation.check()?;
    fetch_and_persist_task_lists_at(
        database,
        client,
        account_id,
        access_token,
        GOOGLE_TASKS_API_ROOT,
        cancellation,
    )
    .await?;
    cancellation.check()?;
    push_due_task_outbox_at(
        database,
        client,
        access_token,
        GOOGLE_TASKS_API_ROOT,
        cancellation,
    )
    .await?;
    cancellation.check()?;
    pull_selected_task_lists_at(
        database,
        client,
        access_token,
        GOOGLE_TASKS_API_ROOT,
        false,
        cancellation,
    )
    .await
}

pub(crate) async fn reconcile_google_tasks_full(
    database: &Database,
    client: &Client,
    account_id: Uuid,
    access_token: &str,
    cancellation: &OperationCancellation,
) -> AppResult<()> {
    let connection = database.google_tasks_connection().await?;
    if !connection.enabled || !connection.scope_granted {
        return Err(validation(
            "Google Tasks同期を利用できません。",
            "設定でCalendar + Tasks権限を同意し、Google Tasks同期を有効にしてください。",
        ));
    }
    fetch_and_persist_task_lists_at(
        database,
        client,
        account_id,
        access_token,
        GOOGLE_TASKS_API_ROOT,
        cancellation,
    )
    .await?;
    push_due_task_outbox_at(
        database,
        client,
        access_token,
        GOOGLE_TASKS_API_ROOT,
        cancellation,
    )
    .await?;
    pull_selected_task_lists_at(
        database,
        client,
        access_token,
        GOOGLE_TASKS_API_ROOT,
        true,
        cancellation,
    )
    .await
}

pub(crate) async fn fetch_and_persist_task_lists_for_oauth(
    database: &Database,
    client: &Client,
    account_id: Uuid,
    access_token: &str,
) -> AppResult<()> {
    fetch_and_persist_task_lists_at(
        database,
        client,
        account_id,
        access_token,
        GOOGLE_TASKS_API_ROOT,
        &OperationCancellation::default(),
    )
    .await
}

async fn fetch_and_persist_task_lists_at(
    database: &Database,
    client: &Client,
    account_id: Uuid,
    access_token: &str,
    api_root: &str,
    cancellation: &OperationCancellation,
) -> AppResult<()> {
    validate_tasks_api_root(api_root)?;
    let mut page_token: Option<String> = None;
    let mut all_lists = Vec::new();
    loop {
        cancellation.check()?;
        let mut url = Url::parse(api_root)
            .and_then(|base| base.join("users/@me/lists"))
            .map_err(|error| AppError::database("google-task-list-url", error))?;
        {
            let mut query = url.query_pairs_mut();
            query.append_pair("maxResults", "100");
            if let Some(token) = &page_token {
                query.append_pair("pageToken", token);
            }
        }
        let response = client
            .get(url)
            .bearer_auth(access_token)
            .send()
            .await
            .map_err(|_| unavailable("Google Task Listを取得できません。", true))?;
        if !response.status().is_success() {
            return Err(http_error(response.status(), None));
        }
        let page: RemoteTaskListPage = response.json().await.map_err(|_| {
            validation(
                "Google Task Listの応答を解析できません。",
                "同期を停止しました。時間を置いて再試行してください。",
            )
        })?;
        for list in &page.items {
            validate_remote_task_list(list)?;
        }
        all_lists.extend(page.items);
        page_token = page.next_page_token;
        if page_token.is_none() {
            break;
        }
        if all_lists.len() > 2_000 {
            return Err(validation(
                "Google Task Listが安全な上限を超えています。",
                "同期対象を確認してください。",
            ));
        }
    }
    let now = timestamp(Utc::now());
    let mut transaction = database
        .pool
        .begin()
        .await
        .map_err(|error| AppError::database("google-task-lists-begin", error))?;
    let existing =
        sqlx::query("SELECT id, remote_list_id FROM google_task_lists WHERE google_account_id = ?")
            .bind(account_id.to_string())
            .fetch_all(&mut *transaction)
            .await
            .map_err(|error| AppError::database("google-task-lists-existing", error))?;
    let remote_ids: std::collections::HashSet<String> =
        all_lists.iter().map(|list| list.id.clone()).collect();
    for list in all_lists {
        sqlx::query(
            "INSERT INTO google_task_lists(id, google_account_id, remote_list_id, display_name, remote_etag, selected, default_write_target, sync_state, created_at_utc, updated_at_utc)
             VALUES (?, ?, ?, ?, ?, 0, 0, 'never', ?, ?)
             ON CONFLICT(google_account_id, remote_list_id) DO UPDATE SET display_name = excluded.display_name, remote_etag = excluded.remote_etag, updated_at_utc = excluded.updated_at_utc",
        )
        .bind(Uuid::new_v4().to_string())
        .bind(account_id.to_string())
        .bind(list.id)
        .bind(list.title)
        .bind(null_if_empty(list.etag))
        .bind(&now)
        .bind(&now)
        .execute(&mut *transaction)
        .await
        .map_err(|error| AppError::database("google-task-list-upsert", error))?;
    }
    for row in existing {
        let remote_id: String = row.get("remote_list_id");
        if !remote_ids.contains(remote_id.as_str()) {
            sqlx::query(
                "UPDATE google_task_lists SET selected = 0, default_write_target = 0, sync_state = 'unavailable', last_error_category = 'not_found', updated_at_utc = ? WHERE id = ?",
            )
            .bind(&now)
            .bind(row.get::<String, _>("id"))
            .execute(&mut *transaction)
            .await
            .map_err(|error| AppError::database("google-task-list-missing", error))?;
        }
    }
    transaction
        .commit()
        .await
        .map_err(|error| AppError::database("google-task-lists-commit", error))
}

async fn push_due_task_outbox_at(
    database: &Database,
    client: &Client,
    access_token: &str,
    api_root: &str,
    cancellation: &OperationCancellation,
) -> AppResult<()> {
    validate_tasks_api_root(api_root)?;
    let rows = sqlx::query(
        "SELECT id, ticket_id, operation_type, entity_version, target_list_id, attempt_count FROM google_task_outbox WHERE completed_at_utc IS NULL AND uncertain_create = 0 AND next_attempt_at_utc <= ? ORDER BY created_at_utc, id LIMIT 100",
    )
    .bind(timestamp(Utc::now()))
    .fetch_all(&database.pool)
    .await
    .map_err(|error| AppError::database("google-task-outbox-due", error))?;
    let mut first_error = None;
    for row in rows {
        cancellation.check()?;
        let item = OutboxItem {
            id: parse_uuid(row.get("id"), "google-task-outbox-id")?,
            ticket_id: parse_uuid(row.get("ticket_id"), "google-task-outbox-ticket")?,
            operation: row.get("operation_type"),
            target_list_id: row
                .get::<Option<&str>, _>("target_list_id")
                .map(|value| parse_uuid(value, "google-task-outbox-target"))
                .transpose()?,
            attempt_count: row.get::<i64, _>("attempt_count").max(0) as u32,
        };
        if let Err(error) =
            push_one_task_outbox(database, client, access_token, api_root, &item).await
        {
            if matches!(error, AppError::Cancelled { .. }) {
                return Err(error);
            }
            if first_error.is_none() {
                first_error = Some(error);
            }
        }
    }
    match first_error {
        Some(error) => Err(error),
        None => Ok(()),
    }
}

async fn push_one_task_outbox(
    database: &Database,
    client: &Client,
    access_token: &str,
    api_root: &str,
    item: &OutboxItem,
) -> AppResult<()> {
    let mapping = mapping_row(database, item.ticket_id).await?;
    if item.operation == "delete" {
        let Some(mapping) = mapping else {
            return complete_outbox(database, item.id).await;
        };
        let url = task_url(api_root, &mapping.remote_list_id, &mapping.remote_task_id)?;
        let response = client
            .delete(url)
            .bearer_auth(access_token)
            .send()
            .await
            .map_err(|_| unavailable("Google Taskを削除できません。", true))?;
        if !response.status().is_success() && response.status() != StatusCode::NOT_FOUND {
            let retry_after = retry_after(&response);
            return handle_outbox_http_error(database, item, response.status(), retry_after).await;
        }
        let mut transaction = database
            .pool
            .begin()
            .await
            .map_err(|error| AppError::database("google-task-delete-begin", error))?;
        sqlx::query("DELETE FROM google_task_mappings WHERE ticket_id = ?")
            .bind(item.ticket_id.to_string())
            .execute(&mut *transaction)
            .await
            .map_err(|error| AppError::database("google-task-delete-mapping", error))?;
        complete_outbox_tx(&mut transaction, item.id).await?;
        return transaction
            .commit()
            .await
            .map_err(|error| AppError::database("google-task-delete-commit", error));
    }
    let ticket = database.ticket(item.ticket_id).await?;
    let target_list_id = item.target_list_id.ok_or_else(|| {
        validation(
            "Google Tasks同期先が選択されていません。",
            "Ticket詳細でTask Listを選んでください。",
        )
    })?;
    let list = stored_task_list(database, target_list_id).await?;
    let snapshot = ticket_snapshot(database, &ticket, target_list_id).await?;
    if let Err(error) = snapshot.validate_for_push() {
        mark_outbox_permanent(database, item.id, "validation_required").await?;
        return Err(error);
    }
    match item.operation.as_str() {
        "create" if mapping.is_none() => {
            let url = Url::parse(api_root)
                .and_then(|base| {
                    base.join(&format!("lists/{}/tasks", encode_segment(&list.remote_id)))
                })
                .map_err(|error| AppError::database("google-task-create-url", error))?;
            let request = client
                .post(url)
                .bearer_auth(access_token)
                .json(&snapshot_to_remote_patch(&snapshot, Utc::now()));
            let response = match request.send().await {
                Ok(response) => response,
                Err(_) => {
                    mark_uncertain_create(database, item, &snapshot).await?;
                    return Err(unavailable("Google Task作成結果を確認できません。", false));
                }
            };
            if response.status().is_server_error() {
                mark_uncertain_create(database, item, &snapshot).await?;
                return Err(unavailable("Google Task作成結果を確認できません。", false));
            }
            if !response.status().is_success() {
                let retry_after = retry_after(&response);
                return handle_outbox_http_error(database, item, response.status(), retry_after)
                    .await;
            }
            let remote: RemoteTask = match response.json().await {
                Ok(remote) => remote,
                Err(_) => {
                    mark_uncertain_create(database, item, &snapshot).await?;
                    return Err(validation(
                        "作成したGoogle Taskの応答を解析できません。",
                        "重複防止のため自動再作成を停止しました。完全照合を実行してください。",
                    ));
                }
            };
            if let Err(error) = validate_remote_task(&remote) {
                mark_uncertain_create(database, item, &snapshot).await?;
                return Err(error);
            }
            persist_created_mapping(database, item, &list, &remote, &snapshot).await
        }
        "create" => complete_outbox(database, item.id).await,
        "move" => push_task_move(database, client, access_token, api_root, item, &snapshot).await,
        _ => push_task_patch(database, client, access_token, api_root, item, &snapshot).await,
    }
}

#[derive(Debug, Clone)]
struct MappingRow {
    list_id: Uuid,
    remote_list_id: String,
    remote_task_id: String,
    base: GoogleTaskSnapshot,
}

async fn mapping_row(database: &Database, ticket_id: Uuid) -> AppResult<Option<MappingRow>> {
    let row = sqlx::query(
        "SELECT m.google_task_list_id, l.remote_list_id, m.remote_task_id, m.remote_etag, m.base_snapshot_json FROM google_task_mappings m JOIN google_task_lists l ON l.id = m.google_task_list_id WHERE m.ticket_id = ?",
    )
    .bind(ticket_id.to_string())
    .fetch_optional(&database.pool)
    .await
    .map_err(|error| AppError::database("google-task-mapping", error))?;
    row.map(|row| {
        Ok(MappingRow {
            list_id: parse_uuid(row.get("google_task_list_id"), "google-task-mapping-list")?,
            remote_list_id: row.get("remote_list_id"),
            remote_task_id: row.get("remote_task_id"),
            base: serde_json::from_str(row.get("base_snapshot_json"))
                .map_err(|error| AppError::database("google-task-mapping-base", error))?,
        })
    })
    .transpose()
}

async fn stored_task_list(database: &Database, id: Uuid) -> AppResult<StoredTaskList> {
    let row = sqlx::query(
        "SELECT id, remote_list_id, incremental_watermark_utc, last_full_sync_at_utc FROM google_task_lists WHERE id = ? AND selected = 1",
    )
    .bind(id.to_string())
    .fetch_optional(&database.pool)
    .await
    .map_err(|error| AppError::database("google-task-list-stored", error))?
    .ok_or_else(|| not_found("同期対象のGoogle Task Listが見つかりません。"))?;
    Ok(StoredTaskList {
        id,
        remote_id: row.get("remote_list_id"),
        watermark: parse_optional_datetime(
            row.get("incremental_watermark_utc"),
            "google-task-watermark",
        )?,
        last_full_sync: parse_optional_datetime(
            row.get("last_full_sync_at_utc"),
            "google-task-last-full",
        )?,
    })
}

async fn ticket_snapshot(
    database: &Database,
    ticket: &crate::domain::Ticket,
    list_id: Uuid,
) -> AppResult<GoogleTaskSnapshot> {
    let board = database.ticket_board(ticket.board_id).await?;
    let completed = board
        .columns
        .iter()
        .find(|column| column.id == ticket.column_id)
        .is_some_and(|column| column.kind.is_done());
    Ok(GoogleTaskSnapshot {
        title: ticket.title.clone(),
        notes: ticket.description.clone(),
        due_date: ticket.due_date,
        completed,
        parent_ticket_id: ticket.parent_ticket_id,
        task_list_id: list_id,
    })
}

fn snapshot_to_remote_patch(
    snapshot: &GoogleTaskSnapshot,
    now: DateTime<Utc>,
) -> serde_json::Value {
    serde_json::json!({
        "title": snapshot.title,
        "notes": snapshot.notes,
        "due": snapshot.due_date.map(|date| format!("{date}T00:00:00.000Z")),
        "status": if snapshot.completed { "completed" } else { "needsAction" },
        "completed": snapshot.completed.then(|| timestamp(now)),
    })
}

async fn persist_created_mapping(
    database: &Database,
    item: &OutboxItem,
    list: &StoredTaskList,
    remote: &RemoteTask,
    snapshot: &GoogleTaskSnapshot,
) -> AppResult<()> {
    let now = timestamp(Utc::now());
    let base = serde_json::to_string(snapshot)
        .map_err(|error| AppError::database("google-task-created-base", error))?;
    let mut transaction = database
        .pool
        .begin()
        .await
        .map_err(|error| AppError::database("google-task-created-begin", error))?;
    sqlx::query(
        "INSERT INTO google_task_mappings(ticket_id, google_task_list_id, remote_task_id, remote_etag, remote_updated_at_utc, base_snapshot_json, remote_parent_id, remote_position, remote_deleted, last_pulled_at_utc, created_at_utc, updated_at_utc)
         VALUES (?, ?, ?, ?, ?, ?, ?, ?, 0, ?, ?, ?)
         ON CONFLICT(ticket_id) DO UPDATE SET google_task_list_id = excluded.google_task_list_id, remote_task_id = excluded.remote_task_id, remote_etag = excluded.remote_etag, remote_updated_at_utc = excluded.remote_updated_at_utc, base_snapshot_json = excluded.base_snapshot_json, remote_parent_id = excluded.remote_parent_id, remote_position = excluded.remote_position, remote_deleted = 0, last_pulled_at_utc = excluded.last_pulled_at_utc, updated_at_utc = excluded.updated_at_utc",
    )
    .bind(item.ticket_id.to_string())
    .bind(list.id.to_string())
    .bind(&remote.id)
    .bind(null_if_empty(remote.etag.clone()))
    .bind(null_if_empty(remote.updated.clone()))
    .bind(base)
    .bind(remote.parent.clone())
    .bind(null_if_empty(remote.position.clone()))
    .bind(&now)
    .bind(&now)
    .bind(&now)
    .execute(&mut *transaction)
    .await
    .map_err(|error| AppError::database("google-task-created-mapping", error))?;
    complete_outbox_tx(&mut transaction, item.id).await?;
    transaction
        .commit()
        .await
        .map_err(|error| AppError::database("google-task-created-commit", error))
}

async fn push_task_patch(
    database: &Database,
    client: &Client,
    access_token: &str,
    api_root: &str,
    item: &OutboxItem,
    local: &GoogleTaskSnapshot,
) -> AppResult<()> {
    let Some(mapping) = mapping_row(database, item.ticket_id).await? else {
        mark_outbox_permanent(database, item.id, "not_found").await?;
        return Err(not_found("Google Taskとの対応が見つかりません。"));
    };
    let url = task_url(api_root, &mapping.remote_list_id, &mapping.remote_task_id)?;
    let response = client
        .get(url.clone())
        .bearer_auth(access_token)
        .send()
        .await
        .map_err(|_| unavailable("Google Taskの現在値を確認できません。", true))?;
    if !response.status().is_success() {
        let retry_after = retry_after(&response);
        return handle_outbox_http_error(database, item, response.status(), retry_after).await;
    }
    let remote_task: RemoteTask = response.json().await.map_err(|_| {
        validation(
            "Google Taskの現在値を解析できません。",
            "同期を停止しました。時間を置いて再試行してください。",
        )
    })?;
    validate_remote_task(&remote_task)?;
    let remote = remote_snapshot(database, mapping.list_id, &remote_task).await?;
    let merged = merge_google_task(&mapping.base, local, &remote);
    if !merged.conflicts.is_empty() {
        persist_merge_conflicts(database, item, &merged.conflicts, "same_field").await?;
        return Err(AppError::Conflict {
            message: "LocalとGoogleで同じ項目が変更されています。".into(),
            recovery: "Google Tasks競合で項目ごとに残す値を選んでください。".into(),
        });
    }
    let mut request = client
        .patch(url)
        .bearer_auth(access_token)
        .json(&snapshot_to_remote_patch(local, Utc::now()));
    if !remote_task.etag.is_empty() {
        request = request.header("If-Match", &remote_task.etag);
    }
    let response = request
        .send()
        .await
        .map_err(|_| unavailable("Google Taskを更新できません。", true))?;
    if !response.status().is_success() {
        let retry_after = retry_after(&response);
        return handle_outbox_http_error(database, item, response.status(), retry_after).await;
    }
    let updated: RemoteTask = response.json().await.map_err(|_| {
        validation(
            "更新したGoogle Taskの応答を解析できません。",
            "次回の同期で現在値を再確認してください。",
        )
    })?;
    validate_remote_task(&updated)?;
    update_mapping_after_push(database, item, mapping.list_id, &updated, local).await
}

async fn push_task_move(
    database: &Database,
    client: &Client,
    access_token: &str,
    api_root: &str,
    item: &OutboxItem,
    local: &GoogleTaskSnapshot,
) -> AppResult<()> {
    let Some(mapping) = mapping_row(database, item.ticket_id).await? else {
        mark_outbox_permanent(database, item.id, "not_found").await?;
        return Err(not_found("移動するGoogle Taskが見つかりません。"));
    };
    let target = stored_task_list(database, local.task_list_id).await?;
    let remote_parent = if let Some(parent_ticket_id) = local.parent_ticket_id {
        let parent = mapping_row(database, parent_ticket_id)
            .await?
            .ok_or_else(|| {
                validation(
                    "親TicketがGoogle Tasksへ同期されていません。",
                    "親Ticketを先に同じTask Listへ同期してください。",
                )
            })?;
        if parent.list_id != target.id {
            mark_outbox_permanent(database, item.id, "unsupported").await?;
            return Err(validation(
                "親子Ticketは同じGoogle Task Listに必要です。",
                "同期先を揃えてから再試行してください。",
            ));
        }
        Some(parent.remote_task_id)
    } else {
        None
    };
    let mut url = Url::parse(api_root)
        .and_then(|base| {
            base.join(&format!(
                "lists/{}/tasks/{}/move",
                encode_segment(&mapping.remote_list_id),
                encode_segment(&mapping.remote_task_id)
            ))
        })
        .map_err(|error| AppError::database("google-task-move-url", error))?;
    {
        let mut query = url.query_pairs_mut();
        if mapping.list_id != target.id {
            query.append_pair("destinationTasklist", &target.remote_id);
        }
        if let Some(parent) = &remote_parent {
            query.append_pair("parent", parent);
        }
    }
    let response = client
        .post(url)
        .bearer_auth(access_token)
        .send()
        .await
        .map_err(|_| unavailable("Google Taskを移動できません。", true))?;
    if !response.status().is_success() {
        let retry_after = retry_after(&response);
        return handle_outbox_http_error(database, item, response.status(), retry_after).await;
    }
    let moved: RemoteTask = response.json().await.map_err(|_| {
        validation(
            "移動したGoogle Taskの応答を解析できません。",
            "full reconcileで現在位置を確認してください。",
        )
    })?;
    validate_remote_task(&moved)?;
    update_mapping_after_push(database, item, target.id, &moved, local).await
}

async fn update_mapping_after_push(
    database: &Database,
    item: &OutboxItem,
    list_id: Uuid,
    remote: &RemoteTask,
    snapshot: &GoogleTaskSnapshot,
) -> AppResult<()> {
    let now = timestamp(Utc::now());
    let base = serde_json::to_string(snapshot)
        .map_err(|error| AppError::database("google-task-push-base", error))?;
    let mut transaction = database
        .pool
        .begin()
        .await
        .map_err(|error| AppError::database("google-task-push-begin", error))?;
    sqlx::query(
        "UPDATE google_task_mappings SET google_task_list_id = ?, remote_etag = ?, remote_updated_at_utc = ?, base_snapshot_json = ?, remote_parent_id = ?, remote_position = ?, remote_deleted = 0, last_pulled_at_utc = ?, updated_at_utc = ? WHERE ticket_id = ?",
    )
    .bind(list_id.to_string())
    .bind(null_if_empty(remote.etag.clone()))
    .bind(null_if_empty(remote.updated.clone()))
    .bind(base)
    .bind(remote.parent.clone())
    .bind(null_if_empty(remote.position.clone()))
    .bind(&now)
    .bind(&now)
    .bind(item.ticket_id.to_string())
    .execute(&mut *transaction)
    .await
    .map_err(|error| AppError::database("google-task-push-mapping", error))?;
    complete_outbox_tx(&mut transaction, item.id).await?;
    transaction
        .commit()
        .await
        .map_err(|error| AppError::database("google-task-push-commit", error))
}

async fn complete_outbox(database: &Database, id: Uuid) -> AppResult<()> {
    sqlx::query(
        "UPDATE google_task_outbox SET completed_at_utc = ?, last_error_category = NULL WHERE id = ? AND completed_at_utc IS NULL",
    )
    .bind(timestamp(Utc::now()))
    .bind(id.to_string())
    .execute(&database.pool)
    .await
    .map_err(|error| AppError::database("google-task-outbox-complete", error))?;
    Ok(())
}

async fn complete_outbox_tx(transaction: &mut Transaction<'_, Sqlite>, id: Uuid) -> AppResult<()> {
    sqlx::query(
        "UPDATE google_task_outbox SET completed_at_utc = ?, last_error_category = NULL WHERE id = ? AND completed_at_utc IS NULL",
    )
    .bind(timestamp(Utc::now()))
    .bind(id.to_string())
    .execute(&mut **transaction)
    .await
    .map_err(|error| AppError::database("google-task-outbox-complete-tx", error))?;
    Ok(())
}

async fn mark_outbox_permanent(database: &Database, id: Uuid, category: &str) -> AppResult<()> {
    sqlx::query(
        "UPDATE google_task_outbox SET attempt_count = attempt_count + 1, last_error_category = ? WHERE id = ? AND completed_at_utc IS NULL",
    )
    .bind(category)
    .bind(id.to_string())
    .execute(&database.pool)
    .await
    .map_err(|error| AppError::database("google-task-outbox-permanent", error))?;
    Ok(())
}

async fn schedule_outbox_retry(
    database: &Database,
    item: &OutboxItem,
    category: &str,
    retry_after: Option<StdDuration>,
) -> AppResult<()> {
    let exponential = RETRY_BASE_SECONDS
        .saturating_mul(2_i64.saturating_pow(item.attempt_count.min(10)))
        .min(RETRY_MAX_SECONDS);
    let delay = retry_after
        .and_then(|value| i64::try_from(value.as_secs()).ok())
        .unwrap_or(exponential)
        .clamp(RETRY_BASE_SECONDS, RETRY_MAX_SECONDS);
    sqlx::query(
        "UPDATE google_task_outbox SET attempt_count = attempt_count + 1, last_error_category = ?, next_attempt_at_utc = ? WHERE id = ? AND completed_at_utc IS NULL",
    )
    .bind(category)
    .bind(timestamp(Utc::now() + Duration::seconds(delay)))
    .bind(item.id.to_string())
    .execute(&database.pool)
    .await
    .map_err(|error| AppError::database("google-task-outbox-retry", error))?;
    Ok(())
}

async fn handle_outbox_http_error(
    database: &Database,
    item: &OutboxItem,
    status: StatusCode,
    retry_after: Option<StdDuration>,
) -> AppResult<()> {
    let (category, retryable) = classify_http(status);
    if retryable {
        schedule_outbox_retry(database, item, category, retry_after).await?;
    } else {
        mark_outbox_permanent(database, item.id, category).await?;
    }
    Err(http_error(status, None))
}

fn retry_after(response: &reqwest::Response) -> Option<StdDuration> {
    response
        .headers()
        .get(reqwest::header::RETRY_AFTER)
        .and_then(|value| value.to_str().ok())
        .and_then(|value| value.parse::<u64>().ok())
        .map(|seconds| StdDuration::from_secs(seconds.min(RETRY_MAX_SECONDS as u64)))
}

async fn mark_uncertain_create(
    database: &Database,
    item: &OutboxItem,
    snapshot: &GoogleTaskSnapshot,
) -> AppResult<()> {
    let now = timestamp(Utc::now());
    let local = serde_json::to_string(snapshot)
        .map_err(|error| AppError::database("google-task-uncertain-local", error))?;
    let mut transaction = database
        .pool
        .begin()
        .await
        .map_err(|error| AppError::database("google-task-uncertain-begin", error))?;
    sqlx::query(
        "UPDATE google_task_outbox SET attempt_count = attempt_count + 1, uncertain_create = 1, last_error_category = 'uncertain_create' WHERE id = ?",
    )
    .bind(item.id.to_string())
    .execute(&mut *transaction)
    .await
    .map_err(|error| AppError::database("google-task-uncertain-outbox", error))?;
    insert_conflict_tx(
        &mut transaction,
        item.ticket_id,
        "delete",
        (
            &serde_json::Value::Null,
            &serde_json::from_str(&local)
                .map_err(|error| AppError::database("google-task-uncertain-value", error))?,
            &serde_json::Value::Null,
        ),
        "uncertain_create",
        &now,
    )
    .await?;
    transaction
        .commit()
        .await
        .map_err(|error| AppError::database("google-task-uncertain-commit", error))
}

async fn persist_merge_conflicts(
    database: &Database,
    item: &OutboxItem,
    conflicts: &std::collections::BTreeMap<
        &'static str,
        (serde_json::Value, serde_json::Value, serde_json::Value),
    >,
    conflict_type: &str,
) -> AppResult<()> {
    let now = timestamp(Utc::now());
    let mut transaction = database
        .pool
        .begin()
        .await
        .map_err(|error| AppError::database("google-task-conflict-begin", error))?;
    for (field, (base, local, remote)) in conflicts {
        insert_conflict_tx(
            &mut transaction,
            item.ticket_id,
            field,
            (base, local, remote),
            conflict_type,
            &now,
        )
        .await?;
    }
    sqlx::query(
        "UPDATE google_task_outbox SET last_error_category = 'conflict' WHERE id = ? AND completed_at_utc IS NULL",
    )
    .bind(item.id.to_string())
    .execute(&mut *transaction)
    .await
    .map_err(|error| AppError::database("google-task-conflict-outbox", error))?;
    transaction
        .commit()
        .await
        .map_err(|error| AppError::database("google-task-conflict-commit", error))
}

async fn insert_conflict_tx(
    transaction: &mut Transaction<'_, Sqlite>,
    ticket_id: Uuid,
    field: &str,
    values: (&serde_json::Value, &serde_json::Value, &serde_json::Value),
    conflict_type: &str,
    now: &str,
) -> AppResult<()> {
    let (base, local, remote) = values;
    sqlx::query(
        "INSERT INTO google_task_conflicts(id, ticket_id, field_name, base_value_json, local_value_json, remote_value_json, conflict_type, detected_at_utc)
         VALUES (?, ?, ?, ?, ?, ?, ?, ?)
         ON CONFLICT(ticket_id, field_name) WHERE resolved_at_utc IS NULL DO UPDATE SET base_value_json = excluded.base_value_json, local_value_json = excluded.local_value_json, remote_value_json = excluded.remote_value_json, conflict_type = excluded.conflict_type, detected_at_utc = excluded.detected_at_utc",
    )
    .bind(Uuid::new_v4().to_string())
    .bind(ticket_id.to_string())
    .bind(field)
    .bind(base.to_string())
    .bind(local.to_string())
    .bind(remote.to_string())
    .bind(conflict_type)
    .bind(now)
    .execute(&mut **transaction)
    .await
    .map_err(|error| AppError::database("google-task-conflict-insert", error))?;
    Ok(())
}

async fn pull_selected_task_lists_at(
    database: &Database,
    client: &Client,
    access_token: &str,
    api_root: &str,
    force_full: bool,
    cancellation: &OperationCancellation,
) -> AppResult<()> {
    validate_tasks_api_root(api_root)?;
    let interval_days: i64 = sqlx::query_scalar(
        "SELECT full_reconcile_interval_days FROM google_tasks_config WHERE singleton = 1",
    )
    .fetch_one(&database.pool)
    .await
    .map_err(|error| AppError::database("google-task-full-interval", error))?;
    let rows = sqlx::query(
        "SELECT id, remote_list_id, incremental_watermark_utc, last_full_sync_at_utc FROM google_task_lists WHERE selected = 1 ORDER BY id",
    )
    .fetch_all(&database.pool)
    .await
    .map_err(|error| AppError::database("google-task-selected-lists", error))?;
    for row in rows {
        cancellation.check()?;
        let list = StoredTaskList {
            id: parse_uuid(row.get("id"), "google-task-pull-list")?,
            remote_id: row.get("remote_list_id"),
            watermark: parse_optional_datetime(
                row.get("incremental_watermark_utc"),
                "google-task-pull-watermark",
            )?,
            last_full_sync: parse_optional_datetime(
                row.get("last_full_sync_at_utc"),
                "google-task-pull-full",
            )?,
        };
        let full = force_full
            || list.watermark.is_none()
            || list
                .last_full_sync
                .is_none_or(|value| value <= Utc::now() - Duration::days(interval_days));
        pull_one_task_list_at(
            database,
            client,
            access_token,
            api_root,
            &list,
            full,
            cancellation,
        )
        .await?;
    }
    Ok(())
}

async fn pull_one_task_list_at(
    database: &Database,
    client: &Client,
    access_token: &str,
    api_root: &str,
    list: &StoredTaskList,
    full: bool,
    cancellation: &OperationCancellation,
) -> AppResult<()> {
    let sync_started = Utc::now();
    sqlx::query(
        "UPDATE google_task_lists SET sync_state = 'syncing', last_error_category = NULL, next_retry_at_utc = NULL, updated_at_utc = ? WHERE id = ?",
    )
    .bind(timestamp(sync_started))
    .bind(list.id.to_string())
    .execute(&database.pool)
    .await
    .map_err(|error| AppError::database("google-task-pull-start", error))?;
    let result = async {
        let mut page_token: Option<String> = None;
        let mut all_tasks = Vec::new();
        loop {
            cancellation.check()?;
            let mut url = Url::parse(api_root)
                .and_then(|base| {
                    base.join(&format!("lists/{}/tasks", encode_segment(&list.remote_id)))
                })
                .map_err(|error| AppError::database("google-task-pull-url", error))?;
            {
                let mut query = url.query_pairs_mut();
                query.append_pair("maxResults", &TASK_PAGE_SIZE.to_string());
                query.append_pair("showCompleted", "true");
                query.append_pair("showHidden", "true");
                query.append_pair("showDeleted", "true");
                query.append_pair("showAssigned", "false");
                if !full && let Some(watermark) = list.watermark {
                    query.append_pair(
                        "updatedMin",
                        &timestamp(watermark - Duration::seconds(WATERMARK_OVERLAP_SECONDS)),
                    );
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
                .map_err(|_| unavailable("Google Tasksを取得できません。", true))?;
            if !response.status().is_success() {
                return Err(http_error(response.status(), None));
            }
            let page: RemoteTaskPage = response.json().await.map_err(|_| {
                validation(
                    "Google Tasksの応答を解析できません。",
                    "watermarkは更新していません。時間を置いて再試行してください。",
                )
            })?;
            for task in &page.items {
                if let Err(error) = validate_remote_task(task) {
                    preserve_malformed_remote_shadow(database, list.id, task).await?;
                    return Err(error);
                }
            }
            all_tasks.extend(page.items);
            page_token = page.next_page_token;
            if page_token.is_none() {
                break;
            }
            if all_tasks.len() > 100_000 {
                return Err(validation(
                    "Google Tasksの件数が安全な上限を超えています。",
                    "同期対象Task Listを減らしてください。",
                ));
            }
        }
        apply_remote_tasks(database, list, &all_tasks, full, sync_started).await
    }
    .await;
    if let Err(error) = &result {
        let (category, state) = error_state(error);
        let retry_at = Utc::now() + Duration::minutes(5);
        let _ = sqlx::query(
            "UPDATE google_task_lists SET sync_state = ?, last_error_category = ?, next_retry_at_utc = ?, updated_at_utc = ? WHERE id = ?",
        )
        .bind(state)
        .bind(category)
        .bind(timestamp(retry_at))
        .bind(timestamp(Utc::now()))
        .bind(list.id.to_string())
        .execute(&database.pool)
        .await;
    }
    result
}

async fn preserve_malformed_remote_shadow(
    database: &Database,
    list_id: Uuid,
    task: &RemoteTask,
) -> AppResult<()> {
    let payload = serde_json::to_string(task)
        .map_err(|error| AppError::database("google-task-shadow-json", error))?;
    sqlx::query(
        "INSERT INTO google_task_remote_shadows(google_task_list_id, remote_task_id, payload_json, error_category, captured_at_utc) VALUES (?, ?, ?, 'malformed_remote', ?) ON CONFLICT(google_task_list_id, remote_task_id) DO UPDATE SET payload_json = excluded.payload_json, error_category = excluded.error_category, captured_at_utc = excluded.captured_at_utc",
    )
    .bind(list_id.to_string())
    .bind(&task.id)
    .bind(payload)
    .bind(timestamp(Utc::now()))
    .execute(&database.pool)
    .await
    .map_err(|error| AppError::database("google-task-shadow-save", error))?;
    Ok(())
}

async fn apply_remote_tasks(
    database: &Database,
    list: &StoredTaskList,
    remote_tasks: &[RemoteTask],
    full: bool,
    sync_started: DateTime<Utc>,
) -> AppResult<()> {
    let now = timestamp(Utc::now());
    let mut transaction = database
        .pool
        .begin()
        .await
        .map_err(|error| AppError::database("google-task-pull-apply-begin", error))?;
    let mapping_rows = sqlx::query(
        "SELECT ticket_id, remote_task_id FROM google_task_mappings WHERE google_task_list_id = ?",
    )
    .bind(list.id.to_string())
    .fetch_all(&mut *transaction)
    .await
    .map_err(|error| AppError::database("google-task-pull-mappings", error))?;
    let mut ticket_by_remote: std::collections::HashMap<String, Uuid> = mapping_rows
        .iter()
        .map(|row| {
            Ok((
                row.get::<String, _>("remote_task_id"),
                parse_uuid(row.get("ticket_id"), "google-task-pull-mapped-ticket")?,
            ))
        })
        .collect::<AppResult<_>>()?;
    for remote in remote_tasks.iter().filter(|task| !task.deleted) {
        ticket_by_remote
            .entry(remote.id.clone())
            .or_insert_with(Uuid::new_v4);
    }
    let remote_ids: std::collections::HashSet<&str> =
        remote_tasks.iter().map(|task| task.id.as_str()).collect();
    let mapped_remote_ids: std::collections::HashSet<&str> = mapping_rows
        .iter()
        .map(|row| row.get::<&str, _>("remote_task_id"))
        .collect();
    let active_remote_ids: std::collections::HashSet<&str> = remote_tasks
        .iter()
        .filter(|task| !task.deleted)
        .map(|task| task.id.as_str())
        .collect();
    let mut remaining = remote_tasks
        .iter()
        .filter(|task| !task.deleted)
        .collect::<Vec<_>>();
    let mut emitted = std::collections::HashSet::new();
    let mut ordered = Vec::with_capacity(remote_tasks.len());
    while !remaining.is_empty() {
        let before = remaining.len();
        let mut index = 0;
        while index < remaining.len() {
            let parent_ready = remaining[index].parent.as_deref().is_none_or(|parent| {
                !active_remote_ids.contains(parent)
                    || mapped_remote_ids.contains(parent)
                    || emitted.contains(parent)
            });
            if parent_ready {
                let task = remaining.remove(index);
                emitted.insert(task.id.as_str());
                ordered.push(task);
            } else {
                index += 1;
            }
        }
        if remaining.len() == before {
            return Err(validation(
                "Google Tasksの親子関係を安全に並べ替えられません。",
                "循環している親子関係をGoogle Tasks側で修正してください。",
            ));
        }
    }
    ordered.extend(remote_tasks.iter().filter(|task| task.deleted));
    for remote in ordered {
        let Some(ticket_id) = ticket_by_remote.get(&remote.id).copied() else {
            continue;
        };
        if remote.deleted {
            if mapping_rows
                .iter()
                .any(|row| row.get::<&str, _>("remote_task_id") == remote.id)
            {
                let pending: bool = sqlx::query_scalar(
                    "SELECT EXISTS(SELECT 1 FROM google_task_outbox WHERE ticket_id = ? AND completed_at_utc IS NULL)",
                )
                .bind(ticket_id.to_string())
                .fetch_one(&mut *transaction)
                .await
                .map_err(|error| AppError::database("google-task-delete-pending", error))?;
                insert_conflict_tx(
                    &mut transaction,
                    ticket_id,
                    "delete",
                    (
                        &serde_json::Value::Bool(false),
                        &serde_json::Value::String(if pending { "edited" } else { "kept" }.into()),
                        &serde_json::Value::Bool(true),
                    ),
                    "remote_delete",
                    &now,
                )
                .await?;
                sqlx::query(
                    "UPDATE google_task_mappings SET remote_deleted = 1, remote_etag = ?, remote_updated_at_utc = ?, last_pulled_at_utc = ?, updated_at_utc = ? WHERE ticket_id = ?",
                )
                .bind(null_if_empty(remote.etag.clone()))
                .bind(null_if_empty(remote.updated.clone()))
                .bind(&now)
                .bind(&now)
                .bind(ticket_id.to_string())
                .execute(&mut *transaction)
                .await
                .map_err(|error| AppError::database("google-task-remote-delete", error))?;
            }
            continue;
        }
        let parent_ticket_id = remote
            .parent
            .as_ref()
            .and_then(|parent| ticket_by_remote.get(parent))
            .copied();
        let remote_snapshot = remote_snapshot_with_parent(list.id, remote, parent_ticket_id)?;
        let mapping =
            sqlx::query("SELECT base_snapshot_json FROM google_task_mappings WHERE ticket_id = ?")
                .bind(ticket_id.to_string())
                .fetch_optional(&mut *transaction)
                .await
                .map_err(|error| AppError::database("google-task-pull-mapping", error))?;
        if let Some(mapping) = mapping {
            let base: GoogleTaskSnapshot = serde_json::from_str(mapping.get("base_snapshot_json"))
                .map_err(|error| AppError::database("google-task-pull-base", error))?;
            let local = ticket_snapshot_tx(&mut transaction, ticket_id, list.id).await?;
            let merged = merge_google_task(&base, &local, &remote_snapshot);
            if merged.conflicts.is_empty() {
                apply_merged_ticket_tx(&mut transaction, ticket_id, &local, &merged.merged, &now)
                    .await?;
                update_mapping_from_pull_tx(
                    &mut transaction,
                    ticket_id,
                    list.id,
                    remote,
                    &merged.merged,
                    &now,
                )
                .await?;
                sqlx::query(
                    "UPDATE google_task_outbox SET completed_at_utc = ?, last_error_category = NULL WHERE ticket_id = ? AND completed_at_utc IS NULL AND entity_version <= (SELECT version FROM tickets WHERE id = ?)",
                )
                .bind(&now)
                .bind(ticket_id.to_string())
                .bind(ticket_id.to_string())
                .execute(&mut *transaction)
                .await
                .map_err(|error| AppError::database("google-task-pull-outbox", error))?;
            } else {
                for (field, (base, local, google)) in &merged.conflicts {
                    let conflict_type = match *field {
                        "completed" => "complete_column",
                        "parent" => "parent_move",
                        "tasklist" => "list_move",
                        _ => "same_field",
                    };
                    insert_conflict_tx(
                        &mut transaction,
                        ticket_id,
                        field,
                        (base, local, google),
                        conflict_type,
                        &now,
                    )
                    .await?;
                }
            }
        } else {
            insert_google_origin_ticket_tx(
                &mut transaction,
                ticket_id,
                &remote_snapshot,
                remote,
                &now,
            )
            .await?;
        }
    }
    if full {
        for row in mapping_rows {
            let remote_id: String = row.get("remote_task_id");
            if !remote_ids.contains(remote_id.as_str()) {
                let ticket_id = parse_uuid(row.get("ticket_id"), "google-task-full-ticket")?;
                insert_conflict_tx(
                    &mut transaction,
                    ticket_id,
                    "delete",
                    (
                        &serde_json::Value::Bool(false),
                        &serde_json::Value::String("kept".into()),
                        &serde_json::Value::Bool(true),
                    ),
                    "remote_delete",
                    &now,
                )
                .await?;
            }
        }
    }
    let conflict_exists: bool = sqlx::query_scalar(
        "SELECT EXISTS(SELECT 1 FROM google_task_conflicts c JOIN google_task_mappings m ON m.ticket_id = c.ticket_id WHERE m.google_task_list_id = ? AND c.resolved_at_utc IS NULL)",
    )
    .bind(list.id.to_string())
    .fetch_one(&mut *transaction)
    .await
    .map_err(|error| AppError::database("google-task-list-conflicts", error))?;
    sqlx::query(
        "UPDATE google_task_lists SET sync_state = ?, incremental_watermark_utc = ?, last_full_sync_at_utc = CASE WHEN ? THEN ? ELSE last_full_sync_at_utc END, last_success_at_utc = ?, last_error_category = NULL, next_retry_at_utc = NULL, updated_at_utc = ? WHERE id = ?",
    )
    .bind(if conflict_exists { "conflict" } else { "synced" })
    .bind(timestamp(sync_started))
    .bind(full)
    .bind(&now)
    .bind(&now)
    .bind(&now)
    .bind(list.id.to_string())
    .execute(&mut *transaction)
    .await
    .map_err(|error| AppError::database("google-task-list-success", error))?;
    transaction
        .commit()
        .await
        .map_err(|error| AppError::database("google-task-pull-apply-commit", error))
}

async fn ticket_snapshot_tx(
    transaction: &mut Transaction<'_, Sqlite>,
    ticket_id: Uuid,
    list_id: Uuid,
) -> AppResult<GoogleTaskSnapshot> {
    let row = sqlx::query(
        "SELECT t.title, t.description, t.due_date, t.parent_ticket_id, c.kind FROM tickets t JOIN ticket_columns c ON c.id = t.column_id WHERE t.id = ?",
    )
    .bind(ticket_id.to_string())
    .fetch_optional(&mut **transaction)
    .await
    .map_err(|error| AppError::database("google-task-local-snapshot", error))?
    .ok_or_else(|| not_found("同期対象Ticketが見つかりません。"))?;
    Ok(GoogleTaskSnapshot {
        title: row.get("title"),
        notes: row.get("description"),
        due_date: row
            .get::<Option<&str>, _>("due_date")
            .map(|value| NaiveDate::parse_from_str(value, "%Y-%m-%d"))
            .transpose()
            .map_err(|error| AppError::database("google-task-local-due", error))?,
        completed: row.get::<String, _>("kind") == "done",
        parent_ticket_id: row
            .get::<Option<&str>, _>("parent_ticket_id")
            .map(|value| parse_uuid(value, "google-task-local-parent"))
            .transpose()?,
        task_list_id: list_id,
    })
}

async fn insert_google_origin_ticket_tx(
    transaction: &mut Transaction<'_, Sqlite>,
    ticket_id: Uuid,
    snapshot: &GoogleTaskSnapshot,
    remote: &RemoteTask,
    now: &str,
) -> AppResult<()> {
    let column_id: String = sqlx::query_scalar(
        "SELECT id FROM ticket_columns WHERE board_id = '00000000-0000-4000-8000-000000000100' AND kind = ?",
    )
    .bind(if snapshot.completed { "done" } else { "inbox" })
    .fetch_one(&mut **transaction)
    .await
    .map_err(|error| AppError::database("google-task-origin-column", error))?;
    let sort_key: i64 = sqlx::query_scalar(
        "SELECT COALESCE(MAX(sort_key), 0) + 1024 FROM tickets WHERE column_id = ? AND deleted_at_utc IS NULL",
    )
    .bind(&column_id)
    .fetch_one(&mut **transaction)
    .await
    .map_err(|error| AppError::database("google-task-origin-sort", error))?;
    sqlx::query(
        "INSERT INTO tickets(id, board_id, column_id, last_non_done_column_id, parent_ticket_id, title, description, priority, due_date, estimate_minutes, sort_key, version, completed_at_utc, archived_at_utc, deleted_at_utc, created_at_utc, updated_at_utc)
         VALUES (?, '00000000-0000-4000-8000-000000000100', ?, ?, ?, ?, ?, 'normal', ?, NULL, ?, 0, ?, NULL, NULL, ?, ?)",
    )
    .bind(ticket_id.to_string())
    .bind(&column_id)
    .bind((!snapshot.completed).then(|| column_id.clone()))
    .bind(snapshot.parent_ticket_id.map(|value| value.to_string()))
    .bind(&snapshot.title)
    .bind(&snapshot.notes)
    .bind(snapshot.due_date.map(|value| value.to_string()))
    .bind(sort_key)
    .bind(snapshot.completed.then(|| now.to_owned()))
    .bind(now)
    .bind(now)
    .execute(&mut **transaction)
    .await
    .map_err(|error| AppError::database("google-task-origin-ticket", error))?;
    sqlx::query(
        "INSERT INTO ticket_change_history(action_id, ticket_id, action, entity_version, before_json, after_json, created_at_utc) VALUES (?, ?, 'create', 0, NULL, ?, ?)",
    )
    .bind(Uuid::new_v4().to_string())
    .bind(ticket_id.to_string())
    .bind(serde_json::to_string(snapshot).map_err(|error| AppError::database("google-task-origin-history-json", error))?)
    .bind(now)
    .execute(&mut **transaction)
    .await
    .map_err(|error| AppError::database("google-task-origin-history", error))?;
    update_mapping_from_pull_tx(
        transaction,
        ticket_id,
        snapshot.task_list_id,
        remote,
        snapshot,
        now,
    )
    .await
}

async fn apply_merged_ticket_tx(
    transaction: &mut Transaction<'_, Sqlite>,
    ticket_id: Uuid,
    before: &GoogleTaskSnapshot,
    merged: &GoogleTaskSnapshot,
    now: &str,
) -> AppResult<()> {
    if before == merged {
        return Ok(());
    }
    let current_column: String = sqlx::query_scalar("SELECT column_id FROM tickets WHERE id = ?")
        .bind(ticket_id.to_string())
        .fetch_one(&mut **transaction)
        .await
        .map_err(|error| AppError::database("google-task-merge-column", error))?;
    let target_column = if before.completed == merged.completed {
        current_column.clone()
    } else if merged.completed {
        sqlx::query_scalar(
            "SELECT id FROM ticket_columns WHERE board_id = '00000000-0000-4000-8000-000000000100' AND kind = 'done'",
        )
        .fetch_one(&mut **transaction)
        .await
        .map_err(|error| AppError::database("google-task-merge-done", error))?
    } else {
        sqlx::query_scalar::<_, String>(
            "SELECT COALESCE(last_non_done_column_id, '00000000-0000-4000-8000-000000000101') FROM tickets WHERE id = ?",
        )
        .bind(ticket_id.to_string())
        .fetch_one(&mut **transaction)
        .await
        .map_err(|error| AppError::database("google-task-merge-reopen", error))?
    };
    let last_non_done = if merged.completed {
        Some(current_column)
    } else {
        Some(target_column.clone())
    };
    sqlx::query(
        "UPDATE tickets SET column_id = ?, last_non_done_column_id = ?, parent_ticket_id = ?, title = ?, description = ?, due_date = ?, completed_at_utc = ?, version = version + 1, updated_at_utc = ? WHERE id = ? AND deleted_at_utc IS NULL",
    )
    .bind(target_column)
    .bind(last_non_done)
    .bind(merged.parent_ticket_id.map(|value| value.to_string()))
    .bind(&merged.title)
    .bind(&merged.notes)
    .bind(merged.due_date.map(|value| value.to_string()))
    .bind(merged.completed.then(|| now.to_owned()))
    .bind(now)
    .bind(ticket_id.to_string())
    .execute(&mut **transaction)
    .await
    .map_err(|error| AppError::database("google-task-merge-ticket", error))?;
    let version: i64 = sqlx::query_scalar("SELECT version FROM tickets WHERE id = ?")
        .bind(ticket_id.to_string())
        .fetch_one(&mut **transaction)
        .await
        .map_err(|error| AppError::database("google-task-merge-version", error))?;
    let action = match (before.completed, merged.completed) {
        (false, true) => "complete",
        (true, false) => "reopen",
        _ if before.parent_ticket_id != merged.parent_ticket_id => "parent",
        _ => "update",
    };
    sqlx::query(
        "INSERT INTO ticket_change_history(action_id, ticket_id, action, entity_version, before_json, after_json, created_at_utc) VALUES (?, ?, ?, ?, ?, ?, ?)",
    )
    .bind(Uuid::new_v4().to_string())
    .bind(ticket_id.to_string())
    .bind(action)
    .bind(version)
    .bind(serde_json::to_string(before).map_err(|error| AppError::database("google-task-merge-before", error))?)
    .bind(serde_json::to_string(merged).map_err(|error| AppError::database("google-task-merge-after", error))?)
    .bind(now)
    .execute(&mut **transaction)
    .await
    .map_err(|error| AppError::database("google-task-merge-history", error))?;
    Ok(())
}

async fn update_mapping_from_pull_tx(
    transaction: &mut Transaction<'_, Sqlite>,
    ticket_id: Uuid,
    list_id: Uuid,
    remote: &RemoteTask,
    snapshot: &GoogleTaskSnapshot,
    now: &str,
) -> AppResult<()> {
    let base = serde_json::to_string(snapshot)
        .map_err(|error| AppError::database("google-task-pull-base-json", error))?;
    sqlx::query(
        "INSERT INTO google_task_mappings(ticket_id, google_task_list_id, remote_task_id, remote_etag, remote_updated_at_utc, base_snapshot_json, remote_parent_id, remote_position, remote_deleted, last_pulled_at_utc, created_at_utc, updated_at_utc)
         VALUES (?, ?, ?, ?, ?, ?, ?, ?, 0, ?, ?, ?)
         ON CONFLICT(ticket_id) DO UPDATE SET google_task_list_id = excluded.google_task_list_id, remote_task_id = excluded.remote_task_id, remote_etag = excluded.remote_etag, remote_updated_at_utc = excluded.remote_updated_at_utc, base_snapshot_json = excluded.base_snapshot_json, remote_parent_id = excluded.remote_parent_id, remote_position = excluded.remote_position, remote_deleted = 0, last_pulled_at_utc = excluded.last_pulled_at_utc, updated_at_utc = excluded.updated_at_utc",
    )
    .bind(ticket_id.to_string())
    .bind(list_id.to_string())
    .bind(&remote.id)
    .bind(null_if_empty(remote.etag.clone()))
    .bind(null_if_empty(remote.updated.clone()))
    .bind(base)
    .bind(remote.parent.clone())
    .bind(null_if_empty(remote.position.clone()))
    .bind(now)
    .bind(now)
    .bind(now)
    .execute(&mut **transaction)
    .await
    .map_err(|error| AppError::database("google-task-pull-mapping-save", error))?;
    Ok(())
}

async fn remote_snapshot(
    database: &Database,
    list_id: Uuid,
    remote: &RemoteTask,
) -> AppResult<GoogleTaskSnapshot> {
    let parent_ticket_id = if let Some(parent) = &remote.parent {
        sqlx::query_scalar::<_, String>(
            "SELECT ticket_id FROM google_task_mappings WHERE google_task_list_id = ? AND remote_task_id = ?",
        )
        .bind(list_id.to_string())
        .bind(parent)
        .fetch_optional(&database.pool)
        .await
        .map_err(|error| AppError::database("google-task-remote-parent", error))?
        .map(|value| parse_uuid(&value, "google-task-remote-parent-id"))
        .transpose()?
    } else {
        None
    };
    remote_snapshot_with_parent(list_id, remote, parent_ticket_id)
}

fn remote_snapshot_with_parent(
    list_id: Uuid,
    remote: &RemoteTask,
    parent_ticket_id: Option<Uuid>,
) -> AppResult<GoogleTaskSnapshot> {
    let due_date = remote
        .due
        .as_deref()
        .map(|due| {
            due.get(..10)
                .ok_or_else(|| {
                    validation(
                        "Google Taskの日付が正しくありません。",
                        "同期を停止しました。",
                    )
                })
                .and_then(|date| {
                    NaiveDate::parse_from_str(date, "%Y-%m-%d").map_err(|_| {
                        validation(
                            "Google Taskの日付が正しくありません。",
                            "同期を停止しました。",
                        )
                    })
                })
        })
        .transpose()?;
    Ok(GoogleTaskSnapshot {
        title: remote.title.clone(),
        notes: remote.notes.clone(),
        due_date,
        completed: remote.status == "completed",
        parent_ticket_id,
        task_list_id: list_id,
    })
}

fn validate_remote_task_list(list: &RemoteTaskList) -> AppResult<()> {
    if list.id.is_empty()
        || list.id.len() > MAX_REMOTE_ID_BYTES
        || list.title.trim().is_empty()
        || list.title.chars().count() > MAX_LIST_TITLE_CHARS
        || list.etag.len() > MAX_REMOTE_ID_BYTES
    {
        return Err(validation(
            "Google Task Listの応答が安全な形式ではありません。",
            "同期を停止しました。Google側を確認して再試行してください。",
        ));
    }
    Ok(())
}

fn validate_remote_task(task: &RemoteTask) -> AppResult<()> {
    let envelope_invalid = task.id.is_empty()
        || task.id.len() > MAX_REMOTE_ID_BYTES
        || task.etag.len() > MAX_REMOTE_ID_BYTES
        || task
            .parent
            .as_ref()
            .is_some_and(|value| value.len() > MAX_REMOTE_ID_BYTES)
        || task.position.len() > MAX_REMOTE_ID_BYTES
        || task.updated.len() > 100
        || task.due.as_ref().is_some_and(|value| value.len() > 100)
        || task
            .completed
            .as_ref()
            .is_some_and(|value| value.len() > 100)
        || task.assignment_info.is_some();
    let content_invalid = !task.deleted
        && (task.title.trim().is_empty()
            || task.title.chars().count() > 1_024
            || task.notes.chars().count() > 8_192
            || !matches!(task.status.as_str(), "needsAction" | "completed"));
    if envelope_invalid || content_invalid {
        return Err(validation(
            "Google Taskの応答が対応範囲外です。",
            "ローカルTicketは変更していません。Google側のTaskを確認してください。",
        ));
    }
    Ok(())
}

fn validate_tasks_api_root(api_root: &str) -> AppResult<()> {
    let url = Url::parse(api_root).map_err(|error| AppError::database("tasks-api-root", error))?;
    let test_loopback = cfg!(test) && matches!(url.host_str(), Some("127.0.0.1" | "localhost"));
    if (!test_loopback
        && (url.scheme() != "https" || url.host_str() != Some("tasks.googleapis.com")))
        || !url.username().is_empty()
        || url.password().is_some()
    {
        return Err(validation(
            "Google Tasks APIの接続先が公式endpointではありません。",
            "アプリの構成を確認してください。",
        ));
    }
    Ok(())
}

fn encode_segment(value: &str) -> String {
    const HEX: &[u8; 16] = b"0123456789ABCDEF";
    let mut output = String::with_capacity(value.len());
    for byte in value.bytes() {
        if byte.is_ascii_alphanumeric() || matches!(byte, b'-' | b'.' | b'_' | b'~') {
            output.push(char::from(byte));
        } else {
            output.push('%');
            output.push(char::from(HEX[usize::from(byte >> 4)]));
            output.push(char::from(HEX[usize::from(byte & 0x0f)]));
        }
    }
    output
}

fn task_url(api_root: &str, list_id: &str, task_id: &str) -> AppResult<Url> {
    Url::parse(api_root)
        .and_then(|base| {
            base.join(&format!(
                "lists/{}/tasks/{}",
                encode_segment(list_id),
                encode_segment(task_id)
            ))
        })
        .map_err(|error| AppError::database("google-task-url", error))
}

fn classify_http(status: StatusCode) -> (&'static str, bool) {
    match status {
        StatusCode::UNAUTHORIZED => ("auth_required", false),
        StatusCode::FORBIDDEN => ("forbidden", false),
        StatusCode::NOT_FOUND => ("not_found", false),
        StatusCode::CONFLICT | StatusCode::PRECONDITION_FAILED => ("conflict", false),
        StatusCode::TOO_MANY_REQUESTS => ("rate_limited", true),
        status if status.is_server_error() => ("server", true),
        StatusCode::BAD_REQUEST | StatusCode::UNPROCESSABLE_ENTITY => {
            ("validation_required", false)
        }
        _ => ("unsupported", false),
    }
}

fn http_error(status: StatusCode, _retry_after: Option<StdDuration>) -> AppError {
    let (category, retryable) = classify_http(status);
    let (message, recovery) = match category {
        "auth_required" => (
            "Googleへの再認証が必要です。",
            "ローカルTicketは保持されています。設定から再接続してください。",
        ),
        "forbidden" => (
            "Google Tasks操作がポリシーまたは権限で拒否されました。",
            "管理者ポリシーとTasks権限を確認してください。",
        ),
        "not_found" => (
            "Google TaskまたはTask Listが見つかりません。",
            "full reconcileを実行して同期先を確認してください。",
        ),
        "conflict" => (
            "Google Taskが別の場所で更新されています。",
            "競合詳細でLocalとGoogleの値を確認してください。",
        ),
        "rate_limited" => (
            "Google Tasksの利用上限に達しました。",
            "自動再試行を待つか、後で手動同期してください。",
        ),
        "server" => (
            "Google Tasksで一時的なエラーが発生しました。",
            "自動再試行を待ってください。",
        ),
        "validation_required" => (
            "Google Tasksへ送信できない値があります。",
            "Ticket詳細でタイトル、説明、日付を確認してください。",
        ),
        _ => (
            "Google Tasksで対応していない操作です。",
            "ローカルTicketは保持されています。同期状態を解除するか内容を変更してください。",
        ),
    };
    AppError::Unavailable {
        message: message.into(),
        recovery: recovery.into(),
        retryable,
    }
}

fn error_state(error: &AppError) -> (&'static str, &'static str) {
    match error {
        AppError::Conflict { .. } => ("conflict", "conflict"),
        AppError::Validation { .. } => ("malformed_remote", "unavailable"),
        AppError::Unavailable { retryable, .. } if *retryable => ("offline", "retry_scheduled"),
        AppError::Unavailable { .. } => ("auth_required", "auth_required"),
        _ => ("server", "retry_scheduled"),
    }
}

fn unavailable(message: &str, retryable: bool) -> AppError {
    AppError::Unavailable {
        message: message.into(),
        recovery: if retryable {
            "ローカルTicketは保持されています。ネットワークを確認して再試行してください。".into()
        } else {
            "ローカルTicketは保持されています。同期状態を確認してください。".into()
        },
        retryable,
    }
}

fn null_if_empty(value: String) -> Option<String> {
    (!value.is_empty()).then_some(value)
}

fn set_snapshot_field(
    snapshot: &mut GoogleTaskSnapshot,
    field: &str,
    value: serde_json::Value,
) -> AppResult<()> {
    match field {
        "title" => {
            snapshot.title = serde_json::from_value(value)
                .map_err(|error| AppError::database("google-task-field-title", error))?;
        }
        "notes" => {
            snapshot.notes = serde_json::from_value(value)
                .map_err(|error| AppError::database("google-task-field-notes", error))?;
        }
        "due" => {
            snapshot.due_date = serde_json::from_value(value)
                .map_err(|error| AppError::database("google-task-field-due", error))?;
        }
        "completed" => {
            snapshot.completed = serde_json::from_value(value)
                .map_err(|error| AppError::database("google-task-field-completed", error))?;
        }
        "parent" => {
            snapshot.parent_ticket_id = serde_json::from_value(value)
                .map_err(|error| AppError::database("google-task-field-parent", error))?;
        }
        "tasklist" => {
            snapshot.task_list_id = serde_json::from_value(value)
                .map_err(|error| AppError::database("google-task-field-list", error))?;
        }
        _ => {
            return Err(validation(
                "競合項目が正しくありません。",
                "競合一覧を更新してください。",
            ));
        }
    }
    Ok(())
}

async fn detach_ticket_task_tx(
    transaction: &mut Transaction<'_, Sqlite>,
    ticket_id: Uuid,
    now: &str,
) -> AppResult<()> {
    sqlx::query("DELETE FROM google_task_mappings WHERE ticket_id = ?")
        .bind(ticket_id.to_string())
        .execute(&mut **transaction)
        .await
        .map_err(|error| AppError::database("google-task-conflict-detach", error))?;
    sqlx::query(
        "UPDATE google_task_outbox SET completed_at_utc = ?, last_error_category = NULL WHERE ticket_id = ? AND completed_at_utc IS NULL",
    )
    .bind(now)
    .bind(ticket_id.to_string())
    .execute(&mut **transaction)
    .await
    .map_err(|error| AppError::database("google-task-conflict-detach-outbox", error))?;
    Ok(())
}

async fn soft_delete_ticket_from_tasks_tx(
    transaction: &mut Transaction<'_, Sqlite>,
    ticket_id: Uuid,
    now: &str,
) -> AppResult<()> {
    let title: Option<String> =
        sqlx::query_scalar("SELECT title FROM tickets WHERE id = ? AND deleted_at_utc IS NULL")
            .bind(ticket_id.to_string())
            .fetch_optional(&mut **transaction)
            .await
            .map_err(|error| AppError::database("google-task-delete-local-read", error))?;
    if title.is_none() {
        return Ok(());
    }
    sqlx::query(
        "UPDATE tickets SET deleted_at_utc = ?, version = version + 1, updated_at_utc = ? WHERE id = ? AND deleted_at_utc IS NULL",
    )
    .bind(now)
    .bind(now)
    .bind(ticket_id.to_string())
    .execute(&mut **transaction)
    .await
    .map_err(|error| AppError::database("google-task-delete-local", error))?;
    super::ticket_schedule_repository::deactivate_links_for_ticket(
        transaction,
        ticket_id,
        "ticket_delete",
        parse_datetime(now, "google-task-delete-local-time")?,
    )
    .await?;
    let version: i64 = sqlx::query_scalar("SELECT version FROM tickets WHERE id = ?")
        .bind(ticket_id.to_string())
        .fetch_one(&mut **transaction)
        .await
        .map_err(|error| AppError::database("google-task-delete-local-version", error))?;
    sqlx::query(
        "INSERT INTO ticket_change_history(action_id, ticket_id, action, entity_version, before_json, after_json, created_at_utc) VALUES (?, ?, 'delete', ?, ?, NULL, ?)",
    )
    .bind(Uuid::new_v4().to_string())
    .bind(ticket_id.to_string())
    .bind(version)
    .bind(serde_json::to_string(&title).map_err(|error| AppError::database("google-task-delete-local-history-json", error))?)
    .bind(now)
    .execute(&mut **transaction)
    .await
    .map_err(|error| AppError::database("google-task-delete-local-history", error))?;
    detach_ticket_task_tx(transaction, ticket_id, now).await
}

impl Database {
    pub async fn google_tasks_background_due(&self, now: DateTime<Utc>) -> AppResult<bool> {
        let row = sqlx::query(
            "SELECT enabled, polling_interval_seconds FROM google_tasks_config WHERE singleton = 1",
        )
        .fetch_one(&self.pool)
        .await
        .map_err(|error| AppError::database("google-tasks-background-config", error))?;
        if !row.get::<bool, _>("enabled") {
            return Ok(false);
        }
        let pending: bool = sqlx::query_scalar(
            "SELECT EXISTS(SELECT 1 FROM google_task_outbox WHERE completed_at_utc IS NULL AND uncertain_create = 0 AND next_attempt_at_utc <= ?)",
        )
        .bind(timestamp(now))
        .fetch_one(&self.pool)
        .await
        .map_err(|error| AppError::database("google-tasks-background-outbox", error))?;
        if pending {
            return Ok(true);
        }
        let last_success: Option<String> = sqlx::query_scalar(
            "SELECT MIN(last_success_at_utc) FROM google_task_lists WHERE selected = 1",
        )
        .fetch_one(&self.pool)
        .await
        .map_err(|error| AppError::database("google-tasks-background-success", error))?;
        let interval = Duration::seconds(row.get::<i64, _>("polling_interval_seconds"));
        Ok(last_success
            .as_deref()
            .map(|value| parse_datetime(value, "google-tasks-background-success-date"))
            .transpose()?
            .is_none_or(|value| value <= now - interval))
    }

    pub async fn google_tasks_connection(&self) -> AppResult<GoogleTasksConnection> {
        let enabled: bool =
            sqlx::query_scalar("SELECT enabled FROM google_tasks_config WHERE singleton = 1")
                .fetch_one(&self.pool)
                .await
                .map_err(|error| AppError::database("google-tasks-config", error))?;
        let account = sqlx::query(
            "SELECT scopes_json, status FROM google_accounts WHERE status != 'disconnected' ORDER BY updated_at_utc DESC LIMIT 1",
        )
        .fetch_optional(&self.pool)
        .await
        .map_err(|error| AppError::database("google-tasks-account", error))?;
        let (scope_granted, account_connected) = if let Some(account) = account {
            let scopes: Vec<String> = serde_json::from_str(account.get("scopes_json"))
                .map_err(|error| AppError::database("google-tasks-scopes", error))?;
            (
                scopes.iter().any(|scope| scope == TASKS_SCOPE),
                account.get::<String, _>("status") == "connected",
            )
        } else {
            (false, false)
        };
        let task_lists = self.google_task_lists().await?;
        let mapped_ticket_count = nonnegative_count(
            sqlx::query_scalar::<_, i64>("SELECT COUNT(*) FROM google_task_mappings")
                .fetch_one(&self.pool)
                .await
                .map_err(|error| AppError::database("google-tasks-mapped-count", error))?,
        );
        let pending_outbox_count = nonnegative_count(
            sqlx::query_scalar::<_, i64>(
                "SELECT COUNT(*) FROM google_task_outbox WHERE completed_at_utc IS NULL",
            )
            .fetch_one(&self.pool)
            .await
            .map_err(|error| AppError::database("google-tasks-outbox-count", error))?,
        );
        let conflict_count = nonnegative_count(
            sqlx::query_scalar::<_, i64>(
                "SELECT COUNT(*) FROM google_task_conflicts WHERE resolved_at_utc IS NULL",
            )
            .fetch_one(&self.pool)
            .await
            .map_err(|error| AppError::database("google-tasks-conflict-count", error))?,
        );
        let selected_list_count = task_lists.iter().filter(|list| list.selected).count() as u64;
        let last_success_at = task_lists
            .iter()
            .filter_map(|list| list.last_success_at)
            .max();
        let next_retry_at = task_lists
            .iter()
            .filter_map(|list| list.next_retry_at)
            .min();
        let state = if !account_connected {
            GoogleTaskSyncState::NotConnected
        } else if !scope_granted {
            GoogleTaskSyncState::ScopeMissing
        } else if !enabled {
            GoogleTaskSyncState::Disabled
        } else if conflict_count > 0 {
            GoogleTaskSyncState::Conflict
        } else if task_lists
            .iter()
            .any(|list| list.sync_state == "auth_required")
        {
            GoogleTaskSyncState::AuthRequired
        } else if task_lists.iter().any(|list| list.sync_state == "offline") {
            GoogleTaskSyncState::Offline
        } else if task_lists
            .iter()
            .any(|list| list.sync_state == "retry_scheduled")
        {
            GoogleTaskSyncState::RetryScheduled
        } else if pending_outbox_count > 0 {
            GoogleTaskSyncState::Pending
        } else if selected_list_count == 0 || last_success_at.is_none() {
            GoogleTaskSyncState::Never
        } else {
            GoogleTaskSyncState::Synced
        };
        Ok(GoogleTasksConnection {
            enabled,
            scope_granted,
            state,
            task_lists,
            mapped_ticket_count,
            pending_outbox_count,
            conflict_count,
            selected_list_count,
            last_success_at,
            next_retry_at,
        })
    }

    pub async fn google_task_lists(&self) -> AppResult<Vec<GoogleTaskList>> {
        let rows = sqlx::query(
            "SELECT id, display_name, selected, default_write_target, sync_state, last_success_at_utc, next_retry_at_utc, last_error_category FROM google_task_lists ORDER BY default_write_target DESC, display_name, id",
        )
        .fetch_all(&self.pool)
        .await
        .map_err(|error| AppError::database("google-task-lists", error))?;
        rows.iter().map(task_list_from_row).collect()
    }

    pub async fn update_google_task_list(
        &self,
        request: GoogleTaskListUpdate,
    ) -> AppResult<GoogleTaskList> {
        let mut transaction = self
            .pool
            .begin()
            .await
            .map_err(|error| AppError::database("google-task-list-update-begin", error))?;
        let exists: bool =
            sqlx::query_scalar("SELECT EXISTS(SELECT 1 FROM google_task_lists WHERE id = ?)")
                .bind(request.id.to_string())
                .fetch_one(&mut *transaction)
                .await
                .map_err(|error| AppError::database("google-task-list-update-read", error))?;
        if !exists {
            return Err(not_found("Google Task Listが見つかりません。"));
        }
        if request.default_write_target {
            sqlx::query("UPDATE google_task_lists SET default_write_target = 0")
                .execute(&mut *transaction)
                .await
                .map_err(|error| AppError::database("google-task-default-clear", error))?;
        }
        sqlx::query(
            "UPDATE google_task_lists SET selected = ?, default_write_target = ?, updated_at_utc = ? WHERE id = ?",
        )
        .bind(request.selected || request.default_write_target)
        .bind(request.default_write_target)
        .bind(timestamp(Utc::now()))
        .bind(request.id.to_string())
        .execute(&mut *transaction)
        .await
        .map_err(|error| AppError::database("google-task-list-update", error))?;
        transaction
            .commit()
            .await
            .map_err(|error| AppError::database("google-task-list-update-commit", error))?;
        self.google_task_lists()
            .await?
            .into_iter()
            .find(|list| list.id == request.id)
            .ok_or_else(|| not_found("更新したGoogle Task Listが見つかりません。"))
    }

    pub async fn set_google_tasks_enabled(
        &self,
        enabled: bool,
    ) -> AppResult<GoogleTasksConnection> {
        if enabled {
            let scope_granted = self.google_tasks_connection().await?.scope_granted;
            if !scope_granted {
                return Err(AppError::Unavailable {
                    message: "Google Tasks権限が付与されていません。".into(),
                    recovery: "Calendar + Tasksの権限をまとめて再同意してください。既存Calendar接続は維持されます。".into(),
                    retryable: false,
                });
            }
        }
        sqlx::query(
            "UPDATE google_tasks_config SET enabled = ?, updated_at_utc = ? WHERE singleton = 1",
        )
        .bind(enabled)
        .bind(timestamp(Utc::now()))
        .execute(&self.pool)
        .await
        .map_err(|error| AppError::database("google-tasks-enable", error))?;
        self.google_tasks_connection().await
    }

    pub async fn ticket_google_task_statuses(
        &self,
        ticket_ids: &[Uuid],
    ) -> AppResult<Vec<TicketGoogleTaskStatus>> {
        if ticket_ids.len() > 1_000 {
            return Err(validation(
                "一度に確認できるチケットは1,000件までです。",
                "表示範囲を絞ってください。",
            ));
        }
        let connection = self.google_tasks_connection().await?;
        let mut output = Vec::with_capacity(ticket_ids.len());
        for ticket_id in ticket_ids {
            let row = sqlx::query(
                "SELECT m.google_task_list_id, l.display_name, m.last_pulled_at_utc,
                        (SELECT o.operation_type FROM google_task_outbox o WHERE o.ticket_id = m.ticket_id AND o.completed_at_utc IS NULL ORDER BY o.created_at_utc LIMIT 1) AS pending_operation,
                        (SELECT o.last_error_category FROM google_task_outbox o WHERE o.ticket_id = m.ticket_id AND o.completed_at_utc IS NULL AND o.last_error_category IS NOT NULL ORDER BY o.created_at_utc LIMIT 1) AS error_category,
                        (SELECT COUNT(*) FROM google_task_conflicts c WHERE c.ticket_id = m.ticket_id AND c.resolved_at_utc IS NULL) AS conflict_count
                   FROM google_task_mappings m JOIN google_task_lists l ON l.id = m.google_task_list_id WHERE m.ticket_id = ?",
            )
            .bind(ticket_id.to_string())
            .fetch_optional(&self.pool)
            .await
            .map_err(|error| AppError::database("ticket-google-task-status", error))?;
            let status = if let Some(row) = row {
                let conflicts = nonnegative_count(row.get::<i64, _>("conflict_count"));
                let error_category: Option<String> = row.get("error_category");
                let pending_operation: Option<String> = row.get("pending_operation");
                let state = if conflicts > 0 {
                    GoogleTaskSyncState::Conflict
                } else if error_category.as_deref() == Some("validation_required") {
                    GoogleTaskSyncState::ValidationRequired
                } else if error_category.as_deref() == Some("unsupported") {
                    GoogleTaskSyncState::Unsupported
                } else if pending_operation.is_some() {
                    GoogleTaskSyncState::Pending
                } else {
                    GoogleTaskSyncState::Synced
                };
                TicketGoogleTaskStatus {
                    ticket_id: *ticket_id,
                    state,
                    task_list_id: Some(parse_uuid(row.get("google_task_list_id"), "task-list-id")?),
                    task_list_name: Some(row.get("display_name")),
                    last_sync_at: parse_optional_datetime(
                        row.get("last_pulled_at_utc"),
                        "task-last-sync",
                    )?,
                    error_category,
                    pending_operation,
                    conflict_count: conflicts,
                }
            } else {
                let pending = sqlx::query(
                    "SELECT o.target_list_id, l.display_name, o.operation_type, o.last_error_category,
                            (SELECT COUNT(*) FROM google_task_conflicts c WHERE c.ticket_id = o.ticket_id AND c.resolved_at_utc IS NULL) AS conflict_count
                     FROM google_task_outbox o LEFT JOIN google_task_lists l ON l.id = o.target_list_id
                     WHERE o.ticket_id = ? AND o.completed_at_utc IS NULL ORDER BY o.created_at_utc LIMIT 1",
                )
                .bind(ticket_id.to_string())
                .fetch_optional(&self.pool)
                .await
                .map_err(|error| AppError::database("ticket-google-task-pending", error))?;
                if let Some(pending) = pending {
                    let error_category: Option<String> = pending.get("last_error_category");
                    let conflicts = nonnegative_count(pending.get::<i64, _>("conflict_count"));
                    TicketGoogleTaskStatus {
                        ticket_id: *ticket_id,
                        state: if conflicts > 0 {
                            GoogleTaskSyncState::Conflict
                        } else if error_category.as_deref() == Some("validation_required") {
                            GoogleTaskSyncState::ValidationRequired
                        } else {
                            GoogleTaskSyncState::Pending
                        },
                        task_list_id: pending
                            .get::<Option<&str>, _>("target_list_id")
                            .map(|value| parse_uuid(value, "task-pending-list-id"))
                            .transpose()?,
                        task_list_name: pending.get("display_name"),
                        last_sync_at: None,
                        error_category,
                        pending_operation: Some(pending.get("operation_type")),
                        conflict_count: conflicts,
                    }
                } else {
                    TicketGoogleTaskStatus {
                        ticket_id: *ticket_id,
                        state: connection.state,
                        task_list_id: None,
                        task_list_name: None,
                        last_sync_at: None,
                        error_category: None,
                        pending_operation: None,
                        conflict_count: 0,
                    }
                }
            };
            output.push(status);
        }
        Ok(output)
    }

    pub async fn google_task_conflicts(&self) -> AppResult<Vec<GoogleTaskConflict>> {
        let rows = sqlx::query(
            "SELECT c.id, c.ticket_id, t.title, c.field_name, c.base_value_json, c.local_value_json, c.remote_value_json, c.conflict_type, c.detected_at_utc FROM google_task_conflicts c JOIN tickets t ON t.id = c.ticket_id WHERE c.resolved_at_utc IS NULL ORDER BY c.detected_at_utc DESC LIMIT 500",
        )
        .fetch_all(&self.pool)
        .await
        .map_err(|error| AppError::database("google-task-conflicts", error))?;
        rows.iter().map(conflict_from_row).collect()
    }

    pub async fn resolve_google_task_conflict(
        &self,
        request: GoogleTaskConflictResolveRequest,
    ) -> AppResult<TicketGoogleTaskStatus> {
        let row = sqlx::query(
            "SELECT ticket_id, field_name, remote_value_json, conflict_type FROM google_task_conflicts WHERE id = ? AND resolved_at_utc IS NULL",
        )
        .bind(request.conflict_id.to_string())
        .fetch_optional(&self.pool)
        .await
        .map_err(|error| AppError::database("google-task-conflict-resolve-read", error))?
        .ok_or_else(|| not_found("Google Tasks競合が見つかりません。"))?;
        let ticket_id = parse_uuid(row.get("ticket_id"), "google-task-conflict-resolve-ticket")?;
        let field: String = row.get("field_name");
        let conflict_type: String = row.get("conflict_type");
        let remote_value = decode_json(
            row.get("remote_value_json"),
            "google-task-conflict-resolve-remote",
        )?;
        if conflict_type == "uncertain_create"
            && !matches!(request.resolution, GoogleTaskConflictResolution::Detach)
        {
            return Err(validation(
                "作成結果が不明なGoogle Taskは自動再作成できません。",
                "Google Tasks側を確認してから同期を解除し、必要な場合だけ改めて同期してください。",
            ));
        }
        let now = timestamp(Utc::now());
        let mut transaction = self
            .pool
            .begin()
            .await
            .map_err(|error| AppError::database("google-task-conflict-resolve-begin", error))?;
        let mapping = sqlx::query(
            "SELECT google_task_list_id, base_snapshot_json FROM google_task_mappings WHERE ticket_id = ?",
        )
        .bind(ticket_id.to_string())
        .fetch_optional(&mut *transaction)
        .await
        .map_err(|error| AppError::database("google-task-conflict-resolve-mapping", error))?;
        match request.resolution {
            GoogleTaskConflictResolution::Detach => {
                detach_ticket_task_tx(&mut transaction, ticket_id, &now).await?;
            }
            GoogleTaskConflictResolution::DeleteLocal => {
                soft_delete_ticket_from_tasks_tx(&mut transaction, ticket_id, &now).await?;
            }
            GoogleTaskConflictResolution::Google if field == "delete" => {
                soft_delete_ticket_from_tasks_tx(&mut transaction, ticket_id, &now).await?;
            }
            GoogleTaskConflictResolution::Local if field == "delete" => {
                if let Some(mapping) = &mapping {
                    let list_id = parse_uuid(
                        mapping.get("google_task_list_id"),
                        "google-task-conflict-recreate-list",
                    )?;
                    sqlx::query("DELETE FROM google_task_mappings WHERE ticket_id = ?")
                        .bind(ticket_id.to_string())
                        .execute(&mut *transaction)
                        .await
                        .map_err(|error| {
                            AppError::database("google-task-conflict-recreate-detach", error)
                        })?;
                    let version: i64 =
                        sqlx::query_scalar("SELECT version FROM tickets WHERE id = ?")
                            .bind(ticket_id.to_string())
                            .fetch_one(&mut *transaction)
                            .await
                            .map_err(|error| {
                                AppError::database("google-task-conflict-recreate-version", error)
                            })?;
                    insert_task_outbox(
                        &mut transaction,
                        request.operation_id,
                        ticket_id,
                        "create",
                        version.max(0) as u64,
                        Some(list_id),
                        &now,
                    )
                    .await?;
                }
            }
            GoogleTaskConflictResolution::Google => {
                sqlx::query(
                    "UPDATE google_task_outbox SET completed_at_utc = ?, last_error_category = NULL WHERE ticket_id = ? AND completed_at_utc IS NULL",
                )
                .bind(&now)
                .bind(ticket_id.to_string())
                .execute(&mut *transaction)
                .await
                .map_err(|error| AppError::database("google-task-conflict-google-outbox", error))?;
                let mapping = mapping
                    .as_ref()
                    .ok_or_else(|| not_found("Google Taskとの対応が見つかりません。"))?;
                let list_id = parse_uuid(
                    mapping.get("google_task_list_id"),
                    "google-task-conflict-google-list",
                )?;
                let before = ticket_snapshot_tx(&mut transaction, ticket_id, list_id).await?;
                let mut selected = before.clone();
                set_snapshot_field(&mut selected, &field, remote_value.clone())?;
                apply_merged_ticket_tx(&mut transaction, ticket_id, &before, &selected, &now)
                    .await?;
                sqlx::query("UPDATE google_task_mappings SET base_snapshot_json = ?, updated_at_utc = ? WHERE ticket_id = ?")
                    .bind(serde_json::to_string(&selected).map_err(|error| AppError::database("google-task-conflict-google-base", error))?)
                    .bind(&now)
                    .bind(ticket_id.to_string())
                    .execute(&mut *transaction)
                    .await
                    .map_err(|error| AppError::database("google-task-conflict-google-save", error))?;
            }
            GoogleTaskConflictResolution::Local => {
                sqlx::query(
                    "UPDATE google_task_outbox SET completed_at_utc = ?, last_error_category = NULL WHERE ticket_id = ? AND completed_at_utc IS NULL",
                )
                .bind(&now)
                .bind(ticket_id.to_string())
                .execute(&mut *transaction)
                .await
                .map_err(|error| AppError::database("google-task-conflict-local-outbox", error))?;
                let mapping = mapping
                    .as_ref()
                    .ok_or_else(|| not_found("Google Taskとの対応が見つかりません。"))?;
                let list_id = parse_uuid(
                    mapping.get("google_task_list_id"),
                    "google-task-conflict-local-list",
                )?;
                let mut base: GoogleTaskSnapshot =
                    serde_json::from_str(mapping.get("base_snapshot_json")).map_err(|error| {
                        AppError::database("google-task-conflict-local-base", error)
                    })?;
                set_snapshot_field(&mut base, &field, remote_value)?;
                sqlx::query("UPDATE google_task_mappings SET base_snapshot_json = ?, updated_at_utc = ? WHERE ticket_id = ?")
                    .bind(serde_json::to_string(&base).map_err(|error| AppError::database("google-task-conflict-local-json", error))?)
                    .bind(&now)
                    .bind(ticket_id.to_string())
                    .execute(&mut *transaction)
                    .await
                    .map_err(|error| AppError::database("google-task-conflict-local-save", error))?;
                let version: i64 = sqlx::query_scalar("SELECT version FROM tickets WHERE id = ?")
                    .bind(ticket_id.to_string())
                    .fetch_one(&mut *transaction)
                    .await
                    .map_err(|error| {
                        AppError::database("google-task-conflict-local-version", error)
                    })?;
                insert_task_outbox(
                    &mut transaction,
                    request.operation_id,
                    ticket_id,
                    "update",
                    version.max(0) as u64,
                    Some(list_id),
                    &now,
                )
                .await?;
            }
        }
        sqlx::query(
            "UPDATE google_task_conflicts SET resolved_at_utc = ?, resolution = ? WHERE id = ? AND resolved_at_utc IS NULL",
        )
        .bind(&now)
        .bind(match request.resolution {
            GoogleTaskConflictResolution::Local => "local",
            GoogleTaskConflictResolution::Google => "google",
            GoogleTaskConflictResolution::Detach => "detach",
            GoogleTaskConflictResolution::DeleteLocal => "delete_local",
        })
        .bind(request.conflict_id.to_string())
        .execute(&mut *transaction)
        .await
        .map_err(|error| AppError::database("google-task-conflict-resolve-mark", error))?;
        transaction
            .commit()
            .await
            .map_err(|error| AppError::database("google-task-conflict-resolve-commit", error))?;
        self.ticket_google_task_statuses(&[ticket_id])
            .await?
            .into_iter()
            .next()
            .ok_or_else(|| AppError::database("google-task-conflict-resolve-result", "missing"))
    }

    pub async fn update_ticket_google_task_target(
        &self,
        request: TicketGoogleTaskTargetUpdate,
    ) -> AppResult<TicketGoogleTaskStatus> {
        let ticket = self.ticket(request.ticket_id).await?;
        let now = timestamp(Utc::now());
        let mut transaction = self
            .pool
            .begin()
            .await
            .map_err(|error| AppError::database("ticket-task-target-begin", error))?;
        let mapping =
            sqlx::query("SELECT google_task_list_id FROM google_task_mappings WHERE ticket_id = ?")
                .bind(request.ticket_id.to_string())
                .fetch_optional(&mut *transaction)
                .await
                .map_err(|error| AppError::database("ticket-task-target-mapping", error))?;
        match (mapping, request.task_list_id) {
            (Some(_), None) if request.delete_remote => {
                sqlx::query(
                    "UPDATE google_task_outbox SET completed_at_utc = ?, last_error_category = NULL WHERE ticket_id = ? AND completed_at_utc IS NULL",
                )
                .bind(&now)
                .bind(request.ticket_id.to_string())
                .execute(&mut *transaction)
                .await
                .map_err(|error| AppError::database("ticket-task-delete-old-outbox", error))?;
                insert_task_outbox(
                    &mut transaction,
                    request.operation_id,
                    request.ticket_id,
                    "delete",
                    ticket.version,
                    None,
                    &now,
                )
                .await?;
            }
            (Some(_), None) => {
                sqlx::query("DELETE FROM google_task_mappings WHERE ticket_id = ?")
                    .bind(request.ticket_id.to_string())
                    .execute(&mut *transaction)
                    .await
                    .map_err(|error| AppError::database("ticket-task-detach", error))?;
                sqlx::query(
                    "UPDATE google_task_outbox SET completed_at_utc = ?, last_error_category = NULL WHERE ticket_id = ? AND completed_at_utc IS NULL",
                )
                .bind(&now)
                .bind(request.ticket_id.to_string())
                .execute(&mut *transaction)
                .await
                .map_err(|error| AppError::database("ticket-task-detach-outbox", error))?;
            }
            (Some(mapping), Some(target)) => {
                let current =
                    parse_uuid(mapping.get("google_task_list_id"), "task-target-current")?;
                validate_selected_task_list(&mut transaction, target).await?;
                if current != target {
                    insert_task_outbox(
                        &mut transaction,
                        request.operation_id,
                        request.ticket_id,
                        "move",
                        ticket.version,
                        Some(target),
                        &now,
                    )
                    .await?;
                }
            }
            (None, Some(target)) => {
                validate_selected_task_list(&mut transaction, target).await?;
                insert_task_outbox(
                    &mut transaction,
                    request.operation_id,
                    request.ticket_id,
                    "create",
                    ticket.version,
                    Some(target),
                    &now,
                )
                .await?;
            }
            (None, None) => {}
        }
        transaction
            .commit()
            .await
            .map_err(|error| AppError::database("ticket-task-target-commit", error))?;
        self.ticket_google_task_statuses(&[request.ticket_id])
            .await?
            .into_iter()
            .next()
            .ok_or_else(|| AppError::database("ticket-task-target-result", "missing"))
    }
}

pub(crate) async fn enqueue_ticket_task_outbox(
    transaction: &mut Transaction<'_, Sqlite>,
    operation_id: Uuid,
    ticket_id: Uuid,
    operation: &str,
    entity_version: u64,
    now: &str,
) -> AppResult<()> {
    let enabled: bool =
        sqlx::query_scalar("SELECT enabled FROM google_tasks_config WHERE singleton = 1")
            .fetch_one(&mut **transaction)
            .await
            .map_err(|error| AppError::database("ticket-task-enabled", error))?;
    if !enabled {
        return Ok(());
    }
    let mapping =
        sqlx::query("SELECT google_task_list_id FROM google_task_mappings WHERE ticket_id = ?")
            .bind(ticket_id.to_string())
            .fetch_optional(&mut **transaction)
            .await
            .map_err(|error| AppError::database("ticket-task-enqueue-mapping", error))?;
    let target = if let Some(mapping) = &mapping {
        Some(parse_uuid(
            mapping.get("google_task_list_id"),
            "ticket-task-enqueue-list",
        )?)
    } else {
        sqlx::query_scalar::<_, String>(
            "SELECT id FROM google_task_lists WHERE default_write_target = 1 AND selected = 1",
        )
        .fetch_optional(&mut **transaction)
        .await
        .map_err(|error| AppError::database("ticket-task-default-list", error))?
        .map(|value| parse_uuid(&value, "ticket-task-default-list-id"))
        .transpose()?
    };
    let Some(target) = target else {
        return Ok(());
    };
    let mapped = mapping.is_some();
    let remote_operation = match operation {
        "create" if !mapped => "create",
        "delete" if mapped => "delete",
        "delete" => return Ok(()),
        "complete" if mapped => "complete",
        "reopen" if mapped => "reopen",
        "parent" if mapped => "move",
        _ if mapped => "update",
        _ => "create",
    };
    insert_task_outbox(
        transaction,
        operation_id,
        ticket_id,
        remote_operation,
        entity_version,
        Some(target),
        now,
    )
    .await
}

async fn insert_task_outbox(
    transaction: &mut Transaction<'_, Sqlite>,
    operation_id: Uuid,
    ticket_id: Uuid,
    operation: &str,
    entity_version: u64,
    target: Option<Uuid>,
    now: &str,
) -> AppResult<()> {
    let idempotency_key = format!("google-task:{ticket_id}:{entity_version}:{operation}");
    sqlx::query(
        "INSERT OR IGNORE INTO google_task_outbox(id, operation_id, ticket_id, operation_type, entity_version, target_list_id, idempotency_key, attempt_count, next_attempt_at_utc, created_at_utc) VALUES (?, ?, ?, ?, ?, ?, ?, 0, ?, ?)",
    )
    .bind(Uuid::new_v4().to_string())
    .bind(operation_id.to_string())
    .bind(ticket_id.to_string())
    .bind(operation)
    .bind(i64::try_from(entity_version).unwrap_or(i64::MAX))
    .bind(target.map(|value| value.to_string()))
    .bind(idempotency_key)
    .bind(now)
    .bind(now)
    .execute(&mut **transaction)
    .await
    .map_err(|error| AppError::database("ticket-task-outbox-insert", error))?;
    Ok(())
}

async fn validate_selected_task_list(
    transaction: &mut Transaction<'_, Sqlite>,
    list_id: Uuid,
) -> AppResult<()> {
    let selected: Option<bool> =
        sqlx::query_scalar("SELECT selected FROM google_task_lists WHERE id = ?")
            .bind(list_id.to_string())
            .fetch_optional(&mut **transaction)
            .await
            .map_err(|error| AppError::database("task-target-list", error))?;
    match selected {
        Some(true) => Ok(()),
        Some(false) => Err(validation(
            "同期対象外のGoogle Task Listです。",
            "設定で同期対象にしてから選択してください。",
        )),
        None => Err(not_found("Google Task Listが見つかりません。")),
    }
}

fn task_list_from_row(row: &SqliteRow) -> AppResult<GoogleTaskList> {
    Ok(GoogleTaskList {
        id: parse_uuid(row.get("id"), "google-task-list-id")?,
        display_name: row.get("display_name"),
        selected: row.get("selected"),
        default_write_target: row.get("default_write_target"),
        sync_state: row.get("sync_state"),
        last_success_at: parse_optional_datetime(
            row.get("last_success_at_utc"),
            "google-task-list-success",
        )?,
        next_retry_at: parse_optional_datetime(
            row.get("next_retry_at_utc"),
            "google-task-list-retry",
        )?,
        last_error_category: row.get("last_error_category"),
    })
}

fn conflict_from_row(row: &SqliteRow) -> AppResult<GoogleTaskConflict> {
    Ok(GoogleTaskConflict {
        id: parse_uuid(row.get("id"), "google-task-conflict-id")?,
        ticket_id: parse_uuid(row.get("ticket_id"), "google-task-conflict-ticket")?,
        ticket_title: row.get("title"),
        field_name: row.get("field_name"),
        base_value: decode_json(row.get("base_value_json"), "google-task-conflict-base")?,
        local_value: decode_json(row.get("local_value_json"), "google-task-conflict-local")?,
        google_value: decode_json(row.get("remote_value_json"), "google-task-conflict-remote")?,
        conflict_type: row.get("conflict_type"),
        detected_at: parse_datetime(row.get("detected_at_utc"), "google-task-conflict-time")?,
    })
}

fn decode_json(value: &str, context: &'static str) -> AppResult<serde_json::Value> {
    serde_json::from_str(value).map_err(|error| AppError::database(context, error))
}

fn parse_uuid(value: &str, context: &'static str) -> AppResult<Uuid> {
    Uuid::parse_str(value).map_err(|error| AppError::database(context, error))
}

fn parse_datetime(value: &str, context: &'static str) -> AppResult<DateTime<Utc>> {
    DateTime::parse_from_rfc3339(value)
        .map(|value| value.with_timezone(&Utc))
        .map_err(|error| AppError::database(context, error))
}

fn parse_optional_datetime(
    value: Option<&str>,
    context: &'static str,
) -> AppResult<Option<DateTime<Utc>>> {
    value
        .map(|value| parse_datetime(value, context))
        .transpose()
}

fn timestamp(value: DateTime<Utc>) -> String {
    value.to_rfc3339_opts(SecondsFormat::Millis, true)
}

fn nonnegative_count(value: i64) -> u64 {
    value.max(0) as u64
}

fn validation(message: &str, recovery: &str) -> AppError {
    AppError::Validation {
        message: message.into(),
        recovery: recovery.into(),
    }
}

fn not_found(message: &str) -> AppError {
    AppError::NotFound {
        message: message.into(),
        recovery: "一覧を更新して、もう一度選択してください。".into(),
    }
}

#[cfg(test)]
mod tests {
    use super::*;
    use crate::{
        domain::google_tasks::GOOGLE_TASK_NOTES_MAX_CHARS,
        domain::{TicketDraft, TicketPriority},
        infrastructure::ticket_repository::{DEFAULT_TICKET_BOARD_ID, INBOX_TICKET_COLUMN_ID},
    };
    use tokio::io::{AsyncReadExt, AsyncWriteExt};

    async fn seed_tasks(database: &Database, watermark: Option<&str>) -> (Uuid, Uuid) {
        let account_id = Uuid::new_v4();
        let list_id = Uuid::new_v4();
        let now = timestamp(Utc::now());
        sqlx::query(
            "INSERT INTO google_accounts(id, display_label, scopes_json, status, created_at_utc, updated_at_utc) VALUES (?, 'Synthetic Google', ?, 'connected', ?, ?)",
        )
        .bind(account_id.to_string())
        .bind(serde_json::json!([TASKS_SCOPE]).to_string())
        .bind(&now)
        .bind(&now)
        .execute(&database.pool)
        .await
        .unwrap();
        sqlx::query(
            "INSERT INTO google_task_lists(id, google_account_id, remote_list_id, display_name, selected, default_write_target, sync_state, incremental_watermark_utc, last_full_sync_at_utc, created_at_utc, updated_at_utc) VALUES (?, ?, 'synthetic-list', 'Synthetic list', 1, 1, 'never', ?, ?, ?, ?)",
        )
        .bind(list_id.to_string())
        .bind(account_id.to_string())
        .bind(watermark)
        .bind(watermark)
        .bind(&now)
        .bind(&now)
        .execute(&database.pool)
        .await
        .unwrap();
        sqlx::query("UPDATE google_tasks_config SET enabled = 1 WHERE singleton = 1")
            .execute(&database.pool)
            .await
            .unwrap();
        (account_id, list_id)
    }

    fn ticket_draft(title: &str) -> TicketDraft {
        TicketDraft {
            board_id: DEFAULT_TICKET_BOARD_ID,
            column_id: INBOX_TICKET_COLUMN_ID,
            parent_ticket_id: None,
            title: title.into(),
            description: "synthetic notes".into(),
            priority: TicketPriority::High,
            due_date: NaiveDate::from_ymd_opt(2026, 8, 5),
            estimate_minutes: Some(45),
            tags: vec!["local-only".into()],
            checklist: Vec::new(),
        }
    }

    fn remote_task(id: &str, title: &str) -> RemoteTask {
        RemoteTask {
            id: id.into(),
            etag: format!("etag-{id}"),
            title: title.into(),
            notes: "synthetic notes".into(),
            status: "needsAction".into(),
            due: Some("2026-08-05T00:00:00.000Z".into()),
            completed: None,
            deleted: false,
            hidden: false,
            parent: None,
            position: "1".into(),
            updated: "2026-08-03T00:00:00Z".into(),
            assignment_info: None,
        }
    }

    async fn serve(
        responses: Vec<(&'static str, String)>,
    ) -> (String, tokio::task::JoinHandle<Vec<String>>) {
        let listener = tokio::net::TcpListener::bind("127.0.0.1:0").await.unwrap();
        let address = listener.local_addr().unwrap();
        let handle = tokio::spawn(async move {
            let mut requests = Vec::new();
            for (status, body) in responses {
                let (mut stream, _) = listener.accept().await.unwrap();
                let mut buffer = vec![0_u8; 16_384];
                let count = stream.read(&mut buffer).await.unwrap();
                requests.push(String::from_utf8_lossy(&buffer[..count]).into_owned());
                let reply = format!(
                    "HTTP/1.1 {status}\r\nContent-Type: application/json\r\nContent-Length: {}\r\nConnection: close\r\n\r\n{body}",
                    body.len()
                );
                stream.write_all(reply.as_bytes()).await.unwrap();
            }
            requests
        });
        (format!("http://{address}/"), handle)
    }

    #[tokio::test]
    async fn migration_17_installs_tasks_tables_without_remote_content_in_diagnostics() {
        let database = Database::open_memory().await.unwrap();
        let version: String =
            sqlx::query_scalar("SELECT value FROM app_meta WHERE key = 'schema_version'")
                .fetch_one(&database.pool)
                .await
                .unwrap();
        assert_eq!(version, "17");
        for table in [
            "google_tasks_config",
            "google_task_lists",
            "google_task_mappings",
            "google_task_remote_shadows",
            "google_task_outbox",
            "google_task_conflicts",
        ] {
            let exists: bool = sqlx::query_scalar(
                "SELECT EXISTS(SELECT 1 FROM sqlite_master WHERE type = 'table' AND name = ?)",
            )
            .bind(table)
            .fetch_one(&database.pool)
            .await
            .unwrap();
            assert!(exists, "missing {table}");
        }
    }

    #[tokio::test]
    async fn ticket_create_and_tasks_outbox_commit_together_and_keep_local_only_fields() {
        let database = Database::open_memory().await.unwrap();
        seed_tasks(&database, None).await;
        let ticket = database
            .create_ticket(Uuid::new_v4(), ticket_draft("Atomic task"), Utc::now())
            .await
            .unwrap();
        let pending: i64 = sqlx::query_scalar(
            "SELECT COUNT(*) FROM google_task_outbox WHERE ticket_id = ? AND operation_type = 'create' AND completed_at_utc IS NULL",
        )
        .bind(ticket.id.to_string())
        .fetch_one(&database.pool)
        .await
        .unwrap();
        assert_eq!(pending, 1);
        assert_eq!(ticket.priority, TicketPriority::High);
        assert_eq!(ticket.estimate_minutes, Some(45));
        assert_eq!(ticket.tags[0].name, "local-only");
    }

    #[tokio::test]
    async fn five_hundred_ticket_creates_keep_history_and_tasks_outbox_complete() {
        let database = Database::open_memory().await.unwrap();
        seed_tasks(&database, None).await;
        let now = Utc::now();

        for index in 0..500 {
            database
                .create_ticket(
                    Uuid::new_v4(),
                    ticket_draft(&format!("Scale task {index:03}")),
                    now,
                )
                .await
                .unwrap();
        }

        let tickets: i64 = sqlx::query_scalar("SELECT COUNT(*) FROM tickets")
            .fetch_one(&database.pool)
            .await
            .unwrap();
        let histories: i64 = sqlx::query_scalar(
            "SELECT COUNT(*) FROM ticket_change_history WHERE action = 'create'",
        )
        .fetch_one(&database.pool)
        .await
        .unwrap();
        let pending_outbox: i64 = sqlx::query_scalar(
            "SELECT COUNT(*) FROM google_task_outbox WHERE operation_type = 'create' AND completed_at_utc IS NULL",
        )
        .fetch_one(&database.pool)
        .await
        .unwrap();
        let distinct_outbox_tickets: i64 = sqlx::query_scalar(
            "SELECT COUNT(DISTINCT ticket_id) FROM google_task_outbox WHERE operation_type = 'create' AND completed_at_utc IS NULL",
        )
        .fetch_one(&database.pool)
        .await
        .unwrap();

        assert_eq!(tickets, 500);
        assert_eq!(histories, 500);
        assert_eq!(pending_outbox, 500);
        assert_eq!(distinct_outbox_tickets, 500);
    }

    #[tokio::test]
    async fn two_pages_are_applied_only_after_all_pages_succeed() {
        let database = Database::open_memory().await.unwrap();
        let (_, list_id) = seed_tasks(&database, None).await;
        let first = serde_json::json!({
            "items": [{"id":"remote-1","title":"First","status":"needsAction","position":"1","updated":"2026-08-03T00:00:00Z"}],
            "nextPageToken": "page-2"
        });
        let second = serde_json::json!({
            "items": [{"id":"remote-2","title":"Second","status":"completed","position":"2","updated":"2026-08-03T00:01:00Z"}]
        });
        let (root, server) = serve(vec![
            ("200 OK", first.to_string()),
            ("200 OK", second.to_string()),
        ])
        .await;
        pull_selected_task_lists_at(
            &database,
            &Client::new(),
            "synthetic-token",
            &root,
            true,
            &OperationCancellation::default(),
        )
        .await
        .unwrap();
        let requests = server.await.unwrap();
        assert!(requests[0].contains("maxResults=100"));
        assert!(requests[0].contains("showCompleted=true"));
        assert!(requests[0].contains("showHidden=true"));
        assert!(requests[0].contains("showDeleted=true"));
        assert!(requests[1].contains("pageToken=page-2"));
        let mappings: i64 = sqlx::query_scalar(
            "SELECT COUNT(*) FROM google_task_mappings WHERE google_task_list_id = ?",
        )
        .bind(list_id.to_string())
        .fetch_one(&database.pool)
        .await
        .unwrap();
        assert_eq!(mappings, 2);
        let completed_column: String =
            sqlx::query_scalar("SELECT column_id FROM tickets WHERE title = 'Second'")
                .fetch_one(&database.pool)
                .await
                .unwrap();
        assert_ne!(completed_column, INBOX_TICKET_COLUMN_ID.to_string());
    }

    #[tokio::test]
    async fn failed_later_page_does_not_advance_watermark_or_apply_first_page() {
        let database = Database::open_memory().await.unwrap();
        let watermark = "2026-08-02T00:00:00.000Z";
        let (_, list_id) = seed_tasks(&database, Some(watermark)).await;
        let first = serde_json::json!({
            "items": [{"id":"remote-1","title":"Not committed","status":"needsAction","position":"1","updated":"2026-08-03T00:00:00Z"}],
            "nextPageToken": "page-2"
        });
        let (root, server) = serve(vec![
            ("200 OK", first.to_string()),
            ("500 Internal Server Error", "{}".into()),
        ])
        .await;
        let result = pull_selected_task_lists_at(
            &database,
            &Client::new(),
            "synthetic-token",
            &root,
            false,
            &OperationCancellation::default(),
        )
        .await;
        assert!(result.is_err());
        server.await.unwrap();
        let saved: String = sqlx::query_scalar(
            "SELECT incremental_watermark_utc FROM google_task_lists WHERE id = ?",
        )
        .bind(list_id.to_string())
        .fetch_one(&database.pool)
        .await
        .unwrap();
        assert_eq!(saved, watermark);
        let tickets: i64 = sqlx::query_scalar("SELECT COUNT(*) FROM tickets")
            .fetch_one(&database.pool)
            .await
            .unwrap();
        assert_eq!(tickets, 0);
    }

    #[tokio::test]
    async fn malformed_remote_is_preserved_as_local_shadow_without_advancing_sync() {
        let database = Database::open_memory().await.unwrap();
        let (_, list_id) = seed_tasks(&database, None).await;
        let task = RemoteTask {
            id: "remote-too-long".into(),
            etag: String::new(),
            title: "x".repeat(1_025),
            notes: String::new(),
            status: "needsAction".into(),
            due: None,
            completed: None,
            deleted: false,
            hidden: false,
            parent: None,
            position: "1".into(),
            updated: "2026-08-03T00:00:00Z".into(),
            assignment_info: None,
        };
        assert!(validate_remote_task(&task).is_err());
        preserve_malformed_remote_shadow(&database, list_id, &task)
            .await
            .unwrap();
        let payload: String = sqlx::query_scalar(
            "SELECT payload_json FROM google_task_remote_shadows WHERE google_task_list_id = ? AND remote_task_id = ?",
        )
        .bind(list_id.to_string())
        .bind(&task.id)
        .fetch_one(&database.pool)
        .await
        .unwrap();
        assert!(payload.contains(&"x".repeat(1_025)));
    }

    #[test]
    fn minimal_deleted_task_is_accepted_for_tombstone_processing() {
        let mut task = remote_task("deleted-task", "unused");
        task.deleted = true;
        task.title.clear();
        task.notes.clear();
        task.status.clear();
        assert!(validate_remote_task(&task).is_ok());
    }

    #[tokio::test]
    async fn parent_is_inserted_before_child_even_when_remote_order_is_reversed() {
        let database = Database::open_memory().await.unwrap();
        let (_, list_id) = seed_tasks(&database, None).await;
        let parent = remote_task("parent", "Parent");
        let mut child = remote_task("child", "Child");
        child.parent = Some("parent".into());
        let list = StoredTaskList {
            id: list_id,
            remote_id: "synthetic-list".into(),
            watermark: None,
            last_full_sync: None,
        };
        apply_remote_tasks(&database, &list, &[child, parent], true, Utc::now())
            .await
            .unwrap();
        let parent_title: String = sqlx::query_scalar(
            "SELECT p.title FROM tickets c JOIN tickets p ON p.id = c.parent_ticket_id WHERE c.title = 'Child'",
        )
        .fetch_one(&database.pool)
        .await
        .unwrap();
        assert_eq!(parent_title, "Parent");
    }

    #[tokio::test]
    async fn remote_field_update_preserves_priority_estimate_and_tags() {
        let database = Database::open_memory().await.unwrap();
        let (_, list_id) = seed_tasks(&database, None).await;
        let ticket = database
            .create_ticket(Uuid::new_v4(), ticket_draft("Mapped local"), Utc::now())
            .await
            .unwrap();
        let base = GoogleTaskSnapshot {
            title: ticket.title.clone(),
            notes: ticket.description.clone(),
            due_date: ticket.due_date,
            completed: false,
            parent_ticket_id: None,
            task_list_id: list_id,
        };
        let now = timestamp(Utc::now());
        sqlx::query(
            "INSERT INTO google_task_mappings(ticket_id, google_task_list_id, remote_task_id, base_snapshot_json, created_at_utc, updated_at_utc) VALUES (?, ?, 'mapped-remote', ?, ?, ?)",
        )
        .bind(ticket.id.to_string())
        .bind(list_id.to_string())
        .bind(serde_json::to_string(&base).unwrap())
        .bind(&now)
        .bind(&now)
        .execute(&database.pool)
        .await
        .unwrap();
        let mut remote = remote_task("mapped-remote", "Mapped local");
        remote.notes = "changed only in Google".into();
        let list = StoredTaskList {
            id: list_id,
            remote_id: "synthetic-list".into(),
            watermark: None,
            last_full_sync: None,
        };
        apply_remote_tasks(&database, &list, &[remote], false, Utc::now())
            .await
            .unwrap();
        let updated = database.ticket(ticket.id).await.unwrap();
        assert_eq!(updated.description, "changed only in Google");
        assert_eq!(updated.priority, TicketPriority::High);
        assert_eq!(updated.estimate_minutes, Some(45));
        assert_eq!(updated.tags[0].name, "local-only");
    }

    #[test]
    fn push_validation_rejects_overlong_notes_without_truncation() {
        let snapshot = GoogleTaskSnapshot {
            title: "valid".into(),
            notes: "界".repeat(GOOGLE_TASK_NOTES_MAX_CHARS + 1),
            due_date: None,
            completed: false,
            parent_ticket_id: None,
            task_list_id: Uuid::new_v4(),
        };
        assert!(snapshot.validate_for_push().is_err());
        assert_eq!(
            snapshot.notes.chars().count(),
            GOOGLE_TASK_NOTES_MAX_CHARS + 1
        );
    }

    #[tokio::test]
    async fn background_polling_is_due_for_pending_outbox_and_not_due_after_success() {
        let database = Database::open_memory().await.unwrap();
        let now = Utc::now();
        let (_, list_id) = seed_tasks(&database, Some(&timestamp(now))).await;
        sqlx::query(
            "UPDATE google_task_lists SET last_success_at_utc = ?, last_full_sync_at_utc = ? WHERE id = ?",
        )
        .bind(timestamp(now))
        .bind(timestamp(now))
        .bind(list_id.to_string())
        .execute(&database.pool)
        .await
        .unwrap();
        assert!(!database.google_tasks_background_due(now).await.unwrap());
        database
            .create_ticket(Uuid::new_v4(), ticket_draft("Due now"), now)
            .await
            .unwrap();
        assert!(database.google_tasks_background_due(now).await.unwrap());
    }
}
