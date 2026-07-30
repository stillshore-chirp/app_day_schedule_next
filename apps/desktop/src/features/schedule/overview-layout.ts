import type { Schedule } from "../../shared/contracts";
import { clampScheduleToDay } from "../../shared/time";

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

export function minuteToPercent(minute: number): number {
  return (Math.min(1440, Math.max(0, minute)) / 1440) * 100;
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
): OverviewLayoutItem[] {
  const intervals = schedules
    .map((schedule): MinuteInterval<Schedule> | null => {
      const segment = clampScheduleToDay(schedule.startUtc, schedule.endUtc, selectedDate);
      return segment
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

export const layoutOverview = layoutSchedulesForDay;
