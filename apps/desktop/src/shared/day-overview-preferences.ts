import { emit } from "@tauri-apps/api/event";

export const dayOverviewStartMinuteStorageKey = "day-schedule-next.day-overview-start-minute";
export const dayOverviewModeStorageKey = "day-schedule-next.day-overview-time-mode";
export const dayOverviewWindowHoursStorageKey = "day-schedule-next.day-overview-window-hours";
export const dayOverviewPreferencesChangedEvent = "day-overview-preferences-changed";
export const defaultDayOverviewStartMinute = 0;
export const maxDayOverviewStartMinute = 23 * 60;
export const dayOverviewStartMinuteStep = 60;
export const defaultDayOverviewMode = "fixed" as const;
export const defaultDayOverviewWindowHours = 24;
export const minDayOverviewWindowHours = 1;
export const maxDayOverviewWindowHours = 24;
const maxLegacyDayOverviewStartMinute = 1435;
const legacyDayOverviewStartMinuteStep = 5;

export type DayOverviewMode = "fixed" | "centered";

export interface DayOverviewPreferences {
  startMinute: number;
  mode: DayOverviewMode;
  windowHours: number;
}

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

export function normalizeDayOverviewWindowHours(value: number): number {
  if (!Number.isFinite(value)) return defaultDayOverviewWindowHours;
  return Math.min(
    maxDayOverviewWindowHours,
    Math.max(minDayOverviewWindowHours, Math.round(value)),
  );
}

export function isDayOverviewPreferences(value: unknown): value is DayOverviewPreferences {
  if (!value || typeof value !== "object") return false;
  const preferences = value as Partial<DayOverviewPreferences>;
  return (
    isDayOverviewStartMinute(preferences.startMinute) &&
    (preferences.mode === "fixed" || preferences.mode === "centered") &&
    Number.isInteger(preferences.windowHours) &&
    preferences.windowHours! >= minDayOverviewWindowHours &&
    preferences.windowHours! <= maxDayOverviewWindowHours
  );
}

export function readDayOverviewPreferences(): DayOverviewPreferences {
  if (typeof window === "undefined") {
    return {
      startMinute: defaultDayOverviewStartMinute,
      mode: defaultDayOverviewMode,
      windowHours: defaultDayOverviewWindowHours,
    };
  }
  const modeValue = window.localStorage.getItem(dayOverviewModeStorageKey);
  const windowValue = Number(window.localStorage.getItem(dayOverviewWindowHoursStorageKey));
  return {
    startMinute: readDayOverviewStartMinute(),
    mode: modeValue === "centered" ? "centered" : defaultDayOverviewMode,
    windowHours:
      Number.isInteger(windowValue) &&
      windowValue >= minDayOverviewWindowHours &&
      windowValue <= maxDayOverviewWindowHours
        ? windowValue
        : defaultDayOverviewWindowHours,
  };
}

export function saveDayOverviewPreferences(
  updates: Partial<DayOverviewPreferences>,
): DayOverviewPreferences {
  const current = readDayOverviewPreferences();
  const next: DayOverviewPreferences = {
    startMinute: normalizeDayOverviewStartMinute(updates.startMinute ?? current.startMinute),
    mode:
      updates.mode === "centered" ? "centered" : updates.mode === "fixed" ? "fixed" : current.mode,
    windowHours: normalizeDayOverviewWindowHours(updates.windowHours ?? current.windowHours),
  };
  if (typeof window === "undefined") return next;

  window.localStorage.setItem(dayOverviewStartMinuteStorageKey, String(next.startMinute));
  window.localStorage.setItem(dayOverviewModeStorageKey, next.mode);
  window.localStorage.setItem(dayOverviewWindowHoursStorageKey, String(next.windowHours));
  if ("__TAURI_INTERNALS__" in window) {
    void emit(dayOverviewPreferencesChangedEvent, next).catch(() => undefined);
  }
  return next;
}

export function saveDayOverviewStartMinute(value: number): number {
  return saveDayOverviewPreferences({ startMinute: value }).startMinute;
}
