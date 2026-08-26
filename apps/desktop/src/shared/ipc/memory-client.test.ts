import { describe, expect, it } from "vitest";
import type { ScheduleDraft, TicketDraft } from "../contracts";
import { MemoryAppClient } from "./memory-client";

const draft: ScheduleDraft = {
  title: "追加する予定",
  description: "synthetic fixture",
  location: "",
  startUtc: "2026-07-20T00:00:00.000Z",
  endUtc: "2026-07-20T01:00:00.000Z",
  timezoneId: "Asia/Tokyo",
  allDay: false,
  allDayStartDate: null,
  allDayEndDateExclusive: null,
  status: "scheduled",
  project: "テスト",
  category: "実装",
  tags: ["fixture"],
  color: "#336699",
  priority: "normal",
  recurrenceRule: null,
  recurrenceSupplementalLines: [],
  recurrenceExdates: [],
  startNotificationMinutes: null,
  endNotificationMinutes: null,
};

const ticketDraft: TicketDraft = {
  boardId: "00000000-0000-4000-8000-000000000100",
  columnId: "00000000-0000-4000-8000-000000000101",
  parentTicketId: null,
  title: "synthetic ticket",
  description: "synthetic fixture",
  priority: "normal",
  dueDate: "2026-08-04",
  estimateMinutes: 30,
  tags: ["synthetic"],
  checklist: [{ title: "synthetic item", completed: false }],
};

describe("MemoryAppClient", () => {
  it("restores a Done ticket to its previous non-Done column", async () => {
    const client = new MemoryAppClient([]);
    const created = await client.createTicket(crypto.randomUUID(), ticketDraft);
    const done = await client.moveTicket({
      operationId: crypto.randomUUID(),
      id: created.id,
      expectedVersion: created.version,
      targetColumnId: "00000000-0000-4000-8000-000000000106",
    });
    const reopened = await client.reopenTicket(crypto.randomUUID(), done.id, done.version);

    expect(reopened.columnId).toBe(ticketDraft.columnId);
    expect(reopened.completedAt).toBeNull();
  });

  it("keeps Omit incomplete and restores Done tickets to Omit", async () => {
    const client = new MemoryAppClient([]);
    const operationId = crypto.randomUUID();
    const created = await client.createTicket(operationId, ticketDraft);
    const repeated = await client.createTicket(operationId, { ...ticketDraft, title: "ignored" });
    expect(repeated.id).toBe(created.id);
    const updated = await client.updateTicket({
      operationId: crypto.randomUUID(),
      id: created.id,
      expectedVersion: created.version,
      patch: { title: "updated synthetic ticket" },
    });
    const omitted = await client.moveTicket({
      operationId: crypto.randomUUID(),
      id: updated.id,
      expectedVersion: updated.version,
      targetColumnId: "00000000-0000-4000-8000-000000000107",
    });
    expect(omitted.completedAt).toBeNull();
    const done = await client.moveTicket({
      operationId: crypto.randomUUID(),
      id: omitted.id,
      expectedVersion: omitted.version,
      targetColumnId: "00000000-0000-4000-8000-000000000106",
    });
    expect(done.completedAt).not.toBeNull();
    const reopened = await client.reopenTicket(crypto.randomUUID(), done.id, done.version);
    expect(reopened.columnId).toBe("00000000-0000-4000-8000-000000000107");
    expect(reopened.completedAt).toBeNull();
    expect((await client.ticketHistory(created.id)).map((item) => item.action)).toEqual([
      "reopen",
      "complete",
      "move",
      "update",
      "create",
    ]);
    await expect(
      client.updateTicket({
        operationId: crypto.randomUUID(),
        id: reopened.id,
        expectedVersion: 0,
        patch: { title: "stale" },
      }),
    ).rejects.toThrow("ticket_version_conflict");
  });
  it("creates, updates, soft-deletes and undoes a schedule", async () => {
    const client = new MemoryAppClient([]);
    const created = await client.createSchedule(draft);
    expect(created.version).toBe(0);
    const updated = await client.updateSchedule({
      id: created.id,
      expectedVersion: created.version,
      draft: { ...draft, title: "更新した予定" },
    });
    expect(updated.title).toBe("更新した予定");
    expect(updated.version).toBe(1);
    await client.deleteSchedule({ id: updated.id, expectedVersion: updated.version });
    const empty = await client.listSchedules({
      startUtc: "2026-07-19T00:00:00.000Z",
      endUtc: "2026-07-21T00:00:00.000Z",
    });
    expect(empty.total).toBe(0);
    await client.undo();
    const restored = await client.listSchedules({
      startUtc: "2026-07-19T00:00:00.000Z",
      endUtc: "2026-07-21T00:00:00.000Z",
    });
    expect(restored.items[0]?.title).toBe("更新した予定");
  });

  it("filters synthetic text without exposing deleted rows", async () => {
    const client = new MemoryAppClient([]);
    await client.createSchedule(draft);
    const found = await client.listSchedules({
      startUtc: "2026-07-19T00:00:00.000Z",
      endUtc: "2026-07-21T00:00:00.000Z",
      search: "fixture",
    });
    expect(found.total).toBe(1);
    const missing = await client.listSchedules({
      startUtc: "2026-07-19T00:00:00.000Z",
      endUtc: "2026-07-21T00:00:00.000Z",
      search: "該当なし",
    });
    expect(missing.total).toBe(0);
  });

  it("persists settings and exercises Focus transitions", async () => {
    const client = new MemoryAppClient([]);
    const bootstrap = await client.bootstrap();
    const settings = await client.updateSettings({
      ...bootstrap.settings,
      focusWorkMinutes: 45,
    });
    expect(settings.focusWorkMinutes).toBe(45);
    const defaults = await client.defaultSettings();
    expect(defaults.focusWorkMinutes).toBe(25);
    expect(defaults.theme).toBe("system");
    expect(defaults.textScalePercent).toBe(100);
    expect((await client.focusCommand("start")).phase).toBe("working");
    expect((await client.focusCommand("pause")).phase).toBe("paused");
    expect((await client.focusCommand("resume")).phase).toBe("working");
    expect((await client.focusCommand("skip")).phase).toBe("break");
    expect((await client.focusCommand("stop")).phase).toBe("idle");
  });

  it("manages templates, Quick Blocks, and alarms with versioned saves", async () => {
    const client = new MemoryAppClient([]);
    const createdTemplate = await client.saveTemplate({
      draft: {
        name: "平日",
        description: "synthetic fixture",
        color: "#336699",
        weekdaysMask: 31,
        blocks: [
          {
            title: "集中",
            startMinute: 540,
            durationMinutes: 60,
            color: "#336699",
            project: "",
            category: "",
          },
        ],
      },
    });
    expect((await client.listTemplates()).length).toBe(2);
    const updatedTemplate = await client.saveTemplate({
      id: createdTemplate.id,
      expectedVersion: createdTemplate.version,
      draft: {
        name: "平日更新",
        description: "",
        color: "#336699",
        weekdaysMask: 31,
        blocks: [
          {
            title: "集中",
            startMinute: 540,
            durationMinutes: 60,
            color: "#336699",
            project: "",
            category: "",
          },
        ],
      },
    });
    expect(updatedTemplate.version).toBe(1);
    const preview = await client.previewTemplate({
      templateId: createdTemplate.id,
      date: "2026-07-21",
      timezoneId: "Asia/Tokyo",
      mode: "add",
    });
    expect(preview.items).toHaveLength(1);
    const applied = await client.applyTemplate({
      templateId: createdTemplate.id,
      date: "2026-07-21",
      timezoneId: "Asia/Tokyo",
      mode: "replace",
    });
    expect(applied.changedIds).toHaveLength(1);
    await client.deleteTemplate({
      id: updatedTemplate.id,
      expectedVersion: updatedTemplate.version,
    });

    const quick = await client.saveQuickBlock({
      draft: {
        title: "朝支度",
        startMinute: 420,
        durationMinutes: 30,
        timezoneId: "Asia/Tokyo",
        color: "#336699",
        project: "",
        category: "",
        startNotificationMinutes: null,
        endNotificationMinutes: null,
        isActive: true,
      },
    });
    expect((await client.listQuickBlocks())[0]?.isActive).toBe(true);
    const quickUpdated = await client.saveQuickBlock({
      id: quick.id,
      expectedVersion: quick.version,
      draft: { ...quick, isActive: false },
    });
    await client.deleteQuickBlock({ id: quickUpdated.id, expectedVersion: quickUpdated.version });
    expect(await client.listQuickBlocks()).toEqual([]);

    const alarm = await client.saveFreeAlarm({
      draft: {
        label: "開始",
        minuteOfDay: 480,
        timezoneId: "Asia/Tokyo",
        weekdaysMask: 127,
        enabled: true,
      },
    });
    expect((await client.listFreeAlarms())[0]?.label).toBe("開始");
    const alarmUpdated = await client.saveFreeAlarm({
      id: alarm.id,
      expectedVersion: alarm.version,
      draft: { ...alarm, enabled: false },
    });
    await client.deleteFreeAlarm({ id: alarmUpdated.id, expectedVersion: alarmUpdated.version });
    expect(await client.listFreeAlarms()).toEqual([]);
  });

  it("reports diagnostics, sync, redo, and compact-window no-op", async () => {
    const client = new MemoryAppClient([]);
    await client.createSchedule(draft);
    await client.undo();
    expect((await client.redo()).changedIds.length).toBeGreaterThan(0);
    expect((await client.runSync(crypto.randomUUID())).state).toBe("disconnected");
    expect((await client.diagnostics()).integrity).toBe("ok");
    await expect(client.openCompactWindow()).resolves.toBeUndefined();
  });

  it("covers every native-boundary fallback without external side effects", async () => {
    const client = new MemoryAppClient([]);
    expect((await client.resolveLocalTime("2026-07-20T09:00", "Asia/Tokyo")).kind).toBe("single");
    expect(
      (
        await client.previewRecurrence({
          startUtc: draft.startUtc,
          endUtc: draft.endUtc,
          recurrenceRule: "FREQ=DAILY;COUNT=2",
        })
      ).infinite,
    ).toBe(false);
    expect((await client.currentFocus()).phase).toBe("idle");
    expect((await client.focusHistoryToday()).entries).toEqual([]);
    expect(await client.listSyncQueue()).toEqual([]);
    expect(await client.retrySyncQueue()).toBe(0);
    expect(await client.listSyncConflicts()).toEqual([]);
    await expect(client.resolveSyncConflict()).rejects.toThrow("conflict_not_found");
    expect((await client.exportDiagnostics()).fileName).toBe("diagnostics.json");
    await expect(client.setWindowAlwaysOnTop()).resolves.toBeUndefined();
    expect((await client.exportData("/tmp/example.json", crypto.randomUUID())).fileName).toBe(
      "example.json",
    );
    expect((await client.previewImport()).formatVersion).toBe(2);
    expect((await client.importData()).importedScheduleCount).toBe(0);
    expect((await client.previewLegacyImport()).excluded).toContain("旧ウィンドウ位置");
    expect((await client.importLegacy()).selectedTemplateId).toBeTruthy();
    expect((await client.createBackup(crypto.randomUUID())).verified).toBe(true);
    expect(await client.listBackups()).toEqual([]);
    expect((await client.stageRestore("backup-id")).requiresRestart).toBe(true);
    expect(await client.pollNotifications()).toEqual([]);
    expect(await client.notificationLedger()).toEqual([]);
    await expect(client.recordNotificationResult()).resolves.toBeUndefined();
    expect((await client.importGoogleOAuthConfig()).configured).toBe(true);
    expect((await client.beginGoogleOAuth()).openedInSystemBrowser).toBe(false);
    expect((await client.googleConnection()).state).toBe("not_configured");
    await expect(client.updateGoogleCalendar()).rejects.toThrow("calendar_not_found");
    expect(await client.disconnectGoogle()).toBe(0);
    await expect(client.deleteAllUserData("不一致")).rejects.toThrow("confirmation_mismatch");
    await client.createSchedule(draft);
    expect(await client.deleteAllUserData("すべてのローカルデータを削除")).toBe(1);
    expect(
      (
        await client.listSchedules({
          startUtc: "2026-07-19T00:00:00.000Z",
          endUtc: "2026-07-21T00:00:00.000Z",
        })
      ).total,
    ).toBe(0);
  });
});
