use serde::Serialize;
use thiserror::Error;

pub type AppResult<T> = Result<T, AppError>;

#[derive(Debug, Error)]
pub enum AppError {
    #[error("{message}")]
    Validation { message: String, recovery: String },
    #[error("{message}")]
    Conflict { message: String, recovery: String },
    #[error("{message}")]
    NotFound { message: String, recovery: String },
    #[error("{message}")]
    Database {
        message: String,
        diagnostic_id: String,
    },
    #[error("{message}")]
    Unavailable {
        message: String,
        recovery: String,
        retryable: bool,
    },
}

#[derive(Debug, Clone, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct UserSafeError {
    pub code: &'static str,
    pub message: String,
    pub recovery: String,
    pub retryable: bool,
    pub diagnostic_id: Option<String>,
}

impl From<AppError> for UserSafeError {
    fn from(error: AppError) -> Self {
        match error {
            AppError::Validation { message, recovery } => Self {
                code: "validation",
                message,
                recovery,
                retryable: false,
                diagnostic_id: None,
            },
            AppError::Conflict { message, recovery } => Self {
                code: "version_conflict",
                message,
                recovery,
                retryable: false,
                diagnostic_id: None,
            },
            AppError::NotFound { message, recovery } => Self {
                code: "not_found",
                message,
                recovery,
                retryable: false,
                diagnostic_id: None,
            },
            AppError::Database {
                message,
                diagnostic_id,
            } => Self {
                code: "database",
                message,
                recovery:
                    "入力は保持されています。再試行し、続く場合は診断画面を確認してください。"
                        .into(),
                retryable: true,
                diagnostic_id: Some(diagnostic_id),
            },
            AppError::Unavailable {
                message,
                recovery,
                retryable,
            } => Self {
                code: "unavailable",
                message,
                recovery,
                retryable,
                diagnostic_id: None,
            },
        }
    }
}

impl AppError {
    pub fn database(context: &'static str, _source: impl std::fmt::Display) -> Self {
        // SQL text, paths, and row values are deliberately excluded from both logs and the UI.
        Self::Database {
            message: "ローカルデータを処理できませんでした。".into(),
            diagnostic_id: format!("db-{context}"),
        }
    }
}
