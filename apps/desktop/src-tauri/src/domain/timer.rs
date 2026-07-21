use serde::{Deserialize, Serialize};
use uuid::Uuid;

use super::{AppError, AppResult};

pub const MAX_TIMER_SECONDS: u64 = 7 * 24 * 60 * 60;

#[derive(Debug, Clone, PartialEq, Eq, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct TimerDraft {
    pub label: String,
    pub duration_seconds: u64,
}

impl TimerDraft {
    pub fn normalized(mut self) -> AppResult<Self> {
        self.label = self.label.trim().to_string();
        if self.label.chars().count() > 100 {
            return Err(AppError::Validation {
                message: "タイマーのラベルは100文字以内で入力してください。".into(),
                recovery:
                    "ラベルを短くして再試行してください。時間と実行状態は変更されていません。"
                        .into(),
            });
        }
        if !(1..=MAX_TIMER_SECONDS).contains(&self.duration_seconds) {
            return Err(AppError::Validation {
                message: "タイマーは1秒以上7日以内で設定してください。".into(),
                recovery: "時・分・秒を確認してください。既存のタイマーは変更されていません。"
                    .into(),
            });
        }
        Ok(self)
    }
}

#[derive(Debug, Clone, Copy, PartialEq, Eq, Serialize)]
#[serde(rename_all = "snake_case")]
pub enum TimerStatus {
    Idle,
    Running,
    Paused,
    Completed,
}

impl TimerStatus {
    pub const fn as_str(self) -> &'static str {
        match self {
            Self::Idle => "idle",
            Self::Running => "running",
            Self::Paused => "paused",
            Self::Completed => "completed",
        }
    }
}

impl TryFrom<&str> for TimerStatus {
    type Error = AppError;

    fn try_from(value: &str) -> AppResult<Self> {
        match value {
            "idle" => Ok(Self::Idle),
            "running" => Ok(Self::Running),
            "paused" => Ok(Self::Paused),
            "completed" => Ok(Self::Completed),
            _ => Err(AppError::database("timer-status", value)),
        }
    }
}

#[derive(Debug, Clone, Copy, PartialEq, Eq, Deserialize)]
#[serde(rename_all = "snake_case")]
pub enum TimerCommand {
    Start,
    Pause,
    Resume,
    Reset,
}

impl TimerCommand {
    pub const fn as_str(self) -> &'static str {
        match self {
            Self::Start => "start",
            Self::Pause => "pause",
            Self::Resume => "resume",
            Self::Reset => "reset",
        }
    }
}

#[derive(Debug, Clone, PartialEq, Eq, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct TimerState {
    pub id: Uuid,
    pub label: String,
    pub duration_seconds: u64,
    pub status: TimerStatus,
    pub elapsed_seconds: u64,
    pub remaining_seconds: u64,
    pub version: u64,
}

#[derive(Debug, Clone, PartialEq, Eq, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct TimerSetItem {
    pub label: String,
    pub duration_seconds: u64,
    pub sort_order: i32,
}

#[derive(Debug, Clone, PartialEq, Eq, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct TimerSet {
    pub id: Uuid,
    pub name: String,
    pub version: u64,
    pub items: Vec<TimerSetItem>,
}

pub fn normalize_timer_set_name(name: String) -> AppResult<String> {
    let normalized = name.trim().to_string();
    if normalized.is_empty() || normalized.chars().count() > 100 {
        return Err(AppError::Validation {
            message: "構成セット名は1文字以上100文字以内で入力してください。".into(),
            recovery: "名前を確認してください。現在のタイマーは変更されていません。".into(),
        });
    }
    Ok(normalized)
}

pub fn validate_timer_transition(current: TimerStatus, command: TimerCommand) -> AppResult<()> {
    let valid = matches!(
        (current, command),
        (
            TimerStatus::Idle | TimerStatus::Completed,
            TimerCommand::Start
        ) | (TimerStatus::Running, TimerCommand::Pause)
            | (TimerStatus::Paused, TimerCommand::Resume)
            | (_, TimerCommand::Reset)
    );
    if valid {
        Ok(())
    } else {
        Err(AppError::Conflict {
            message: "タイマーの状態が変更されました。".into(),
            recovery: "最新の状態を確認して、表示されている操作を選び直してください。".into(),
        })
    }
}

#[derive(Debug, Clone, Copy, PartialEq, Eq, Serialize)]
#[serde(rename_all = "snake_case")]
pub enum StopwatchStatus {
    Idle,
    Running,
    Paused,
}

impl StopwatchStatus {
    pub const fn as_str(self) -> &'static str {
        match self {
            Self::Idle => "idle",
            Self::Running => "running",
            Self::Paused => "paused",
        }
    }
}

impl TryFrom<&str> for StopwatchStatus {
    type Error = AppError;

    fn try_from(value: &str) -> AppResult<Self> {
        match value {
            "idle" => Ok(Self::Idle),
            "running" => Ok(Self::Running),
            "paused" => Ok(Self::Paused),
            _ => Err(AppError::database("stopwatch-status", value)),
        }
    }
}

#[derive(Debug, Clone, Copy, PartialEq, Eq, Deserialize)]
#[serde(rename_all = "snake_case")]
pub enum StopwatchCommand {
    Start,
    Pause,
    Resume,
    Reset,
}

#[derive(Debug, Clone, PartialEq, Eq, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct StopwatchState {
    pub status: StopwatchStatus,
    pub elapsed_seconds: u64,
    pub version: u64,
}

pub fn validate_stopwatch_transition(
    current: StopwatchStatus,
    command: StopwatchCommand,
) -> AppResult<()> {
    let valid = matches!(
        (current, command),
        (StopwatchStatus::Idle, StopwatchCommand::Start)
            | (StopwatchStatus::Running, StopwatchCommand::Pause)
            | (StopwatchStatus::Paused, StopwatchCommand::Resume)
            | (_, StopwatchCommand::Reset)
    );
    if valid {
        Ok(())
    } else {
        Err(AppError::Conflict {
            message: "ストップウォッチの状態が変更されました。".into(),
            recovery: "最新の状態を確認して、表示されている操作を選び直してください。".into(),
        })
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn timer_validation_and_transition_table_are_bounded() {
        assert!(
            TimerDraft {
                label: "  お茶  ".into(),
                duration_seconds: 60,
            }
            .normalized()
            .is_ok()
        );
        assert!(
            TimerDraft {
                label: String::new(),
                duration_seconds: 0,
            }
            .normalized()
            .is_err()
        );
        assert!(validate_timer_transition(TimerStatus::Idle, TimerCommand::Start).is_ok());
        assert!(validate_timer_transition(TimerStatus::Running, TimerCommand::Start).is_err());
        assert!(validate_timer_transition(TimerStatus::Paused, TimerCommand::Resume).is_ok());
    }

    #[test]
    fn stopwatch_blocks_double_start_and_invalid_resume() {
        assert!(
            validate_stopwatch_transition(StopwatchStatus::Idle, StopwatchCommand::Start).is_ok()
        );
        assert!(
            validate_stopwatch_transition(StopwatchStatus::Running, StopwatchCommand::Start)
                .is_err()
        );
        assert!(
            validate_stopwatch_transition(StopwatchStatus::Paused, StopwatchCommand::Resume)
                .is_ok()
        );
    }
}
