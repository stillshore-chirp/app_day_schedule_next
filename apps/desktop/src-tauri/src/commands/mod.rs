use std::{future::Future, path::PathBuf};

use chrono::{DateTime, NaiveDate, Utc};
use serde::{Deserialize, Serialize};
use tauri::{AppHandle, Manager, State, WebviewUrl, WebviewWindowBuilder};
use tauri_plugin_opener::OpenerExt;
use uuid::Uuid;

use crate::{
    application::{AppService, Bootstrap},
    domain::{
        AssignTicketScheduleRequest, DayTemplate, DayTemplateDraft, FocusCommand, FocusState,
        FreeAlarm, FreeAlarmDraft, GoogleTaskConflict, GoogleTaskList, GoogleTasksConnection,
        LinkTicketScheduleRequest, LocalTimeResolution, Priority, QuickBlock, QuickBlockDraft,
        RecurrenceEditScope, RecurrencePreview, Schedule, ScheduleClassificationPatch,
        ScheduleDraft, ScheduleQuery, ScheduleStatus, Settings, StopwatchCommand, StopwatchState,
        SyncStatus, SyncSummary, TemplateApplyMode, TemplatePreview, Ticket, TicketBoard,
        TicketDraft, TicketFocusHistoryItem, TicketGoogleTaskStatus, TicketHistoryItem, TicketPage,
        TicketPatch, TicketPlanningSummary, TicketQuery, TicketScheduleLink, TimerCommand,
        TimerDraft, TimerSet, TimerState, UnlinkTicketScheduleRequest, UserSafeError,
    },
    infrastructure::{
        BackupRecord, ChangeResult, ConflictChoice, DeliveryResult, DiagnosticsExportResult,
        DiagnosticsSnapshot, DisconnectMode, ExportResult, FocusHistoryReport, GoogleCalendar,
        GoogleConnection, GoogleTaskConflictResolveRequest, GoogleTaskListUpdate, ImportMode,
        ImportPreview, ImportResult, LegacyImportPreview, LegacyImportResult, NotificationDelivery,
        NotificationLedgerItem, OAuthConfigResult, RestoreStageResult, SyncConflictItem,
        SyncQueueItem, TicketGoogleTaskTargetUpdate,
    },
    square_window,
};

type CommandResult<T> = Result<T, UserSafeError>;

#[tauri::command]
pub fn performance_mark_ui_ready(service: State<'_, AppService>) -> u64 {
    service.mark_ui_ready()
}

#[derive(Debug, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct ScheduleQueryDto {
    start_utc: DateTime<Utc>,
    end_utc: DateTime<Utc>,
    search: Option<String>,
    #[serde(default)]
    include_deleted: bool,
    limit: Option<u32>,
    offset: Option<u32>,
    status: Option<ScheduleStatus>,
    project: Option<String>,
    category: Option<String>,
    tag: Option<String>,
    priority: Option<Priority>,
    sync_status: Option<SyncStatus>,
    sync_target: Option<String>,
    completion: Option<String>,
    sort_by: Option<String>,
    #[serde(default)]
    sort_descending: bool,
}

impl From<ScheduleQueryDto> for ScheduleQuery {
    fn from(value: ScheduleQueryDto) -> Self {
        Self {
            start_utc: value.start_utc,
            end_utc: value.end_utc,
            search: value.search,
            include_deleted: value.include_deleted,
            limit: value.limit.unwrap_or(500),
            offset: value.offset.unwrap_or(0),
            status: value.status,
            project: value.project,
            category: value.category,
            tag: value.tag,
            priority: value.priority,
            sync_status: value.sync_status,
            sync_target: value.sync_target,
            completion: value.completion.unwrap_or_else(|| "all".into()),
            sort_by: value.sort_by.unwrap_or_else(|| "start".into()),
            sort_descending: value.sort_descending,
        }
    }
}

#[derive(Debug, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct SchedulePage {
    items: Vec<Schedule>,
    total: u64,
}

#[derive(Debug, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct ScheduleUpdateDto {
    id: Uuid,
    expected_version: u64,
    draft: ScheduleDraft,
    #[serde(default)]
    recurrence_scope: RecurrenceEditScope,
    occurrence_start_utc: Option<DateTime<Utc>>,
}

#[derive(Debug, Deserialize)]
#[serde(rename_all = "camelCase", deny_unknown_fields)]
pub struct TicketCreateRequest {
    operation_id: Uuid,
    draft: TicketDraft,
}

#[derive(Debug, Deserialize)]
#[serde(rename_all = "camelCase", deny_unknown_fields)]
pub struct TicketUpdateRequest {
    operation_id: Uuid,
    id: Uuid,
    expected_version: u64,
    patch: TicketPatch,
}

#[derive(Debug, Deserialize)]
#[serde(rename_all = "camelCase", deny_unknown_fields)]
pub struct TicketMoveRequest {
    operation_id: Uuid,
    id: Uuid,
    expected_version: u64,
    target_column_id: Uuid,
    before_ticket_id: Option<Uuid>,
}

#[derive(Debug, Deserialize)]
#[serde(rename_all = "camelCase", deny_unknown_fields)]
pub struct TicketLifecycleRequest {
    operation_id: Uuid,
    id: Uuid,
    expected_version: u64,
}

#[derive(Debug, Deserialize)]
#[serde(rename_all = "camelCase", deny_unknown_fields)]
pub struct TicketArchiveRequest {
    operation_id: Uuid,
    id: Uuid,
    expected_version: u64,
    archived: bool,
}

#[derive(Debug, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct BulkClassifyRequest {
    ids: Vec<Uuid>,
    patch: ScheduleClassificationPatch,
}

#[derive(Debug, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct DeleteRequest {
    id: Uuid,
    expected_version: u64,
    #[serde(default)]
    recurrence_scope: RecurrenceEditScope,
    occurrence_start_utc: Option<DateTime<Utc>>,
}

#[derive(Debug, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct ReorderRequest {
    ids: Vec<Uuid>,
}

#[derive(Debug, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct FocusRequest {
    command: FocusCommand,
    linked_schedule_id: Option<Uuid>,
}

#[derive(Debug, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct FocusScheduleSummary {
    schedule_item_id: Uuid,
    work_seconds: u64,
}

#[derive(Debug, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct TimerUpdateRequest {
    id: Uuid,
    expected_version: u64,
    draft: TimerDraft,
}

#[derive(Debug, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct TimerCommandRequest {
    id: Uuid,
    expected_version: u64,
    command: TimerCommand,
}

#[derive(Debug, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct VersionRequest {
    id: Uuid,
    expected_version: u64,
}

#[derive(Debug, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct TimerSetCreateRequest {
    name: String,
}

#[derive(Debug, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct StopwatchCommandRequest {
    expected_version: u64,
    command: StopwatchCommand,
}

#[derive(Debug, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct VersionedSave<T> {
    id: Option<Uuid>,
    expected_version: Option<u64>,
    draft: T,
}

#[derive(Debug, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct TemplateTargetRequest {
    template_id: Uuid,
    date: NaiveDate,
    timezone_id: String,
    mode: Option<TemplateApplyMode>,
}

#[derive(Debug, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct WindowPreferenceRequest {
    label: String,
    always_on_top: bool,
}

#[derive(Debug, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct ImportCommitRequest {
    path: String,
    fingerprint: String,
    mode: ImportMode,
}

#[derive(Debug, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct LegacyImportCommitRequest {
    path: String,
    fingerprint: String,
}

#[derive(Debug, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct DiagnosticsExportRequest {
    path: String,
    webview: String,
}

#[derive(Debug, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct NotificationResultRequest {
    delivery_key: String,
    result: DeliveryResult,
    error_category: Option<String>,
}

#[derive(Debug, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct SyncRetryRequest {
    id: Option<Uuid>,
}

#[derive(Debug, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct OperationRequest {
    operation_id: Uuid,
}

#[derive(Debug, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct DataExportRequest {
    operation_id: Uuid,
    path: String,
}

#[derive(Debug, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct ConflictResolveRequest {
    id: Uuid,
    choices: Vec<ConflictChoice>,
}

#[derive(Debug, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct GoogleCalendarUpdateRequest {
    id: Uuid,
    selected: bool,
    default_write_target: bool,
}

#[derive(Debug, Deserialize)]
#[serde(rename_all = "camelCase", deny_unknown_fields)]
pub struct GoogleTasksEnableRequest {
    enabled: bool,
}

#[derive(Debug, Deserialize)]
#[serde(rename_all = "camelCase", deny_unknown_fields)]
pub struct TicketGoogleTaskStatusRequest {
    ticket_ids: Vec<Uuid>,
}

#[derive(Debug, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct OAuthLaunchResult {
    opened_in_system_browser: bool,
    expires_at: DateTime<Utc>,
}

#[derive(Debug, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct LocalTimeRequest {
    local: String,
    timezone_id: String,
}

#[derive(Debug, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct RecurrencePreviewRequest {
    start_utc: DateTime<Utc>,
    end_utc: DateTime<Utc>,
    timezone_id: String,
    recurrence_rule: String,
}

#[tauri::command]
pub fn time_local_resolve(request: LocalTimeRequest) -> CommandResult<LocalTimeResolution> {
    crate::domain::resolve_local_time(&request.local, &request.timezone_id).map_err(Into::into)
}

#[tauri::command]
pub fn recurrence_preview_get(
    request: RecurrencePreviewRequest,
) -> CommandResult<RecurrencePreview> {
    let mut draft = ScheduleDraft {
        title: "繰り返しプレビュー".into(),
        description: String::new(),
        location: String::new(),
        start_utc: request.start_utc,
        end_utc: request.end_utc,
        timezone_id: request.timezone_id,
        all_day: false,
        all_day_start_date: None,
        all_day_end_date_exclusive: None,
        status: ScheduleStatus::Scheduled,
        project: String::new(),
        category: String::new(),
        tags: Vec::new(),
        color: "#6F96F4".into(),
        priority: Priority::Normal,
        recurrence_rule: Some(request.recurrence_rule),
        recurrence_supplemental_lines: Vec::new(),
        recurrence_exdates: Vec::new(),
        start_notification_minutes: None,
        end_notification_minutes: None,
    };
    draft.validate().map_err(UserSafeError::from)?;
    crate::domain::recurrence_preview(
        &Schedule {
            id: Uuid::nil(),
            draft,
            sync_status: SyncStatus::LocalOnly,
            version: 0,
            deleted_at: None,
        },
        10,
    )
    .map_err(Into::into)
}

#[tauri::command]
pub async fn bootstrap_get(service: State<'_, AppService>) -> CommandResult<Bootstrap> {
    service.bootstrap().await.map_err(Into::into)
}

#[tauri::command]
pub async fn schedule_list(
    service: State<'_, AppService>,
    query: ScheduleQueryDto,
) -> CommandResult<SchedulePage> {
    let (items, total) = service
        .list_schedules(query.into())
        .await
        .map_err(UserSafeError::from)?;
    Ok(SchedulePage { items, total })
}

#[tauri::command]
pub async fn ticket_board_get(
    service: State<'_, AppService>,
    board_id: Option<Uuid>,
) -> CommandResult<TicketBoard> {
    service.ticket_board(board_id).await.map_err(Into::into)
}

#[tauri::command]
pub async fn ticket_list(
    service: State<'_, AppService>,
    query: TicketQuery,
) -> CommandResult<TicketPage> {
    service.list_tickets(query).await.map_err(Into::into)
}

#[tauri::command]
pub async fn ticket_get(service: State<'_, AppService>, id: Uuid) -> CommandResult<Ticket> {
    service.ticket(id).await.map_err(Into::into)
}

#[tauri::command]
pub async fn ticket_create(
    service: State<'_, AppService>,
    request: TicketCreateRequest,
) -> CommandResult<Ticket> {
    service
        .create_ticket(request.operation_id, request.draft)
        .await
        .map_err(Into::into)
}

#[tauri::command]
pub async fn ticket_update(
    service: State<'_, AppService>,
    request: TicketUpdateRequest,
) -> CommandResult<Ticket> {
    service
        .update_ticket(
            request.operation_id,
            request.id,
            request.expected_version,
            request.patch,
        )
        .await
        .map_err(Into::into)
}

#[tauri::command]
pub async fn ticket_move(
    service: State<'_, AppService>,
    request: TicketMoveRequest,
) -> CommandResult<Ticket> {
    service
        .move_ticket(
            request.operation_id,
            request.id,
            request.expected_version,
            request.target_column_id,
            request.before_ticket_id,
        )
        .await
        .map_err(Into::into)
}

#[tauri::command]
pub async fn ticket_reopen(
    service: State<'_, AppService>,
    request: TicketLifecycleRequest,
) -> CommandResult<Ticket> {
    service
        .reopen_ticket(request.operation_id, request.id, request.expected_version)
        .await
        .map_err(Into::into)
}

#[tauri::command]
pub async fn ticket_archive(
    service: State<'_, AppService>,
    request: TicketArchiveRequest,
) -> CommandResult<Ticket> {
    service
        .archive_ticket(
            request.operation_id,
            request.id,
            request.expected_version,
            request.archived,
        )
        .await
        .map_err(Into::into)
}

#[tauri::command]
pub async fn ticket_delete(
    service: State<'_, AppService>,
    request: TicketLifecycleRequest,
) -> CommandResult<Ticket> {
    service
        .delete_ticket(request.operation_id, request.id, request.expected_version)
        .await
        .map_err(Into::into)
}

#[tauri::command]
pub async fn ticket_history_list(
    service: State<'_, AppService>,
    ticket_id: Uuid,
    limit: Option<u32>,
) -> CommandResult<Vec<TicketHistoryItem>> {
    service
        .ticket_history(ticket_id, limit.unwrap_or(100))
        .await
        .map_err(Into::into)
}

#[tauri::command]
pub async fn ticket_schedule_assign(
    service: State<'_, AppService>,
    request: AssignTicketScheduleRequest,
) -> CommandResult<TicketScheduleLink> {
    service
        .assign_ticket_schedule(request)
        .await
        .map_err(Into::into)
}

#[tauri::command]
pub async fn ticket_schedule_link(
    service: State<'_, AppService>,
    request: LinkTicketScheduleRequest,
) -> CommandResult<TicketScheduleLink> {
    service
        .link_ticket_schedule(request)
        .await
        .map_err(Into::into)
}

#[tauri::command]
pub async fn ticket_schedule_unlink(
    service: State<'_, AppService>,
    request: UnlinkTicketScheduleRequest,
) -> CommandResult<TicketScheduleLink> {
    service
        .unlink_ticket_schedule(request)
        .await
        .map_err(Into::into)
}

#[tauri::command]
pub async fn ticket_schedule_list(
    service: State<'_, AppService>,
    ticket_id: Uuid,
    include_unlinked: Option<bool>,
) -> CommandResult<Vec<TicketScheduleLink>> {
    service
        .ticket_schedules(ticket_id, include_unlinked.unwrap_or(false))
        .await
        .map_err(Into::into)
}

#[tauri::command]
pub async fn schedule_ticket_link_get(
    service: State<'_, AppService>,
    schedule_id: Uuid,
) -> CommandResult<Option<TicketScheduleLink>> {
    service
        .schedule_ticket_link(schedule_id)
        .await
        .map_err(Into::into)
}

#[tauri::command]
pub async fn ticket_planning_summaries_get(
    service: State<'_, AppService>,
    ticket_ids: Vec<Uuid>,
) -> CommandResult<Vec<TicketPlanningSummary>> {
    service
        .ticket_planning_summaries(ticket_ids)
        .await
        .map_err(Into::into)
}

#[tauri::command]
pub async fn ticket_focus_history_list(
    service: State<'_, AppService>,
    ticket_id: Uuid,
    limit: Option<u32>,
) -> CommandResult<Vec<TicketFocusHistoryItem>> {
    service
        .ticket_focus_history(ticket_id, limit.unwrap_or(100))
        .await
        .map_err(Into::into)
}

#[tauri::command]
pub async fn schedule_create(
    service: State<'_, AppService>,
    draft: ScheduleDraft,
) -> CommandResult<Schedule> {
    service.create_schedule(draft).await.map_err(Into::into)
}

#[cfg(feature = "e2e")]
#[tauri::command]
pub async fn e2e_schedule_read_only_create(
    service: State<'_, AppService>,
    draft: ScheduleDraft,
) -> CommandResult<Schedule> {
    service
        .create_read_only_schedule_fixture(draft)
        .await
        .map_err(Into::into)
}

#[cfg(feature = "e2e")]
#[tauri::command]
pub async fn e2e_schedule_fixtures_delete(
    service: State<'_, AppService>,
    ids: Vec<Uuid>,
) -> CommandResult<u64> {
    service
        .delete_schedule_fixtures(ids)
        .await
        .map_err(Into::into)
}

#[cfg(feature = "e2e")]
#[tauri::command]
pub async fn e2e_google_calendar_recovery_seed(
    service: State<'_, AppService>,
) -> CommandResult<()> {
    service
        .seed_google_calendar_recovery_fixture()
        .await
        .map_err(Into::into)
}

#[cfg(feature = "e2e")]
#[tauri::command]
pub async fn e2e_google_tasks_seed(service: State<'_, AppService>) -> CommandResult<Uuid> {
    service
        .seed_google_tasks_fixture()
        .await
        .map_err(Into::into)
}

#[cfg(feature = "e2e")]
#[tauri::command]
pub async fn e2e_ticket_scale_seed(
    service: State<'_, AppService>,
    target_total: u32,
) -> CommandResult<u64> {
    service
        .seed_ticket_scale_fixture(target_total)
        .await
        .map_err(Into::into)
}

#[tauri::command]
pub async fn schedule_update(
    service: State<'_, AppService>,
    update: ScheduleUpdateDto,
) -> CommandResult<Schedule> {
    service
        .update_schedule(
            update.id,
            update.expected_version,
            update.draft,
            update.recurrence_scope,
            update.occurrence_start_utc,
        )
        .await
        .map_err(Into::into)
}

#[tauri::command]
pub async fn schedule_bulk_classify(
    service: State<'_, AppService>,
    request: BulkClassifyRequest,
) -> CommandResult<ChangeResult> {
    service
        .bulk_classify_schedules(request.ids, request.patch)
        .await
        .map_err(Into::into)
}

#[tauri::command]
pub async fn schedule_delete(
    service: State<'_, AppService>,
    request: DeleteRequest,
) -> CommandResult<ChangeResult> {
    service
        .delete_schedule(
            request.id,
            request.expected_version,
            request.recurrence_scope,
            request.occurrence_start_utc,
        )
        .await
        .map_err(Into::into)
}

#[tauri::command]
pub async fn history_undo(service: State<'_, AppService>) -> CommandResult<ChangeResult> {
    service.undo().await.map_err(Into::into)
}

#[tauri::command]
pub async fn history_redo(service: State<'_, AppService>) -> CommandResult<ChangeResult> {
    service.redo().await.map_err(Into::into)
}

#[tauri::command]
pub async fn settings_update(
    service: State<'_, AppService>,
    settings: Settings,
) -> CommandResult<Settings> {
    service.save_settings(settings).await.map_err(Into::into)
}

#[tauri::command]
pub fn settings_defaults_get(service: State<'_, AppService>) -> Settings {
    service.default_settings()
}

#[tauri::command]
pub async fn focus_command(
    service: State<'_, AppService>,
    request: FocusRequest,
) -> CommandResult<FocusState> {
    service
        .focus_command(request.command, request.linked_schedule_id)
        .await
        .map_err(Into::into)
}

#[tauri::command]
pub async fn focus_state_get(service: State<'_, AppService>) -> CommandResult<FocusState> {
    service.current_focus().await.map_err(Into::into)
}

#[tauri::command]
pub async fn focus_history_today(
    service: State<'_, AppService>,
) -> CommandResult<FocusHistoryReport> {
    service.focus_history_today().await.map_err(Into::into)
}

#[tauri::command]
pub async fn focus_schedule_summary(
    service: State<'_, AppService>,
    schedule_item_id: Uuid,
) -> CommandResult<FocusScheduleSummary> {
    let work_seconds = service
        .focus_work_seconds(schedule_item_id)
        .await
        .map_err(UserSafeError::from)?;
    Ok(FocusScheduleSummary {
        schedule_item_id,
        work_seconds,
    })
}

#[tauri::command]
pub async fn timer_list(service: State<'_, AppService>) -> CommandResult<Vec<TimerState>> {
    service.timers().await.map_err(Into::into)
}

#[tauri::command]
pub async fn timer_create(
    service: State<'_, AppService>,
    draft: TimerDraft,
) -> CommandResult<TimerState> {
    service.create_timer(draft).await.map_err(Into::into)
}

#[tauri::command]
pub async fn timer_update(
    service: State<'_, AppService>,
    request: TimerUpdateRequest,
) -> CommandResult<TimerState> {
    service
        .update_timer(request.id, request.expected_version, request.draft)
        .await
        .map_err(Into::into)
}

#[tauri::command]
pub async fn timer_delete(
    service: State<'_, AppService>,
    request: VersionRequest,
) -> CommandResult<()> {
    service
        .delete_timer(request.id, request.expected_version)
        .await
        .map_err(Into::into)
}

#[tauri::command]
pub async fn timer_command(
    service: State<'_, AppService>,
    request: TimerCommandRequest,
) -> CommandResult<TimerState> {
    service
        .timer_command(request.id, request.expected_version, request.command)
        .await
        .map_err(Into::into)
}

#[tauri::command]
pub async fn timer_set_list(service: State<'_, AppService>) -> CommandResult<Vec<TimerSet>> {
    service.timer_sets().await.map_err(Into::into)
}

#[tauri::command]
pub async fn timer_set_create(
    service: State<'_, AppService>,
    request: TimerSetCreateRequest,
) -> CommandResult<TimerSet> {
    service
        .save_timer_set(request.name)
        .await
        .map_err(Into::into)
}

#[tauri::command]
pub async fn timer_set_apply(
    service: State<'_, AppService>,
    request: VersionRequest,
) -> CommandResult<Vec<TimerState>> {
    service
        .apply_timer_set(request.id, request.expected_version)
        .await
        .map_err(Into::into)
}

#[tauri::command]
pub async fn timer_set_delete(
    service: State<'_, AppService>,
    request: VersionRequest,
) -> CommandResult<()> {
    service
        .delete_timer_set(request.id, request.expected_version)
        .await
        .map_err(Into::into)
}

#[tauri::command]
pub async fn stopwatch_state_get(service: State<'_, AppService>) -> CommandResult<StopwatchState> {
    service.stopwatch().await.map_err(Into::into)
}

#[tauri::command]
pub async fn stopwatch_command(
    service: State<'_, AppService>,
    request: StopwatchCommandRequest,
) -> CommandResult<StopwatchState> {
    service
        .stopwatch_command(request.expected_version, request.command)
        .await
        .map_err(Into::into)
}

#[tauri::command]
pub async fn sync_run(
    service: State<'_, AppService>,
    request: OperationRequest,
) -> CommandResult<SyncSummary> {
    service
        .run_sync(request.operation_id)
        .await
        .map_err(Into::into)
}

#[tauri::command]
pub async fn operation_cancel(
    service: State<'_, AppService>,
    request: OperationRequest,
) -> CommandResult<bool> {
    Ok(service.cancel_operation(request.operation_id).await)
}

#[tauri::command]
pub async fn sync_queue_list(service: State<'_, AppService>) -> CommandResult<Vec<SyncQueueItem>> {
    service.sync_queue().await.map_err(Into::into)
}

#[tauri::command]
pub async fn sync_queue_retry(
    service: State<'_, AppService>,
    request: SyncRetryRequest,
) -> CommandResult<u64> {
    service
        .retry_sync_queue(request.id)
        .await
        .map_err(Into::into)
}

#[tauri::command]
pub async fn sync_conflict_list(
    service: State<'_, AppService>,
) -> CommandResult<Vec<SyncConflictItem>> {
    service.sync_conflicts().await.map_err(Into::into)
}

#[tauri::command]
pub async fn sync_conflict_resolve(
    service: State<'_, AppService>,
    request: ConflictResolveRequest,
) -> CommandResult<Schedule> {
    service
        .resolve_sync_conflict(request.id, request.choices)
        .await
        .map_err(Into::into)
}

#[tauri::command]
pub async fn diagnostics_snapshot(
    service: State<'_, AppService>,
) -> CommandResult<DiagnosticsSnapshot> {
    service.diagnostics().await.map_err(Into::into)
}

#[tauri::command]
pub async fn diagnostics_export(
    service: State<'_, AppService>,
    request: DiagnosticsExportRequest,
) -> CommandResult<DiagnosticsExportResult> {
    let path = checked_path(request.path)?;
    service
        .export_diagnostics(&path, &request.webview)
        .await
        .map_err(Into::into)
}

#[tauri::command]
pub async fn data_export(
    service: State<'_, AppService>,
    request: DataExportRequest,
) -> CommandResult<ExportResult> {
    let path = checked_path(request.path)?;
    service
        .export_data(request.operation_id, &path)
        .await
        .map_err(Into::into)
}

#[tauri::command]
pub async fn data_delete_all(
    service: State<'_, AppService>,
    confirmation: String,
) -> CommandResult<u64> {
    service
        .delete_all_user_data(&confirmation)
        .await
        .map_err(Into::into)
}

#[tauri::command]
pub fn data_import_preview(
    service: State<'_, AppService>,
    path: String,
) -> CommandResult<ImportPreview> {
    let path = checked_path(path)?;
    service.preview_import(&path).map_err(Into::into)
}

#[tauri::command]
pub async fn data_import_commit(
    service: State<'_, AppService>,
    request: ImportCommitRequest,
) -> CommandResult<ImportResult> {
    let path = checked_path(request.path)?;
    service
        .import_data(&path, &request.fingerprint, request.mode)
        .await
        .map_err(Into::into)
}

#[tauri::command]
pub async fn legacy_import_preview(
    service: State<'_, AppService>,
    path: String,
) -> CommandResult<LegacyImportPreview> {
    let path = checked_path(path)?;
    service
        .preview_legacy_import(&path)
        .await
        .map_err(Into::into)
}

#[tauri::command]
pub async fn legacy_import_commit(
    service: State<'_, AppService>,
    request: LegacyImportCommitRequest,
) -> CommandResult<LegacyImportResult> {
    let path = checked_path(request.path)?;
    service
        .import_legacy(&path, &request.fingerprint)
        .await
        .map_err(Into::into)
}

#[tauri::command]
pub async fn backup_create(
    service: State<'_, AppService>,
    request: OperationRequest,
) -> CommandResult<BackupRecord> {
    service
        .create_backup(request.operation_id)
        .await
        .map_err(Into::into)
}

#[tauri::command]
pub async fn backup_list(service: State<'_, AppService>) -> CommandResult<Vec<BackupRecord>> {
    service.backups().await.map_err(Into::into)
}

#[tauri::command]
pub async fn backup_restore_stage(
    service: State<'_, AppService>,
    backup_id: Uuid,
) -> CommandResult<RestoreStageResult> {
    service.stage_restore(backup_id).await.map_err(Into::into)
}

#[tauri::command]
pub async fn notification_poll(
    service: State<'_, AppService>,
) -> CommandResult<Vec<NotificationDelivery>> {
    service.poll_notifications().await.map_err(Into::into)
}

#[tauri::command]
pub async fn notification_history_list(
    service: State<'_, AppService>,
) -> CommandResult<Vec<NotificationLedgerItem>> {
    service.notification_ledger().await.map_err(Into::into)
}

#[tauri::command]
pub async fn notification_result_record(
    service: State<'_, AppService>,
    request: NotificationResultRequest,
) -> CommandResult<()> {
    service
        .record_notification_result(
            &request.delivery_key,
            request.result,
            request.error_category.as_deref(),
        )
        .await
        .map_err(Into::into)
}

#[tauri::command]
pub async fn google_oauth_config_import(
    service: State<'_, AppService>,
    path: String,
) -> CommandResult<OAuthConfigResult> {
    let path = checked_path(path)?;
    service
        .import_google_config(&path)
        .await
        .map_err(Into::into)
}

#[tauri::command]
pub async fn google_oauth_begin(
    app: AppHandle,
    service: State<'_, AppService>,
) -> CommandResult<OAuthLaunchResult> {
    let flow = service
        .begin_google_oauth()
        .await
        .map_err(UserSafeError::from)?;
    if app
        .opener()
        .open_url(flow.authorization_url, None::<String>)
        .is_err()
    {
        service.cancel_google_oauth_attempt();
        return Err(UserSafeError {
            code: "browser",
            message: "システムブラウザを開けませんでした。".into(),
            recovery: "既定ブラウザを設定してから、Google接続をもう一度開始してください。".into(),
            retryable: true,
            diagnostic_id: None,
        });
    }
    Ok(OAuthLaunchResult {
        opened_in_system_browser: true,
        expires_at: flow.expires_at,
    })
}

#[tauri::command]
pub async fn google_connection_get(
    service: State<'_, AppService>,
) -> CommandResult<GoogleConnection> {
    service.google_connection().await.map_err(Into::into)
}

#[tauri::command]
pub async fn google_calendar_update(
    service: State<'_, AppService>,
    request: GoogleCalendarUpdateRequest,
) -> CommandResult<GoogleCalendar> {
    service
        .update_google_calendar(request.id, request.selected, request.default_write_target)
        .await
        .map_err(Into::into)
}

#[tauri::command]
pub async fn google_tasks_connection_get(
    service: State<'_, AppService>,
) -> CommandResult<GoogleTasksConnection> {
    service.google_tasks_connection().await.map_err(Into::into)
}

#[tauri::command]
pub async fn google_tasks_full_reconcile(
    service: State<'_, AppService>,
    request: OperationRequest,
) -> CommandResult<GoogleTasksConnection> {
    service
        .reconcile_google_tasks_full(request.operation_id)
        .await
        .map_err(Into::into)
}

#[tauri::command]
pub async fn google_tasks_enabled_set(
    service: State<'_, AppService>,
    request: GoogleTasksEnableRequest,
) -> CommandResult<GoogleTasksConnection> {
    service
        .set_google_tasks_enabled(request.enabled)
        .await
        .map_err(Into::into)
}

#[tauri::command]
pub async fn google_task_list_update(
    service: State<'_, AppService>,
    request: GoogleTaskListUpdate,
) -> CommandResult<GoogleTaskList> {
    service
        .update_google_task_list(request)
        .await
        .map_err(Into::into)
}

#[tauri::command]
pub async fn ticket_google_task_status_list(
    service: State<'_, AppService>,
    request: TicketGoogleTaskStatusRequest,
) -> CommandResult<Vec<TicketGoogleTaskStatus>> {
    service
        .ticket_google_task_statuses(&request.ticket_ids)
        .await
        .map_err(Into::into)
}

#[tauri::command]
pub async fn ticket_google_task_target_update(
    service: State<'_, AppService>,
    request: TicketGoogleTaskTargetUpdate,
) -> CommandResult<TicketGoogleTaskStatus> {
    service
        .update_ticket_google_task_target(request)
        .await
        .map_err(Into::into)
}

#[tauri::command]
pub async fn google_task_conflict_list(
    service: State<'_, AppService>,
) -> CommandResult<Vec<GoogleTaskConflict>> {
    service.google_task_conflicts().await.map_err(Into::into)
}

#[tauri::command]
pub async fn google_task_conflict_resolve(
    service: State<'_, AppService>,
    request: GoogleTaskConflictResolveRequest,
) -> CommandResult<TicketGoogleTaskStatus> {
    service
        .resolve_google_task_conflict(request)
        .await
        .map_err(Into::into)
}

#[tauri::command]
pub async fn google_disconnect(
    service: State<'_, AppService>,
    mode: DisconnectMode,
) -> CommandResult<u64> {
    service.disconnect_google(mode).await.map_err(Into::into)
}

#[tauri::command]
pub async fn compact_window_open(
    app: AppHandle,
    service: State<'_, AppService>,
) -> CommandResult<()> {
    if let Some(window) = app.get_webview_window("compact") {
        window.show().map_err(|_| window_error())?;
        window.set_focus().map_err(|_| window_error())?;
        return Ok(());
    }
    let always_on_top = service
        .window_always_on_top("compact")
        .await
        .map_err(UserSafeError::from)?;
    WebviewWindowBuilder::new(
        &app,
        "compact",
        WebviewUrl::App("index.html?window=compact".into()),
    )
    .title("Day Schedule Next — コンパクト")
    .inner_size(420.0, 640.0)
    .min_inner_size(360.0, 420.0)
    .resizable(true)
    .always_on_top(always_on_top)
    .build()
    .map_err(|_| window_error())?;
    Ok(())
}

#[tauri::command]
pub async fn analog_clock_window_open(
    app: AppHandle,
    service: State<'_, AppService>,
) -> CommandResult<()> {
    if let Some(window) = app.get_webview_window("analog-clock") {
        window.set_maximizable(false).map_err(|_| window_error())?;
        square_window::install_square_constraint(&window)
            .await
            .map_err(|_| window_error())?;
        window.show().map_err(|_| window_error())?;
        window.unminimize().map_err(|_| window_error())?;
        window.set_focus().map_err(|_| window_error())?;
        return Ok(());
    }
    let always_on_top = service
        .window_always_on_top("analog-clock")
        .await
        .map_err(UserSafeError::from)?;
    let window = WebviewWindowBuilder::new(
        &app,
        "analog-clock",
        WebviewUrl::App("index.html?window=analog-clock".into()),
    )
    .title("Day Schedule Next — アナログ時計")
    .inner_size(480.0, 480.0)
    .min_inner_size(
        f64::from(square_window::MINIMUM_CLIENT_EDGE),
        f64::from(square_window::MINIMUM_CLIENT_EDGE),
    )
    .resizable(true)
    .maximizable(false)
    .always_on_top(always_on_top)
    .build()
    .map_err(|_| window_error())?;
    if square_window::install_square_constraint(&window)
        .await
        .is_err()
    {
        let _ = window.close();
        return Err(window_error());
    }
    Ok(())
}

#[cfg(feature = "e2e")]
#[tauri::command]
pub async fn e2e_analog_clock_square_constraint_get(app: AppHandle) -> CommandResult<bool> {
    let window = app
        .get_webview_window("analog-clock")
        .ok_or_else(window_error)?;
    square_window::constraint_is_installed(&window)
        .await
        .map_err(|_| window_error())
}

#[tauri::command]
pub fn analog_clock_window_resize(app: AppHandle, factor: f64) -> CommandResult<()> {
    let Some(window) = app.get_webview_window("analog-clock") else {
        return Err(window_error());
    };
    let (width, height) = analog_clock_size(factor).ok_or_else(|| UserSafeError {
        code: "validation",
        message: "時計のサイズが正しくありません。".into(),
        recovery: "サイズ変更をもう一度選んでください。".into(),
        retryable: false,
        diagnostic_id: None,
    })?;
    let scale_factor = window.scale_factor().map_err(|_| window_error())?;
    let monitor = window.current_monitor().map_err(|_| window_error())?;
    let (max_width, max_height) = monitor.map_or((width, height), |monitor| {
        (
            (f64::from(monitor.size().width) / scale_factor * 0.9)
                .max(f64::from(square_window::MINIMUM_CLIENT_EDGE)),
            (f64::from(monitor.size().height) / scale_factor * 0.9)
                .max(f64::from(square_window::MINIMUM_CLIENT_EDGE)),
        )
    });
    let max_edge = max_width.min(max_height);
    window
        .set_size(tauri::LogicalSize::new(
            width.min(max_edge),
            height.min(max_edge),
        ))
        .map_err(|_| window_error())?;
    window.center().map_err(|_| window_error())?;
    Ok(())
}

#[tauri::command]
pub fn main_window_show(app: AppHandle) -> CommandResult<()> {
    let Some(window) = app.get_webview_window("main") else {
        return Err(window_error());
    };
    window.show().map_err(|_| window_error())?;
    window.unminimize().map_err(|_| window_error())?;
    window.set_focus().map_err(|_| window_error())?;
    Ok(())
}

#[derive(Debug)]
enum AlwaysOnTopUpdateError<E> {
    Native,
    Save { error: E, rollback_failed: bool },
}

async fn apply_and_save_always_on_top<E, SetNative, Save, SaveFuture>(
    previous: bool,
    requested: bool,
    mut set_native: SetNative,
    save: Save,
) -> Result<(), AlwaysOnTopUpdateError<E>>
where
    SetNative: FnMut(bool) -> Result<(), ()>,
    Save: FnOnce(bool) -> SaveFuture,
    SaveFuture: Future<Output = Result<(), E>>,
{
    set_native(requested).map_err(|()| AlwaysOnTopUpdateError::Native)?;
    if let Err(error) = save(requested).await {
        return Err(AlwaysOnTopUpdateError::Save {
            error,
            rollback_failed: set_native(previous).is_err(),
        });
    }
    Ok(())
}

#[tauri::command]
pub async fn window_always_on_top_set(
    app: AppHandle,
    service: State<'_, AppService>,
    request: WindowPreferenceRequest,
) -> CommandResult<()> {
    if !matches!(request.label.as_str(), "main" | "compact" | "analog-clock") {
        return Err(UserSafeError {
            code: "validation",
            message: "対象ウィンドウが正しくありません。".into(),
            recovery: "メイン、コンパクト、またはアナログ時計を選んでください。".into(),
            retryable: false,
            diagnostic_id: None,
        });
    }
    let previous = service
        .window_always_on_top(&request.label)
        .await
        .map_err(UserSafeError::from)?;
    if let Some(window) = app.get_webview_window(&request.label) {
        match apply_and_save_always_on_top(
            previous,
            request.always_on_top,
            |value| window.set_always_on_top(value).map_err(|_| ()),
            |value| service.save_window_always_on_top(&request.label, value),
        )
        .await
        {
            Ok(()) => {}
            Err(AlwaysOnTopUpdateError::Native) => return Err(window_error()),
            Err(AlwaysOnTopUpdateError::Save {
                error,
                rollback_failed,
            }) => {
                if rollback_failed {
                    tracing::warn!(
                        window_label = %request.label,
                        "failed to restore always-on-top after preference save failure"
                    );
                }
                return Err(UserSafeError::from(error));
            }
        }
    } else {
        service
            .save_window_always_on_top(&request.label, request.always_on_top)
            .await
            .map_err(UserSafeError::from)?;
    }
    Ok(())
}

#[tauri::command]
pub async fn template_list(service: State<'_, AppService>) -> CommandResult<Vec<DayTemplate>> {
    service.templates().await.map_err(Into::into)
}

#[tauri::command]
pub async fn template_save(
    service: State<'_, AppService>,
    input: VersionedSave<DayTemplateDraft>,
) -> CommandResult<DayTemplate> {
    service
        .save_template(input.id, input.expected_version, input.draft)
        .await
        .map_err(Into::into)
}

#[tauri::command]
pub async fn template_delete(
    service: State<'_, AppService>,
    request: DeleteRequest,
) -> CommandResult<()> {
    service
        .delete_template(request.id, request.expected_version)
        .await
        .map_err(Into::into)
}

#[tauri::command]
pub async fn template_reorder(
    service: State<'_, AppService>,
    request: ReorderRequest,
) -> CommandResult<()> {
    service
        .reorder_templates(&request.ids)
        .await
        .map_err(Into::into)
}

#[tauri::command]
pub async fn quick_block_list(service: State<'_, AppService>) -> CommandResult<Vec<QuickBlock>> {
    service.quick_blocks().await.map_err(Into::into)
}

#[tauri::command]
pub async fn quick_block_save(
    service: State<'_, AppService>,
    input: VersionedSave<QuickBlockDraft>,
) -> CommandResult<QuickBlock> {
    service
        .save_quick_block(input.id, input.expected_version, input.draft)
        .await
        .map_err(Into::into)
}

#[tauri::command]
pub async fn quick_block_delete(
    service: State<'_, AppService>,
    request: DeleteRequest,
) -> CommandResult<()> {
    service
        .delete_quick_block(request.id, request.expected_version)
        .await
        .map_err(Into::into)
}

#[tauri::command]
pub async fn quick_block_reorder(
    service: State<'_, AppService>,
    request: ReorderRequest,
) -> CommandResult<()> {
    service
        .reorder_quick_blocks(&request.ids)
        .await
        .map_err(Into::into)
}

#[tauri::command]
pub async fn free_alarm_list(service: State<'_, AppService>) -> CommandResult<Vec<FreeAlarm>> {
    service.free_alarms().await.map_err(Into::into)
}

#[tauri::command]
pub async fn free_alarm_save(
    service: State<'_, AppService>,
    input: VersionedSave<FreeAlarmDraft>,
) -> CommandResult<FreeAlarm> {
    service
        .save_free_alarm(input.id, input.expected_version, input.draft)
        .await
        .map_err(Into::into)
}

#[tauri::command]
pub async fn free_alarm_delete(
    service: State<'_, AppService>,
    request: DeleteRequest,
) -> CommandResult<()> {
    service
        .delete_free_alarm(request.id, request.expected_version)
        .await
        .map_err(Into::into)
}

#[tauri::command]
pub async fn free_alarm_reorder(
    service: State<'_, AppService>,
    request: ReorderRequest,
) -> CommandResult<()> {
    service
        .reorder_free_alarms(&request.ids)
        .await
        .map_err(Into::into)
}

#[tauri::command]
pub async fn template_preview(
    service: State<'_, AppService>,
    request: TemplateTargetRequest,
) -> CommandResult<TemplatePreview> {
    service
        .preview_template(request.template_id, request.date, &request.timezone_id)
        .await
        .map_err(Into::into)
}

#[tauri::command]
pub async fn template_apply(
    service: State<'_, AppService>,
    request: TemplateTargetRequest,
) -> CommandResult<ChangeResult> {
    service
        .apply_template(
            request.template_id,
            request.date,
            &request.timezone_id,
            request.mode.unwrap_or(TemplateApplyMode::Add),
        )
        .await
        .map_err(Into::into)
}

fn window_error() -> UserSafeError {
    UserSafeError {
        code: "window",
        message: "ウィンドウを開けませんでした。".into(),
        recovery: "メインウィンドウを開いたまま、もう一度試してください。".into(),
        retryable: true,
        diagnostic_id: None,
    }
}

fn analog_clock_size(factor: f64) -> Option<(f64, f64)> {
    match factor {
        value if (value - 1.0).abs() < f64::EPSILON => Some((480.0, 480.0)),
        value if (value - 1.5).abs() < f64::EPSILON => Some((620.0, 620.0)),
        value if (value - 2.0).abs() < f64::EPSILON => Some((800.0, 800.0)),
        value if (value - 2.5).abs() < f64::EPSILON => Some((980.0, 980.0)),
        _ => None,
    }
}

fn checked_path(value: String) -> CommandResult<PathBuf> {
    if value.is_empty() || value.len() > 4_096 || value.contains('\0') {
        return Err(UserSafeError {
            code: "validation",
            message: "ファイルの場所が正しくありません。".into(),
            recovery: "ファイル選択画面から選び直してください。".into(),
            retryable: false,
            diagnostic_id: None,
        });
    }
    Ok(PathBuf::from(value))
}

#[cfg(test)]
mod analog_clock_window_tests {
    use std::{cell::RefCell, rc::Rc};

    use super::{AlwaysOnTopUpdateError, analog_clock_size, apply_and_save_always_on_top};

    #[test]
    fn accepts_only_the_supported_clock_scales() {
        assert_eq!(analog_clock_size(1.0), Some((480.0, 480.0)));
        assert_eq!(analog_clock_size(2.5), Some((980.0, 980.0)));
        assert_eq!(analog_clock_size(1.25), None);
        assert_eq!(analog_clock_size(f64::NAN), None);
    }

    #[tokio::test]
    async fn restores_the_native_preference_when_saving_fails() {
        let native_values = Rc::new(RefCell::new(Vec::new()));
        let observed_values = Rc::clone(&native_values);

        let result = apply_and_save_always_on_top(
            false,
            true,
            move |value| {
                observed_values.borrow_mut().push(value);
                Ok(())
            },
            |_| async { Err("database") },
        )
        .await;

        assert!(matches!(
            result,
            Err(AlwaysOnTopUpdateError::Save {
                error: "database",
                rollback_failed: false,
            })
        ));
        assert_eq!(native_values.borrow().as_slice(), &[true, false]);
    }
}
