use std::{fs, path::Path};

use chrono::{DateTime, Utc};
use serde::Serialize;
use sqlx::Row;
use uuid::Uuid;

use crate::domain::{AppError, AppResult};

use super::{Database, DiagnosticsSnapshot};

#[derive(Debug, Clone, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct DiagnosticEvent {
    pub level: String,
    pub category: String,
    pub event: String,
    pub diagnostic_id: Option<String>,
    pub created_at: DateTime<Utc>,
}

#[derive(Debug, Clone, Serialize)]
#[serde(rename_all = "camelCase")]
struct DiagnosticBundle {
    format_version: u32,
    created_at: DateTime<Utc>,
    app_version: String,
    operating_system: String,
    architecture: String,
    webview: String,
    database: DiagnosticsSnapshot,
    events: Vec<DiagnosticEvent>,
    redaction: &'static str,
}

#[derive(Debug, Clone, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct DiagnosticsExportResult {
    pub file_name: String,
    pub bytes_written: u64,
    pub event_count: u64,
}

impl Database {
    pub async fn record_diagnostic_event(
        &self,
        level: &'static str,
        category: &'static str,
        event: &'static str,
        diagnostic_id: Option<&str>,
    ) -> AppResult<()> {
        sqlx::query(
            "INSERT INTO diagnostic_events(id, level, category, event, diagnostic_id, created_at_utc) VALUES (?, ?, ?, ?, ?, ?)",
        )
        .bind(Uuid::new_v4().to_string())
        .bind(level)
        .bind(category)
        .bind(event)
        .bind(diagnostic_id)
        .bind(Utc::now().to_rfc3339())
        .execute(&self.pool)
        .await
        .map_err(|error| AppError::database("diagnostic-event-write", error))?;
        sqlx::query(
            "DELETE FROM diagnostic_events WHERE id NOT IN (SELECT id FROM diagnostic_events ORDER BY created_at_utc DESC, id DESC LIMIT 5000)",
        )
        .execute(&self.pool)
        .await
        .map_err(|error| AppError::database("diagnostic-event-prune", error))?;
        Ok(())
    }

    pub async fn export_diagnostics(
        &self,
        target: &Path,
        webview: &str,
        app_version: &str,
    ) -> AppResult<DiagnosticsExportResult> {
        if webview.chars().count() > 500 {
            return Err(AppError::Validation {
                message: "WebView情報が長すぎます。".into(),
                recovery: "アプリを再起動してから再試行してください。".into(),
            });
        }
        let rows = sqlx::query(
            "SELECT level, category, event, diagnostic_id, created_at_utc FROM diagnostic_events ORDER BY created_at_utc DESC, id DESC LIMIT 500",
        )
        .fetch_all(&self.pool)
        .await
        .map_err(|error| AppError::database("diagnostic-event-read", error))?;
        let events = rows
            .iter()
            .map(|row| {
                Ok(DiagnosticEvent {
                    level: row.get("level"),
                    category: row.get("category"),
                    event: row.get("event"),
                    diagnostic_id: row.get("diagnostic_id"),
                    created_at: DateTime::parse_from_rfc3339(row.get::<&str, _>("created_at_utc"))
                        .map(|value| value.with_timezone(&Utc))
                        .map_err(|error| AppError::database("diagnostic-event-time", error))?,
                })
            })
            .collect::<AppResult<Vec<_>>>()?;
        let snapshot = self.diagnostics(app_version).await?;
        let bundle = DiagnosticBundle {
            format_version: 1,
            created_at: Utc::now(),
            app_version: app_version.into(),
            operating_system: std::env::consts::OS.into(),
            architecture: std::env::consts::ARCH.into(),
            webview: sanitize_runtime_info(webview),
            database: snapshot,
            events,
            redaction: "予定本文、Ticket本文、説明、場所、メール、calendar/event/task/list ID、token、絶対パスは収集しません。",
        };
        let bytes = serde_json::to_vec_pretty(&bundle)
            .map_err(|error| AppError::database("diagnostic-export-encode", error))?;
        let temporary = target.with_extension("json.part");
        fs::write(&temporary, &bytes)
            .and_then(|()| fs::rename(&temporary, target))
            .map_err(|error| AppError::database("diagnostic-export-write", error))?;
        Ok(DiagnosticsExportResult {
            file_name: target
                .file_name()
                .and_then(|value| value.to_str())
                .unwrap_or("day-schedule-next-diagnostics.json")
                .to_owned(),
            bytes_written: bytes.len() as u64,
            event_count: bundle.events.len() as u64,
        })
    }
}

fn sanitize_runtime_info(value: &str) -> String {
    value
        .chars()
        .filter(|character| !character.is_control())
        .take(500)
        .collect()
}

#[cfg(test)]
mod tests {
    use tempfile::tempdir;

    use super::*;

    #[tokio::test]
    async fn diagnostic_export_contains_only_structured_redacted_events() {
        let database = Database::open_memory().await.unwrap();
        let now = Utc::now().to_rfc3339();
        sqlx::query(
            "INSERT INTO google_accounts(id, display_label, scopes_json, status, created_at_utc, updated_at_utc) VALUES ('aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa', 'Private account label', '[]', 'connected', ?, ?)",
        )
        .bind(&now)
        .bind(&now)
        .execute(&database.pool)
        .await
        .unwrap();
        sqlx::query(
            "INSERT INTO google_task_lists(id, google_account_id, remote_list_id, display_name, selected, sync_state, created_at_utc, updated_at_utc) VALUES ('bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb', 'aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa', 'private-remote-list-id', 'Private Task List', 1, 'offline', ?, ?)",
        )
        .bind(&now)
        .bind(&now)
        .execute(&database.pool)
        .await
        .unwrap();
        database
            .record_diagnostic_event("info", "schedule", "created", None)
            .await
            .unwrap();
        let directory = tempdir().unwrap();
        let target = directory.path().join("diagnostics.json");
        let result = database
            .export_diagnostics(&target, "synthetic-webview", "0.1.0")
            .await
            .unwrap();
        assert_eq!(result.event_count, 1);
        let exported = fs::read_to_string(target).unwrap();
        assert!(exported.contains("\"event\": \"created\""));
        assert!(!exported.contains("schedule_items"));
        assert!(!exported.contains("Private account label"));
        assert!(!exported.contains("Private Task List"));
        assert!(!exported.contains("private-remote-list-id"));
        assert!(!exported.contains(directory.path().to_string_lossy().as_ref()));
    }
}
