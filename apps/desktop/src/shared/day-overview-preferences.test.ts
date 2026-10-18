import { afterEach, describe, expect, it } from "vitest";
import {
  dayOverviewStartMinuteStorageKey,
  dayOverviewModeStorageKey,
  isDayOverviewStartMinute,
  normalizeDayOverviewStartMinute,
  readDayOverviewStartMinute,
  readDayOverviewPreferences,
  saveDayOverviewPreferences,
} from "./day-overview-preferences";

afterEach(() => {
  localStorage.clear();
});

describe("day overview start preference", () => {
  it("normalizes saved five-minute values to the nearest whole hour", () => {
    localStorage.setItem(dayOverviewStartMinuteStorageKey, "410");

    expect(readDayOverviewStartMinute()).toBe(420);
    expect(normalizeDayOverviewStartMinute(365)).toBe(360);
    expect(normalizeDayOverviewStartMinute(1435)).toBe(0);
    expect(isDayOverviewStartMinute(420)).toBe(true);
    expect(isDayOverviewStartMinute(410)).toBe(false);
  });

  it("persists the centered mode and bounded display width with the existing start setting", () => {
    localStorage.setItem("day-schedule-next.day-overview-mode", "template");
    expect(readDayOverviewPreferences()).toMatchObject({
      startMinute: 0,
      mode: "fixed",
      windowHours: 24,
    });

    saveDayOverviewPreferences({ startMinute: 420, mode: "centered", windowHours: 6 });

    expect(readDayOverviewPreferences()).toEqual({
      startMinute: 420,
      mode: "centered",
      windowHours: 6,
    });
    expect(localStorage.getItem("day-schedule-next.day-overview-mode")).toBe("template");
    expect(localStorage.getItem(dayOverviewModeStorageKey)).toBe("centered");
    saveDayOverviewPreferences({ windowHours: 99 });
    expect(readDayOverviewPreferences().windowHours).toBe(24);
  });
});
