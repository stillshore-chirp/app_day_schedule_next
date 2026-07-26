import { describe, expect, it } from "vitest";
import type { Schedule } from "../../shared/contracts";
import { assignTimelineLanes, isCurrent, nextSchedule } from "./timeline-layout";

const selectedDate = new Date(2026, 6, 20);

function localIso(day: number, hour: number, minute = 0): string {
  return new Date(2026, 6, day, hour, minute).toISOString();
}

function schedule(id: string, start: string, end: string): Schedule {
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

describe("assignTimelineLanes", () => {
  it("treats adjacent half-open intervals as separate, reusable lanes", () => {
    const items = assignTimelineLanes(
      [
        schedule("00000000-0000-4000-8000-000000000001", localIso(20, 9), localIso(20, 10)),
        schedule("00000000-0000-4000-8000-000000000002", localIso(20, 10), localIso(20, 11)),
      ],
      selectedDate,
    );
    expect(items.map((item) => [item.lane, item.laneCount])).toEqual([
      [0, 1],
      [0, 1],
    ]);
  });

  it("assigns deterministic side-by-side lanes to positive overlap", () => {
    const input = [
      schedule("00000000-0000-4000-8000-000000000003", localIso(20, 9, 15), localIso(20, 11)),
      schedule("00000000-0000-4000-8000-000000000001", localIso(20, 9), localIso(20, 10)),
      schedule("00000000-0000-4000-8000-000000000002", localIso(20, 9, 30), localIso(20, 9, 45)),
    ];
    const first = assignTimelineLanes(input, selectedDate);
    const second = assignTimelineLanes([...input].reverse(), selectedDate);
    expect(first).toEqual(second);
    expect(first.map((item) => item.laneCount)).toEqual([3, 3, 3]);
    expect(new Set(first.map((item) => item.lane))).toEqual(new Set([0, 1, 2]));
  });

  it("keeps one identity while clipping a cross-midnight item to the selected day", () => {
    const [item] = assignTimelineLanes(
      [schedule("00000000-0000-4000-8000-000000000001", localIso(19, 23, 30), localIso(20, 1))],
      selectedDate,
    );
    expect(item?.startMinute).toBe(0);
    expect(item?.endMinute).toBe(60);
    expect(item?.schedule.id).toBe("00000000-0000-4000-8000-000000000001");
  });
});

describe("current and next", () => {
  const items = [
    schedule("00000000-0000-4000-8000-000000000001", localIso(20, 9), localIso(20, 10)),
    schedule("00000000-0000-4000-8000-000000000002", localIso(20, 10), localIso(20, 11)),
  ];

  it("uses a half-open interval for current", () => {
    expect(isCurrent(items[0]!, new Date(2026, 6, 20, 9, 59, 59))).toBe(true);
    expect(isCurrent(items[0]!, new Date(2026, 6, 20, 10))).toBe(false);
  });

  it("selects the earliest future item", () => {
    expect(nextSchedule(items, new Date(2026, 6, 20, 9, 30))?.id).toBe(
      "00000000-0000-4000-8000-000000000002",
    );
  });
});
