use chrono::{DateTime, Utc};
use chrono_tz::Tz;
use serde::{Deserialize, Serialize};
use uuid::Uuid;

use super::{AppError, AppResult};

#[derive(Debug, Clone, PartialEq, Eq, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct TemplateBlock {
    pub id: Uuid,
    pub title: String,
    pub start_minute: u16,
    pub duration_minutes: u16,
    pub color: String,
    pub project: String,
    pub category: String,
    pub sort_order: i32,
}

#[derive(Debug, Clone, PartialEq, Eq, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct DayTemplate {
    pub id: Uuid,
    pub name: String,
    pub description: String,
    pub color: String,
    pub weekdays_mask: u8,
    pub is_builtin: bool,
    pub sort_order: i32,
    pub version: u64,
    pub blocks: Vec<TemplateBlock>,
}

#[derive(Debug, Clone, PartialEq, Eq, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct TemplateBlockDraft {
    pub title: String,
    pub start_minute: u16,
    pub duration_minutes: u16,
    pub color: String,
    #[serde(default)]
    pub project: String,
    #[serde(default)]
    pub category: String,
}

#[derive(Debug, Clone, PartialEq, Eq, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct DayTemplateDraft {
    pub name: String,
    #[serde(default)]
    pub description: String,
    pub color: String,
    pub weekdays_mask: u8,
    pub blocks: Vec<TemplateBlockDraft>,
}

impl DayTemplateDraft {
    pub fn validate(&mut self) -> AppResult<()> {
        self.name = self.name.trim().to_owned();
        if self.name.is_empty() || self.name.chars().count() > 100 {
            return Err(validation(
                "テンプレート名は1〜100文字で入力してください。",
                "名前を短くして保存してください。",
            ));
        }
        if self.description.chars().count() > 1_000 || self.weekdays_mask > 127 {
            return Err(validation(
                "テンプレートの説明または曜日設定が正しくありません。",
                "説明を短くし、対象曜日を選び直してください。",
            ));
        }
        if self.blocks.len() > 500 {
            return Err(validation(
                "1つのテンプレートへ登録できるブロックは500件までです。",
                "テンプレートを分けてください。",
            ));
        }
        for block in &mut self.blocks {
            block.title = block.title.trim().to_owned();
            if block.title.is_empty()
                || block.title.chars().count() > 200
                || block.start_minute > 1_439
                || !(1..=1_440).contains(&block.duration_minutes)
                || !is_hex_color(&block.color)
            {
                return Err(validation(
                    "テンプレートブロックの入力が正しくありません。",
                    "タイトル、開始分、所要分、色を確認してください。",
                ));
            }
        }
        if !is_hex_color(&self.color) {
            return Err(validation(
                "テンプレートの色が正しくありません。",
                "6桁の色を選び直してください。",
            ));
        }
        Ok(())
    }
}

#[derive(Debug, Clone, PartialEq, Eq, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct QuickBlockDraft {
    pub title: String,
    pub start_minute: u16,
    pub duration_minutes: u16,
    pub timezone_id: String,
    pub color: String,
    #[serde(default)]
    pub project: String,
    #[serde(default)]
    pub category: String,
    #[serde(default)]
    pub start_notification_minutes: Option<u16>,
    #[serde(default)]
    pub end_notification_minutes: Option<u16>,
    pub is_active: bool,
}

impl QuickBlockDraft {
    pub fn validate(&mut self) -> AppResult<()> {
        self.title = self.title.trim().to_owned();
        if self.title.is_empty()
            || self.title.chars().count() > 200
            || self.start_minute > 1_439
            || !(1..=1_440).contains(&self.duration_minutes)
            || self.timezone_id.parse::<Tz>().is_err()
            || !is_hex_color(&self.color)
            || self
                .start_notification_minutes
                .is_some_and(|value| value > 10_080)
            || self
                .end_notification_minutes
                .is_some_and(|value| value > 10_080)
        {
            return Err(validation(
                "Quick Blockの入力が正しくありません。",
                "タイトル、時刻、所要分、タイムゾーン、色を確認してください。",
            ));
        }
        Ok(())
    }
}

#[derive(Debug, Clone, PartialEq, Eq, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct QuickBlock {
    pub id: Uuid,
    #[serde(flatten)]
    pub draft: QuickBlockDraft,
    pub sort_order: i32,
    pub version: u64,
}

#[derive(Debug, Clone, PartialEq, Eq, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct FreeAlarmDraft {
    pub label: String,
    pub minute_of_day: u16,
    pub timezone_id: String,
    pub weekdays_mask: u8,
    pub enabled: bool,
}

impl FreeAlarmDraft {
    pub fn validate(&mut self) -> AppResult<()> {
        self.label = self.label.trim().to_owned();
        if self.label.is_empty()
            || self.label.chars().count() > 200
            || self.minute_of_day > 1_439
            || self.weekdays_mask > 127
            || self.timezone_id.parse::<Tz>().is_err()
        {
            return Err(validation(
                "アラームの入力が正しくありません。",
                "ラベル、時刻、タイムゾーン、曜日を確認してください。",
            ));
        }
        Ok(())
    }
}

#[derive(Debug, Clone, PartialEq, Eq, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct FreeAlarm {
    pub id: Uuid,
    #[serde(flatten)]
    pub draft: FreeAlarmDraft,
    pub sort_order: i32,
    pub version: u64,
}

#[derive(Debug, Clone, Copy, PartialEq, Eq, Deserialize)]
#[serde(rename_all = "snake_case")]
pub enum TemplateApplyMode {
    Add,
    Replace,
}

#[derive(Debug, Clone, PartialEq, Eq, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct TemplatePreviewItem {
    pub title: String,
    pub start_utc: DateTime<Utc>,
    pub end_utc: DateTime<Utc>,
    pub timezone_id: String,
    pub color: String,
}

#[derive(Debug, Clone, PartialEq, Eq, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct TemplatePreview {
    pub items: Vec<TemplatePreviewItem>,
    pub overlapping_item_count: u64,
    pub local_replace_candidate_count: u64,
    pub external_preserved_count: u64,
    pub sync_target: String,
}

fn validation(message: &str, recovery: &str) -> AppError {
    AppError::Validation {
        message: message.into(),
        recovery: recovery.into(),
    }
}

fn is_hex_color(value: &str) -> bool {
    value.len() == 7
        && value.starts_with('#')
        && value.as_bytes()[1..].iter().all(u8::is_ascii_hexdigit)
}
