import { act, cleanup, render, screen, waitFor } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import axe from "axe-core";
import { afterEach, describe, expect, it } from "vitest";
import type { GoogleConnection } from "../shared/contracts";
import { MemoryAppClient } from "../shared/ipc/memory-client";
import { App } from "./App";
import { useUiStore } from "./ui-store";

afterEach(() => {
  cleanup();
  useUiStore.setState({
    activeView: "today",
    selectedDate: new Date(),
    selectedScheduleId: null,
    editorMode: "closed",
    search: "",
    createRange: null,
    referenceMinute: 480,
    templateFocusPending: false,
  });
});

describe("App accessibility", () => {
  it("has no automated serious or critical accessibility violations in Today", async () => {
    const queryClient = new QueryClient({ defaultOptions: { queries: { retry: false } } });
    const { container } = render(
      <QueryClientProvider client={queryClient}>
        <App client={new MemoryAppClient()} />
      </QueryClientProvider>,
    );
    await screen.findByRole("heading", { name: "詳細タイムライン" });
    const result = await act(() =>
      axe.run(container, {
        runOnly: {
          type: "tag",
          values: ["wcag2a", "wcag2aa", "wcag21aa", "wcag22aa"],
        },
        rules: { "color-contrast": { enabled: false } },
      }),
    );
    expect(
      result.violations.filter((violation) =>
        ["serious", "critical"].includes(violation.impact ?? ""),
      ),
    ).toEqual([]);
  });

  it("opens schedule creation from the keyboard shortcut", async () => {
    const queryClient = new QueryClient({ defaultOptions: { queries: { retry: false } } });
    render(
      <QueryClientProvider client={queryClient}>
        <App client={new MemoryAppClient()} />
      </QueryClientProvider>,
    );
    await screen.findByRole("heading", { name: "詳細タイムライン" });
    act(() => {
      window.dispatchEvent(new KeyboardEvent("keydown", { key: "n", metaKey: true }));
    });
    await waitFor(() => expect(screen.getByRole("heading", { name: "予定を作成" })).toBeVisible());
    expect(screen.getByLabelText("タイトル")).toHaveFocus();
  });

  it("has no automated serious or critical violations in configured Google settings", async () => {
    class ConfiguredGoogleClient extends MemoryAppClient {
      override googleConnection(): Promise<GoogleConnection> {
        return Promise.resolve({
          configured: true,
          state: "configured",
          accountId: null,
          displayLabel: null,
          calendars: [],
          lastError: null,
          mappedScheduleCount: 0,
        });
      }
    }

    const user = userEvent.setup();
    const queryClient = new QueryClient({ defaultOptions: { queries: { retry: false } } });
    const { container } = render(
      <QueryClientProvider client={queryClient}>
        <App client={new ConfiguredGoogleClient()} />
      </QueryClientProvider>,
    );
    await user.click(await screen.findByRole("button", { name: "設定" }));
    await screen.findByRole("button", { name: "Google カレンダーに接続" });

    const result = await act(() =>
      axe.run(container, {
        runOnly: {
          type: "tag",
          values: ["wcag2a", "wcag2aa", "wcag21aa", "wcag22aa"],
        },
        rules: { "color-contrast": { enabled: false } },
      }),
    );

    expect(
      result.violations.filter((violation) =>
        ["serious", "critical"].includes(violation.impact ?? ""),
      ),
    ).toEqual([]);
  });

  it("has no automated serious or critical violations in per-calendar recovery states", async () => {
    class CalendarRecoveryClient extends MemoryAppClient {
      override googleConnection(): Promise<GoogleConnection> {
        return Promise.resolve({
          configured: true,
          state: "connected",
          accountId: "aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa",
          displayLabel: null,
          calendars: [
            {
              id: "bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb",
              displayName: "Permission recovery",
              color: "#6F96F4",
              timezoneId: "Asia/Tokyo",
              accessRole: "reader",
              selected: true,
              defaultWriteTarget: false,
              writable: false,
              eventReadable: true,
              syncState: "unavailable",
              lastErrorCategory: "permission",
              nextRetryAt: null,
            },
            {
              id: "cccccccc-cccc-4ccc-8ccc-cccccccccccc",
              displayName: "Free busy",
              color: "#6F96F4",
              timezoneId: "Asia/Tokyo",
              accessRole: "freeBusyReader",
              selected: false,
              defaultWriteTarget: false,
              writable: false,
              eventReadable: false,
              syncState: "never",
              lastErrorCategory: null,
              nextRetryAt: null,
            },
          ],
          lastError: null,
          mappedScheduleCount: 0,
        });
      }
    }

    const user = userEvent.setup();
    const queryClient = new QueryClient({ defaultOptions: { queries: { retry: false } } });
    const { container } = render(
      <QueryClientProvider client={queryClient}>
        <App client={new CalendarRecoveryClient()} />
      </QueryClientProvider>,
    );
    await user.click(await screen.findByRole("button", { name: "設定" }));
    await screen.findByText("同期を停止しました。Google側の共有権限を確認してください。");
    expect(screen.getAllByRole("checkbox", { name: "同期" })[1]).toBeDisabled();

    const result = await act(() =>
      axe.run(container, {
        runOnly: {
          type: "tag",
          values: ["wcag2a", "wcag2aa", "wcag21aa", "wcag22aa"],
        },
        rules: { "color-contrast": { enabled: false } },
      }),
    );

    expect(
      result.violations.filter((violation) =>
        ["serious", "critical"].includes(violation.impact ?? ""),
      ),
    ).toEqual([]);
  });
});
