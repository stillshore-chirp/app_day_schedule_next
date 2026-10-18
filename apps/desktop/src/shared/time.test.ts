import { describe, expect, it } from "vitest";
import {
  clampScheduleToDay,
  clampScheduleToDayOverview,
  dateInputValue,
  dayRange,
  dayOverviewMinuteAt,
  dayOverviewRange,
  formatDateHeading,
  formatDuration,
  formatTime,
  localDateTimeInput,
  minutesSinceDayStart,
} from "./time";

describe("time display helpers", () => {
  it("formats minute and hour durations", () => {
    expect(formatDuration(1)).toBe("1分");
    expect(formatDuration(60)).toBe("1時間");
    expect(formatDuration(125)).toBe("2時間5分");
  });

  it("creates a half-open local day range", () => {
    const date = new Date(2026, 6, 20, 12, 0, 0);
    const range = dayRange(date);
    expect(Date.parse(range.endUtc) - Date.parse(range.startUtc)).toBe(86_400_000);
  });

  it("uses a 24-hour local window ending at the following day's same clock time", () => {
    const date = new Date(2026, 6, 20, 12, 0, 0);
    expect(dayOverviewRange(date, 0)).toEqual(dayRange(date));
    const range = dayOverviewRange(date, 7 * 60);
    expect(new Date(range.startUtc)).toEqual(new Date(2026, 6, 20, 7));
    expect(new Date(range.endUtc)).toEqual(new Date(2026, 6, 21, 7));
  });

  it("clips events at the 07:00-to-next-07:00 overview boundaries", () => {
    const date = new Date(2026, 6, 20, 12, 0, 0);
    expect(
      clampScheduleToDayOverview(
        new Date(2026, 6, 20, 6, 30).toISOString(),
        new Date(2026, 6, 20, 8, 0).toISOString(),
        date,
        7 * 60,
      ),
    ).toEqual({ startMinute: 0, endMinute: 60 });
    expect(
      clampScheduleToDayOverview(
        new Date(2026, 6, 21, 6, 30).toISOString(),
        new Date(2026, 6, 21, 7, 30).toISOString(),
        date,
        7 * 60,
      ),
    ).toEqual({ startMinute: 1410, endMinute: 1440 });
  });

  it("positions only instants inside the selected 24-hour window", () => {
    const date = new Date(2026, 6, 20, 12, 0, 0);
    expect(dayOverviewMinuteAt(new Date(2026, 6, 20, 6, 59), date, 7 * 60)).toBeNull();
    expect(dayOverviewMinuteAt(new Date(2026, 6, 20, 7, 0), date, 7 * 60)).toBe(0);
    expect(dayOverviewMinuteAt(new Date(2026, 6, 21, 6, 30), date, 7 * 60)).toBe(1410);
    expect(dayOverviewMinuteAt(new Date(2026, 6, 21, 7, 0), date, 7 * 60)).toBeNull();
  });

  it("clips cross-midnight schedules while preserving positive intervals", () => {
    const date = new Date(2026, 6, 20, 12, 0, 0);
    const previous = new Date(2026, 6, 19, 23, 30).toISOString();
    const end = new Date(2026, 6, 20, 1, 0).toISOString();
    expect(clampScheduleToDay(previous, end, date)).toEqual({ startMinute: 0, endMinute: 60 });
    expect(
      clampScheduleToDay(
        new Date(2026, 6, 21, 1, 0).toISOString(),
        new Date(2026, 6, 21, 2, 0).toISOString(),
        date,
      ),
    ).toBeNull();
  });

  it("exposes deterministic input and heading values", () => {
    const date = new Date(2026, 6, 20, 9, 5, 0);
    expect(dateInputValue(date)).toBe("2026-07-20");
    expect(localDateTimeInput(date.toISOString())).toMatch(/^2026-07-20T09:05$/);
    expect(minutesSinceDayStart(date.toISOString(), date)).toBe(545);
    expect(formatDateHeading(date)).toContain("2026");
    expect(formatTime(date.toISOString())).toMatch(/09:05|9:05/);
  });
});
