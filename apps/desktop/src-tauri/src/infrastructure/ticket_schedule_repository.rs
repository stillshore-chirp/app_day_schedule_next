use std::collections::HashMap;

use chrono::{DateTime, Utc};
use sqlx::{Row, Sqlite, Transaction, sqlite::SqliteRow};
use uuid::Uuid;

use crate::domain::{
    AppError, AppResult, AssignTicketScheduleRequest, LinkTicketScheduleRequest, Priority,
    Schedule, ScheduleDraft, ScheduleStatus, SyncStatus, TicketPlanningSummary, TicketScheduleLink,
    TicketScheduleSource, UnlinkTicketScheduleRequest,
};

use super::{
    Database,
    database::{
        enqueue_outbox, fetch_schedule, has_default_write_target, insert_history, insert_schedule,
        parse_datetime, parse_uuid, row_to_schedule, timestamp, version_conflict,
    },
};

impl Database {
    pub async fn assign_ticket_to_new_schedule(
        &self,
        request: &AssignTicketScheduleRequest,
        start_utc: DateTime<Utc>,
        end_utc: DateTime<Utc>,
        now: DateTime<Utc>,
    ) -> AppResult<TicketScheduleLink> {
        if let Some(link) = self.link_for_operation(request.operation_id).await? {
            if link.ticket_id == request.ticket_id {
                return Ok(link);
            }
            return Err(operation_conflict());
        }
        let mut transaction = self.begin_mutation().await?;
        let ticket = fetch_ticket_identity(&mut transaction, request.ticket_id).await?;
        validate_ticket_version(&ticket, request.expected_ticket_version)?;
        let has_sync_target = has_default_write_target(&mut transaction).await?;
        let title = request
            .title_override
            .clone()
            .unwrap_or_else(|| ticket.title.chars().take(200).collect::<String>());
        let mut draft = ScheduleDraft {
            title,
            description: String::new(),
            location: String::new(),
            start_utc,
            end_utc,
            timezone_id: request.timezone_id.clone(),
            all_day: false,
            all_day_start_date: None,
            all_day_end_date_exclusive: None,
            status: ScheduleStatus::Scheduled,
            project: String::new(),
            category: String::new(),
            tags: Vec::new(),
            color: "#6F96F4".into(),
            priority: Priority::try_from(ticket.priority.as_str())?,
            recurrence_rule: None,
            recurrence_supplemental_lines: Vec::new(),
            recurrence_exdates: Vec::new(),
            start_notification_minutes: None,
            end_notification_minutes: None,
        };
        draft.validate()?;
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
            request.operation_id,
            "create",
            None,
            Some(&schedule),
            now,
        )
        .await?;
        if has_sync_target {
            enqueue_outbox(&mut transaction, &schedule, "create", now).await?;
        }
        let link_id = Uuid::new_v4();
        insert_link(
            &mut transaction,
            link_id,
            request.ticket_id,
            schedule.id,
            request.source,
            now,
        )
        .await?;
        insert_link_history(
            &mut transaction,
            request.operation_id,
            link_id,
            request.ticket_id,
            schedule.id,
            "link",
            None,
            Some(&LinkSnapshot::active(
                link_id,
                request.ticket_id,
                schedule.id,
                request.source,
                now,
            )),
            now,
        )
        .await?;
        transaction
            .commit()
            .await
            .map_err(|error| AppError::database("ticket-schedule-assign-commit", error))?;
        self.ticket_schedule_link(link_id).await
    }

    pub async fn link_ticket_to_existing_schedule(
        &self,
        request: &LinkTicketScheduleRequest,
        now: DateTime<Utc>,
    ) -> AppResult<TicketScheduleLink> {
        if let Some(link) = self.link_for_operation(request.operation_id).await? {
            if link.ticket_id == request.ticket_id && link.schedule.id == request.schedule_id {
                return Ok(link);
            }
            return Err(operation_conflict());
        }
        let mut transaction = self.begin_mutation().await?;
        let ticket = fetch_ticket_identity(&mut transaction, request.ticket_id).await?;
        validate_ticket_version(&ticket, request.expected_ticket_version)?;
        let schedule = fetch_schedule(&mut transaction, request.schedule_id).await?;
        if schedule.deleted_at.is_some() || schedule.version != request.expected_schedule_version {
            return Err(version_conflict());
        }
        let existing =
            fetch_active_link_for_schedule(&mut transaction, request.schedule_id).await?;
        if let Some(existing) = &existing {
            if existing.ticket_id == request.ticket_id {
                transaction
                    .rollback()
                    .await
                    .map_err(|error| AppError::database("ticket-schedule-same-rollback", error))?;
                return self.ticket_schedule_link(existing.id).await;
            }
            if !request.replace_existing {
                return Err(AppError::Conflict {
                    message: "この予定は別のチケットに関連付けられています。".into(),
                    recovery:
                        "現在のチケット名を確認し、付け替える場合は明示的に選択してください。"
                            .into(),
                });
            }
            deactivate_link(&mut transaction, existing, now).await?;
        }
        let link_id = Uuid::new_v4();
        insert_link(
            &mut transaction,
            link_id,
            request.ticket_id,
            request.schedule_id,
            request.source,
            now,
        )
        .await?;
        insert_link_history(
            &mut transaction,
            request.operation_id,
            link_id,
            request.ticket_id,
            request.schedule_id,
            if existing.is_some() { "relink" } else { "link" },
            existing.as_ref(),
            Some(&LinkSnapshot::active(
                link_id,
                request.ticket_id,
                request.schedule_id,
                request.source,
                now,
            )),
            now,
        )
        .await?;
        transaction
            .commit()
            .await
            .map_err(|error| AppError::database("ticket-schedule-link-commit", error))?;
        self.ticket_schedule_link(link_id).await
    }

    pub async fn unlink_ticket_schedule(
        &self,
        request: &UnlinkTicketScheduleRequest,
        now: DateTime<Utc>,
    ) -> AppResult<TicketScheduleLink> {
        if let Some(link) = self.link_for_operation(request.operation_id).await? {
            return Ok(link);
        }
        let mut transaction = self.begin_mutation().await?;
        let before = fetch_link_snapshot(&mut transaction, request.link_id).await?;
        if before.unlinked_at.is_some() || before.version != request.expected_link_version {
            return Err(link_version_conflict());
        }
        let after = deactivate_link(&mut transaction, &before, now).await?;
        insert_link_history(
            &mut transaction,
            request.operation_id,
            request.link_id,
            before.ticket_id,
            before.schedule_id,
            "unlink",
            Some(&before),
            Some(&after),
            now,
        )
        .await?;
        transaction
            .commit()
            .await
            .map_err(|error| AppError::database("ticket-schedule-unlink-commit", error))?;
        self.ticket_schedule_link(request.link_id).await
    }

    pub async fn ticket_schedules(
        &self,
        ticket_id: Uuid,
        include_unlinked: bool,
    ) -> AppResult<Vec<TicketScheduleLink>> {
        let rows = sqlx::query(
            "SELECT s.*, l.id AS link_id, l.ticket_id AS link_ticket_id,
                    t.title AS link_ticket_title, l.linked_at_utc AS link_linked_at_utc,
                    l.unlinked_at_utc AS link_unlinked_at_utc, l.source AS link_source,
                    l.version AS link_version
             FROM ticket_schedule_links l
             JOIN tickets t ON t.id = l.ticket_id
             JOIN schedule_items s ON s.id = l.schedule_id
             WHERE l.ticket_id = ? AND (? = 1 OR l.unlinked_at_utc IS NULL)
             ORDER BY s.start_at_utc, l.id",
        )
        .bind(ticket_id.to_string())
        .bind(include_unlinked)
        .fetch_all(&self.pool)
        .await
        .map_err(|error| AppError::database("ticket-schedules-list", error))?;
        rows.iter().map(link_from_joined_row).collect()
    }

    pub async fn schedule_ticket_link(
        &self,
        schedule_id: Uuid,
    ) -> AppResult<Option<TicketScheduleLink>> {
        let row = sqlx::query(
            "SELECT s.*, l.id AS link_id, l.ticket_id AS link_ticket_id,
                    t.title AS link_ticket_title, l.linked_at_utc AS link_linked_at_utc,
                    l.unlinked_at_utc AS link_unlinked_at_utc, l.source AS link_source,
                    l.version AS link_version
             FROM ticket_schedule_links l
             JOIN tickets t ON t.id = l.ticket_id
             JOIN schedule_items s ON s.id = l.schedule_id
             WHERE l.schedule_id = ? AND l.unlinked_at_utc IS NULL LIMIT 1",
        )
        .bind(schedule_id.to_string())
        .fetch_optional(&self.pool)
        .await
        .map_err(|error| AppError::database("schedule-ticket-link", error))?;
        row.as_ref().map(link_from_joined_row).transpose()
    }

    pub async fn ticket_planning_summaries(
        &self,
        ticket_ids: &[Uuid],
        now: DateTime<Utc>,
    ) -> AppResult<Vec<TicketPlanningSummary>> {
        if ticket_ids.len() > 1_000 {
            return Err(AppError::Validation {
                message: "予定集計は1,000件以下のチケットを指定してください。".into(),
                recovery: "ボードの絞り込みを見直してください。".into(),
            });
        }
        let mut summaries: HashMap<Uuid, TicketPlanningSummary> = ticket_ids
            .iter()
            .copied()
            .map(|ticket_id| {
                (
                    ticket_id,
                    TicketPlanningSummary {
                        ticket_id,
                        schedule_count: 0,
                        future_planned_minutes: 0,
                        total_planned_minutes: 0,
                        next_scheduled_at: None,
                    },
                )
            })
            .collect();
        if ticket_ids.is_empty() {
            return Ok(Vec::new());
        }
        let placeholders = std::iter::repeat_n("?", ticket_ids.len())
            .collect::<Vec<_>>()
            .join(",");
        let sql = format!(
            "SELECT l.ticket_id, s.start_at_utc, s.end_at_utc
             FROM ticket_schedule_links l
             JOIN schedule_items s ON s.id = l.schedule_id
             WHERE l.unlinked_at_utc IS NULL AND s.deleted_at_utc IS NULL
               AND l.ticket_id IN ({placeholders})"
        );
        let mut query = sqlx::query(&sql);
        for ticket_id in ticket_ids {
            query = query.bind(ticket_id.to_string());
        }
        let rows = query
            .fetch_all(&self.pool)
            .await
            .map_err(|error| AppError::database("ticket-planning-summary", error))?;
        for row in rows {
            let ticket_id = parse_uuid(row.get("ticket_id"), "ticket-planning-ticket")?;
            let start = parse_datetime(row.get("start_at_utc"), "ticket-planning-start")?;
            let end = parse_datetime(row.get("end_at_utc"), "ticket-planning-end")?;
            let duration = u64::try_from((end - start).num_minutes().max(0)).unwrap_or(0);
            let summary = summaries.get_mut(&ticket_id).ok_or_else(|| {
                AppError::database("ticket-planning-unexpected-ticket", ticket_id)
            })?;
            summary.schedule_count += 1;
            summary.total_planned_minutes = summary.total_planned_minutes.saturating_add(duration);
            if end > now {
                summary.future_planned_minutes = summary.future_planned_minutes.saturating_add(
                    u64::try_from((end - start.max(now)).num_minutes().max(0)).unwrap_or(0),
                );
                if start >= now
                    && summary
                        .next_scheduled_at
                        .is_none_or(|current| start < current)
                {
                    summary.next_scheduled_at = Some(start);
                }
            }
        }
        Ok(ticket_ids
            .iter()
            .filter_map(|id| summaries.remove(id))
            .collect())
    }

    async fn ticket_schedule_link(&self, link_id: Uuid) -> AppResult<TicketScheduleLink> {
        let row = sqlx::query(
            "SELECT s.*, l.id AS link_id, l.ticket_id AS link_ticket_id,
                    t.title AS link_ticket_title, l.linked_at_utc AS link_linked_at_utc,
                    l.unlinked_at_utc AS link_unlinked_at_utc, l.source AS link_source,
                    l.version AS link_version
             FROM ticket_schedule_links l
             JOIN tickets t ON t.id = l.ticket_id
             JOIN schedule_items s ON s.id = l.schedule_id
             WHERE l.id = ? LIMIT 1",
        )
        .bind(link_id.to_string())
        .fetch_optional(&self.pool)
        .await
        .map_err(|error| AppError::database("ticket-schedule-link-read", error))?
        .ok_or_else(link_not_found)?;
        link_from_joined_row(&row)
    }

    async fn link_for_operation(
        &self,
        operation_id: Uuid,
    ) -> AppResult<Option<TicketScheduleLink>> {
        let link_id: Option<String> = sqlx::query_scalar(
            "SELECT link_id FROM ticket_schedule_link_history WHERE operation_id = ?",
        )
        .bind(operation_id.to_string())
        .fetch_optional(&self.pool)
        .await
        .map_err(|error| AppError::database("ticket-schedule-operation-read", error))?;
        let Some(link_id) = link_id else {
            return Ok(None);
        };
        let link_id = parse_uuid(&link_id, "ticket-schedule-operation-link")?;
        self.ticket_schedule_link(link_id).await.map(Some)
    }
}

#[derive(Debug, Clone, serde::Serialize, serde::Deserialize)]
#[serde(rename_all = "camelCase")]
struct LinkSnapshot {
    id: Uuid,
    ticket_id: Uuid,
    schedule_id: Uuid,
    linked_at: DateTime<Utc>,
    unlinked_at: Option<DateTime<Utc>>,
    source: TicketScheduleSource,
    version: u64,
}

impl LinkSnapshot {
    fn active(
        id: Uuid,
        ticket_id: Uuid,
        schedule_id: Uuid,
        source: TicketScheduleSource,
        now: DateTime<Utc>,
    ) -> Self {
        Self {
            id,
            ticket_id,
            schedule_id,
            linked_at: now,
            unlinked_at: None,
            source,
            version: 0,
        }
    }
}

struct TicketIdentity {
    title: String,
    priority: String,
    version: u64,
    archived_at: Option<String>,
    deleted_at: Option<String>,
}

async fn fetch_ticket_identity(
    transaction: &mut Transaction<'_, Sqlite>,
    ticket_id: Uuid,
) -> AppResult<TicketIdentity> {
    let row = sqlx::query(
        "SELECT title, priority, version, archived_at_utc, deleted_at_utc FROM tickets WHERE id = ?",
    )
    .bind(ticket_id.to_string())
    .fetch_optional(&mut **transaction)
    .await
    .map_err(|error| AppError::database("ticket-schedule-ticket-read", error))?
    .ok_or_else(ticket_not_found)?;
    Ok(TicketIdentity {
        title: row.get("title"),
        priority: row.get("priority"),
        version: u64::try_from(row.get::<i64, _>("version"))
            .map_err(|error| AppError::database("ticket-schedule-ticket-version", error))?,
        archived_at: row.get("archived_at_utc"),
        deleted_at: row.get("deleted_at_utc"),
    })
}

fn validate_ticket_version(ticket: &TicketIdentity, expected_version: u64) -> AppResult<()> {
    if ticket.deleted_at.is_some() || ticket.archived_at.is_some() {
        return Err(ticket_not_found());
    }
    if ticket.version != expected_version {
        return Err(AppError::Conflict {
            message: "チケットは別の操作で更新されています。".into(),
            recovery: "最新のチケットを読み込み、予定への割り当てを確認してください。".into(),
        });
    }
    Ok(())
}

async fn insert_link(
    transaction: &mut Transaction<'_, Sqlite>,
    id: Uuid,
    ticket_id: Uuid,
    schedule_id: Uuid,
    source: TicketScheduleSource,
    now: DateTime<Utc>,
) -> AppResult<()> {
    sqlx::query(
        "INSERT INTO ticket_schedule_links(
           id, ticket_id, schedule_id, linked_at_utc, unlinked_at_utc, source, version,
           created_at_utc, updated_at_utc
         ) VALUES (?, ?, ?, ?, NULL, ?, 0, ?, ?)",
    )
    .bind(id.to_string())
    .bind(ticket_id.to_string())
    .bind(schedule_id.to_string())
    .bind(timestamp(now))
    .bind(source.as_str())
    .bind(timestamp(now))
    .bind(timestamp(now))
    .execute(&mut **transaction)
    .await
    .map_err(|error| AppError::database("ticket-schedule-link-insert", error))?;
    Ok(())
}

async fn fetch_active_link_for_schedule(
    transaction: &mut Transaction<'_, Sqlite>,
    schedule_id: Uuid,
) -> AppResult<Option<LinkSnapshot>> {
    let row = sqlx::query(
        "SELECT id, ticket_id, schedule_id, linked_at_utc, unlinked_at_utc, source, version
         FROM ticket_schedule_links WHERE schedule_id = ? AND unlinked_at_utc IS NULL",
    )
    .bind(schedule_id.to_string())
    .fetch_optional(&mut **transaction)
    .await
    .map_err(|error| AppError::database("ticket-schedule-active-read", error))?;
    row.as_ref().map(link_snapshot_from_row).transpose()
}

async fn fetch_link_snapshot(
    transaction: &mut Transaction<'_, Sqlite>,
    link_id: Uuid,
) -> AppResult<LinkSnapshot> {
    let row = sqlx::query(
        "SELECT id, ticket_id, schedule_id, linked_at_utc, unlinked_at_utc, source, version
         FROM ticket_schedule_links WHERE id = ?",
    )
    .bind(link_id.to_string())
    .fetch_optional(&mut **transaction)
    .await
    .map_err(|error| AppError::database("ticket-schedule-link-snapshot", error))?
    .ok_or_else(link_not_found)?;
    link_snapshot_from_row(&row)
}

async fn deactivate_link(
    transaction: &mut Transaction<'_, Sqlite>,
    before: &LinkSnapshot,
    now: DateTime<Utc>,
) -> AppResult<LinkSnapshot> {
    let next_version = before.version.saturating_add(1);
    let result = sqlx::query(
        "UPDATE ticket_schedule_links
         SET unlinked_at_utc = ?, version = ?, updated_at_utc = ?
         WHERE id = ? AND version = ? AND unlinked_at_utc IS NULL",
    )
    .bind(timestamp(now))
    .bind(i64::try_from(next_version).unwrap_or(i64::MAX))
    .bind(timestamp(now))
    .bind(before.id.to_string())
    .bind(i64::try_from(before.version).unwrap_or(i64::MAX))
    .execute(&mut **transaction)
    .await
    .map_err(|error| AppError::database("ticket-schedule-unlink-update", error))?;
    if result.rows_affected() != 1 {
        return Err(link_version_conflict());
    }
    Ok(LinkSnapshot {
        unlinked_at: Some(now),
        version: next_version,
        ..before.clone()
    })
}

#[allow(clippy::too_many_arguments)]
async fn insert_link_history(
    transaction: &mut Transaction<'_, Sqlite>,
    operation_id: Uuid,
    link_id: Uuid,
    ticket_id: Uuid,
    schedule_id: Uuid,
    action: &str,
    before: Option<&LinkSnapshot>,
    after: Option<&LinkSnapshot>,
    now: DateTime<Utc>,
) -> AppResult<()> {
    sqlx::query(
        "INSERT INTO ticket_schedule_link_history(
           operation_id, link_id, ticket_id, schedule_id, action, before_json, after_json, created_at_utc
         ) VALUES (?, ?, ?, ?, ?, ?, ?, ?)",
    )
    .bind(operation_id.to_string())
    .bind(link_id.to_string())
    .bind(ticket_id.to_string())
    .bind(schedule_id.to_string())
    .bind(action)
    .bind(
        before
            .map(serde_json::to_string)
            .transpose()
            .map_err(|error| AppError::database("ticket-schedule-history-before", error))?,
    )
    .bind(
        after
            .map(serde_json::to_string)
            .transpose()
            .map_err(|error| AppError::database("ticket-schedule-history-after", error))?,
    )
    .bind(timestamp(now))
    .execute(&mut **transaction)
    .await
    .map_err(|error| AppError::database("ticket-schedule-history-insert", error))?;
    Ok(())
}

pub(super) async fn deactivate_links_for_ticket(
    transaction: &mut Transaction<'_, Sqlite>,
    ticket_id: Uuid,
    action: &'static str,
    now: DateTime<Utc>,
) -> AppResult<u64> {
    let rows = sqlx::query(
        "SELECT id, ticket_id, schedule_id, linked_at_utc, unlinked_at_utc, source, version
         FROM ticket_schedule_links WHERE ticket_id = ? AND unlinked_at_utc IS NULL",
    )
    .bind(ticket_id.to_string())
    .fetch_all(&mut **transaction)
    .await
    .map_err(|error| AppError::database("ticket-lifecycle-links-read", error))?;
    for row in &rows {
        let before = link_snapshot_from_row(row)?;
        let after = deactivate_link(transaction, &before, now).await?;
        insert_link_history(
            transaction,
            Uuid::new_v4(),
            before.id,
            before.ticket_id,
            before.schedule_id,
            action,
            Some(&before),
            Some(&after),
            now,
        )
        .await?;
    }
    u64::try_from(rows.len())
        .map_err(|error| AppError::database("ticket-lifecycle-links-count", error))
}

pub(super) async fn deactivate_link_for_schedule(
    transaction: &mut Transaction<'_, Sqlite>,
    schedule_id: Uuid,
    now: DateTime<Utc>,
) -> AppResult<bool> {
    let Some(before) = fetch_active_link_for_schedule(transaction, schedule_id).await? else {
        return Ok(false);
    };
    let after = deactivate_link(transaction, &before, now).await?;
    insert_link_history(
        transaction,
        Uuid::new_v4(),
        before.id,
        before.ticket_id,
        before.schedule_id,
        "schedule_delete_unlink",
        Some(&before),
        Some(&after),
        now,
    )
    .await?;
    Ok(true)
}

fn link_from_joined_row(row: &SqliteRow) -> AppResult<TicketScheduleLink> {
    Ok(TicketScheduleLink {
        id: parse_uuid(row.get("link_id"), "ticket-schedule-link-id")?,
        ticket_id: parse_uuid(row.get("link_ticket_id"), "ticket-schedule-ticket-id")?,
        ticket_title: row.get("link_ticket_title"),
        schedule: row_to_schedule(row)?,
        linked_at: parse_datetime(row.get("link_linked_at_utc"), "ticket-schedule-linked-at")?,
        unlinked_at: row
            .get::<Option<String>, _>("link_unlinked_at_utc")
            .as_deref()
            .map(|value| parse_datetime(value, "ticket-schedule-unlinked-at"))
            .transpose()?,
        source: TicketScheduleSource::try_from(row.get::<&str, _>("link_source"))?,
        version: u64::try_from(row.get::<i64, _>("link_version"))
            .map_err(|error| AppError::database("ticket-schedule-link-version", error))?,
    })
}

fn link_snapshot_from_row(row: &SqliteRow) -> AppResult<LinkSnapshot> {
    Ok(LinkSnapshot {
        id: parse_uuid(row.get("id"), "ticket-schedule-snapshot-id")?,
        ticket_id: parse_uuid(row.get("ticket_id"), "ticket-schedule-snapshot-ticket")?,
        schedule_id: parse_uuid(row.get("schedule_id"), "ticket-schedule-snapshot-schedule")?,
        linked_at: parse_datetime(row.get("linked_at_utc"), "ticket-schedule-snapshot-linked")?,
        unlinked_at: row
            .get::<Option<String>, _>("unlinked_at_utc")
            .as_deref()
            .map(|value| parse_datetime(value, "ticket-schedule-snapshot-unlinked"))
            .transpose()?,
        source: TicketScheduleSource::try_from(row.get::<&str, _>("source"))?,
        version: u64::try_from(row.get::<i64, _>("version"))
            .map_err(|error| AppError::database("ticket-schedule-snapshot-version", error))?,
    })
}

fn ticket_not_found() -> AppError {
    AppError::NotFound {
        message: "対象のチケットが見つかりません。".into(),
        recovery: "チケット一覧を再読み込みしてください。".into(),
    }
}

fn link_not_found() -> AppError {
    AppError::NotFound {
        message: "予定との関連が見つかりません。".into(),
        recovery: "チケットまたは予定を再読み込みしてください。".into(),
    }
}

fn link_version_conflict() -> AppError {
    AppError::Conflict {
        message: "予定との関連は別の操作で更新されています。".into(),
        recovery: "最新の関連予定を読み込み、もう一度操作してください。".into(),
    }
}

fn operation_conflict() -> AppError {
    AppError::Conflict {
        message: "同じ操作識別子が別の予定割り当てに使用されています。".into(),
        recovery: "画面を再読み込みし、新しい操作としてやり直してください。".into(),
    }
}

#[cfg(test)]
mod tests {
    use chrono::{Duration, TimeZone};
    use sqlx::sqlite::{SqliteConnectOptions, SqlitePoolOptions};
    use std::str::FromStr;
    use tempfile::tempdir;

    use super::*;
    use crate::{
        domain::{TicketDraft, TicketPriority},
        infrastructure::ticket_repository::{DEFAULT_TICKET_BOARD_ID, INBOX_TICKET_COLUMN_ID},
    };

    fn ticket_draft(title: &str) -> TicketDraft {
        TicketDraft {
            board_id: DEFAULT_TICKET_BOARD_ID,
            column_id: INBOX_TICKET_COLUMN_ID,
            parent_ticket_id: None,
            title: title.into(),
            description: String::new(),
            priority: TicketPriority::High,
            due_date: None,
            estimate_minutes: Some(45),
            tags: Vec::new(),
            checklist: Vec::new(),
        }
    }

    fn assignment(ticket_id: Uuid, operation_id: Uuid) -> AssignTicketScheduleRequest {
        AssignTicketScheduleRequest {
            operation_id,
            ticket_id,
            expected_ticket_version: 0,
            local_start: "2026-08-03T09:00".into(),
            duration_minutes: 45,
            timezone_id: "Asia/Tokyo".into(),
            offset_choice: None,
            title_override: None,
            source: TicketScheduleSource::Board,
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
    async fn assignment_is_atomic_idempotent_and_one_ticket_can_have_many_schedules() {
        let database = Database::open_memory().await.unwrap();
        let now = Utc.with_ymd_and_hms(2026, 8, 3, 0, 0, 0).unwrap();
        let ticket = database
            .create_ticket(Uuid::new_v4(), ticket_draft("設計をまとめる"), now)
            .await
            .unwrap();
        let first_operation = Uuid::new_v4();
        let first = database
            .assign_ticket_to_new_schedule(
                &assignment(ticket.id, first_operation),
                now + Duration::hours(1),
                now + Duration::hours(1) + Duration::minutes(45),
                now,
            )
            .await
            .unwrap();
        let retry = database
            .assign_ticket_to_new_schedule(
                &assignment(ticket.id, first_operation),
                now + Duration::hours(4),
                now + Duration::hours(5),
                now + Duration::seconds(1),
            )
            .await
            .unwrap();
        assert_eq!(retry.id, first.id);

        let mut second_request = assignment(ticket.id, Uuid::new_v4());
        second_request.local_start = "2026-08-03T13:00".into();
        database
            .assign_ticket_to_new_schedule(
                &second_request,
                now + Duration::hours(4),
                now + Duration::hours(5),
                now + Duration::seconds(2),
            )
            .await
            .unwrap();

        let links = database.ticket_schedules(ticket.id, false).await.unwrap();
        assert_eq!(links.len(), 2);
        let schedule_count: i64 = sqlx::query_scalar("SELECT COUNT(*) FROM schedule_items")
            .fetch_one(&database.pool)
            .await
            .unwrap();
        let history_count: i64 =
            sqlx::query_scalar("SELECT COUNT(*) FROM ticket_schedule_link_history")
                .fetch_one(&database.pool)
                .await
                .unwrap();
        assert_eq!(schedule_count, 2);
        assert_eq!(history_count, 2);
    }

    #[tokio::test]
    async fn existing_schedule_requires_explicit_relink_and_unlink_keeps_history() {
        let database = Database::open_memory().await.unwrap();
        let now = Utc.with_ymd_and_hms(2026, 8, 3, 0, 0, 0).unwrap();
        let first_ticket = database
            .create_ticket(Uuid::new_v4(), ticket_draft("最初"), now)
            .await
            .unwrap();
        let second_ticket = database
            .create_ticket(Uuid::new_v4(), ticket_draft("次"), now)
            .await
            .unwrap();
        let linked = database
            .assign_ticket_to_new_schedule(
                &assignment(first_ticket.id, Uuid::new_v4()),
                now + Duration::hours(1),
                now + Duration::hours(2),
                now,
            )
            .await
            .unwrap();
        let conflict = LinkTicketScheduleRequest {
            operation_id: Uuid::new_v4(),
            ticket_id: second_ticket.id,
            expected_ticket_version: second_ticket.version,
            schedule_id: linked.schedule.id,
            expected_schedule_version: linked.schedule.version,
            source: TicketScheduleSource::ScheduleEditor,
            replace_existing: false,
        };
        assert!(matches!(
            database
                .link_ticket_to_existing_schedule(&conflict, now + Duration::seconds(1))
                .await,
            Err(AppError::Conflict { .. })
        ));

        let replacement = database
            .link_ticket_to_existing_schedule(
                &LinkTicketScheduleRequest {
                    replace_existing: true,
                    operation_id: Uuid::new_v4(),
                    ..conflict
                },
                now + Duration::seconds(2),
            )
            .await
            .unwrap();
        assert_eq!(replacement.ticket_id, second_ticket.id);
        let unlinked = database
            .unlink_ticket_schedule(
                &UnlinkTicketScheduleRequest {
                    operation_id: Uuid::new_v4(),
                    link_id: replacement.id,
                    expected_link_version: replacement.version,
                },
                now + Duration::seconds(3),
            )
            .await
            .unwrap();
        assert!(unlinked.unlinked_at.is_some());
        assert!(
            database
                .schedule_ticket_link(linked.schedule.id)
                .await
                .unwrap()
                .is_none()
        );
        assert_eq!(
            database
                .ticket_schedules(second_ticket.id, true)
                .await
                .unwrap()
                .len(),
            1
        );
    }

    #[tokio::test]
    async fn migration_v15_preserves_v14_ticket_and_schedule_data() {
        let options = SqliteConnectOptions::from_str("sqlite::memory:")
            .unwrap()
            .foreign_keys(true);
        let pool = SqlitePoolOptions::new()
            .max_connections(1)
            .connect_with(options)
            .await
            .unwrap();
        let v14 = sqlx::migrate::Migrator {
            migrations: std::borrow::Cow::Owned(
                super::super::database::MIGRATOR
                    .migrations
                    .iter()
                    .filter(|migration| migration.version <= 14)
                    .cloned()
                    .collect(),
            ),
            ..super::super::database::MIGRATOR
        };
        v14.run(&pool).await.unwrap();
        let now = Utc::now().to_rfc3339();
        let schedule_id = Uuid::new_v4();
        sqlx::query("INSERT INTO schedule_items(id, title, description, location, start_at_utc, end_at_utc, time_zone, all_day, status, project, category, tags_json, color, sync_status, version, created_at_utc, updated_at_utc) VALUES (?, 'preserved schedule', '', '', '2026-08-03T00:00:00Z', '2026-08-03T01:00:00Z', 'UTC', 0, 'scheduled', '', '', '[]', '#6F96F4', 'local_only', 0, ?, ?)")
            .bind(schedule_id.to_string())
            .bind(&now)
            .bind(&now)
            .execute(&pool)
            .await
            .unwrap();
        let ticket_id = Uuid::new_v4();
        sqlx::query("INSERT INTO tickets(id, board_id, column_id, title, description, priority, sort_key, version, created_at_utc, updated_at_utc) VALUES (?, ?, ?, 'preserved ticket', '', 'normal', 1024, 0, ?, ?)")
            .bind(ticket_id.to_string())
            .bind(DEFAULT_TICKET_BOARD_ID.to_string())
            .bind(INBOX_TICKET_COLUMN_ID.to_string())
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
        let tickets: i64 = sqlx::query_scalar("SELECT COUNT(*) FROM tickets")
            .fetch_one(&pool)
            .await
            .unwrap();
        let links: i64 = sqlx::query_scalar("SELECT COUNT(*) FROM ticket_schedule_links")
            .fetch_one(&pool)
            .await
            .unwrap();
        assert_eq!(version, "15");
        assert_eq!((schedules, tickets, links), (1, 1, 0));
    }

    #[tokio::test]
    async fn assignment_history_failure_rolls_back_schedule_link_and_outbox() {
        let database = Database::open_memory().await.unwrap();
        let now = Utc.with_ymd_and_hms(2026, 8, 3, 0, 0, 0).unwrap();
        let ticket = database
            .create_ticket(Uuid::new_v4(), ticket_draft("原子的に割り当てる"), now)
            .await
            .unwrap();
        sqlx::query(
            "CREATE TRIGGER synthetic_link_history_failure BEFORE INSERT ON ticket_schedule_link_history BEGIN SELECT RAISE(ABORT, 'synthetic failure'); END",
        )
        .execute(&database.pool)
        .await
        .unwrap();

        let result = database
            .assign_ticket_to_new_schedule(
                &assignment(ticket.id, Uuid::new_v4()),
                now + Duration::hours(1),
                now + Duration::hours(2),
                now,
            )
            .await;

        assert!(matches!(result, Err(AppError::Database { .. })));
        for table in [
            "schedule_items",
            "ticket_schedule_links",
            "ticket_schedule_link_history",
            "change_history",
            "sync_outbox",
        ] {
            let count: i64 = sqlx::query_scalar(&format!("SELECT COUNT(*) FROM {table}"))
                .fetch_one(&database.pool)
                .await
                .unwrap();
            assert_eq!(count, 0, "table {table} must roll back");
        }
    }

    #[tokio::test]
    async fn ticket_archive_and_schedule_delete_only_deactivate_links() {
        let database = Database::open_memory().await.unwrap();
        let now = Utc.with_ymd_and_hms(2026, 8, 3, 0, 0, 0).unwrap();
        let first_ticket = database
            .create_ticket(Uuid::new_v4(), ticket_draft("アーカイブ"), now)
            .await
            .unwrap();
        let first_link = database
            .assign_ticket_to_new_schedule(
                &assignment(first_ticket.id, Uuid::new_v4()),
                now + Duration::hours(1),
                now + Duration::hours(2),
                now,
            )
            .await
            .unwrap();
        database
            .set_ticket_archived(
                Uuid::new_v4(),
                first_ticket.id,
                first_ticket.version,
                true,
                now + Duration::seconds(1),
            )
            .await
            .unwrap();
        assert!(
            database
                .schedule_ticket_link(first_link.schedule.id)
                .await
                .unwrap()
                .is_none()
        );
        assert!(
            database
                .ticket_schedules(first_ticket.id, true)
                .await
                .unwrap()[0]
                .unlinked_at
                .is_some()
        );
        assert!(
            database
                .list_schedules(crate::domain::ScheduleQuery {
                    start_utc: now,
                    end_utc: now + Duration::days(1),
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
                .unwrap()
                .0
                .iter()
                .any(|schedule| schedule.id == first_link.schedule.id)
        );

        let second_ticket = database
            .create_ticket(Uuid::new_v4(), ticket_draft("予定削除"), now)
            .await
            .unwrap();
        let second_link = database
            .assign_ticket_to_new_schedule(
                &assignment(second_ticket.id, Uuid::new_v4()),
                now + Duration::hours(3),
                now + Duration::hours(4),
                now,
            )
            .await
            .unwrap();
        database
            .delete_schedule_scoped(
                second_link.schedule.id,
                second_link.schedule.version,
                crate::domain::RecurrenceEditScope::Series,
                None,
            )
            .await
            .unwrap();
        assert!(database.ticket(second_ticket.id).await.is_ok());
        assert!(
            database
                .schedule_ticket_link(second_link.schedule.id)
                .await
                .unwrap()
                .is_none()
        );
        assert_eq!(
            database
                .ticket_planning_summaries(&[second_ticket.id], now)
                .await
                .unwrap()[0]
                .schedule_count,
            0
        );

        let deleted_ticket = database
            .create_ticket(Uuid::new_v4(), ticket_draft("チケット削除"), now)
            .await
            .unwrap();
        let retained_schedule = database
            .assign_ticket_to_new_schedule(
                &assignment(deleted_ticket.id, Uuid::new_v4()),
                now + Duration::hours(5),
                now + Duration::hours(6),
                now,
            )
            .await
            .unwrap();
        database
            .delete_ticket(
                Uuid::new_v4(),
                deleted_ticket.id,
                deleted_ticket.version,
                now + Duration::seconds(4),
            )
            .await
            .unwrap();
        assert!(
            database
                .schedule(retained_schedule.schedule.id)
                .await
                .unwrap()
                .deleted_at
                .is_none()
        );
        assert!(
            database
                .schedule_ticket_link(retained_schedule.schedule.id)
                .await
                .unwrap()
                .is_none()
        );
    }

    #[tokio::test]
    async fn planning_summary_follows_schedule_resize_move_and_timezone_change() {
        let database = Database::open_memory().await.unwrap();
        let now = Utc.with_ymd_and_hms(2026, 8, 3, 0, 0, 0).unwrap();
        let ticket = database
            .create_ticket(Uuid::new_v4(), ticket_draft("集計更新"), now)
            .await
            .unwrap();
        let link = database
            .assign_ticket_to_new_schedule(
                &assignment(ticket.id, Uuid::new_v4()),
                now + Duration::hours(1),
                now + Duration::hours(2),
                now,
            )
            .await
            .unwrap();
        let mut changed = link.schedule.draft.clone();
        changed.start_utc = now + Duration::days(1) + Duration::hours(2);
        changed.end_utc = changed.start_utc + Duration::minutes(150);
        changed.timezone_id = "America/New_York".into();
        database
            .update_schedule(link.schedule.id, link.schedule.version, changed)
            .await
            .unwrap();

        let summary = &database
            .ticket_planning_summaries(&[ticket.id], now)
            .await
            .unwrap()[0];
        assert_eq!(summary.schedule_count, 1);
        assert_eq!(summary.future_planned_minutes, 150);
        assert_eq!(summary.total_planned_minutes, 150);
        assert_eq!(
            summary.next_scheduled_at,
            Some(now + Duration::days(1) + Duration::hours(2))
        );
    }

    #[tokio::test]
    async fn offline_outbox_and_operation_retry_survive_restart_without_duplicate_schedule() {
        let directory = tempdir().unwrap();
        let path = directory.path().join("ticket-schedule.sqlite3");
        let database = Database::open(&path).await.unwrap();
        connect_default_calendar(&database).await;
        let now = Utc.with_ymd_and_hms(2026, 8, 3, 0, 0, 0).unwrap();
        let ticket = database
            .create_ticket(Uuid::new_v4(), ticket_draft("再起動後も一度"), now)
            .await
            .unwrap();
        let operation_id = Uuid::new_v4();
        let request = assignment(ticket.id, operation_id);
        let first = database
            .assign_ticket_to_new_schedule(
                &request,
                now + Duration::hours(1),
                now + Duration::hours(2),
                now,
            )
            .await
            .unwrap();
        assert_eq!(first.schedule.sync_status, SyncStatus::Pending);
        database.pool.close().await;

        let restarted = Database::open(&path).await.unwrap();
        let retry = restarted
            .assign_ticket_to_new_schedule(
                &request,
                now + Duration::hours(5),
                now + Duration::hours(6),
                now + Duration::seconds(1),
            )
            .await
            .unwrap();
        let schedule_count: i64 = sqlx::query_scalar("SELECT COUNT(*) FROM schedule_items")
            .fetch_one(&restarted.pool)
            .await
            .unwrap();
        let pending_outbox: i64 =
            sqlx::query_scalar("SELECT COUNT(*) FROM sync_outbox WHERE completed_at_utc IS NULL")
                .fetch_one(&restarted.pool)
                .await
                .unwrap();
        assert_eq!(retry.id, first.id);
        assert_eq!((schedule_count, pending_outbox), (1, 1));
    }
}
