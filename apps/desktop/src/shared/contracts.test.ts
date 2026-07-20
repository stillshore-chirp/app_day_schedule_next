import { describe, expect, it } from "vitest";
import { scheduleDraftSchema } from "./contracts";

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
