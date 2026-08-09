import { create } from "zustand";

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
  selectedScheduleId: string | null;
  editorMode: "closed" | "create" | "edit";
  search: string;
  createRange: { startUtc: string; endUtc: string } | null;
  referenceMinute: number;
  setActiveView: (view: AppView) => void;
  setSelectedDate: (date: Date) => void;
  selectSchedule: (id: string | null) => void;
  openCreate: (range?: { startUtc: string; endUtc: string }) => void;
  openEdit: (id: string) => void;
  closeEditor: () => void;
  setSearch: (search: string) => void;
  setReferenceMinute: (minute: number) => void;
}

export const useUiStore = create<UiState>((set) => ({
  activeView: restoredView(),
  selectedDate: new Date(),
  selectedScheduleId: null,
  editorMode: "closed",
  search: "",
  createRange: null,
  referenceMinute: 8 * 60,
  setActiveView: (activeView) => {
    localStorage.setItem("day-schedule-next.active-view", activeView);
    set({ activeView });
  },
  setSelectedDate: (selectedDate) => set({ selectedDate, selectedScheduleId: null }),
  selectSchedule: (selectedScheduleId) => set({ selectedScheduleId }),
  openCreate: (createRange) =>
    set({ editorMode: "create", selectedScheduleId: null, createRange: createRange ?? null }),
  openEdit: (selectedScheduleId) =>
    set({ editorMode: "edit", selectedScheduleId, createRange: null }),
  closeEditor: () => set({ editorMode: "closed", createRange: null }),
  setSearch: (search) => set({ search }),
  setReferenceMinute: (referenceMinute) => set({ referenceMinute }),
}));
