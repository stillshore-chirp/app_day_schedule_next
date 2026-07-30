import { describe, expect, it } from "vitest";
import type { Schedule } from "../../shared/contracts";
import {
  assignOverviewLevels,
  layoutOverview,
  layoutSchedulesForDay,
  minuteToPercent,
} from "./overview-layout";

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
      [0, 2],
      [1, 2],
      [0, 2],
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

  it("clamps cross-midnight schedules to the selected day", () => {
    const date = new Date(2026, 6, 20);
    const result = layoutSchedulesForDay(
      [item("overnight", localIso(19, 23), localIso(20, 1))],
      date,
    );
    expect(result.map(({ startMinute, endMinute }) => [startMinute, endMinute])).toEqual([[0, 60]]);
  });

  it("maps minute boundaries to a shared deterministic percentage", () => {
    expect([0, 1, 720, 1439, 1440].map(minuteToPercent)).toEqual([
      0,
      100 / 1440,
      50,
      (1439 / 1440) * 100,
      100,
    ]);
  });

  it("uses stable order and key tie-breaks for identical intervals", () => {
    const result = assignOverviewLevels(
      [
        { key: "c", value: "c", startMinute: 60, endMinute: 120, stableOrder: 2 },
        { key: "b", value: "b", startMinute: 60, endMinute: 120, stableOrder: 1 },
        { key: "a", value: "a", startMinute: 60, endMinute: 120, stableOrder: 1 },
      ],
      5,
    );
    expect(result.map((item) => [item.key, item.level, item.levelCount])).toEqual([
      ["a", 0, 3],
      ["b", 1, 3],
      ["c", 2, 3],
    ]);
  });
});
