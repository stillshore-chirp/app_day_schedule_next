use chrono::{DateTime, Datelike, Days, LocalResult, NaiveDate, Offset, TimeZone, Utc, Weekday};
use chrono_tz::Tz;
use serde::Serialize;

use super::{AppError, AppResult, Schedule};

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

#[derive(Debug, Clone, Copy, PartialEq, Eq)]
enum Frequency {
    Daily,
    Weekly,
    Monthly,
    Yearly,
}

#[derive(Debug, Clone)]
struct Rule {
    frequency: Frequency,
    interval: u32,
    count: Option<u32>,
    until: Option<DateTime<Utc>>,
    weekdays: Vec<Weekday>,
    month_days: Vec<u32>,
    months: Vec<u32>,
}

pub fn validate_recurrence_rule(value: &str) -> AppResult<()> {
    parse_rule(value).map(|_| ())
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
    let rule_value = schedule
        .draft
        .recurrence_rule
        .as_deref()
        .ok_or_else(|| invalid_rule("繰り返しルールがありません。"))?;
    let rule = parse_rule(rule_value)?;
    let timezone: Tz = schedule
        .draft
        .timezone_id
        .parse()
        .map_err(|_| invalid_rule("IANAタイムゾーンが正しくありません。"))?;
    let anchor_local = schedule.draft.start_utc.with_timezone(&timezone);
    let anchor_date = anchor_local.date_naive();
    let anchor_time = anchor_local.time();
    let duration = schedule.draft.end_utc - schedule.draft.start_utc;
    let range_end_local = range_end.with_timezone(&timezone).date_naive();
    let last_date = range_end_local
        .checked_add_days(Days::new(1))
        .unwrap_or(range_end_local);
    let mut date = anchor_date;
    let mut matched = 0_u32;
    let mut items = Vec::new();
    let mut skipped_dst = 0_u32;
    let mut scanned = 0_u32;
    while date <= last_date && items.len() < maximum {
        scanned = scanned.saturating_add(1);
        if scanned > 200_000 {
            return Err(invalid_rule(
                "繰り返しの展開範囲が大きすぎます。COUNTまたはUNTILを設定してください。",
            ));
        }
        if matches_date(&rule, anchor_date, date) {
            matched = matched.saturating_add(1);
            if rule.count.is_some_and(|count| matched > count) {
                break;
            }
            let local = date.and_time(anchor_time);
            let candidate = match timezone.from_local_datetime(&local) {
                LocalResult::Single(value) => Some(value.with_timezone(&Utc)),
                LocalResult::Ambiguous(first, second) => {
                    let first = first.with_timezone(&Utc);
                    let second = second.with_timezone(&Utc);
                    let anchor_offset = anchor_local.offset().fix().local_minus_utc();
                    [first, second]
                        .into_iter()
                        .find(|value| {
                            value
                                .with_timezone(&timezone)
                                .offset()
                                .fix()
                                .local_minus_utc()
                                == anchor_offset
                        })
                        .or(Some(first.min(second)))
                }
                LocalResult::None => {
                    skipped_dst = skipped_dst.saturating_add(1);
                    None
                }
            };
            if let Some(start_utc) = candidate {
                if rule.until.is_some_and(|until| start_utc > until) {
                    break;
                }
                let end_utc = start_utc + duration;
                if !schedule.draft.recurrence_exdates.contains(&start_utc)
                    && start_utc < range_end
                    && end_utc > range_start
                {
                    items.push(RecurrenceOccurrence { start_utc, end_utc });
                }
            }
        }
        let Some(next) = date.checked_add_days(Days::new(1)) else {
            break;
        };
        date = next;
    }
    let mut warnings = Vec::new();
    if skipped_dst > 0 {
        warnings.push(format!(
            "DSTで存在しないローカル時刻 {skipped_dst} 件は生成していません。系列の時刻を確認してください。"
        ));
    }
    Ok(RecurrencePreview {
        items,
        warnings,
        infinite: rule.count.is_none() && rule.until.is_none(),
    })
}

fn matches_date(rule: &Rule, anchor: NaiveDate, candidate: NaiveDate) -> bool {
    if candidate < anchor {
        return false;
    }
    let days = candidate.signed_duration_since(anchor).num_days();
    match rule.frequency {
        Frequency::Daily => days % i64::from(rule.interval) == 0,
        Frequency::Weekly => {
            let weeks = days / 7;
            weeks % i64::from(rule.interval) == 0
                && if rule.weekdays.is_empty() {
                    candidate.weekday() == anchor.weekday()
                } else {
                    rule.weekdays.contains(&candidate.weekday())
                }
        }
        Frequency::Monthly => {
            let months = (candidate.year() - anchor.year()) * 12
                + i32::try_from(candidate.month()).unwrap_or_default()
                - i32::try_from(anchor.month()).unwrap_or_default();
            months >= 0
                && months % i32::try_from(rule.interval).unwrap_or(1) == 0
                && if rule.month_days.is_empty() {
                    candidate.day() == anchor.day()
                } else {
                    rule.month_days.contains(&candidate.day())
                }
        }
        Frequency::Yearly => {
            let years = candidate.year() - anchor.year();
            years >= 0
                && years % i32::try_from(rule.interval).unwrap_or(1) == 0
                && if rule.months.is_empty() {
                    candidate.month() == anchor.month()
                } else {
                    rule.months.contains(&candidate.month())
                }
                && if rule.month_days.is_empty() {
                    candidate.day() == anchor.day()
                } else {
                    rule.month_days.contains(&candidate.day())
                }
        }
    }
}

fn parse_rule(value: &str) -> AppResult<Rule> {
    if value.len() > 500 || value.is_empty() {
        return Err(invalid_rule("RRULEは1〜500文字で指定してください。"));
    }
    let mut frequency = None;
    let mut interval = 1_u32;
    let mut count = None;
    let mut until = None;
    let mut weekdays = Vec::new();
    let mut month_days = Vec::new();
    let mut months = Vec::new();
    for part in value.split(';') {
        let (key, raw) = part
            .split_once('=')
            .ok_or_else(|| invalid_rule("RRULEの区切りが正しくありません。"))?;
        if raw.is_empty() {
            return Err(invalid_rule("RRULEに空の値があります。"));
        }
        match key {
            "FREQ" => {
                frequency = Some(match raw {
                    "DAILY" => Frequency::Daily,
                    "WEEKLY" => Frequency::Weekly,
                    "MONTHLY" => Frequency::Monthly,
                    "YEARLY" => Frequency::Yearly,
                    _ => return Err(invalid_rule("対応していないFREQです。")),
                });
            }
            "INTERVAL" => interval = bounded_number(raw, 1, 999, "INTERVAL")?,
            "COUNT" => count = Some(bounded_number(raw, 1, 10_000, "COUNT")?),
            "UNTIL" => until = Some(parse_until(raw)?),
            "BYDAY" => {
                weekdays = raw
                    .split(',')
                    .map(parse_weekday)
                    .collect::<AppResult<Vec<_>>>()?;
                weekdays.sort_by_key(|day| day.num_days_from_monday());
                weekdays.dedup();
            }
            "BYMONTHDAY" => {
                month_days = raw
                    .split(',')
                    .map(|item| bounded_number(item, 1, 31, "BYMONTHDAY"))
                    .collect::<AppResult<Vec<_>>>()?;
            }
            "BYMONTH" => {
                months = raw
                    .split(',')
                    .map(|item| bounded_number(item, 1, 12, "BYMONTH"))
                    .collect::<AppResult<Vec<_>>>()?;
            }
            _ => return Err(invalid_rule(&format!("対応していないRRULE項目: {key}"))),
        }
    }
    if count.is_some() && until.is_some() {
        return Err(invalid_rule("COUNTとUNTILは同時に指定できません。"));
    }
    Ok(Rule {
        frequency: frequency.ok_or_else(|| invalid_rule("FREQがありません。"))?,
        interval,
        count,
        until,
        weekdays,
        month_days,
        months,
    })
}

fn parse_until(value: &str) -> AppResult<DateTime<Utc>> {
    if let Ok(value) = DateTime::parse_from_str(value, "%Y%m%dT%H%M%SZ") {
        return Ok(value.with_timezone(&Utc));
    }
    let date = NaiveDate::parse_from_str(value, "%Y%m%d")
        .map_err(|_| invalid_rule("UNTILはUTC日時または日付で指定してください。"))?;
    let end = date
        .and_hms_opt(23, 59, 59)
        .ok_or_else(|| invalid_rule("UNTILの日付が正しくありません。"))?;
    Ok(Utc.from_utc_datetime(&end))
}

fn parse_weekday(value: &str) -> AppResult<Weekday> {
    match value {
        "MO" => Ok(Weekday::Mon),
        "TU" => Ok(Weekday::Tue),
        "WE" => Ok(Weekday::Wed),
        "TH" => Ok(Weekday::Thu),
        "FR" => Ok(Weekday::Fri),
        "SA" => Ok(Weekday::Sat),
        "SU" => Ok(Weekday::Sun),
        _ => Err(invalid_rule("BYDAYの曜日が正しくありません。")),
    }
}

fn bounded_number(value: &str, minimum: u32, maximum: u32, field: &str) -> AppResult<u32> {
    let value = value
        .parse::<u32>()
        .map_err(|_| invalid_rule(&format!("{field}が数値ではありません。")))?;
    if (minimum..=maximum).contains(&value) {
        Ok(value)
    } else {
        Err(invalid_rule(&format!("{field}が範囲外です。")))
    }
}

fn invalid_rule(detail: &str) -> AppError {
    AppError::Validation {
        message: format!("繰り返しルールが正しくありません: {detail}"),
        recovery: "日次・週次・月次・年次・平日を選ぶか、RRULEを修正してください。".into(),
    }
}

#[cfg(test)]
mod tests {
    use chrono::TimeZone;

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
}
