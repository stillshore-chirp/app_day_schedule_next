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
    recurrenceSupplementalLines: [],
    recurrenceExdates: [],
    startNotificationMinutes: null,
    endNotificationMinutes: null,
    syncStatus: "local_only",
    version: 0,
    deletedAt: null,
  };
}

function localIso(day: number, hour: number, minute = 0): string {
  return new Date(2026, 6, day, hour, minute).toISOString();
}

describe("layoutOverview", () => {
  it("groups a transitive overlap component only at five minutes or more", () => {
    const date = new Date(2026, 6, 20);
    const result = layoutOverview(
      [
        item("a", localIso(20, 9), localIso(20, 10)),
        item("b", localIso(20, 9, 55), localIso(20, 10, 30)),
        item("c", localIso(20, 10, 25), localIso(20, 11)),
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
    const date = new Date(2026, 6, 20);
    const result = layoutOverview(
      [
        item("a", localIso(20, 9), localIso(20, 10)),
        item("b", localIso(20, 9, 56), localIso(20, 10, 30)),
      ],
      date,
    );
    expect(result.map((value) => value.levelCount)).toEqual([1, 1]);
  });
});
