import { describe, expect, it } from "vitest";
import ticketContractFixture from "./fixtures/ticket-contract-v1.json";
import {
  scheduleDraftSchema,
  settingsSchema,
  stopwatchSchema,
  timerDraftSchema,
  timerSetSchema,
  ticketDraftSchema,
  ticketSchema,
} from "./contracts";

const valid = {
  title: "境界テスト",
  description: "synthetic fixture",
  location: "",
  startUtc: "2026-07-20T00:00:00.000Z",
  endUtc: "2026-07-20T00:01:00.000Z",
  timezoneId: "Asia/Tokyo",
  allDay: false,
  allDayStartDate: null,
  allDayEndDateExclusive: null,
  status: "scheduled" as const,
  project: "",
  category: "",
  tags: [],
  color: "#336699",
  priority: "normal" as const,
  recurrenceRule: null,
  recurrenceSupplementalLines: [],
  recurrenceExdates: [],
  startNotificationMinutes: null,
  endNotificationMinutes: null,
};

describe("scheduleDraftSchema", () => {
  it("accepts a one-minute schedule", () => {
    expect(scheduleDraftSchema.safeParse(valid).success).toBe(true);
  });

  it("rejects zero and negative durations", () => {
    expect(scheduleDraftSchema.safeParse({ ...valid, endUtc: valid.startUtc }).success).toBe(false);
    expect(
      scheduleDraftSchema.safeParse({ ...valid, endUtc: "2026-07-19T23:59:00.000Z" }).success,
    ).toBe(false);
  });

  it("rejects invalid colors and empty titles", () => {
    expect(scheduleDraftSchema.safeParse({ ...valid, color: "transparent" }).success).toBe(false);
    expect(scheduleDraftSchema.safeParse({ ...valid, title: " " }).success).toBe(false);
  });

  it("accepts parameterized recurrence-set lines and rejects unsafe properties", () => {
    expect(
      scheduleDraftSchema.safeParse({
        ...valid,
        recurrenceSupplementalLines: [
          "RRULE:FREQ=MONTHLY;BYDAY=-1MO;WKST=SU",
          "RDATE;TZID=Asia/Tokyo:20260723T090000",
          "EXRULE:FREQ=WEEKLY;BYDAY=SU",
        ],
      }).success,
    ).toBe(true);
    expect(
      scheduleDraftSchema.safeParse({
        ...valid,
        recurrenceSupplementalLines: ["DTSTART;TZID=Asia/Tokyo:20260723T090000"],
      }).success,
    ).toBe(false);
    expect(
      scheduleDraftSchema.safeParse({
        ...valid,
        recurrenceSupplementalLines: ["RDATE:20260723T090000\nRRULE:FREQ=DAILY"],
      }).success,
    ).toBe(false);
  });
});

describe("timer contracts", () => {
  it("accepts second precision and rejects zero or over-seven-day durations", () => {
    expect(timerDraftSchema.safeParse({ label: "紅茶", durationSeconds: 1 }).success).toBe(true);
    expect(timerDraftSchema.safeParse({ label: "", durationSeconds: 0 }).success).toBe(false);
    expect(timerDraftSchema.safeParse({ label: "", durationSeconds: 604_801 }).success).toBe(false);
  });

  it("requires a non-empty named set and a valid persisted stopwatch", () => {
    expect(
      timerSetSchema.safeParse({
        id: "00000000-0000-4000-8000-000000000001",
        name: "朝",
        version: 0,
        items: [{ label: "準備", durationSeconds: 300, sortOrder: 0 }],
      }).success,
    ).toBe(true);
    expect(
      stopwatchSchema.safeParse({ status: "running", elapsedSeconds: 12, version: 1 }).success,
    ).toBe(true);
  });
});

describe("settingsSchema", () => {
  it("accepts the mild theme and rejects unknown theme names", () => {
    const settings = {
      theme: "mild",
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

    expect(settingsSchema.safeParse(settings).success).toBe(true);
    expect(settingsSchema.safeParse({ ...settings, theme: "sepia" }).success).toBe(false);
  });
});

describe("ticket contracts", () => {
  const ticketDraft = {
    boardId: "00000000-0000-4000-8000-000000000100",
    columnId: "00000000-0000-4000-8000-000000000101",
    parentTicketId: null,
    title: "T".repeat(1_024),
    description: "synthetic fixture",
    priority: "normal" as const,
    dueDate: "2026-08-04",
    estimateMinutes: 30,
    tags: ["synthetic"],
    checklist: [{ title: "synthetic item", completed: false }],
  };

  it("preserves a 1024-character title and rejects 1025 characters", () => {
    expect(ticketDraftSchema.safeParse(ticketDraft).success).toBe(true);
    expect(ticketDraftSchema.safeParse({ ...ticketDraft, title: "T".repeat(1_025) }).success).toBe(
      false,
    );
  });

  it("parses the same versioned fixture as the Rust contract", () => {
    expect(ticketContractFixture.contractVersion).toBe(1);
    expect(ticketDraftSchema.parse(ticketContractFixture.draft).title).toBe(
      "Synthetic ticket contract",
    );
    expect(ticketContractFixture.doneReturn.lastNonDoneColumnId).toBe(ticketDraft.columnId);
  });

  it("rejects unknown request fields and validates parent and Done-return fields", () => {
    expect(ticketDraftSchema.safeParse({ ...ticketDraft, unknown: true }).success).toBe(false);
    expect(
      ticketSchema.safeParse({
        id: "00000000-0000-4000-8000-000000000201",
        ...ticketDraft,
        lastNonDoneColumnId: ticketDraft.columnId,
        sortKey: 1_024,
        tags: [{ id: "00000000-0000-4000-8000-000000000301", name: "synthetic" }],
        checklist: [
          {
            id: "00000000-0000-4000-8000-000000000401",
            title: "synthetic item",
            completed: false,
            sortOrder: 0,
            version: 0,
          },
        ],
        version: 1,
        createdAt: "2026-08-03T00:00:00.000Z",
        updatedAt: "2026-08-03T00:01:00.000Z",
        completedAt: null,
        archivedAt: null,
        deletedAt: null,
      }).success,
    ).toBe(true);
  });
});
