import { emit } from "@tauri-apps/api/event";

export const dayOverviewStartMinuteStorageKey = "day-schedule-next.day-overview-start-minute";
export const dayOverviewStartMinuteChangedEvent = "day-overview-start-minute-changed";
export const defaultDayOverviewStartMinute = 0;
export const maxDayOverviewStartMinute = 1435;
export const dayOverviewStartMinuteStep = 5;

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
  const stepped = Math.round(value / dayOverviewStartMinuteStep) * dayOverviewStartMinuteStep;
  return Math.min(maxDayOverviewStartMinute, Math.max(defaultDayOverviewStartMinute, stepped));
}

export function readDayOverviewStartMinute(): number {
  if (typeof window === "undefined") return defaultDayOverviewStartMinute;
  const stored = Number(window.localStorage.getItem(dayOverviewStartMinuteStorageKey));
  return isDayOverviewStartMinute(stored) ? stored : defaultDayOverviewStartMinute;
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
