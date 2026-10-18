import type { Schedule } from "../../shared/contracts";
import { clampScheduleToDayOverview } from "../../shared/time";

export interface MinuteInterval<T> {
  key: string;
  value: T;
  startMinute: number;
  endMinute: number;
  stableOrder: number | string;
}

export interface PositionedMinuteInterval<T> extends MinuteInterval<T> {
  level: number;
  levelCount: number;
}

export interface OverviewLayoutItem extends PositionedMinuteInterval<Schedule> {
  schedule: Schedule;
}

export function minuteToPercent(minute: number, windowMinutes = 1440): number {
  return (Math.min(windowMinutes, Math.max(0, minute)) / windowMinutes) * 100;
}

function compareStableOrder(left: number | string, right: number | string): number {
  if (typeof left === "number" && typeof right === "number") return left - right;
  return String(left).localeCompare(String(right));
}

export function assignOverviewLevels<T>(
  intervals: MinuteInterval<T>[],
  minimumOverlapMinutes: number,
): PositionedMinuteInterval<T>[] {
  const sorted = [...intervals]
    .filter((interval) => interval.endMinute > interval.startMinute)
    .sort(
      (left, right) =>
        left.startMinute - right.startMinute ||
        left.endMinute - right.endMinute ||
        compareStableOrder(left.stableOrder, right.stableOrder) ||
        left.key.localeCompare(right.key),
    );
  const result: PositionedMinuteInterval<T>[] = [];
  let component: MinuteInterval<T>[] = [];
  let componentEnd = -1;

  const flush = () => {
    if (component.length === 0) return;
    const levelEnds: number[] = [];
    const positioned = component.map((interval) => {
      const reusableLevel = levelEnds.findIndex(
        (endMinute) => interval.startMinute > endMinute - minimumOverlapMinutes,
      );
      const level = reusableLevel >= 0 ? reusableLevel : levelEnds.length;
      levelEnds[level] = interval.endMinute;
      return { ...interval, level };
    });
    const levelCount = levelEnds.length;
    result.push(...positioned.map((interval) => ({ ...interval, levelCount })));
    component = [];
    componentEnd = -1;
  };

  for (const interval of sorted) {
    if (component.length > 0 && interval.startMinute > componentEnd - minimumOverlapMinutes) {
      flush();
    }
    component.push(interval);
    componentEnd = Math.max(componentEnd, interval.endMinute);
  }
  flush();
  return result;
}

export function layoutSchedulesForDay(
  schedules: Schedule[],
  selectedDate: Date,
  visibleStartMinute = 0,
): OverviewLayoutItem[] {
  const intervals = schedules
    .map((schedule): MinuteInterval<Schedule> | null => {
      const segment = clampScheduleToDayOverview(
        schedule.startUtc,
        schedule.endUtc,
        selectedDate,
        visibleStartMinute,
      );
      if (!segment) return null;
      return segment.endMinute > segment.startMinute
        ? {
            key: `${schedule.id}-${schedule.startUtc}`,
            value: schedule,
            stableOrder: schedule.id,
            ...segment,
          }
        : null;
    })
    .filter((item): item is MinuteInterval<Schedule> => item !== null);

  return assignOverviewLevels(intervals, 5).map((item) => ({
    ...item,
    schedule: item.value,
  }));
}

export function layoutSchedulesForInstantRange(
  schedules: Schedule[],
  range: { startUtc: string; endUtc: string },
): OverviewLayoutItem[] {
  const windowStart = Date.parse(range.startUtc);
  const windowEnd = Date.parse(range.endUtc);
  const windowMinutes = (windowEnd - windowStart) / 60_000;
  if (!Number.isFinite(windowMinutes) || windowMinutes <= 0) return [];
  const intervals = schedules
    .map((schedule): MinuteInterval<Schedule> | null => {
      const scheduleStart = Date.parse(schedule.startUtc);
      const scheduleEnd = Date.parse(schedule.endUtc);
      const clippedStart = Math.max(scheduleStart, windowStart);
      const clippedEnd = Math.min(scheduleEnd, windowEnd);
      if (
        !Number.isFinite(clippedStart) ||
        !Number.isFinite(clippedEnd) ||
        clippedStart >= clippedEnd
      ) {
        return null;
      }
      return {
        key: `${schedule.id}-${schedule.startUtc}`,
        value: schedule,
        stableOrder: schedule.id,
        startMinute: (clippedStart - windowStart) / 60_000,
        endMinute: (clippedEnd - windowStart) / 60_000,
      };
    })
    .filter((item): item is MinuteInterval<Schedule> => item !== null);

  return assignOverviewLevels(intervals, 5).map((item) => ({
    ...item,
    schedule: item.value,
  }));
}

export const layoutOverview = layoutSchedulesForDay;
