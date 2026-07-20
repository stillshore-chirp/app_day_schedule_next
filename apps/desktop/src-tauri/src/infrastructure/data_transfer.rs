use std::{fs, path::Path};

use chrono::{DateTime, SecondsFormat, Utc};
use serde::{Deserialize, Serialize};
use serde_json::Value;
use sha2::{Digest, Sha256};
use sqlx::{Sqlite, Transaction};
use uuid::Uuid;

use crate::{
    application::OperationCancellation,
    domain::{
        AppError, AppResult, DayTemplateDraft, FreeAlarmDraft, QuickBlockDraft, Schedule, Settings,
        SyncStatus, TemplateBlockDraft,
    },
};

use super::Database;
use super::database::{insert_schedule, row_to_schedule};

const EXPORT_FORMAT_VERSION: u32 = 1;
const MAX_IMPORT_BYTES: u64 = 25 * 1024 * 1024;
const MAX_SCHEDULES: usize = 100_000;
const MAX_TEMPLATES: usize = 1_000;
const MAX_LIBRARY_ITEMS: usize = 10_000;

#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
struct ExportEnvelope {
    format_version: u32,
    created_at: DateTime<Utc>,
    source_timezone: String,
    schedules: Vec<Schedule>,
    templates: Vec<ExportTemplate>,
    quick_blocks: Vec<ExportQuickBlock>,
    free_alarms: Vec<ExportAlarm>,
    settings: Settings,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
struct ExportTemplate {
    name: String,
    description: String,
    color: String,
    weekdays_mask: u8,
    blocks: Vec<TemplateBlockDraft>,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
struct ExportQuickBlock {
    draft: QuickBlockDraft,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
struct ExportAlarm {
    draft: FreeAlarmDraft,
}

#[derive(Debug, Clone, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct ExportResult {
    pub file_name: String,
    pub bytes_written: u64,
    pub schedule_count: usize,
    pub template_count: usize,
    pub quick_block_count: usize,
    pub alarm_count: usize,
}

#[derive(Debug, Clone, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct ImportPreview {
    pub fingerprint: String,
    pub format_version: u32,
    pub created_at: DateTime<Utc>,
    pub source_timezone: String,
    pub schedule_count: usize,
    pub template_count: usize,
    pub quick_block_count: usize,
    pub alarm_count: usize,
    pub warnings: Vec<String>,
}

#[derive(Debug, Clone, Copy, Deserialize)]
#[serde(rename_all = "snake_case")]
pub enum ImportMode {
    Add,
    Replace,
}

#[derive(Debug, Clone, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct ImportResult {
    pub imported_schedule_count: usize,
    pub imported_template_count: usize,
    pub imported_quick_block_count: usize,
    pub imported_alarm_count: usize,
    pub preserved_external_schedule_count: u64,
}

impl Database {
    #[cfg(test)]
    pub async fn export_json(&self, target: &Path, timezone_id: &str) -> AppResult<ExportResult> {
        self.export_json_cancelable(target, timezone_id, &OperationCancellation::default())
            .await
    }

    pub async fn export_json_cancelable(
        &self,
        target: &Path,
        timezone_id: &str,
        cancellation: &OperationCancellation,
    ) -> AppResult<ExportResult> {
        validate_json_path(target, true)?;
        cancellation.check()?;
        let schedule_rows = sqlx::query(
            "SELECT * FROM schedule_items WHERE deleted_at_utc IS NULL ORDER BY start_at_utc, id",
        )
        .fetch_all(&self.pool)
        .await
        .map_err(|error| AppError::database("export-schedules", error))?;
        cancellation.check()?;
        let schedules = schedule_rows
            .iter()
            .map(row_to_schedule)
            .collect::<AppResult<Vec<_>>>()?;
        let templates = self
            .list_templates()
            .await?
            .into_iter()
            .map(|template| ExportTemplate {
                name: template.name,
                description: template.description,
                color: template.color,
                weekdays_mask: template.weekdays_mask,
                blocks: template
                    .blocks
                    .into_iter()
                    .map(|block| TemplateBlockDraft {
                        title: block.title,
                        start_minute: block.start_minute,
                        duration_minutes: block.duration_minutes,
                        color: block.color,
                        project: block.project,
                        category: block.category,
                    })
                    .collect(),
            })
            .collect::<Vec<_>>();
        cancellation.check()?;
        let quick_blocks = self
            .list_quick_blocks()
            .await?
            .into_iter()
            .map(|item| ExportQuickBlock { draft: item.draft })
            .collect::<Vec<_>>();
        cancellation.check()?;
        let free_alarms = self
            .list_free_alarms()
            .await?
            .into_iter()
            .map(|item| ExportAlarm { draft: item.draft })
            .collect::<Vec<_>>();
        cancellation.check()?;
        let envelope = ExportEnvelope {
            format_version: EXPORT_FORMAT_VERSION,
            created_at: Utc::now(),
            source_timezone: timezone_id.to_owned(),
            schedules,
            templates,
            quick_blocks,
            free_alarms,
            settings: self.settings().await?,
        };
        let bytes = serde_json::to_vec_pretty(&envelope)
            .map_err(|error| AppError::database("export-encode", error))?;
        cancellation.check()?;
        if bytes.len() as u64 > MAX_IMPORT_BYTES {
            return Err(AppError::Unavailable {
                message: "エクスポートデータが安全な上限を超えました。".into(),
                recovery: "期間を分ける機能は未提供です。バックアップを利用してください。".into(),
                retryable: false,
            });
        }
        let temporary = target.with_extension("json.part");
        if let Err(error) = fs::write(&temporary, &bytes) {
            let _ = fs::remove_file(&temporary);
            return Err(AppError::database("export-write", error));
        }
        if let Err(error) = cancellation.check() {
            let _ = fs::remove_file(&temporary);
            return Err(error);
        }
        if let Err(error) = fs::rename(&temporary, target) {
            let _ = fs::remove_file(&temporary);
            return Err(AppError::database("export-rename", error));
        }
        Ok(ExportResult {
            file_name: safe_file_name(target),
            bytes_written: bytes.len() as u64,
            schedule_count: envelope.schedules.len(),
            template_count: envelope.templates.len(),
            quick_block_count: envelope.quick_blocks.len(),
            alarm_count: envelope.free_alarms.len(),
        })
    }

    pub fn preview_import(path: &Path) -> AppResult<ImportPreview> {
        let (bytes, fingerprint) = read_import_file(path)?;
        let envelope = parse_and_validate_export(&bytes)?;
        let warnings = vec![
            "Google接続、同期マッピング、認証情報、通知履歴は取り込みません。".into(),
            "既定テンプレートは保護し、同名テンプレートには連番を付けます。".into(),
        ];
        Ok(ImportPreview {
            fingerprint,
            format_version: envelope.format_version,
            created_at: envelope.created_at,
            source_timezone: envelope.source_timezone,
            schedule_count: envelope.schedules.len(),
            template_count: envelope.templates.len(),
            quick_block_count: envelope.quick_blocks.len(),
            alarm_count: envelope.free_alarms.len(),
            warnings,
        })
    }

    pub async fn import_json(
        &self,
        path: &Path,
        expected_fingerprint: &str,
        mode: ImportMode,
    ) -> AppResult<ImportResult> {
        let (bytes, fingerprint) = read_import_file(path)?;
        if !constant_time_eq(fingerprint.as_bytes(), expected_fingerprint.as_bytes()) {
            return Err(AppError::Conflict {
                message: "プレビュー後にインポートファイルが変更されました。".into(),
                recovery: "もう一度プレビューして内容と件数を確認してください。".into(),
            });
        }
        let envelope = parse_and_validate_export(&bytes)?;
        let mut transaction = self
            .pool
            .begin()
            .await
            .map_err(|error| AppError::database("import-begin", error))?;
        let preserved_external_schedule_count = if matches!(mode, ImportMode::Replace) {
            replace_local_data(&mut transaction).await?
        } else {
            0
        };
        let now = Utc::now();
        for mut schedule in envelope.schedules.iter().cloned() {
            schedule.id = Uuid::new_v4();
            schedule.sync_status = SyncStatus::LocalOnly;
            schedule.version = 0;
            schedule.deleted_at = None;
            insert_schedule(&mut transaction, &schedule, now).await?;
        }
        let imported_template_count =
            insert_templates(&mut transaction, &envelope.templates, now).await?;
        insert_quick_blocks(&mut transaction, &envelope.quick_blocks, now).await?;
        insert_alarms(&mut transaction, &envelope.free_alarms, now).await?;
        if matches!(mode, ImportMode::Replace) {
            let settings_json = serde_json::to_string(&envelope.settings)
                .map_err(|error| AppError::database("import-settings-encode", error))?;
            sqlx::query(
                "UPDATE settings SET value_json = ?, updated_at_utc = ? WHERE key = 'application'",
            )
            .bind(settings_json)
            .bind(timestamp(now))
            .execute(&mut *transaction)
            .await
            .map_err(|error| AppError::database("import-settings", error))?;
        }
        transaction
            .commit()
            .await
            .map_err(|error| AppError::database("import-commit", error))?;
        Ok(ImportResult {
            imported_schedule_count: envelope.schedules.len(),
            imported_template_count,
            imported_quick_block_count: envelope.quick_blocks.len(),
            imported_alarm_count: envelope.free_alarms.len(),
            preserved_external_schedule_count,
        })
    }
}

fn read_import_file(path: &Path) -> AppResult<(Vec<u8>, String)> {
    validate_json_path(path, false)?;
    let metadata =
        fs::metadata(path).map_err(|error| AppError::database("import-metadata", error))?;
    if !metadata.is_file() || metadata.len() == 0 || metadata.len() > MAX_IMPORT_BYTES {
        return Err(AppError::Validation {
            message: "インポートファイルのサイズが正しくありません。".into(),
            recovery: "25MB以下のDay Schedule Next JSONを選んでください。".into(),
        });
    }
    let bytes = fs::read(path).map_err(|error| AppError::database("import-read", error))?;
    let fingerprint = format!("{:x}", Sha256::digest(&bytes));
    Ok((bytes, fingerprint))
}

fn parse_and_validate_export(bytes: &[u8]) -> AppResult<ExportEnvelope> {
    let root: Value =
        serde_json::from_slice(bytes).map_err(|_| invalid_import("JSONを解析できません。"))?;
    let object = root
        .as_object()
        .ok_or_else(|| invalid_import("最上位がオブジェクトではありません。"))?;
    let version = object
        .get("formatVersion")
        .and_then(Value::as_u64)
        .ok_or_else(|| invalid_import("formatVersionがありません。"))?;
    if version != u64::from(EXPORT_FORMAT_VERSION) {
        return Err(invalid_import("対応していないデータ形式です。"));
    }
    for (key, maximum) in [
        ("schedules", MAX_SCHEDULES),
        ("templates", MAX_TEMPLATES),
        ("quickBlocks", MAX_LIBRARY_ITEMS),
        ("freeAlarms", MAX_LIBRARY_ITEMS),
    ] {
        let length = object
            .get(key)
            .and_then(Value::as_array)
            .ok_or_else(|| invalid_import("必要な配列がありません。"))?
            .len();
        if length > maximum {
            return Err(invalid_import("項目数が安全な上限を超えています。"));
        }
    }
    let mut envelope: ExportEnvelope = serde_json::from_value(root)
        .map_err(|_| invalid_import("項目の型または必須値が正しくありません。"))?;
    if envelope.source_timezone.len() > 100
        || envelope.source_timezone.parse::<chrono_tz::Tz>().is_err()
    {
        return Err(invalid_import("sourceTimezoneが正しくありません。"));
    }
    for (index, schedule) in envelope.schedules.iter_mut().enumerate() {
        schedule.draft.validate().map_err(|_| {
            invalid_import(&format!("予定{}件目の値が正しくありません。", index + 1))
        })?;
    }
    for (index, template) in envelope.templates.iter_mut().enumerate() {
        let mut draft = DayTemplateDraft {
            name: template.name.clone(),
            description: template.description.clone(),
            color: template.color.clone(),
            weekdays_mask: template.weekdays_mask,
            blocks: template.blocks.clone(),
        };
        draft.validate().map_err(|_| {
            invalid_import(&format!(
                "テンプレート{}件目の値が正しくありません。",
                index + 1
            ))
        })?;
        template.name = draft.name;
        template.blocks = draft.blocks;
    }
    for (index, item) in envelope.quick_blocks.iter_mut().enumerate() {
        item.draft.validate().map_err(|_| {
            invalid_import(&format!(
                "Quick Block{}件目の値が正しくありません。",
                index + 1
            ))
        })?;
    }
    for (index, item) in envelope.free_alarms.iter_mut().enumerate() {
        item.draft.validate().map_err(|_| {
            invalid_import(&format!(
                "アラーム{}件目の値が正しくありません。",
                index + 1
            ))
        })?;
    }
    envelope.settings.validate()?;
    Ok(envelope)
}

async fn replace_local_data(transaction: &mut Transaction<'_, Sqlite>) -> AppResult<u64> {
    let preserved: i64 = sqlx::query_scalar(
        "SELECT COUNT(*) FROM schedule_items WHERE EXISTS (SELECT 1 FROM sync_mappings WHERE schedule_item_id = schedule_items.id)",
    )
    .fetch_one(&mut **transaction)
    .await
    .map_err(|error| AppError::database("import-count-external", error))?;
    sqlx::query(
        "DELETE FROM schedule_items WHERE NOT EXISTS (SELECT 1 FROM sync_mappings WHERE schedule_item_id = schedule_items.id)",
    )
    .execute(&mut **transaction)
    .await
    .map_err(|error| AppError::database("import-replace-schedules", error))?;
    sqlx::query("DELETE FROM templates WHERE is_builtin = 0")
        .execute(&mut **transaction)
        .await
        .map_err(|error| AppError::database("import-replace-templates", error))?;
    sqlx::query("DELETE FROM quick_blocks")
        .execute(&mut **transaction)
        .await
        .map_err(|error| AppError::database("import-replace-quick-blocks", error))?;
    sqlx::query("DELETE FROM free_alarms")
        .execute(&mut **transaction)
        .await
        .map_err(|error| AppError::database("import-replace-alarms", error))?;
    Ok(preserved.max(0) as u64)
}

async fn insert_templates(
    transaction: &mut Transaction<'_, Sqlite>,
    templates: &[ExportTemplate],
    now: DateTime<Utc>,
) -> AppResult<usize> {
    let mut imported = 0;
    for (template_index, template) in templates.iter().enumerate() {
        let name = unique_template_name(transaction, &template.name).await?;
        let template_id = Uuid::new_v4();
        sqlx::query(
            "INSERT INTO templates(id, name, description, color, weekdays_mask, is_builtin, sort_order, version, created_at_utc, updated_at_utc) VALUES (?, ?, ?, ?, ?, 0, ?, 0, ?, ?)",
        )
        .bind(template_id.to_string())
        .bind(name)
        .bind(&template.description)
        .bind(&template.color)
        .bind(i64::from(template.weekdays_mask))
        .bind((template_index + 1) as i64)
        .bind(timestamp(now))
        .bind(timestamp(now))
        .execute(&mut **transaction)
        .await
        .map_err(|error| AppError::database("import-template", error))?;
        for (index, block) in template.blocks.iter().enumerate() {
            sqlx::query(
                "INSERT INTO template_blocks(id, template_id, title, start_minute, duration_minutes, color, project, category, sort_order) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)",
            )
            .bind(Uuid::new_v4().to_string())
            .bind(template_id.to_string())
            .bind(&block.title)
            .bind(i64::from(block.start_minute))
            .bind(i64::from(block.duration_minutes))
            .bind(&block.color)
            .bind(&block.project)
            .bind(&block.category)
            .bind(index as i64)
            .execute(&mut **transaction)
            .await
            .map_err(|error| AppError::database("import-template-block", error))?;
        }
        imported += 1;
    }
    Ok(imported)
}

async fn unique_template_name(
    transaction: &mut Transaction<'_, Sqlite>,
    original: &str,
) -> AppResult<String> {
    for suffix in 0..=9_999 {
        let candidate = if suffix == 0 {
            original.to_owned()
        } else {
            let marker = format!(" ({suffix})");
            let keep = 100usize.saturating_sub(marker.chars().count());
            format!(
                "{}{}",
                original.chars().take(keep).collect::<String>(),
                marker
            )
        };
        let exists: bool =
            sqlx::query_scalar("SELECT EXISTS(SELECT 1 FROM templates WHERE name = ?)")
                .bind(&candidate)
                .fetch_one(&mut **transaction)
                .await
                .map_err(|error| AppError::database("import-template-name", error))?;
        if !exists {
            return Ok(candidate);
        }
    }
    Err(invalid_import("テンプレート名の重複を解決できません。"))
}

async fn insert_quick_blocks(
    transaction: &mut Transaction<'_, Sqlite>,
    items: &[ExportQuickBlock],
    now: DateTime<Utc>,
) -> AppResult<()> {
    for (index, item) in items.iter().enumerate() {
        sqlx::query(
            "INSERT INTO quick_blocks(id, title, start_minute, duration_minutes, time_zone, color, project, category, start_notification_minutes, end_notification_minutes, is_active, sort_order, version, created_at_utc, updated_at_utc) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, 0, ?, ?)",
        )
        .bind(Uuid::new_v4().to_string())
        .bind(&item.draft.title)
        .bind(i64::from(item.draft.start_minute))
        .bind(i64::from(item.draft.duration_minutes))
        .bind(&item.draft.timezone_id)
        .bind(&item.draft.color)
        .bind(&item.draft.project)
        .bind(&item.draft.category)
        .bind(item.draft.start_notification_minutes.map(i64::from))
        .bind(item.draft.end_notification_minutes.map(i64::from))
        .bind(item.draft.is_active)
        .bind(index as i64)
        .bind(timestamp(now))
        .bind(timestamp(now))
        .execute(&mut **transaction)
        .await
        .map_err(|error| AppError::database("import-quick-block", error))?;
    }
    Ok(())
}

async fn insert_alarms(
    transaction: &mut Transaction<'_, Sqlite>,
    items: &[ExportAlarm],
    now: DateTime<Utc>,
) -> AppResult<()> {
    for (index, item) in items.iter().enumerate() {
        sqlx::query(
            "INSERT INTO free_alarms(id, label, minute_of_day, time_zone, weekdays_mask, enabled, sort_order, version, created_at_utc, updated_at_utc) VALUES (?, ?, ?, ?, ?, ?, ?, 0, ?, ?)",
        )
        .bind(Uuid::new_v4().to_string())
        .bind(&item.draft.label)
        .bind(i64::from(item.draft.minute_of_day))
        .bind(&item.draft.timezone_id)
        .bind(i64::from(item.draft.weekdays_mask))
        .bind(item.draft.enabled)
        .bind(index as i64)
        .bind(timestamp(now))
        .bind(timestamp(now))
        .execute(&mut **transaction)
        .await
        .map_err(|error| AppError::database("import-alarm", error))?;
    }
    Ok(())
}

fn validate_json_path(path: &Path, target: bool) -> AppResult<()> {
    let extension_valid = path
        .extension()
        .and_then(|value| value.to_str())
        .is_some_and(|value| value.eq_ignore_ascii_case("json"));
    let parent_valid = path.parent().is_some_and(Path::is_dir);
    if !extension_valid || (target && !parent_valid) {
        return Err(AppError::Validation {
            message: "JSONファイルの場所が正しくありません。".into(),
            recovery: "拡張子.jsonのファイルを選び直してください。".into(),
        });
    }
    Ok(())
}

fn invalid_import(detail: &str) -> AppError {
    AppError::Validation {
        message: format!("インポートデータが正しくありません: {detail}"),
        recovery: "元データを変更せず、エクスポートし直してから再度選択してください。".into(),
    }
}

fn timestamp(value: DateTime<Utc>) -> String {
    value.to_rfc3339_opts(SecondsFormat::Millis, true)
}

fn safe_file_name(path: &Path) -> String {
    path.file_name()
        .and_then(|value| value.to_str())
        .unwrap_or("day-schedule-next-export.json")
        .to_owned()
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
    use chrono::TimeZone;
    use tempfile::tempdir;

    use crate::domain::{Priority, ScheduleDraft, ScheduleStatus};

    use super::*;

    fn draft() -> ScheduleDraft {
        ScheduleDraft {
            title: "移行する予定".into(),
            description: "秘密ではないテスト値".into(),
            location: String::new(),
            start_utc: Utc.with_ymd_and_hms(2026, 7, 20, 1, 0, 0).unwrap(),
            end_utc: Utc.with_ymd_and_hms(2026, 7, 20, 2, 0, 0).unwrap(),
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
            start_notification_minutes: None,
            end_notification_minutes: None,
        }
    }

    #[tokio::test]
    async fn export_preview_and_atomic_import_roundtrip() {
        let source = Database::open_memory().await.unwrap();
        source.create_schedule(draft()).await.unwrap();
        let directory = tempdir().unwrap();
        let path = directory.path().join("export.json");
        let exported = source.export_json(&path, "Asia/Tokyo").await.unwrap();
        assert_eq!(exported.schedule_count, 1);
        let preview = Database::preview_import(&path).unwrap();
        assert_eq!(preview.schedule_count, 1);

        let target = Database::open_memory().await.unwrap();
        let result = target
            .import_json(&path, &preview.fingerprint, ImportMode::Add)
            .await
            .unwrap();
        assert_eq!(result.imported_schedule_count, 1);
        let count: i64 = sqlx::query_scalar("SELECT COUNT(*) FROM schedule_items")
            .fetch_one(&target.pool)
            .await
            .unwrap();
        assert_eq!(count, 1);
    }

    #[tokio::test]
    async fn cancelled_export_does_not_publish_a_target_or_partial_file() {
        let source = Database::open_memory().await.unwrap();
        source.create_schedule(draft()).await.unwrap();
        let directory = tempdir().unwrap();
        let path = directory.path().join("cancelled.json");
        let cancellation = OperationCancellation::default();
        cancellation.cancel();

        let result = source
            .export_json_cancelable(&path, "Asia/Tokyo", &cancellation)
            .await;

        assert!(matches!(result, Err(AppError::Cancelled { .. })));
        assert!(!path.exists());
        assert!(!path.with_extension("json.part").exists());
    }

    #[tokio::test]
    async fn import_rejects_file_changed_after_preview_without_mutation() {
        let source = Database::open_memory().await.unwrap();
        source.create_schedule(draft()).await.unwrap();
        let directory = tempdir().unwrap();
        let path = directory.path().join("export.json");
        source.export_json(&path, "Asia/Tokyo").await.unwrap();
        let preview = Database::preview_import(&path).unwrap();
        let mut bytes = fs::read(&path).unwrap();
        bytes.push(b' ');
        fs::write(&path, bytes).unwrap();

        let target = Database::open_memory().await.unwrap();
        assert!(
            target
                .import_json(&path, &preview.fingerprint, ImportMode::Add)
                .await
                .is_err()
        );
        let count: i64 = sqlx::query_scalar("SELECT COUNT(*) FROM schedule_items")
            .fetch_one(&target.pool)
            .await
            .unwrap();
        assert_eq!(count, 0);
    }
}
