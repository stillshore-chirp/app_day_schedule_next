use chrono::{DateTime, Utc};
use serde::{Deserialize, Serialize};
use uuid::Uuid;

use super::{AppError, AppResult, Schedule};

#[derive(Debug, Clone, Copy, PartialEq, Eq, Serialize, Deserialize)]
#[serde(rename_all = "snake_case")]
pub enum TicketScheduleSource {
    Board,
    TodayDrawer,
    ScheduleEditor,
    Import,
}

impl TicketScheduleSource {
    pub fn as_str(self) -> &'static str {
        match self {
            Self::Board => "board",
            Self::TodayDrawer => "today_drawer",
            Self::ScheduleEditor => "schedule_editor",
            Self::Import => "import",
        }
    }
}

impl TryFrom<&str> for TicketScheduleSource {
    type Error = AppError;

    fn try_from(value: &str) -> AppResult<Self> {
        match value {
            "board" => Ok(Self::Board),
            "today_drawer" => Ok(Self::TodayDrawer),
            "schedule_editor" => Ok(Self::ScheduleEditor),
            "import" => Ok(Self::Import),
            _ => Err(AppError::database("ticket-schedule-source", value)),
        }
    }
}

#[derive(Debug, Clone, PartialEq, Eq, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct TicketScheduleLink {
    pub id: Uuid,
    pub ticket_id: Uuid,
    pub ticket_title: String,
    pub schedule: Schedule,
    pub linked_at: DateTime<Utc>,
    pub unlinked_at: Option<DateTime<Utc>>,
    pub source: TicketScheduleSource,
    pub version: u64,
}

#[derive(Debug, Clone, PartialEq, Eq, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct TicketPlanningSummary {
    pub ticket_id: Uuid,
    pub schedule_count: u64,
    pub future_planned_minutes: u64,
    pub total_planned_minutes: u64,
    pub next_scheduled_at: Option<DateTime<Utc>>,
}

#[derive(Debug, Clone, PartialEq, Eq, Deserialize)]
#[serde(rename_all = "camelCase", deny_unknown_fields)]
pub struct AssignTicketScheduleRequest {
    pub operation_id: Uuid,
    pub ticket_id: Uuid,
    pub expected_ticket_version: u64,
    pub local_start: String,
    pub duration_minutes: u32,
    pub timezone_id: String,
    #[serde(default)]
    pub offset_choice: Option<u8>,
    #[serde(default)]
    pub title_override: Option<String>,
    pub source: TicketScheduleSource,
}

impl AssignTicketScheduleRequest {
    pub fn validate(&mut self) -> AppResult<()> {
        self.local_start = self.local_start.trim().to_owned();
        self.timezone_id = self.timezone_id.trim().to_owned();
        if self.local_start.len() > 32
            || self.timezone_id.is_empty()
            || self.timezone_id.len() > 100
        {
            return Err(validation(
                "予定に入れる日時またはタイムゾーンが正しくありません。",
                "日付、開始時刻、タイムゾーンを確認してください。",
            ));
        }
        if !(1..=1_440).contains(&self.duration_minutes) {
            return Err(validation(
                "所要時間は1〜1,440分で入力してください。",
                "日をまたぐ場合も24時間以内の所要時間を明示してください。",
            ));
        }
        if self.offset_choice.is_some_and(|choice| choice > 1) {
            return Err(validation(
                "重複時刻の選択が正しくありません。",
                "表示された2つの時刻候補から選び直してください。",
            ));
        }
        if let Some(title) = &mut self.title_override {
            *title = title.trim().to_owned();
            if title.is_empty() || title.chars().count() > 200 {
                return Err(validation(
                    "予定タイトルは1〜200文字で入力してください。",
                    "タイトルを短くしてから保存してください。",
                ));
            }
        }
        Ok(())
    }
}

#[derive(Debug, Clone, PartialEq, Eq, Deserialize)]
#[serde(rename_all = "camelCase", deny_unknown_fields)]
pub struct LinkTicketScheduleRequest {
    pub operation_id: Uuid,
    pub ticket_id: Uuid,
    pub expected_ticket_version: u64,
    pub schedule_id: Uuid,
    pub expected_schedule_version: u64,
    pub source: TicketScheduleSource,
    #[serde(default)]
    pub replace_existing: bool,
}

#[derive(Debug, Clone, PartialEq, Eq, Deserialize)]
#[serde(rename_all = "camelCase", deny_unknown_fields)]
pub struct UnlinkTicketScheduleRequest {
    pub operation_id: Uuid,
    pub link_id: Uuid,
    pub expected_link_version: u64,
}

fn validation(message: &str, recovery: &str) -> AppError {
    AppError::Validation {
        message: message.into(),
        recovery: recovery.into(),
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn assignment_requires_explicit_bounded_duration_and_fold() {
        let mut request = AssignTicketScheduleRequest {
            operation_id: Uuid::new_v4(),
            ticket_id: Uuid::new_v4(),
            expected_ticket_version: 0,
            local_start: "2026-08-03T09:00".into(),
            duration_minutes: 1_441,
            timezone_id: "Asia/Tokyo".into(),
            offset_choice: Some(2),
            title_override: None,
            source: TicketScheduleSource::Board,
        };
        assert!(request.validate().is_err());
        request.duration_minutes = 30;
        request.offset_choice = Some(1);
        assert!(request.validate().is_ok());
    }
}
