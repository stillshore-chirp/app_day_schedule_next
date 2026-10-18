import { afterEach, describe, expect, it } from "vitest";
import {
  dayOverviewStartMinuteStorageKey,
  isDayOverviewStartMinute,
  normalizeDayOverviewStartMinute,
  readDayOverviewStartMinute,
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
});
