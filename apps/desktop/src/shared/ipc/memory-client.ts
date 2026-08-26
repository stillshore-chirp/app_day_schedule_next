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
  type GoogleTasksConnection,
  type GoogleTaskList,
  type TicketGoogleTaskStatus,
  type GoogleTaskConflict,
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
  type Ticket,
  type TicketBoard,
  type TicketDraft,
  type TicketHistoryItem,
  type TicketFocusHistoryItem,
  type TicketMoveRequest,
  type TicketQuery,
  type TicketUpdateRequest,
  type AssignTicketScheduleRequest,
  type LinkTicketScheduleRequest,
  type UnlinkTicketScheduleRequest,
  type TicketPlanningSummary,
  type TicketScheduleLink,
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

const defaultTicketColumns: Array<[string, TicketBoard["columns"][number]["kind"], string]> = [
  ["00000000-0000-4000-8000-000000000101", "inbox", "Inbox"],
  ["00000000-0000-4000-8000-000000000102", "backlog", "Backlog"],
  ["00000000-0000-4000-8000-000000000103", "next", "Next"],
  ["00000000-0000-4000-8000-000000000104", "in_progress", "In Progress"],
  ["00000000-0000-4000-8000-000000000105", "waiting", "Waiting"],
  ["00000000-0000-4000-8000-000000000106", "done", "Done"],
  ["00000000-0000-4000-8000-000000000107", "omit", "Omit"],
];

const defaultTicketBoard: TicketBoard = {
  id: "00000000-0000-4000-8000-000000000100",
  name: translate("shared.ipc.memory-client.021"),
  version: 0,
  columns: defaultTicketColumns.map(([id, kind, name], sortOrder) => ({
    id,
    boardId: "00000000-0000-4000-8000-000000000100",
    kind,
    name,
    sortOrder,
    version: 0,
  })),
};

const defaultSettings: Settings = {
  theme: "system",
  textScalePercent: 100,
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
  private tickets: Ticket[] = [];
  private ticketHistoryItems: TicketHistoryItem[] = [];
  private ticketOperations = new Map<string, string>();
  private ticketScheduleLinks: TicketScheduleLink[] = [];
  private ticketScheduleOperations = new Map<string, string>();
  private ticketFocusHistoryItems: Array<TicketFocusHistoryItem & { ticketId: string }> = [];
  private activeFocusSessionId: string | null = null;
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
    linkedTicketId: null,
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
      schemaVersion: 18,
      appVersion: "0.1.0-test",
      today: now.toISOString().slice(0, 10),
      timezoneId: Intl.DateTimeFormat().resolvedOptions().timeZone || "Asia/Tokyo",
      settings: structuredClone(this.settings),
      sync: this.syncSummary(),
      focus: structuredClone(this.focus),
      notificationPermission: "unknown",
      databaseState: "ready",
      windowPreferences: {
        mainAlwaysOnTop: false,
        compactAlwaysOnTop: false,
        analogClockAlwaysOnTop: false,
      },
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
    const now = new Date().toISOString();
    for (const link of this.ticketScheduleLinks) {
      if (link.schedule.id === request.id && link.unlinkedAt === null) {
        link.unlinkedAt = now;
        link.version += 1;
      }
    }
    return this.changeResult([request.id]);
  }

  async ticketBoard(boardId?: string): Promise<TicketBoard> {
    if (boardId && boardId !== defaultTicketBoard.id) throw new Error("ticket_board_not_found");
    return structuredClone(defaultTicketBoard);
  }

  async listTickets(
    query: TicketQuery,
  ): Promise<{ contractVersion: 1; items: Ticket[]; total: number }> {
    const term = query.search?.trim().toLocaleLowerCase("ja") ?? "";
    const filtered = this.tickets
      .filter((ticket) => query.boardId === undefined || ticket.boardId === query.boardId)
      .filter((ticket) => query.columnId === undefined || ticket.columnId === query.columnId)
      .filter((ticket) => query.priority === undefined || ticket.priority === query.priority)
      .filter((ticket) => query.includeArchived === true || ticket.archivedAt === null)
      .filter((ticket) => query.includeDeleted === true || ticket.deletedAt === null)
      .filter(
        (ticket) =>
          term === "" ||
          `${ticket.title} ${ticket.description}`.toLocaleLowerCase("ja").includes(term),
      )
      .sort((left, right) =>
        left.columnId === right.columnId
          ? left.sortKey - right.sortKey || left.id.localeCompare(right.id)
          : left.columnId.localeCompare(right.columnId),
      );
    const offset = query.offset ?? 0;
    const limit = Math.min(Math.max(query.limit ?? 500, 1), 1_000);
    return {
      contractVersion: 1,
      items: structuredClone(filtered.slice(offset, offset + limit)),
      total: filtered.length,
    };
  }

  async ticket(id: string): Promise<Ticket> {
    const ticket = this.tickets.find((candidate) => candidate.id === id);
    if (!ticket) throw new Error("ticket_not_found");
    return structuredClone(ticket);
  }

  async createTicket(operationId: string, draft: TicketDraft): Promise<Ticket> {
    const repeated = this.ticketOperations.get(operationId);
    if (repeated) return this.ticket(repeated);
    const now = new Date().toISOString();
    const target = defaultTicketBoard.columns.find((column) => column.id === draft.columnId);
    if (!target || draft.boardId !== defaultTicketBoard.id)
      throw new Error("ticket_column_invalid");
    const created: Ticket = {
      id: crypto.randomUUID(),
      boardId: draft.boardId,
      columnId: draft.columnId,
      lastNonDoneColumnId: target.kind === "done" ? null : draft.columnId,
      parentTicketId: draft.parentTicketId,
      title: draft.title.trim(),
      description: draft.description,
      priority: draft.priority,
      dueDate: draft.dueDate,
      estimateMinutes: draft.estimateMinutes,
      sortKey:
        Math.max(
          0,
          ...this.tickets
            .filter((ticket) => ticket.columnId === draft.columnId)
            .map((ticket) => ticket.sortKey),
        ) + 1_024,
      tags: [...new Set(draft.tags.map((name) => name.trim()))].map((name) => ({
        id: crypto.randomUUID(),
        name,
      })),
      checklist: draft.checklist.map((item, sortOrder) => ({
        id: crypto.randomUUID(),
        ...item,
        title: item.title.trim(),
        sortOrder,
        version: 0,
      })),
      version: 0,
      createdAt: now,
      updatedAt: now,
      completedAt: target.kind === "done" ? now : null,
      archivedAt: null,
      deletedAt: null,
    };
    this.tickets.push(created);
    this.recordTicketOperation(operationId, created, "create");
    return structuredClone(created);
  }

  async updateTicket(request: TicketUpdateRequest): Promise<Ticket> {
    const repeated = this.ticketOperations.get(request.operationId);
    if (repeated) return this.ticket(repeated);
    const index = this.ticketIndex(request.id, request.expectedVersion);
    const current = this.tickets[index]!;
    const patch = request.patch;
    if (patch.parentTicketId === current.id) throw new Error("ticket_parent_cycle");
    const updated: Ticket = {
      ...current,
      ...(patch.title !== undefined ? { title: patch.title.trim() } : {}),
      ...(patch.description !== undefined ? { description: patch.description } : {}),
      ...(patch.priority !== undefined ? { priority: patch.priority } : {}),
      ...(patch.dueDate !== undefined ? { dueDate: patch.dueDate } : {}),
      ...(patch.estimateMinutes !== undefined ? { estimateMinutes: patch.estimateMinutes } : {}),
      ...(patch.parentTicketId !== undefined ? { parentTicketId: patch.parentTicketId } : {}),
      ...(patch.tags !== undefined
        ? {
            tags: [...new Set(patch.tags.map((name) => name.trim()))].map((name) => ({
              id: crypto.randomUUID(),
              name,
            })),
          }
        : {}),
      ...(patch.checklist !== undefined
        ? {
            checklist: patch.checklist.map((item, sortOrder) => ({
              id: crypto.randomUUID(),
              ...item,
              title: item.title.trim(),
              sortOrder,
              version: 0,
            })),
          }
        : {}),
      version: current.version + 1,
      updatedAt: new Date().toISOString(),
    };
    this.tickets[index] = updated;
    this.recordTicketOperation(
      request.operationId,
      updated,
      patch.parentTicketId !== undefined ? "parent" : "update",
    );
    return structuredClone(updated);
  }

  async moveTicket(request: TicketMoveRequest): Promise<Ticket> {
    const repeated = this.ticketOperations.get(request.operationId);
    if (repeated) return this.ticket(repeated);
    const index = this.ticketIndex(request.id, request.expectedVersion);
    const current = this.tickets[index]!;
    const source = defaultTicketBoard.columns.find((column) => column.id === current.columnId);
    const target = defaultTicketBoard.columns.find(
      (column) => column.id === request.targetColumnId,
    );
    if (!source || !target) throw new Error("ticket_column_invalid");
    const ordered = this.tickets
      .filter(
        (ticket) =>
          ticket.columnId === request.targetColumnId &&
          ticket.id !== request.id &&
          ticket.deletedAt === null,
      )
      .sort((left, right) => left.sortKey - right.sortKey);
    const beforeIndex = request.beforeTicketId
      ? ordered.findIndex((ticket) => ticket.id === request.beforeTicketId)
      : ordered.length;
    if (beforeIndex < 0) throw new Error("ticket_move_target_invalid");
    ordered.splice(beforeIndex, 0, current);
    ordered.forEach((ticket, order) => {
      ticket.sortKey = (order + 1) * 1_024;
    });
    const now = new Date().toISOString();
    const updated: Ticket = {
      ...current,
      columnId: target.id,
      lastNonDoneColumnId:
        target.kind === "done"
          ? source.kind === "done"
            ? current.lastNonDoneColumnId
            : current.columnId
          : target.id,
      completedAt: target.kind === "done" ? (current.completedAt ?? now) : null,
      version: current.version + 1,
      updatedAt: now,
    };
    this.tickets[index] = updated;
    const action =
      source.kind !== "done" && target.kind === "done"
        ? "complete"
        : source.kind === "done" && target.kind !== "done"
          ? "reopen"
          : source.id === target.id
            ? "reorder"
            : "move";
    this.recordTicketOperation(request.operationId, updated, action);
    return structuredClone(updated);
  }

  async reopenTicket(operationId: string, id: string, expectedVersion: number): Promise<Ticket> {
    const current = await this.ticket(id);
    return this.moveTicket({
      operationId,
      id,
      expectedVersion,
      targetColumnId: current.lastNonDoneColumnId ?? defaultTicketBoard.columns[0]!.id,
    });
  }

  async archiveTicket(
    operationId: string,
    id: string,
    expectedVersion: number,
    archived: boolean,
  ): Promise<Ticket> {
    const repeated = this.ticketOperations.get(operationId);
    if (repeated) return this.ticket(repeated);
    const index = this.ticketIndex(id, expectedVersion);
    const updated = {
      ...this.tickets[index]!,
      archivedAt: archived ? new Date().toISOString() : null,
      version: expectedVersion + 1,
      updatedAt: new Date().toISOString(),
    };
    this.tickets[index] = updated;
    if (archived) this.deactivateTicketLinks(id);
    this.recordTicketOperation(operationId, updated, archived ? "archive" : "restore");
    return structuredClone(updated);
  }

  async deleteTicket(operationId: string, id: string, expectedVersion: number): Promise<Ticket> {
    const repeated = this.ticketOperations.get(operationId);
    if (repeated) return this.ticket(repeated);
    const index = this.ticketIndex(id, expectedVersion);
    const updated = {
      ...this.tickets[index]!,
      deletedAt: new Date().toISOString(),
      version: expectedVersion + 1,
      updatedAt: new Date().toISOString(),
    };
    this.tickets[index] = updated;
    this.deactivateTicketLinks(id);
    this.recordTicketOperation(operationId, updated, "delete");
    return structuredClone(updated);
  }

  async ticketHistory(ticketId: string, limit = 100): Promise<TicketHistoryItem[]> {
    return structuredClone(
      this.ticketHistoryItems
        .filter((item) => item.actionId && this.ticketOperations.get(item.actionId) === ticketId)
        .slice(-limit)
        .reverse(),
    );
  }

  async assignTicketSchedule(request: AssignTicketScheduleRequest): Promise<TicketScheduleLink> {
    const repeated = this.ticketScheduleOperations.get(request.operationId);
    if (repeated) return this.ticketScheduleLinkById(repeated);
    const ticket = await this.ticket(request.ticketId);
    if (ticket.version !== request.expectedTicketVersion)
      throw new Error("ticket_version_conflict");
    const start = fromZonedTime(request.localStart, request.timezoneId);
    const end = new Date(start.getTime() + request.durationMinutes * 60_000);
    const schedule = await this.createSchedule({
      title: request.titleOverride?.trim() || [...ticket.title].slice(0, 200).join(""),
      description: "",
      location: "",
      startUtc: start.toISOString(),
      endUtc: end.toISOString(),
      timezoneId: request.timezoneId,
      allDay: false,
      allDayStartDate: null,
      allDayEndDateExclusive: null,
      status: "scheduled",
      project: "",
      category: "",
      tags: [],
      color: "#6F96F4",
      priority: ticket.priority,
      recurrenceRule: null,
      recurrenceSupplementalLines: [],
      recurrenceExdates: [],
      startNotificationMinutes: null,
      endNotificationMinutes: null,
    });
    const now = new Date().toISOString();
    const link: TicketScheduleLink = {
      id: crypto.randomUUID(),
      ticketId: ticket.id,
      ticketTitle: ticket.title,
      schedule,
      linkedAt: now,
      unlinkedAt: null,
      source: request.source,
      version: 0,
    };
    this.ticketScheduleLinks.push(link);
    this.ticketScheduleOperations.set(request.operationId, link.id);
    return structuredClone(link);
  }

  async linkTicketSchedule(request: LinkTicketScheduleRequest): Promise<TicketScheduleLink> {
    const repeated = this.ticketScheduleOperations.get(request.operationId);
    if (repeated) return this.ticketScheduleLinkById(repeated);
    const ticket = await this.ticket(request.ticketId);
    const schedule = this.schedules.find((item) => item.id === request.scheduleId);
    if (!schedule) throw new Error("schedule_not_found");
    if (ticket.version !== request.expectedTicketVersion)
      throw new Error("ticket_version_conflict");
    if (schedule.version !== request.expectedScheduleVersion)
      throw new Error("schedule_version_conflict");
    const existing = this.ticketScheduleLinks.find(
      (link) => link.schedule.id === schedule.id && link.unlinkedAt === null,
    );
    if (existing && existing.ticketId === ticket.id) return structuredClone(existing);
    if (existing && request.replaceExisting !== true) throw new Error("ticket_link_conflict");
    if (existing) {
      existing.unlinkedAt = new Date().toISOString();
      existing.version += 1;
    }
    const link: TicketScheduleLink = {
      id: crypto.randomUUID(),
      ticketId: ticket.id,
      ticketTitle: ticket.title,
      schedule: structuredClone(schedule),
      linkedAt: new Date().toISOString(),
      unlinkedAt: null,
      source: request.source,
      version: 0,
    };
    this.ticketScheduleLinks.push(link);
    this.ticketScheduleOperations.set(request.operationId, link.id);
    return structuredClone(link);
  }

  async unlinkTicketSchedule(request: UnlinkTicketScheduleRequest): Promise<TicketScheduleLink> {
    const repeated = this.ticketScheduleOperations.get(request.operationId);
    if (repeated) return this.ticketScheduleLinkById(repeated);
    const link = this.ticketScheduleLinks.find((candidate) => candidate.id === request.linkId);
    if (!link || link.unlinkedAt !== null || link.version !== request.expectedLinkVersion)
      throw new Error("ticket_link_version_conflict");
    link.unlinkedAt = new Date().toISOString();
    link.version += 1;
    this.ticketScheduleOperations.set(request.operationId, link.id);
    return structuredClone(link);
  }

  async ticketSchedules(ticketId: string, includeUnlinked = false): Promise<TicketScheduleLink[]> {
    return structuredClone(
      this.ticketScheduleLinks.filter(
        (link) => link.ticketId === ticketId && (includeUnlinked || link.unlinkedAt === null),
      ),
    );
  }

  async scheduleTicketLink(scheduleId: string): Promise<TicketScheduleLink | null> {
    const link = this.ticketScheduleLinks.find(
      (candidate) => candidate.schedule.id === scheduleId && candidate.unlinkedAt === null,
    );
    return link ? structuredClone(link) : null;
  }

  async ticketPlanningSummaries(ticketIds: string[]): Promise<TicketPlanningSummary[]> {
    const now = Date.now();
    return ticketIds.map((ticketId) => {
      const allLinks = this.ticketScheduleLinks.filter((link) => link.ticketId === ticketId);
      const links = allLinks.filter(
        (link) => link.ticketId === ticketId && link.unlinkedAt === null,
      );
      const historical = [...new Map(allLinks.map((link) => [link.schedule.id, link])).values()];
      const future = links.filter((link) => Date.parse(link.schedule.endUtc) > now);
      const ticket = this.tickets.find((candidate) => candidate.id === ticketId);
      const estimate = ticket?.estimateMinutes ?? null;
      const minutes = (link: TicketScheduleLink, futureOnly: boolean) =>
        Math.max(
          0,
          Math.round(
            (Date.parse(link.schedule.endUtc) -
              (futureOnly
                ? Math.max(Date.parse(link.schedule.startUtc), now)
                : Date.parse(link.schedule.startUtc))) /
              60_000,
          ),
        );
      return {
        ticketId,
        estimateMinutes: estimate,
        scheduleCount: historical.length,
        futurePlannedMinutes: future.reduce((total, link) => total + minutes(link, true), 0),
        totalPlannedMinutes: historical.reduce((total, link) => total + minutes(link, false), 0),
        nextScheduledAt:
          future
            .map((link) => link.schedule.startUtc)
            .filter((start) => Date.parse(start) >= now)
            .sort()[0] ?? null,
        actualFocusSeconds: 0,
        remainingMinutes: estimate,
        varianceMinutes: estimate === null ? null : -estimate,
      };
    });
  }

  async ticketFocusHistory(ticketId: string): Promise<TicketFocusHistoryItem[]> {
    return structuredClone(
      this.ticketFocusHistoryItems
        .filter((item) => item.ticketId === ticketId)
        .map((item) => ({
          sessionId: item.sessionId,
          scheduleId: item.scheduleId,
          startedAt: item.startedAt,
          endedAt: item.endedAt,
          workSeconds: item.workSeconds,
        })),
    );
  }

  private async ticketScheduleLinkById(id: string): Promise<TicketScheduleLink> {
    const link = this.ticketScheduleLinks.find((candidate) => candidate.id === id);
    if (!link) throw new Error("ticket_link_not_found");
    return structuredClone(link);
  }

  private deactivateTicketLinks(ticketId: string): void {
    const now = new Date().toISOString();
    for (const link of this.ticketScheduleLinks) {
      if (link.ticketId === ticketId && link.unlinkedAt === null) {
        link.unlinkedAt = now;
        link.version += 1;
      }
    }
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
      const scheduleId = linkedScheduleId ?? this.focus.linkedScheduleId;
      const activeLink = scheduleId
        ? this.ticketScheduleLinks.find(
            (link) => link.schedule.id === scheduleId && link.unlinkedAt === null,
          )
        : undefined;
      if (command === "start" && this.focus.phase === "idle" && activeLink) {
        this.activeFocusSessionId = crypto.randomUUID();
        this.ticketFocusHistoryItems.unshift({
          ticketId: activeLink.ticketId,
          sessionId: this.activeFocusSessionId,
          scheduleId: scheduleId ?? null,
          startedAt: now.toISOString(),
          endedAt: null,
          workSeconds: 0,
        });
      }
      this.focus = {
        ...this.focus,
        phase: "working",
        startedAt: now.toISOString(),
        endsAt: new Date(now.getTime() + this.settings.focusWorkMinutes * 60_000).toISOString(),
        linkedScheduleId: scheduleId,
        linkedTicketId:
          command === "start" ? (activeLink?.ticketId ?? null) : this.focus.linkedTicketId,
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
      const history = this.ticketFocusHistoryItems.find(
        (item) => item.sessionId === this.activeFocusSessionId,
      );
      if (history) history.endedAt = now.toISOString();
      this.activeFocusSessionId = null;
      this.focus = {
        phase: "idle",
        startedAt: null,
        endsAt: null,
        accumulatedSeconds: 0,
        cycle: this.focus.cycle,
        linkedScheduleId: null,
        linkedTicketId: null,
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
      schemaVersion: 18,
      databaseState: "ready",
      scheduleCount: this.schedules.filter((item) => item.deletedAt === null).length,
      deletedCount: this.schedules.filter((item) => item.deletedAt !== null).length,
      outboxCount: 0,
      conflictCount: 0,
      googleTasksSelectedListCount: 0,
      googleTasksMappedTicketCount: 0,
      googleTasksPendingOutboxCount: 0,
      googleTasksConflictCount: 0,
      googleTasksLastSuccessAt: null,
      googleTasksLastErrorCategory: null,
      googleTasksNextRetryAt: null,
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

  async openAnalogClockWindow(): Promise<void> {
    return Promise.resolve();
  }

  async resizeAnalogClockWindow(): Promise<void> {
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
    this.tickets = [];
    this.ticketHistoryItems = [];
    this.ticketOperations.clear();
    this.ticketScheduleLinks = [];
    this.ticketFocusHistoryItems = [];
    this.activeFocusSessionId = null;
    this.ticketScheduleOperations.clear();
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
      textScalePercent: 100,
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
      linkedTicketId: null,
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
      schemaVersion: 18,
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
        "https://www.googleapis.com/auth/tasks",
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
      tasks: this.emptyGoogleTasksConnection(),
    };
  }

  async updateGoogleCalendar(): Promise<GoogleCalendar> {
    throw new Error("calendar_not_found");
  }

  async googleTasksConnection(): Promise<GoogleTasksConnection> {
    return this.emptyGoogleTasksConnection();
  }

  async reconcileGoogleTasksFull(): Promise<GoogleTasksConnection> {
    return this.emptyGoogleTasksConnection();
  }

  async setGoogleTasksEnabled(enabled: boolean): Promise<GoogleTasksConnection> {
    return { ...this.emptyGoogleTasksConnection(), enabled, state: enabled ? "never" : "disabled" };
  }

  async updateGoogleTaskList(): Promise<GoogleTaskList> {
    throw new Error("task_list_not_found");
  }

  async ticketGoogleTaskStatuses(ticketIds: string[]): Promise<TicketGoogleTaskStatus[]> {
    return ticketIds.map((ticketId) => ({
      ticketId,
      state: "disabled",
      taskListId: null,
      taskListName: null,
      lastSyncAt: null,
      errorCategory: null,
      pendingOperation: null,
      conflictCount: 0,
    }));
  }

  async updateTicketGoogleTaskTarget(request: {
    ticketId: string;
  }): Promise<TicketGoogleTaskStatus> {
    return (await this.ticketGoogleTaskStatuses([request.ticketId]))[0]!;
  }

  async googleTaskConflicts(): Promise<GoogleTaskConflict[]> {
    return [];
  }

  async resolveGoogleTaskConflict(): Promise<TicketGoogleTaskStatus> {
    throw new Error("task_conflict_not_found");
  }

  async disconnectGoogle(): Promise<number> {
    return 0;
  }

  private emptyGoogleTasksConnection(): GoogleTasksConnection {
    return {
      enabled: false,
      scopeGranted: false,
      state: "not_connected",
      taskLists: [],
      mappedTicketCount: 0,
      pendingOutboxCount: 0,
      conflictCount: 0,
      selectedListCount: 0,
      lastSuccessAt: null,
      nextRetryAt: null,
    };
  }

  private checkpoint(): void {
    this.undoStack.push({ schedules: structuredClone(this.schedules) });
    this.redoStack = [];
  }

  private ticketIndex(id: string, expectedVersion: number): number {
    const index = this.tickets.findIndex((ticket) => ticket.id === id);
    if (index < 0) throw new Error("ticket_not_found");
    const current = this.tickets[index]!;
    if (current.version !== expectedVersion) throw new Error("ticket_version_conflict");
    if (current.deletedAt !== null) throw new Error("ticket_deleted");
    return index;
  }

  private recordTicketOperation(
    operationId: string,
    ticket: Ticket,
    action: TicketHistoryItem["action"],
  ): void {
    this.ticketOperations.set(operationId, ticket.id);
    this.ticketHistoryItems.push({
      id: this.ticketHistoryItems.length + 1,
      actionId: operationId,
      action,
      version: ticket.version,
      createdAt: ticket.updatedAt,
    });
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
