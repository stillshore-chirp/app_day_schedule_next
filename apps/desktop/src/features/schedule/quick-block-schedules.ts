import { addDays } from "date-fns";
import { fromZonedTime } from "date-fns-tz";
import type { QuickBlock, Schedule } from "../../shared/contracts";
import { dateInputValue } from "../../shared/time";

function minuteToTime(minute: number): string {
  return `${String(Math.floor(minute / 60)).padStart(2, "0")}:${String(minute % 60).padStart(
    2,
    "0",
  )}`;
}

export function quickBlocksAsSchedules(quickBlocks: QuickBlock[], selectedDate: Date): Schedule[] {
  const date = dateInputValue(selectedDate);
  return quickBlocks
    .filter((item) => item.isActive)
    .map((item) => {
      const startUtc = fromZonedTime(
        `${date}T${minuteToTime(item.startMinute)}:00`,
        item.timezoneId,
      );
      const endUtc = new Date(startUtc.getTime() + item.durationMinutes * 60_000);
      return {
        id: item.id,
        title: item.title,
        description: "Quick Block",
        location: "",
        startUtc: startUtc.toISOString(),
        endUtc: endUtc.toISOString(),
        timezoneId: item.timezoneId,
        allDay: false,
        allDayStartDate: null,
        allDayEndDateExclusive: null,
        status: "scheduled",
        project: item.project,
        category: item.category,
        tags: ["Quick Block"],
        color: item.color,
        priority: "normal",
        recurrenceRule: null,
        recurrenceSupplementalLines: [],
        recurrenceExdates: [],
        startNotificationMinutes: item.startNotificationMinutes,
        endNotificationMinutes: item.endNotificationMinutes,
        syncStatus: "local_only",
        version: item.version,
        deletedAt: null,
      } satisfies Schedule;
    });
}

export function quickBlocksForDayOverview(
  quickBlocks: QuickBlock[],
  selectedDate: Date,
): Schedule[] {
  return [-1, 0, 1].flatMap((dayOffset) =>
    quickBlocksAsSchedules(quickBlocks, addDays(selectedDate, dayOffset)),
  );
}

export function quickBlocksForInstantRange(
  quickBlocks: QuickBlock[],
  range: { startUtc: string; endUtc: string },
): Schedule[] {
  const start = new Date(range.startUtc);
  const end = new Date(range.endUtc);
  if (!Number.isFinite(start.getTime()) || !Number.isFinite(end.getTime()) || start >= end)
    return [];
  const windowStart = start.getTime();
  const windowEnd = end.getTime();
  start.setHours(0, 0, 0, 0);
  start.setDate(start.getDate() - 3);
  end.setHours(0, 0, 0, 0);
  end.setDate(end.getDate() + 2);
  const schedules: Schedule[] = [];
  for (const date = new Date(start); date <= end; date.setDate(date.getDate() + 1)) {
    schedules.push(
      ...quickBlocksAsSchedules(quickBlocks, date).filter((schedule) => {
        const scheduleStart = Date.parse(schedule.startUtc);
        const scheduleEnd = Date.parse(schedule.endUtc);
        return scheduleStart < windowEnd && scheduleEnd > windowStart;
      }),
    );
  }
  return schedules;
}
