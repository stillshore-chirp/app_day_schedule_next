import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { cleanup, render, screen, waitFor } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { afterEach, describe, expect, it, vi } from "vitest";
import type { QuickBlock, Schedule } from "../../shared/contracts";
import { dateInputValue } from "../../shared/time";
import { MemoryAppClient } from "../../shared/ipc/memory-client";
import { FloatingDayOverviewApp } from "./FloatingDayOverviewApp";
import { FloatingDayOverviewLauncher } from "./FloatingDayOverviewLauncher";

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
  localStorage.clear();
  delete document.documentElement.dataset.theme;
  delete document.documentElement.dataset.textScale;
  delete document.documentElement.dataset.textScaleLevel;
});

describe("FloatingDayOverviewApp", () => {
  it("switches between the three lanes, applies local theme, and persists its pin", async () => {
    const user = userEvent.setup();
    const client = new MemoryAppClient([schedule]);
    const setAlwaysOnTop = vi.spyOn(client, "setWindowAlwaysOnTop");
    renderWidget(client);

    expect(await screen.findByRole("button", { name: /概要ウィジェットの予定/ })).toBeVisible();
    expect(document.querySelectorAll(".overview-lane")).toHaveLength(2);
    expect(screen.queryByRole("slider", { name: "詳細表示の基準時刻" })).toBeNull();

    await user.click(screen.getByRole("button", { name: "概要の設定を開く" }));
    const scheduleOnly = screen.getByRole("button", { name: "予定のみ（上段）" });
    const templateOnly = screen.getByRole("button", { name: "テンプレートのみ（下段）" });
    const both = screen.getByRole("button", { name: "予定とテンプレート" });

    await user.click(scheduleOnly);
    expect(scheduleOnly).toHaveAttribute("aria-pressed", "true");
    expect(
      document.querySelector(".overview-lane[aria-labelledby='template-lane-title']"),
    ).toHaveAttribute("hidden");

    await user.click(templateOnly);
    expect(templateOnly).toHaveAttribute("aria-pressed", "true");
    expect(
      document.querySelector(".overview-lane[aria-labelledby='schedule-lane-title']"),
    ).toHaveAttribute("hidden");
    expect(document.querySelector(".overview-lane__track--template")).toBeVisible();

    await user.click(both);
    expect(both).toHaveAttribute("aria-pressed", "true");
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
    const emptyClient = new MemoryAppClient([]);
    const emptyAction = vi.spyOn(emptyClient, "openMainWithDayOverviewAction");
    renderWidget(emptyClient);
    await user.click(await screen.findByRole("button", { name: "予定を作成" }));
    expect(emptyAction).toHaveBeenCalledWith({
      type: "create-schedule",
      date: dateInputValue(new Date()),
    });
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
