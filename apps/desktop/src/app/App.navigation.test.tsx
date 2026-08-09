import { cleanup, render, screen, waitFor, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { afterEach, describe, expect, it, vi } from "vitest";
import type { DayTemplate } from "../shared/contracts";
import { MemoryAppClient } from "../shared/ipc/memory-client";
import { App } from "./App";
import { useUiStore } from "./ui-store";

afterEach(() => {
  cleanup();
  localStorage.clear();
  delete document.documentElement.dataset.theme;
  useUiStore.setState({ activeView: "today" });
});

describe("App time-tool navigation", () => {
  it("starts with an icon-only sidebar and preserves an explicit expanded choice", async () => {
    const user = userEvent.setup();
    const queryClient = new QueryClient({ defaultOptions: { queries: { retry: false } } });
    const { container, unmount } = render(
      <QueryClientProvider client={queryClient}>
        <App client={new MemoryAppClient()} />
      </QueryClientProvider>,
    );

    const toggle = await screen.findByRole("button", { name: "サイドバーを展開" });
    expect(container.querySelector(".app-shell")).toHaveAttribute("data-sidebar", "collapsed");
    const sidebar = screen.getByLabelText("主要画面");
    expect(within(sidebar).getByRole("button", { name: "今日" })).toHaveAttribute("title", "今日");

    await user.click(toggle);

    expect(container.querySelector(".app-shell")).toHaveAttribute("data-sidebar", "expanded");
    expect(screen.getByRole("button", { name: "サイドバーを格納" })).toBeVisible();
    expect(within(sidebar).getByRole("button", { name: "今日" })).not.toHaveAttribute("title");
    expect(localStorage.getItem("day-schedule-next.sidebar-expanded")).toBe("true");

    unmount();
    const restoredQueryClient = new QueryClient({
      defaultOptions: { queries: { retry: false } },
    });
    const restored = render(
      <QueryClientProvider client={restoredQueryClient}>
        <App client={new MemoryAppClient()} />
      </QueryClientProvider>,
    );
    await screen.findByRole("button", { name: "サイドバーを格納" });
    expect(restored.container.querySelector(".app-shell")).toHaveAttribute(
      "data-sidebar",
      "expanded",
    );
  });

  it("opens timers and stopwatch as separate navigation destinations", async () => {
    const user = userEvent.setup();
    const queryClient = new QueryClient({ defaultOptions: { queries: { retry: false } } });
    render(
      <QueryClientProvider client={queryClient}>
        <App client={new MemoryAppClient()} />
      </QueryClientProvider>,
    );
    const timerNavigation = await screen.findByRole("button", { name: "タイマー" });
    const stopwatchNavigation = screen.getByRole("button", { name: "ストップウォッチ" });

    await user.click(timerNavigation);
    expect(await screen.findByRole("heading", { name: "タイマー", level: 1 })).toBeVisible();
    expect(screen.queryByRole("heading", { name: "ストップウォッチ", level: 1 })).toBeNull();

    await user.click(stopwatchNavigation);
    expect(
      await screen.findByRole("heading", { name: "ストップウォッチ", level: 1 }),
    ).toBeVisible();
    expect(screen.queryByRole("heading", { name: "タイマー", level: 1 })).toBeNull();
  });

  it("opens the ticket board as an independent primary navigation destination", async () => {
    const user = userEvent.setup();
    const queryClient = new QueryClient({ defaultOptions: { queries: { retry: false } } });
    render(
      <QueryClientProvider client={queryClient}>
        <App client={new MemoryAppClient([])} />
      </QueryClientProvider>,
    );

    await user.click(await screen.findByRole("button", { name: "チケット" }));

    expect(await screen.findByRole("heading", { name: "チケット", level: 1 })).toBeVisible();
    expect(
      screen.getAllByRole("heading", { level: 2 }).map((heading) => heading.textContent),
    ).toEqual(
      expect.arrayContaining(["Inbox", "Backlog", "Next", "In Progress", "Waiting", "Done"]),
    );
    expect(screen.queryByRole("heading", { name: "詳細タイムライン" })).toBeNull();
    expect(screen.queryByRole("searchbox", { name: "予定を検索" })).toBeNull();
  });

  it("applies and persists the mild theme after settings are saved", async () => {
    const user = userEvent.setup();
    const client = new MemoryAppClient();
    const queryClient = new QueryClient({ defaultOptions: { queries: { retry: false } } });
    render(
      <QueryClientProvider client={queryClient}>
        <App client={client} />
      </QueryClientProvider>,
    );

    await user.click(await screen.findByRole("button", { name: "設定" }));
    await user.selectOptions(screen.getByRole("combobox", { name: "テーマ" }), "mild");
    await user.click(screen.getByRole("button", { name: "設定を保存" }));

    await waitFor(() => expect(document.documentElement.dataset.theme).toBe("mild"));
    expect((await client.bootstrap()).settings.theme).toBe("mild");
  });

  it("keeps template editing in the sidebar destination instead of Today", async () => {
    const user = userEvent.setup();
    const client = new MemoryAppClient([]);
    const applyTemplate = vi.spyOn(client, "applyTemplate");
    const createSchedule = vi.spyOn(client, "createSchedule");
    const queryClient = new QueryClient({ defaultOptions: { queries: { retry: false } } });
    render(
      <QueryClientProvider client={queryClient}>
        <App client={client} />
      </QueryClientProvider>,
    );

    await screen.findByRole("heading", { name: "詳細タイムライン" });
    expect(screen.queryByRole("button", { name: "テンプレートを編集" })).toBeNull();

    await user.click(
      within(screen.getByLabelText("主要画面")).getByRole("button", { name: "テンプレート" }),
    );
    expect(
      await screen.findByRole("heading", {
        name: "テンプレートを編集",
        level: 2,
      }),
    ).toBeVisible();
    expect(applyTemplate).not.toHaveBeenCalled();
    expect(createSchedule).not.toHaveBeenCalled();
  });

  it("refreshes Today after the selected template changes without restarting", async () => {
    const templates: DayTemplate[] = [
      {
        id: "00000000-0000-4000-8000-000000000031",
        name: "朝型テンプレート",
        description: "",
        color: "#6F96F4",
        weekdaysMask: 127,
        isBuiltin: false,
        sortOrder: 0,
        version: 0,
        blocks: [],
      },
      {
        id: "00000000-0000-4000-8000-000000000032",
        name: "夜型テンプレート",
        description: "",
        color: "#8B6FF4",
        weekdaysMask: 127,
        isBuiltin: false,
        sortOrder: 1,
        version: 0,
        blocks: [],
      },
    ];
    class TemplateClient extends MemoryAppClient {
      override listTemplates(): Promise<DayTemplate[]> {
        return Promise.resolve(structuredClone(templates));
      }
    }
    const user = userEvent.setup();
    const client = new TemplateClient([]);
    const queryClient = new QueryClient({ defaultOptions: { queries: { retry: false } } });
    render(
      <QueryClientProvider client={queryClient}>
        <App client={client} />
      </QueryClientProvider>,
    );

    await user.click(await screen.findByRole("button", { name: "テンプレート" }));
    const nightTemplate = await screen.findByText("夜型テンプレート");
    await user.click(nightTemplate.closest("button")!);
    await waitFor(async () =>
      expect((await client.bootstrap()).settings.lastTemplateId).toBe(templates[1]?.id),
    );
    await user.click(
      within(screen.getByLabelText("主要画面")).getByRole("button", { name: "今日" }),
    );

    expect(
      await screen.findByRole("heading", { name: "夜型テンプレート", level: 3 }),
    ).toBeVisible();
  });

  it("persists rapid template selections in the order the user made them", async () => {
    const templates: DayTemplate[] = [
      {
        id: "00000000-0000-4000-8000-000000000035",
        name: "元のテンプレート",
        description: "",
        color: "#6F96F4",
        weekdaysMask: 127,
        isBuiltin: false,
        sortOrder: 0,
        version: 0,
        blocks: [],
      },
      {
        id: "00000000-0000-4000-8000-000000000036",
        name: "一時選択テンプレート",
        description: "",
        color: "#8B6FF4",
        weekdaysMask: 127,
        isBuiltin: false,
        sortOrder: 1,
        version: 0,
        blocks: [],
      },
    ];
    class TemplateClient extends MemoryAppClient {
      override listTemplates(): Promise<DayTemplate[]> {
        return Promise.resolve(structuredClone(templates));
      }
    }
    const user = userEvent.setup();
    const client = new TemplateClient([]);
    await client.updateSettings({
      ...(await client.bootstrap()).settings,
      lastTemplateId: templates[0]!.id,
    });
    const updateSettings = vi.spyOn(client, "updateSettings");
    const queryClient = new QueryClient({ defaultOptions: { queries: { retry: false } } });
    render(
      <QueryClientProvider client={queryClient}>
        <App client={client} />
      </QueryClientProvider>,
    );

    await user.click(await screen.findByRole("button", { name: "テンプレート" }));
    await user.click((await screen.findByText("一時選択テンプレート")).closest("button")!);
    await user.click((await screen.findByText("元のテンプレート")).closest("button")!);

    await waitFor(() => expect(updateSettings).toHaveBeenCalledTimes(2));
    await waitFor(async () =>
      expect((await client.bootstrap()).settings.lastTemplateId).toBe(templates[0]!.id),
    );
  });

  it("reports a template selection persistence failure instead of implying it was saved", async () => {
    const templates: DayTemplate[] = [
      {
        id: "00000000-0000-4000-8000-000000000041",
        name: "標準テンプレート",
        description: "",
        color: "#6F96F4",
        weekdaysMask: 127,
        isBuiltin: false,
        sortOrder: 0,
        version: 0,
        blocks: [],
      },
      {
        id: "00000000-0000-4000-8000-000000000042",
        name: "保存失敗テスト",
        description: "",
        color: "#8B6FF4",
        weekdaysMask: 127,
        isBuiltin: false,
        sortOrder: 1,
        version: 0,
        blocks: [],
      },
    ];
    class FailingSettingsClient extends MemoryAppClient {
      override listTemplates(): Promise<DayTemplate[]> {
        return Promise.resolve(structuredClone(templates));
      }

      override updateSettings(): Promise<never> {
        return Promise.reject(new Error("synthetic_settings_failure"));
      }
    }
    const user = userEvent.setup();
    const client = new FailingSettingsClient([]);
    const queryClient = new QueryClient({ defaultOptions: { queries: { retry: false } } });
    render(
      <QueryClientProvider client={queryClient}>
        <App client={client} />
      </QueryClientProvider>,
    );

    await user.click(await screen.findByRole("button", { name: "テンプレート" }));
    const failingTemplate = await screen.findByText("保存失敗テスト");
    await user.click(failingTemplate.closest("button")!);

    expect(
      await screen.findByText(
        "テンプレートの選択は表示に反映しましたが、次回の表示設定を保存できませんでした。もう一度選択してください。",
      ),
    ).toBeVisible();
  });
});
