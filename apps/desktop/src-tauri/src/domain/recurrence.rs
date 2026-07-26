use chrono::{DateTime, Duration, LocalResult, SecondsFormat, TimeZone, Timelike, Utc};
use rrule::{RRule, RRuleSet, Tz as RRuleTimezone, Unvalidated};
use serde::Serialize;

use super::{AppError, AppResult, Schedule, ScheduleDraft};

#[derive(Debug, Clone, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct RecurrenceOccurrence {
    pub start_utc: DateTime<Utc>,
    pub end_utc: DateTime<Utc>,
}

#[derive(Debug, Clone, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct RecurrencePreview {
    pub items: Vec<RecurrenceOccurrence>,
    pub warnings: Vec<String>,
    pub infinite: bool,
}

pub fn validate_recurrence_rule(value: &str) -> AppResult<()> {
    if value.is_empty() || value.len() > 500 {
        return Err(invalid_rule("RRULEは1〜500文字で指定してください。"));
    }
    value
        .parse::<RRule<Unvalidated>>()
        .map(|_| ())
        .map_err(|_| invalid_rule("RFC 5545のRRULE形式を確認してください。"))
}

pub fn validate_recurrence_set(draft: &ScheduleDraft) -> AppResult<()> {
    if draft.recurrence_rule.is_none() && draft.recurrence_supplemental_lines.is_empty() {
        return Ok(());
    }
    build_recurrence_set(draft).map(|_| ())
}

pub fn recurrence_preview(schedule: &Schedule, maximum: usize) -> AppResult<RecurrencePreview> {
    let start = schedule.draft.start_utc;
    let end = start + chrono::Duration::days(366 * 20);
    expand(schedule, start, end, maximum.clamp(1, 100))
}

pub fn expand_recurrence(
    schedule: &Schedule,
    range_start: DateTime<Utc>,
    range_end: DateTime<Utc>,
    maximum: usize,
) -> AppResult<RecurrencePreview> {
    expand(schedule, range_start, range_end, maximum)
}

fn expand(
    schedule: &Schedule,
    range_start: DateTime<Utc>,
    range_end: DateTime<Utc>,
    maximum: usize,
) -> AppResult<RecurrencePreview> {
    let recurrence_set = build_recurrence_set(&schedule.draft)?;
    let infinite = recurrence_set
        .get_rrule()
        .iter()
        .any(|rule| rule.get_count().is_none() && rule.get_until().is_none());
    let timezone: chrono_tz::Tz = schedule
        .draft
        .timezone_id
        .parse()
        .map_err(|_| invalid_rule("IANAタイムゾーンが正しくありません。"))?;
    let rrule_timezone = RRuleTimezone::from(timezone);
    let duration = schedule.draft.end_utc - schedule.draft.start_utc;
    let anchor_local = schedule.draft.start_utc.with_timezone(&timezone);
    let inclusion_rules = recurrence_set.get_rrule().clone();
    let recurrence_dates = recurrence_set
        .get_rdate()
        .iter()
        .map(DateTime::timestamp)
        .collect::<std::collections::HashSet<_>>();
    let maximum = maximum.clamp(1, usize::from(u16::MAX) - 1);
    let after = (range_start - duration - Duration::seconds(1)).with_timezone(&rrule_timezone);
    let before = range_end.with_timezone(&rrule_timezone);
    let result_limit = maximum
        .saturating_add(1)
        .saturating_mul(inclusion_rules.len().max(1))
        .saturating_add(recurrence_dates.len())
        .min(usize::from(u16::MAX));
    let result = recurrence_set
        .after(after)
        .before(before)
        .all(u16::try_from(result_limit).unwrap_or(u16::MAX));
    let mut normalized_gap_count = 0_u32;
    let mut ambiguous_count = 0_u32;
    let mut seen_start_timestamps = std::collections::HashSet::new();
    let items = result
        .dates
        .into_iter()
        .filter_map(|start| {
            if !seen_start_timestamps.insert(start.timestamp()) {
                return None;
            }
            if !recurrence_dates.contains(&start.timestamp())
                && !inclusion_rules.iter().any(|rule| {
                    rule_matches_generated_local_time(rule, anchor_local.time(), &start)
                })
            {
                normalized_gap_count = normalized_gap_count.saturating_add(1);
                return None;
            }
            if matches!(
                timezone.from_local_datetime(&start.naive_local()),
                LocalResult::Ambiguous(_, _)
            ) {
                ambiguous_count = ambiguous_count.saturating_add(1);
            }
            let start_utc = start.with_timezone(&Utc);
            let end_utc = start_utc + duration;
            Some(RecurrenceOccurrence { start_utc, end_utc })
        })
        .filter(|item| item.start_utc < range_end && item.end_utc > range_start)
        .take(maximum)
        .collect::<Vec<_>>();
    let mut warnings = Vec::new();
    if result.limited {
        warnings.push(
            "安全な展開上限に達しました。表示範囲を狭めるか、COUNTまたはUNTILを確認してください。"
                .into(),
        );
    }
    if normalized_gap_count > 0 {
        warnings.push(format!(
            "DSTで存在しないローカル時刻 {normalized_gap_count} 件は生成していません。系列の時刻を確認してください。"
        ));
    }
    if ambiguous_count > 0 {
        warnings.push(format!(
            "DSTで重複するローカル時刻 {ambiguous_count} 件は系列の基準offsetで表示しています。Google側の時刻を確認してください。"
        ));
    }
    Ok(RecurrencePreview {
        items,
        warnings,
        infinite,
    })
}

fn rule_matches_generated_local_time(
    rule: &RRule,
    anchor_time: chrono::NaiveTime,
    generated: &DateTime<RRuleTimezone>,
) -> bool {
    (rule.get_by_hour().is_empty() || rule.get_by_hour().contains(&(generated.hour() as u8)))
        && (!rule.get_by_hour().is_empty() || generated.hour() == anchor_time.hour())
        && (rule.get_by_minute().is_empty()
            || rule.get_by_minute().contains(&(generated.minute() as u8)))
        && (!rule.get_by_minute().is_empty() || generated.minute() == anchor_time.minute())
        && (rule.get_by_second().is_empty()
            || rule.get_by_second().contains(&(generated.second() as u8)))
        && (!rule.get_by_second().is_empty() || generated.second() == anchor_time.second())
}

fn build_recurrence_set(draft: &ScheduleDraft) -> AppResult<RRuleSet> {
    let timezone: chrono_tz::Tz = draft
        .timezone_id
        .parse()
        .map_err(|_| invalid_rule("IANAタイムゾーンが正しくありません。"))?;
    let start_local = draft.start_utc.with_timezone(&timezone);
    let mut source = if draft.all_day {
        let date = draft
            .all_day_start_date
            .unwrap_or_else(|| start_local.date_naive());
        format!(
            "DTSTART;VALUE=DATE:{0}\nRDATE;VALUE=DATE:{0}",
            date.format("%Y%m%d")
        )
    } else {
        format!(
            "DTSTART;TZID={0}:{1}\nRDATE;TZID={0}:{1}",
            draft.timezone_id,
            start_local.format("%Y%m%dT%H%M%S")
        )
    };
    if let Some(rule) = &draft.recurrence_rule {
        source.push_str("\nRRULE:");
        source.push_str(rule);
    }
    for line in &draft.recurrence_supplemental_lines {
        source.push('\n');
        source.push_str(line);
    }
    if !draft.recurrence_exdates.is_empty() {
        source.push_str("\nEXDATE:");
        source.push_str(
            &draft
                .recurrence_exdates
                .iter()
                .map(|value| {
                    value
                        .to_rfc3339_opts(SecondsFormat::Secs, true)
                        .replace(['-', ':'], "")
                })
                .collect::<Vec<_>>()
                .join(","),
        );
    }
    source
        .parse::<RRuleSet>()
        .map_err(|_| invalid_rule("RFC 5545の再発集合を解釈できません。"))
}

fn invalid_rule(detail: &str) -> AppError {
    AppError::Validation {
        message: format!("繰り返しルールが正しくありません: {detail}"),
        recovery: "日次・週次・月次・年次・平日を選ぶか、RRULEを修正してください。".into(),
    }
}

#[cfg(test)]
mod tests {
    use chrono::{Datelike, TimeZone};

    use crate::domain::{Priority, ScheduleDraft, ScheduleStatus, SyncStatus};

    use super::*;

    fn schedule(rule: &str, zone: &str, start: DateTime<Utc>) -> Schedule {
        Schedule {
            id: uuid::Uuid::new_v4(),
            draft: ScheduleDraft {
                title: "再発".into(),
                description: String::new(),
                location: String::new(),
                start_utc: start,
                end_utc: start + chrono::Duration::hours(1),
                timezone_id: zone.into(),
                all_day: false,
                all_day_start_date: None,
                all_day_end_date_exclusive: None,
                status: ScheduleStatus::Scheduled,
                project: String::new(),
                category: String::new(),
                tags: Vec::new(),
                color: "#6F96F4".into(),
                priority: Priority::Normal,
                recurrence_rule: Some(rule.into()),
                recurrence_supplemental_lines: Vec::new(),
                recurrence_exdates: Vec::new(),
                start_notification_minutes: None,
                end_notification_minutes: None,
            },
            sync_status: SyncStatus::LocalOnly,
            version: 0,
            deleted_at: None,
        }
    }

    #[test]
    fn weekdays_and_count_are_deterministic() {
        let value = schedule(
            "FREQ=WEEKLY;BYDAY=MO,TU,WE,TH,FR;COUNT=6",
            "UTC",
            Utc.with_ymd_and_hms(2026, 7, 20, 9, 0, 0).unwrap(),
        );
        let preview = recurrence_preview(&value, 10).unwrap();
        assert_eq!(preview.items.len(), 6);
        assert_eq!(preview.items[5].start_utc.day(), 27);
    }

    #[test]
    fn monthly_rule_skips_missing_month_day() {
        let value = schedule(
            "FREQ=MONTHLY;COUNT=3",
            "UTC",
            Utc.with_ymd_and_hms(2026, 1, 31, 9, 0, 0).unwrap(),
        );
        let preview = recurrence_preview(&value, 10).unwrap();
        assert_eq!(preview.items[0].start_utc.month(), 1);
        assert_eq!(preview.items[1].start_utc.month(), 3);
        assert_eq!(preview.items[2].start_utc.month(), 5);
    }

    #[test]
    fn recurrence_set_unions_rdate_and_subtracts_exrule() {
        let mut value = schedule(
            "FREQ=DAILY;COUNT=5",
            "UTC",
            Utc.with_ymd_and_hms(2026, 7, 20, 9, 0, 0).unwrap(),
        );
        value.draft.recurrence_supplemental_lines = vec![
            "RDATE;TZID=UTC:20260726T090000".into(),
            "EXRULE:FREQ=DAILY;BYDAY=WE".into(),
        ];

        let preview = recurrence_preview(&value, 10).unwrap();
        let dates = preview
            .items
            .iter()
            .map(|item| item.start_utc.date_naive().to_string())
            .collect::<Vec<_>>();

        assert_eq!(
            dates,
            [
                "2026-07-20",
                "2026-07-21",
                "2026-07-23",
                "2026-07-24",
                "2026-07-26"
            ]
        );
    }

    #[test]
    fn exrule_also_subtracts_a_matching_rdate() {
        let mut value = schedule(
            "FREQ=DAILY;COUNT=5",
            "UTC",
            Utc.with_ymd_and_hms(2026, 7, 20, 9, 0, 0).unwrap(),
        );
        value.draft.recurrence_supplemental_lines = vec![
            "RDATE;TZID=UTC:20260725T090000".into(),
            "EXRULE:FREQ=WEEKLY;BYDAY=SA".into(),
        ];

        let preview = recurrence_preview(&value, 10).unwrap();
        let dates = preview
            .items
            .iter()
            .map(|item| item.start_utc.date_naive().to_string())
            .collect::<Vec<_>>();

        assert_eq!(
            dates,
            [
                "2026-07-20",
                "2026-07-21",
                "2026-07-22",
                "2026-07-23",
                "2026-07-24"
            ]
        );
    }

    #[test]
    fn rdate_only_set_remains_visible_as_a_recurrence_set() {
        let mut value = schedule(
            "FREQ=DAILY;COUNT=1",
            "UTC",
            Utc.with_ymd_and_hms(2026, 7, 20, 9, 0, 0).unwrap(),
        );
        value.draft.recurrence_rule = None;
        value.draft.recurrence_supplemental_lines = vec!["RDATE;TZID=UTC:20260723T090000".into()];

        let preview = recurrence_preview(&value, 10).unwrap();
        let dates = preview
            .items
            .iter()
            .map(|item| item.start_utc.date_naive().to_string())
            .collect::<Vec<_>>();

        assert!(value.draft.is_recurring());
        assert_eq!(dates, ["2026-07-20", "2026-07-23"]);
    }

    #[test]
    fn ordinal_byday_and_week_start_are_expanded() {
        let value = schedule(
            "FREQ=MONTHLY;BYDAY=-1MO;WKST=SU;COUNT=3",
            "UTC",
            Utc.with_ymd_and_hms(2026, 7, 27, 9, 0, 0).unwrap(),
        );

        let preview = recurrence_preview(&value, 10).unwrap();
        let dates = preview
            .items
            .iter()
            .map(|item| item.start_utc.date_naive().to_string())
            .collect::<Vec<_>>();

        assert_eq!(dates, ["2026-07-27", "2026-08-31", "2026-09-28"]);
    }

    #[test]
    fn bysetpos_selects_the_last_weekday_of_each_month() {
        let value = schedule(
            "FREQ=MONTHLY;BYDAY=MO,TU,WE,TH,FR;BYSETPOS=-1;COUNT=3",
            "UTC",
            Utc.with_ymd_and_hms(2026, 7, 31, 9, 0, 0).unwrap(),
        );

        let preview = recurrence_preview(&value, 10).unwrap();
        let dates = preview
            .items
            .iter()
            .map(|item| item.start_utc.date_naive().to_string())
            .collect::<Vec<_>>();

        assert_eq!(dates, ["2026-07-31", "2026-08-31", "2026-09-30"]);
    }

    #[test]
    fn dst_gap_is_not_silently_shifted_to_another_local_time() {
        let value = schedule(
            "FREQ=DAILY;COUNT=3",
            "America/New_York",
            Utc.with_ymd_and_hms(2026, 3, 7, 7, 30, 0).unwrap(),
        );

        let preview = recurrence_preview(&value, 10).unwrap();
        let starts = preview
            .items
            .iter()
            .map(|item| item.start_utc.to_rfc3339())
            .collect::<Vec<_>>();

        assert_eq!(
            starts,
            ["2026-03-07T07:30:00+00:00", "2026-03-09T06:30:00+00:00"]
        );
        assert!(
            preview
                .warnings
                .iter()
                .any(|warning| warning.contains("存在しないローカル時刻"))
        );
    }

    #[test]
    fn dst_overlap_is_reported_instead_of_being_silent() {
        let value = schedule(
            "FREQ=DAILY;COUNT=3",
            "America/New_York",
            Utc.with_ymd_and_hms(2026, 10, 31, 5, 30, 0).unwrap(),
        );

        let preview = recurrence_preview(&value, 10).unwrap();

        assert_eq!(preview.items.len(), 3);
        assert!(
            preview
                .warnings
                .iter()
                .any(|warning| warning.contains("重複するローカル時刻"))
        );
    }
}
