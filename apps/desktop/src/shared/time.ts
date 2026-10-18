import { appLocale, translate } from "./i18n/messages";
import { addDays, differenceInCalendarDays, endOfDay, format, startOfDay } from "date-fns";

export function dayRange(date: Date): { startUtc: string; endUtc: string } {
  return {
    startUtc: startOfDay(date).toISOString(),
    endUtc: addDays(startOfDay(date), 1).toISOString(),
  };
}

export function dayOverviewRange(
  date: Date,
  startMinute: number,
): { startUtc: string; endUtc: string } {
  const start = new Date(startOfDay(date));
  start.setMinutes(startMinute);
  const end = new Date(addDays(startOfDay(date), 1));
  end.setMinutes(startMinute);
  return { startUtc: start.toISOString(), endUtc: end.toISOString() };
}

export function formatDateHeading(date: Date): string {
  return new Intl.DateTimeFormat(appLocale, {
    year: "numeric",
    month: "long",
    day: "numeric",
    weekday: "short",
  }).format(date);
}

export function formatTime(iso: string): string {
  return new Intl.DateTimeFormat(appLocale, {
    hour: "2-digit",
    minute: "2-digit",
    hour12: false,
  }).format(new Date(iso));
}

export function formatDuration(minutes: number): string {
  if (minutes < 60) return translate("shared.time.001", [minutes]);
  const hours = Math.floor(minutes / 60);
  const rest = minutes % 60;
  return rest === 0
    ? translate("shared.time.002", [hours])
    : translate("shared.time.003", [hours, rest]);
}

export function minutesSinceDayStart(iso: string, selectedDate: Date): number {
  const date = new Date(iso);
  const start = startOfDay(selectedDate).getTime();
  return (date.getTime() - start) / 60_000;
}

export function clampScheduleToDay(
  startUtc: string,
  endUtc: string,
  selectedDate: Date,
): { startMinute: number; endMinute: number } | null {
  const dayStart = startOfDay(selectedDate).getTime();
  const dayEnd = endOfDay(selectedDate).getTime() + 1;
  const start = Math.max(Date.parse(startUtc), dayStart);
  const end = Math.min(Date.parse(endUtc), dayEnd);
  if (start >= end) return null;
  return {
    startMinute: (start - dayStart) / 60_000,
    endMinute: (end - dayStart) / 60_000,
  };
}

export function clampScheduleToDayOverview(
  startUtc: string,
  endUtc: string,
  selectedDate: Date,
  startMinute: number,
): { startMinute: number; endMinute: number } | null {
  const range = dayOverviewRange(selectedDate, startMinute);
  const windowStart = Date.parse(range.startUtc);
  const windowEnd = Date.parse(range.endUtc);
  const start = Math.max(Date.parse(startUtc), windowStart);
  const end = Math.min(Date.parse(endUtc), windowEnd);
  if (start >= end) return null;
  const toWindowMinute = (instant: number): number => {
    if (instant <= windowStart) return 0;
    if (instant >= windowEnd) return 1440;
    const localDate = new Date(instant);
    const dayOffset = differenceInCalendarDays(localDate, selectedDate);
    return (
      dayOffset * 1440 +
      localDate.getHours() * 60 +
      localDate.getMinutes() +
      localDate.getSeconds() / 60 -
      startMinute
    );
  };
  return {
    startMinute: toWindowMinute(start),
    endMinute: toWindowMinute(end),
  };
}

export function dayOverviewMinuteAt(
  instant: Date,
  selectedDate: Date,
  startMinute: number,
): number | null {
  const range = dayOverviewRange(selectedDate, startMinute);
  const timestamp = instant.getTime();
  if (timestamp < Date.parse(range.startUtc) || timestamp >= Date.parse(range.endUtc)) return null;
  const dayOffset = differenceInCalendarDays(instant, selectedDate);
  return (
    dayOffset * 1440 +
    instant.getHours() * 60 +
    instant.getMinutes() +
    instant.getSeconds() / 60 -
    startMinute
  );
}

export function dateInputValue(date: Date): string {
  return format(date, "yyyy-MM-dd");
}

export function localDateTimeInput(iso: string): string {
  const value = new Date(iso);
  const local = new Date(value.getTime() - value.getTimezoneOffset() * 60_000);
  return local.toISOString().slice(0, 16);
}
