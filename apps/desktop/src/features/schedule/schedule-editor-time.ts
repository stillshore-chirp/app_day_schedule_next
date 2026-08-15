const LOCAL_DATE_TIME_PATTERN =
  /^(?<year>\d{4})-(?<month>\d{2})-(?<day>\d{2})T(?<hour>\d{2}):(?<minute>\d{2})$/;
const TIME_PATTERN = /^(?<hour>\d{2}):(?<minute>\d{2})$/;

interface LocalDateTimeParts {
  year: number;
  month: number;
  day: number;
  hour: number;
  minute: number;
}

function parseLocalDateTime(value: string): LocalDateTimeParts | null {
  const match = LOCAL_DATE_TIME_PATTERN.exec(value);
  if (!match?.groups) return null;
  const parts = {
    year: Number(match.groups.year),
    month: Number(match.groups.month),
    day: Number(match.groups.day),
    hour: Number(match.groups.hour),
    minute: Number(match.groups.minute),
  };
  const stamp = Date.UTC(parts.year, parts.month - 1, parts.day, parts.hour, parts.minute);
  const normalized = new Date(stamp);
  if (
    normalized.getUTCFullYear() !== parts.year ||
    normalized.getUTCMonth() !== parts.month - 1 ||
    normalized.getUTCDate() !== parts.day ||
    normalized.getUTCHours() !== parts.hour ||
    normalized.getUTCMinutes() !== parts.minute
  ) {
    return null;
  }
  return parts;
}

function localMinuteStamp(value: string): number | null {
  const parts = parseLocalDateTime(value);
  if (!parts) return null;
  return Date.UTC(parts.year, parts.month - 1, parts.day, parts.hour, parts.minute) / 60_000;
}

function pad(value: number): string {
  return String(value).padStart(2, "0");
}

function fromLocalMinuteStamp(value: number): string {
  const date = new Date(value * 60_000);
  return `${date.getUTCFullYear()}-${pad(date.getUTCMonth() + 1)}-${pad(date.getUTCDate())}T${pad(date.getUTCHours())}:${pad(date.getUTCMinutes())}`;
}

export function localDatePart(value: string): string {
  return parseLocalDateTime(value) ? value.slice(0, 10) : "";
}

export function localTimePart(value: string): string {
  return parseLocalDateTime(value) ? value.slice(11, 16) : "";
}

export function combineLocalDateAndTime(date: string, time: string): string | null {
  if (!/^\d{4}-\d{2}-\d{2}$/.test(date) || !TIME_PATTERN.test(time)) return null;
  const value = `${date}T${time}`;
  return parseLocalDateTime(value) ? value : null;
}

export function addLocalMinutes(value: string, minutes: number): string | null {
  const stamp = localMinuteStamp(value);
  if (stamp === null || !Number.isFinite(minutes)) return null;
  return fromLocalMinuteStamp(stamp + Math.trunc(minutes));
}

export function localDurationMinutes(start: string, end: string): number | null {
  const startStamp = localMinuteStamp(start);
  const endStamp = localMinuteStamp(end);
  if (startStamp === null || endStamp === null) return null;
  return endStamp - startStamp;
}

export function localDayOffset(start: string, end: string): number | null {
  const startDate = combineLocalDateAndTime(localDatePart(start), "00:00");
  const endDate = combineLocalDateAndTime(localDatePart(end), "00:00");
  if (!startDate || !endDate) return null;
  const minutes = localDurationMinutes(startDate, endDate);
  return minutes === null ? null : minutes / 1440;
}

export function timeOptions(snapMinutes: number, current: string): string[] {
  const step = Math.min(1440, Math.max(1, Math.trunc(snapMinutes)));
  const values = new Set<string>();
  for (let minute = 0; minute < 1440; minute += step) {
    values.add(`${pad(Math.floor(minute / 60))}:${pad(minute % 60)}`);
  }
  if (TIME_PATTERN.test(current)) values.add(current);
  return [...values].sort();
}
