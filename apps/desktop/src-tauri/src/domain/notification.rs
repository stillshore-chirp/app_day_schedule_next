use chrono::{DateTime, Duration, Utc};

#[derive(Debug, Clone, PartialEq, Eq)]
#[cfg_attr(not(test), allow(dead_code))]
pub struct NotificationCandidate {
    pub delivery_key: String,
    pub occurrence_at: DateTime<Utc>,
}

#[derive(Debug, Clone, Copy, PartialEq, Eq)]
#[cfg_attr(not(test), allow(dead_code))]
pub struct NotificationPolicy {
    pub grace_minutes: u8,
    pub max_replay: u8,
}

impl NotificationPolicy {
    #[cfg_attr(not(test), allow(dead_code))]
    pub fn select_after_resume(
        self,
        now: DateTime<Utc>,
        candidates: impl IntoIterator<Item = NotificationCandidate>,
    ) -> Vec<NotificationCandidate> {
        let cutoff = now - Duration::minutes(i64::from(self.grace_minutes));
        let mut due = candidates
            .into_iter()
            .filter(|item| item.occurrence_at >= cutoff && item.occurrence_at <= now)
            .collect::<Vec<_>>();
        due.sort_by_key(|item| item.occurrence_at);
        due.truncate(usize::from(self.max_replay));
        due
    }
}

#[cfg(test)]
mod tests {
    use chrono::{TimeZone, Utc};

    use super::*;

    #[test]
    fn resume_is_bounded_by_grace_and_count() {
        let now = Utc.with_ymd_and_hms(2026, 1, 1, 10, 0, 0).unwrap();
        let candidates = [20, 9, 5, 1]
            .into_iter()
            .map(|minutes| NotificationCandidate {
                delivery_key: minutes.to_string(),
                occurrence_at: now - Duration::minutes(minutes),
            });
        let selected = NotificationPolicy {
            grace_minutes: 10,
            max_replay: 2,
        }
        .select_after_resume(now, candidates);
        assert_eq!(selected.len(), 2);
        assert_eq!(selected[0].delivery_key, "9");
        assert_eq!(selected[1].delivery_key, "5");
    }
}
