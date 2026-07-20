import { appLocale, translate } from "./i18n/messages";
import { addDays, endOfDay, format, startOfDay } from "date-fns";

export function dayRange(date: Date): { startUtc: string; endUtc: string } {
  return {
    startUtc: startOfDay(date).toISOString(),
    endUtc: addDays(startOfDay(date), 1).toISOString(),
  };
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

export function dateInputValue(date: Date): string {
  return format(date, "yyyy-MM-dd");
}

export function localDateTimeInput(iso: string): string {
  const value = new Date(iso);
  const local = new Date(value.getTime() - value.getTimezoneOffset() * 60_000);
  return local.toISOString().slice(0, 16);
}
