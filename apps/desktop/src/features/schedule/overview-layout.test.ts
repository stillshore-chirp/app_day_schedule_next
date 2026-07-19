import { describe, expect, it } from "vitest";
import type { Schedule } from "../../shared/contracts";
import { layoutOverview } from "./overview-layout";

function item(id: string, start: string, end: string): Schedule {
  return {
    id,
    title: id,
    description: "",
    location: "",
    startUtc: new Date(start).toISOString(),
    endUtc: new Date(end).toISOString(),
    timezoneId: "Asia/Tokyo",
    allDay: false,
    allDayStartDate: null,
    allDayEndDateExclusive: null,
    status: "scheduled",
    project: "",
    category: "",
    tags: [],
    color: "#336699",
    priority: "normal",
    recurrenceRule: null,
    recurrenceExdates: [],
    startNotificationMinutes: null,
    endNotificationMinutes: null,
    syncStatus: "local_only",
    version: 0,
    deletedAt: null,
  };
}

describe("layoutOverview", () => {
  it("groups a transitive overlap component only at five minutes or more", () => {
    const date = new Date("2026-07-20T00:00:00+09:00");
    const result = layoutOverview(
      [
        item("a", "2026-07-20T09:00:00+09:00", "2026-07-20T10:00:00+09:00"),
        item("b", "2026-07-20T09:55:00+09:00", "2026-07-20T10:30:00+09:00"),
        item("c", "2026-07-20T10:25:00+09:00", "2026-07-20T11:00:00+09:00"),
      ],
      date,
    );
    expect(result.map((value) => [value.level, value.levelCount])).toEqual([
      [0, 3],
      [1, 3],
      [2, 3],
    ]);
  });

  it("does not stack a four-minute overlap", () => {
    const date = new Date("2026-07-20T00:00:00+09:00");
    const result = layoutOverview(
      [
        item("a", "2026-07-20T09:00:00+09:00", "2026-07-20T10:00:00+09:00"),
        item("b", "2026-07-20T09:56:00+09:00", "2026-07-20T10:30:00+09:00"),
      ],
      date,
    );
    expect(result.map((value) => value.levelCount)).toEqual([1, 1]);
  });
});
