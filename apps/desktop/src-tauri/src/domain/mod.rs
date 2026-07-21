pub mod error;
pub mod focus;
pub mod library;
pub mod notification;
pub mod recurrence;
pub mod schedule;
pub mod sync;
pub mod time;
pub mod timer;

pub use error::{AppError, AppResult, UserSafeError};
pub use focus::validate_transition as validate_focus_transition;
pub use focus::{FocusCommand, FocusPhase, FocusState};
pub use library::{
    DayTemplate, DayTemplateDraft, FreeAlarm, FreeAlarmDraft, QuickBlock, QuickBlockDraft,
    TemplateApplyMode, TemplateBlock, TemplateBlockDraft, TemplatePreview, TemplatePreviewItem,
};
pub use recurrence::{
    RecurrencePreview, expand_recurrence, recurrence_preview, validate_recurrence_rule,
};
pub use schedule::{
    CloseBehavior, Priority, RecurrenceEditScope, Schedule, ScheduleClassificationPatch,
    ScheduleDraft, ScheduleQuery, ScheduleStatus, Settings, SyncStatus,
};
pub use sync::{SyncSummary, SyncSummaryState};
pub use time::{LocalTimeResolution, resolve_local_time};
pub use timer::{
    StopwatchCommand, StopwatchState, StopwatchStatus, TimerCommand, TimerDraft, TimerSet,
    TimerSetItem, TimerState, TimerStatus, normalize_timer_set_name, validate_stopwatch_transition,
    validate_timer_transition,
};
