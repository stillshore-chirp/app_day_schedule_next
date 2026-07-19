import { invoke } from "@tauri-apps/api/core";
import { emit } from "@tauri-apps/api/event";
import {
  backupRecordSchema,
  bootstrapSchema,
  dayTemplateSchema,
  freeAlarmSchema,
  exportResultSchema,
  focusStateSchema,
  focusHistoryReportSchema,
  focusScheduleSummarySchema,
  googleCalendarSchema,
  googleConnectionSchema,
  importPreviewSchema,
  importResultSchema,
  legacyImportPreviewSchema,
  legacyImportResultSchema,
  diagnosticsExportResultSchema,
  notificationDeliverySchema,
  notificationLedgerItemSchema,
  localTimeResolutionSchema,
  recurrencePreviewSchema,
  oauthConfigResultSchema,
  oauthLaunchResultSchema,
  restoreStageResultSchema,
  schedulePageSchema,
  scheduleSchema,
  settingsSchema,
  syncSummarySchema,
  syncConflictItemSchema,
  syncQueueItemSchema,
  templatePreviewSchema,
  quickBlockSchema,
  userSafeErrorSchema,
  type BackupRecord,
  type Bootstrap,
  type BulkClassificationPatch,
  type ChangeResult,
  type DeleteRequest,
  type DayTemplate,
  type DayTemplateDraft,
  type FreeAlarm,
  type FreeAlarmDraft,
  type ExportResult,
  type FocusState,
  type FocusHistoryReport,
  type FocusScheduleSummary,
  type GoogleCalendar,
  type GoogleConnection,
  type ImportPreview,
  type ImportResult,
  type LegacyImportPreview,
  type LegacyImportResult,
  type DiagnosticsExportResult,
  type NotificationDelivery,
  type NotificationLedgerItem,
  type LocalTimeResolution,
  type RecurrencePreview,
  type NotificationDeliveryResult,
  type OAuthConfigResult,
  type OAuthLaunchResult,
  type RestoreStageResult,
  type Schedule,
  type ScheduleDraft,
  type ScheduleQuery,
  type ScheduleUpdate,
  type Settings,
  type SyncSummary,
  type SyncConflictItem,
  type SyncQueueItem,
  type ConflictChoice,
  type TemplatePreview,
  type TemplateTarget,
  type QuickBlock,
  type QuickBlockDraft,
  type VersionedSave,
  type UserSafeError,
} from "../contracts";

export interface DiagnosticsSnapshot {
  appVersion: string;
  schemaVersion: number;
  databaseState: string;
  scheduleCount: number;
  deletedCount: number;
  outboxCount: number;
  conflictCount: number;
  lastBackupAt: string | null;
  integrity: "ok" | "check_required";
}

export interface AppClient {
  bootstrap(): Promise<Bootstrap>;
  resolveLocalTime(local: string, timezoneId: string): Promise<LocalTimeResolution>;
  previewRecurrence(request: {
    startUtc: string;
    endUtc: string;
    timezoneId: string;
    recurrenceRule: string;
  }): Promise<RecurrencePreview>;
  listSchedules(query: ScheduleQuery): Promise<{ items: Schedule[]; total: number }>;
  createSchedule(draft: ScheduleDraft): Promise<Schedule>;
  updateSchedule(update: ScheduleUpdate): Promise<Schedule>;
  bulkClassifySchedules(ids: string[], patch: BulkClassificationPatch): Promise<ChangeResult>;
  deleteSchedule(request: DeleteRequest): Promise<ChangeResult>;
  undo(): Promise<ChangeResult>;
  redo(): Promise<ChangeResult>;
  updateSettings(settings: Settings): Promise<Settings>;
  focusCommand(
    command: "start" | "pause" | "resume" | "stop" | "skip",
    linkedScheduleId?: string,
  ): Promise<FocusState>;
  currentFocus(): Promise<FocusState>;
  focusHistoryToday(): Promise<FocusHistoryReport>;
  focusScheduleSummary(scheduleItemId: string): Promise<FocusScheduleSummary>;
  runSync(): Promise<SyncSummary>;
  listSyncQueue(): Promise<SyncQueueItem[]>;
  retrySyncQueue(id?: string): Promise<number>;
  listSyncConflicts(): Promise<SyncConflictItem[]>;
  resolveSyncConflict(id: string, choices: ConflictChoice[]): Promise<Schedule>;
  diagnostics(): Promise<DiagnosticsSnapshot>;
  exportDiagnostics(path: string, webview: string): Promise<DiagnosticsExportResult>;
  openCompactWindow(): Promise<void>;
  showMainWindowWithAction(action: "quick-add" | "focus"): Promise<void>;
  listTemplates(): Promise<DayTemplate[]>;
  saveTemplate(input: VersionedSave<DayTemplateDraft>): Promise<DayTemplate>;
  deleteTemplate(request: DeleteRequest): Promise<void>;
  reorderTemplates(ids: string[]): Promise<void>;
  listQuickBlocks(): Promise<QuickBlock[]>;
  saveQuickBlock(input: VersionedSave<QuickBlockDraft>): Promise<QuickBlock>;
  deleteQuickBlock(request: DeleteRequest): Promise<void>;
  reorderQuickBlocks(ids: string[]): Promise<void>;
  listFreeAlarms(): Promise<FreeAlarm[]>;
  saveFreeAlarm(input: VersionedSave<FreeAlarmDraft>): Promise<FreeAlarm>;
  deleteFreeAlarm(request: DeleteRequest): Promise<void>;
  reorderFreeAlarms(ids: string[]): Promise<void>;
  previewTemplate(request: TemplateTarget): Promise<TemplatePreview>;
  applyTemplate(request: TemplateTarget): Promise<ChangeResult>;
  setWindowAlwaysOnTop(label: "main" | "compact", alwaysOnTop: boolean): Promise<void>;
  exportData(path: string): Promise<ExportResult>;
  deleteAllUserData(confirmation: string): Promise<number>;
  previewImport(path: string): Promise<ImportPreview>;
  importData(path: string, fingerprint: string, mode: "add" | "replace"): Promise<ImportResult>;
  previewLegacyImport(path: string): Promise<LegacyImportPreview>;
  importLegacy(path: string, fingerprint: string): Promise<LegacyImportResult>;
  createBackup(): Promise<BackupRecord>;
  listBackups(): Promise<BackupRecord[]>;
  stageRestore(backupId: string): Promise<RestoreStageResult>;
  pollNotifications(): Promise<NotificationDelivery[]>;
  notificationLedger(): Promise<NotificationLedgerItem[]>;
  recordNotificationResult(
    deliveryKey: string,
    result: NotificationDeliveryResult,
    errorCategory?: string,
  ): Promise<void>;
  importGoogleOAuthConfig(path: string): Promise<OAuthConfigResult>;
  beginGoogleOAuth(): Promise<OAuthLaunchResult>;
  googleConnection(): Promise<GoogleConnection>;
  updateGoogleCalendar(
    id: string,
    selected: boolean,
    defaultWriteTarget: boolean,
  ): Promise<GoogleCalendar>;
  disconnectGoogle(mode: "keep_local" | "delete_mapped_local"): Promise<number>;
}

function isTauriRuntime(): boolean {
  return typeof window !== "undefined" && "__TAURI_INTERNALS__" in window;
}

function signalLocalChange(): void {
  if (typeof window !== "undefined") {
    window.dispatchEvent(new Event("day-schedule-local-change"));
  }
}

async function call<T>(command: string, args?: Record<string, unknown>): Promise<T> {
  try {
    return await invoke<T>(command, args);
  } catch (error) {
    const parsed = userSafeErrorSchema.safeParse(error);
    if (parsed.success) throw new AppClientError(parsed.data);
    throw new AppClientError({
      code: "unexpected",
      message: "操作を完了できませんでした。",
      recovery: "入力は保持されています。もう一度試し、続く場合はデータと診断を確認してください。",
      retryable: true,
      diagnosticId: null,
    });
  }
}

export class AppClientError extends Error {
  readonly detail: UserSafeError;

  constructor(detail: UserSafeError) {
    super(detail.message);
    this.name = "AppClientError";
    this.detail = detail;
  }
}

export class TauriAppClient implements AppClient {
  async bootstrap(): Promise<Bootstrap> {
    return bootstrapSchema.parse(await call("bootstrap_get"));
  }

  async resolveLocalTime(local: string, timezoneId: string): Promise<LocalTimeResolution> {
    return localTimeResolutionSchema.parse(
      await call("time_local_resolve", { request: { local, timezoneId } }),
    );
  }

  async previewRecurrence(request: {
    startUtc: string;
    endUtc: string;
    timezoneId: string;
    recurrenceRule: string;
  }): Promise<RecurrencePreview> {
    return recurrencePreviewSchema.parse(await call("recurrence_preview_get", { request }));
  }

  async listSchedules(query: ScheduleQuery): Promise<{ items: Schedule[]; total: number }> {
    return schedulePageSchema.parse(await call("schedule_list", { query }));
  }

  async createSchedule(draft: ScheduleDraft): Promise<Schedule> {
    const schedule = scheduleSchema.parse(await call("schedule_create", { draft }));
    signalLocalChange();
    return schedule;
  }

  async updateSchedule(update: ScheduleUpdate): Promise<Schedule> {
    const schedule = scheduleSchema.parse(await call("schedule_update", { update }));
    signalLocalChange();
    return schedule;
  }

  async bulkClassifySchedules(
    ids: string[],
    patch: BulkClassificationPatch,
  ): Promise<ChangeResult> {
    const result = await call<ChangeResult>("schedule_bulk_classify", {
      request: { ids, patch },
    });
    signalLocalChange();
    return result;
  }

  async deleteSchedule(request: DeleteRequest): Promise<ChangeResult> {
    const result = await call<ChangeResult>("schedule_delete", { request });
    signalLocalChange();
    return result;
  }

  async undo(): Promise<ChangeResult> {
    return call("history_undo");
  }

  async redo(): Promise<ChangeResult> {
    return call("history_redo");
  }

  async updateSettings(settings: Settings): Promise<Settings> {
    return settingsSchema.parse(await call("settings_update", { settings }));
  }

  async focusCommand(
    command: "start" | "pause" | "resume" | "stop" | "skip",
    linkedScheduleId?: string,
  ): Promise<FocusState> {
    return focusStateSchema.parse(
      await call("focus_command", {
        request: { command, linkedScheduleId: linkedScheduleId ?? null },
      }),
    );
  }

  async currentFocus(): Promise<FocusState> {
    return focusStateSchema.parse(await call("focus_state_get"));
  }

  async focusHistoryToday(): Promise<FocusHistoryReport> {
    return focusHistoryReportSchema.parse(await call("focus_history_today"));
  }

  async focusScheduleSummary(scheduleItemId: string): Promise<FocusScheduleSummary> {
    return focusScheduleSummarySchema.parse(
      await call("focus_schedule_summary", { scheduleItemId }),
    );
  }

  async runSync(): Promise<SyncSummary> {
    return syncSummarySchema.parse(await call("sync_run"));
  }

  async listSyncQueue(): Promise<SyncQueueItem[]> {
    return syncQueueItemSchema.array().parse(await call("sync_queue_list"));
  }

  async retrySyncQueue(id?: string): Promise<number> {
    return call("sync_queue_retry", { request: { id: id ?? null } });
  }

  async listSyncConflicts(): Promise<SyncConflictItem[]> {
    return syncConflictItemSchema.array().parse(await call("sync_conflict_list"));
  }

  async resolveSyncConflict(id: string, choices: ConflictChoice[]): Promise<Schedule> {
    const schedule = scheduleSchema.parse(
      await call("sync_conflict_resolve", { request: { id, choices } }),
    );
    signalLocalChange();
    return schedule;
  }

  async diagnostics(): Promise<DiagnosticsSnapshot> {
    return call("diagnostics_snapshot");
  }

  async exportDiagnostics(path: string, webview: string): Promise<DiagnosticsExportResult> {
    return diagnosticsExportResultSchema.parse(
      await call("diagnostics_export", { request: { path, webview } }),
    );
  }

  async openCompactWindow(): Promise<void> {
    await call("compact_window_open");
  }

  async showMainWindowWithAction(action: "quick-add" | "focus"): Promise<void> {
    await call("main_window_show");
    await emit("compact-action", action);
  }

  async listTemplates(): Promise<DayTemplate[]> {
    return dayTemplateSchema.array().parse(await call("template_list"));
  }

  async saveTemplate(input: VersionedSave<DayTemplateDraft>): Promise<DayTemplate> {
    return dayTemplateSchema.parse(await call("template_save", { input }));
  }

  async deleteTemplate(request: DeleteRequest): Promise<void> {
    await call("template_delete", { request });
  }

  async reorderTemplates(ids: string[]): Promise<void> {
    await call("template_reorder", { request: { ids } });
  }

  async listQuickBlocks(): Promise<QuickBlock[]> {
    return quickBlockSchema.array().parse(await call("quick_block_list"));
  }

  async saveQuickBlock(input: VersionedSave<QuickBlockDraft>): Promise<QuickBlock> {
    return quickBlockSchema.parse(await call("quick_block_save", { input }));
  }

  async deleteQuickBlock(request: DeleteRequest): Promise<void> {
    await call("quick_block_delete", { request });
  }

  async reorderQuickBlocks(ids: string[]): Promise<void> {
    await call("quick_block_reorder", { request: { ids } });
  }

  async listFreeAlarms(): Promise<FreeAlarm[]> {
    return freeAlarmSchema.array().parse(await call("free_alarm_list"));
  }

  async saveFreeAlarm(input: VersionedSave<FreeAlarmDraft>): Promise<FreeAlarm> {
    return freeAlarmSchema.parse(await call("free_alarm_save", { input }));
  }

  async deleteFreeAlarm(request: DeleteRequest): Promise<void> {
    await call("free_alarm_delete", { request });
  }

  async reorderFreeAlarms(ids: string[]): Promise<void> {
    await call("free_alarm_reorder", { request: { ids } });
  }

  async previewTemplate(request: TemplateTarget): Promise<TemplatePreview> {
    return templatePreviewSchema.parse(await call("template_preview", { request }));
  }

  async applyTemplate(request: TemplateTarget): Promise<ChangeResult> {
    const result = await call<ChangeResult>("template_apply", { request });
    signalLocalChange();
    return result;
  }

  async setWindowAlwaysOnTop(label: "main" | "compact", alwaysOnTop: boolean): Promise<void> {
    await call("window_always_on_top_set", { request: { label, alwaysOnTop } });
  }

  async exportData(path: string): Promise<ExportResult> {
    return exportResultSchema.parse(await call("data_export", { path }));
  }

  async deleteAllUserData(confirmation: string): Promise<number> {
    const deleted = await call<number>("data_delete_all", { confirmation });
    signalLocalChange();
    return deleted;
  }

  async previewImport(path: string): Promise<ImportPreview> {
    return importPreviewSchema.parse(await call("data_import_preview", { path }));
  }

  async importData(
    path: string,
    fingerprint: string,
    mode: "add" | "replace",
  ): Promise<ImportResult> {
    return importResultSchema.parse(
      await call("data_import_commit", { request: { path, fingerprint, mode } }),
    );
  }

  async previewLegacyImport(path: string): Promise<LegacyImportPreview> {
    return legacyImportPreviewSchema.parse(await call("legacy_import_preview", { path }));
  }

  async importLegacy(path: string, fingerprint: string): Promise<LegacyImportResult> {
    return legacyImportResultSchema.parse(
      await call("legacy_import_commit", { request: { path, fingerprint } }),
    );
  }

  async createBackup(): Promise<BackupRecord> {
    return backupRecordSchema.parse(await call("backup_create"));
  }

  async listBackups(): Promise<BackupRecord[]> {
    return backupRecordSchema.array().parse(await call("backup_list"));
  }

  async stageRestore(backupId: string): Promise<RestoreStageResult> {
    return restoreStageResultSchema.parse(await call("backup_restore_stage", { backupId }));
  }

  async pollNotifications(): Promise<NotificationDelivery[]> {
    return notificationDeliverySchema.array().parse(await call("notification_poll"));
  }

  async notificationLedger(): Promise<NotificationLedgerItem[]> {
    return notificationLedgerItemSchema.array().parse(await call("notification_history_list"));
  }

  async recordNotificationResult(
    deliveryKey: string,
    result: NotificationDeliveryResult,
    errorCategory?: string,
  ): Promise<void> {
    await call("notification_result_record", {
      request: { deliveryKey, result, errorCategory: errorCategory ?? null },
    });
  }

  async importGoogleOAuthConfig(path: string): Promise<OAuthConfigResult> {
    return oauthConfigResultSchema.parse(await call("google_oauth_config_import", { path }));
  }

  async beginGoogleOAuth(): Promise<OAuthLaunchResult> {
    return oauthLaunchResultSchema.parse(await call("google_oauth_begin"));
  }

  async googleConnection(): Promise<GoogleConnection> {
    return googleConnectionSchema.parse(await call("google_connection_get"));
  }

  async updateGoogleCalendar(
    id: string,
    selected: boolean,
    defaultWriteTarget: boolean,
  ): Promise<GoogleCalendar> {
    return googleCalendarSchema.parse(
      await call("google_calendar_update", { request: { id, selected, defaultWriteTarget } }),
    );
  }

  async disconnectGoogle(mode: "keep_local" | "delete_mapped_local"): Promise<number> {
    return call("google_disconnect", { mode });
  }
}

class NativeRuntimeRequiredClient implements AppClient {
  private unavailable(): AppClientError {
    return new AppClientError({
      code: "native_runtime_required",
      message: "デスクトップ機能を開始できませんでした。",
      recovery:
        "Tauri デスクトップアプリとして起動してください。ローカルデータは変更されていません。",
      retryable: false,
      diagnosticId: null,
    });
  }

  bootstrap(): Promise<Bootstrap> {
    return Promise.reject(this.unavailable());
  }
  resolveLocalTime(): Promise<LocalTimeResolution> {
    return Promise.reject(this.unavailable());
  }
  previewRecurrence(): Promise<RecurrencePreview> {
    return Promise.reject(this.unavailable());
  }
  listSchedules(): Promise<{ items: Schedule[]; total: number }> {
    return Promise.reject(this.unavailable());
  }
  createSchedule(): Promise<Schedule> {
    return Promise.reject(this.unavailable());
  }
  updateSchedule(): Promise<Schedule> {
    return Promise.reject(this.unavailable());
  }
  bulkClassifySchedules(): Promise<ChangeResult> {
    return Promise.reject(this.unavailable());
  }
  deleteSchedule(): Promise<ChangeResult> {
    return Promise.reject(this.unavailable());
  }
  undo(): Promise<ChangeResult> {
    return Promise.reject(this.unavailable());
  }
  redo(): Promise<ChangeResult> {
    return Promise.reject(this.unavailable());
  }
  updateSettings(): Promise<Settings> {
    return Promise.reject(this.unavailable());
  }
  focusCommand(): Promise<FocusState> {
    return Promise.reject(this.unavailable());
  }
  currentFocus(): Promise<FocusState> {
    return Promise.reject(this.unavailable());
  }
  focusHistoryToday(): Promise<FocusHistoryReport> {
    return Promise.reject(this.unavailable());
  }
  focusScheduleSummary(): Promise<FocusScheduleSummary> {
    return Promise.reject(this.unavailable());
  }
  runSync(): Promise<SyncSummary> {
    return Promise.reject(this.unavailable());
  }
  listSyncQueue(): Promise<SyncQueueItem[]> {
    return Promise.reject(this.unavailable());
  }
  retrySyncQueue(): Promise<number> {
    return Promise.reject(this.unavailable());
  }
  listSyncConflicts(): Promise<SyncConflictItem[]> {
    return Promise.reject(this.unavailable());
  }
  resolveSyncConflict(): Promise<Schedule> {
    return Promise.reject(this.unavailable());
  }
  diagnostics(): Promise<DiagnosticsSnapshot> {
    return Promise.reject(this.unavailable());
  }
  exportDiagnostics(): Promise<DiagnosticsExportResult> {
    return Promise.reject(this.unavailable());
  }
  openCompactWindow(): Promise<void> {
    return Promise.reject(this.unavailable());
  }
  showMainWindowWithAction(): Promise<void> {
    return Promise.reject(this.unavailable());
  }
  listTemplates(): Promise<DayTemplate[]> {
    return Promise.reject(this.unavailable());
  }
  saveTemplate(): Promise<DayTemplate> {
    return Promise.reject(this.unavailable());
  }
  deleteTemplate(): Promise<void> {
    return Promise.reject(this.unavailable());
  }
  reorderTemplates(): Promise<void> {
    return Promise.reject(this.unavailable());
  }
  listQuickBlocks(): Promise<QuickBlock[]> {
    return Promise.reject(this.unavailable());
  }
  saveQuickBlock(): Promise<QuickBlock> {
    return Promise.reject(this.unavailable());
  }
  deleteQuickBlock(): Promise<void> {
    return Promise.reject(this.unavailable());
  }
  reorderQuickBlocks(): Promise<void> {
    return Promise.reject(this.unavailable());
  }
  listFreeAlarms(): Promise<FreeAlarm[]> {
    return Promise.reject(this.unavailable());
  }
  saveFreeAlarm(): Promise<FreeAlarm> {
    return Promise.reject(this.unavailable());
  }
  deleteFreeAlarm(): Promise<void> {
    return Promise.reject(this.unavailable());
  }
  reorderFreeAlarms(): Promise<void> {
    return Promise.reject(this.unavailable());
  }
  previewTemplate(): Promise<TemplatePreview> {
    return Promise.reject(this.unavailable());
  }
  applyTemplate(): Promise<ChangeResult> {
    return Promise.reject(this.unavailable());
  }
  setWindowAlwaysOnTop(): Promise<void> {
    return Promise.reject(this.unavailable());
  }
  exportData(): Promise<ExportResult> {
    return Promise.reject(this.unavailable());
  }
  deleteAllUserData(): Promise<number> {
    return Promise.reject(this.unavailable());
  }
  previewImport(): Promise<ImportPreview> {
    return Promise.reject(this.unavailable());
  }
  importData(): Promise<ImportResult> {
    return Promise.reject(this.unavailable());
  }
  previewLegacyImport(): Promise<LegacyImportPreview> {
    return Promise.reject(this.unavailable());
  }
  importLegacy(): Promise<LegacyImportResult> {
    return Promise.reject(this.unavailable());
  }
  createBackup(): Promise<BackupRecord> {
    return Promise.reject(this.unavailable());
  }
  listBackups(): Promise<BackupRecord[]> {
    return Promise.reject(this.unavailable());
  }
  stageRestore(): Promise<RestoreStageResult> {
    return Promise.reject(this.unavailable());
  }
  pollNotifications(): Promise<NotificationDelivery[]> {
    return Promise.reject(this.unavailable());
  }
  notificationLedger(): Promise<NotificationLedgerItem[]> {
    return Promise.reject(this.unavailable());
  }
  recordNotificationResult(): Promise<void> {
    return Promise.reject(this.unavailable());
  }
  importGoogleOAuthConfig(): Promise<OAuthConfigResult> {
    return Promise.reject(this.unavailable());
  }
  beginGoogleOAuth(): Promise<OAuthLaunchResult> {
    return Promise.reject(this.unavailable());
  }
  googleConnection(): Promise<GoogleConnection> {
    return Promise.reject(this.unavailable());
  }
  updateGoogleCalendar(): Promise<GoogleCalendar> {
    return Promise.reject(this.unavailable());
  }
  disconnectGoogle(): Promise<number> {
    return Promise.reject(this.unavailable());
  }
}

export function createDefaultClient(): AppClient {
  return isTauriRuntime() ? new TauriAppClient() : new NativeRuntimeRequiredClient();
}
