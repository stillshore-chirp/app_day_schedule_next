use chrono::{DateTime, NaiveDate, Utc};
use serde::{Deserialize, Serialize};
use uuid::Uuid;

use super::{AppError, AppResult};

pub const MAX_TICKET_TITLE_CHARS: usize = 1_024;
pub const MAX_TICKET_DESCRIPTION_CHARS: usize = 10_000;
pub const MAX_TICKET_TAGS: usize = 20;
pub const MAX_TICKET_CHECKLIST_ITEMS: usize = 200;
pub const SORT_KEY_STEP: i64 = 1_024;

#[derive(Debug, Clone, Copy, PartialEq, Eq, Serialize, Deserialize)]
#[serde(rename_all = "snake_case")]
pub enum TicketPriority {
    Low,
    Normal,
    High,
    Urgent,
}

impl TicketPriority {
    pub fn as_str(self) -> &'static str {
        match self {
            Self::Low => "low",
            Self::Normal => "normal",
            Self::High => "high",
            Self::Urgent => "urgent",
        }
    }
}

#[derive(Debug, Clone, Copy, PartialEq, Eq, Serialize, Deserialize)]
#[serde(rename_all = "snake_case")]
pub enum TicketColumnKind {
    Inbox,
    Backlog,
    Next,
    InProgress,
    Waiting,
    Done,
}

impl TicketColumnKind {
    pub fn is_done(self) -> bool {
        self == Self::Done
    }
}

#[derive(Debug, Clone, PartialEq, Eq, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct TicketColumn {
    pub id: Uuid,
    pub board_id: Uuid,
    pub kind: TicketColumnKind,
    pub name: String,
    pub sort_order: i32,
    pub version: u64,
}

#[derive(Debug, Clone, PartialEq, Eq, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct TicketBoard {
    pub id: Uuid,
    pub name: String,
    pub version: u64,
    pub columns: Vec<TicketColumn>,
}

#[derive(Debug, Clone, PartialEq, Eq, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct TicketTag {
    pub id: Uuid,
    pub name: String,
}

#[derive(Debug, Clone, PartialEq, Eq, Serialize, Deserialize)]
#[serde(rename_all = "camelCase", deny_unknown_fields)]
pub struct TicketChecklistItemDraft {
    pub title: String,
    #[serde(default)]
    pub completed: bool,
}

#[derive(Debug, Clone, PartialEq, Eq, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct TicketChecklistItem {
    pub id: Uuid,
    pub title: String,
    pub completed: bool,
    pub sort_order: i32,
    pub version: u64,
}

#[derive(Debug, Clone, PartialEq, Eq, Serialize, Deserialize)]
#[serde(rename_all = "camelCase", deny_unknown_fields)]
pub struct TicketDraft {
    pub board_id: Uuid,
    pub column_id: Uuid,
    #[serde(default)]
    pub parent_ticket_id: Option<Uuid>,
    pub title: String,
    #[serde(default)]
    pub description: String,
    #[serde(default = "default_priority")]
    pub priority: TicketPriority,
    #[serde(default)]
    pub due_date: Option<NaiveDate>,
    #[serde(default)]
    pub estimate_minutes: Option<u32>,
    #[serde(default)]
    pub tags: Vec<String>,
    #[serde(default)]
    pub checklist: Vec<TicketChecklistItemDraft>,
}

fn default_priority() -> TicketPriority {
    TicketPriority::Normal
}

impl TicketDraft {
    pub fn validate(&mut self) -> AppResult<()> {
        self.title = self.title.trim().to_owned();
        let title_chars = self.title.chars().count();
        if !(1..=MAX_TICKET_TITLE_CHARS).contains(&title_chars) {
            return Err(validation(
                "チケットのタイトルは1〜1024文字で入力してください。",
                "タイトルを確認してから、もう一度保存してください。",
            ));
        }
        if self.description.chars().count() > MAX_TICKET_DESCRIPTION_CHARS {
            return Err(validation(
                "チケットの説明は10,000文字以内で入力してください。",
                "説明を短くしてから、もう一度保存してください。",
            ));
        }
        if self
            .estimate_minutes
            .is_some_and(|minutes| !(1..=100_800).contains(&minutes))
        {
            return Err(validation(
                "見積時間は1〜100,800分で入力してください。",
                "見積時間を確認してから、もう一度保存してください。",
            ));
        }
        normalize_tags(&mut self.tags)?;
        validate_checklist(&mut self.checklist)?;
        Ok(())
    }
}

#[derive(Debug, Clone, Default, PartialEq, Eq, Serialize, Deserialize)]
#[serde(rename_all = "camelCase", deny_unknown_fields)]
pub struct TicketPatch {
    pub title: Option<String>,
    pub description: Option<String>,
    pub priority: Option<TicketPriority>,
    pub due_date: Option<Option<NaiveDate>>,
    pub estimate_minutes: Option<Option<u32>>,
    pub parent_ticket_id: Option<Option<Uuid>>,
    pub tags: Option<Vec<String>>,
    pub checklist: Option<Vec<TicketChecklistItemDraft>>,
}

#[derive(Debug, Clone, PartialEq, Eq, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct Ticket {
    pub id: Uuid,
    pub board_id: Uuid,
    pub column_id: Uuid,
    pub last_non_done_column_id: Option<Uuid>,
    pub parent_ticket_id: Option<Uuid>,
    pub title: String,
    pub description: String,
    pub priority: TicketPriority,
    pub due_date: Option<NaiveDate>,
    pub estimate_minutes: Option<u32>,
    pub sort_key: i64,
    pub tags: Vec<TicketTag>,
    pub checklist: Vec<TicketChecklistItem>,
    pub version: u64,
    pub created_at: DateTime<Utc>,
    pub updated_at: DateTime<Utc>,
    pub completed_at: Option<DateTime<Utc>>,
    pub archived_at: Option<DateTime<Utc>>,
    pub deleted_at: Option<DateTime<Utc>>,
}

#[derive(Debug, Clone, Default, PartialEq, Eq, Deserialize)]
#[serde(rename_all = "camelCase", deny_unknown_fields)]
pub struct TicketQuery {
    #[serde(default)]
    pub board_id: Option<Uuid>,
    #[serde(default)]
    pub column_id: Option<Uuid>,
    #[serde(default)]
    pub search: Option<String>,
    #[serde(default)]
    pub priority: Option<TicketPriority>,
    #[serde(default)]
    pub include_archived: bool,
    #[serde(default)]
    pub include_deleted: bool,
    #[serde(default = "default_query_limit")]
    pub limit: u32,
    #[serde(default)]
    pub offset: u32,
}

fn default_query_limit() -> u32 {
    500
}

impl TicketQuery {
    pub fn validate(&mut self) -> AppResult<()> {
        self.limit = self.limit.clamp(1, 1_000);
        if let Some(search) = &mut self.search {
            *search = search.trim().to_owned();
            if search.chars().count() > 500 {
                return Err(validation(
                    "検索語は500文字以内で入力してください。",
                    "検索語を短くして、もう一度検索してください。",
                ));
            }
            if search.is_empty() {
                self.search = None;
            }
        }
        Ok(())
    }
}

#[derive(Debug, Clone, PartialEq, Eq, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct TicketPage {
    pub contract_version: u16,
    pub items: Vec<Ticket>,
    pub total: u64,
}

#[derive(Debug, Clone, PartialEq, Eq, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct TicketHistoryItem {
    pub id: i64,
    pub action_id: Uuid,
    pub action: String,
    pub version: u64,
    pub created_at: DateTime<Utc>,
}

pub fn sort_key_between(previous: Option<i64>, next: Option<i64>) -> Option<i64> {
    match (previous, next) {
        (None, None) => Some(SORT_KEY_STEP),
        (Some(previous), None) => previous.checked_add(SORT_KEY_STEP),
        (None, Some(next)) if next > 1 => Some(next / 2),
        (Some(previous), Some(next)) if next - previous > 1 => {
            Some(previous + (next - previous) / 2)
        }
        _ => None,
    }
}

pub fn rebalanced_sort_key(index: usize) -> AppResult<i64> {
    i64::try_from(index + 1)
        .ok()
        .and_then(|value| value.checked_mul(SORT_KEY_STEP))
        .ok_or_else(|| {
            validation(
                "チケットの並び順を保存できません。",
                "列を再読み込みしてください。",
            )
        })
}

fn normalize_tags(tags: &mut Vec<String>) -> AppResult<()> {
    let mut normalized = Vec::with_capacity(tags.len());
    for tag in tags.drain(..) {
        let tag = tag.trim().to_owned();
        if tag.is_empty() || tag.chars().count() > 50 {
            return Err(validation(
                "タグは1〜50文字で入力してください。",
                "空のタグを削除し、長いタグを短くしてください。",
            ));
        }
        if !normalized
            .iter()
            .any(|existing: &String| existing.eq_ignore_ascii_case(&tag))
        {
            normalized.push(tag);
        }
    }
    if normalized.len() > MAX_TICKET_TAGS {
        return Err(validation(
            "1件のチケットへ設定できるタグは20件までです。",
            "タグを減らしてから、もう一度保存してください。",
        ));
    }
    *tags = normalized;
    Ok(())
}

fn validate_checklist(items: &mut [TicketChecklistItemDraft]) -> AppResult<()> {
    if items.len() > MAX_TICKET_CHECKLIST_ITEMS {
        return Err(validation(
            "1件のチケットへ設定できるチェック項目は200件までです。",
            "チェック項目を分けてください。",
        ));
    }
    for item in items {
        item.title = item.title.trim().to_owned();
        if item.title.is_empty() || item.title.chars().count() > 500 {
            return Err(validation(
                "チェック項目は1〜500文字で入力してください。",
                "チェック項目を確認してから、もう一度保存してください。",
            ));
        }
    }
    Ok(())
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

    fn draft(title: &str) -> TicketDraft {
        TicketDraft {
            board_id: Uuid::new_v4(),
            column_id: Uuid::new_v4(),
            parent_ticket_id: None,
            title: title.into(),
            description: String::new(),
            priority: TicketPriority::Normal,
            due_date: None,
            estimate_minutes: None,
            tags: Vec::new(),
            checklist: Vec::new(),
        }
    }

    #[test]
    fn title_boundaries_preserve_1024_unicode_characters() {
        for (length, valid) in [(0, false), (1, true), (1_024, true), (1_025, false)] {
            let mut candidate = draft(&"界".repeat(length));
            assert_eq!(candidate.validate().is_ok(), valid, "length {length}");
        }
    }

    #[test]
    fn tags_are_trimmed_and_deduplicated_without_losing_spelling() {
        let mut candidate = draft("検証");
        candidate.tags = vec![" Rust ".into(), "rust".into(), "設計".into()];
        candidate.validate().unwrap();
        assert_eq!(candidate.tags, vec!["Rust", "設計"]);
    }

    #[test]
    fn validation_rejects_estimate_and_checklist_boundaries() {
        let mut invalid_estimate = draft("見積");
        invalid_estimate.estimate_minutes = Some(0);
        assert!(invalid_estimate.validate().is_err());

        let mut invalid_checklist = draft("項目");
        invalid_checklist.checklist = (0..=MAX_TICKET_CHECKLIST_ITEMS)
            .map(|index| TicketChecklistItemDraft {
                title: format!("項目 {index}"),
                completed: false,
            })
            .collect();
        assert!(invalid_checklist.validate().is_err());
    }

    #[test]
    fn sort_keys_request_rebalance_only_when_gap_is_exhausted() {
        assert_eq!(sort_key_between(Some(1_024), Some(2_048)), Some(1_536));
        assert_eq!(sort_key_between(Some(1_024), Some(1_025)), None);
        assert_eq!(rebalanced_sort_key(499).unwrap(), 512_000);
    }

    #[test]
    fn shared_v1_fixture_matches_rust_serde_and_rejects_unknown_fields() {
        let fixture: serde_json::Value = serde_json::from_str(include_str!(
            "../../../src/shared/fixtures/ticket-contract-v1.json"
        ))
        .unwrap();
        let mut draft: TicketDraft = serde_json::from_value(fixture["draft"].clone()).unwrap();
        draft.validate().unwrap();
        assert_eq!(draft.title, "Synthetic ticket contract");
        let mut unknown = fixture["draft"].clone();
        unknown["unknownField"] = serde_json::json!(true);
        assert!(serde_json::from_value::<TicketDraft>(unknown).is_err());
    }
}
