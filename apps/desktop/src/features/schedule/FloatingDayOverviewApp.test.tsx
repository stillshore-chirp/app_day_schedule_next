import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { act, cleanup, fireEvent, render, screen, waitFor } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { afterEach, describe, expect, it, vi } from "vitest";
import { emit } from "@tauri-apps/api/event";
import type { QuickBlock, Schedule } from "../../shared/contracts";
import {
  dayOverviewPreferencesChangedEvent,
  dayOverviewStartMinuteStorageKey,
} from "../../shared/day-overview-preferences";
import {
  centeredDayOverviewQueryRange,
  dateInputValue,
  dayOverviewCycleDate,
  dayOverviewRange,
} from "../../shared/time";
import { MemoryAppClient } from "../../shared/ipc/memory-client";
import { FloatingDayOverviewApp } from "./FloatingDayOverviewApp";
import { FloatingDayOverviewLauncher } from "./FloatingDayOverviewLauncher";

const eventCallbacks = vi.hoisted(
  () => new Map<string, Set<(event: { payload: unknown }) => void>>(),
);

vi.mock("@tauri-apps/api/event", () => ({
  listen: vi.fn((name: string, callback: (event: { payload: unknown }) => void) => {
    const callbacks = eventCallbacks.get(name) ?? new Set();
    callbacks.add(callback);
    eventCallbacks.set(name, callbacks);
    return Promise.resolve(() => {
      callbacks.delete(callback);
    });
  }),
  emit: vi.fn((name: string, payload: unknown) => {
    for (const callback of eventCallbacks.get(name) ?? []) callback({ payload });
    return Promise.resolve();
  }),
}));

function todayAt(hour: number, minute: number): string {
  const date = new Date();
  date.setHours(hour, minute, 0, 0);
  return date.toISOString();
}

const schedule: Schedule = {
  id: "00000000-0000-4000-8000-000000000031",
  title: "概要ウィジェットの予定",
  description: "",
  location: "",
  startUtc: todayAt(9, 0),
  endUtc: todayAt(9, 30),
  timezoneId: Intl.DateTimeFormat().resolvedOptions().timeZone || "Asia/Tokyo",
  allDay: false,
  allDayStartDate: null,
  allDayEndDateExclusive: null,
  status: "scheduled",
  project: "",
  category: "",
  tags: [],
  color: "#336699",
  priority: "normal",
  recurrenceRule: null,
  recurrenceSupplementalLines: [],
  recurrenceExdates: [],
  startNotificationMinutes: null,
  endNotificationMinutes: null,
  syncStatus: "local_only",
  version: 0,
  deletedAt: null,
};

const quickBlock: QuickBlock = {
  id: "00000000-0000-4000-8000-000000000032",
  title: "集中ブロック",
  startMinute: 10 * 60,
  durationMinutes: 30,
  timezoneId: Intl.DateTimeFormat().resolvedOptions().timeZone || "Asia/Tokyo",
  color: "#6F96F4",
  project: "",
  category: "",
  startNotificationMinutes: null,
  endNotificationMinutes: null,
  isActive: true,
  sortOrder: 0,
  version: 0,
};

function renderWidget(client = new MemoryAppClient([schedule])) {
  const bootstrap = client.bootstrap.bind(client);
  vi.spyOn(client, "bootstrap").mockImplementation(async () => ({
    ...(await bootstrap()),
    today: dateInputValue(new Date()),
  }));
  const queryClient = new QueryClient({ defaultOptions: { queries: { retry: false } } });
  const result = render(
    <QueryClientProvider client={queryClient}>
      <FloatingDayOverviewApp client={client} />
    </QueryClientProvider>,
  );
  return { ...result, client, queryClient };
}

afterEach(() => {
  cleanup();
  vi.useRealTimers();
  localStorage.clear();
  eventCallbacks.clear();
  Reflect.deleteProperty(window, "__TAURI_INTERNALS__");
  delete document.documentElement.dataset.theme;
  delete document.documentElement.dataset.textScale;
  delete document.documentElement.dataset.textScaleLevel;
});

describe("FloatingDayOverviewApp", () => {
  it("updates an open overview window from the shared preferences event", async () => {
    Reflect.set(window, "__TAURI_INTERNALS__", {});
    const client = new MemoryAppClient([schedule]);
    const listSchedules = vi.spyOn(client, "listSchedules");
    const { container } = renderWidget(client);

    expect(await screen.findByRole("button", { name: /概要ウィジェットの予定/ })).toBeVisible();
    await waitFor(() =>
      expect(eventCallbacks.get(dayOverviewPreferencesChangedEvent)?.size).toBe(1),
    );

    await act(async () => {
      await emit(dayOverviewPreferencesChangedEvent, {
        startMinute: 7 * 60,
        mode: "fixed",
        windowHours: 24,
      });
    });

    const range = dayOverviewRange(dayOverviewCycleDate(new Date(), 7 * 60), 7 * 60);
    await waitFor(() => {
      expect(listSchedules).toHaveBeenCalledWith({ ...range, search: "", limit: 500 });
      expect(container.querySelector(".overview-tick")?.textContent).toBe("07");
    });
  });

  it("switches an open widget to the shared centered range", async () => {
    Reflect.set(window, "__TAURI_INTERNALS__", {});
    const client = new MemoryAppClient([schedule]);
    const listSchedules = vi.spyOn(client, "listSchedules");
    const { container } = renderWidget(client);

    await screen.findByRole("button", { name: /概要ウィジェットの予定/ });
    await waitFor(() =>
      expect(eventCallbacks.get(dayOverviewPreferencesChangedEvent)?.size).toBe(1),
    );
    const instant = new Date();
    await act(async () => {
      await emit(dayOverviewPreferencesChangedEvent, {
        startMinute: 0,
        mode: "centered",
        windowHours: 6,
      });
    });

    const range = centeredDayOverviewQueryRange(instant);
    await waitFor(() => {
      expect(listSchedules).toHaveBeenCalledWith({ ...range, search: "", limit: 500, offset: 0 });
      expect(container.querySelector(".overview")?.getAttribute("data-overview-mode")).toBe(
        "centered",
      );
      expect(container.querySelector(".overview-range-caption")?.textContent).toContain(
        "現在を中心に",
      );
    });
  });

  it("shows a previous-day Quick Block that crosses the selected start time", async () => {
    localStorage.setItem(dayOverviewStartMinuteStorageKey, String(7 * 60));
    const client = new MemoryAppClient([schedule]);
    vi.spyOn(client, "listQuickBlocks").mockResolvedValue([
      {
        ...quickBlock,
        title: "夜間の集中ブロック",
        startMinute: 23 * 60,
        durationMinutes: 9 * 60,
      },
    ]);
    renderWidget(client);

    const nightBlock = await screen.findByRole("button", { name: /前日 23:00/ });
    expect(nightBlock).toHaveAccessibleName(/前日 23:00/);
    expect(nightBlock).toHaveAccessibleName(/08:00/);
  });

  it("switches between the three lanes, applies local theme, and persists its pin", async () => {
    const user = userEvent.setup();
    const client = new MemoryAppClient([schedule]);
    const setAlwaysOnTop = vi.spyOn(client, "setWindowAlwaysOnTop");
    const setWindowMode = vi.spyOn(client, "setDayOverviewWindowMode");
    renderWidget(client);

    expect(await screen.findByRole("button", { name: /概要ウィジェットの予定/ })).toBeVisible();
    expect(document.querySelectorAll(".overview-lane")).toHaveLength(2);
    expect(screen.queryByRole("slider", { name: "概要の表示開始時刻" })).toBeNull();

    await user.click(screen.getByRole("button", { name: "概要の設定を開く" }));
    const scheduleOnly = screen.getByRole("button", { name: "予定のみ（上段）" });
    const templateOnly = screen.getByRole("button", { name: "テンプレートのみ（下段）" });
    const both = screen.getByRole("button", { name: "予定とテンプレート" });

    await user.click(scheduleOnly);
    await waitFor(() => {
      expect(scheduleOnly).toHaveAttribute("aria-pressed", "true");
      expect(setWindowMode).toHaveBeenCalledTimes(1);
      expect(setWindowMode).toHaveBeenLastCalledWith("single");
      expect(localStorage.getItem("day-schedule-next.day-overview-expanded-height")).toBe("420");
    });
    expect(
      document.querySelector(".overview-lane[aria-labelledby='template-lane-title']"),
    ).toHaveAttribute("hidden");

    await user.click(templateOnly);
    expect(templateOnly).toHaveAttribute("aria-pressed", "true");
    expect(setWindowMode).toHaveBeenCalledTimes(1);
    expect(
      document.querySelector(".overview-lane[aria-labelledby='schedule-lane-title']"),
    ).toHaveAttribute("hidden");
    expect(document.querySelector(".overview-lane__track--template")).toBeVisible();

    await user.click(both);
    await waitFor(() => {
      expect(both).toHaveAttribute("aria-pressed", "true");
      expect(setWindowMode).toHaveBeenLastCalledWith("both", 420);
    });
    expect(document.querySelectorAll(".overview-lane")).toHaveLength(2);
    expect(document.querySelector(".overview-lane[hidden]")).toBeNull();

    await user.click(screen.getByRole("button", { name: "ダーク" }));
    expect(document.documentElement.dataset.theme).toBe("dark");
    expect(localStorage.getItem("day-schedule-next.day-overview-theme")).toBe("dark");

    const pin = screen.getByRole("button", { name: "常に手前に固定" });
    await waitFor(() => expect(pin).toBeEnabled());
    await user.click(pin);
    expect(setAlwaysOnTop).toHaveBeenCalledWith("day-overview", true);
    expect(await screen.findByRole("button", { name: "常に手前を解除" })).toHaveAttribute(
      "aria-pressed",
      "true",
    );
  });

  it("clears the successful pin status after a short delay", async () => {
    renderWidget();

    const pin = await screen.findByRole("button", { name: "常に手前に固定" });
    await waitFor(() => expect(pin).toBeEnabled());
    vi.useFakeTimers({ toFake: ["setTimeout", "clearTimeout"] });
    await act(async () => {
      fireEvent.click(pin);
      await Promise.resolve();
    });

    const message = "常に手前に固定しました。";
    expect(screen.getByText(message)).toBeVisible();
    await act(async () => {
      await vi.advanceTimersByTimeAsync(2_999);
    });
    expect(screen.getByText(message)).toBeVisible();

    await act(async () => {
      await vi.advanceTimersByTimeAsync(1);
    });
    expect(screen.queryByText(message)).toBeNull();
  });

  it("restarts the pin status timer when the pin is changed again", async () => {
    renderWidget();

    const pin = await screen.findByRole("button", { name: "常に手前に固定" });
    await waitFor(() => expect(pin).toBeEnabled());
    vi.useFakeTimers({ toFake: ["setTimeout", "clearTimeout"] });
    await act(async () => {
      fireEvent.click(pin);
      await Promise.resolve();
    });
    expect(screen.getByText("常に手前に固定しました。")).toBeVisible();

    await act(async () => {
      await vi.advanceTimersByTimeAsync(2_000);
    });
    await act(async () => {
      fireEvent.click(screen.getByRole("button", { name: "常に手前を解除" }));
      await Promise.resolve();
    });
    const message = "常に手前を解除しました。";
    expect(screen.getByText(message)).toBeVisible();

    await act(async () => {
      await vi.advanceTimersByTimeAsync(1_000);
    });
    expect(screen.getByText(message)).toBeVisible();
    await act(async () => {
      await vi.advanceTimersByTimeAsync(2_000);
    });
    expect(screen.queryByText(message)).toBeNull();
  });

  it("keeps a failed pin status after the previous success timer expires", async () => {
    const client = new MemoryAppClient([schedule]);
    const setAlwaysOnTop = vi.spyOn(client, "setWindowAlwaysOnTop");
    setAlwaysOnTop.mockResolvedValueOnce(undefined);
    setAlwaysOnTop.mockRejectedValueOnce(new Error("synthetic failure"));
    renderWidget(client);

    const pin = await screen.findByRole("button", { name: "常に手前に固定" });
    await waitFor(() => expect(pin).toBeEnabled());
    vi.useFakeTimers({ toFake: ["setTimeout", "clearTimeout"] });
    await act(async () => {
      fireEvent.click(pin);
      await Promise.resolve();
    });
    expect(screen.getByText("常に手前に固定しました。")).toBeVisible();

    await act(async () => {
      await vi.advanceTimersByTimeAsync(2_000);
    });
    await act(async () => {
      fireEvent.click(screen.getByRole("button", { name: "常に手前を解除" }));
      await Promise.resolve();
    });

    const failure = "常に手前の設定を保存できませんでした。もう一度お試しください。";
    expect(screen.getByRole("alert")).toHaveTextContent(failure);
    expect(screen.getByRole("button", { name: "常に手前を解除" })).toHaveAttribute(
      "aria-pressed",
      "true",
    );

    await act(async () => {
      await vi.advanceTimersByTimeAsync(1_000);
    });
    expect(screen.getByRole("alert")).toHaveTextContent(failure);
  });

  it("routes schedule, Quick Block, and empty-day actions through the main window contract", async () => {
    const user = userEvent.setup();
    const client = new MemoryAppClient([schedule]);
    const action = vi.spyOn(client, "openMainWithDayOverviewAction");
    vi.spyOn(client, "listQuickBlocks").mockResolvedValue([quickBlock]);
    const first = renderWidget(client);

    await user.click(await screen.findByRole("button", { name: /概要ウィジェットの予定/ }));
    expect(action).toHaveBeenLastCalledWith({
      type: "edit-schedule",
      scheduleId: schedule.id,
      date: dateInputValue(new Date()),
    });

    await user.click(await screen.findByRole("button", { name: /集中ブロック/ }));
    expect(action).toHaveBeenLastCalledWith({ type: "open-templates" });

    first.unmount();
    vi.setSystemTime(new Date(2026, 6, 20, 1, 0));
    localStorage.setItem(dayOverviewStartMinuteStorageKey, String(7 * 60));
    const emptyClient = new MemoryAppClient([]);
    const emptyAction = vi.spyOn(emptyClient, "openMainWithDayOverviewAction");
    renderWidget(emptyClient);
    const calendarToday = dateInputValue(new Date());
    await waitFor(() =>
      expect(document.querySelector(".day-overview-window__header time")).not.toBeNull(),
    );
    expect(document.querySelector(".day-overview-window__header time")).toHaveAttribute(
      "datetime",
      calendarToday,
    );
    await user.click(await screen.findByRole("button", { name: "予定を作成" }));
    expect(dateInputValue(dayOverviewCycleDate(new Date(), 7 * 60))).not.toBe(calendarToday);
    expect(emptyAction).toHaveBeenCalledWith({
      type: "create-schedule",
      date: calendarToday,
    });
  });

  it("routes schedules using the visible day when their start is outside the window", async () => {
    const user = userEvent.setup();
    const cycleDate = dayOverviewCycleDate(new Date(), 7 * 60);
    const previousStart = new Date(cycleDate);
    previousStart.setDate(previousStart.getDate() - 1);
    previousStart.setHours(23, 0, 0, 0);
    const previousEnd = new Date(previousStart.getTime() + 9 * 60 * 60_000);
    const nextMorningStart = new Date(cycleDate);
    nextMorningStart.setDate(nextMorningStart.getDate() + 1);
    nextMorningStart.setHours(2, 30, 0, 0);
    const nextMorningEnd = new Date(nextMorningStart.getTime() + 30 * 60_000);
    const previousSchedule: Schedule = {
      ...schedule,
      id: "00000000-0000-4000-8000-000000000033",
      title: "前夜からの予定",
      startUtc: previousStart.toISOString(),
      endUtc: previousEnd.toISOString(),
    };
    const nextMorningSchedule: Schedule = {
      ...schedule,
      id: "00000000-0000-4000-8000-000000000034",
      title: "翌朝の予定",
      startUtc: nextMorningStart.toISOString(),
      endUtc: nextMorningEnd.toISOString(),
    };
    localStorage.setItem(dayOverviewStartMinuteStorageKey, String(7 * 60));
    const client = new MemoryAppClient([previousSchedule, nextMorningSchedule]);
    const action = vi.spyOn(client, "openMainWithDayOverviewAction");
    renderWidget(client);

    await user.click(await screen.findByRole("button", { name: /前夜からの予定/ }));
    expect(action).toHaveBeenLastCalledWith({
      type: "edit-schedule",
      scheduleId: previousSchedule.id,
      date: dateInputValue(cycleDate),
    });

    await user.click(await screen.findByRole("button", { name: /翌朝の予定/ }));

    expect(action).toHaveBeenLastCalledWith({
      type: "edit-schedule",
      scheduleId: nextMorningSchedule.id,
      date: dateInputValue(nextMorningStart),
    });
  });

  it("restores a saved single-lane window size without replacing its expanded height", async () => {
    localStorage.setItem("day-schedule-next.day-overview-mode", "template");
    localStorage.setItem("day-schedule-next.day-overview-expanded-height", "640");
    const client = new MemoryAppClient([schedule]);
    const setWindowMode = vi.spyOn(client, "setDayOverviewWindowMode");
    renderWidget(client);

    expect(await screen.findByRole("button", { name: "概要の設定を開く" })).toBeVisible();
    await waitFor(() => {
      expect(setWindowMode).toHaveBeenLastCalledWith("single", 640);
    });
    expect(localStorage.getItem("day-schedule-next.day-overview-expanded-height")).toBe("640");
    expect(
      document.querySelector(".overview-lane[aria-labelledby='schedule-lane-title']"),
    ).toHaveAttribute("hidden");
  });
});

describe("FloatingDayOverviewLauncher", () => {
  it("opens the floating overview through the client", async () => {
    const user = userEvent.setup();
    const client = new MemoryAppClient([]);
    const open = vi.spyOn(client, "openDayOverviewWindow");
    render(<FloatingDayOverviewLauncher client={client} />);

    await user.click(screen.getByRole("button", { name: "今日の予定概要を開く" }));
    expect(open).toHaveBeenCalledOnce();
  });
});
