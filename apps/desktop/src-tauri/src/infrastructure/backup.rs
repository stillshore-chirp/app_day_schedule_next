use std::{
    fs,
    path::{Path, PathBuf},
    time::Duration,
};

use chrono::{DateTime, SecondsFormat, Utc};
use serde::Serialize;
use sha2::{Digest, Sha256};
use sqlx::{Connection, Row, SqliteConnection, sqlite::SqliteConnectOptions};
use uuid::Uuid;

use crate::{
    application::OperationCancellation,
    domain::{AppError, AppResult},
};

use super::Database;

const BACKUP_GENERATIONS: usize = 10;
const PENDING_RESTORE_NAME: &str = ".restore-pending.sqlite3";
const PENDING_RESTORE_HASH_NAME: &str = ".restore-pending.sha256";
pub const CURRENT_SCHEMA_VERSION: u32 = 17;

#[derive(Debug, Clone)]
pub struct PreparedMigrationBackup {
    id: Uuid,
    file_name: String,
    sha256: String,
    size_bytes: u64,
    source_schema_version: u32,
    created_at: DateTime<Utc>,
}

#[derive(Debug, Clone, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct BackupRecord {
    pub id: Uuid,
    pub file_name: String,
    pub size_bytes: u64,
    pub schema_version: u32,
    pub app_version: String,
    pub verified: bool,
    pub created_at: DateTime<Utc>,
}

#[derive(Debug, Clone, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct RestoreStageResult {
    pub backup_id: Uuid,
    pub requires_restart: bool,
    pub current_database_will_be_preserved: bool,
}

impl Database {
    pub async fn prepare_migration_backup(
        database_path: &Path,
    ) -> AppResult<Option<PreparedMigrationBackup>> {
        let metadata = match fs::metadata(database_path) {
            Ok(metadata) if metadata.is_file() && metadata.len() > 0 => metadata,
            Ok(_) => return Ok(None),
            Err(error) if error.kind() == std::io::ErrorKind::NotFound => return Ok(None),
            Err(error) => return Err(AppError::database("pre-migration-metadata", error)),
        };
        if metadata.len() == 0 {
            return Ok(None);
        }
        let options = SqliteConnectOptions::new()
            .filename(database_path)
            .create_if_missing(false)
            .busy_timeout(Duration::from_secs(5));
        let mut connection = SqliteConnection::connect_with(&options)
            .await
            .map_err(|error| AppError::database("pre-migration-open", error))?;
        let source_schema: Option<String> =
            sqlx::query_scalar("SELECT value FROM app_meta WHERE key = 'schema_version'")
                .fetch_optional(&mut connection)
                .await
                .unwrap_or(None);
        let source_schema_version = source_schema
            .as_deref()
            .and_then(|value| value.parse::<u32>().ok())
            .unwrap_or(0);
        if source_schema_version >= CURRENT_SCHEMA_VERSION {
            connection
                .close()
                .await
                .map_err(|error| AppError::database("pre-migration-close", error))?;
            return Ok(None);
        }
        let directory = backup_directory(database_path)?;
        fs::create_dir_all(&directory)
            .map_err(|error| AppError::database("pre-migration-directory", error))?;
        let created_at = Utc::now();
        let id = Uuid::new_v4();
        let file_name = format!(
            "day-schedule-next-{}-pre-migration-{}.sqlite3",
            created_at.format("%Y%m%dT%H%M%SZ"),
            &id.simple().to_string()[..8]
        );
        let target = directory.join(&file_name);
        sqlx::query("PRAGMA wal_checkpoint(FULL)")
            .execute(&mut connection)
            .await
            .map_err(|error| AppError::database("pre-migration-checkpoint", error))?;
        sqlx::query("VACUUM INTO ?")
            .bind(target.to_string_lossy().as_ref())
            .execute(&mut connection)
            .await
            .map_err(|error| AppError::database("pre-migration-vacuum", error))?;
        connection
            .close()
            .await
            .map_err(|error| AppError::database("pre-migration-close", error))?;
        let (size_bytes, sha256) = verify_database_file(&target).await?;
        Ok(Some(PreparedMigrationBackup {
            id,
            file_name,
            sha256,
            size_bytes,
            source_schema_version,
            created_at,
        }))
    }

    pub async fn register_migration_backup(
        &self,
        backup: PreparedMigrationBackup,
        app_version: &str,
    ) -> AppResult<()> {
        sqlx::query(
            "INSERT OR IGNORE INTO backup_history(id, relative_name, sha256, schema_version, app_version, size_bytes, verified, created_at_utc) VALUES (?, ?, ?, ?, ?, ?, 1, ?)",
        )
        .bind(backup.id.to_string())
        .bind(backup.file_name)
        .bind(backup.sha256)
        .bind(i64::from(backup.source_schema_version))
        .bind(app_version)
        .bind(backup.size_bytes as i64)
        .bind(timestamp(backup.created_at))
        .execute(&self.pool)
        .await
        .map_err(|error| AppError::database("pre-migration-register", error))?;
        let directory = backup_directory(self.database_path()?)?;
        self.rotate_backups(&directory).await
    }

    pub async fn ensure_daily_backup(&self, app_version: &str) -> AppResult<()> {
        let today = Utc::now().date_naive();
        let latest: Option<String> = sqlx::query_scalar(
            "SELECT created_at_utc FROM backup_history WHERE verified = 1 ORDER BY created_at_utc DESC LIMIT 1",
        )
        .fetch_optional(&self.pool)
        .await
        .map_err(|error| AppError::database("backup-latest", error))?;
        if latest
            .as_deref()
            .and_then(|value| DateTime::parse_from_rfc3339(value).ok())
            .is_some_and(|value| value.date_naive() == today)
        {
            return Ok(());
        }
        self.create_backup("daily", app_version).await.map(|_| ())
    }

    pub async fn create_backup(&self, reason: &str, app_version: &str) -> AppResult<BackupRecord> {
        self.create_backup_cancelable(reason, app_version, &OperationCancellation::default())
            .await
    }

    pub async fn create_backup_cancelable(
        &self,
        reason: &str,
        app_version: &str,
        cancellation: &OperationCancellation,
    ) -> AppResult<BackupRecord> {
        cancellation.check()?;
        let database_path = self.database_path()?;
        let backup_directory = backup_directory(database_path)?;
        fs::create_dir_all(&backup_directory)
            .map_err(|error| AppError::database("backup-directory", error))?;
        cancellation.check()?;
        let schema_version = schema_version(&self.pool).await?;
        let created_at = Utc::now();
        let id = Uuid::new_v4();
        let safe_reason = if reason == "pre-migration" {
            "pre-migration"
        } else {
            "daily"
        };
        let file_name = format!(
            "day-schedule-next-{}-{}-{}.sqlite3",
            created_at.format("%Y%m%dT%H%M%SZ"),
            safe_reason,
            &id.simple().to_string()[..8]
        );
        let target = backup_directory.join(&file_name);
        sqlx::query("PRAGMA wal_checkpoint(FULL)")
            .execute(&self.pool)
            .await
            .map_err(|error| AppError::database("backup-checkpoint", error))?;
        cancellation.check()?;
        sqlx::query("VACUUM INTO ?")
            .bind(target.to_string_lossy().as_ref())
            .execute(&self.pool)
            .await
            .map_err(|error| AppError::database("backup-vacuum", error))?;
        if let Err(error) = cancellation.check() {
            let _ = fs::remove_file(&target);
            return Err(error);
        }
        let (size_bytes, sha256) = match verify_database_file(&target).await {
            Ok(result) => result,
            Err(error) => {
                let _ = fs::remove_file(&target);
                return Err(error);
            }
        };
        if let Err(error) = cancellation.check() {
            let _ = fs::remove_file(&target);
            return Err(error);
        }
        sqlx::query(
            "INSERT INTO backup_history(id, relative_name, sha256, schema_version, app_version, size_bytes, verified, created_at_utc) VALUES (?, ?, ?, ?, ?, ?, 1, ?)",
        )
        .bind(id.to_string())
        .bind(&file_name)
        .bind(&sha256)
        .bind(i64::from(schema_version))
        .bind(app_version)
        .bind(size_bytes as i64)
        .bind(timestamp(created_at))
        .execute(&self.pool)
        .await
        .map_err(|error| AppError::database("backup-record", error))?;
        self.rotate_backups(&backup_directory).await?;
        Ok(BackupRecord {
            id,
            file_name,
            size_bytes,
            schema_version,
            app_version: app_version.to_owned(),
            verified: true,
            created_at,
        })
    }

    pub async fn list_backups(&self) -> AppResult<Vec<BackupRecord>> {
        let rows = sqlx::query(
            "SELECT id, relative_name, size_bytes, schema_version, app_version, verified, created_at_utc FROM backup_history ORDER BY created_at_utc DESC LIMIT 10",
        )
        .fetch_all(&self.pool)
        .await
        .map_err(|error| AppError::database("backup-list", error))?;
        rows.iter()
            .map(|row| {
                Ok(BackupRecord {
                    id: Uuid::parse_str(row.get::<&str, _>("id"))
                        .map_err(|error| AppError::database("backup-id", error))?,
                    file_name: row.get("relative_name"),
                    size_bytes: row.get::<i64, _>("size_bytes").max(0) as u64,
                    schema_version: row.get::<i64, _>("schema_version").max(0) as u32,
                    app_version: row.get("app_version"),
                    verified: row.get("verified"),
                    created_at: DateTime::parse_from_rfc3339(row.get::<&str, _>("created_at_utc"))
                        .map(|value| value.with_timezone(&Utc))
                        .map_err(|error| AppError::database("backup-created-at", error))?,
                })
            })
            .collect()
    }

    pub async fn stage_restore(&self, backup_id: Uuid) -> AppResult<RestoreStageResult> {
        let row =
            sqlx::query("SELECT relative_name, sha256, verified FROM backup_history WHERE id = ?")
                .bind(backup_id.to_string())
                .fetch_optional(&self.pool)
                .await
                .map_err(|error| AppError::database("restore-backup-read", error))?
                .ok_or_else(|| AppError::NotFound {
                    message: "選択したバックアップが見つかりません。".into(),
                    recovery: "一覧を更新し、別の世代を選んでください。".into(),
                })?;
        if !row.get::<bool, _>("verified") {
            return Err(AppError::Validation {
                message: "未検証のバックアップは復元できません。".into(),
                recovery: "整合性が確認済みの世代を選んでください。".into(),
            });
        }
        let file_name: String = row.get("relative_name");
        if !is_safe_backup_name(&file_name) {
            return Err(AppError::Validation {
                message: "バックアップ名が安全ではありません。".into(),
                recovery: "別の世代を選んでください。".into(),
            });
        }
        let expected_hash: String = row.get("sha256");
        let database_path = self.database_path()?;
        let directory = backup_directory(database_path)?;
        let source = directory.join(file_name);
        let (_, actual_hash) = verify_database_file(&source).await?;
        if !constant_time_eq(actual_hash.as_bytes(), expected_hash.as_bytes()) {
            return Err(AppError::Conflict {
                message: "バックアップの内容が作成時から変わっています。".into(),
                recovery: "この世代は使わず、別の検証済みバックアップを選んでください。".into(),
            });
        }
        let pending = directory.join(PENDING_RESTORE_NAME);
        let pending_part = directory.join(".restore-pending.part");
        fs::copy(&source, &pending_part)
            .and_then(|_| fs::rename(&pending_part, &pending))
            .map_err(|error| AppError::database("restore-stage-copy", error))?;
        fs::write(directory.join(PENDING_RESTORE_HASH_NAME), actual_hash)
            .map_err(|error| AppError::database("restore-stage-hash", error))?;
        Ok(RestoreStageResult {
            backup_id,
            requires_restart: true,
            current_database_will_be_preserved: true,
        })
    }

    pub async fn apply_pending_restore(database_path: &Path) -> AppResult<bool> {
        recover_interrupted_restore_swap(database_path)?;
        let directory = backup_directory(database_path)?;
        let pending = directory.join(PENDING_RESTORE_NAME);
        let hash_file = directory.join(PENDING_RESTORE_HASH_NAME);
        if !pending.exists() && !hash_file.exists() {
            return Ok(false);
        }
        if !pending.is_file() || !hash_file.is_file() {
            return Err(AppError::Unavailable {
                message: "復元待ちデータが不完全です。".into(),
                recovery:
                    "バックアップファイルは保持されています。診断画面から復元を選び直してください。"
                        .into(),
                retryable: false,
            });
        }
        let expected_hash = fs::read_to_string(&hash_file)
            .map_err(|error| AppError::database("restore-pending-hash-read", error))?;
        let (_, actual_hash) = verify_database_file(&pending).await?;
        if !constant_time_eq(actual_hash.as_bytes(), expected_hash.trim().as_bytes()) {
            return Err(AppError::Conflict {
                message: "復元待ちデータの検証に失敗しました。".into(),
                recovery: "現在のデータは切り替えていません。別のバックアップを選んでください。"
                    .into(),
            });
        }
        let rollback = directory.join(format!(
            "day-schedule-next-{}-pre-restore.sqlite3",
            Utc::now().format("%Y%m%dT%H%M%SZ")
        ));
        if database_path.exists() {
            fs::copy(database_path, &rollback)
                .map_err(|error| AppError::database("restore-preserve-current", error))?;
            verify_database_file(&rollback).await?;
        }
        let swap = database_path.with_extension("sqlite3.restore-part");
        if swap.exists() {
            fs::remove_file(&swap)
                .map_err(|error| AppError::database("restore-stale-swap-cleanup", error))?;
        }
        remove_sidecar(&swap, "-wal")?;
        remove_sidecar(&swap, "-shm")?;
        fs::copy(&pending, &swap)
            .map_err(|error| AppError::database("restore-swap-copy", error))?;
        verify_database_file(&swap).await?;
        let candidate = Database::open(&swap).await.map_err(|_| AppError::Unavailable {
            message: "バックアップを現在のデータ形式へ更新できませんでした。".into(),
            recovery:
                "現在のデータは切り替えていません。別のバックアップを選ぶか、診断情報を確認してください。"
                    .into(),
            retryable: false,
        })?;
        let (busy, _, _): (i64, i64, i64) = sqlx::query_as("PRAGMA wal_checkpoint(TRUNCATE)")
            .fetch_one(&candidate.pool)
            .await
            .map_err(|error| AppError::database("restore-candidate-checkpoint", error))?;
        if busy != 0 {
            return Err(AppError::Unavailable {
                message: "復元候補の更新を確定できませんでした。".into(),
                recovery:
                    "現在のデータは切り替えていません。アプリを再起動して復元をやり直してください。"
                        .into(),
                retryable: true,
            });
        }
        candidate.pool.close().await;
        remove_sidecar(&swap, "-wal")?;
        remove_sidecar(&swap, "-shm")?;
        verify_database_file(&swap).await?;
        replace_existing_database(&swap, database_path)?;
        remove_sidecar(database_path, "-wal")?;
        remove_sidecar(database_path, "-shm")?;
        fs::remove_file(&pending).map_err(|error| AppError::database("restore-cleanup", error))?;
        fs::remove_file(&hash_file)
            .map_err(|error| AppError::database("restore-hash-cleanup", error))?;
        Ok(true)
    }

    async fn rotate_backups(&self, directory: &Path) -> AppResult<()> {
        let rows = sqlx::query(
            "SELECT id, relative_name FROM backup_history ORDER BY created_at_utc DESC",
        )
        .fetch_all(&self.pool)
        .await
        .map_err(|error| AppError::database("backup-rotation-list", error))?;
        for row in rows.iter().skip(BACKUP_GENERATIONS) {
            let id: String = row.get("id");
            let name: String = row.get("relative_name");
            if !is_safe_backup_name(&name) {
                continue;
            }
            let target = directory.join(name);
            if target.is_file() {
                fs::remove_file(&target)
                    .map_err(|error| AppError::database("backup-rotation-remove", error))?;
            }
            sqlx::query("DELETE FROM backup_history WHERE id = ?")
                .bind(id)
                .execute(&self.pool)
                .await
                .map_err(|error| AppError::database("backup-rotation-record", error))?;
        }
        Ok(())
    }

    fn database_path(&self) -> AppResult<&Path> {
        self.path
            .as_deref()
            .map(AsRef::as_ref)
            .ok_or_else(|| AppError::Unavailable {
                message: "メモリ上のテストDBではバックアップを作成できません。".into(),
                recovery: "デスクトップアプリで実行してください。".into(),
                retryable: false,
            })
    }
}

async fn verify_database_file(path: &Path) -> AppResult<(u64, String)> {
    let metadata =
        fs::metadata(path).map_err(|error| AppError::database("backup-metadata", error))?;
    if !metadata.is_file() || metadata.len() == 0 {
        return Err(AppError::Validation {
            message: "バックアップファイルが空です。".into(),
            recovery: "別の世代を選んでください。".into(),
        });
    }
    let options = SqliteConnectOptions::new()
        .filename(path)
        .read_only(true)
        .busy_timeout(Duration::from_secs(5));
    let mut connection = SqliteConnection::connect_with(&options)
        .await
        .map_err(|error| AppError::database("backup-open", error))?;
    let result: String = sqlx::query_scalar("PRAGMA quick_check")
        .fetch_one(&mut connection)
        .await
        .map_err(|error| AppError::database("backup-integrity", error))?;
    let smoke: i64 = sqlx::query_scalar("SELECT COUNT(*) FROM sqlite_master")
        .fetch_one(&mut connection)
        .await
        .map_err(|error| AppError::database("backup-smoke", error))?;
    connection
        .close()
        .await
        .map_err(|error| AppError::database("backup-close", error))?;
    if result != "ok" || smoke == 0 {
        return Err(AppError::Unavailable {
            message: "バックアップの整合性を確認できませんでした。".into(),
            recovery: "現在のデータは変更していません。別の世代を選んでください。".into(),
            retryable: false,
        });
    }
    let bytes = fs::read(path).map_err(|error| AppError::database("backup-hash-read", error))?;
    Ok((metadata.len(), format!("{:x}", Sha256::digest(bytes))))
}

async fn schema_version(pool: &sqlx::SqlitePool) -> AppResult<u32> {
    let value: String =
        sqlx::query_scalar("SELECT value FROM app_meta WHERE key = 'schema_version'")
            .fetch_one(pool)
            .await
            .map_err(|error| AppError::database("backup-schema-version", error))?;
    value
        .parse::<u32>()
        .map_err(|error| AppError::database("backup-schema-parse", error))
}

fn restore_displaced_path(database_path: &Path) -> PathBuf {
    database_path.with_extension("sqlite3.pre-restore-swap")
}

fn recover_interrupted_restore_swap(database_path: &Path) -> AppResult<()> {
    let displaced = restore_displaced_path(database_path);
    if !displaced.exists() {
        return Ok(());
    }
    if database_path.exists() {
        fs::remove_file(&displaced)
            .map_err(|error| AppError::database("restore-stale-displaced-cleanup", error))?;
    } else {
        fs::rename(&displaced, database_path)
            .map_err(|error| AppError::database("restore-interrupted-recover", error))?;
    }
    Ok(())
}

fn replace_existing_database(staged: &Path, database_path: &Path) -> AppResult<()> {
    let displaced = restore_displaced_path(database_path);
    if displaced.exists() {
        fs::remove_file(&displaced)
            .map_err(|error| AppError::database("restore-displaced-cleanup", error))?;
    }
    let had_current = database_path.exists();
    if had_current {
        fs::rename(database_path, &displaced)
            .map_err(|error| AppError::database("restore-displace-current", error))?;
    }
    if let Err(error) = fs::rename(staged, database_path) {
        if had_current && let Err(recovery_error) = fs::rename(&displaced, database_path) {
            return Err(AppError::database(
                "restore-swap-recovery",
                format!(
                    "replacement failed: {error}; current database recovery failed: {recovery_error}"
                ),
            ));
        }
        return Err(AppError::database("restore-swap-rename", error));
    }
    if had_current {
        let _ = fs::remove_file(displaced);
    }
    Ok(())
}

fn backup_directory(database_path: &Path) -> AppResult<std::path::PathBuf> {
    database_path
        .parent()
        .map(|parent| parent.join("backups"))
        .ok_or_else(|| AppError::database("backup-parent", "missing parent"))
}

fn is_safe_backup_name(value: &str) -> bool {
    value.starts_with("day-schedule-next-")
        && value.ends_with(".sqlite3")
        && !value.contains(['/', '\\'])
        && value.len() <= 160
}

fn remove_sidecar(database_path: &Path, suffix: &str) -> AppResult<()> {
    let mut value = database_path.as_os_str().to_owned();
    value.push(suffix);
    let path = std::path::PathBuf::from(value);
    if path.is_file() {
        fs::remove_file(path).map_err(|error| AppError::database("restore-sidecar", error))?;
    }
    Ok(())
}

fn timestamp(value: DateTime<Utc>) -> String {
    value.to_rfc3339_opts(SecondsFormat::Millis, true)
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

#[cfg(test)]
mod tests {
    use tempfile::tempdir;

    use super::*;
    use crate::domain::{
        AssignTicketScheduleRequest, FocusPhase, TicketChecklistItemDraft, TicketDraft,
        TicketPatch, TicketPriority, TicketScheduleSource,
    };
    use crate::infrastructure::FocusRecord;

    #[test]
    fn replacement_displaces_existing_destination_before_rename() {
        let directory = tempdir().unwrap();
        let database_path = directory.path().join("data.sqlite3");
        let staged = directory.path().join("data.sqlite3.restore-part");
        fs::write(&database_path, b"current").unwrap();
        fs::write(&staged, b"restored").unwrap();

        replace_existing_database(&staged, &database_path).unwrap();

        assert_eq!(fs::read(&database_path).unwrap(), b"restored");
        assert!(!staged.exists());
        assert!(!restore_displaced_path(&database_path).exists());
    }

    #[test]
    fn interrupted_replacement_recovers_displaced_current_database() {
        let directory = tempdir().unwrap();
        let database_path = directory.path().join("data.sqlite3");
        let displaced = restore_displaced_path(&database_path);
        fs::write(&displaced, b"current").unwrap();

        recover_interrupted_restore_swap(&database_path).unwrap();

        assert_eq!(fs::read(&database_path).unwrap(), b"current");
        assert!(!displaced.exists());
    }

    #[tokio::test]
    async fn backup_is_verified_recorded_and_rotated() {
        let directory = tempdir().unwrap();
        let path = directory.path().join("data.sqlite3");
        let database = Database::open(&path).await.unwrap();
        let backup = database.create_backup("daily", "test").await.unwrap();
        assert!(backup.verified);
        assert!(
            directory
                .path()
                .join("backups")
                .join(backup.file_name)
                .is_file()
        );
        assert_eq!(database.list_backups().await.unwrap().len(), 1);
    }

    #[tokio::test]
    async fn cancelled_backup_creates_no_history_or_backup_file() {
        let directory = tempdir().unwrap();
        let path = directory.path().join("data.sqlite3");
        let database = Database::open(&path).await.unwrap();
        let cancellation = OperationCancellation::default();
        cancellation.cancel();

        let result = database
            .create_backup_cancelable("daily", "test", &cancellation)
            .await;

        assert!(matches!(result, Err(AppError::Cancelled { .. })));
        assert!(database.list_backups().await.unwrap().is_empty());
        assert!(!directory.path().join("backups").exists());
    }

    #[tokio::test]
    async fn staged_restore_preserves_current_database_before_cutover() {
        let directory = tempdir().unwrap();
        let path = directory.path().join("data.sqlite3");
        let database = Database::open(&path).await.unwrap();
        let backup = database.create_backup("daily", "test").await.unwrap();
        database.stage_restore(backup.id).await.unwrap();
        database.pool.close().await;
        assert!(Database::apply_pending_restore(&path).await.unwrap());
        let restored = Database::open(&path).await.unwrap();
        restored.integrity_check().await.unwrap();
        assert!(
            directory
                .path()
                .join("backups")
                .read_dir()
                .unwrap()
                .any(|entry| {
                    entry
                        .unwrap()
                        .file_name()
                        .to_string_lossy()
                        .contains("pre-restore")
                })
        );
    }

    #[tokio::test]
    async fn backup_restore_round_trips_ticket_relations_and_history() {
        let directory = tempdir().unwrap();
        let path = directory.path().join("data.sqlite3");
        let database = Database::open(&path).await.unwrap();
        let created = database
            .create_ticket(
                Uuid::new_v4(),
                TicketDraft {
                    board_id: Uuid::parse_str("00000000-0000-4000-8000-000000000100").unwrap(),
                    column_id: Uuid::parse_str("00000000-0000-4000-8000-000000000101").unwrap(),
                    parent_ticket_id: None,
                    title: "synthetic ticket before backup".into(),
                    description: "synthetic fixture".into(),
                    priority: TicketPriority::High,
                    due_date: chrono::NaiveDate::from_ymd_opt(2026, 8, 4),
                    estimate_minutes: Some(45),
                    tags: vec!["synthetic".into()],
                    checklist: vec![TicketChecklistItemDraft {
                        title: "synthetic item".into(),
                        completed: true,
                    }],
                },
                Utc::now(),
            )
            .await
            .unwrap();
        let link = database
            .assign_ticket_to_new_schedule(
                &AssignTicketScheduleRequest {
                    operation_id: Uuid::new_v4(),
                    ticket_id: created.id,
                    expected_ticket_version: created.version,
                    local_start: "2026-08-04T09:00".into(),
                    duration_minutes: 45,
                    timezone_id: "Asia/Tokyo".into(),
                    offset_choice: None,
                    title_override: None,
                    source: TicketScheduleSource::Board,
                },
                Utc::now() + chrono::Duration::hours(1),
                Utc::now() + chrono::Duration::minutes(105),
                Utc::now(),
            )
            .await
            .unwrap();
        let focus = FocusRecord {
            id: Uuid::new_v4(),
            schedule_item_id: Some(link.schedule.id),
            ticket_id: None,
            phase: FocusPhase::Working,
            previous_phase: None,
            started_at: Utc::now(),
            accumulated_seconds: 0,
            cycle: 0,
        };
        database.insert_focus(&focus).await.unwrap();
        database
            .end_focus(focus.id, Utc::now() + chrono::Duration::minutes(10), 600)
            .await
            .unwrap();
        let now = Utc::now().to_rfc3339();
        sqlx::query("INSERT INTO google_accounts(id, display_label, scopes_json, status, created_at_utc, updated_at_utc) VALUES ('aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa', 'Synthetic Google', '[]', 'connected', ?, ?)")
            .bind(&now)
            .bind(&now)
            .execute(&database.pool)
            .await
            .unwrap();
        sqlx::query("INSERT INTO google_task_lists(id, google_account_id, remote_list_id, display_name, selected, default_write_target, sync_state, created_at_utc, updated_at_utc) VALUES ('bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb', 'aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa', 'synthetic-list', 'Synthetic tasks', 1, 1, 'synced', ?, ?)")
            .bind(&now)
            .bind(&now)
            .execute(&database.pool)
            .await
            .unwrap();
        let base = serde_json::json!({
            "title": created.title.clone(),
            "notes": created.description.clone(),
            "due_date": "2026-08-04",
            "completed": false,
            "parent_ticket_id": null,
            "task_list_id": "bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb"
        });
        sqlx::query("INSERT INTO google_task_mappings(ticket_id, google_task_list_id, remote_task_id, base_snapshot_json, created_at_utc, updated_at_utc) VALUES (?, 'bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb', 'synthetic-task', ?, ?, ?)")
            .bind(created.id.to_string())
            .bind(base.to_string())
            .bind(&now)
            .bind(&now)
            .execute(&database.pool)
            .await
            .unwrap();
        sqlx::query("INSERT INTO google_task_conflicts(id, ticket_id, field_name, base_value_json, local_value_json, remote_value_json, conflict_type, detected_at_utc) VALUES ('cccccccc-cccc-4ccc-8ccc-cccccccccccc', ?, 'notes', 'null', 'null', 'null', 'same_field', ?)")
            .bind(created.id.to_string())
            .bind(&now)
            .execute(&database.pool)
            .await
            .unwrap();
        let backup = database.create_backup("manual", "test").await.unwrap();
        database
            .update_ticket(
                Uuid::new_v4(),
                created.id,
                created.version,
                TicketPatch {
                    title: Some("changed after backup".into()),
                    ..TicketPatch::default()
                },
                Utc::now(),
            )
            .await
            .unwrap();
        database.stage_restore(backup.id).await.unwrap();
        database.pool.close().await;

        assert!(Database::apply_pending_restore(&path).await.unwrap());
        let restored = Database::open(&path).await.unwrap();
        let ticket = restored.ticket(created.id).await.unwrap();
        assert_eq!(ticket.title, "synthetic ticket before backup");
        assert_eq!(ticket.tags.len(), 1);
        assert_eq!(ticket.checklist.len(), 1);
        assert!(ticket.checklist[0].completed);
        assert_eq!(
            restored.ticket_history(created.id, 10).await.unwrap().len(),
            1
        );
        let restored_links = restored.ticket_schedules(created.id, true).await.unwrap();
        assert_eq!(restored_links.len(), 1);
        assert_eq!(restored_links[0].id, link.id);
        assert_eq!(restored_links[0].schedule.id, link.schedule.id);
        let focus_history = restored.ticket_focus_history(created.id, 10).await.unwrap();
        assert_eq!(focus_history.len(), 1);
        assert_eq!(focus_history[0].session_id, focus.id);
        assert_eq!(focus_history[0].work_seconds, 600);
        let task_mapping_count: i64 =
            sqlx::query_scalar("SELECT COUNT(*) FROM google_task_mappings WHERE ticket_id = ?")
                .bind(created.id.to_string())
                .fetch_one(&restored.pool)
                .await
                .unwrap();
        assert_eq!(task_mapping_count, 1);
        let task_conflict_count: i64 = sqlx::query_scalar(
            "SELECT COUNT(*) FROM google_task_conflicts WHERE ticket_id = ? AND resolved_at_utc IS NULL",
        )
        .bind(created.id.to_string())
        .fetch_one(&restored.pool)
        .await
        .unwrap();
        assert_eq!(task_conflict_count, 1);
    }

    #[tokio::test]
    async fn pending_restore_is_migrated_before_the_database_is_replaced() {
        let directory = tempdir().unwrap();
        let path = directory.path().join("data.sqlite3");
        let database = Database::open(&path).await.unwrap();
        database.pool.close().await;

        let backup_directory = directory.path().join("backups");
        fs::create_dir_all(&backup_directory).unwrap();
        let pending = backup_directory.join(PENDING_RESTORE_NAME);
        let options = SqliteConnectOptions::new()
            .filename(&pending)
            .create_if_missing(true);
        let mut connection = SqliteConnection::connect_with(&options).await.unwrap();
        sqlx::raw_sql(include_str!("../../migrations/0001_initial.sql"))
            .execute(&mut connection)
            .await
            .unwrap();
        connection.close().await.unwrap();
        let (_, hash) = verify_database_file(&pending).await.unwrap();
        fs::write(backup_directory.join(PENDING_RESTORE_HASH_NAME), hash).unwrap();

        assert!(Database::apply_pending_restore(&path).await.unwrap());
        let restored = Database::open(&path).await.unwrap();
        let schema: String =
            sqlx::query_scalar("SELECT value FROM app_meta WHERE key = 'schema_version'")
                .fetch_one(&restored.pool)
                .await
                .unwrap();
        assert_eq!(schema, CURRENT_SCHEMA_VERSION.to_string());
    }

    #[tokio::test]
    async fn failed_candidate_migration_keeps_the_active_database_unchanged() {
        let directory = tempdir().unwrap();
        let path = directory.path().join("data.sqlite3");
        let database = Database::open(&path).await.unwrap();
        sqlx::query(
            "INSERT INTO app_meta(key, value, updated_at_utc) VALUES ('active-marker', 'kept', ?)",
        )
        .bind(Utc::now().to_rfc3339())
        .execute(&database.pool)
        .await
        .unwrap();
        database.pool.close().await;

        let backup_directory = directory.path().join("backups");
        fs::create_dir_all(&backup_directory).unwrap();
        let pending = backup_directory.join(PENDING_RESTORE_NAME);
        let options = SqliteConnectOptions::new()
            .filename(&pending)
            .create_if_missing(true);
        let mut connection = SqliteConnection::connect_with(&options).await.unwrap();
        sqlx::raw_sql(include_str!("../../migrations/0001_initial.sql"))
            .execute(&mut connection)
            .await
            .unwrap();
        sqlx::query("ALTER TABLE schedule_items ADD COLUMN priority TEXT")
            .execute(&mut connection)
            .await
            .unwrap();
        connection.close().await.unwrap();
        let (_, hash) = verify_database_file(&pending).await.unwrap();
        fs::write(backup_directory.join(PENDING_RESTORE_HASH_NAME), hash).unwrap();

        assert!(Database::apply_pending_restore(&path).await.is_err());
        let active = Database::open(&path).await.unwrap();
        let marker: String =
            sqlx::query_scalar("SELECT value FROM app_meta WHERE key = 'active-marker'")
                .fetch_one(&active.pool)
                .await
                .unwrap();
        assert_eq!(marker, "kept");
    }
}
