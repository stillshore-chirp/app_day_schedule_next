import { translate } from "./i18n/messages";
import { z } from "zod";

export const scheduleStatusSchema = z.enum([
  "not_started",
  "scheduled",
  "in_progress",
  "completed",
  "cancelled",
]);

export const syncStatusSchema = z.enum([
  "local_only",
  "pending",
  "syncing",
  "synced",
  "offline",
  "retry_scheduled",
  "conflict",
  "auth_required",
  "read_only",
]);

export const prioritySchema = z.enum(["low", "normal", "high", "urgent"]);

const scheduleDraftFields = {
  title: z.string().trim().min(1).max(200),
  description: z.string().max(10_000),
  location: z.string().max(500),
  startUtc: z.iso.datetime({ offset: true }),
  endUtc: z.iso.datetime({ offset: true }),
  timezoneId: z.string().min(1).max(100),
  allDay: z.boolean(),
  allDayStartDate: z.iso.date().nullable().default(null),
  allDayEndDateExclusive: z.iso.date().nullable().default(null),
  status: scheduleStatusSchema,
  project: z.string().max(100),
  category: z.string().max(100),
  tags: z.array(z.string().max(50)).max(20),
  color: z.string().regex(/^#[0-9a-fA-F]{6}$/),
  priority: prioritySchema,
  recurrenceRule: z.string().trim().min(6).max(500).nullable(),
  recurrenceExdates: z
    .array(z.iso.datetime({ offset: true }))
    .max(10_000)
    .default([]),
  startNotificationMinutes: z.number().int().min(0).max(10_080).nullable().default(null),
  endNotificationMinutes: z.number().int().min(0).max(10_080).nullable().default(null),
} as const;

function refineScheduleInterval(
  schedule: {
    startUtc: string;
    endUtc: string;
    allDay: boolean;
    allDayStartDate: string | null;
    allDayEndDateExclusive: string | null;
  },
  context: z.RefinementCtx,
) {
  if (Date.parse(schedule.startUtc) >= Date.parse(schedule.endUtc)) {
    context.addIssue({
      code: "custom",
      path: ["endUtc"],
      message: translate("shared.contracts.001"),
    });
  }
  if (
    schedule.allDay &&
    (!schedule.allDayStartDate ||
      !schedule.allDayEndDateExclusive ||
      schedule.allDayStartDate >= schedule.allDayEndDateExclusive)
  ) {
    context.addIssue({
      code: "custom",
      path: ["allDayEndDateExclusive"],
      message: translate("shared.contracts.002"),
    });
  }
}

export const scheduleSchema = z
  .object({
    id: z.uuid(),
    ...scheduleDraftFields,
    syncStatus: syncStatusSchema,
    version: z.number().int().nonnegative(),
    deletedAt: z.iso.datetime({ offset: true }).nullable(),
  })
  .superRefine(refineScheduleInterval);

export const scheduleDraftSchema = z
  .object(scheduleDraftFields)
  .superRefine(refineScheduleInterval);

export const settingsSchema = z.object({
  theme: z.enum(["system", "light", "dark"]),
  locale: z.enum(["ja", "en"]),
  snapMinutes: z.union([z.literal(1), z.literal(5), z.literal(10), z.literal(15), z.literal(30)]),
  closeBehavior: z.enum(["tray", "quit"]),
  notificationGraceMinutes: z.number().int().min(0).max(120),
  notificationMaxReplay: z.number().int().min(0).max(20),
  focusWorkMinutes: z.number().int().min(1).max(180),
  focusBreakMinutes: z.number().int().min(1).max(180),
  scheduleNotificationsEnabled: z.boolean(),
  osNotificationsEnabled: z.boolean(),
  soundNotificationsEnabled: z.boolean(),
  focusLongBreakMinutes: z.number().int().min(1).max(180),
  focusLongBreakEvery: z.number().int().min(1).max(12),
  focusAutoStart: z.boolean(),
  focusNotificationsEnabled: z.boolean(),
  lastTemplateId: z.uuid().nullable().default(null),
});

export const syncSummarySchema = z.object({
  state: z.enum([
    "disconnected",
    "connecting",
    "synced",
    "pending",
    "syncing",
    "offline",
    "retry_scheduled",
    "conflict",
    "auth_required",
  ]),
  pendingCount: z.number().int().nonnegative(),
  conflictCount: z.number().int().nonnegative(),
  lastCompletedAt: z.iso.datetime({ offset: true }).nullable(),
  nextRetryAt: z.iso.datetime({ offset: true }).nullable(),
});

export const focusStateSchema = z.object({
  phase: z.enum(["idle", "working", "paused", "break", "waiting_next"]),
  startedAt: z.iso.datetime({ offset: true }).nullable(),
  endsAt: z.iso.datetime({ offset: true }).nullable(),
  accumulatedSeconds: z.number().int().nonnegative(),
  cycle: z.number().int().nonnegative(),
  linkedScheduleId: z.uuid().nullable(),
});

export const focusHistoryReportSchema = z.object({
  workSeconds: z.number().int().nonnegative(),
  entries: z
    .array(
      z.object({
        id: z.uuid(),
        sessionId: z.uuid(),
        scheduleItemId: z.uuid().nullable(),
        event: z.enum(["start", "pause", "resume", "work_end", "break_end", "stop", "skip"]),
        fromPhase: z.enum(["working", "paused", "break", "waiting_next"]).nullable(),
        toPhase: z.enum(["working", "paused", "break", "waiting_next"]).nullable(),
        elapsedSeconds: z.number().int().nonnegative(),
        occurredAt: z.iso.datetime({ offset: true }),
      }),
    )
    .max(100),
});

export const focusScheduleSummarySchema = z.object({
  scheduleItemId: z.uuid(),
  workSeconds: z.number().int().nonnegative(),
});

export const timerDraftSchema = z.object({
  label: z.string().trim().max(100),
  durationSeconds: z.number().int().min(1).max(604_800),
});

export const timerSchema = timerDraftSchema.extend({
  id: z.uuid(),
  status: z.enum(["idle", "running", "paused", "completed"]),
  elapsedSeconds: z.number().int().nonnegative(),
  remainingSeconds: z.number().int().nonnegative(),
  version: z.number().int().nonnegative(),
});

export const timerSetItemSchema = timerDraftSchema.extend({
  sortOrder: z.number().int(),
});

export const timerSetSchema = z.object({
  id: z.uuid(),
  name: z.string().trim().min(1).max(100),
  version: z.number().int().nonnegative(),
  items: z.array(timerSetItemSchema).min(1).max(500),
});

export const stopwatchSchema = z.object({
  status: z.enum(["idle", "running", "paused"]),
  elapsedSeconds: z.number().int().nonnegative(),
  version: z.number().int().nonnegative(),
});

export const bootstrapSchema = z.object({
  schemaVersion: z.number().int().positive(),
  appVersion: z.string().min(1),
  today: z.iso.date(),
  timezoneId: z.string().min(1),
  settings: settingsSchema,
  sync: syncSummarySchema,
  focus: focusStateSchema,
  notificationPermission: z.enum(["unknown", "granted", "denied", "unavailable"]),
  databaseState: z.enum(["ready", "read_only", "recovery_required"]),
  windowPreferences: z.object({
    mainAlwaysOnTop: z.boolean(),
    compactAlwaysOnTop: z.boolean(),
  }),
});

export const schedulePageSchema = z.object({
  items: z.array(scheduleSchema),
  total: z.number().int().nonnegative(),
});

export const userSafeErrorSchema = z.object({
  code: z.string().min(1),
  message: z.string().min(1),
  recovery: z.string().min(1),
  retryable: z.boolean(),
  diagnosticId: z.string().nullable(),
});

export type Schedule = z.infer<typeof scheduleSchema>;
export type ScheduleDraft = z.infer<typeof scheduleDraftSchema>;
export type Settings = z.infer<typeof settingsSchema>;
export type Bootstrap = z.infer<typeof bootstrapSchema>;
export type FocusState = z.infer<typeof focusStateSchema>;
export type FocusHistoryReport = z.infer<typeof focusHistoryReportSchema>;
export type FocusScheduleSummary = z.infer<typeof focusScheduleSummarySchema>;
export type TimerDraft = z.infer<typeof timerDraftSchema>;
export type Timer = z.infer<typeof timerSchema>;
export type TimerSet = z.infer<typeof timerSetSchema>;
export type Stopwatch = z.infer<typeof stopwatchSchema>;
export type TimerCommand = "start" | "pause" | "resume" | "reset";
export type StopwatchCommand = "start" | "pause" | "resume" | "reset";
export type SyncSummary = z.infer<typeof syncSummarySchema>;
export type UserSafeError = z.infer<typeof userSafeErrorSchema>;

export const localTimeResolutionSchema = z.object({
  kind: z.enum(["single", "ambiguous", "gap"]),
  candidates: z.array(z.iso.datetime({ offset: true })).max(2),
});

export type LocalTimeResolution = z.infer<typeof localTimeResolutionSchema>;

export const recurrencePreviewSchema = z.object({
  items: z
    .array(
      z.object({
        startUtc: z.iso.datetime({ offset: true }),
        endUtc: z.iso.datetime({ offset: true }),
      }),
    )
    .max(100),
  warnings: z.array(z.string().min(1).max(500)).max(20),
  infinite: z.boolean(),
});

export type RecurrencePreview = z.infer<typeof recurrencePreviewSchema>;

export interface ScheduleQuery {
  startUtc: string;
  endUtc: string;
  search?: string;
  includeDeleted?: boolean;
  limit?: number;
  offset?: number;
  status?: z.infer<typeof scheduleStatusSchema>;
  project?: string;
  category?: string;
  tag?: string;
  priority?: z.infer<typeof prioritySchema>;
  syncStatus?: z.infer<typeof syncStatusSchema>;
  syncTarget?: string;
  completion?: "all" | "open" | "completed";
  sortBy?: "start" | "end" | "updated" | "priority" | "title";
  sortDescending?: boolean;
}

export interface ScheduleUpdate {
  id: string;
  expectedVersion: number;
  draft: ScheduleDraft;
  recurrenceScope?: "this" | "following" | "series";
  occurrenceStartUtc?: string;
}

export interface BulkClassificationPatch {
  project?: string;
  category?: string;
  tags?: string[];
  color?: string;
  priority?: z.infer<typeof prioritySchema>;
}

export interface DeleteRequest {
  id: string;
  expectedVersion: number;
  recurrenceScope?: "this" | "following" | "series";
  occurrenceStartUtc?: string;
}

export interface ChangeResult {
  changedIds: string[];
  undoAvailable: boolean;
  redoAvailable: boolean;
}

export const exportResultSchema = z.object({
  fileName: z.string().min(1),
  bytesWritten: z.number().int().nonnegative(),
  scheduleCount: z.number().int().nonnegative(),
  templateCount: z.number().int().nonnegative(),
  quickBlockCount: z.number().int().nonnegative(),
  alarmCount: z.number().int().nonnegative(),
  timerCount: z.number().int().nonnegative(),
  timerSetCount: z.number().int().nonnegative(),
});

export const importPreviewSchema = z.object({
  fingerprint: z.string().regex(/^[0-9a-f]{64}$/),
  formatVersion: z.number().int().positive(),
  createdAt: z.iso.datetime({ offset: true }),
  sourceTimezone: z.string().min(1).max(100),
  scheduleCount: z.number().int().nonnegative(),
  templateCount: z.number().int().nonnegative(),
  quickBlockCount: z.number().int().nonnegative(),
  alarmCount: z.number().int().nonnegative(),
  timerCount: z.number().int().nonnegative(),
  timerSetCount: z.number().int().nonnegative(),
  warnings: z.array(z.string().min(1)).max(20),
});

export const importResultSchema = z.object({
  importedScheduleCount: z.number().int().nonnegative(),
  importedTemplateCount: z.number().int().nonnegative(),
  importedQuickBlockCount: z.number().int().nonnegative(),
  importedAlarmCount: z.number().int().nonnegative(),
  importedTimerCount: z.number().int().nonnegative(),
  importedTimerSetCount: z.number().int().nonnegative(),
  preservedExternalScheduleCount: z.number().int().nonnegative(),
});

export const legacyImportPreviewSchema = z.object({
  fingerprint: z.string().regex(/^[0-9a-f]{64}$/),
  templateCount: z.number().int().nonnegative(),
  templateBlockCount: z.number().int().nonnegative(),
  quickBlockCount: z.number().int().nonnegative(),
  alarmCount: z.number().int().nonnegative(),
  orphanCount: z.number().int().nonnegative(),
  invalidTimeCount: z.number().int().nonnegative(),
  duplicateNameCount: z.number().int().nonnegative(),
  lastProfileFound: z.boolean(),
  warnings: z.array(z.string().min(1)).max(100),
  excluded: z.array(z.string().min(1)).max(20),
});

export const legacyImportResultSchema = z.object({
  importedTemplateCount: z.number().int().nonnegative(),
  importedTemplateBlockCount: z.number().int().nonnegative(),
  importedQuickBlockCount: z.number().int().nonnegative(),
  importedAlarmCount: z.number().int().nonnegative(),
  selectedTemplateId: z.uuid(),
});

export const diagnosticsExportResultSchema = z.object({
  fileName: z.string().min(1),
  bytesWritten: z.number().int().nonnegative(),
  eventCount: z.number().int().nonnegative(),
});

export type LegacyImportPreview = z.infer<typeof legacyImportPreviewSchema>;
export type LegacyImportResult = z.infer<typeof legacyImportResultSchema>;
export type DiagnosticsExportResult = z.infer<typeof diagnosticsExportResultSchema>;

export type ExportResult = z.infer<typeof exportResultSchema>;
export type ImportPreview = z.infer<typeof importPreviewSchema>;
export type ImportResult = z.infer<typeof importResultSchema>;

export const backupRecordSchema = z.object({
  id: z.uuid(),
  fileName: z.string().min(1).max(200),
  sizeBytes: z.number().int().nonnegative(),
  schemaVersion: z.number().int().nonnegative(),
  appVersion: z.string().min(1),
  verified: z.boolean(),
  createdAt: z.iso.datetime({ offset: true }),
});

export const restoreStageResultSchema = z.object({
  backupId: z.uuid(),
  requiresRestart: z.boolean(),
  currentDatabaseWillBePreserved: z.boolean(),
});

export type BackupRecord = z.infer<typeof backupRecordSchema>;
export type RestoreStageResult = z.infer<typeof restoreStageResultSchema>;

export const notificationDeliverySchema = z.object({
  deliveryKey: z.string().regex(/^[0-9a-f]{64}$/),
  title: z.string().min(1).max(200),
  body: z.string().max(500),
  occurrenceAt: z.iso.datetime({ offset: true }),
  osNotification: z.boolean(),
  sound: z.boolean(),
});

export type NotificationDelivery = z.infer<typeof notificationDeliverySchema>;
export type NotificationDeliveryResult = "delivered" | "skipped" | "failed" | "expired";

export const notificationLedgerItemSchema = z.object({
  occurrenceAt: z.iso.datetime({ offset: true }),
  attemptedAt: z.iso.datetime({ offset: true }),
  result: z.enum(["delivered", "skipped", "failed", "expired"]),
  errorCategory: z.string().max(80).nullable(),
});

export type NotificationLedgerItem = z.infer<typeof notificationLedgerItemSchema>;

export const googleCalendarSchema = z.object({
  id: z.uuid(),
  displayName: z.string().min(1).max(500),
  color: z.string().max(20),
  timezoneId: z.string().min(1).max(100),
  accessRole: z.enum(["owner", "writer", "reader", "freeBusyReader"]),
  selected: z.boolean(),
  defaultWriteTarget: z.boolean(),
  writable: z.boolean(),
});

export const googleConnectionSchema = z.object({
  configured: z.boolean(),
  state: z.enum([
    "not_configured",
    "configured",
    "connecting",
    "connected",
    "auth_required",
    "feature_disabled",
  ]),
  accountId: z.uuid().nullable(),
  displayLabel: z.string().max(200).nullable(),
  calendars: z.array(googleCalendarSchema).max(10_000),
  lastError: z.string().max(100).nullable(),
  mappedScheduleCount: z.number().int().nonnegative(),
});

export const oauthConfigResultSchema = z.object({
  configured: z.boolean(),
  clientIdHint: z.string().min(1).max(20),
  scopes: z.tuple([
    z.literal("https://www.googleapis.com/auth/calendar.events"),
    z.literal("https://www.googleapis.com/auth/calendar.calendarlist.readonly"),
  ]),
});

export const oauthLaunchResultSchema = z.object({
  openedInSystemBrowser: z.boolean(),
  expiresAt: z.iso.datetime({ offset: true }),
});

export type GoogleCalendar = z.infer<typeof googleCalendarSchema>;
export type GoogleConnection = z.infer<typeof googleConnectionSchema>;
export type OAuthConfigResult = z.infer<typeof oauthConfigResultSchema>;
export type OAuthLaunchResult = z.infer<typeof oauthLaunchResultSchema>;

export const syncQueueItemSchema = z.object({
  id: z.uuid(),
  scheduleId: z.uuid(),
  title: z.string().min(1).max(200),
  operation: z.enum(["create", "update", "delete"]),
  attemptCount: z.number().int().nonnegative(),
  nextAttemptAt: z.iso.datetime({ offset: true }),
  errorCategory: z.string().max(100).nullable(),
});

export const syncConflictFieldSchema = z.object({
  field: z.string().min(1).max(100),
  localValue: z.unknown(),
  remoteValue: z.unknown(),
});

export const syncConflictItemSchema = z.object({
  id: z.uuid(),
  scheduleId: z.uuid(),
  title: z.string().min(1).max(200),
  calendarName: z.string().min(1).max(500),
  fields: z.array(syncConflictFieldSchema).min(1).max(100),
  deletionConflict: z.boolean(),
  createdAt: z.iso.datetime({ offset: true }),
});

export type SyncQueueItem = z.infer<typeof syncQueueItemSchema>;
export type SyncConflictItem = z.infer<typeof syncConflictItemSchema>;

export interface ConflictChoice {
  field: string;
  source: "local" | "remote";
}

export const templateBlockSchema = z.object({
  id: z.uuid(),
  title: z.string().trim().min(1).max(200),
  startMinute: z.number().int().min(0).max(1439),
  durationMinutes: z.number().int().min(1).max(1440),
  color: z.string().regex(/^#[0-9a-fA-F]{6}$/),
  project: z.string().max(100),
  category: z.string().max(100),
  sortOrder: z.number().int(),
});

export const dayTemplateSchema = z.object({
  id: z.uuid(),
  name: z.string().trim().min(1).max(100),
  description: z.string().max(1000),
  color: z.string().regex(/^#[0-9a-fA-F]{6}$/),
  weekdaysMask: z.number().int().min(0).max(127),
  isBuiltin: z.boolean(),
  sortOrder: z.number().int(),
  version: z.number().int().nonnegative(),
  blocks: z.array(templateBlockSchema).max(500),
});

export const templateBlockDraftSchema = templateBlockSchema.omit({ id: true, sortOrder: true });
export const dayTemplateDraftSchema = dayTemplateSchema
  .omit({
    id: true,
    isBuiltin: true,
    sortOrder: true,
    version: true,
    blocks: true,
  })
  .extend({ blocks: z.array(templateBlockDraftSchema).max(500) });

const quickBlockDraftFields = {
  title: z.string().trim().min(1).max(200),
  startMinute: z.number().int().min(0).max(1439),
  durationMinutes: z.number().int().min(1).max(1440),
  timezoneId: z.string().min(1).max(100),
  color: z.string().regex(/^#[0-9a-fA-F]{6}$/),
  project: z.string().max(100),
  category: z.string().max(100),
  startNotificationMinutes: z.number().int().min(0).max(10080).nullable(),
  endNotificationMinutes: z.number().int().min(0).max(10080).nullable(),
  isActive: z.boolean(),
} as const;
export const quickBlockDraftSchema = z.object(quickBlockDraftFields);
export const quickBlockSchema = z.object({
  id: z.uuid(),
  ...quickBlockDraftFields,
  sortOrder: z.number().int(),
  version: z.number().int().nonnegative(),
});

const freeAlarmDraftFields = {
  label: z.string().trim().min(1).max(200),
  minuteOfDay: z.number().int().min(0).max(1439),
  timezoneId: z.string().min(1).max(100),
  weekdaysMask: z.number().int().min(0).max(127),
  enabled: z.boolean(),
} as const;
export const freeAlarmDraftSchema = z.object(freeAlarmDraftFields);
export const freeAlarmSchema = z.object({
  id: z.uuid(),
  ...freeAlarmDraftFields,
  sortOrder: z.number().int(),
  version: z.number().int().nonnegative(),
});

export type DayTemplate = z.infer<typeof dayTemplateSchema>;
export type DayTemplateDraft = z.infer<typeof dayTemplateDraftSchema>;
export type QuickBlock = z.infer<typeof quickBlockSchema>;
export type QuickBlockDraft = z.infer<typeof quickBlockDraftSchema>;
export type FreeAlarm = z.infer<typeof freeAlarmSchema>;
export type FreeAlarmDraft = z.infer<typeof freeAlarmDraftSchema>;

export const templatePreviewItemSchema = z.object({
  title: z.string().min(1).max(200),
  startUtc: z.iso.datetime({ offset: true }),
  endUtc: z.iso.datetime({ offset: true }),
  timezoneId: z.string().min(1).max(100),
  color: z.string().regex(/^#[0-9a-fA-F]{6}$/),
});
export type TemplatePreviewItem = z.infer<typeof templatePreviewItemSchema>;
export const templatePreviewSchema = z.object({
  items: z.array(templatePreviewItemSchema).max(500),
  overlappingItemCount: z.number().int().nonnegative(),
  localReplaceCandidateCount: z.number().int().nonnegative(),
  externalPreservedCount: z.number().int().nonnegative(),
  syncTarget: z.string().min(1).max(200),
});
export type TemplatePreview = z.infer<typeof templatePreviewSchema>;

export interface TemplateTarget {
  templateId: string;
  date: string;
  timezoneId: string;
  mode?: "add" | "replace";
}

export interface VersionedSave<T> {
  id?: string;
  expectedVersion?: number;
  draft: T;
}
