import type { Schedule } from "../../shared/contracts";
import { clampScheduleToDay } from "../../shared/time";

export interface TimelineItem {
  schedule: Schedule;
  startMinute: number;
  endMinute: number;
  lane: number;
  laneCount: number;
}

interface MutableTimelineItem {
  schedule: Schedule;
  startMinute: number;
  endMinute: number;
  lane: number;
  laneCount: number;
  component: number;
}

export function assignTimelineLanes(schedules: Schedule[], selectedDate: Date): TimelineItem[] {
  const items: MutableTimelineItem[] = schedules
    .flatMap((schedule) => {
      const segment = clampScheduleToDay(schedule.startUtc, schedule.endUtc, selectedDate);
      return segment ? [{ schedule, ...segment, lane: 0, laneCount: 1, component: 0 }] : [];
    })
    .sort(
      (left, right) =>
        left.startMinute - right.startMinute ||
        right.endMinute - left.endMinute ||
        left.schedule.id.localeCompare(right.schedule.id),
    );

  let component = -1;
  let componentEnd = -1;
  let laneEnds: number[] = [];
  for (const item of items) {
    if (item.startMinute >= componentEnd) {
      component += 1;
      componentEnd = item.endMinute;
      laneEnds = [];
    } else {
      componentEnd = Math.max(componentEnd, item.endMinute);
    }
    let lane = laneEnds.findIndex((endMinute) => endMinute <= item.startMinute);
    if (lane === -1) lane = laneEnds.length;
    laneEnds[lane] = item.endMinute;
    item.lane = lane;
    item.component = component;
  }

  const componentLaneCount = new Map<number, number>();
  for (const item of items) {
    componentLaneCount.set(
      item.component,
      Math.max(componentLaneCount.get(item.component) ?? 1, item.lane + 1),
    );
  }
  return items.map(({ component: itemComponent, ...item }) => ({
    ...item,
    laneCount: componentLaneCount.get(itemComponent) ?? 1,
  }));
}

export function isCurrent(schedule: Schedule, now: Date): boolean {
  const snapshot = now.getTime();
  return Date.parse(schedule.startUtc) <= snapshot && snapshot < Date.parse(schedule.endUtc);
}

export function nextSchedule(schedules: Schedule[], now: Date): Schedule | null {
  const snapshot = now.getTime();
  return (
    schedules
      .filter((schedule) => schedule.deletedAt === null && Date.parse(schedule.startUtc) > snapshot)
      .sort(
        (left, right) =>
          Date.parse(left.startUtc) - Date.parse(right.startUtc) || left.id.localeCompare(right.id),
      )[0] ?? null
  );
}
