use chrono::{DateTime, Utc};
use serde::{Deserialize, Serialize};
use uuid::Uuid;

use super::{AppError, AppResult};

#[derive(Debug, Clone, Copy, PartialEq, Eq, Serialize, Deserialize)]
#[serde(rename_all = "snake_case")]
pub enum FocusPhase {
    Idle,
    Working,
    Paused,
    Break,
    WaitingNext,
}

impl FocusPhase {
    pub fn as_str(self) -> &'static str {
        match self {
            Self::Idle => "idle",
            Self::Working => "working",
            Self::Paused => "paused",
            Self::Break => "break",
            Self::WaitingNext => "waiting_next",
        }
    }
}

impl TryFrom<&str> for FocusPhase {
    type Error = AppError;

    fn try_from(value: &str) -> AppResult<Self> {
        match value {
            "idle" => Ok(Self::Idle),
            "working" => Ok(Self::Working),
            "paused" => Ok(Self::Paused),
            "break" => Ok(Self::Break),
            "waiting_next" => Ok(Self::WaitingNext),
            _ => Err(AppError::database("focus-phase", value)),
        }
    }
}

#[derive(Debug, Clone, Copy, PartialEq, Eq, Deserialize)]
#[serde(rename_all = "snake_case")]
pub enum FocusCommand {
    Start,
    Pause,
    Resume,
    Stop,
    Skip,
}

impl FocusCommand {
    pub const fn as_str(self) -> &'static str {
        match self {
            Self::Start => "start",
            Self::Pause => "pause",
            Self::Resume => "resume",
            Self::Stop => "stop",
            Self::Skip => "skip",
        }
    }
}

#[derive(Debug, Clone, PartialEq, Eq, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct FocusState {
    pub phase: FocusPhase,
    pub started_at: Option<DateTime<Utc>>,
    pub ends_at: Option<DateTime<Utc>>,
    pub accumulated_seconds: u64,
    pub cycle: u32,
    pub linked_schedule_id: Option<Uuid>,
}

impl FocusState {
    pub fn idle() -> Self {
        Self {
            phase: FocusPhase::Idle,
            started_at: None,
            ends_at: None,
            accumulated_seconds: 0,
            cycle: 0,
            linked_schedule_id: None,
        }
    }
}

pub fn validate_transition(current: FocusPhase, command: FocusCommand) -> AppResult<()> {
    let valid = matches!(
        (current, command),
        (
            FocusPhase::Idle | FocusPhase::WaitingNext,
            FocusCommand::Start
        ) | (FocusPhase::Working | FocusPhase::Break, FocusCommand::Pause)
            | (FocusPhase::Paused, FocusCommand::Resume)
            | (_, FocusCommand::Stop)
            | (FocusPhase::Working | FocusPhase::Break, FocusCommand::Skip)
    );
    if valid {
        Ok(())
    } else {
        Err(AppError::Conflict {
            message: "現在のFocus状態ではその操作を実行できません。".into(),
            recovery: "表示中の状態を確認し、利用できる操作を選んでください。".into(),
        })
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn transition_table_blocks_double_start_and_invalid_resume() {
        assert!(validate_transition(FocusPhase::Idle, FocusCommand::Start).is_ok());
        assert!(validate_transition(FocusPhase::Working, FocusCommand::Start).is_err());
        assert!(validate_transition(FocusPhase::Paused, FocusCommand::Resume).is_ok());
        assert!(validate_transition(FocusPhase::Idle, FocusCommand::Resume).is_err());
    }
}
