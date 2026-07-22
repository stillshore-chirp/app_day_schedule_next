import { describe, expect, it } from "vitest";
import {
  scheduleDraftSchema,
  stopwatchSchema,
  timerDraftSchema,
  timerSetSchema,
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
