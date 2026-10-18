import { create } from "zustand";
import {
  type DayOverviewMode,
  normalizeDayOverviewWindowHours,
  normalizeDayOverviewStartMinute,
  readDayOverviewPreferences,
  saveDayOverviewPreferences,
} from "../shared/day-overview-preferences";
import { dateInputValue } from "../shared/time";

export type AppView =
  | "today"
  | "week"
  | "month"
  | "list"
  | "templates"
  | "tickets"
  | "focus"
  | "timers"
  | "stopwatch"
  | "alarms"
  | "settings"
  | "diagnostics";

const appViews: AppView[] = [
  "today",
  "week",
  "month",
  "list",
  "templates",
  "tickets",
  "focus",
  "timers",
  "stopwatch",
  "alarms",
  "settings",
  "diagnostics",
];

function restoredView(): AppView {
  if (typeof window === "undefined") return "today";
  const value = window.localStorage.getItem("day-schedule-next.active-view");
  return appViews.includes(value as AppView) ? (value as AppView) : "today";
}

interface UiState {
  activeView: AppView;
  selectedDate: Date;
  selectedDateFollowsToday: boolean;
  selectedScheduleId: string | null;
  editorMode: "closed" | "create" | "edit";
  search: string;
  createRange: { startUtc: string; endUtc: string } | null;
  dayOverviewStartMinute: number;
  dayOverviewMode: DayOverviewMode;
  dayOverviewWindowHours: number;
  setActiveView: (view: AppView) => void;
  setSelectedDate: (date: Date) => void;
  setTodayDate: (date: Date) => void;
  syncFollowingTodayDate: (date: Date) => void;
  selectSchedule: (id: string | null) => void;
  openCreate: (range?: { startUtc: string; endUtc: string }) => void;
  openEdit: (id: string) => void;
  closeEditor: () => void;
  setSearch: (search: string) => void;
  setDayOverviewStartMinute: (minute: number) => void;
  setDayOverviewMode: (mode: DayOverviewMode) => void;
  setDayOverviewWindowHours: (hours: number) => void;
}

const initialDayOverviewPreferences = readDayOverviewPreferences();

export const useUiStore = create<UiState>((set, get) => ({
  activeView: restoredView(),
  selectedDate: new Date(),
  selectedDateFollowsToday: true,
  selectedScheduleId: null,
  editorMode: "closed",
  search: "",
  createRange: null,
  dayOverviewStartMinute: initialDayOverviewPreferences.startMinute,
  dayOverviewMode: initialDayOverviewPreferences.mode,
  dayOverviewWindowHours: initialDayOverviewPreferences.windowHours,
  setActiveView: (activeView) => {
    localStorage.setItem("day-schedule-next.active-view", activeView);
    set({ activeView });
  },
  setSelectedDate: (selectedDate) =>
    set({
      selectedDate,
      selectedDateFollowsToday: dateInputValue(selectedDate) === dateInputValue(new Date()),
      selectedScheduleId: null,
    }),
  setTodayDate: (selectedDate) =>
    set({ selectedDate, selectedDateFollowsToday: true, selectedScheduleId: null }),
  syncFollowingTodayDate: (selectedDate) => {
    if (!get().selectedDateFollowsToday) return;
    set({ selectedDate });
  },
  selectSchedule: (selectedScheduleId) => set({ selectedScheduleId }),
  openCreate: (createRange) =>
    set({ editorMode: "create", selectedScheduleId: null, createRange: createRange ?? null }),
  openEdit: (selectedScheduleId) =>
    set({ editorMode: "edit", selectedScheduleId, createRange: null }),
  closeEditor: () => set({ editorMode: "closed", createRange: null }),
  setSearch: (search) => set({ search }),
  setDayOverviewStartMinute: (minute) => {
    const dayOverviewStartMinute = normalizeDayOverviewStartMinute(minute);
    if (dayOverviewStartMinute === get().dayOverviewStartMinute) return;
    saveDayOverviewPreferences({ startMinute: dayOverviewStartMinute });
    set({ dayOverviewStartMinute });
  },
  setDayOverviewMode: (dayOverviewMode) => {
    if (dayOverviewMode === get().dayOverviewMode) return;
    saveDayOverviewPreferences({ mode: dayOverviewMode });
    set({ dayOverviewMode });
  },
  setDayOverviewWindowHours: (hours) => {
    const dayOverviewWindowHours = normalizeDayOverviewWindowHours(hours);
    if (dayOverviewWindowHours === get().dayOverviewWindowHours) return;
    saveDayOverviewPreferences({ windowHours: dayOverviewWindowHours });
    set({ dayOverviewWindowHours });
  },
}));
