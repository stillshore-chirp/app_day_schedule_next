import { emit } from "@tauri-apps/api/event";

export const dayOverviewStartMinuteStorageKey = "day-schedule-next.day-overview-start-minute";
export const dayOverviewStartMinuteChangedEvent = "day-overview-start-minute-changed";
export const defaultDayOverviewStartMinute = 0;
export const maxDayOverviewStartMinute = 23 * 60;
export const dayOverviewStartMinuteStep = 60;
const maxLegacyDayOverviewStartMinute = 1435;
const legacyDayOverviewStartMinuteStep = 5;

export function isDayOverviewStartMinute(value: unknown): value is number {
  return (
    typeof value === "number" &&
    Number.isInteger(value) &&
    value >= defaultDayOverviewStartMinute &&
    value <= maxDayOverviewStartMinute &&
    value % dayOverviewStartMinuteStep === 0
  );
}

export function normalizeDayOverviewStartMinute(value: number): number {
  if (!Number.isFinite(value)) return defaultDayOverviewStartMinute;
  const bounded = Math.min(maxLegacyDayOverviewStartMinute, Math.max(0, value));
  const roundedHour = Math.round(bounded / dayOverviewStartMinuteStep) % 24;
  return roundedHour * dayOverviewStartMinuteStep;
}

export function readDayOverviewStartMinute(): number {
  if (typeof window === "undefined") return defaultDayOverviewStartMinute;
  const storedValue = window.localStorage.getItem(dayOverviewStartMinuteStorageKey);
  if (storedValue === null) return defaultDayOverviewStartMinute;
  const stored = Number(storedValue);
  const isLegacyValue =
    Number.isInteger(stored) &&
    stored >= 0 &&
    stored <= maxLegacyDayOverviewStartMinute &&
    stored % legacyDayOverviewStartMinuteStep === 0;
  return isLegacyValue ? normalizeDayOverviewStartMinute(stored) : defaultDayOverviewStartMinute;
}

export function saveDayOverviewStartMinute(value: number): number {
  const startMinute = normalizeDayOverviewStartMinute(value);
  if (typeof window === "undefined") return startMinute;

  window.localStorage.setItem(dayOverviewStartMinuteStorageKey, String(startMinute));
  if ("__TAURI_INTERNALS__" in window) {
    void emit(dayOverviewStartMinuteChangedEvent, startMinute).catch(() => undefined);
  }
  return startMinute;
}
