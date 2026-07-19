use chrono::{DateTime, Datelike, Days, Duration, LocalResult, NaiveTime, TimeZone, Utc};
use chrono_tz::Tz;
use serde::{Deserialize, Serialize};
use sha2::{Digest, Sha256};
use sqlx::Row;
use uuid::Uuid;

use crate::domain::{AppError, AppResult, FocusPhase, Settings};

use super::Database;

#[derive(Debug, Clone, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct NotificationDelivery {
    pub delivery_key: String,
    pub title: String,
    pub body: String,
    pub occurrence_at: DateTime<Utc>,
    pub os_notification: bool,
    pub sound: bool,
}

#[derive(Debug, Clone, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct NotificationLedgerItem {
    pub occurrence_at: DateTime<Utc>,
    pub attempted_at: DateTime<Utc>,
    pub result: String,
    pub error_category: Option<String>,
}

#[derive(Debug, Clone, Copy, Deserialize)]
#[serde(rename_all = "snake_case")]
pub enum DeliveryResult {
    Delivered,
    Skipped,
    Failed,
    Expired,
}

impl DeliveryResult {
    fn as_str(self) -> &'static str {
        match self {
            Self::Delivered => "delivered",
            Self::Skipped => "skipped",
            Self::Failed => "failed",
            Self::Expired => "expired",
        }
    }
}

#[derive(Debug, Clone)]
struct Candidate {
    entity_type: &'static str,
    entity_id: String,
    phase: &'static str,
    offset_minutes: i32,
    occurrence_at: DateTime<Utc>,
    title: String,
    body: String,
    os_notification: bool,
    sound: bool,
}

impl Database {
    pub async fn notification_ledger(&self) -> AppResult<Vec<NotificationLedgerItem>> {
        let rows = sqlx::query(
            "SELECT occurrence_at_utc, attempted_at_utc, result, error_category FROM notification_deliveries ORDER BY attempted_at_utc DESC LIMIT 100",
        )
        .fetch_all(&self.pool)
        .await
        .map_err(|error| AppError::database("notification-ledger", error))?;
        rows.into_iter()
            .map(|row| {
                Ok(NotificationLedgerItem {
                    occurrence_at: parse_datetime(row.get("occurrence_at_utc"))?,
                    attempted_at: parse_datetime(row.get("attempted_at_utc"))?,
                    result: row.get("result"),
                    error_category: row.get("error_category"),
                })
            })
            .collect()
    }

    pub async fn poll_notifications(
        &self,
        now: DateTime<Utc>,
    ) -> AppResult<Vec<NotificationDelivery>> {
        let settings = self.settings().await?;
        let stored_last: Option<String> =
            sqlx::query_scalar("SELECT value FROM app_meta WHERE key = 'notification_last_check'")
                .fetch_optional(&self.pool)
                .await
                .map_err(|error| AppError::database("notification-last-check", error))?;
        let grace_cutoff = now - Duration::minutes(i64::from(settings.notification_grace_minutes));
        let last_check = stored_last
            .as_deref()
            .and_then(|value| DateTime::parse_from_rfc3339(value).ok())
            .map(|value| value.with_timezone(&Utc))
            .unwrap_or(now - Duration::seconds(30))
            .max(grace_cutoff)
            .min(now);
        let mut candidates = Vec::new();
        if settings.schedule_notifications_enabled {
            candidates.extend(self.schedule_candidates(last_check, now, &settings).await?);
            candidates.extend(
                self.quick_block_candidates(last_check, now, &settings)
                    .await?,
            );
        }
        candidates.extend(
            self.free_alarm_candidates(last_check, now, &settings)
                .await?,
        );
        if settings.focus_notifications_enabled {
            candidates.extend(self.focus_candidates(last_check, now, &settings).await?);
        }
        candidates.sort_by_key(|candidate| candidate.occurrence_at);
        candidates.truncate(usize::from(settings.notification_max_replay));

        let mut transaction = self
            .pool
            .begin()
            .await
            .map_err(|error| AppError::database("notification-claim-begin", error))?;
        let mut deliveries = Vec::new();
        for candidate in candidates {
            let rule_id = ensure_rule(&mut transaction, &candidate).await?;
            let delivery_key = delivery_key(&candidate);
            let result = sqlx::query(
                "INSERT OR IGNORE INTO notification_deliveries(delivery_key, rule_id, occurrence_at_utc, result, attempted_at_utc, error_category) VALUES (?, ?, ?, 'failed', ?, 'delivery_pending')",
            )
            .bind(&delivery_key)
            .bind(rule_id)
            .bind(candidate.occurrence_at.to_rfc3339())
            .bind(now.to_rfc3339())
            .execute(&mut *transaction)
            .await
            .map_err(|error| AppError::database("notification-claim", error))?;
            if result.rows_affected() == 1 {
                if candidate.os_notification || candidate.sound {
                    deliveries.push(NotificationDelivery {
                        delivery_key,
                        title: candidate.title,
                        body: candidate.body,
                        occurrence_at: candidate.occurrence_at,
                        os_notification: candidate.os_notification,
                        sound: candidate.sound,
                    });
                } else {
                    sqlx::query(
                        "UPDATE notification_deliveries SET result = 'skipped', error_category = 'channels_disabled' WHERE delivery_key = ?",
                    )
                    .bind(delivery_key)
                    .execute(&mut *transaction)
                    .await
                    .map_err(|error| AppError::database("notification-skip", error))?;
                }
            }
        }
        sqlx::query(
            "INSERT INTO app_meta(key, value, updated_at_utc) VALUES ('notification_last_check', ?, ?) ON CONFLICT(key) DO UPDATE SET value = excluded.value, updated_at_utc = excluded.updated_at_utc",
        )
        .bind(now.to_rfc3339())
        .bind(now.to_rfc3339())
        .execute(&mut *transaction)
        .await
        .map_err(|error| AppError::database("notification-last-check-save", error))?;
        transaction
            .commit()
            .await
            .map_err(|error| AppError::database("notification-claim-commit", error))?;
        Ok(deliveries)
    }

    pub async fn record_notification_result(
        &self,
        delivery_key: &str,
        result: DeliveryResult,
        error_category: Option<&str>,
    ) -> AppResult<()> {
        if delivery_key.len() != 64 || !delivery_key.bytes().all(|byte| byte.is_ascii_hexdigit()) {
            return Err(AppError::Validation {
                message: "通知結果の識別子が正しくありません。".into(),
                recovery: "アプリを再起動してください。通知履歴以外のデータは変更されません。"
                    .into(),
            });
        }
        let category = error_category.filter(|value| {
            value.len() <= 80
                && value
                    .bytes()
                    .all(|byte| byte.is_ascii_alphanumeric() || byte == b'_')
        });
        let update = sqlx::query(
            "UPDATE notification_deliveries SET result = ?, attempted_at_utc = ?, error_category = ? WHERE delivery_key = ?",
        )
        .bind(result.as_str())
        .bind(Utc::now().to_rfc3339())
        .bind(category)
        .bind(delivery_key)
        .execute(&self.pool)
        .await
        .map_err(|error| AppError::database("notification-result", error))?;
        if update.rows_affected() == 1 {
            Ok(())
        } else {
            Err(AppError::NotFound {
                message: "通知履歴が見つかりません。".into(),
                recovery: "データを再読込してください。".into(),
            })
        }
    }

    async fn schedule_candidates(
        &self,
        after: DateTime<Utc>,
        now: DateTime<Utc>,
        settings: &Settings,
    ) -> AppResult<Vec<Candidate>> {
        let future = now + Duration::days(7);
        let rows = sqlx::query(
            "SELECT id, title, start_at_utc, end_at_utc, start_notification_minutes, end_notification_minutes FROM schedule_items WHERE deleted_at_utc IS NULL AND (start_notification_minutes IS NOT NULL OR end_notification_minutes IS NOT NULL) AND start_at_utc <= ? AND end_at_utc >= ?",
        )
        .bind(future.to_rfc3339())
        .bind((after - Duration::days(7)).to_rfc3339())
        .fetch_all(&self.pool)
        .await
        .map_err(|error| AppError::database("notification-schedule-query", error))?;
        let mut candidates = Vec::new();
        for row in rows {
            let entity_id: String = row.get("id");
            let title: String = row.get("title");
            let start = parse_datetime(row.get::<&str, _>("start_at_utc"))?;
            let end = parse_datetime(row.get::<&str, _>("end_at_utc"))?;
            if let Some(minutes) = row.get::<Option<i64>, _>("start_notification_minutes") {
                let occurrence = start - Duration::minutes(minutes);
                if occurrence > after && occurrence <= now {
                    candidates.push(Candidate {
                        entity_type: "schedule",
                        entity_id: entity_id.clone(),
                        phase: "start",
                        offset_minutes: -(minutes as i32),
                        occurrence_at: occurrence,
                        title: "予定の開始".into(),
                        body: title.clone(),
                        os_notification: settings.os_notifications_enabled,
                        sound: settings.sound_notifications_enabled,
                    });
                }
            }
            if let Some(minutes) = row.get::<Option<i64>, _>("end_notification_minutes") {
                let occurrence = end - Duration::minutes(minutes);
                if occurrence > after && occurrence <= now {
                    candidates.push(Candidate {
                        entity_type: "schedule",
                        entity_id,
                        phase: "end",
                        offset_minutes: -(minutes as i32),
                        occurrence_at: occurrence,
                        title: "予定の終了".into(),
                        body: title,
                        os_notification: settings.os_notifications_enabled,
                        sound: settings.sound_notifications_enabled,
                    });
                }
            }
        }
        Ok(candidates)
    }

    async fn free_alarm_candidates(
        &self,
        after: DateTime<Utc>,
        now: DateTime<Utc>,
        settings: &Settings,
    ) -> AppResult<Vec<Candidate>> {
        let rows = sqlx::query(
            "SELECT id, label, minute_of_day, time_zone, weekdays_mask FROM free_alarms WHERE enabled = 1",
        )
        .fetch_all(&self.pool)
        .await
        .map_err(|error| AppError::database("notification-alarm-query", error))?;
        let mut candidates = Vec::new();
        for row in rows {
            let timezone: Tz = row
                .get::<&str, _>("time_zone")
                .parse()
                .map_err(|error| AppError::database("notification-alarm-timezone", error))?;
            let minute = row.get::<i64, _>("minute_of_day").clamp(0, 1_439) as u32;
            let time = NaiveTime::from_hms_opt(minute / 60, minute % 60, 0)
                .ok_or_else(|| AppError::database("notification-alarm-time", "invalid time"))?;
            let weekdays = row.get::<i64, _>("weekdays_mask");
            let local_after = after.with_timezone(&timezone).date_naive();
            let local_now = now.with_timezone(&timezone).date_naive();
            for date in [local_after, local_now] {
                let weekday = i64::from(date.weekday().num_days_from_monday());
                if weekdays & (1_i64 << weekday) == 0 {
                    continue;
                }
                let local = date.and_time(time);
                let occurrence = match timezone.from_local_datetime(&local) {
                    LocalResult::Single(value) => value.with_timezone(&Utc),
                    LocalResult::None | LocalResult::Ambiguous(_, _) => continue,
                };
                if occurrence > after && occurrence <= now {
                    candidates.push(Candidate {
                        entity_type: "free_alarm",
                        entity_id: row.get("id"),
                        phase: "alarm",
                        offset_minutes: 0,
                        occurrence_at: occurrence,
                        title: "アラーム".into(),
                        body: row.get("label"),
                        os_notification: settings.os_notifications_enabled,
                        sound: settings.sound_notifications_enabled,
                    });
                }
            }
        }
        Ok(candidates)
    }

    async fn quick_block_candidates(
        &self,
        after: DateTime<Utc>,
        now: DateTime<Utc>,
        settings: &Settings,
    ) -> AppResult<Vec<Candidate>> {
        let rows = sqlx::query(
            "SELECT id, title, start_minute, duration_minutes, time_zone, start_notification_minutes, end_notification_minutes FROM quick_blocks WHERE is_active = 1 AND (start_notification_minutes IS NOT NULL OR end_notification_minutes IS NOT NULL)",
        )
        .fetch_all(&self.pool)
        .await
        .map_err(|error| AppError::database("notification-quick-block-query", error))?;
        let mut candidates = Vec::new();
        for row in rows {
            let timezone: Tz = row
                .get::<&str, _>("time_zone")
                .parse()
                .map_err(|error| AppError::database("notification-quick-block-timezone", error))?;
            let minute = row.get::<i64, _>("start_minute").clamp(0, 1_439) as u32;
            let time = NaiveTime::from_hms_opt(minute / 60, minute % 60, 0).ok_or_else(|| {
                AppError::database("notification-quick-block-time", "invalid time")
            })?;
            let first_date = after
                .with_timezone(&timezone)
                .date_naive()
                .checked_sub_days(Days::new(1))
                .unwrap_or_else(|| after.with_timezone(&timezone).date_naive());
            let last_date = now
                .with_timezone(&timezone)
                .date_naive()
                .checked_add_days(Days::new(8))
                .unwrap_or_else(|| now.with_timezone(&timezone).date_naive());
            let mut date = first_date;
            while date <= last_date {
                let local = date.and_time(time);
                let start = match timezone.from_local_datetime(&local) {
                    LocalResult::Single(value) => value.with_timezone(&Utc),
                    LocalResult::None | LocalResult::Ambiguous(_, _) => {
                        date = match date.checked_add_days(Days::new(1)) {
                            Some(next) => next,
                            None => break,
                        };
                        continue;
                    }
                };
                let entity_id: String = row.get("id");
                let body: String = row.get("title");
                if let Some(minutes) = row.get::<Option<i64>, _>("start_notification_minutes") {
                    let occurrence = start - Duration::minutes(minutes);
                    if occurrence > after && occurrence <= now {
                        candidates.push(Candidate {
                            entity_type: "quick_block",
                            entity_id: entity_id.clone(),
                            phase: "start",
                            offset_minutes: -(minutes as i32),
                            occurrence_at: occurrence,
                            title: "Quick Blockの開始".into(),
                            body: body.clone(),
                            os_notification: settings.os_notifications_enabled,
                            sound: settings.sound_notifications_enabled,
                        });
                    }
                }
                if let Some(minutes) = row.get::<Option<i64>, _>("end_notification_minutes") {
                    let end = start + Duration::minutes(row.get::<i64, _>("duration_minutes"));
                    let occurrence = end - Duration::minutes(minutes);
                    if occurrence > after && occurrence <= now {
                        candidates.push(Candidate {
                            entity_type: "quick_block",
                            entity_id: entity_id.clone(),
                            phase: "end",
                            offset_minutes: -(minutes as i32),
                            occurrence_at: occurrence,
                            title: "Quick Blockの終了".into(),
                            body: body.clone(),
                            os_notification: settings.os_notifications_enabled,
                            sound: settings.sound_notifications_enabled,
                        });
                    }
                }
                date = match date.checked_add_days(Days::new(1)) {
                    Some(next) => next,
                    None => break,
                };
            }
        }
        Ok(candidates)
    }

    async fn focus_candidates(
        &self,
        after: DateTime<Utc>,
        now: DateTime<Utc>,
        settings: &Settings,
    ) -> AppResult<Vec<Candidate>> {
        let row = sqlx::query(
            "SELECT id, phase, started_at_utc, accumulated_seconds, cycle FROM focus_sessions WHERE ended_at_utc IS NULL ORDER BY started_at_utc DESC LIMIT 1",
        )
        .fetch_optional(&self.pool)
        .await
        .map_err(|error| AppError::database("notification-focus-query", error))?;
        let Some(row) = row else {
            return Ok(Vec::new());
        };
        let phase = FocusPhase::try_from(row.get::<&str, _>("phase"))?;
        if !matches!(phase, FocusPhase::Working | FocusPhase::Break) {
            return Ok(Vec::new());
        }
        let cycle = row.get::<i64, _>("cycle").max(0) as u32;
        let planned_minutes = if phase == FocusPhase::Working {
            settings.focus_work_minutes
        } else if (cycle + 1).is_multiple_of(u32::from(settings.focus_long_break_every)) {
            settings.focus_long_break_minutes
        } else {
            settings.focus_break_minutes
        };
        let started = parse_datetime(row.get::<&str, _>("started_at_utc"))?;
        let accumulated = row.get::<i64, _>("accumulated_seconds").max(0);
        let occurrence = started
            + Duration::seconds(
                i64::from(planned_minutes) * 60 - accumulated.min(i64::from(planned_minutes) * 60),
            );
        if occurrence <= after || occurrence > now {
            return Ok(Vec::new());
        }
        Ok(vec![Candidate {
            entity_type: "focus",
            entity_id: row.get("id"),
            phase: if phase == FocusPhase::Working {
                "work_end"
            } else {
                "break_end"
            },
            offset_minutes: 0,
            occurrence_at: occurrence,
            title: if phase == FocusPhase::Working {
                "Focus作業が終了しました"
            } else {
                "Focus休憩が終了しました"
            }
            .into(),
            body: if phase == FocusPhase::Working {
                "休憩へ切り替えます。"
            } else if settings.focus_auto_start {
                "次の作業を開始します。"
            } else {
                "次の作業は待機中です。"
            }
            .into(),
            os_notification: settings.os_notifications_enabled,
            sound: settings.sound_notifications_enabled,
        }])
    }
}

async fn ensure_rule(
    transaction: &mut sqlx::Transaction<'_, sqlx::Sqlite>,
    candidate: &Candidate,
) -> AppResult<String> {
    let existing: Option<String> = sqlx::query_scalar(
        "SELECT id FROM notification_rules WHERE entity_type = ? AND entity_id = ? AND phase = ? AND offset_minutes = ?",
    )
    .bind(candidate.entity_type)
    .bind(&candidate.entity_id)
    .bind(candidate.phase)
    .bind(candidate.offset_minutes)
    .fetch_optional(&mut **transaction)
    .await
    .map_err(|error| AppError::database("notification-rule-read", error))?;
    if let Some(id) = existing {
        return Ok(id);
    }
    let id = Uuid::new_v4().to_string();
    sqlx::query(
        "INSERT INTO notification_rules(id, entity_type, entity_id, phase, offset_minutes, enabled) VALUES (?, ?, ?, ?, ?, 1)",
    )
    .bind(&id)
    .bind(candidate.entity_type)
    .bind(&candidate.entity_id)
    .bind(candidate.phase)
    .bind(candidate.offset_minutes)
    .execute(&mut **transaction)
    .await
    .map_err(|error| AppError::database("notification-rule-insert", error))?;
    Ok(id)
}

fn delivery_key(candidate: &Candidate) -> String {
    let input = format!(
        "{}:{}:{}:{}:{}",
        candidate.entity_type,
        candidate.entity_id,
        candidate.phase,
        candidate.offset_minutes,
        candidate.occurrence_at.to_rfc3339()
    );
    format!("{:x}", Sha256::digest(input.as_bytes()))
}

fn parse_datetime(value: &str) -> AppResult<DateTime<Utc>> {
    DateTime::parse_from_rfc3339(value)
        .map(|value| value.with_timezone(&Utc))
        .map_err(|error| AppError::database("notification-datetime", error))
}

#[cfg(test)]
mod tests {
    use chrono::TimeZone;

    use crate::domain::{Priority, QuickBlockDraft, ScheduleDraft, ScheduleStatus};

    use super::*;

    #[tokio::test]
    async fn delivery_ledger_claim_is_idempotent_across_repeated_poll() {
        let database = Database::open_memory().await.unwrap();
        let start = Utc.with_ymd_and_hms(2026, 7, 20, 10, 0, 0).unwrap();
        database
            .create_schedule(ScheduleDraft {
                title: "通知対象".into(),
                description: String::new(),
                location: String::new(),
                start_utc: start,
                end_utc: start + Duration::hours(1),
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
                start_notification_minutes: Some(10),
                end_notification_minutes: None,
            })
            .await
            .unwrap();
        let now = start - Duration::minutes(10);
        sqlx::query(
            "INSERT OR REPLACE INTO app_meta(key, value, updated_at_utc) VALUES ('notification_last_check', ?, ?)",
        )
        .bind((now - Duration::seconds(1)).to_rfc3339())
        .bind(now.to_rfc3339())
        .execute(&database.pool)
        .await
        .unwrap();
        assert_eq!(database.poll_notifications(now).await.unwrap().len(), 1);
        assert!(database.poll_notifications(now).await.unwrap().is_empty());
        let count: i64 = sqlx::query_scalar("SELECT COUNT(*) FROM notification_deliveries")
            .fetch_one(&database.pool)
            .await
            .unwrap();
        assert_eq!(count, 1);
        let ledger = database.notification_ledger().await.unwrap();
        assert_eq!(ledger.len(), 1);
        assert_eq!(ledger[0].result, "failed");
        assert_eq!(
            ledger[0].error_category.as_deref(),
            Some("delivery_pending")
        );
    }

    #[tokio::test]
    async fn quick_block_notifications_follow_active_state_and_use_persistent_keys() {
        let database = Database::open_memory().await.unwrap();
        let now = Utc.with_ymd_and_hms(2026, 7, 20, 10, 0, 0).unwrap();
        let block = database
            .save_quick_block(
                None,
                None,
                QuickBlockDraft {
                    title: "朝の確認".into(),
                    start_minute: 600,
                    duration_minutes: 30,
                    timezone_id: "UTC".into(),
                    color: "#68B984".into(),
                    project: String::new(),
                    category: String::new(),
                    start_notification_minutes: Some(0),
                    end_notification_minutes: None,
                    is_active: false,
                },
            )
            .await
            .unwrap();
        set_last_check(&database, now - Duration::seconds(1), now).await;
        assert!(database.poll_notifications(now).await.unwrap().is_empty());
        assert_eq!(
            sqlx::query_scalar::<_, i64>("SELECT COUNT(*) FROM notification_deliveries")
                .fetch_one(&database.pool)
                .await
                .unwrap(),
            0
        );

        database
            .save_quick_block(
                Some(block.id),
                Some(block.version),
                QuickBlockDraft {
                    is_active: true,
                    ..block.draft
                },
            )
            .await
            .unwrap();
        set_last_check(&database, now - Duration::seconds(1), now).await;
        assert_eq!(database.poll_notifications(now).await.unwrap().len(), 1);
        set_last_check(&database, now - Duration::seconds(1), now).await;
        assert!(database.poll_notifications(now).await.unwrap().is_empty());
    }

    async fn set_last_check(database: &Database, after: DateTime<Utc>, now: DateTime<Utc>) {
        sqlx::query(
            "INSERT OR REPLACE INTO app_meta(key, value, updated_at_utc) VALUES ('notification_last_check', ?, ?)",
        )
        .bind(after.to_rfc3339())
        .bind(now.to_rfc3339())
        .execute(&database.pool)
        .await
        .unwrap();
    }
}
