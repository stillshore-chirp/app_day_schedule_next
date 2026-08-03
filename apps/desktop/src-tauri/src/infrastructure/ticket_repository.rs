use chrono::{DateTime, NaiveDate, Utc};
use serde::Serialize;
use sqlx::{Row, Sqlite, Transaction, sqlite::SqliteRow};
use uuid::Uuid;

use crate::domain::{
    AppError, AppResult, Ticket, TicketBoard, TicketChecklistItem, TicketColumn, TicketColumnKind,
    TicketDraft, TicketHistoryItem, TicketPage, TicketPatch, TicketPriority, TicketQuery,
    TicketTag, rebalanced_sort_key, sort_key_between,
};

use super::Database;

pub const DEFAULT_TICKET_BOARD_ID: Uuid = Uuid::from_u128(0x00000000_0000_4000_8000_000000000100);
pub const INBOX_TICKET_COLUMN_ID: Uuid = Uuid::from_u128(0x00000000_0000_4000_8000_000000000101);
#[cfg(test)]
pub const DONE_TICKET_COLUMN_ID: Uuid = Uuid::from_u128(0x00000000_0000_4000_8000_000000000106);

impl Database {
    pub async fn ticket_board(&self, board_id: Uuid) -> AppResult<TicketBoard> {
        let row = sqlx::query("SELECT id, name, version FROM ticket_boards WHERE id = ?")
            .bind(board_id.to_string())
            .fetch_optional(&self.pool)
            .await
            .map_err(|error| AppError::database("ticket-board-read", error))?
            .ok_or_else(ticket_not_found)?;
        let column_rows = sqlx::query(
            "SELECT id, board_id, kind, name, sort_order, version FROM ticket_columns WHERE board_id = ? ORDER BY sort_order, id",
        )
        .bind(board_id.to_string())
        .fetch_all(&self.pool)
        .await
        .map_err(|error| AppError::database("ticket-columns-read", error))?;
        Ok(TicketBoard {
            id: parse_uuid(row.get("id"), "ticket-board-id")?,
            name: row.get("name"),
            version: parse_u64(row.get("version"), "ticket-board-version")?,
            columns: column_rows
                .iter()
                .map(ticket_column_from_row)
                .collect::<AppResult<Vec<_>>>()?,
        })
    }

    pub async fn default_ticket_board(&self) -> AppResult<TicketBoard> {
        self.ticket_board(DEFAULT_TICKET_BOARD_ID).await
    }

    pub async fn list_tickets(&self, mut query: TicketQuery) -> AppResult<TicketPage> {
        query.validate()?;
        let board_id = query.board_id.unwrap_or(DEFAULT_TICKET_BOARD_ID);
        let column_id = query.column_id.map(|id| id.to_string());
        let priority = query.priority.map(|priority| priority.as_str().to_owned());
        let search = query
            .search
            .map(|value| format!("%{}%", escape_like(&value)));
        let total: i64 = sqlx::query_scalar(
            "SELECT COUNT(*) FROM tickets
             WHERE board_id = ?
               AND (? IS NULL OR column_id = ?)
               AND (? IS NULL OR priority = ?)
               AND (? IS NULL OR title LIKE ? ESCAPE '\\' OR description LIKE ? ESCAPE '\\')
               AND (? = 1 OR archived_at_utc IS NULL)
               AND (? = 1 OR deleted_at_utc IS NULL)",
        )
        .bind(board_id.to_string())
        .bind(&column_id)
        .bind(&column_id)
        .bind(&priority)
        .bind(&priority)
        .bind(&search)
        .bind(&search)
        .bind(&search)
        .bind(query.include_archived)
        .bind(query.include_deleted)
        .fetch_one(&self.pool)
        .await
        .map_err(|error| AppError::database("ticket-list-count", error))?;
        let rows = sqlx::query(
            "SELECT * FROM tickets
             WHERE board_id = ?
               AND (? IS NULL OR column_id = ?)
               AND (? IS NULL OR priority = ?)
               AND (? IS NULL OR title LIKE ? ESCAPE '\\' OR description LIKE ? ESCAPE '\\')
               AND (? = 1 OR archived_at_utc IS NULL)
               AND (? = 1 OR deleted_at_utc IS NULL)
             ORDER BY column_id, sort_key, id LIMIT ? OFFSET ?",
        )
        .bind(board_id.to_string())
        .bind(&column_id)
        .bind(&column_id)
        .bind(&priority)
        .bind(&priority)
        .bind(&search)
        .bind(&search)
        .bind(&search)
        .bind(query.include_archived)
        .bind(query.include_deleted)
        .bind(i64::from(query.limit))
        .bind(i64::from(query.offset))
        .fetch_all(&self.pool)
        .await
        .map_err(|error| AppError::database("ticket-list", error))?;
        let mut items = Vec::with_capacity(rows.len());
        for row in rows {
            items.push(self.ticket_from_row(&row).await?);
        }
        Ok(TicketPage {
            contract_version: 1,
            items,
            total: total.max(0) as u64,
        })
    }

    pub async fn ticket(&self, id: Uuid) -> AppResult<Ticket> {
        let row = sqlx::query("SELECT * FROM tickets WHERE id = ?")
            .bind(id.to_string())
            .fetch_optional(&self.pool)
            .await
            .map_err(|error| AppError::database("ticket-read", error))?
            .ok_or_else(ticket_not_found)?;
        self.ticket_from_row(&row).await
    }

    pub async fn create_ticket(
        &self,
        operation_id: Uuid,
        mut draft: TicketDraft,
        now: DateTime<Utc>,
    ) -> AppResult<Ticket> {
        draft.validate()?;
        if let Some(existing_id) = self.ticket_id_for_operation(operation_id).await? {
            return self.ticket(existing_id).await;
        }
        let id = Uuid::new_v4();
        let now_text = timestamp(now);
        let mut transaction = self.begin_ticket_transaction("ticket-create-begin").await?;
        validate_board_column(&mut transaction, draft.board_id, draft.column_id).await?;
        validate_parent(&mut transaction, id, draft.board_id, draft.parent_ticket_id).await?;
        let sort_key: i64 = sqlx::query_scalar(
            "SELECT COALESCE(MAX(sort_key), 0) + 1024 FROM tickets WHERE column_id = ? AND deleted_at_utc IS NULL",
        )
        .bind(draft.column_id.to_string())
        .fetch_one(&mut *transaction)
        .await
        .map_err(|error| AppError::database("ticket-create-sort", error))?;
        let target_kind = column_kind(&mut transaction, draft.column_id).await?;
        let completed_at = target_kind.is_done().then(|| now_text.clone());
        sqlx::query(
            "INSERT INTO tickets(id, board_id, column_id, last_non_done_column_id, parent_ticket_id, title, description, priority, due_date, estimate_minutes, sort_key, version, completed_at_utc, archived_at_utc, deleted_at_utc, created_at_utc, updated_at_utc)
             VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, 0, ?, NULL, NULL, ?, ?)",
        )
        .bind(id.to_string())
        .bind(draft.board_id.to_string())
        .bind(draft.column_id.to_string())
        .bind((!target_kind.is_done()).then(|| draft.column_id.to_string()))
        .bind(draft.parent_ticket_id.map(|value| value.to_string()))
        .bind(&draft.title)
        .bind(&draft.description)
        .bind(draft.priority.as_str())
        .bind(draft.due_date.map(|value| value.to_string()))
        .bind(draft.estimate_minutes.map(i64::from))
        .bind(sort_key)
        .bind(completed_at)
        .bind(&now_text)
        .bind(&now_text)
        .execute(&mut *transaction)
        .await
        .map_err(|error| AppError::database("ticket-create", error))?;
        replace_ticket_relations(&mut transaction, id, &draft, &now_text, true, true).await?;
        record_history(
            &mut transaction,
            HistoryWrite {
                action_id: operation_id,
                ticket_id: id,
                action: "create",
                version: 0,
                before: Option::<&Ticket>::None,
                after: Some(&draft),
                now: &now_text,
            },
        )
        .await?;
        transaction
            .commit()
            .await
            .map_err(|error| AppError::database("ticket-create-commit", error))?;
        self.ticket(id).await
    }

    pub async fn update_ticket(
        &self,
        operation_id: Uuid,
        id: Uuid,
        expected_version: u64,
        patch: TicketPatch,
        now: DateTime<Utc>,
    ) -> AppResult<Ticket> {
        if let Some(existing_id) = self.ticket_id_for_operation(operation_id).await? {
            if existing_id != id {
                return Err(operation_conflict());
            }
            return self.ticket(existing_id).await;
        }
        let before = self.ticket(id).await?;
        ensure_version(&before, expected_version)?;
        ensure_mutable(&before)?;
        let replace_tags = patch.tags.is_some();
        let replace_checklist = patch.checklist.is_some();
        let mut draft = draft_from_ticket(&before);
        apply_patch(&mut draft, patch);
        draft.validate()?;
        let now_text = timestamp(now);
        let mut transaction = self.begin_ticket_transaction("ticket-update-begin").await?;
        validate_parent(
            &mut transaction,
            id,
            before.board_id,
            draft.parent_ticket_id,
        )
        .await?;
        let result = sqlx::query(
            "UPDATE tickets SET parent_ticket_id = ?, title = ?, description = ?, priority = ?, due_date = ?, estimate_minutes = ?, version = version + 1, updated_at_utc = ? WHERE id = ? AND version = ? AND deleted_at_utc IS NULL",
        )
        .bind(draft.parent_ticket_id.map(|value| value.to_string()))
        .bind(&draft.title)
        .bind(&draft.description)
        .bind(draft.priority.as_str())
        .bind(draft.due_date.map(|value| value.to_string()))
        .bind(draft.estimate_minutes.map(i64::from))
        .bind(&now_text)
        .bind(id.to_string())
        .bind(i64::try_from(expected_version).unwrap_or(i64::MAX))
        .execute(&mut *transaction)
        .await
        .map_err(|error| AppError::database("ticket-update", error))?;
        if result.rows_affected() != 1 {
            return Err(version_conflict());
        }
        replace_ticket_relations(
            &mut transaction,
            id,
            &draft,
            &now_text,
            replace_tags,
            replace_checklist,
        )
        .await?;
        record_history(
            &mut transaction,
            HistoryWrite {
                action_id: operation_id,
                ticket_id: id,
                action: if before.parent_ticket_id != draft.parent_ticket_id {
                    "parent"
                } else {
                    "update"
                },
                version: expected_version + 1,
                before: Some(&before),
                after: Some(&draft),
                now: &now_text,
            },
        )
        .await?;
        transaction
            .commit()
            .await
            .map_err(|error| AppError::database("ticket-update-commit", error))?;
        self.ticket(id).await
    }

    pub async fn move_ticket(
        &self,
        operation_id: Uuid,
        id: Uuid,
        expected_version: u64,
        target_column_id: Uuid,
        before_ticket_id: Option<Uuid>,
        now: DateTime<Utc>,
    ) -> AppResult<Ticket> {
        if let Some(existing_id) = self.ticket_id_for_operation(operation_id).await? {
            if existing_id != id {
                return Err(operation_conflict());
            }
            return self.ticket(existing_id).await;
        }
        let before = self.ticket(id).await?;
        ensure_version(&before, expected_version)?;
        ensure_mutable(&before)?;
        let now_text = timestamp(now);
        let mut transaction = self.begin_ticket_transaction("ticket-move-begin").await?;
        validate_board_column(&mut transaction, before.board_id, target_column_id).await?;
        let target_kind = column_kind(&mut transaction, target_column_id).await?;
        let current_kind = column_kind(&mut transaction, before.column_id).await?;
        let sort_key =
            target_sort_key(&mut transaction, id, target_column_id, before_ticket_id).await?;
        let last_non_done_column_id = if target_kind.is_done() {
            if current_kind.is_done() {
                before.last_non_done_column_id
            } else {
                Some(before.column_id)
            }
        } else {
            Some(target_column_id)
        };
        let completed_at = if target_kind.is_done() {
            before.completed_at.or(Some(now))
        } else {
            None
        };
        let result = sqlx::query(
            "UPDATE tickets SET column_id = ?, last_non_done_column_id = ?, sort_key = ?, completed_at_utc = ?, version = version + 1, updated_at_utc = ? WHERE id = ? AND version = ? AND deleted_at_utc IS NULL",
        )
        .bind(target_column_id.to_string())
        .bind(last_non_done_column_id.map(|value| value.to_string()))
        .bind(sort_key)
        .bind(completed_at.map(timestamp))
        .bind(&now_text)
        .bind(id.to_string())
        .bind(i64::try_from(expected_version).unwrap_or(i64::MAX))
        .execute(&mut *transaction)
        .await
        .map_err(|error| AppError::database("ticket-move", error))?;
        if result.rows_affected() != 1 {
            return Err(version_conflict());
        }
        let action = match (current_kind.is_done(), target_kind.is_done()) {
            (false, true) => "complete",
            (true, false) => "reopen",
            _ if before.column_id == target_column_id => "reorder",
            _ => "move",
        };
        record_history(
            &mut transaction,
            HistoryWrite {
                action_id: operation_id,
                ticket_id: id,
                action,
                version: expected_version + 1,
                before: Some(&before),
                after: Some(&target_column_id),
                now: &now_text,
            },
        )
        .await?;
        transaction
            .commit()
            .await
            .map_err(|error| AppError::database("ticket-move-commit", error))?;
        self.ticket(id).await
    }

    pub async fn reopen_ticket(
        &self,
        operation_id: Uuid,
        id: Uuid,
        expected_version: u64,
        now: DateTime<Utc>,
    ) -> AppResult<Ticket> {
        let ticket = self.ticket(id).await?;
        let target = match ticket.last_non_done_column_id {
            Some(column_id) if self.column_exists(ticket.board_id, column_id).await? => column_id,
            _ => INBOX_TICKET_COLUMN_ID,
        };
        self.move_ticket(operation_id, id, expected_version, target, None, now)
            .await
    }

    pub async fn set_ticket_archived(
        &self,
        operation_id: Uuid,
        id: Uuid,
        expected_version: u64,
        archived: bool,
        now: DateTime<Utc>,
    ) -> AppResult<Ticket> {
        self.set_ticket_lifecycle(
            operation_id,
            id,
            expected_version,
            TicketLifecycleChange::Archived(if archived { Some(now) } else { None }),
            now,
        )
        .await
    }

    pub async fn delete_ticket(
        &self,
        operation_id: Uuid,
        id: Uuid,
        expected_version: u64,
        now: DateTime<Utc>,
    ) -> AppResult<Ticket> {
        self.set_ticket_lifecycle(
            operation_id,
            id,
            expected_version,
            TicketLifecycleChange::Deleted(now),
            now,
        )
        .await
    }

    async fn set_ticket_lifecycle(
        &self,
        operation_id: Uuid,
        id: Uuid,
        expected_version: u64,
        change: TicketLifecycleChange,
        now: DateTime<Utc>,
    ) -> AppResult<Ticket> {
        if let Some(existing_id) = self.ticket_id_for_operation(operation_id).await? {
            if existing_id != id {
                return Err(operation_conflict());
            }
            return self.ticket(existing_id).await;
        }
        let before = self.ticket(id).await?;
        ensure_version(&before, expected_version)?;
        if !matches!(change, TicketLifecycleChange::Deleted(_)) {
            ensure_mutable(&before)?;
        }
        let now_text = timestamp(now);
        let (action, value, deleted) = match change {
            TicketLifecycleChange::Archived(Some(value)) => ("archive", Some(value), false),
            TicketLifecycleChange::Archived(None) => ("restore", None, false),
            TicketLifecycleChange::Deleted(value) => ("delete", Some(value), true),
        };
        let value_text = value.map(timestamp);
        let mut transaction = self
            .begin_ticket_transaction("ticket-lifecycle-begin")
            .await?;
        let statement = if deleted {
            "UPDATE tickets SET deleted_at_utc = ?, version = version + 1, updated_at_utc = ? WHERE id = ? AND version = ? AND deleted_at_utc IS NULL"
        } else {
            "UPDATE tickets SET archived_at_utc = ?, version = version + 1, updated_at_utc = ? WHERE id = ? AND version = ? AND deleted_at_utc IS NULL"
        };
        let result = sqlx::query(statement)
            .bind(value_text)
            .bind(&now_text)
            .bind(id.to_string())
            .bind(i64::try_from(expected_version).unwrap_or(i64::MAX))
            .execute(&mut *transaction)
            .await
            .map_err(|error| AppError::database("ticket-lifecycle-update", error))?;
        if result.rows_affected() != 1 {
            return Err(version_conflict());
        }
        record_history(
            &mut transaction,
            HistoryWrite {
                action_id: operation_id,
                ticket_id: id,
                action,
                version: expected_version + 1,
                before: Some(&before),
                after: Some(&value),
                now: &now_text,
            },
        )
        .await?;
        transaction
            .commit()
            .await
            .map_err(|error| AppError::database("ticket-lifecycle-commit", error))?;
        self.ticket(id).await
    }

    pub async fn ticket_history(
        &self,
        ticket_id: Uuid,
        limit: u32,
    ) -> AppResult<Vec<TicketHistoryItem>> {
        let rows = sqlx::query(
            "SELECT id, action_id, action, entity_version, created_at_utc FROM ticket_change_history WHERE ticket_id = ? ORDER BY id DESC LIMIT ?",
        )
        .bind(ticket_id.to_string())
        .bind(i64::from(limit.clamp(1, 500)))
        .fetch_all(&self.pool)
        .await
        .map_err(|error| AppError::database("ticket-history-list", error))?;
        rows.iter()
            .map(|row| {
                Ok(TicketHistoryItem {
                    id: row.get("id"),
                    action_id: parse_uuid(row.get("action_id"), "ticket-history-action")?,
                    action: row.get("action"),
                    version: parse_u64(row.get("entity_version"), "ticket-history-version")?,
                    created_at: parse_datetime(row.get("created_at_utc"), "ticket-history-time")?,
                })
            })
            .collect()
    }

    async fn ticket_id_for_operation(&self, operation_id: Uuid) -> AppResult<Option<Uuid>> {
        let value: Option<String> = sqlx::query_scalar(
            "SELECT ticket_id FROM ticket_change_history WHERE action_id = ? ORDER BY id LIMIT 1",
        )
        .bind(operation_id.to_string())
        .fetch_optional(&self.pool)
        .await
        .map_err(|error| AppError::database("ticket-operation-read", error))?;
        value
            .map(|value| parse_uuid(&value, "ticket-operation-id"))
            .transpose()
    }

    async fn column_exists(&self, board_id: Uuid, column_id: Uuid) -> AppResult<bool> {
        let count: i64 =
            sqlx::query_scalar("SELECT COUNT(*) FROM ticket_columns WHERE id = ? AND board_id = ?")
                .bind(column_id.to_string())
                .bind(board_id.to_string())
                .fetch_one(&self.pool)
                .await
                .map_err(|error| AppError::database("ticket-column-exists", error))?;
        Ok(count == 1)
    }

    async fn ticket_from_row(&self, row: &SqliteRow) -> AppResult<Ticket> {
        let id = parse_uuid(row.get("id"), "ticket-id")?;
        let tags = sqlx::query(
            "SELECT tag.id, tag.name FROM ticket_tag_links link JOIN ticket_tags tag ON tag.id = link.tag_id WHERE link.ticket_id = ? ORDER BY link.sort_order",
        )
        .bind(id.to_string())
        .fetch_all(&self.pool)
        .await
        .map_err(|error| AppError::database("ticket-tags-read", error))?
        .iter()
        .map(|row| {
            Ok(TicketTag {
                id: parse_uuid(row.get("id"), "ticket-tag-id")?,
                name: row.get("name"),
            })
        })
        .collect::<AppResult<Vec<_>>>()?;
        let checklist = sqlx::query(
            "SELECT id, title, completed, sort_order, version FROM ticket_checklist_items WHERE ticket_id = ? ORDER BY sort_order, id",
        )
        .bind(id.to_string())
        .fetch_all(&self.pool)
        .await
        .map_err(|error| AppError::database("ticket-checklist-read", error))?
        .iter()
        .map(|row| {
            Ok(TicketChecklistItem {
                id: parse_uuid(row.get("id"), "ticket-checklist-id")?,
                title: row.get("title"),
                completed: row.get::<i64, _>("completed") != 0,
                sort_order: row.get("sort_order"),
                version: parse_u64(row.get("version"), "ticket-checklist-version")?,
            })
        })
        .collect::<AppResult<Vec<_>>>()?;
        Ok(Ticket {
            id,
            board_id: parse_uuid(row.get("board_id"), "ticket-board-id")?,
            column_id: parse_uuid(row.get("column_id"), "ticket-column-id")?,
            last_non_done_column_id: optional_uuid(
                row.get("last_non_done_column_id"),
                "ticket-last-column",
            )?,
            parent_ticket_id: optional_uuid(row.get("parent_ticket_id"), "ticket-parent-id")?,
            title: row.get("title"),
            description: row.get("description"),
            priority: parse_priority(row.get("priority"))?,
            due_date: optional_date(row.get("due_date"), "ticket-due-date")?,
            estimate_minutes: optional_u32(row.get("estimate_minutes"), "ticket-estimate")?,
            sort_key: row.get("sort_key"),
            tags,
            checklist,
            version: parse_u64(row.get("version"), "ticket-version")?,
            created_at: parse_datetime(row.get("created_at_utc"), "ticket-created")?,
            updated_at: parse_datetime(row.get("updated_at_utc"), "ticket-updated")?,
            completed_at: optional_datetime(row.get("completed_at_utc"), "ticket-completed")?,
            archived_at: optional_datetime(row.get("archived_at_utc"), "ticket-archived")?,
            deleted_at: optional_datetime(row.get("deleted_at_utc"), "ticket-deleted")?,
        })
    }

    async fn begin_ticket_transaction(
        &self,
        context: &'static str,
    ) -> AppResult<Transaction<'_, Sqlite>> {
        self.pool
            .begin()
            .await
            .map_err(|error| AppError::database(context, error))
    }
}

async fn validate_board_column(
    transaction: &mut Transaction<'_, Sqlite>,
    board_id: Uuid,
    column_id: Uuid,
) -> AppResult<()> {
    let count: i64 =
        sqlx::query_scalar("SELECT COUNT(*) FROM ticket_columns WHERE id = ? AND board_id = ?")
            .bind(column_id.to_string())
            .bind(board_id.to_string())
            .fetch_one(&mut **transaction)
            .await
            .map_err(|error| AppError::database("ticket-column-validate", error))?;
    if count == 1 {
        Ok(())
    } else {
        Err(AppError::Validation {
            message: "選択したチケット列を利用できません。".into(),
            recovery: "ボードを再読み込みして列を選び直してください。".into(),
        })
    }
}

async fn validate_parent(
    transaction: &mut Transaction<'_, Sqlite>,
    ticket_id: Uuid,
    board_id: Uuid,
    parent_id: Option<Uuid>,
) -> AppResult<()> {
    let Some(parent_id) = parent_id else {
        return Ok(());
    };
    if parent_id == ticket_id {
        return Err(parent_cycle());
    }
    let count: i64 = sqlx::query_scalar(
        "SELECT COUNT(*) FROM tickets WHERE id = ? AND board_id = ? AND deleted_at_utc IS NULL",
    )
    .bind(parent_id.to_string())
    .bind(board_id.to_string())
    .fetch_one(&mut **transaction)
    .await
    .map_err(|error| AppError::database("ticket-parent-validate", error))?;
    if count != 1 {
        return Err(AppError::Validation {
            message: "親チケットを利用できません。".into(),
            recovery: "ボードを再読み込みして親チケットを選び直してください。".into(),
        });
    }
    let cycle: i64 = sqlx::query_scalar(
        "WITH RECURSIVE ancestors(id, parent_ticket_id) AS (
           SELECT id, parent_ticket_id FROM tickets WHERE id = ?
           UNION
           SELECT ticket.id, ticket.parent_ticket_id
           FROM tickets ticket JOIN ancestors ON ticket.id = ancestors.parent_ticket_id
         ) SELECT COUNT(*) FROM ancestors WHERE id = ?",
    )
    .bind(parent_id.to_string())
    .bind(ticket_id.to_string())
    .fetch_one(&mut **transaction)
    .await
    .map_err(|error| AppError::database("ticket-parent-cycle", error))?;
    if cycle > 0 {
        Err(parent_cycle())
    } else {
        Ok(())
    }
}

async fn replace_ticket_relations(
    transaction: &mut Transaction<'_, Sqlite>,
    ticket_id: Uuid,
    draft: &TicketDraft,
    now: &str,
    replace_tags: bool,
    replace_checklist: bool,
) -> AppResult<()> {
    if replace_tags {
        sqlx::query("DELETE FROM ticket_tag_links WHERE ticket_id = ?")
            .bind(ticket_id.to_string())
            .execute(&mut **transaction)
            .await
            .map_err(|error| AppError::database("ticket-tags-clear", error))?;
        for (index, tag) in draft.tags.iter().enumerate() {
            let normalized = tag.to_lowercase();
            let existing: Option<String> =
                sqlx::query_scalar("SELECT id FROM ticket_tags WHERE normalized_name = ?")
                    .bind(&normalized)
                    .fetch_optional(&mut **transaction)
                    .await
                    .map_err(|error| AppError::database("ticket-tag-find", error))?;
            let tag_id = existing.unwrap_or_else(|| Uuid::new_v4().to_string());
            sqlx::query(
                "INSERT OR IGNORE INTO ticket_tags(id, name, normalized_name, created_at_utc) VALUES (?, ?, ?, ?)",
            )
            .bind(&tag_id)
            .bind(tag)
            .bind(&normalized)
            .bind(now)
            .execute(&mut **transaction)
            .await
            .map_err(|error| AppError::database("ticket-tag-upsert", error))?;
            sqlx::query(
                "INSERT INTO ticket_tag_links(ticket_id, tag_id, sort_order) VALUES (?, ?, ?)",
            )
            .bind(ticket_id.to_string())
            .bind(tag_id)
            .bind(i32::try_from(index).unwrap_or(i32::MAX))
            .execute(&mut **transaction)
            .await
            .map_err(|error| AppError::database("ticket-tag-link", error))?;
        }
        sqlx::query(
            "DELETE FROM ticket_tags WHERE NOT EXISTS (SELECT 1 FROM ticket_tag_links WHERE ticket_tag_links.tag_id = ticket_tags.id)",
        )
        .execute(&mut **transaction)
        .await
        .map_err(|error| AppError::database("ticket-tags-prune", error))?;
    }
    if replace_checklist {
        sqlx::query("DELETE FROM ticket_checklist_items WHERE ticket_id = ?")
            .bind(ticket_id.to_string())
            .execute(&mut **transaction)
            .await
            .map_err(|error| AppError::database("ticket-checklist-clear", error))?;
        for (index, item) in draft.checklist.iter().enumerate() {
            sqlx::query(
                "INSERT INTO ticket_checklist_items(id, ticket_id, title, completed, sort_order, version, created_at_utc, updated_at_utc) VALUES (?, ?, ?, ?, ?, 0, ?, ?)",
            )
            .bind(Uuid::new_v4().to_string())
            .bind(ticket_id.to_string())
            .bind(&item.title)
            .bind(item.completed)
            .bind(i32::try_from(index).unwrap_or(i32::MAX))
            .bind(now)
            .bind(now)
            .execute(&mut **transaction)
            .await
            .map_err(|error| AppError::database("ticket-checklist-insert", error))?;
        }
    }
    Ok(())
}

async fn target_sort_key(
    transaction: &mut Transaction<'_, Sqlite>,
    moving_id: Uuid,
    column_id: Uuid,
    before_ticket_id: Option<Uuid>,
) -> AppResult<i64> {
    let before_key = if let Some(before_id) = before_ticket_id {
        if before_id == moving_id {
            return Err(AppError::Validation {
                message: "チケットを同じ位置の前へ移動できません。".into(),
                recovery: "移動先を選び直してください。".into(),
            });
        }
        sqlx::query_scalar::<_, i64>(
            "SELECT sort_key FROM tickets WHERE id = ? AND column_id = ? AND deleted_at_utc IS NULL",
        )
        .bind(before_id.to_string())
        .bind(column_id.to_string())
        .fetch_optional(&mut **transaction)
        .await
        .map_err(|error| AppError::database("ticket-before-read", error))?
        .ok_or_else(|| AppError::Validation {
            message: "指定した移動先を利用できません。".into(),
            recovery: "列を再読み込みして移動先を選び直してください。".into(),
        })?
        .into()
    } else {
        None
    };
    let previous_key: Option<i64> = match before_key {
        Some(key) => {
            sqlx::query_scalar(
                "SELECT MAX(sort_key) FROM tickets WHERE column_id = ? AND id <> ? AND deleted_at_utc IS NULL AND sort_key < ?",
            )
            .bind(column_id.to_string())
            .bind(moving_id.to_string())
            .bind(key)
            .fetch_one(&mut **transaction)
            .await
            .map_err(|error| AppError::database("ticket-previous-sort", error))?
        }
        None => {
            sqlx::query_scalar(
                "SELECT MAX(sort_key) FROM tickets WHERE column_id = ? AND id <> ? AND deleted_at_utc IS NULL",
            )
            .bind(column_id.to_string())
            .bind(moving_id.to_string())
            .fetch_one(&mut **transaction)
            .await
            .map_err(|error| AppError::database("ticket-last-sort", error))?
        }
    };
    if let Some(key) = sort_key_between(previous_key, before_key) {
        return Ok(key);
    }
    rebalance_column(transaction, column_id, moving_id).await?;
    let refreshed_before: Option<i64> = if let Some(before_id) = before_ticket_id {
        sqlx::query_scalar("SELECT sort_key FROM tickets WHERE id = ?")
            .bind(before_id.to_string())
            .fetch_optional(&mut **transaction)
            .await
            .map_err(|error| AppError::database("ticket-before-refresh", error))?
    } else {
        None
    };
    let refreshed_previous: Option<i64> = match refreshed_before {
        Some(key) => sqlx::query_scalar(
            "SELECT MAX(sort_key) FROM tickets WHERE column_id = ? AND id <> ? AND deleted_at_utc IS NULL AND sort_key < ?",
        )
        .bind(column_id.to_string())
        .bind(moving_id.to_string())
        .bind(key)
        .fetch_one(&mut **transaction)
        .await
        .map_err(|error| AppError::database("ticket-previous-refresh", error))?,
        None => sqlx::query_scalar(
            "SELECT MAX(sort_key) FROM tickets WHERE column_id = ? AND id <> ? AND deleted_at_utc IS NULL",
        )
        .bind(column_id.to_string())
        .bind(moving_id.to_string())
        .fetch_one(&mut **transaction)
        .await
        .map_err(|error| AppError::database("ticket-last-refresh", error))?,
    };
    sort_key_between(refreshed_previous, refreshed_before).ok_or_else(|| {
        AppError::database("ticket-sort-key", "sort key unavailable after rebalance")
    })
}

async fn rebalance_column(
    transaction: &mut Transaction<'_, Sqlite>,
    column_id: Uuid,
    moving_id: Uuid,
) -> AppResult<()> {
    let ids: Vec<String> = sqlx::query_scalar(
        "SELECT id FROM tickets WHERE column_id = ? AND id <> ? AND deleted_at_utc IS NULL ORDER BY sort_key, id",
    )
    .bind(column_id.to_string())
    .bind(moving_id.to_string())
    .fetch_all(&mut **transaction)
    .await
    .map_err(|error| AppError::database("ticket-rebalance-read", error))?;
    for (index, id) in ids.iter().enumerate() {
        sqlx::query("UPDATE tickets SET sort_key = ? WHERE id = ?")
            .bind(rebalanced_sort_key(index)?)
            .bind(id)
            .execute(&mut **transaction)
            .await
            .map_err(|error| AppError::database("ticket-rebalance-update", error))?;
    }
    Ok(())
}

async fn column_kind(
    transaction: &mut Transaction<'_, Sqlite>,
    column_id: Uuid,
) -> AppResult<TicketColumnKind> {
    let value: String = sqlx::query_scalar("SELECT kind FROM ticket_columns WHERE id = ?")
        .bind(column_id.to_string())
        .fetch_optional(&mut **transaction)
        .await
        .map_err(|error| AppError::database("ticket-column-kind", error))?
        .ok_or_else(ticket_not_found)?;
    parse_column_kind(&value)
}

#[derive(Debug, Clone, Copy)]
enum TicketLifecycleChange {
    Archived(Option<DateTime<Utc>>),
    Deleted(DateTime<Utc>),
}

struct HistoryWrite<'a, B, A> {
    action_id: Uuid,
    ticket_id: Uuid,
    action: &'a str,
    version: u64,
    before: Option<B>,
    after: Option<A>,
    now: &'a str,
}

async fn record_history<B: Serialize, A: Serialize>(
    transaction: &mut Transaction<'_, Sqlite>,
    write: HistoryWrite<'_, B, A>,
) -> AppResult<()> {
    let before_json = write
        .before
        .map(|value| serde_json::to_string(&value))
        .transpose()
        .map_err(|error| AppError::database("ticket-history-before", error))?;
    let after_json = write
        .after
        .map(|value| serde_json::to_string(&value))
        .transpose()
        .map_err(|error| AppError::database("ticket-history-after", error))?;
    sqlx::query(
        "INSERT INTO ticket_change_history(action_id, ticket_id, action, entity_version, before_json, after_json, created_at_utc) VALUES (?, ?, ?, ?, ?, ?, ?)",
    )
    .bind(write.action_id.to_string())
    .bind(write.ticket_id.to_string())
    .bind(write.action)
    .bind(i64::try_from(write.version).unwrap_or(i64::MAX))
    .bind(before_json)
    .bind(after_json)
    .bind(write.now)
    .execute(&mut **transaction)
    .await
    .map_err(|error| AppError::database("ticket-history-insert", error))?;
    Ok(())
}

fn draft_from_ticket(ticket: &Ticket) -> TicketDraft {
    TicketDraft {
        board_id: ticket.board_id,
        column_id: ticket.column_id,
        parent_ticket_id: ticket.parent_ticket_id,
        title: ticket.title.clone(),
        description: ticket.description.clone(),
        priority: ticket.priority,
        due_date: ticket.due_date,
        estimate_minutes: ticket.estimate_minutes,
        tags: ticket.tags.iter().map(|tag| tag.name.clone()).collect(),
        checklist: ticket
            .checklist
            .iter()
            .map(|item| crate::domain::TicketChecklistItemDraft {
                title: item.title.clone(),
                completed: item.completed,
            })
            .collect(),
    }
}

fn apply_patch(draft: &mut TicketDraft, patch: TicketPatch) {
    if let Some(value) = patch.title {
        draft.title = value;
    }
    if let Some(value) = patch.description {
        draft.description = value;
    }
    if let Some(value) = patch.priority {
        draft.priority = value;
    }
    if let Some(value) = patch.due_date {
        draft.due_date = value;
    }
    if let Some(value) = patch.estimate_minutes {
        draft.estimate_minutes = value;
    }
    if let Some(value) = patch.parent_ticket_id {
        draft.parent_ticket_id = value;
    }
    if let Some(value) = patch.tags {
        draft.tags = value;
    }
    if let Some(value) = patch.checklist {
        draft.checklist = value;
    }
}

fn ensure_version(ticket: &Ticket, expected_version: u64) -> AppResult<()> {
    if ticket.version == expected_version {
        Ok(())
    } else {
        Err(version_conflict())
    }
}

fn ensure_mutable(ticket: &Ticket) -> AppResult<()> {
    if ticket.deleted_at.is_none() {
        Ok(())
    } else {
        Err(AppError::Validation {
            message: "削除済みのチケットは変更できません。".into(),
            recovery: "ボードを再読み込みしてください。".into(),
        })
    }
}

fn ticket_column_from_row(row: &SqliteRow) -> AppResult<TicketColumn> {
    Ok(TicketColumn {
        id: parse_uuid(row.get("id"), "ticket-column-id")?,
        board_id: parse_uuid(row.get("board_id"), "ticket-column-board")?,
        kind: parse_column_kind(row.get("kind"))?,
        name: row.get("name"),
        sort_order: row.get("sort_order"),
        version: parse_u64(row.get("version"), "ticket-column-version")?,
    })
}

fn parse_priority(value: &str) -> AppResult<TicketPriority> {
    match value {
        "low" => Ok(TicketPriority::Low),
        "normal" => Ok(TicketPriority::Normal),
        "high" => Ok(TicketPriority::High),
        "urgent" => Ok(TicketPriority::Urgent),
        _ => Err(AppError::database("ticket-priority", "unknown priority")),
    }
}

fn parse_column_kind(value: &str) -> AppResult<TicketColumnKind> {
    match value {
        "inbox" => Ok(TicketColumnKind::Inbox),
        "backlog" => Ok(TicketColumnKind::Backlog),
        "next" => Ok(TicketColumnKind::Next),
        "in_progress" => Ok(TicketColumnKind::InProgress),
        "waiting" => Ok(TicketColumnKind::Waiting),
        "done" => Ok(TicketColumnKind::Done),
        _ => Err(AppError::database(
            "ticket-column-kind",
            "unknown column kind",
        )),
    }
}

fn parse_uuid(value: &str, context: &'static str) -> AppResult<Uuid> {
    Uuid::parse_str(value).map_err(|error| AppError::database(context, error))
}

fn optional_uuid(value: Option<String>, context: &'static str) -> AppResult<Option<Uuid>> {
    value.map(|value| parse_uuid(&value, context)).transpose()
}

fn parse_datetime(value: &str, context: &'static str) -> AppResult<DateTime<Utc>> {
    value
        .parse::<DateTime<Utc>>()
        .map_err(|error| AppError::database(context, error))
}

fn optional_datetime(
    value: Option<String>,
    context: &'static str,
) -> AppResult<Option<DateTime<Utc>>> {
    value
        .map(|value| parse_datetime(&value, context))
        .transpose()
}

fn optional_date(value: Option<String>, context: &'static str) -> AppResult<Option<NaiveDate>> {
    value
        .map(|value| {
            NaiveDate::parse_from_str(&value, "%Y-%m-%d")
                .map_err(|error| AppError::database(context, error))
        })
        .transpose()
}

fn parse_u64(value: i64, context: &'static str) -> AppResult<u64> {
    u64::try_from(value).map_err(|error| AppError::database(context, error))
}

fn optional_u32(value: Option<i64>, context: &'static str) -> AppResult<Option<u32>> {
    value
        .map(|value| u32::try_from(value).map_err(|error| AppError::database(context, error)))
        .transpose()
}

fn timestamp(value: DateTime<Utc>) -> String {
    value.to_rfc3339_opts(chrono::SecondsFormat::Millis, true)
}

fn escape_like(value: &str) -> String {
    value
        .replace('\\', "\\\\")
        .replace('%', "\\%")
        .replace('_', "\\_")
}

fn ticket_not_found() -> AppError {
    AppError::NotFound {
        message: "チケットが見つかりません。".into(),
        recovery: "ボードを再読み込みしてください。".into(),
    }
}

fn parent_cycle() -> AppError {
    AppError::Validation {
        message: "親子関係が循環するため保存できません。".into(),
        recovery: "別の親チケットを選ぶか、親子関係を解除してください。".into(),
    }
}

fn version_conflict() -> AppError {
    AppError::Conflict {
        message: "チケットは別の操作で更新されています。".into(),
        recovery: "最新のチケットを再読み込みし、変更内容を確認してから再実行してください。".into(),
    }
}

fn operation_conflict() -> AppError {
    AppError::Conflict {
        message: "同じ操作識別子が別のチケットに使用されています。".into(),
        recovery: "ボードを再読み込みし、新しい操作としてやり直してください。".into(),
    }
}

#[cfg(test)]
mod tests {
    use super::*;
    use crate::domain::{TicketChecklistItemDraft, TicketPriority};
    use sqlx::sqlite::{SqliteConnectOptions, SqlitePoolOptions};
    use std::{str::FromStr, time::Instant};

    fn draft(title: &str, column_id: Uuid) -> TicketDraft {
        TicketDraft {
            board_id: DEFAULT_TICKET_BOARD_ID,
            column_id,
            parent_ticket_id: None,
            title: title.into(),
            description: "synthetic description".into(),
            priority: TicketPriority::Normal,
            due_date: NaiveDate::from_ymd_opt(2026, 8, 4),
            estimate_minutes: Some(30),
            tags: vec!["synthetic".into()],
            checklist: vec![TicketChecklistItemDraft {
                title: "synthetic item".into(),
                completed: false,
            }],
        }
    }

    #[tokio::test]
    async fn fresh_database_seeds_one_board_and_six_columns_once() {
        let database = Database::open_memory().await.unwrap();
        assert_eq!(
            database.default_ticket_board().await.unwrap().columns.len(),
            6
        );
        let boards: i64 = sqlx::query_scalar("SELECT COUNT(*) FROM ticket_boards")
            .fetch_one(&database.pool)
            .await
            .unwrap();
        assert_eq!(boards, 1);
    }

    #[tokio::test]
    async fn create_update_relations_and_history_are_atomic_and_idempotent() {
        let database = Database::open_memory().await.unwrap();
        let operation_id = Uuid::new_v4();
        let created = database
            .create_ticket(
                operation_id,
                draft(&"T".repeat(1_024), INBOX_TICKET_COLUMN_ID),
                Utc::now(),
            )
            .await
            .unwrap();
        let repeated = database
            .create_ticket(
                operation_id,
                draft("ignored retry", INBOX_TICKET_COLUMN_ID),
                Utc::now(),
            )
            .await
            .unwrap();
        assert_eq!(repeated.id, created.id);
        assert_eq!(created.title.chars().count(), 1_024);
        assert_eq!(created.tags.len(), 1);
        assert_eq!(created.checklist.len(), 1);
        assert_eq!(
            database.ticket_history(created.id, 10).await.unwrap().len(),
            1
        );

        let updated = database
            .update_ticket(
                Uuid::new_v4(),
                created.id,
                created.version,
                TicketPatch {
                    title: Some("updated synthetic".into()),
                    tags: Some(vec!["Rust".into(), "rust".into()]),
                    ..TicketPatch::default()
                },
                Utc::now(),
            )
            .await
            .unwrap();
        assert_eq!(updated.version, 1);
        assert_eq!(updated.tags.len(), 1);
        assert_eq!(updated.checklist[0].id, created.checklist[0].id);
        assert_eq!(
            database.ticket_history(created.id, 10).await.unwrap().len(),
            2
        );
    }

    #[tokio::test]
    async fn stale_version_and_parent_cycles_are_rejected() {
        let database = Database::open_memory().await.unwrap();
        let parent = database
            .create_ticket(
                Uuid::new_v4(),
                draft("parent", INBOX_TICKET_COLUMN_ID),
                Utc::now(),
            )
            .await
            .unwrap();
        let mut child_draft = draft("child", INBOX_TICKET_COLUMN_ID);
        child_draft.parent_ticket_id = Some(parent.id);
        let child = database
            .create_ticket(Uuid::new_v4(), child_draft, Utc::now())
            .await
            .unwrap();
        let stale = database
            .update_ticket(
                Uuid::new_v4(),
                parent.id,
                parent.version + 1,
                TicketPatch::default(),
                Utc::now(),
            )
            .await;
        assert!(matches!(stale, Err(AppError::Conflict { .. })));
        let cycle = database
            .update_ticket(
                Uuid::new_v4(),
                parent.id,
                parent.version,
                TicketPatch {
                    parent_ticket_id: Some(Some(child.id)),
                    ..TicketPatch::default()
                },
                Utc::now(),
            )
            .await;
        assert!(matches!(cycle, Err(AppError::Validation { .. })));
    }

    #[tokio::test]
    async fn done_reopens_to_previous_column_and_delete_is_hidden_by_default() {
        let database = Database::open_memory().await.unwrap();
        let created = database
            .create_ticket(
                Uuid::new_v4(),
                draft("lifecycle", INBOX_TICKET_COLUMN_ID),
                Utc::now(),
            )
            .await
            .unwrap();
        let done = database
            .move_ticket(
                Uuid::new_v4(),
                created.id,
                0,
                DONE_TICKET_COLUMN_ID,
                None,
                Utc::now(),
            )
            .await
            .unwrap();
        assert!(done.completed_at.is_some());
        assert_eq!(done.last_non_done_column_id, Some(INBOX_TICKET_COLUMN_ID));
        let reopened = database
            .reopen_ticket(Uuid::new_v4(), created.id, 1, Utc::now())
            .await
            .unwrap();
        assert_eq!(reopened.column_id, INBOX_TICKET_COLUMN_ID);
        assert!(reopened.completed_at.is_none());
        database
            .delete_ticket(Uuid::new_v4(), created.id, 2, Utc::now())
            .await
            .unwrap();
        assert_eq!(
            database
                .list_tickets(TicketQuery::default())
                .await
                .unwrap()
                .total,
            0
        );
        assert_eq!(
            database
                .list_tickets(TicketQuery {
                    include_deleted: true,
                    ..TicketQuery::default()
                })
                .await
                .unwrap()
                .total,
            1
        );
    }

    #[tokio::test]
    async fn five_hundred_ticket_reorder_stays_within_budget_and_keeps_unique_order() {
        let database = Database::open_memory().await.unwrap();
        let mut ids = Vec::new();
        for index in 0..500 {
            ids.push(
                database
                    .create_ticket(
                        Uuid::new_v4(),
                        draft(&format!("synthetic {index}"), INBOX_TICKET_COLUMN_ID),
                        Utc::now(),
                    )
                    .await
                    .unwrap(),
            );
        }
        let started = Instant::now();
        database
            .move_ticket(
                Uuid::new_v4(),
                ids[499].id,
                ids[499].version,
                INBOX_TICKET_COLUMN_ID,
                Some(ids[0].id),
                Utc::now(),
            )
            .await
            .unwrap();
        assert!(started.elapsed().as_secs() < 5);
        let distinct: i64 =
            sqlx::query_scalar("SELECT COUNT(DISTINCT sort_key) FROM tickets WHERE column_id = ?")
                .bind(INBOX_TICKET_COLUMN_ID.to_string())
                .fetch_one(&database.pool)
                .await
                .unwrap();
        assert_eq!(distinct, 500);
    }

    #[tokio::test]
    async fn history_failure_rolls_back_ticket_and_relations() {
        let database = Database::open_memory().await.unwrap();
        sqlx::query(
            "CREATE TRIGGER synthetic_ticket_history_failure BEFORE INSERT ON ticket_change_history BEGIN SELECT RAISE(ABORT, 'synthetic failure'); END",
        )
        .execute(&database.pool)
        .await
        .unwrap();

        let result = database
            .create_ticket(
                Uuid::new_v4(),
                draft("synthetic rollback", INBOX_TICKET_COLUMN_ID),
                Utc::now(),
            )
            .await;

        assert!(matches!(result, Err(AppError::Database { .. })));
        for table in [
            "tickets",
            "ticket_tag_links",
            "ticket_checklist_items",
            "ticket_change_history",
        ] {
            let count: i64 = sqlx::query_scalar(&format!("SELECT COUNT(*) FROM {table}"))
                .fetch_one(&database.pool)
                .await
                .unwrap();
            assert_eq!(count, 0, "table {table} must roll back");
        }
    }

    #[tokio::test]
    async fn deleting_all_user_data_removes_tickets_but_keeps_the_default_board() {
        let database = Database::open_memory().await.unwrap();
        database
            .create_ticket(
                Uuid::new_v4(),
                draft("synthetic delete all", INBOX_TICKET_COLUMN_ID),
                Utc::now(),
            )
            .await
            .unwrap();

        database.delete_all_user_data().await.unwrap();

        assert_eq!(
            database
                .list_tickets(TicketQuery {
                    include_deleted: true,
                    ..TicketQuery::default()
                })
                .await
                .unwrap()
                .total,
            0
        );
        assert_eq!(
            database.default_ticket_board().await.unwrap().columns.len(),
            6
        );
    }

    #[tokio::test]
    async fn migration_v14_preserves_v13_data_and_seeds_ticket_foundation() {
        let options = SqliteConnectOptions::from_str("sqlite::memory:")
            .unwrap()
            .foreign_keys(true);
        let pool = SqlitePoolOptions::new()
            .max_connections(1)
            .connect_with(options)
            .await
            .unwrap();
        let v13 = sqlx::migrate::Migrator {
            migrations: std::borrow::Cow::Owned(
                super::super::database::MIGRATOR
                    .migrations
                    .iter()
                    .filter(|migration| migration.version <= 13)
                    .cloned()
                    .collect(),
            ),
            ..super::super::database::MIGRATOR
        };
        v13.run(&pool).await.unwrap();
        let now = Utc::now().to_rfc3339();
        sqlx::query("INSERT INTO schedule_items(id, title, description, location, start_at_utc, end_at_utc, time_zone, all_day, status, project, category, tags_json, color, sync_status, version, created_at_utc, updated_at_utc) VALUES (?, 'synthetic schedule', '', '', '2026-08-03T00:00:00Z', '2026-08-03T01:00:00Z', 'UTC', 0, 'scheduled', '', '', '[]', '#6F96F4', 'local_only', 0, ?, ?)")
            .bind(Uuid::new_v4().to_string())
            .bind(&now)
            .bind(&now)
            .execute(&pool)
            .await
            .unwrap();
        super::super::database::MIGRATOR.run(&pool).await.unwrap();
        let version: String =
            sqlx::query_scalar("SELECT value FROM app_meta WHERE key = 'schema_version'")
                .fetch_one(&pool)
                .await
                .unwrap();
        let schedules: i64 = sqlx::query_scalar("SELECT COUNT(*) FROM schedule_items")
            .fetch_one(&pool)
            .await
            .unwrap();
        let columns: i64 = sqlx::query_scalar("SELECT COUNT(*) FROM ticket_columns")
            .fetch_one(&pool)
            .await
            .unwrap();
        assert_eq!(version, "14");
        assert_eq!(schedules, 1);
        assert_eq!(columns, 6);
    }
}
