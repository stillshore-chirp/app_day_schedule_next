use chrono::{DateTime, NaiveDate, Utc};
use chrono_tz::Tz;
use serde::{Deserialize, Serialize};
use uuid::Uuid;

use super::{AppError, AppResult};

#[derive(Debug, Clone, Copy, PartialEq, Eq, Serialize, Deserialize)]
#[serde(rename_all = "snake_case")]
pub enum ScheduleStatus {
    NotStarted,
    Scheduled,
    InProgress,
    Completed,
    Cancelled,
}

impl ScheduleStatus {
    pub fn as_str(self) -> &'static str {
        match self {
            Self::NotStarted => "not_started",
            Self::Scheduled => "scheduled",
            Self::InProgress => "in_progress",
            Self::Completed => "completed",
            Self::Cancelled => "cancelled",
        }
    }
}

impl TryFrom<&str> for ScheduleStatus {
    type Error = AppError;

    fn try_from(value: &str) -> AppResult<Self> {
        match value {
            "not_started" => Ok(Self::NotStarted),
            "scheduled" => Ok(Self::Scheduled),
            "in_progress" => Ok(Self::InProgress),
            "completed" => Ok(Self::Completed),
            "cancelled" => Ok(Self::Cancelled),
            _ => Err(AppError::database("schedule-status", value)),
        }
    }
}

#[derive(Debug, Clone, Copy, PartialEq, Eq, Serialize, Deserialize)]
#[serde(rename_all = "snake_case")]
pub enum SyncStatus {
    LocalOnly,
    Pending,
    Syncing,
    Synced,
    Offline,
    RetryScheduled,
    Conflict,
    AuthRequired,
    ReadOnly,
}

#[derive(Debug, Clone, Copy, PartialEq, Eq, Serialize, Deserialize)]
#[serde(rename_all = "snake_case")]
pub enum Priority {
    Low,
    Normal,
    High,
    Urgent,
}

#[derive(Debug, Clone, Copy, Default, PartialEq, Eq, Serialize, Deserialize)]
#[serde(rename_all = "snake_case")]
pub enum RecurrenceEditScope {
    This,
    Following,
    #[default]
    Series,
}

impl Priority {
    pub fn as_str(self) -> &'static str {
        match self {
            Self::Low => "low",
            Self::Normal => "normal",
            Self::High => "high",
            Self::Urgent => "urgent",
        }
    }
}

impl TryFrom<&str> for Priority {
    type Error = AppError;

    fn try_from(value: &str) -> AppResult<Self> {
        match value {
            "low" => Ok(Self::Low),
            "normal" => Ok(Self::Normal),
            "high" => Ok(Self::High),
            "urgent" => Ok(Self::Urgent),
            _ => Err(AppError::database("priority", value)),
        }
    }
}

impl SyncStatus {
    pub fn as_str(self) -> &'static str {
        match self {
            Self::LocalOnly => "local_only",
            Self::Pending => "pending",
            Self::Syncing => "syncing",
            Self::Synced => "synced",
            Self::Offline => "offline",
            Self::RetryScheduled => "retry_scheduled",
            Self::Conflict => "conflict",
            Self::AuthRequired => "auth_required",
            Self::ReadOnly => "read_only",
        }
    }
}

impl TryFrom<&str> for SyncStatus {
    type Error = AppError;

    fn try_from(value: &str) -> AppResult<Self> {
        match value {
            "local_only" => Ok(Self::LocalOnly),
            "pending" => Ok(Self::Pending),
            "syncing" => Ok(Self::Syncing),
            "synced" => Ok(Self::Synced),
            "offline" => Ok(Self::Offline),
            "retry_scheduled" => Ok(Self::RetryScheduled),
            "conflict" => Ok(Self::Conflict),
            "auth_required" => Ok(Self::AuthRequired),
            "read_only" => Ok(Self::ReadOnly),
            _ => Err(AppError::database("sync-status", value)),
        }
    }
}

#[derive(Debug, Clone, PartialEq, Eq, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct ScheduleDraft {
    pub title: String,
    pub description: String,
    pub location: String,
    pub start_utc: DateTime<Utc>,
    pub end_utc: DateTime<Utc>,
    pub timezone_id: String,
    pub all_day: bool,
    #[serde(default)]
    pub all_day_start_date: Option<NaiveDate>,
    #[serde(default)]
    pub all_day_end_date_exclusive: Option<NaiveDate>,
    pub status: ScheduleStatus,
    pub project: String,
    pub category: String,
    pub tags: Vec<String>,
    pub color: String,
    pub priority: Priority,
    pub recurrence_rule: Option<String>,
    #[serde(default)]
    pub recurrence_exdates: Vec<DateTime<Utc>>,
    #[serde(default)]
    pub start_notification_minutes: Option<u16>,
    #[serde(default)]
    pub end_notification_minutes: Option<u16>,
}

impl ScheduleDraft {
    pub fn validate(&mut self) -> AppResult<()> {
        self.title = self.title.trim().to_owned();
        if self.title.is_empty() || self.title.chars().count() > 200 {
            return Err(AppError::Validation {
                message: "タイトルは1〜200文字で入力してください。".into(),
                recovery: "タイトルを確認してから、もう一度保存してください。".into(),
            });
        }
        if self.description.chars().count() > 10_000
            || self.location.chars().count() > 500
            || self.project.chars().count() > 100
            || self.category.chars().count() > 100
        {
            return Err(AppError::Validation {
                message: "入力できる文字数を超えています。".into(),
                recovery: "長い説明、場所、分類名を短くしてから保存してください。".into(),
            });
        }
        if self.start_utc >= self.end_utc {
            return Err(AppError::Validation {
                message: "終了時刻は開始時刻より後にしてください。".into(),
                recovery: "開始と終了を確認してください。日をまたぐ予定も終了を翌日にできます。"
                    .into(),
            });
        }
        if self.timezone_id.parse::<Tz>().is_err() {
            return Err(AppError::Validation {
                message: "有効なIANAタイムゾーンを指定してください。".into(),
                recovery: "例: Asia/Tokyo の形式で選び直してください。".into(),
            });
        }
        if self.all_day {
            match (self.all_day_start_date, self.all_day_end_date_exclusive) {
                (Some(start), Some(end)) if start < end => {}
                _ => {
                    return Err(AppError::Validation {
                        message: "終日予定には開始日と排他的終了日が必要です。".into(),
                        recovery: "終了日を開始日より後の日付にしてください。".into(),
                    });
                }
            }
        } else {
            self.all_day_start_date = None;
            self.all_day_end_date_exclusive = None;
        }
        if self.tags.len() > 20 || self.tags.iter().any(|tag| tag.chars().count() > 50) {
            return Err(AppError::Validation {
                message: "タグは20件まで、1件50文字以内です。".into(),
                recovery: "タグを整理してから保存してください。".into(),
            });
        }
        self.tags.sort();
        self.tags.dedup();
        if !is_hex_color(&self.color) {
            return Err(AppError::Validation {
                message: "色の形式が正しくありません。".into(),
                recovery: "#6F96F4 のような6桁の色を選んでください。".into(),
            });
        }
        if let Some(rule) = &mut self.recurrence_rule {
            *rule = rule.trim().to_ascii_uppercase();
            super::validate_recurrence_rule(rule)?;
        }
        if self.recurrence_exdates.len() > 10_000 {
            return Err(AppError::Validation {
                message: "繰り返し予定の例外が多すぎます。".into(),
                recovery: "系列を分割してから保存してください。".into(),
            });
        }
        self.recurrence_exdates.sort();
        self.recurrence_exdates.dedup();
        if self
            .start_notification_minutes
            .is_some_and(|value| value > 10_080)
            || self
                .end_notification_minutes
                .is_some_and(|value| value > 10_080)
        {
            return Err(AppError::Validation {
                message: "通知は予定時刻の7日前までに設定できます。".into(),
                recovery: "通知を「なし」または10080分以内へ変更してください。".into(),
            });
        }
        Ok(())
    }
}

fn is_hex_color(value: &str) -> bool {
    value.len() == 7
        && value.starts_with('#')
        && value.as_bytes()[1..].iter().all(u8::is_ascii_hexdigit)
}

#[derive(Debug, Clone, PartialEq, Eq, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct ScheduleClassificationPatch {
    pub project: Option<String>,
    pub category: Option<String>,
    pub tags: Option<Vec<String>>,
    pub color: Option<String>,
    pub priority: Option<Priority>,
}

impl ScheduleClassificationPatch {
    pub fn is_empty(&self) -> bool {
        self.project.is_none()
            && self.category.is_none()
            && self.tags.is_none()
            && self.color.is_none()
            && self.priority.is_none()
    }

    pub fn apply_to(&self, draft: &mut ScheduleDraft) {
        if let Some(project) = &self.project {
            draft.project = project.trim().to_owned();
        }
        if let Some(category) = &self.category {
            draft.category = category.trim().to_owned();
        }
        if let Some(tags) = &self.tags {
            draft.tags = tags
                .iter()
                .map(|tag| tag.trim().to_owned())
                .filter(|tag| !tag.is_empty())
                .collect();
        }
        if let Some(color) = &self.color {
            draft.color = color.clone();
        }
        if let Some(priority) = self.priority {
            draft.priority = priority;
        }
    }
}

#[derive(Debug, Clone, PartialEq, Eq, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct Schedule {
    pub id: Uuid,
    #[serde(flatten)]
    pub draft: ScheduleDraft,
    pub sync_status: SyncStatus,
    pub version: u64,
    pub deleted_at: Option<DateTime<Utc>>,
}

#[derive(Debug, Clone, PartialEq, Eq)]
pub struct ScheduleQuery {
    pub start_utc: DateTime<Utc>,
    pub end_utc: DateTime<Utc>,
    pub search: Option<String>,
    pub include_deleted: bool,
    pub limit: u32,
    pub offset: u32,
    pub status: Option<ScheduleStatus>,
    pub project: Option<String>,
    pub category: Option<String>,
    pub tag: Option<String>,
    pub priority: Option<Priority>,
    pub sync_status: Option<SyncStatus>,
    pub sync_target: Option<String>,
    pub completion: String,
    pub sort_by: String,
    pub sort_descending: bool,
}

impl ScheduleQuery {
    pub fn validate(&mut self) -> AppResult<()> {
        if self.start_utc >= self.end_utc {
            return Err(AppError::Validation {
                message: "表示範囲が正しくありません。".into(),
                recovery: "開始日と終了日を選び直してください。".into(),
            });
        }
        self.limit = self.limit.clamp(1, 500);
        if let Some(search) = &mut self.search {
            *search = search.trim().chars().take(200).collect();
            if search.is_empty() {
                self.search = None;
            }
        }
        for filter in [
            &mut self.project,
            &mut self.category,
            &mut self.tag,
            &mut self.sync_target,
        ] {
            if let Some(value) = filter {
                *value = value.trim().chars().take(100).collect();
                if value.is_empty() {
                    *filter = None;
                }
            }
        }
        if !matches!(self.completion.as_str(), "all" | "open" | "completed") {
            self.completion = "all".into();
        }
        if !matches!(
            self.sort_by.as_str(),
            "start" | "end" | "updated" | "priority" | "title"
        ) {
            self.sort_by = "start".into();
        }
        Ok(())
    }
}

#[derive(Debug, Clone, PartialEq, Eq, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct Settings {
    pub theme: Theme,
    pub locale: Locale,
    pub snap_minutes: u8,
    pub close_behavior: CloseBehavior,
    pub notification_grace_minutes: u8,
    pub notification_max_replay: u8,
    pub focus_work_minutes: u16,
    pub focus_break_minutes: u16,
    #[serde(default = "default_true")]
    pub schedule_notifications_enabled: bool,
    #[serde(default = "default_true")]
    pub os_notifications_enabled: bool,
    #[serde(default)]
    pub sound_notifications_enabled: bool,
    #[serde(default = "default_long_break_minutes")]
    pub focus_long_break_minutes: u16,
    #[serde(default = "default_long_break_every")]
    pub focus_long_break_every: u8,
    #[serde(default)]
    pub focus_auto_start: bool,
    #[serde(default = "default_true")]
    pub focus_notifications_enabled: bool,
    #[serde(default)]
    pub last_template_id: Option<Uuid>,
}

#[derive(Debug, Clone, Copy, PartialEq, Eq, Serialize, Deserialize)]
#[serde(rename_all = "snake_case")]
pub enum Theme {
    System,
    Light,
    Dark,
}

#[derive(Debug, Clone, Copy, PartialEq, Eq, Serialize, Deserialize)]
#[serde(rename_all = "snake_case")]
pub enum Locale {
    Ja,
    En,
}

#[derive(Debug, Clone, Copy, PartialEq, Eq, Serialize, Deserialize)]
#[serde(rename_all = "snake_case")]
pub enum CloseBehavior {
    Tray,
    Quit,
}

impl Settings {
    pub fn validate(&self) -> AppResult<()> {
        if !matches!(self.snap_minutes, 1 | 5 | 10 | 15 | 30)
            || self.notification_grace_minutes > 120
            || self.notification_max_replay > 20
            || !(1..=180).contains(&self.focus_work_minutes)
            || !(1..=180).contains(&self.focus_break_minutes)
            || !(1..=180).contains(&self.focus_long_break_minutes)
            || !(1..=12).contains(&self.focus_long_break_every)
        {
            return Err(AppError::Validation {
                message: "設定値が許可された範囲外です。".into(),
                recovery: "各入力欄に表示された範囲へ戻して保存してください。".into(),
            });
        }
        Ok(())
    }
}

impl Default for Settings {
    fn default() -> Self {
        Self {
            theme: Theme::System,
            locale: Locale::Ja,
            snap_minutes: 5,
            close_behavior: CloseBehavior::Tray,
            notification_grace_minutes: 10,
            notification_max_replay: 3,
            focus_work_minutes: 25,
            focus_break_minutes: 5,
            schedule_notifications_enabled: true,
            os_notifications_enabled: true,
            sound_notifications_enabled: false,
            focus_long_break_minutes: 15,
            focus_long_break_every: 4,
            focus_auto_start: false,
            focus_notifications_enabled: true,
            last_template_id: None,
        }
    }
}

const fn default_true() -> bool {
    true
}

const fn default_long_break_minutes() -> u16 {
    15
}

const fn default_long_break_every() -> u8 {
    4
}

#[cfg(test)]
mod tests {
    use chrono::TimeZone;

    use super::*;

    fn draft() -> ScheduleDraft {
        ScheduleDraft {
            title: " 深い作業 ".into(),
            description: String::new(),
            location: String::new(),
            start_utc: Utc.with_ymd_and_hms(2026, 3, 29, 0, 0, 0).unwrap(),
            end_utc: Utc.with_ymd_and_hms(2026, 3, 29, 1, 0, 0).unwrap(),
            timezone_id: "Europe/Berlin".into(),
            all_day: false,
            all_day_start_date: None,
            all_day_end_date_exclusive: None,
            status: ScheduleStatus::Scheduled,
            project: String::new(),
            category: String::new(),
            tags: vec!["重要".into(), "重要".into()],
            color: "#6F96F4".into(),
            priority: Priority::Normal,
            recurrence_rule: None,
            recurrence_exdates: Vec::new(),
            start_notification_minutes: None,
            end_notification_minutes: None,
        }
    }

    #[test]
    fn validates_instant_interval_and_preserves_iana_timezone() {
        let mut value = draft();
        value.validate().unwrap();
        assert_eq!(value.title, "深い作業");
        assert_eq!(value.tags, vec!["重要"]);
        assert_eq!(value.timezone_id, "Europe/Berlin");
    }

    #[test]
    fn rejects_reversed_interval() {
        let mut value = draft();
        value.end_utc = value.start_utc;
        assert!(matches!(value.validate(), Err(AppError::Validation { .. })));
    }

    #[test]
    fn rejects_non_iana_timezone() {
        let mut value = draft();
        value.timezone_id = "JST".into();
        assert!(value.validate().is_err());
    }

    #[test]
    fn all_day_requires_an_exclusive_local_date_range() {
        let mut value = draft();
        value.all_day = true;
        assert!(value.validate().is_err());

        value.all_day_start_date = Some(chrono::NaiveDate::from_ymd_opt(2026, 3, 29).unwrap());
        value.all_day_end_date_exclusive =
            Some(chrono::NaiveDate::from_ymd_opt(2026, 3, 30).unwrap());
        assert!(value.validate().is_ok());
    }
}
