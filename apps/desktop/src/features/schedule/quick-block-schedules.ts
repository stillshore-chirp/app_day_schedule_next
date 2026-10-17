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
