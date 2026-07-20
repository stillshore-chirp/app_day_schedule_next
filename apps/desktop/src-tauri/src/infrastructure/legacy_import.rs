use std::{
    collections::{HashMap, HashSet},
    path::Path,
    str::FromStr,
};

use serde::Serialize;
use sha2::{Digest, Sha256};
use sqlx::{
    Column, Row, SqlitePool,
    sqlite::{SqliteConnectOptions, SqlitePoolOptions, SqliteRow},
};
use uuid::Uuid;

use crate::domain::{AppError, AppResult, Settings};

use super::Database;

const MAX_LEGACY_BYTES: u64 = 256 * 1024 * 1024;
const MAX_ROWS_PER_TABLE: usize = 100_000;

#[derive(Debug, Clone, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct LegacyImportPreview {
    pub fingerprint: String,
    pub template_count: u64,
    pub template_block_count: u64,
    pub quick_block_count: u64,
    pub alarm_count: u64,
    pub orphan_count: u64,
    pub invalid_time_count: u64,
    pub duplicate_name_count: u64,
    pub last_profile_found: bool,
    pub warnings: Vec<String>,
    pub excluded: Vec<String>,
}

#[derive(Debug, Clone, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct LegacyImportResult {
    pub imported_template_count: u64,
    pub imported_template_block_count: u64,
    pub imported_quick_block_count: u64,
    pub imported_alarm_count: u64,
    pub selected_template_id: Uuid,
}

#[derive(Debug, Clone)]
struct LegacyTemplate {
    id: Uuid,
    source_key: String,
    name: String,
    description: String,
    color: String,
    weekdays_mask: i64,
}

#[derive(Debug, Clone)]
struct LegacyBlock {
    id: Uuid,
    template_id: Uuid,
    title: String,
    start_minute: i64,
    duration_minutes: i64,
    color: String,
}

#[derive(Debug, Clone)]
struct LegacyQuickBlock {
    id: Uuid,
    title: String,
    start_minute: i64,
    duration_minutes: i64,
    color: String,
}

#[derive(Debug, Clone)]
struct LegacyAlarm {
    id: Uuid,
    label: String,
    minute_of_day: i64,
    weekdays_mask: i64,
    enabled: bool,
}

struct LegacyData {
    fingerprint: String,
    templates: Vec<LegacyTemplate>,
    blocks: Vec<LegacyBlock>,
    quick_blocks: Vec<LegacyQuickBlock>,
    alarms: Vec<LegacyAlarm>,
    last_profile: Option<String>,
    orphan_count: u64,
    invalid_time_count: u64,
    duplicate_name_count: u64,
    warnings: Vec<String>,
}

impl Database {
    pub async fn preview_legacy_import(path: &Path) -> AppResult<LegacyImportPreview> {
        let data = analyse(path).await?;
        Ok(preview_from_data(&data))
    }

    pub async fn import_legacy(
        &self,
        path: &Path,
        expected_fingerprint: &str,
    ) -> AppResult<LegacyImportResult> {
        let mut data = analyse(path).await?;
        if !constant_time_equal(data.fingerprint.as_bytes(), expected_fingerprint.as_bytes()) {
            return Err(AppError::Conflict {
                message: "旧データベースがプレビュー後に変更されました。".into(),
                recovery: "元データを閉じ、もう一度プレビューしてから取り込んでください。".into(),
            });
        }
        let mut transaction = self
            .pool
            .begin()
            .await
            .map_err(|error| AppError::database("legacy-import-begin", error))?;
        let existing_names = sqlx::query_scalar::<_, String>("SELECT name FROM templates")
            .fetch_all(&mut *transaction)
            .await
            .map_err(|error| AppError::database("legacy-import-existing-names", error))?;
        let mut names = existing_names.into_iter().collect::<HashSet<_>>();
        for template in &mut data.templates {
            template.name = unique_name(&template.name, &mut names);
            sqlx::query(
                "INSERT INTO templates(id, name, description, color, weekdays_mask, is_builtin, sort_order, version, created_at_utc, updated_at_utc) VALUES (?, ?, ?, ?, ?, 0, ?, 0, ?, ?)",
            )
            .bind(template.id.to_string())
            .bind(&template.name)
            .bind(&template.description)
            .bind(&template.color)
            .bind(template.weekdays_mask)
            .bind(names.len() as i64)
            .bind(chrono::Utc::now().to_rfc3339())
            .bind(chrono::Utc::now().to_rfc3339())
            .execute(&mut *transaction)
            .await
            .map_err(|error| AppError::database("legacy-import-template", error))?;
        }
        for (index, block) in data.blocks.iter().enumerate() {
            sqlx::query(
                "INSERT INTO template_blocks(id, template_id, title, start_minute, duration_minutes, color, project, category, sort_order) VALUES (?, ?, ?, ?, ?, ?, '', '', ?)",
            )
            .bind(block.id.to_string())
            .bind(block.template_id.to_string())
            .bind(&block.title)
            .bind(block.start_minute)
            .bind(block.duration_minutes)
            .bind(&block.color)
            .bind(index as i64)
            .execute(&mut *transaction)
            .await
            .map_err(|error| AppError::database("legacy-import-template-block", error))?;
        }
        for (index, block) in data.quick_blocks.iter().enumerate() {
            sqlx::query(
                "INSERT INTO quick_blocks(id, title, start_minute, duration_minutes, time_zone, color, project, category, start_notification_minutes, end_notification_minutes, is_active, sort_order, version, created_at_utc, updated_at_utc) VALUES (?, ?, ?, ?, ?, ?, '', '', NULL, NULL, 1, ?, 0, ?, ?)",
            )
            .bind(block.id.to_string())
            .bind(&block.title)
            .bind(block.start_minute)
            .bind(block.duration_minutes)
            .bind(current_timezone())
            .bind(&block.color)
            .bind(index as i64)
            .bind(chrono::Utc::now().to_rfc3339())
            .bind(chrono::Utc::now().to_rfc3339())
            .execute(&mut *transaction)
            .await
            .map_err(|error| AppError::database("legacy-import-quick-block", error))?;
        }
        for (index, alarm) in data.alarms.iter().enumerate() {
            sqlx::query(
                "INSERT INTO free_alarms(id, label, minute_of_day, time_zone, weekdays_mask, enabled, sort_order, version, created_at_utc, updated_at_utc) VALUES (?, ?, ?, ?, ?, ?, ?, 0, ?, ?)",
            )
            .bind(alarm.id.to_string())
            .bind(&alarm.label)
            .bind(alarm.minute_of_day)
            .bind(current_timezone())
            .bind(alarm.weekdays_mask)
            .bind(alarm.enabled)
            .bind(index as i64)
            .bind(chrono::Utc::now().to_rfc3339())
            .bind(chrono::Utc::now().to_rfc3339())
            .execute(&mut *transaction)
            .await
            .map_err(|error| AppError::database("legacy-import-alarm", error))?;
        }

        let selected_template_id = data
            .last_profile
            .as_ref()
            .and_then(|source| {
                data.templates
                    .iter()
                    .find(|template| &template.source_key == source)
                    .map(|template| template.id)
            })
            .or_else(|| data.templates.first().map(|template| template.id));
        let selected_template_id = if let Some(id) = selected_template_id {
            id
        } else {
            let value = sqlx::query_scalar::<_, String>(
                "SELECT id FROM templates WHERE is_builtin = 1 LIMIT 1",
            )
            .fetch_one(&mut *transaction)
            .await
            .map_err(|error| AppError::database("legacy-import-default-template", error))?;
            Uuid::parse_str(&value)
                .map_err(|error| AppError::database("legacy-import-default-id", error))?
        };
        let settings_json: String =
            sqlx::query_scalar("SELECT value_json FROM settings WHERE key = 'application'")
                .fetch_one(&mut *transaction)
                .await
                .map_err(|error| AppError::database("legacy-import-settings-read", error))?;
        let mut settings: Settings = serde_json::from_str(&settings_json)
            .map_err(|error| AppError::database("legacy-import-settings-decode", error))?;
        settings.last_template_id = Some(selected_template_id);
        sqlx::query(
            "UPDATE settings SET value_json = ?, updated_at_utc = ? WHERE key = 'application'",
        )
        .bind(
            serde_json::to_string(&settings)
                .map_err(|error| AppError::database("legacy-import-settings-encode", error))?,
        )
        .bind(chrono::Utc::now().to_rfc3339())
        .execute(&mut *transaction)
        .await
        .map_err(|error| AppError::database("legacy-import-settings-update", error))?;

        transaction
            .commit()
            .await
            .map_err(|error| AppError::database("legacy-import-commit", error))?;
        Ok(LegacyImportResult {
            imported_template_count: data.templates.len() as u64,
            imported_template_block_count: data.blocks.len() as u64,
            imported_quick_block_count: data.quick_blocks.len() as u64,
            imported_alarm_count: data.alarms.len() as u64,
            selected_template_id,
        })
    }
}

fn preview_from_data(data: &LegacyData) -> LegacyImportPreview {
    let mut warnings = data.warnings.clone();
    if data.last_profile.is_none() {
        warnings.push(
            "last_profileが見つからないため、取り込み後は先頭または既定テンプレートを選びます。"
                .into(),
        );
    }
    LegacyImportPreview {
        fingerprint: data.fingerprint.clone(),
        template_count: data.templates.len() as u64,
        template_block_count: data.blocks.len() as u64,
        quick_block_count: data.quick_blocks.len() as u64,
        alarm_count: data.alarms.len() as u64,
        orphan_count: data.orphan_count,
        invalid_time_count: data.invalid_time_count,
        duplicate_name_count: data.duplicate_name_count,
        last_profile_found: data.last_profile.is_some(),
        warnings,
        excluded: vec![
            "旧ウィンドウ位置".into(),
            "Windows専用音".into(),
            "デバッグ出力".into(),
        ],
    }
}

async fn analyse(path: &Path) -> AppResult<LegacyData> {
    validate_source(path)?;
    let fingerprint_before = fingerprint(path)?;
    let options = SqliteConnectOptions::from_str(&format!("sqlite:{}", path.display()))
        .map_err(|error| AppError::database("legacy-connect-options", error))?
        .read_only(true)
        .create_if_missing(false);
    let pool = SqlitePoolOptions::new()
        .max_connections(1)
        .connect_with(options)
        .await
        .map_err(|error| AppError::Validation {
            message: "旧schedule.dbを読み取り専用で開けませんでした。".into(),
            recovery: format!("SQLiteファイルを選び直してください（{error}）。"),
        })?;
    let quick_check: String = sqlx::query_scalar("PRAGMA quick_check")
        .fetch_one(&pool)
        .await
        .map_err(|error| AppError::database("legacy-quick-check", error))?;
    if quick_check != "ok" {
        return Err(AppError::Validation {
            message: "旧schedule.dbの整合性確認に失敗しました。".into(),
            recovery: "元アプリ側でバックアップを作成し、正常なコピーを選んでください。".into(),
        });
    }

    let mut warnings = Vec::new();
    let profiles = rows_if_present(&pool, "profiles").await?;
    let schedules = rows_if_present(&pool, "schedules").await?;
    let instant = rows_if_present(&pool, "instant_schedules").await?;
    let alarm_rows = rows_if_present(&pool, "free_alarms").await?;
    if profiles.is_none() {
        warnings.push("profilesテーブルがないため、テンプレートは取り込みません。".into());
    }
    if schedules.is_none() {
        warnings.push("schedulesテーブルがないため、テンプレートブロックは取り込みません。".into());
    }
    if instant.is_none() {
        warnings.push("instant_schedulesテーブルがないため、Quick Blockは取り込みません。".into());
    }
    if alarm_rows.is_none() {
        warnings.push("free_alarmsテーブルがないため、アラームは取り込みません。".into());
    }

    let mut duplicate_name_count = 0_u64;
    let mut seen_names = HashSet::new();
    let mut templates = Vec::new();
    let mut source_to_template = HashMap::new();
    for (index, row) in profiles.unwrap_or_default().iter().enumerate() {
        let source_key = value(row, &["id", "profile_id", "key"])
            .unwrap_or_else(|| format!("row-{}", index + 1));
        let base_name = bounded(
            value(row, &["name", "profile_name", "title"])
                .unwrap_or_else(|| "旧テンプレート".into()),
            100,
        );
        if !seen_names.insert(base_name.clone()) {
            duplicate_name_count += 1;
        }
        let id = Uuid::new_v4();
        source_to_template.insert(source_key.clone(), id);
        templates.push(LegacyTemplate {
            id,
            source_key,
            name: base_name,
            description: bounded(
                value(row, &["description", "memo"]).unwrap_or_default(),
                1_000,
            ),
            color: valid_color(value(row, &["color", "colour"]).as_deref()),
            weekdays_mask: bounded_mask(value(row, &["weekdays_mask", "weekdays", "days"])),
        });
    }

    let mut orphan_count = 0_u64;
    let mut invalid_time_count = 0_u64;
    let mut blocks = Vec::new();
    for (index, row) in schedules.unwrap_or_default().iter().enumerate() {
        let profile_key = value(row, &["profile_id", "profile", "profile_key"]).unwrap_or_default();
        let Some(template_id) = source_to_template.get(&profile_key).copied() else {
            orphan_count += 1;
            continue;
        };
        let Some((start_minute, duration_minutes)) = interval(row) else {
            invalid_time_count += 1;
            continue;
        };
        blocks.push(LegacyBlock {
            id: Uuid::new_v4(),
            template_id,
            title: bounded(
                value(row, &["title", "name", "label"])
                    .unwrap_or_else(|| format!("旧ブロック {}", index + 1)),
                200,
            ),
            start_minute,
            duration_minutes,
            color: valid_color(value(row, &["color", "colour"]).as_deref()),
        });
    }

    let mut quick_blocks = Vec::new();
    for (index, row) in instant.unwrap_or_default().iter().enumerate() {
        let Some((start_minute, duration_minutes)) = interval(row) else {
            invalid_time_count += 1;
            continue;
        };
        quick_blocks.push(LegacyQuickBlock {
            id: Uuid::new_v4(),
            title: bounded(
                value(row, &["title", "name", "label"])
                    .unwrap_or_else(|| format!("旧Quick Block {}", index + 1)),
                200,
            ),
            start_minute,
            duration_minutes,
            color: valid_color(value(row, &["color", "colour"]).as_deref()),
        });
    }

    let mut alarms = Vec::new();
    for (index, row) in alarm_rows.unwrap_or_default().iter().enumerate() {
        let Some(minute_of_day) = value(row, &["minute_of_day", "time", "alarm_time"])
            .as_deref()
            .and_then(parse_minute)
        else {
            invalid_time_count += 1;
            continue;
        };
        alarms.push(LegacyAlarm {
            id: Uuid::new_v4(),
            label: bounded(
                value(row, &["label", "name", "title"])
                    .unwrap_or_else(|| format!("旧アラーム {}", index + 1)),
                200,
            ),
            minute_of_day,
            weekdays_mask: bounded_mask(value(row, &["weekdays_mask", "weekdays", "days"])),
            enabled: value(row, &["enabled", "is_active", "active"])
                .as_deref()
                .is_none_or(parse_bool),
        });
    }

    let mut last_profile = read_last_profile(&pool).await?;
    pool.close().await;
    let fingerprint_after = fingerprint(path)?;
    if fingerprint_before != fingerprint_after {
        return Err(AppError::Conflict {
            message: "解析中に旧schedule.dbが変更されました。".into(),
            recovery: "元アプリを閉じ、DBのコピーを作ってから再度選択してください。".into(),
        });
    }
    if orphan_count > 0 {
        warnings.push(format!(
            "参照先プロフィールがないブロック{orphan_count}件は取り込み対象外です。"
        ));
    }
    if invalid_time_count > 0 {
        warnings.push(format!(
            "時刻を安全に変換できない項目{invalid_time_count}件は取り込み対象外です。"
        ));
    }
    if duplicate_name_count > 0 {
        warnings.push(format!(
            "重複するテンプレート名{duplicate_name_count}件は連番を付けて取り込みます。"
        ));
    }
    if last_profile
        .as_ref()
        .is_some_and(|value| !source_to_template.contains_key(value))
    {
        warnings.push(
            "last_profileが存在しないプロフィールを指すため、既定テンプレートへフォールバックします。"
                .into(),
        );
        last_profile = None;
    }
    Ok(LegacyData {
        fingerprint: fingerprint_after,
        templates,
        blocks,
        quick_blocks,
        alarms,
        last_profile,
        orphan_count,
        invalid_time_count,
        duplicate_name_count,
        warnings,
    })
}

async fn rows_if_present(pool: &SqlitePool, table: &str) -> AppResult<Option<Vec<SqliteRow>>> {
    let exists: i64 = sqlx::query_scalar(
        "SELECT EXISTS(SELECT 1 FROM sqlite_schema WHERE type = 'table' AND name = ?)",
    )
    .bind(table)
    .fetch_one(pool)
    .await
    .map_err(|error| AppError::database("legacy-table-check", error))?;
    if exists == 0 {
        return Ok(None);
    }
    let count: i64 = sqlx::query_scalar(&format!("SELECT COUNT(*) FROM {table}"))
        .fetch_one(pool)
        .await
        .map_err(|error| AppError::database("legacy-row-count", error))?;
    if count < 0 || count as usize > MAX_ROWS_PER_TABLE {
        return Err(AppError::Validation {
            message: format!("{table}の件数が安全な上限を超えています。"),
            recovery: "元DBを確認し、不要データを整理したコピーで再試行してください。".into(),
        });
    }
    sqlx::query(&format!("SELECT * FROM {table} ORDER BY rowid"))
        .fetch_all(pool)
        .await
        .map(Some)
        .map_err(|error| AppError::database("legacy-table-read", error))
}

async fn read_last_profile(pool: &SqlitePool) -> AppResult<Option<String>> {
    let settings = rows_if_present(pool, "settings").await?;
    Ok(settings.and_then(|rows| {
        rows.iter().find_map(|row| {
            let key = value(row, &["key", "name", "setting"])?;
            if key == "last_profile" {
                value(row, &["value", "value_text", "data"])
            } else {
                None
            }
        })
    }))
}

fn value(row: &SqliteRow, candidates: &[&str]) -> Option<String> {
    for candidate in candidates {
        let Some(index) = row
            .columns()
            .iter()
            .position(|column| column.name().eq_ignore_ascii_case(candidate))
        else {
            continue;
        };
        if let Ok(Some(value)) = row.try_get::<Option<String>, _>(index) {
            return Some(value);
        }
        if let Ok(Some(value)) = row.try_get::<Option<i64>, _>(index) {
            return Some(value.to_string());
        }
        if let Ok(Some(value)) = row.try_get::<Option<f64>, _>(index) {
            return Some(value.to_string());
        }
    }
    None
}

fn interval(row: &SqliteRow) -> Option<(i64, i64)> {
    let start = value(
        row,
        &["start_minute", "start_time", "start", "time", "begin_time"],
    )
    .as_deref()
    .and_then(parse_minute)?;
    let duration = value(row, &["duration_minutes", "duration", "minutes"])
        .as_deref()
        .and_then(parse_positive_duration)
        .or_else(|| {
            let end = value(row, &["end_minute", "end_time", "end", "finish_time"])
                .as_deref()
                .and_then(parse_minute)?;
            Some(if end > start {
                end - start
            } else {
                1_440 - start + end
            })
        })?;
    (1..=1_440).contains(&duration).then_some((start, duration))
}

fn parse_minute(value: &str) -> Option<i64> {
    let value = value.trim();
    if let Ok(number) = value.parse::<i64>() {
        return (0..=1_439).contains(&number).then_some(number);
    }
    let time = value.rsplit('T').next().unwrap_or(value);
    let mut parts = time.split(':');
    let hour = parts.next()?.parse::<i64>().ok()?;
    let minute = parts.next()?.parse::<i64>().ok()?;
    (hour <= 23 && minute <= 59).then_some(hour * 60 + minute)
}

fn parse_positive_duration(value: &str) -> Option<i64> {
    let value = value.trim();
    if let Ok(minutes) = value.parse::<i64>() {
        return (1..=1_440).contains(&minutes).then_some(minutes);
    }
    let mut parts = value.split(':');
    let hours = parts.next()?.parse::<i64>().ok()?;
    let minutes = parts.next()?.parse::<i64>().ok()?;
    let total = hours * 60 + minutes;
    (1..=1_440).contains(&total).then_some(total)
}

fn bounded_mask(value: Option<String>) -> i64 {
    value
        .as_deref()
        .and_then(|value| value.parse::<i64>().ok())
        .filter(|value| (0..=127).contains(value))
        .unwrap_or(127)
}

fn parse_bool(value: &str) -> bool {
    matches!(
        value.trim().to_ascii_lowercase().as_str(),
        "1" | "true" | "yes" | "on"
    )
}

fn valid_color(value: Option<&str>) -> String {
    let value = value.unwrap_or("#6F96F4");
    if value.len() == 7
        && value.starts_with('#')
        && value.as_bytes()[1..].iter().all(u8::is_ascii_hexdigit)
    {
        value.to_owned()
    } else {
        "#6F96F4".into()
    }
}

fn bounded(value: String, max: usize) -> String {
    value.trim().chars().take(max).collect::<String>()
}

fn unique_name(base: &str, names: &mut HashSet<String>) -> String {
    let base = if base.trim().is_empty() {
        "旧テンプレート"
    } else {
        base.trim()
    };
    if names.insert(base.to_owned()) {
        return base.to_owned();
    }
    for suffix in 2..=10_000 {
        let suffix = format!(" ({suffix})");
        let keep = 100_usize.saturating_sub(suffix.chars().count());
        let candidate = format!("{}{}", base.chars().take(keep).collect::<String>(), suffix);
        if names.insert(candidate.clone()) {
            return candidate;
        }
    }
    format!("旧テンプレート {}", Uuid::new_v4())
}

fn validate_source(path: &Path) -> AppResult<()> {
    let metadata = std::fs::metadata(path).map_err(|error| AppError::Validation {
        message: "旧schedule.dbを読み取れません。".into(),
        recovery: format!("ファイルを選び直してください（{error}）。"),
    })?;
    if !metadata.is_file() || metadata.len() == 0 || metadata.len() > MAX_LEGACY_BYTES {
        return Err(AppError::Validation {
            message: "旧schedule.dbのサイズが安全な範囲外です。".into(),
            recovery: "256MB以下のSQLiteファイルを選んでください。".into(),
        });
    }
    Ok(())
}

fn fingerprint(path: &Path) -> AppResult<String> {
    let bytes = std::fs::read(path).map_err(|error| AppError::Validation {
        message: "旧schedule.dbを読み取れません。".into(),
        recovery: format!("元ファイルの権限を確認してください（{error}）。"),
    })?;
    Ok(format!("{:x}", Sha256::digest(bytes)))
}

fn current_timezone() -> String {
    iana_time_zone::get_timezone()
        .ok()
        .filter(|value| value.parse::<chrono_tz::Tz>().is_ok())
        .unwrap_or_else(|| "UTC".into())
}

fn constant_time_equal(left: &[u8], right: &[u8]) -> bool {
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
    use sqlx::sqlite::{SqliteConnectOptions, SqlitePoolOptions};
    use tempfile::tempdir;

    use super::*;

    #[tokio::test]
    async fn preview_is_read_only_and_commit_is_atomic_with_last_profile() {
        let directory = tempdir().unwrap();
        let source = directory.path().join("schedule.db");
        let source_pool = SqlitePoolOptions::new()
            .max_connections(1)
            .connect_with(
                SqliteConnectOptions::new()
                    .filename(&source)
                    .create_if_missing(true),
            )
            .await
            .unwrap();
        sqlx::query("CREATE TABLE profiles(id INTEGER PRIMARY KEY, name TEXT, color TEXT)")
            .execute(&source_pool)
            .await
            .unwrap();
        sqlx::query("CREATE TABLE schedules(id INTEGER PRIMARY KEY, profile_id INTEGER, title TEXT, start_time TEXT, end_time TEXT)")
            .execute(&source_pool)
            .await
            .unwrap();
        sqlx::query("CREATE TABLE instant_schedules(id INTEGER PRIMARY KEY, title TEXT, start_time TEXT, duration_minutes INTEGER)")
            .execute(&source_pool)
            .await
            .unwrap();
        sqlx::query("CREATE TABLE free_alarms(id INTEGER PRIMARY KEY, label TEXT, time TEXT, enabled INTEGER)")
            .execute(&source_pool)
            .await
            .unwrap();
        sqlx::query("CREATE TABLE settings(key TEXT PRIMARY KEY, value TEXT)")
            .execute(&source_pool)
            .await
            .unwrap();
        sqlx::query("INSERT INTO profiles VALUES (7, '平日', '#123456')")
            .execute(&source_pool)
            .await
            .unwrap();
        sqlx::query("INSERT INTO schedules VALUES (1, 7, '開始', '09:00', '10:00')")
            .execute(&source_pool)
            .await
            .unwrap();
        sqlx::query("INSERT INTO schedules VALUES (2, 999, '孤児', '11:00', '12:00')")
            .execute(&source_pool)
            .await
            .unwrap();
        sqlx::query("INSERT INTO instant_schedules VALUES (1, '休憩', '12:00', 30)")
            .execute(&source_pool)
            .await
            .unwrap();
        sqlx::query("INSERT INTO free_alarms VALUES (1, '確認', '18:30', 1)")
            .execute(&source_pool)
            .await
            .unwrap();
        sqlx::query("INSERT INTO settings VALUES ('last_profile', '7')")
            .execute(&source_pool)
            .await
            .unwrap();
        source_pool.close().await;
        let before = fingerprint(&source).unwrap();

        let preview = Database::preview_legacy_import(&source).await.unwrap();
        assert_eq!(preview.template_count, 1);
        assert_eq!(preview.template_block_count, 1);
        assert_eq!(preview.orphan_count, 1);
        assert_eq!(before, fingerprint(&source).unwrap());

        let target = Database::open_memory().await.unwrap();
        let result = target
            .import_legacy(&source, &preview.fingerprint)
            .await
            .unwrap();
        assert_eq!(result.imported_template_count, 1);
        assert_eq!(result.imported_quick_block_count, 1);
        assert_eq!(result.imported_alarm_count, 1);
        assert_eq!(
            target.settings().await.unwrap().last_template_id,
            Some(result.selected_template_id)
        );
        assert_eq!(before, fingerprint(&source).unwrap());
    }

    #[tokio::test]
    async fn changed_source_is_rejected_without_target_mutation() {
        let directory = tempdir().unwrap();
        let source = directory.path().join("schedule.db");
        let source_pool = SqlitePoolOptions::new()
            .max_connections(1)
            .connect_with(
                SqliteConnectOptions::new()
                    .filename(&source)
                    .create_if_missing(true),
            )
            .await
            .unwrap();
        sqlx::query("CREATE TABLE profiles(id INTEGER PRIMARY KEY, name TEXT)")
            .execute(&source_pool)
            .await
            .unwrap();
        sqlx::query("INSERT INTO profiles VALUES (1, '初期')")
            .execute(&source_pool)
            .await
            .unwrap();
        source_pool.close().await;
        let preview = Database::preview_legacy_import(&source).await.unwrap();
        let source_pool = SqlitePoolOptions::new()
            .max_connections(1)
            .connect_with(SqliteConnectOptions::new().filename(&source))
            .await
            .unwrap();
        sqlx::query("INSERT INTO profiles VALUES (2, '変更')")
            .execute(&source_pool)
            .await
            .unwrap();
        source_pool.close().await;

        let target = Database::open_memory().await.unwrap();
        assert!(
            target
                .import_legacy(&source, &preview.fingerprint)
                .await
                .is_err()
        );
        let count: i64 = sqlx::query_scalar("SELECT COUNT(*) FROM templates WHERE is_builtin = 0")
            .fetch_one(&target.pool)
            .await
            .unwrap();
        assert_eq!(count, 0);
    }
}
