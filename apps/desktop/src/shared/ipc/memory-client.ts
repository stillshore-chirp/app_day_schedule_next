import { translate } from "../i18n/messages";
import {
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
  type LocalTimeResolution,
  type RecurrencePreview,
  type NotificationDelivery,
  type NotificationLedgerItem,
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
  type QuickBlock,
  type QuickBlockDraft,
  type VersionedSave,
  type TemplatePreview,
  type TemplateTarget,
  type Timer,
  type TimerCommand,
  type TimerDraft,
  type TimerSet,
  type Stopwatch,
  type StopwatchCommand,
} from "../contracts";
import { fromZonedTime } from "date-fns-tz";
import type { AppClient, DiagnosticsSnapshot } from "./client";

interface Snapshot {
  schedules: Schedule[];
}

const defaultSettings: Settings = {
  theme: "system",
  locale: "ja",
  snapMinutes: 5,
  closeBehavior: "tray",
  notificationGraceMinutes: 10,
  notificationMaxReplay: 3,
  focusWorkMinutes: 25,
  focusBreakMinutes: 5,
  scheduleNotificationsEnabled: true,
  osNotificationsEnabled: true,
  soundNotificationsEnabled: false,
  focusLongBreakMinutes: 15,
  focusLongBreakEvery: 4,
  focusAutoStart: false,
  focusNotificationsEnabled: true,
  lastTemplateId: null,
};

function syntheticSchedules(now: Date): Schedule[] {
  const at = (hour: number, minute: number): string => {
    const value = new Date(now);
    value.setHours(hour, minute, 0, 0);
    return value.toISOString();
  };
  const zone = Intl.DateTimeFormat().resolvedOptions().timeZone || "Asia/Tokyo";
  return [
    {
      id: "00000000-0000-4000-8000-000000000001",
      title: translate("shared.ipc.memory-client.001"),
      description: "synthetic fixture",
      location: "",
      startUtc: at(9, 0),
      endUtc: at(10, 15),
      timezoneId: zone,
      allDay: false,
      allDayStartDate: null,
      allDayEndDateExclusive: null,
      status: "completed",
      project: translate("shared.ipc.memory-client.002"),
      category: translate("shared.ipc.memory-client.003"),
      tags: [translate("shared.ipc.memory-client.004")],
      color: "#B7CCFA",
      priority: "high",
      recurrenceRule: null,
      recurrenceSupplementalLines: [],
      recurrenceExdates: [],
      startNotificationMinutes: null,
      endNotificationMinutes: null,
      syncStatus: "synced",
      version: 1,
      deletedAt: null,
    },
    {
      id: "00000000-0000-4000-8000-000000000002",
      title: translate("shared.ipc.memory-client.005"),
      description: "synthetic fixture",
      location: "",
      startUtc: at(10, 30),
      endUtc: at(12, 0),
      timezoneId: zone,
      allDay: false,
      allDayStartDate: null,
      allDayEndDateExclusive: null,
      status: "in_progress",
      project: translate("shared.ipc.memory-client.006"),
      category: translate("shared.ipc.memory-client.007"),
      tags: ["Google", "Rust"],
      color: "#B9EBC4",
      priority: "urgent",
      recurrenceRule: null,
      recurrenceSupplementalLines: [],
      recurrenceExdates: [],
      startNotificationMinutes: null,
      endNotificationMinutes: null,
      syncStatus: "pending",
      version: 1,
      deletedAt: null,
    },
    {
      id: "00000000-0000-4000-8000-000000000003",
      title: translate("shared.ipc.memory-client.008"),
      description: "",
      location: "",
      startUtc: at(13, 0),
      endUtc: at(13, 30),
      timezoneId: zone,
      allDay: false,
      allDayStartDate: null,
      allDayEndDateExclusive: null,
      status: "scheduled",
      project: translate("shared.ipc.memory-client.009"),
      category: translate("shared.ipc.memory-client.010"),
      tags: [],
      color: "#F8D29B",
      priority: "normal",
      recurrenceRule: null,
      recurrenceSupplementalLines: [],
      recurrenceExdates: [],
      startNotificationMinutes: null,
      endNotificationMinutes: null,
      syncStatus: "local_only",
      version: 1,
      deletedAt: null,
    },
  ];
}

export class MemoryAppClient implements AppClient {
  async markUiReady(): Promise<number> {
    return Math.round(performance.now());
  }

  private schedules: Schedule[];
  private undoStack: Snapshot[] = [];
  private redoStack: Snapshot[] = [];
  private templates: DayTemplate[] = [
    {
      id: "00000000-0000-4000-8000-000000000001",
      name: translate("shared.ipc.memory-client.011"),
      description: translate("shared.ipc.memory-client.012"),
      color: "#6F96F4",
      weekdaysMask: 127,
      isBuiltin: true,
      sortOrder: 0,
      version: 0,
      blocks: [],
    },
  ];
  private quickBlocks: QuickBlock[] = [];
  private freeAlarms: FreeAlarm[] = [];
  private settings: Settings = structuredClone(defaultSettings);
  private focus: FocusState = {
    phase: "idle",
    startedAt: null,
    endsAt: null,
    accumulatedSeconds: 0,
    cycle: 0,
    linkedScheduleId: null,
  };
  private timers: Timer[] = [];
  private timerRunAnchors = new Map<string, { startedAt: number; elapsedAtStart: number }>();
  private timerSets: TimerSet[] = [];
  private stopwatchState: Stopwatch = { status: "idle", elapsedSeconds: 0, version: 0 };
  private stopwatchAnchor: { startedAt: number; elapsedAtStart: number } | null = null;

  constructor(schedules = syntheticSchedules(new Date())) {
    this.schedules = structuredClone(schedules);
  }

  async bootstrap(): Promise<Bootstrap> {
    const now = new Date();
    return {
      schemaVersion: 11,
      appVersion: "0.1.0-test",
      today: now.toISOString().slice(0, 10),
      timezoneId: Intl.DateTimeFormat().resolvedOptions().timeZone || "Asia/Tokyo",
      settings: structuredClone(this.settings),
      sync: this.syncSummary(),
      focus: structuredClone(this.focus),
      notificationPermission: "unknown",
      databaseState: "ready",
      windowPreferences: { mainAlwaysOnTop: false, compactAlwaysOnTop: false },
    };
  }

  async resolveLocalTime(local: string, timezoneId: string): Promise<LocalTimeResolution> {
    return {
      kind: "single",
      candidates: [fromZonedTime(local, timezoneId).toISOString()],
    };
  }

  async previewRecurrence(request: {
    startUtc: string;
    endUtc: string;
    recurrenceRule: string;
  }): Promise<RecurrencePreview> {
    return {
      items: [{ startUtc: request.startUtc, endUtc: request.endUtc }],
      warnings: [],
      infinite:
        !request.recurrenceRule.includes("COUNT=") && !request.recurrenceRule.includes("UNTIL="),
    };
  }

  async listSchedules(query: ScheduleQuery): Promise<{ items: Schedule[]; total: number }> {
    const start = Date.parse(query.startUtc);
    const end = Date.parse(query.endUtc);
    const term = query.search?.trim().toLocaleLowerCase("ja") ?? "";
    const filtered = this.schedules.filter((item) => {
      const overlaps = Date.parse(item.startUtc) < end && Date.parse(item.endUtc) > start;
      const visible = query.includeDeleted === true || item.deletedAt === null;
      const text = [
        item.title,
        item.description,
        item.location,
        item.project,
        item.category,
        ...item.tags,
      ]
        .join(" ")
        .toLocaleLowerCase("ja");
      return overlaps && visible && (term === "" || text.includes(term));
    });
    const offset = query.offset ?? 0;
    const limit = query.limit ?? 500;
    return {
      items: structuredClone(filtered.slice(offset, offset + limit)),
      total: filtered.length,
    };
  }

  async createSchedule(draft: ScheduleDraft): Promise<Schedule> {
    this.checkpoint();
    const created: Schedule = {
      ...structuredClone(draft),
      id: crypto.randomUUID(),
      syncStatus: "local_only",
      version: 0,
      deletedAt: null,
    };
    this.schedules.push(created);
    return structuredClone(created);
  }

  async updateSchedule(update: ScheduleUpdate): Promise<Schedule> {
    const index = this.schedules.findIndex((item) => item.id === update.id);
    const current = this.schedules[index];
    if (!current) throw new Error("schedule_not_found");
    if (current.version !== update.expectedVersion) throw new Error("schedule_version_conflict");
    this.checkpoint();
    const next: Schedule = {
      ...structuredClone(update.draft),
      id: current.id,
      syncStatus: current.syncStatus === "local_only" ? "local_only" : "pending",
      version: current.version + 1,
      deletedAt: null,
    };
    this.schedules[index] = next;
    return structuredClone(next);
  }

  async bulkClassifySchedules(
    ids: string[],
    patch: BulkClassificationPatch,
  ): Promise<ChangeResult> {
    const selected = new Set(ids);
    if (selected.size === 0 || selected.size > 500 || Object.keys(patch).length === 0) {
      throw new Error("invalid_bulk_classification");
    }
    this.checkpoint();
    this.schedules = this.schedules.map((schedule) =>
      selected.has(schedule.id)
        ? {
            ...schedule,
            ...(patch.project !== undefined ? { project: patch.project.trim() } : {}),
            ...(patch.category !== undefined ? { category: patch.category.trim() } : {}),
            ...(patch.tags !== undefined
              ? { tags: [...new Set(patch.tags.map((tag) => tag.trim()).filter(Boolean))].sort() }
              : {}),
            ...(patch.color !== undefined ? { color: patch.color } : {}),
            ...(patch.priority !== undefined ? { priority: patch.priority } : {}),
            version: schedule.version + 1,
          }
        : schedule,
    );
    return this.changeResult([...selected]);
  }

  async deleteSchedule(request: DeleteRequest): Promise<ChangeResult> {
    const index = this.schedules.findIndex((item) => item.id === request.id);
    const current = this.schedules[index];
    if (!current) throw new Error("schedule_not_found");
    if (current.version !== request.expectedVersion) throw new Error("schedule_version_conflict");
    this.checkpoint();
    this.schedules[index] = {
      ...current,
      deletedAt: new Date().toISOString(),
      version: current.version + 1,
    };
    return this.changeResult([request.id]);
  }

  async undo(): Promise<ChangeResult> {
    const snapshot = this.undoStack.pop();
    if (!snapshot) return this.changeResult([]);
    this.redoStack.push({ schedules: structuredClone(this.schedules) });
    this.schedules = structuredClone(snapshot.schedules);
    return this.changeResult(this.schedules.map((item) => item.id));
  }

  async redo(): Promise<ChangeResult> {
    const snapshot = this.redoStack.pop();
    if (!snapshot) return this.changeResult([]);
    this.undoStack.push({ schedules: structuredClone(this.schedules) });
    this.schedules = structuredClone(snapshot.schedules);
    return this.changeResult(this.schedules.map((item) => item.id));
  }

  async updateSettings(settings: Settings): Promise<Settings> {
    this.settings = structuredClone(settings);
    return structuredClone(this.settings);
  }

  async defaultSettings(): Promise<Settings> {
    return structuredClone(defaultSettings);
  }

  async focusCommand(
    command: "start" | "pause" | "resume" | "stop" | "skip",
    linkedScheduleId?: string,
  ): Promise<FocusState> {
    const now = new Date();
    if (command === "start" || command === "resume") {
      this.focus = {
        ...this.focus,
        phase: "working",
        startedAt: now.toISOString(),
        endsAt: new Date(now.getTime() + this.settings.focusWorkMinutes * 60_000).toISOString(),
        linkedScheduleId: linkedScheduleId ?? this.focus.linkedScheduleId,
      };
    } else if (command === "pause") {
      this.focus = { ...this.focus, phase: "paused", endsAt: null };
    } else if (command === "skip") {
      this.focus = {
        ...this.focus,
        phase: "break",
        startedAt: now.toISOString(),
        endsAt: new Date(now.getTime() + this.settings.focusBreakMinutes * 60_000).toISOString(),
        cycle: this.focus.cycle + 1,
      };
    } else {
      this.focus = {
        phase: "idle",
        startedAt: null,
        endsAt: null,
        accumulatedSeconds: 0,
        cycle: this.focus.cycle,
        linkedScheduleId: null,
      };
    }
    return structuredClone(this.focus);
  }

  async currentFocus(): Promise<FocusState> {
    return structuredClone(this.focus);
  }

  async focusHistoryToday(): Promise<FocusHistoryReport> {
    return { workSeconds: 0, entries: [] };
  }

  async focusScheduleSummary(scheduleItemId: string): Promise<FocusScheduleSummary> {
    return { scheduleItemId, workSeconds: 0 };
  }

  async listTimers(): Promise<Timer[]> {
    this.refreshTimers();
    return structuredClone(this.timers);
  }

  async createTimer(draft: TimerDraft): Promise<Timer> {
    if (!Number.isInteger(draft.durationSeconds) || draft.durationSeconds < 1) {
      throw new Error("invalid_timer_duration");
    }
    const created: Timer = {
      id: crypto.randomUUID(),
      label: draft.label.trim(),
      durationSeconds: draft.durationSeconds,
      status: "idle",
      elapsedSeconds: 0,
      remainingSeconds: draft.durationSeconds,
      version: 0,
    };
    this.timers.push(created);
    return structuredClone(created);
  }

  async updateTimer(id: string, expectedVersion: number, draft: TimerDraft): Promise<Timer> {
    this.refreshTimers();
    const timer = this.requireTimer(id, expectedVersion);
    if (timer.status === "running" || timer.status === "paused") {
      throw new Error("timer_is_active");
    }
    timer.label = draft.label.trim();
    timer.durationSeconds = draft.durationSeconds;
    timer.status = "idle";
    timer.elapsedSeconds = 0;
    timer.remainingSeconds = draft.durationSeconds;
    timer.version += 1;
    return structuredClone(timer);
  }

  async deleteTimer(id: string, expectedVersion: number): Promise<void> {
    const timer = this.requireTimer(id, expectedVersion);
    this.timerRunAnchors.delete(timer.id);
    this.timers = this.timers.filter((item) => item.id !== id);
  }

  async timerCommand(id: string, expectedVersion: number, command: TimerCommand): Promise<Timer> {
    this.refreshTimers();
    const timer = this.requireTimer(id, expectedVersion);
    const now = Date.now();
    if (command === "start" && (timer.status === "idle" || timer.status === "completed")) {
      timer.status = "running";
      timer.elapsedSeconds = 0;
      timer.remainingSeconds = timer.durationSeconds;
      this.timerRunAnchors.set(id, { startedAt: now, elapsedAtStart: 0 });
    } else if (command === "pause" && timer.status === "running") {
      timer.status = "paused";
      this.timerRunAnchors.delete(id);
    } else if (command === "resume" && timer.status === "paused") {
      timer.status = "running";
      this.timerRunAnchors.set(id, { startedAt: now, elapsedAtStart: timer.elapsedSeconds });
    } else if (command === "reset") {
      timer.status = "idle";
      timer.elapsedSeconds = 0;
      timer.remainingSeconds = timer.durationSeconds;
      this.timerRunAnchors.delete(id);
    } else {
      throw new Error("invalid_timer_transition");
    }
    timer.version += 1;
    return structuredClone(timer);
  }

  async listTimerSets(): Promise<TimerSet[]> {
    return structuredClone(this.timerSets);
  }

  async createTimerSet(name: string): Promise<TimerSet> {
    const normalized = name.trim();
    if (!normalized || this.timers.length === 0) throw new Error("invalid_timer_set");
    if (
      this.timerSets.some(
        (item) => item.name.toLocaleLowerCase() === normalized.toLocaleLowerCase(),
      )
    ) {
      throw new Error("timer_set_name_conflict");
    }
    const created: TimerSet = {
      id: crypto.randomUUID(),
      name: normalized,
      version: 0,
      items: this.timers.map((timer, index) => ({
        label: timer.label,
        durationSeconds: timer.durationSeconds,
        sortOrder: index,
      })),
    };
    this.timerSets.push(created);
    return structuredClone(created);
  }

  async applyTimerSet(id: string, expectedVersion: number): Promise<Timer[]> {
    const set = this.timerSets.find((item) => item.id === id);
    if (!set || set.version !== expectedVersion) throw new Error("timer_set_version_conflict");
    const created: Timer[] = [];
    for (const item of set.items) {
      created.push(
        await this.createTimer({ label: item.label, durationSeconds: item.durationSeconds }),
      );
    }
    return created;
  }

  async deleteTimerSet(id: string, expectedVersion: number): Promise<void> {
    const set = this.timerSets.find((item) => item.id === id);
    if (!set || set.version !== expectedVersion) throw new Error("timer_set_version_conflict");
    this.timerSets = this.timerSets.filter((item) => item.id !== id);
  }

  async stopwatch(): Promise<Stopwatch> {
    this.refreshStopwatch();
    return structuredClone(this.stopwatchState);
  }

  async stopwatchCommand(expectedVersion: number, command: StopwatchCommand): Promise<Stopwatch> {
    this.refreshStopwatch();
    if (this.stopwatchState.version !== expectedVersion) {
      throw new Error("stopwatch_version_conflict");
    }
    const now = Date.now();
    if (command === "start" && this.stopwatchState.status === "idle") {
      this.stopwatchState.status = "running";
      this.stopwatchState.elapsedSeconds = 0;
      this.stopwatchAnchor = { startedAt: now, elapsedAtStart: 0 };
    } else if (command === "pause" && this.stopwatchState.status === "running") {
      this.stopwatchState.status = "paused";
      this.stopwatchAnchor = null;
    } else if (command === "resume" && this.stopwatchState.status === "paused") {
      this.stopwatchState.status = "running";
      this.stopwatchAnchor = {
        startedAt: now,
        elapsedAtStart: this.stopwatchState.elapsedSeconds,
      };
    } else if (command === "reset") {
      this.stopwatchState.status = "idle";
      this.stopwatchState.elapsedSeconds = 0;
      this.stopwatchAnchor = null;
    } else {
      throw new Error("invalid_stopwatch_transition");
    }
    this.stopwatchState.version += 1;
    return structuredClone(this.stopwatchState);
  }

  private refreshTimers(): void {
    const now = Date.now();
    for (const timer of this.timers) {
      if (timer.status !== "running") continue;
      const anchor = this.timerRunAnchors.get(timer.id);
      if (!anchor) continue;
      timer.elapsedSeconds = Math.min(
        timer.durationSeconds,
        anchor.elapsedAtStart + Math.floor((now - anchor.startedAt) / 1000),
      );
      timer.remainingSeconds = timer.durationSeconds - timer.elapsedSeconds;
      if (timer.remainingSeconds === 0) {
        timer.status = "completed";
        timer.version += 1;
        this.timerRunAnchors.delete(timer.id);
      }
    }
  }

  private refreshStopwatch(): void {
    if (this.stopwatchState.status !== "running" || !this.stopwatchAnchor) return;
    this.stopwatchState.elapsedSeconds =
      this.stopwatchAnchor.elapsedAtStart +
      Math.floor((Date.now() - this.stopwatchAnchor.startedAt) / 1000);
  }

  private requireTimer(id: string, expectedVersion: number): Timer {
    const timer = this.timers.find((item) => item.id === id);
    if (!timer || timer.version !== expectedVersion) throw new Error("timer_version_conflict");
    return timer;
  }

  async runSync(operationId: string): Promise<SyncSummary> {
    void operationId;
    return this.syncSummary();
  }

  async cancelOperation(operationId: string): Promise<boolean> {
    void operationId;
    return false;
  }

  async listSyncQueue(): Promise<SyncQueueItem[]> {
    return [];
  }

  async retrySyncQueue(): Promise<number> {
    return 0;
  }

  async listSyncConflicts(): Promise<SyncConflictItem[]> {
    return [];
  }

  async resolveSyncConflict(): Promise<Schedule> {
    throw new Error("conflict_not_found");
  }

  async diagnostics(): Promise<DiagnosticsSnapshot> {
    return {
      appVersion: "0.1.0-test",
      schemaVersion: 11,
      databaseState: "ready",
      scheduleCount: this.schedules.filter((item) => item.deletedAt === null).length,
      deletedCount: this.schedules.filter((item) => item.deletedAt !== null).length,
      outboxCount: 0,
      conflictCount: 0,
      lastBackupAt: null,
      integrity: "ok",
    };
  }

  async exportDiagnostics(): Promise<DiagnosticsExportResult> {
    return { fileName: "diagnostics.json", bytesWritten: 0, eventCount: 0 };
  }

  async openCompactWindow(): Promise<void> {
    return Promise.resolve();
  }

  async showMainWindowWithAction(): Promise<void> {
    return Promise.resolve();
  }

  async listTemplates(): Promise<DayTemplate[]> {
    return structuredClone(this.templates);
  }

  async saveTemplate(input: VersionedSave<DayTemplateDraft>): Promise<DayTemplate> {
    const index = input.id ? this.templates.findIndex((item) => item.id === input.id) : -1;
    const current = this.templates[index];
    if (current?.isBuiltin && input.draft.name !== current.name) throw new Error("builtin_name");
    const saved: DayTemplate = {
      ...structuredClone(input.draft),
      id: current?.id ?? crypto.randomUUID(),
      isBuiltin: current?.isBuiltin ?? false,
      sortOrder: current?.sortOrder ?? this.templates.length,
      version: (current?.version ?? -1) + 1,
      blocks: input.draft.blocks.map((block, sortOrder) => ({
        ...block,
        id: crypto.randomUUID(),
        sortOrder,
      })),
    };
    if (index >= 0) this.templates[index] = saved;
    else this.templates.push(saved);
    return structuredClone(saved);
  }

  async deleteTemplate(request: DeleteRequest): Promise<void> {
    const template = this.templates.find((item) => item.id === request.id);
    if (!template || template.isBuiltin) throw new Error("template_delete_denied");
    this.templates = this.templates.filter((item) => item.id !== request.id);
  }

  async reorderTemplates(ids: string[]): Promise<void> {
    this.templates = reorderItems(this.templates, ids);
  }

  async listQuickBlocks(): Promise<QuickBlock[]> {
    return structuredClone(this.quickBlocks);
  }

  async saveQuickBlock(input: VersionedSave<QuickBlockDraft>): Promise<QuickBlock> {
    const index = input.id ? this.quickBlocks.findIndex((item) => item.id === input.id) : -1;
    const current = this.quickBlocks[index];
    const saved: QuickBlock = {
      ...structuredClone(input.draft),
      id: current?.id ?? crypto.randomUUID(),
      sortOrder: current?.sortOrder ?? this.quickBlocks.length,
      version: (current?.version ?? -1) + 1,
    };
    if (index >= 0) this.quickBlocks[index] = saved;
    else this.quickBlocks.push(saved);
    return structuredClone(saved);
  }

  async deleteQuickBlock(request: DeleteRequest): Promise<void> {
    this.quickBlocks = this.quickBlocks.filter((item) => item.id !== request.id);
  }

  async reorderQuickBlocks(ids: string[]): Promise<void> {
    this.quickBlocks = reorderItems(this.quickBlocks, ids);
  }

  async listFreeAlarms(): Promise<FreeAlarm[]> {
    return structuredClone(this.freeAlarms);
  }

  async saveFreeAlarm(input: VersionedSave<FreeAlarmDraft>): Promise<FreeAlarm> {
    const index = input.id ? this.freeAlarms.findIndex((item) => item.id === input.id) : -1;
    const current = this.freeAlarms[index];
    const saved: FreeAlarm = {
      ...structuredClone(input.draft),
      id: current?.id ?? crypto.randomUUID(),
      sortOrder: current?.sortOrder ?? this.freeAlarms.length,
      version: (current?.version ?? -1) + 1,
    };
    if (index >= 0) this.freeAlarms[index] = saved;
    else this.freeAlarms.push(saved);
    return structuredClone(saved);
  }

  async deleteFreeAlarm(request: DeleteRequest): Promise<void> {
    this.freeAlarms = this.freeAlarms.filter((item) => item.id !== request.id);
  }

  async reorderFreeAlarms(ids: string[]): Promise<void> {
    this.freeAlarms = reorderItems(this.freeAlarms, ids);
  }

  async previewTemplate(request: TemplateTarget): Promise<TemplatePreview> {
    const template = this.templates.find((item) => item.id === request.templateId);
    if (!template) throw new Error("template_not_found");
    const items = template.blocks.map((block) => {
      const start = new Date(`${request.date}T00:00:00`);
      start.setMinutes(block.startMinute);
      const end = new Date(start.getTime() + block.durationMinutes * 60_000);
      return {
        title: block.title,
        startUtc: start.toISOString(),
        endUtc: end.toISOString(),
        timezoneId: request.timezoneId,
        color: block.color,
      };
    });
    return {
      items,
      overlappingItemCount: 0,
      localReplaceCandidateCount: 0,
      externalPreservedCount: 0,
      syncTarget: translate("shared.ipc.memory-client.013"),
    };
  }

  async applyTemplate(request: TemplateTarget): Promise<ChangeResult> {
    const preview = await this.previewTemplate(request);
    this.checkpoint();
    if (request.mode === "replace") {
      const start = Date.parse(`${request.date}T00:00:00`);
      const end = start + 86_400_000;
      this.schedules = this.schedules.map((item) =>
        item.syncStatus === "local_only" &&
        Date.parse(item.startUtc) < end &&
        Date.parse(item.endUtc) > start
          ? { ...item, deletedAt: new Date().toISOString(), version: item.version + 1 }
          : item,
      );
    }
    const created = preview.items.map((item) => ({
      id: crypto.randomUUID(),
      title: item.title,
      description: translate("shared.ipc.memory-client.014"),
      location: "",
      startUtc: item.startUtc,
      endUtc: item.endUtc,
      timezoneId: item.timezoneId,
      allDay: false,
      allDayStartDate: null,
      allDayEndDateExclusive: null,
      status: "scheduled" as const,
      project: "",
      category: "",
      tags: [],
      color: item.color,
      priority: "normal" as const,
      recurrenceRule: null,
      recurrenceSupplementalLines: [],
      recurrenceExdates: [],
      startNotificationMinutes: null,
      endNotificationMinutes: null,
      syncStatus: "local_only" as const,
      version: 0,
      deletedAt: null,
    }));
    this.schedules.push(...created);
    return this.changeResult(created.map((item) => item.id));
  }

  async setWindowAlwaysOnTop(): Promise<void> {
    return Promise.resolve();
  }

  async exportData(path: string, operationId: string): Promise<ExportResult> {
    void operationId;
    return {
      fileName: path.split(/[\\/]/).at(-1) ?? "export.json",
      bytesWritten: 0,
      scheduleCount: this.schedules.filter((item) => !item.deletedAt).length,
      templateCount: this.templates.length,
      quickBlockCount: this.quickBlocks.length,
      alarmCount: this.freeAlarms.length,
      timerCount: this.timers.length,
      timerSetCount: this.timerSets.length,
    };
  }

  async deleteAllUserData(confirmation: string): Promise<number> {
    if (confirmation !== translate("shared.ipc.memory-client.015"))
      throw new Error("confirmation_mismatch");
    const count = this.schedules.length;
    this.schedules = [];
    this.templates = this.templates
      .filter((item) => item.isBuiltin)
      .map((item) => ({
        ...item,
        blocks: [],
        version: item.version + 1,
      }));
    this.quickBlocks = [];
    this.freeAlarms = [];
    this.timers = [];
    this.timerSets = [];
    this.timerRunAnchors.clear();
    this.stopwatchState = { status: "idle", elapsedSeconds: 0, version: 0 };
    this.stopwatchAnchor = null;
    this.settings = {
      theme: "system",
      locale: "ja",
      snapMinutes: 5,
      closeBehavior: "tray",
      notificationGraceMinutes: 10,
      notificationMaxReplay: 3,
      focusWorkMinutes: 25,
      focusBreakMinutes: 5,
      scheduleNotificationsEnabled: true,
      osNotificationsEnabled: true,
      soundNotificationsEnabled: false,
      focusLongBreakMinutes: 15,
      focusLongBreakEvery: 4,
      focusAutoStart: false,
      focusNotificationsEnabled: true,
      lastTemplateId: null,
    };
    this.focus = {
      phase: "idle",
      startedAt: null,
      endsAt: null,
      accumulatedSeconds: 0,
      cycle: 0,
      linkedScheduleId: null,
    };
    return count;
  }

  async previewImport(): Promise<ImportPreview> {
    return {
      fingerprint: "0".repeat(64),
      formatVersion: 2,
      createdAt: new Date().toISOString(),
      sourceTimezone: Intl.DateTimeFormat().resolvedOptions().timeZone || "UTC",
      scheduleCount: 0,
      templateCount: 0,
      quickBlockCount: 0,
      alarmCount: 0,
      timerCount: this.timers.length,
      timerSetCount: this.timerSets.length,
      warnings: [translate("shared.ipc.memory-client.016")],
    };
  }

  async importData(): Promise<ImportResult> {
    return {
      importedScheduleCount: 0,
      importedTemplateCount: 0,
      importedQuickBlockCount: 0,
      importedAlarmCount: 0,
      importedTimerCount: 0,
      importedTimerSetCount: 0,
      preservedExternalScheduleCount: 0,
    };
  }

  async previewLegacyImport(): Promise<LegacyImportPreview> {
    return {
      fingerprint: "0".repeat(64),
      templateCount: 0,
      templateBlockCount: 0,
      quickBlockCount: 0,
      alarmCount: 0,
      orphanCount: 0,
      invalidTimeCount: 0,
      duplicateNameCount: 0,
      lastProfileFound: false,
      warnings: [translate("shared.ipc.memory-client.017")],
      excluded: [
        translate("shared.ipc.memory-client.018"),
        translate("shared.ipc.memory-client.019"),
        translate("shared.ipc.memory-client.020"),
      ],
    };
  }

  async importLegacy(): Promise<LegacyImportResult> {
    return {
      importedTemplateCount: 0,
      importedTemplateBlockCount: 0,
      importedQuickBlockCount: 0,
      importedAlarmCount: 0,
      selectedTemplateId: this.templates[0]?.id ?? crypto.randomUUID(),
    };
  }

  async createBackup(operationId: string): Promise<BackupRecord> {
    void operationId;
    return {
      id: crypto.randomUUID(),
      fileName: "synthetic-backup.sqlite3",
      sizeBytes: 0,
      schemaVersion: 11,
      appVersion: "demo",
      verified: true,
      createdAt: new Date().toISOString(),
    };
  }

  async listBackups(): Promise<BackupRecord[]> {
    return [];
  }

  async stageRestore(backupId: string): Promise<RestoreStageResult> {
    return {
      backupId,
      requiresRestart: true,
      currentDatabaseWillBePreserved: true,
    };
  }

  async pollNotifications(): Promise<NotificationDelivery[]> {
    return [];
  }

  async notificationLedger(): Promise<NotificationLedgerItem[]> {
    return [];
  }

  async recordNotificationResult(): Promise<void> {
    return Promise.resolve();
  }

  async importGoogleOAuthConfig(): Promise<OAuthConfigResult> {
    return {
      configured: true,
      clientIdHint: "…synthetic",
      scopes: [
        "https://www.googleapis.com/auth/calendar.events",
        "https://www.googleapis.com/auth/calendar.calendarlist.readonly",
      ],
    };
  }

  async beginGoogleOAuth(): Promise<OAuthLaunchResult> {
    return {
      openedInSystemBrowser: false,
      expiresAt: new Date(Date.now() + 180_000).toISOString(),
    };
  }

  async googleConnection(): Promise<GoogleConnection> {
    return {
      configured: false,
      state: "not_configured",
      accountId: null,
      displayLabel: null,
      calendars: [],
      lastError: null,
      mappedScheduleCount: 0,
    };
  }

  async updateGoogleCalendar(): Promise<GoogleCalendar> {
    throw new Error("calendar_not_found");
  }

  async disconnectGoogle(): Promise<number> {
    return 0;
  }

  private checkpoint(): void {
    this.undoStack.push({ schedules: structuredClone(this.schedules) });
    this.redoStack = [];
  }

  private changeResult(changedIds: string[]): ChangeResult {
    return {
      changedIds,
      undoAvailable: this.undoStack.length > 0,
      redoAvailable: this.redoStack.length > 0,
    };
  }

  private syncSummary(): SyncSummary {
    return {
      state: "disconnected",
      pendingCount: 0,
      conflictCount: 0,
      lastCompletedAt: null,
      nextRetryAt: null,
    };
  }
}

function reorderItems<T extends { id: string; sortOrder: number; version: number }>(
  items: T[],
  ids: string[],
): T[] {
  if (ids.length !== items.length || new Set(ids).size !== ids.length) {
    throw new Error("stale_reorder");
  }
  const byId = new Map(items.map((item) => [item.id, item]));
  return ids.map((id, sortOrder) => {
    const item = byId.get(id);
    if (!item) throw new Error("stale_reorder");
    return { ...item, sortOrder, version: item.version + 1 };
  });
}
