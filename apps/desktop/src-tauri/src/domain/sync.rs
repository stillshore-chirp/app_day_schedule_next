use chrono::{DateTime, Utc};
use serde::Serialize;

#[derive(Debug, Clone, PartialEq, Eq)]
#[cfg_attr(not(test), allow(dead_code))]
pub enum MergeDecision<T> {
    Value(T),
    Conflict { local: T, remote: T },
}

#[cfg_attr(not(test), allow(dead_code))]
pub fn three_way_merge_field<T: Clone + PartialEq>(
    base: &T,
    local: &T,
    remote: &T,
) -> MergeDecision<T> {
    if local == remote {
        MergeDecision::Value(local.clone())
    } else if local == base {
        MergeDecision::Value(remote.clone())
    } else if remote == base {
        MergeDecision::Value(local.clone())
    } else {
        MergeDecision::Conflict {
            local: local.clone(),
            remote: remote.clone(),
        }
    }
}

#[derive(Debug, Clone, Copy, PartialEq, Eq, Serialize)]
#[serde(rename_all = "snake_case")]
#[allow(dead_code)]
pub enum SyncSummaryState {
    Disconnected,
    Connecting,
    Synced,
    Pending,
    Syncing,
    Offline,
    RetryScheduled,
    Conflict,
    AuthRequired,
}

#[derive(Debug, Clone, PartialEq, Eq, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct SyncSummary {
    pub state: SyncSummaryState,
    pub pending_count: u64,
    pub conflict_count: u64,
    pub last_completed_at: Option<DateTime<Utc>>,
    pub next_retry_at: Option<DateTime<Utc>>,
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn three_way_merge_never_silently_overwrites_same_field_conflict() {
        assert_eq!(
            three_way_merge_field(&"base", &"local", &"remote"),
            MergeDecision::Conflict {
                local: "local",
                remote: "remote"
            }
        );
        assert_eq!(
            three_way_merge_field(&"base", &"local", &"base"),
            MergeDecision::Value("local")
        );
    }
}
