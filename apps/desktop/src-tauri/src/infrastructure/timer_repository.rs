use chrono::{DateTime, SecondsFormat, Utc};
use sqlx::Row;
use uuid::Uuid;

use crate::domain::{
    AppError, AppResult, StopwatchStatus, TimerDraft, TimerSet, TimerSetItem, TimerStatus,
    normalize_timer_set_name,
};

use super::Database;

const MAX_ACTIVE_TIMERS: i64 = 500;

#[derive(Debug, Clone)]
pub struct TimerRecord {
    pub id: Uuid,
    pub label: String,
    pub duration_seconds: u64,
    pub status: TimerStatus,
    pub started_at: Option<DateTime<Utc>>,
    pub elapsed_before_start_seconds: u64,
    pub run_id: Option<Uuid>,
    pub version: u64,
}

#[derive(Debug, Clone)]
pub struct StopwatchRecord {
    pub status: StopwatchStatus,
    pub started_at: Option<DateTime<Utc>>,
    pub elapsed_before_start_seconds: u64,
    pub version: u64,
}

impl Database {
    pub async fn timer_records(&self) -> AppResult<Vec<TimerRecord>> {
        let rows = sqlx::query("SELECT * FROM timers ORDER BY sort_order, created_at_utc, id")
            .fetch_all(&self.pool)
            .await
            .map_err(|error| AppError::database("timer-list", error))?;
        rows.into_iter().map(timer_record_from_row).collect()
    }

    pub async fn timer_record(&self, id: Uuid) -> AppResult<TimerRecord> {
        let row = sqlx::query("SELECT * FROM timers WHERE id = ?")
            .bind(id.to_string())
            .fetch_optional(&self.pool)
            .await
            .map_err(|error| AppError::database("timer-read", error))?;
        row.map(timer_record_from_row)
            .transpose()?
            .ok_or_else(timer_not_found)
    }

    pub async fn create_timer(&self, draft: TimerDraft) -> AppResult<TimerRecord> {
        let draft = draft.normalized()?;
        let count: i64 = sqlx::query_scalar("SELECT COUNT(*) FROM timers")
            .fetch_one(&self.pool)
            .await
            .map_err(|error| AppError::database("timer-count", error))?;
        if count >= MAX_ACTIVE_TIMERS {
            return Err(AppError::Validation {
                message: "タイマーは500件まで追加できます。".into(),
                recovery: "不要なタイマーを削除してから追加してください。".into(),
            });
        }
        let sort_order: i64 =
            sqlx::query_scalar("SELECT COALESCE(MAX(sort_order), -1) + 1 FROM timers")
                .fetch_one(&self.pool)
                .await
                .map_err(|error| AppError::database("timer-next-order", error))?;
        let id = Uuid::new_v4();
        let now = timestamp(Utc::now());
        sqlx::query(
            "INSERT INTO timers(id, label, duration_seconds, status, started_at_utc, elapsed_before_start_seconds, run_id, sort_order, version, created_at_utc, updated_at_utc) VALUES (?, ?, ?, 'idle', NULL, 0, NULL, ?, 0, ?, ?)",
        )
        .bind(id.to_string())
        .bind(draft.label)
        .bind(draft.duration_seconds as i64)
        .bind(sort_order)
        .bind(&now)
        .bind(&now)
        .execute(&self.pool)
        .await
        .map_err(|error| AppError::database("timer-create", error))?;
        self.timer_record(id).await
    }

    pub async fn update_timer_config(
        &self,
        id: Uuid,
        expected_version: u64,
        draft: TimerDraft,
    ) -> AppResult<TimerRecord> {
        let draft = draft.normalized()?;
        let current = self.timer_record(id).await?;
        if current.version != expected_version {
            return Err(timer_version_conflict());
        }
        if matches!(current.status, TimerStatus::Running | TimerStatus::Paused) {
            return Err(AppError::Conflict {
                message: "実行中または一時停止中のタイマーは編集できません。".into(),
                recovery: "タイマーをリセットしてからラベルまたは時間を変更してください。".into(),
            });
        }
        let result = sqlx::query(
            "UPDATE timers SET label = ?, duration_seconds = ?, status = 'idle', started_at_utc = NULL, elapsed_before_start_seconds = 0, run_id = NULL, version = version + 1, updated_at_utc = ? WHERE id = ? AND version = ?",
        )
        .bind(draft.label)
        .bind(draft.duration_seconds as i64)
        .bind(timestamp(Utc::now()))
        .bind(id.to_string())
        .bind(expected_version as i64)
        .execute(&self.pool)
        .await
        .map_err(|error| AppError::database("timer-config-update", error))?;
        if result.rows_affected() != 1 {
            return Err(timer_version_conflict());
        }
        self.timer_record(id).await
    }

    pub async fn save_timer_record(
        &self,
        record: &TimerRecord,
        expected_version: u64,
    ) -> AppResult<TimerRecord> {
        let result = sqlx::query(
            "UPDATE timers SET status = ?, started_at_utc = ?, elapsed_before_start_seconds = ?, run_id = ?, version = version + 1, updated_at_utc = ? WHERE id = ? AND version = ?",
        )
        .bind(record.status.as_str())
        .bind(record.started_at.map(timestamp))
        .bind(record.elapsed_before_start_seconds as i64)
        .bind(record.run_id.map(|value| value.to_string()))
        .bind(timestamp(Utc::now()))
        .bind(record.id.to_string())
        .bind(expected_version as i64)
        .execute(&self.pool)
        .await
        .map_err(|error| AppError::database("timer-state-update", error))?;
        if result.rows_affected() != 1 {
            return Err(timer_version_conflict());
        }
        self.timer_record(record.id).await
    }

    pub async fn complete_timer(
        &self,
        record: &TimerRecord,
        expected_version: u64,
        completed_at: DateTime<Utc>,
    ) -> AppResult<TimerRecord> {
        let run_id = record.run_id.ok_or_else(|| {
            AppError::database("timer-complete-run", "running timer has no run id")
        })?;
        let mut transaction = self
            .pool
            .begin()
            .await
            .map_err(|error| AppError::database("timer-complete-begin", error))?;
        let result = sqlx::query(
            "UPDATE timers SET status = 'completed', started_at_utc = NULL, elapsed_before_start_seconds = duration_seconds, version = version + 1, updated_at_utc = ? WHERE id = ? AND version = ? AND status = 'running' AND run_id = ?",
        )
        .bind(timestamp(completed_at))
        .bind(record.id.to_string())
        .bind(expected_version as i64)
        .bind(run_id.to_string())
        .execute(&mut *transaction)
        .await
        .map_err(|error| AppError::database("timer-complete-update", error))?;
        if result.rows_affected() != 1 {
            transaction
                .rollback()
                .await
                .map_err(|error| AppError::database("timer-complete-rollback", error))?;
            return Err(timer_version_conflict());
        }
        sqlx::query(
            "INSERT OR IGNORE INTO timer_run_completions(run_id, timer_id, label, completed_at_utc) VALUES (?, ?, ?, ?)",
        )
        .bind(run_id.to_string())
        .bind(record.id.to_string())
        .bind(&record.label)
        .bind(timestamp(completed_at))
        .execute(&mut *transaction)
        .await
        .map_err(|error| AppError::database("timer-complete-event", error))?;
        transaction
            .commit()
            .await
            .map_err(|error| AppError::database("timer-complete-commit", error))?;
        self.timer_record(record.id).await
    }

    pub async fn delete_timer(&self, id: Uuid, expected_version: u64) -> AppResult<()> {
        let result = sqlx::query("DELETE FROM timers WHERE id = ? AND version = ?")
            .bind(id.to_string())
            .bind(expected_version as i64)
            .execute(&self.pool)
            .await
            .map_err(|error| AppError::database("timer-delete", error))?;
        if result.rows_affected() == 1 {
            Ok(())
        } else {
            Err(timer_version_conflict())
        }
    }

    pub async fn list_timer_sets(&self) -> AppResult<Vec<TimerSet>> {
        let rows = sqlx::query(
            "SELECT id, name, version FROM timer_sets ORDER BY name COLLATE NOCASE, id",
        )
        .fetch_all(&self.pool)
        .await
        .map_err(|error| AppError::database("timer-set-list", error))?;
        let mut sets = Vec::with_capacity(rows.len());
        for row in rows {
            let id = parse_uuid(row.get::<&str, _>("id"), "timer-set-id")?;
            sets.push(TimerSet {
                id,
                name: row.get("name"),
                version: row.get::<i64, _>("version").max(0) as u64,
                items: self.timer_set_items(id).await?,
            });
        }
        Ok(sets)
    }

    async fn timer_set_items(&self, timer_set_id: Uuid) -> AppResult<Vec<TimerSetItem>> {
        let rows = sqlx::query(
            "SELECT label, duration_seconds, sort_order FROM timer_set_items WHERE timer_set_id = ? ORDER BY sort_order, id",
        )
        .bind(timer_set_id.to_string())
        .fetch_all(&self.pool)
        .await
        .map_err(|error| AppError::database("timer-set-items", error))?;
        Ok(rows
            .into_iter()
            .map(|row| TimerSetItem {
                label: row.get("label"),
                duration_seconds: row.get::<i64, _>("duration_seconds").max(0) as u64,
                sort_order: row.get::<i64, _>("sort_order") as i32,
            })
            .collect())
    }

    pub async fn save_current_timers_as_set(&self, name: String) -> AppResult<TimerSet> {
        let name = normalize_timer_set_name(name)?;
        let existing: i64 = sqlx::query_scalar(
            "SELECT EXISTS(SELECT 1 FROM timer_sets WHERE name = ? COLLATE NOCASE)",
        )
        .bind(&name)
        .fetch_one(&self.pool)
        .await
        .map_err(|error| AppError::database("timer-set-name-check", error))?;
        if existing != 0 {
            return Err(AppError::Conflict {
                message: "同じ名前のタイマー構成セットがあります。".into(),
                recovery: "別のセット名を入力してください。現在のタイマーは変更されていません。"
                    .into(),
            });
        }
        let timers = self.timer_records().await?;
        if timers.is_empty() {
            return Err(AppError::Validation {
                message: "保存するタイマーがありません。".into(),
                recovery: "タイマーを1件以上追加してから構成セットを保存してください。".into(),
            });
        }
        let id = Uuid::new_v4();
        let now = timestamp(Utc::now());
        let mut transaction = self
            .pool
            .begin()
            .await
            .map_err(|error| AppError::database("timer-set-save-begin", error))?;
        sqlx::query(
            "INSERT INTO timer_sets(id, name, version, created_at_utc, updated_at_utc) VALUES (?, ?, 0, ?, ?)",
        )
        .bind(id.to_string())
        .bind(&name)
        .bind(&now)
        .bind(&now)
        .execute(&mut *transaction)
        .await
        .map_err(|error| AppError::database("timer-set-save", error))?;
        for (index, timer) in timers.iter().enumerate() {
            sqlx::query(
                "INSERT INTO timer_set_items(id, timer_set_id, label, duration_seconds, sort_order) VALUES (?, ?, ?, ?, ?)",
            )
            .bind(Uuid::new_v4().to_string())
            .bind(id.to_string())
            .bind(&timer.label)
            .bind(timer.duration_seconds as i64)
            .bind(index as i64)
            .execute(&mut *transaction)
            .await
            .map_err(|error| AppError::database("timer-set-item-save", error))?;
        }
        transaction
            .commit()
            .await
            .map_err(|error| AppError::database("timer-set-save-commit", error))?;
        Ok(TimerSet {
            id,
            name,
            version: 0,
            items: self.timer_set_items(id).await?,
        })
    }

    pub async fn apply_timer_set(
        &self,
        id: Uuid,
        expected_version: u64,
    ) -> AppResult<Vec<TimerRecord>> {
        let set_row = sqlx::query("SELECT version FROM timer_sets WHERE id = ?")
            .bind(id.to_string())
            .fetch_optional(&self.pool)
            .await
            .map_err(|error| AppError::database("timer-set-apply-read", error))?
            .ok_or_else(timer_set_not_found)?;
        if set_row.get::<i64, _>("version").max(0) as u64 != expected_version {
            return Err(timer_set_version_conflict());
        }
        let items = self.timer_set_items(id).await?;
        let current_count: i64 = sqlx::query_scalar("SELECT COUNT(*) FROM timers")
            .fetch_one(&self.pool)
            .await
            .map_err(|error| AppError::database("timer-set-apply-count", error))?;
        if current_count + items.len() as i64 > MAX_ACTIVE_TIMERS {
            return Err(AppError::Validation {
                message: "構成セットを追加するとタイマーが500件を超えます。".into(),
                recovery: "不要なタイマーを削除してから構成セットを追加してください。".into(),
            });
        }
        let next_order: i64 =
            sqlx::query_scalar("SELECT COALESCE(MAX(sort_order), -1) + 1 FROM timers")
                .fetch_one(&self.pool)
                .await
                .map_err(|error| AppError::database("timer-set-apply-order", error))?;
        let now = timestamp(Utc::now());
        let mut transaction = self
            .pool
            .begin()
            .await
            .map_err(|error| AppError::database("timer-set-apply-begin", error))?;
        let mut created_ids = Vec::with_capacity(items.len());
        for (index, item) in items.iter().enumerate() {
            let timer_id = Uuid::new_v4();
            sqlx::query(
                "INSERT INTO timers(id, label, duration_seconds, status, started_at_utc, elapsed_before_start_seconds, run_id, sort_order, version, created_at_utc, updated_at_utc) VALUES (?, ?, ?, 'idle', NULL, 0, NULL, ?, 0, ?, ?)",
            )
            .bind(timer_id.to_string())
            .bind(&item.label)
            .bind(item.duration_seconds as i64)
            .bind(next_order + index as i64)
            .bind(&now)
            .bind(&now)
            .execute(&mut *transaction)
            .await
            .map_err(|error| AppError::database("timer-set-apply-item", error))?;
            created_ids.push(timer_id);
        }
        transaction
            .commit()
            .await
            .map_err(|error| AppError::database("timer-set-apply-commit", error))?;
        let all = self.timer_records().await?;
        Ok(all
            .into_iter()
            .filter(|timer| created_ids.contains(&timer.id))
            .collect())
    }

    pub async fn delete_timer_set(&self, id: Uuid, expected_version: u64) -> AppResult<()> {
        let result = sqlx::query("DELETE FROM timer_sets WHERE id = ? AND version = ?")
            .bind(id.to_string())
            .bind(expected_version as i64)
            .execute(&self.pool)
            .await
            .map_err(|error| AppError::database("timer-set-delete", error))?;
        if result.rows_affected() == 1 {
            Ok(())
        } else {
            Err(timer_set_version_conflict())
        }
    }

    pub async fn stopwatch_record(&self) -> AppResult<StopwatchRecord> {
        let row = sqlx::query("SELECT * FROM stopwatch_state WHERE singleton_id = 1")
            .fetch_one(&self.pool)
            .await
            .map_err(|error| AppError::database("stopwatch-read", error))?;
        Ok(StopwatchRecord {
            status: StopwatchStatus::try_from(row.get::<&str, _>("status"))?,
            started_at: row
                .get::<Option<String>, _>("started_at_utc")
                .as_deref()
                .map(|value| parse_datetime(value, "stopwatch-start"))
                .transpose()?,
            elapsed_before_start_seconds: row.get::<i64, _>("elapsed_before_start_seconds").max(0)
                as u64,
            version: row.get::<i64, _>("version").max(0) as u64,
        })
    }

    pub async fn save_stopwatch_record(
        &self,
        record: &StopwatchRecord,
        expected_version: u64,
    ) -> AppResult<StopwatchRecord> {
        let result = sqlx::query(
            "UPDATE stopwatch_state SET status = ?, started_at_utc = ?, elapsed_before_start_seconds = ?, version = version + 1, updated_at_utc = ? WHERE singleton_id = 1 AND version = ?",
        )
        .bind(record.status.as_str())
        .bind(record.started_at.map(timestamp))
        .bind(record.elapsed_before_start_seconds as i64)
        .bind(timestamp(Utc::now()))
        .bind(expected_version as i64)
        .execute(&self.pool)
        .await
        .map_err(|error| AppError::database("stopwatch-update", error))?;
        if result.rows_affected() != 1 {
            return Err(stopwatch_version_conflict());
        }
        self.stopwatch_record().await
    }
}

fn timer_record_from_row(row: sqlx::sqlite::SqliteRow) -> AppResult<TimerRecord> {
    Ok(TimerRecord {
        id: parse_uuid(row.get::<&str, _>("id"), "timer-id")?,
        label: row.get("label"),
        duration_seconds: row.get::<i64, _>("duration_seconds").max(0) as u64,
        status: TimerStatus::try_from(row.get::<&str, _>("status"))?,
        started_at: row
            .get::<Option<String>, _>("started_at_utc")
            .as_deref()
            .map(|value| parse_datetime(value, "timer-start"))
            .transpose()?,
        elapsed_before_start_seconds: row.get::<i64, _>("elapsed_before_start_seconds").max(0)
            as u64,
        run_id: row
            .get::<Option<String>, _>("run_id")
            .as_deref()
            .map(|value| parse_uuid(value, "timer-run-id"))
            .transpose()?,
        version: row.get::<i64, _>("version").max(0) as u64,
    })
}

fn timestamp(value: DateTime<Utc>) -> String {
    value.to_rfc3339_opts(SecondsFormat::Millis, true)
}

fn parse_datetime(value: &str, context: &'static str) -> AppResult<DateTime<Utc>> {
    DateTime::parse_from_rfc3339(value)
        .map(|value| value.with_timezone(&Utc))
        .map_err(|error| AppError::database(context, error))
}

fn parse_uuid(value: &str, context: &'static str) -> AppResult<Uuid> {
    Uuid::parse_str(value).map_err(|error| AppError::database(context, error))
}

fn timer_not_found() -> AppError {
    AppError::NotFound {
        message: "タイマーが見つかりません。".into(),
        recovery: "一覧を更新してから操作し直してください。".into(),
    }
}

fn timer_version_conflict() -> AppError {
    AppError::Conflict {
        message: "タイマーが別の操作で更新されました。".into(),
        recovery: "最新の状態を確認してから操作し直してください。".into(),
    }
}

fn timer_set_not_found() -> AppError {
    AppError::NotFound {
        message: "タイマー構成セットが見つかりません。".into(),
        recovery: "構成セット一覧を更新してください。現在のタイマーは変更されていません。".into(),
    }
}

fn timer_set_version_conflict() -> AppError {
    AppError::Conflict {
        message: "タイマー構成セットが更新または削除されました。".into(),
        recovery: "構成セット一覧を更新してから操作し直してください。".into(),
    }
}

fn stopwatch_version_conflict() -> AppError {
    AppError::Conflict {
        message: "ストップウォッチの状態が別の操作で更新されました。".into(),
        recovery: "最新の状態を確認してから操作し直してください。".into(),
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    #[tokio::test]
    async fn timer_set_snapshot_applies_without_replacing_existing_timers() {
        let database = Database::open_memory().await.unwrap();
        let first = database
            .create_timer(TimerDraft {
                label: "紅茶".into(),
                duration_seconds: 180,
            })
            .await
            .unwrap();
        let set = database
            .save_current_timers_as_set("休憩".into())
            .await
            .unwrap();
        let created = database.apply_timer_set(set.id, set.version).await.unwrap();

        assert_eq!(created.len(), 1);
        assert_ne!(created[0].id, first.id);
        assert_eq!(database.timer_records().await.unwrap().len(), 2);

        database
            .delete_timer_set(set.id, set.version)
            .await
            .unwrap();
        assert_eq!(database.timer_records().await.unwrap().len(), 2);
    }

    #[tokio::test]
    async fn stopwatch_state_is_versioned_and_persistent() {
        let database = Database::open_memory().await.unwrap();
        let mut record = database.stopwatch_record().await.unwrap();
        assert_eq!(record.status, StopwatchStatus::Idle);
        record.status = StopwatchStatus::Running;
        record.started_at = Some(Utc::now());
        let saved = database
            .save_stopwatch_record(&record, record.version)
            .await
            .unwrap();
        assert_eq!(saved.status, StopwatchStatus::Running);
        assert_eq!(saved.version, 1);
    }
}
