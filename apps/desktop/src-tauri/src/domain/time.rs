use chrono::{DateTime, LocalResult, NaiveDateTime, TimeZone, Utc};
use chrono_tz::Tz;
use serde::Serialize;

use super::{AppError, AppResult};

#[derive(Debug, Clone, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct LocalTimeResolution {
    pub kind: LocalTimeResolutionKind,
    pub candidates: Vec<DateTime<Utc>>,
}

#[derive(Debug, Clone, Copy, Serialize)]
#[serde(rename_all = "snake_case")]
pub enum LocalTimeResolutionKind {
    Single,
    Ambiguous,
    Gap,
}

pub fn resolve_local_time(local: &str, timezone_id: &str) -> AppResult<LocalTimeResolution> {
    if local.len() > 32 || timezone_id.len() > 100 {
        return Err(invalid_local_time());
    }
    let local =
        NaiveDateTime::parse_from_str(local, "%Y-%m-%dT%H:%M").map_err(|_| invalid_local_time())?;
    let timezone: Tz = timezone_id.parse().map_err(|_| AppError::Validation {
        message: "タイムゾーンが正しくありません。".into(),
        recovery: "Asia/Tokyo のようなIANAタイムゾーンを選んでください。".into(),
    })?;
    Ok(match timezone.from_local_datetime(&local) {
        LocalResult::Single(value) => LocalTimeResolution {
            kind: LocalTimeResolutionKind::Single,
            candidates: vec![value.with_timezone(&Utc)],
        },
        LocalResult::Ambiguous(first, second) => {
            let mut candidates = vec![first.with_timezone(&Utc), second.with_timezone(&Utc)];
            candidates.sort();
            LocalTimeResolution {
                kind: LocalTimeResolutionKind::Ambiguous,
                candidates,
            }
        }
        LocalResult::None => LocalTimeResolution {
            kind: LocalTimeResolutionKind::Gap,
            candidates: Vec::new(),
        },
    })
}

fn invalid_local_time() -> AppError {
    AppError::Validation {
        message: "ローカル日時の形式が正しくありません。".into(),
        recovery: "日付と時刻を分単位で選び直してください。".into(),
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn detects_dst_gap_without_shifting() {
        let result = resolve_local_time("2026-03-29T02:30", "Europe/Berlin").unwrap();
        assert!(matches!(result.kind, LocalTimeResolutionKind::Gap));
        assert!(result.candidates.is_empty());
    }

    #[test]
    fn returns_both_instants_for_dst_overlap() {
        let result = resolve_local_time("2026-10-25T02:30", "Europe/Berlin").unwrap();
        assert!(matches!(result.kind, LocalTimeResolutionKind::Ambiguous));
        assert_eq!(result.candidates.len(), 2);
        assert_ne!(result.candidates[0], result.candidates[1]);
    }
}
