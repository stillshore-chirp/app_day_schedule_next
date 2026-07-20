import { act, cleanup, render, screen, waitFor } from "@testing-library/react";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import axe from "axe-core";
import { afterEach, describe, expect, it } from "vitest";
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
});
