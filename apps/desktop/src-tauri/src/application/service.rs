use std::{
    collections::HashMap,
    path::Path,
    sync::Arc,
    time::{Duration as MonotonicDuration, Instant},
};

use chrono::{DateTime, LocalResult, NaiveDate, TimeZone, Utc};
use chrono_tz::Tz;
use serde::Serialize;
use uuid::Uuid;

use crate::{
    application::OperationRegistry,
    domain::{
        AppError, AppResult, AssignTicketScheduleRequest, DayTemplate, DayTemplateDraft,
        FocusCommand, FocusPhase, FocusState, FreeAlarm, FreeAlarmDraft, LinkTicketScheduleRequest,
        QuickBlock, QuickBlockDraft, RecurrenceEditScope, Schedule, ScheduleClassificationPatch,
        ScheduleDraft, ScheduleQuery, Settings, StopwatchCommand, StopwatchState, StopwatchStatus,
        SyncSummary, SyncSummaryState, TemplateApplyMode, TemplatePreview, Ticket, TicketBoard,
        TicketDraft, TicketHistoryItem, TicketPage, TicketPatch, TicketPlanningSummary,
        TicketQuery, TicketScheduleLink, TimerCommand, TimerDraft, TimerSet, TimerState,
        TimerStatus, UnlinkTicketScheduleRequest, resolve_local_time, validate_focus_transition,
        validate_stopwatch_transition, validate_timer_transition,
    },
    infrastructure::{
        BackupRecord, ChangeResult, ConflictChoice, Database, DeliveryResult,
        DiagnosticsExportResult, DiagnosticsSnapshot, DisconnectMode, ExportResult,
        FocusHistoryReport, FocusRecord, GoogleCalendar, GoogleConnection, ImportMode,
        ImportPreview, ImportResult, LegacyImportPreview, LegacyImportResult, NotificationDelivery,
        NotificationLedgerItem, OAuthBeginResult, OAuthConfigResult, RestoreStageResult,
        StopwatchRecord, SyncConflictItem, SyncQueueItem, TimerRecord,
    },
};

pub trait Clock: Send + Sync {
    fn now(&self) -> DateTime<Utc>;
    fn monotonic(&self) -> MonotonicDuration;
}

struct SystemClock {
    origin: Instant,
}

impl SystemClock {
    fn new() -> Self {
        Self {
            origin: Instant::now(),
        }
    }
}

impl Clock for SystemClock {
    fn now(&self) -> DateTime<Utc> {
        Utc::now()
    }

    fn monotonic(&self) -> MonotonicDuration {
        self.origin.elapsed()
    }
}

#[derive(Debug, Clone)]
struct FocusRuntime {
    session_id: Uuid,
    phase: FocusPhase,
    monotonic_anchor: MonotonicDuration,
    elapsed_at_anchor: u64,
}

#[derive(Debug, Clone)]
struct TimerRuntime {
    run_id: Uuid,
    monotonic_anchor: MonotonicDuration,
    elapsed_at_anchor: u64,
}

#[derive(Debug, Clone)]
struct StopwatchRuntime {
    version: u64,
    monotonic_anchor: MonotonicDuration,
    elapsed_at_anchor: u64,
}

#[derive(Clone)]
pub struct AppService {
    database: Database,
    clock: Arc<dyn Clock>,
    focus_runtime: Arc<tokio::sync::Mutex<Option<FocusRuntime>>>,
    timer_runtime: Arc<tokio::sync::Mutex<HashMap<Uuid, TimerRuntime>>>,
    stopwatch_runtime: Arc<tokio::sync::Mutex<Option<StopwatchRuntime>>>,
    timer_gate: Arc<tokio::sync::Mutex<()>>,
    sync_gate: Arc<tokio::sync::Mutex<()>>,
    operations: OperationRegistry,
    process_started_at: Instant,
}

#[derive(Debug, Clone, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct Bootstrap {
    pub schema_version: u32,
    pub app_version: String,
    pub today: String,
    pub timezone_id: String,
    pub settings: Settings,
    pub sync: SyncSummary,
    pub focus: FocusState,
    pub notification_permission: &'static str,
    pub database_state: &'static str,
    pub window_preferences: WindowPreferences,
}

#[derive(Debug, Clone, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct WindowPreferences {
    pub main_always_on_top: bool,
    pub compact_always_on_top: bool,
}

impl AppService {
    pub fn new_started_at(database: Database, process_started_at: Instant) -> Self {
        Self {
            database,
            clock: Arc::new(SystemClock::new()),
            focus_runtime: Arc::new(tokio::sync::Mutex::new(None)),
            timer_runtime: Arc::new(tokio::sync::Mutex::new(HashMap::new())),
            stopwatch_runtime: Arc::new(tokio::sync::Mutex::new(None)),
            timer_gate: Arc::new(tokio::sync::Mutex::new(())),
            sync_gate: Arc::new(tokio::sync::Mutex::new(())),
            operations: OperationRegistry::default(),
            process_started_at,
        }
    }

    #[cfg(test)]
    #[allow(dead_code)]
    pub fn with_clock(database: Database, clock: Arc<dyn Clock>) -> Self {
        Self {
            database,
            clock,
            focus_runtime: Arc::new(tokio::sync::Mutex::new(None)),
            timer_runtime: Arc::new(tokio::sync::Mutex::new(HashMap::new())),
            stopwatch_runtime: Arc::new(tokio::sync::Mutex::new(None)),
            timer_gate: Arc::new(tokio::sync::Mutex::new(())),
            sync_gate: Arc::new(tokio::sync::Mutex::new(())),
            operations: OperationRegistry::default(),
            process_started_at: Instant::now(),
        }
    }

    pub fn mark_ui_ready(&self) -> u64 {
        let elapsed = self.process_started_at.elapsed().as_millis() as u64;
        #[cfg(feature = "e2e")]
        if std::env::var("DAY_SCHEDULE_PERF_LOG").as_deref() == Ok("1") {
            println!("DAY_SCHEDULE_UI_READY_MS={elapsed}");
        }
        elapsed
    }

    pub async fn bootstrap(&self) -> AppResult<Bootstrap> {
        let timezone_id = iana_time_zone::get_timezone()
            .ok()
            .filter(|value| value.parse::<Tz>().is_ok())
            .unwrap_or_else(|| "UTC".into());
        let timezone = timezone_id.parse::<Tz>().unwrap_or(chrono_tz::UTC);
        let settings = self.database.settings().await?;
        Ok(Bootstrap {
            schema_version: 15,
            app_version: env!("CARGO_PKG_VERSION").into(),
            today: self
                .clock
                .now()
                .with_timezone(&timezone)
                .date_naive()
                .to_string(),
            timezone_id,
            sync: self.database.sync_summary().await?,
            focus: self.focus_state(&settings).await?,
            settings,
            notification_permission: "unknown",
            database_state: "ready",
            window_preferences: WindowPreferences {
                main_always_on_top: self.database.window_always_on_top("main").await?,
                compact_always_on_top: self.database.window_always_on_top("compact").await?,
            },
        })
    }

    pub async fn list_schedules(&self, query: ScheduleQuery) -> AppResult<(Vec<Schedule>, u64)> {
        self.database.list_schedules(query).await
    }

    pub async fn create_schedule(&self, draft: ScheduleDraft) -> AppResult<Schedule> {
        let schedule = self.database.create_schedule(draft).await?;
        self.record_event("info", "schedule", "created", None).await;
        Ok(schedule)
    }

    pub async fn ticket_board(&self, board_id: Option<Uuid>) -> AppResult<TicketBoard> {
        match board_id {
            Some(board_id) => self.database.ticket_board(board_id).await,
            None => self.database.default_ticket_board().await,
        }
    }

    pub async fn list_tickets(&self, query: TicketQuery) -> AppResult<TicketPage> {
        self.database.list_tickets(query).await
    }

    pub async fn ticket(&self, id: Uuid) -> AppResult<Ticket> {
        self.database.ticket(id).await
    }

    pub async fn create_ticket(&self, operation_id: Uuid, draft: TicketDraft) -> AppResult<Ticket> {
        self.database
            .create_ticket(operation_id, draft, self.clock.now())
            .await
    }

    pub async fn update_ticket(
        &self,
        operation_id: Uuid,
        id: Uuid,
        expected_version: u64,
        patch: TicketPatch,
    ) -> AppResult<Ticket> {
        self.database
            .update_ticket(operation_id, id, expected_version, patch, self.clock.now())
            .await
    }

    pub async fn move_ticket(
        &self,
        operation_id: Uuid,
        id: Uuid,
        expected_version: u64,
        target_column_id: Uuid,
        before_ticket_id: Option<Uuid>,
    ) -> AppResult<Ticket> {
        self.database
            .move_ticket(
                operation_id,
                id,
                expected_version,
                target_column_id,
                before_ticket_id,
                self.clock.now(),
            )
            .await
    }

    pub async fn reopen_ticket(
        &self,
        operation_id: Uuid,
        id: Uuid,
        expected_version: u64,
    ) -> AppResult<Ticket> {
        self.database
            .reopen_ticket(operation_id, id, expected_version, self.clock.now())
            .await
    }

    pub async fn archive_ticket(
        &self,
        operation_id: Uuid,
        id: Uuid,
        expected_version: u64,
        archived: bool,
    ) -> AppResult<Ticket> {
        self.database
            .set_ticket_archived(
                operation_id,
                id,
                expected_version,
                archived,
                self.clock.now(),
            )
            .await
    }

    pub async fn delete_ticket(
        &self,
        operation_id: Uuid,
        id: Uuid,
        expected_version: u64,
    ) -> AppResult<Ticket> {
        self.database
            .delete_ticket(operation_id, id, expected_version, self.clock.now())
            .await
    }

    pub async fn ticket_history(
        &self,
        ticket_id: Uuid,
        limit: u32,
    ) -> AppResult<Vec<TicketHistoryItem>> {
        self.database.ticket_history(ticket_id, limit).await
    }

    pub async fn assign_ticket_schedule(
        &self,
        mut request: AssignTicketScheduleRequest,
    ) -> AppResult<TicketScheduleLink> {
        request.validate()?;
        let resolution = resolve_local_time(&request.local_start, &request.timezone_id)?;
        let start_utc = match resolution.candidates.as_slice() {
            [] => {
                return Err(AppError::Validation {
                    message: "このローカル時刻は夏時間の切り替えで存在しません。".into(),
                    recovery: "前後の有効な時刻を選び直してください。自動補正は行いません。".into(),
                });
            }
            [single] => {
                if request.offset_choice.is_some() {
                    return Err(AppError::Validation {
                        message: "この時刻に重複候補の指定は不要です。".into(),
                        recovery: "時刻を再確認して保存してください。".into(),
                    });
                }
                *single
            }
            candidates => {
                let choice = request.offset_choice.ok_or_else(|| AppError::Validation {
                    message: "このローカル時刻は2回存在します。".into(),
                    recovery: "早い方または遅い方のUTCオフセットを明示して選んでください。".into(),
                })?;
                *candidates
                    .get(usize::from(choice))
                    .ok_or_else(|| AppError::Validation {
                        message: "重複時刻の選択が正しくありません。".into(),
                        recovery: "表示された2つの候補から選び直してください。".into(),
                    })?
            }
        };
        let end_utc = start_utc + chrono::Duration::minutes(i64::from(request.duration_minutes));
        self.database
            .assign_ticket_to_new_schedule(&request, start_utc, end_utc, self.clock.now())
            .await
    }

    pub async fn link_ticket_schedule(
        &self,
        request: LinkTicketScheduleRequest,
    ) -> AppResult<TicketScheduleLink> {
        self.database
            .link_ticket_to_existing_schedule(&request, self.clock.now())
            .await
    }

    pub async fn unlink_ticket_schedule(
        &self,
        request: UnlinkTicketScheduleRequest,
    ) -> AppResult<TicketScheduleLink> {
        self.database
            .unlink_ticket_schedule(&request, self.clock.now())
            .await
    }

    pub async fn ticket_schedules(
        &self,
        ticket_id: Uuid,
        include_unlinked: bool,
    ) -> AppResult<Vec<TicketScheduleLink>> {
        self.database
            .ticket_schedules(ticket_id, include_unlinked)
            .await
    }

    pub async fn schedule_ticket_link(
        &self,
        schedule_id: Uuid,
    ) -> AppResult<Option<TicketScheduleLink>> {
        self.database.schedule_ticket_link(schedule_id).await
    }

    pub async fn ticket_planning_summaries(
        &self,
        ticket_ids: Vec<Uuid>,
    ) -> AppResult<Vec<TicketPlanningSummary>> {
        self.database
            .ticket_planning_summaries(&ticket_ids, self.clock.now())
            .await
    }

    #[cfg(feature = "e2e")]
    pub async fn create_read_only_schedule_fixture(
        &self,
        draft: ScheduleDraft,
    ) -> AppResult<Schedule> {
        self.database.create_read_only_schedule_fixture(draft).await
    }

    #[cfg(feature = "e2e")]
    pub async fn delete_schedule_fixtures(&self, ids: Vec<Uuid>) -> AppResult<u64> {
        self.database.delete_schedule_fixtures(ids).await
    }

    #[cfg(feature = "e2e")]
    pub async fn seed_google_calendar_recovery_fixture(&self) -> AppResult<()> {
        self.database.seed_google_calendar_recovery_fixture().await
    }

    pub async fn update_schedule(
        &self,
        id: Uuid,
        expected_version: u64,
        draft: ScheduleDraft,
        recurrence_scope: RecurrenceEditScope,
        occurrence_start_utc: Option<DateTime<Utc>>,
    ) -> AppResult<Schedule> {
        let schedule = self
            .database
            .update_schedule_scoped(
                id,
                expected_version,
                draft,
                recurrence_scope,
                occurrence_start_utc,
            )
            .await?;
        self.record_event("info", "schedule", "updated", None).await;
        Ok(schedule)
    }

    pub async fn bulk_classify_schedules(
        &self,
        ids: Vec<Uuid>,
        patch: ScheduleClassificationPatch,
    ) -> AppResult<ChangeResult> {
        let result = self.database.bulk_classify_schedules(ids, patch).await?;
        self.record_event("info", "schedule", "bulk-classified", None)
            .await;
        Ok(result)
    }

    pub async fn delete_schedule(
        &self,
        id: Uuid,
        expected_version: u64,
        recurrence_scope: RecurrenceEditScope,
        occurrence_start_utc: Option<DateTime<Utc>>,
    ) -> AppResult<ChangeResult> {
        let result = self
            .database
            .delete_schedule_scoped(id, expected_version, recurrence_scope, occurrence_start_utc)
            .await?;
        self.record_event("info", "schedule", "deleted", None).await;
        Ok(result)
    }

    pub async fn undo(&self) -> AppResult<ChangeResult> {
        let result = self.database.undo().await?;
        self.record_event("info", "history", "undo", None).await;
        Ok(result)
    }

    pub async fn redo(&self) -> AppResult<ChangeResult> {
        let result = self.database.redo().await?;
        self.record_event("info", "history", "redo", None).await;
        Ok(result)
    }

    pub async fn settings(&self) -> AppResult<Settings> {
        self.database.settings().await
    }

    pub fn default_settings(&self) -> Settings {
        Settings::default()
    }

    pub async fn window_always_on_top(&self, label: &str) -> AppResult<bool> {
        self.database.window_always_on_top(label).await
    }

    pub async fn save_window_always_on_top(&self, label: &str, value: bool) -> AppResult<()> {
        self.database.save_window_always_on_top(label, value).await
    }

    pub async fn save_settings(&self, settings: Settings) -> AppResult<Settings> {
        self.database.save_settings(&settings).await
    }

    pub async fn focus_command(
        &self,
        command: FocusCommand,
        linked_schedule_id: Option<Uuid>,
    ) -> AppResult<FocusState> {
        let now = self.clock.now();
        let settings = self.database.settings().await?;
        let current = self.reconcile_focus(now, &settings).await?;
        let current_phase = current
            .as_ref()
            .map_or(FocusPhase::Idle, |record| record.phase);
        if command == FocusCommand::Stop && current.is_none() {
            return Ok(FocusState::idle());
        }
        validate_focus_transition(current_phase, command)?;

        let updated = match (current, command) {
            (None, FocusCommand::Start) => {
                let record = FocusRecord {
                    id: Uuid::new_v4(),
                    schedule_item_id: linked_schedule_id,
                    phase: FocusPhase::Working,
                    previous_phase: None,
                    started_at: now,
                    accumulated_seconds: 0,
                    cycle: 0,
                };
                self.database.insert_focus(&record).await?;
                Some(record)
            }
            (Some(mut record), FocusCommand::Start) => {
                record.phase = FocusPhase::Working;
                record.previous_phase = None;
                record.started_at = now;
                record.accumulated_seconds = 0;
                self.database.update_focus(&record, "start", 0).await?;
                Some(record)
            }
            (Some(mut record), FocusCommand::Pause) => {
                let elapsed = self.focus_elapsed(&record, now).await;
                let segment_elapsed = elapsed.saturating_sub(record.accumulated_seconds);
                record.accumulated_seconds = elapsed;
                record.previous_phase = Some(record.phase);
                record.phase = FocusPhase::Paused;
                record.started_at = now;
                self.database
                    .update_focus(&record, "pause", segment_elapsed)
                    .await?;
                Some(record)
            }
            (Some(mut record), FocusCommand::Resume) => {
                record.phase = record.previous_phase.unwrap_or(FocusPhase::Working);
                record.previous_phase = None;
                record.started_at = now;
                self.database.update_focus(&record, "resume", 0).await?;
                Some(record)
            }
            (Some(record), FocusCommand::Stop) => {
                let elapsed = self.focus_elapsed(&record, now).await;
                let segment_elapsed = elapsed.saturating_sub(record.accumulated_seconds);
                self.database
                    .end_focus(record.id, now, segment_elapsed)
                    .await?;
                None
            }
            (Some(mut record), FocusCommand::Skip) if record.phase == FocusPhase::Working => {
                let elapsed = self.focus_elapsed(&record, now).await;
                let segment_elapsed = elapsed.saturating_sub(record.accumulated_seconds);
                record.phase = FocusPhase::Break;
                record.previous_phase = None;
                record.started_at = now;
                record.accumulated_seconds = 0;
                self.database
                    .update_focus(&record, "skip", segment_elapsed)
                    .await?;
                Some(record)
            }
            (Some(mut record), FocusCommand::Skip) => {
                let elapsed = self.focus_elapsed(&record, now).await;
                let segment_elapsed = elapsed.saturating_sub(record.accumulated_seconds);
                record.phase = FocusPhase::WaitingNext;
                record.previous_phase = None;
                record.started_at = now;
                record.accumulated_seconds = 0;
                record.cycle = record.cycle.saturating_add(1);
                self.database
                    .update_focus(&record, "skip", segment_elapsed)
                    .await?;
                Some(record)
            }
            _ => {
                return Err(AppError::Conflict {
                    message: "Focus状態が変更されました。".into(),
                    recovery: "最新の状態を確認してから操作し直してください。".into(),
                });
            }
        };
        self.reset_focus_runtime().await;
        let state = if let Some(record) = updated.as_ref() {
            let elapsed = self.focus_elapsed(record, now).await;
            focus_state_from_record(record, &settings, now, elapsed)
        } else {
            FocusState::idle()
        };
        self.record_event("info", "focus", command.as_str(), None)
            .await;
        Ok(state)
    }

    async fn focus_state(&self, settings: &Settings) -> AppResult<FocusState> {
        let now = self.clock.now();
        let Some(record) = self.reconcile_focus(now, settings).await? else {
            return Ok(FocusState::idle());
        };
        let elapsed = self.focus_elapsed(&record, now).await;
        Ok(focus_state_from_record(&record, settings, now, elapsed))
    }

    pub async fn current_focus(&self) -> AppResult<FocusState> {
        let settings = self.database.settings().await?;
        self.focus_state(&settings).await
    }

    pub async fn focus_history_today(&self) -> AppResult<FocusHistoryReport> {
        let timezone_id = iana_time_zone::get_timezone()
            .ok()
            .filter(|value| value.parse::<Tz>().is_ok())
            .unwrap_or_else(|| "UTC".into());
        let timezone = timezone_id.parse::<Tz>().unwrap_or(chrono_tz::UTC);
        let today = self.clock.now().with_timezone(&timezone).date_naive();
        let start =
            match timezone.from_local_datetime(&today.and_hms_opt(0, 0, 0).ok_or_else(|| {
                AppError::Validation {
                    message: "今日の開始時刻を計算できませんでした。".into(),
                    recovery: "システムの日時設定を確認してください。".into(),
                }
            })?) {
                LocalResult::Single(value) => value.with_timezone(&Utc),
                _ => {
                    return Err(AppError::Validation {
                        message: "今日の開始時刻がDST境界で曖昧です。".into(),
                        recovery: "システムのタイムゾーンを確認してください。".into(),
                    });
                }
            };
        let tomorrow = today.succ_opt().ok_or_else(|| AppError::Validation {
            message: "翌日を計算できませんでした。".into(),
            recovery: "システムの日付設定を確認してください。".into(),
        })?;
        let end =
            match timezone.from_local_datetime(&tomorrow.and_hms_opt(0, 0, 0).ok_or_else(|| {
                AppError::Validation {
                    message: "翌日の開始時刻を計算できませんでした。".into(),
                    recovery: "システムの日時設定を確認してください。".into(),
                }
            })?) {
                LocalResult::Single(value) => value.with_timezone(&Utc),
                _ => {
                    return Err(AppError::Validation {
                        message: "翌日の開始時刻がDST境界で曖昧です。".into(),
                        recovery: "システムのタイムゾーンを確認してください。".into(),
                    });
                }
            };
        self.database.focus_history(start, end).await
    }

    pub async fn focus_work_seconds(&self, schedule_item_id: Uuid) -> AppResult<u64> {
        self.database.focus_work_seconds(schedule_item_id).await
    }

    async fn reconcile_focus(
        &self,
        now: DateTime<Utc>,
        settings: &Settings,
    ) -> AppResult<Option<FocusRecord>> {
        let Some(mut record) = self.database.active_focus().await? else {
            self.reset_focus_runtime().await;
            return Ok(None);
        };
        let elapsed = self.focus_elapsed(&record, now).await;
        let Some(duration_seconds) = focus_duration_seconds(&record, settings) else {
            return Ok(Some(record));
        };
        if elapsed < duration_seconds {
            return Ok(Some(record));
        }
        let segment_elapsed = elapsed.saturating_sub(record.accumulated_seconds);
        match record.phase {
            FocusPhase::Working => {
                record.phase = FocusPhase::Break;
                record.started_at = now;
                record.accumulated_seconds = 0;
            }
            FocusPhase::Break => {
                record.phase = if settings.focus_auto_start {
                    FocusPhase::Working
                } else {
                    FocusPhase::WaitingNext
                };
                record.started_at = now;
                record.accumulated_seconds = 0;
                record.cycle = record.cycle.saturating_add(1);
            }
            _ => return Ok(Some(record)),
        }
        self.database
            .update_focus(
                &record,
                if record.phase == FocusPhase::Break {
                    "work_end"
                } else {
                    "break_end"
                },
                segment_elapsed,
            )
            .await?;
        self.reset_focus_runtime().await;
        Ok(Some(record))
    }

    async fn focus_elapsed(&self, record: &FocusRecord, wall_now: DateTime<Utc>) -> u64 {
        if !matches!(record.phase, FocusPhase::Working | FocusPhase::Break) {
            return record.accumulated_seconds;
        }
        let monotonic_now = self.clock.monotonic();
        let mut runtime = self.focus_runtime.lock().await;
        if let Some(active) = runtime.as_ref()
            && active.session_id == record.id
            && active.phase == record.phase
        {
            return active.elapsed_at_anchor.saturating_add(
                monotonic_now
                    .saturating_sub(active.monotonic_anchor)
                    .as_secs(),
            );
        }

        // A newly observed session may have survived an application restart. Recover that one
        // segment from persisted wall time, then use the process monotonic clock exclusively.
        let recovered_segment = wall_now
            .signed_duration_since(record.started_at)
            .num_seconds()
            .max(0) as u64;
        let elapsed = record.accumulated_seconds.saturating_add(recovered_segment);
        *runtime = Some(FocusRuntime {
            session_id: record.id,
            phase: record.phase,
            monotonic_anchor: monotonic_now,
            elapsed_at_anchor: elapsed,
        });
        elapsed
    }

    async fn reset_focus_runtime(&self) {
        *self.focus_runtime.lock().await = None;
    }

    pub async fn timers(&self) -> AppResult<Vec<TimerState>> {
        let _guard = self.timer_gate.lock().await;
        self.timer_states_locked().await
    }

    async fn timer_states_locked(&self) -> AppResult<Vec<TimerState>> {
        let now = self.clock.now();
        let records = self.database.timer_records().await?;
        let mut states = Vec::with_capacity(records.len());
        for record in records {
            let elapsed = self.timer_elapsed(&record, now).await;
            if record.status == TimerStatus::Running && elapsed >= record.duration_seconds {
                let completed = self
                    .database
                    .complete_timer(&record, record.version, now)
                    .await?;
                self.timer_runtime.lock().await.remove(&record.id);
                states.push(timer_state_from_record(
                    &completed,
                    completed.duration_seconds,
                ));
            } else {
                states.push(timer_state_from_record(&record, elapsed));
            }
        }
        Ok(states)
    }

    pub async fn create_timer(&self, draft: TimerDraft) -> AppResult<TimerState> {
        let _guard = self.timer_gate.lock().await;
        let record = self.database.create_timer(draft).await?;
        self.record_event("info", "timer", "created", None).await;
        Ok(timer_state_from_record(&record, 0))
    }

    pub async fn update_timer(
        &self,
        id: Uuid,
        expected_version: u64,
        draft: TimerDraft,
    ) -> AppResult<TimerState> {
        let _guard = self.timer_gate.lock().await;
        let record = self
            .database
            .update_timer_config(id, expected_version, draft)
            .await?;
        self.timer_runtime.lock().await.remove(&id);
        self.record_event("info", "timer", "updated", None).await;
        Ok(timer_state_from_record(&record, 0))
    }

    pub async fn delete_timer(&self, id: Uuid, expected_version: u64) -> AppResult<()> {
        let _guard = self.timer_gate.lock().await;
        self.database.delete_timer(id, expected_version).await?;
        self.timer_runtime.lock().await.remove(&id);
        self.record_event("info", "timer", "deleted", None).await;
        Ok(())
    }

    pub async fn timer_command(
        &self,
        id: Uuid,
        expected_version: u64,
        command: TimerCommand,
    ) -> AppResult<TimerState> {
        let _guard = self.timer_gate.lock().await;
        let now = self.clock.now();
        let mut record = self.database.timer_record(id).await?;
        if record.version != expected_version {
            return Err(AppError::Conflict {
                message: "タイマーが別の操作で更新されました。".into(),
                recovery: "最新の状態を確認してから操作し直してください。".into(),
            });
        }
        validate_timer_transition(record.status, command)?;
        match command {
            TimerCommand::Start => {
                record.status = TimerStatus::Running;
                record.started_at = Some(now);
                record.elapsed_before_start_seconds = 0;
                record.run_id = Some(Uuid::new_v4());
            }
            TimerCommand::Pause => {
                record.elapsed_before_start_seconds = self
                    .timer_elapsed(&record, now)
                    .await
                    .min(record.duration_seconds);
                record.status = TimerStatus::Paused;
                record.started_at = None;
            }
            TimerCommand::Resume => {
                if record.run_id.is_none() {
                    return Err(AppError::database(
                        "timer-resume-run",
                        "paused timer has no run id",
                    ));
                }
                record.status = TimerStatus::Running;
                record.started_at = Some(now);
            }
            TimerCommand::Reset => {
                record.status = TimerStatus::Idle;
                record.started_at = None;
                record.elapsed_before_start_seconds = 0;
                record.run_id = None;
            }
        }
        let saved = self
            .database
            .save_timer_record(&record, expected_version)
            .await?;
        self.timer_runtime.lock().await.remove(&id);
        let elapsed = self.timer_elapsed(&saved, now).await;
        self.record_event("info", "timer", command.as_str(), None)
            .await;
        Ok(timer_state_from_record(&saved, elapsed))
    }

    async fn timer_elapsed(&self, record: &TimerRecord, wall_now: DateTime<Utc>) -> u64 {
        if record.status != TimerStatus::Running {
            return record.elapsed_before_start_seconds;
        }
        let Some(run_id) = record.run_id else {
            return record.elapsed_before_start_seconds;
        };
        let monotonic_now = self.clock.monotonic();
        let mut runtimes = self.timer_runtime.lock().await;
        if let Some(active) = runtimes.get(&record.id)
            && active.run_id == run_id
        {
            return active.elapsed_at_anchor.saturating_add(
                monotonic_now
                    .saturating_sub(active.monotonic_anchor)
                    .as_secs(),
            );
        }
        let recovered_segment = record
            .started_at
            .map(|started| wall_now.signed_duration_since(started).num_seconds().max(0) as u64)
            .unwrap_or(0);
        let elapsed = record
            .elapsed_before_start_seconds
            .saturating_add(recovered_segment);
        runtimes.insert(
            record.id,
            TimerRuntime {
                run_id,
                monotonic_anchor: monotonic_now,
                elapsed_at_anchor: elapsed,
            },
        );
        elapsed
    }

    pub async fn timer_sets(&self) -> AppResult<Vec<TimerSet>> {
        self.database.list_timer_sets().await
    }

    pub async fn save_timer_set(&self, name: String) -> AppResult<TimerSet> {
        let _guard = self.timer_gate.lock().await;
        let set = self.database.save_current_timers_as_set(name).await?;
        self.record_event("info", "timer-set", "created", None)
            .await;
        Ok(set)
    }

    pub async fn apply_timer_set(
        &self,
        id: Uuid,
        expected_version: u64,
    ) -> AppResult<Vec<TimerState>> {
        let _guard = self.timer_gate.lock().await;
        let records = self.database.apply_timer_set(id, expected_version).await?;
        self.record_event("info", "timer-set", "applied", None)
            .await;
        Ok(records
            .iter()
            .map(|record| timer_state_from_record(record, 0))
            .collect())
    }

    pub async fn delete_timer_set(&self, id: Uuid, expected_version: u64) -> AppResult<()> {
        let _guard = self.timer_gate.lock().await;
        self.database.delete_timer_set(id, expected_version).await?;
        self.record_event("info", "timer-set", "deleted", None)
            .await;
        Ok(())
    }

    pub async fn stopwatch(&self) -> AppResult<StopwatchState> {
        let _guard = self.timer_gate.lock().await;
        let record = self.database.stopwatch_record().await?;
        let elapsed = self.stopwatch_elapsed(&record, self.clock.now()).await;
        Ok(stopwatch_state_from_record(&record, elapsed))
    }

    pub async fn stopwatch_command(
        &self,
        expected_version: u64,
        command: StopwatchCommand,
    ) -> AppResult<StopwatchState> {
        let _guard = self.timer_gate.lock().await;
        let now = self.clock.now();
        let mut record = self.database.stopwatch_record().await?;
        if record.version != expected_version {
            return Err(AppError::Conflict {
                message: "ストップウォッチが別の操作で更新されました。".into(),
                recovery: "最新の状態を確認してから操作し直してください。".into(),
            });
        }
        validate_stopwatch_transition(record.status, command)?;
        match command {
            StopwatchCommand::Start => {
                record.status = StopwatchStatus::Running;
                record.started_at = Some(now);
                record.elapsed_before_start_seconds = 0;
            }
            StopwatchCommand::Pause => {
                record.elapsed_before_start_seconds = self.stopwatch_elapsed(&record, now).await;
                record.status = StopwatchStatus::Paused;
                record.started_at = None;
            }
            StopwatchCommand::Resume => {
                record.status = StopwatchStatus::Running;
                record.started_at = Some(now);
            }
            StopwatchCommand::Reset => {
                record.status = StopwatchStatus::Idle;
                record.started_at = None;
                record.elapsed_before_start_seconds = 0;
            }
        }
        let saved = self
            .database
            .save_stopwatch_record(&record, expected_version)
            .await?;
        *self.stopwatch_runtime.lock().await = None;
        let elapsed = self.stopwatch_elapsed(&saved, now).await;
        Ok(stopwatch_state_from_record(&saved, elapsed))
    }

    async fn stopwatch_elapsed(&self, record: &StopwatchRecord, wall_now: DateTime<Utc>) -> u64 {
        if record.status != StopwatchStatus::Running {
            return record.elapsed_before_start_seconds;
        }
        let monotonic_now = self.clock.monotonic();
        let mut runtime = self.stopwatch_runtime.lock().await;
        if let Some(active) = runtime.as_ref()
            && active.version == record.version
        {
            return active.elapsed_at_anchor.saturating_add(
                monotonic_now
                    .saturating_sub(active.monotonic_anchor)
                    .as_secs(),
            );
        }
        let recovered_segment = record
            .started_at
            .map(|started| wall_now.signed_duration_since(started).num_seconds().max(0) as u64)
            .unwrap_or(0);
        let elapsed = record
            .elapsed_before_start_seconds
            .saturating_add(recovered_segment);
        *runtime = Some(StopwatchRuntime {
            version: record.version,
            monotonic_anchor: monotonic_now,
            elapsed_at_anchor: elapsed,
        });
        elapsed
    }

    pub async fn run_sync(&self, operation_id: Uuid) -> AppResult<SyncSummary> {
        let cancellation = self.operations.begin(operation_id).await?;
        let result = async {
            let Ok(_guard) = self.sync_gate.try_lock() else {
                return Err(AppError::Conflict {
                    message: "別のGoogle同期が進行中です。".into(),
                    recovery:
                        "進行中の同期が完了するまで待つか、データと診断から同期を取り消してください。"
                            .into(),
                });
            };
            cancellation.check()?;
            let summary = self.database.sync_summary().await?;
            if summary.state == SyncSummaryState::Disconnected {
                return Ok(summary);
            }
            self.database.run_google_sync(&cancellation).await
        }
        .await;
        self.operations.finish(operation_id).await;
        result
    }

    pub async fn sync_queue(&self) -> AppResult<Vec<SyncQueueItem>> {
        self.database.sync_queue_items().await
    }

    pub async fn retry_sync_queue(&self, id: Option<Uuid>) -> AppResult<u64> {
        self.database.retry_sync_queue(id).await
    }

    pub async fn sync_conflicts(&self) -> AppResult<Vec<SyncConflictItem>> {
        self.database.sync_conflicts().await
    }

    pub async fn resolve_sync_conflict(
        &self,
        id: Uuid,
        choices: Vec<ConflictChoice>,
    ) -> AppResult<Schedule> {
        self.database.resolve_sync_conflict(id, choices).await
    }

    pub async fn diagnostics(&self) -> AppResult<DiagnosticsSnapshot> {
        self.database.diagnostics(env!("CARGO_PKG_VERSION")).await
    }

    pub async fn export_diagnostics(
        &self,
        path: &Path,
        webview: &str,
    ) -> AppResult<DiagnosticsExportResult> {
        let result = self
            .database
            .export_diagnostics(path, webview, env!("CARGO_PKG_VERSION"))
            .await?;
        self.record_event("info", "diagnostics", "exported", None)
            .await;
        Ok(result)
    }

    pub async fn export_data(&self, operation_id: Uuid, path: &Path) -> AppResult<ExportResult> {
        let cancellation = self.operations.begin(operation_id).await?;
        let timezone_id = iana_time_zone::get_timezone()
            .ok()
            .filter(|value| value.parse::<Tz>().is_ok())
            .unwrap_or_else(|| "UTC".into());
        let result = self
            .database
            .export_json_cancelable(path, &timezone_id, &cancellation)
            .await;
        self.operations.finish(operation_id).await;
        result
    }

    pub fn preview_import(&self, path: &Path) -> AppResult<ImportPreview> {
        Database::preview_import(path)
    }

    pub async fn import_data(
        &self,
        path: &Path,
        fingerprint: &str,
        mode: ImportMode,
    ) -> AppResult<ImportResult> {
        let _guard = self.timer_gate.lock().await;
        let result = self.database.import_json(path, fingerprint, mode).await?;
        self.timer_runtime.lock().await.clear();
        *self.stopwatch_runtime.lock().await = None;
        Ok(result)
    }

    pub async fn preview_legacy_import(&self, path: &Path) -> AppResult<LegacyImportPreview> {
        Database::preview_legacy_import(path).await
    }

    pub async fn import_legacy(
        &self,
        path: &Path,
        fingerprint: &str,
    ) -> AppResult<LegacyImportResult> {
        self.database.import_legacy(path, fingerprint).await
    }

    pub async fn create_backup(&self, operation_id: Uuid) -> AppResult<BackupRecord> {
        let cancellation = self.operations.begin(operation_id).await?;
        let result = self
            .database
            .create_backup_cancelable("daily", env!("CARGO_PKG_VERSION"), &cancellation)
            .await;
        self.operations.finish(operation_id).await;
        result
    }

    pub async fn cancel_operation(&self, operation_id: Uuid) -> bool {
        self.operations.cancel(operation_id).await
    }

    pub async fn backups(&self) -> AppResult<Vec<BackupRecord>> {
        self.database.list_backups().await
    }

    pub async fn stage_restore(&self, backup_id: Uuid) -> AppResult<RestoreStageResult> {
        self.database.stage_restore(backup_id).await
    }

    pub async fn poll_notifications(&self) -> AppResult<Vec<NotificationDelivery>> {
        self.timers().await?;
        self.database.poll_notifications(self.clock.now()).await
    }

    pub async fn notification_ledger(&self) -> AppResult<Vec<NotificationLedgerItem>> {
        self.database.notification_ledger().await
    }

    pub async fn record_notification_result(
        &self,
        delivery_key: &str,
        result: DeliveryResult,
        error_category: Option<&str>,
    ) -> AppResult<()> {
        self.database
            .record_notification_result(delivery_key, result, error_category)
            .await
    }

    pub async fn import_google_config(&self, path: &Path) -> AppResult<OAuthConfigResult> {
        self.database.import_google_oauth_config(path).await
    }

    pub async fn begin_google_oauth(&self) -> AppResult<OAuthBeginResult> {
        self.database.begin_google_oauth().await
    }

    pub fn cancel_google_oauth_attempt(&self) {
        self.database.cancel_google_oauth_attempt();
    }

    pub async fn google_connection(&self) -> AppResult<GoogleConnection> {
        self.database.google_connection().await
    }

    pub async fn update_google_calendar(
        &self,
        id: Uuid,
        selected: bool,
        default_write_target: bool,
    ) -> AppResult<GoogleCalendar> {
        self.database
            .update_google_calendar(id, selected, default_write_target)
            .await
    }

    pub async fn disconnect_google(&self, mode: DisconnectMode) -> AppResult<u64> {
        self.database.disconnect_google(mode).await
    }

    pub async fn delete_all_user_data(&self, confirmation: &str) -> AppResult<u64> {
        if confirmation != "すべてのローカルデータを削除" {
            return Err(AppError::Validation {
                message: "確認文が一致しないため、データは削除していません。".into(),
                recovery: "画面に表示された確認文を正確に入力するか、操作を取り消してください。"
                    .into(),
            });
        }
        let _guard = self.timer_gate.lock().await;
        self.database.delete_google_secrets().await?;
        let deleted = self.database.delete_all_user_data().await?;
        self.timer_runtime.lock().await.clear();
        *self.stopwatch_runtime.lock().await = None;
        Ok(deleted)
    }

    pub async fn templates(&self) -> AppResult<Vec<DayTemplate>> {
        self.database.list_templates().await
    }

    pub async fn save_template(
        &self,
        id: Option<Uuid>,
        expected_version: Option<u64>,
        draft: DayTemplateDraft,
    ) -> AppResult<DayTemplate> {
        self.database
            .save_template(id, expected_version, draft)
            .await
    }

    pub async fn delete_template(&self, id: Uuid, expected_version: u64) -> AppResult<()> {
        self.database.delete_template(id, expected_version).await
    }

    pub async fn reorder_templates(&self, ids: &[Uuid]) -> AppResult<()> {
        self.database.reorder_templates(ids).await
    }

    pub async fn quick_blocks(&self) -> AppResult<Vec<QuickBlock>> {
        self.database.list_quick_blocks().await
    }

    pub async fn save_quick_block(
        &self,
        id: Option<Uuid>,
        expected_version: Option<u64>,
        draft: QuickBlockDraft,
    ) -> AppResult<QuickBlock> {
        self.database
            .save_quick_block(id, expected_version, draft)
            .await
    }

    pub async fn delete_quick_block(&self, id: Uuid, expected_version: u64) -> AppResult<()> {
        self.database.delete_quick_block(id, expected_version).await
    }

    pub async fn reorder_quick_blocks(&self, ids: &[Uuid]) -> AppResult<()> {
        self.database.reorder_quick_blocks(ids).await
    }

    pub async fn free_alarms(&self) -> AppResult<Vec<FreeAlarm>> {
        self.database.list_free_alarms().await
    }

    pub async fn save_free_alarm(
        &self,
        id: Option<Uuid>,
        expected_version: Option<u64>,
        draft: FreeAlarmDraft,
    ) -> AppResult<FreeAlarm> {
        self.database
            .save_free_alarm(id, expected_version, draft)
            .await
    }

    pub async fn delete_free_alarm(&self, id: Uuid, expected_version: u64) -> AppResult<()> {
        self.database.delete_free_alarm(id, expected_version).await
    }

    pub async fn reorder_free_alarms(&self, ids: &[Uuid]) -> AppResult<()> {
        self.database.reorder_free_alarms(ids).await
    }

    pub async fn preview_template(
        &self,
        template_id: Uuid,
        date: NaiveDate,
        timezone_id: &str,
    ) -> AppResult<TemplatePreview> {
        self.database
            .preview_template(template_id, date, timezone_id)
            .await
    }

    pub async fn apply_template(
        &self,
        template_id: Uuid,
        date: NaiveDate,
        timezone_id: &str,
        mode: TemplateApplyMode,
    ) -> AppResult<ChangeResult> {
        self.database
            .apply_template(template_id, date, timezone_id, mode)
            .await
    }

    async fn record_event(
        &self,
        level: &'static str,
        category: &'static str,
        event: &'static str,
        diagnostic_id: Option<&str>,
    ) {
        if let Err(error) = self
            .database
            .record_diagnostic_event(level, category, event, diagnostic_id)
            .await
        {
            tracing::warn!(error = %error, category, event, "structured diagnostic event could not be persisted");
        }
    }
}

fn focus_duration_seconds(record: &FocusRecord, settings: &Settings) -> Option<u64> {
    let minutes = if record.phase == FocusPhase::Working {
        settings.focus_work_minutes
    } else if record.phase == FocusPhase::Break
        && (record.cycle + 1).is_multiple_of(u32::from(settings.focus_long_break_every))
    {
        settings.focus_long_break_minutes
    } else if record.phase == FocusPhase::Break {
        settings.focus_break_minutes
    } else {
        return None;
    };
    Some(u64::from(minutes) * 60)
}

fn focus_state_from_record(
    record: &FocusRecord,
    settings: &Settings,
    wall_now: DateTime<Utc>,
    elapsed_seconds: u64,
) -> FocusState {
    let ends_at = focus_duration_seconds(record, settings).map(|duration| {
        wall_now + chrono::Duration::seconds(duration.saturating_sub(elapsed_seconds) as i64)
    });
    FocusState {
        phase: record.phase,
        started_at: Some(record.started_at),
        ends_at,
        accumulated_seconds: elapsed_seconds,
        cycle: record.cycle,
        linked_schedule_id: record.schedule_item_id,
    }
}

fn timer_state_from_record(record: &TimerRecord, elapsed_seconds: u64) -> TimerState {
    let elapsed_seconds = elapsed_seconds.min(record.duration_seconds);
    TimerState {
        id: record.id,
        label: record.label.clone(),
        duration_seconds: record.duration_seconds,
        status: record.status,
        elapsed_seconds,
        remaining_seconds: record.duration_seconds.saturating_sub(elapsed_seconds),
        version: record.version,
    }
}

fn stopwatch_state_from_record(record: &StopwatchRecord, elapsed_seconds: u64) -> StopwatchState {
    StopwatchState {
        status: record.status,
        elapsed_seconds,
        version: record.version,
    }
}

#[cfg(test)]
mod tests {
    use std::sync::Mutex as StdMutex;

    use crate::domain::{TicketColumnKind, TicketPriority, TicketScheduleSource};
    use chrono::{Duration, TimeZone};

    use super::*;

    struct ManualClock {
        wall: StdMutex<DateTime<Utc>>,
        monotonic: StdMutex<MonotonicDuration>,
    }

    impl ManualClock {
        fn new(wall: DateTime<Utc>) -> Self {
            Self {
                wall: StdMutex::new(wall),
                monotonic: StdMutex::new(MonotonicDuration::ZERO),
            }
        }

        fn shift_wall(&self, duration: Duration) {
            let mut wall = self.wall.lock().expect("manual wall clock lock");
            *wall += duration;
        }

        fn advance_monotonic(&self, duration: MonotonicDuration) {
            let mut monotonic = self.monotonic.lock().expect("manual monotonic clock lock");
            *monotonic += duration;
        }
    }

    impl Clock for ManualClock {
        fn now(&self) -> DateTime<Utc> {
            *self.wall.lock().expect("manual wall clock lock")
        }

        fn monotonic(&self) -> MonotonicDuration {
            *self.monotonic.lock().expect("manual monotonic clock lock")
        }
    }

    async fn create_test_ticket(database: &Database, now: DateTime<Utc>) -> Ticket {
        let board = database.default_ticket_board().await.unwrap();
        let inbox = board
            .columns
            .iter()
            .find(|column| column.kind == TicketColumnKind::Inbox)
            .unwrap();
        database
            .create_ticket(
                Uuid::new_v4(),
                TicketDraft {
                    board_id: board.id,
                    column_id: inbox.id,
                    parent_ticket_id: None,
                    title: "DSTを確認する".into(),
                    description: String::new(),
                    priority: TicketPriority::Normal,
                    due_date: None,
                    estimate_minutes: Some(30),
                    tags: Vec::new(),
                    checklist: Vec::new(),
                },
                now,
            )
            .await
            .unwrap()
    }

    #[tokio::test]
    async fn ticket_assignment_rejects_dst_gap_without_silent_shift() {
        let now = Utc.with_ymd_and_hms(2026, 3, 28, 12, 0, 0).unwrap();
        let database = Database::open_memory().await.unwrap();
        let ticket = create_test_ticket(&database, now).await;
        let service = AppService::with_clock(database, Arc::new(ManualClock::new(now)));
        let result = service
            .assign_ticket_schedule(AssignTicketScheduleRequest {
                operation_id: Uuid::new_v4(),
                ticket_id: ticket.id,
                expected_ticket_version: ticket.version,
                local_start: "2026-03-29T02:30".into(),
                duration_minutes: 30,
                timezone_id: "Europe/Berlin".into(),
                offset_choice: None,
                title_override: None,
                source: TicketScheduleSource::Board,
            })
            .await;
        assert!(matches!(result, Err(AppError::Validation { .. })));
    }

    #[tokio::test]
    async fn ticket_assignment_requires_and_honors_dst_overlap_choice() {
        let now = Utc.with_ymd_and_hms(2026, 10, 24, 12, 0, 0).unwrap();
        let database = Database::open_memory().await.unwrap();
        let ticket = create_test_ticket(&database, now).await;
        let service = AppService::with_clock(database, Arc::new(ManualClock::new(now)));
        let base = AssignTicketScheduleRequest {
            operation_id: Uuid::new_v4(),
            ticket_id: ticket.id,
            expected_ticket_version: ticket.version,
            local_start: "2026-10-25T02:30".into(),
            duration_minutes: 30,
            timezone_id: "Europe/Berlin".into(),
            offset_choice: None,
            title_override: None,
            source: TicketScheduleSource::TodayDrawer,
        };
        assert!(matches!(
            service.assign_ticket_schedule(base.clone()).await,
            Err(AppError::Validation { .. })
        ));
        let link = service
            .assign_ticket_schedule(AssignTicketScheduleRequest {
                operation_id: Uuid::new_v4(),
                offset_choice: Some(1),
                ..base
            })
            .await
            .unwrap();
        assert_eq!(
            link.schedule.draft.start_utc,
            Utc.with_ymd_and_hms(2026, 10, 25, 1, 30, 0).unwrap()
        );
    }

    #[tokio::test]
    async fn ticket_assignment_preserves_cross_midnight_instants_and_timezone() {
        let now = Utc.with_ymd_and_hms(2026, 8, 3, 0, 0, 0).unwrap();
        let database = Database::open_memory().await.unwrap();
        let ticket = create_test_ticket(&database, now).await;
        let service = AppService::with_clock(database, Arc::new(ManualClock::new(now)));
        let link = service
            .assign_ticket_schedule(AssignTicketScheduleRequest {
                operation_id: Uuid::new_v4(),
                ticket_id: ticket.id,
                expected_ticket_version: ticket.version,
                local_start: "2026-08-03T23:30".into(),
                duration_minutes: 120,
                timezone_id: "Asia/Tokyo".into(),
                offset_choice: None,
                title_override: None,
                source: TicketScheduleSource::Board,
            })
            .await
            .unwrap();
        assert_eq!(link.schedule.draft.timezone_id, "Asia/Tokyo");
        assert_eq!(
            link.schedule.draft.end_utc - link.schedule.draft.start_utc,
            Duration::minutes(120)
        );
        assert_eq!(
            link.schedule
                .draft
                .start_utc
                .with_timezone(&chrono_tz::Asia::Tokyo)
                .date_naive()
                .to_string(),
            "2026-08-03"
        );
        assert_eq!(
            link.schedule
                .draft
                .end_utc
                .with_timezone(&chrono_tz::Asia::Tokyo)
                .date_naive()
                .to_string(),
            "2026-08-04"
        );
    }

    #[tokio::test]
    async fn focus_elapsed_uses_monotonic_time_after_runtime_anchor() {
        let started = Utc.with_ymd_and_hms(2026, 7, 20, 3, 0, 0).unwrap();
        let database = Database::open_memory().await.unwrap();
        let clock = Arc::new(ManualClock::new(started));
        let service = AppService::with_clock(database.clone(), clock.clone());

        service
            .focus_command(FocusCommand::Start, None)
            .await
            .unwrap();
        clock.advance_monotonic(MonotonicDuration::from_secs(600));
        clock.shift_wall(Duration::hours(-1));

        let active = service.current_focus().await.unwrap();
        assert_eq!(active.phase, FocusPhase::Working);
        assert_eq!(active.accumulated_seconds, 600);
        assert_eq!(
            active.ends_at.unwrap().signed_duration_since(clock.now()),
            Duration::minutes(15)
        );

        service
            .focus_command(FocusCommand::Pause, None)
            .await
            .unwrap();
        let history = database
            .focus_history(started - Duration::hours(2), started + Duration::hours(2))
            .await
            .unwrap();
        assert_eq!(history.work_seconds, 600);
    }

    #[tokio::test]
    async fn multiple_timers_and_stopwatch_use_monotonic_time_after_anchor() {
        let started = Utc.with_ymd_and_hms(2026, 7, 20, 3, 0, 0).unwrap();
        let database = Database::open_memory().await.unwrap();
        let clock = Arc::new(ManualClock::new(started));
        let service = AppService::with_clock(database, clock.clone());
        let first = service
            .create_timer(TimerDraft {
                label: "紅茶".into(),
                duration_seconds: 120,
            })
            .await
            .unwrap();
        let second = service
            .create_timer(TimerDraft {
                label: "ストレッチ".into(),
                duration_seconds: 300,
            })
            .await
            .unwrap();
        service
            .timer_command(first.id, first.version, TimerCommand::Start)
            .await
            .unwrap();
        service
            .timer_command(second.id, second.version, TimerCommand::Start)
            .await
            .unwrap();
        let stopwatch = service.stopwatch().await.unwrap();
        service
            .stopwatch_command(stopwatch.version, StopwatchCommand::Start)
            .await
            .unwrap();

        clock.advance_monotonic(MonotonicDuration::from_secs(45));
        clock.shift_wall(Duration::hours(-1));

        let timers = service.timers().await.unwrap();
        assert_eq!(timers[0].remaining_seconds, 75);
        assert_eq!(timers[1].remaining_seconds, 255);
        assert_eq!(service.stopwatch().await.unwrap().elapsed_seconds, 45);
    }

    #[tokio::test]
    async fn timer_completion_is_persisted_once_after_restart_recovery() {
        let started = Utc.with_ymd_and_hms(2026, 7, 20, 3, 0, 0).unwrap();
        let database = Database::open_memory().await.unwrap();
        let first_clock = Arc::new(ManualClock::new(started));
        let first_service = AppService::with_clock(database.clone(), first_clock);
        let timer = first_service
            .create_timer(TimerDraft {
                label: "確認".into(),
                duration_seconds: 30,
            })
            .await
            .unwrap();
        first_service
            .timer_command(timer.id, timer.version, TimerCommand::Start)
            .await
            .unwrap();

        let restarted_clock = Arc::new(ManualClock::new(started + Duration::seconds(45)));
        let restarted = AppService::with_clock(database.clone(), restarted_clock);
        let completed = restarted.timers().await.unwrap();
        assert_eq!(completed[0].status, TimerStatus::Completed);
        assert_eq!(completed[0].remaining_seconds, 0);
        restarted.timers().await.unwrap();

        let completion_count: i64 =
            sqlx::query_scalar("SELECT COUNT(*) FROM timer_run_completions")
                .fetch_one(&database.pool)
                .await
                .unwrap();
        assert_eq!(completion_count, 1);
    }

    #[tokio::test]
    async fn concurrent_sync_is_not_reported_as_success() {
        let database = Database::open_memory().await.unwrap();
        let service = AppService::new_started_at(database, Instant::now());
        let _guard = service.sync_gate.lock().await;

        let result = service.run_sync(Uuid::new_v4()).await;

        assert!(matches!(result, Err(AppError::Conflict { .. })));
    }
}
