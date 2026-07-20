import type { Schedule } from "../../shared/contracts";
import { clampScheduleToDay } from "../../shared/time";

export interface OverviewLayoutItem {
  schedule: Schedule;
  startMinute: number;
  endMinute: number;
  level: number;
  levelCount: number;
}

export function layoutOverview(schedules: Schedule[], selectedDate: Date): OverviewLayoutItem[] {
  const intervals = schedules
    .map((schedule) => {
      const segment = clampScheduleToDay(schedule.startUtc, schedule.endUtc, selectedDate);
      return segment ? { schedule, ...segment } : null;
    })
    .filter((item): item is NonNullable<typeof item> => item !== null)
    .sort(
      (left, right) =>
        left.startMinute - right.startMinute ||
        left.endMinute - right.endMinute ||
        left.schedule.id.localeCompare(right.schedule.id),
    );
  const result: OverviewLayoutItem[] = [];
  let component: typeof intervals = [];
  let componentEnd = -1;
  const flush = () => {
    const levelCount = component.length;
    component.forEach((item, level) => result.push({ ...item, level, levelCount }));
    component = [];
    componentEnd = -1;
  };
  for (const interval of intervals) {
    // Five minutes of actual overlap is required to join the reference-compatible stack.
    if (component.length > 0 && interval.startMinute > componentEnd - 5) flush();
    component.push(interval);
    componentEnd = Math.max(componentEnd, interval.endMinute);
  }
  flush();
  return result;
}
