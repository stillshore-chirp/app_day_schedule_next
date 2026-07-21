import { cleanup, render, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { afterEach, describe, expect, it } from "vitest";
import { MemoryAppClient } from "../shared/ipc/memory-client";
import { App } from "./App";
import { useUiStore } from "./ui-store";

afterEach(() => {
  cleanup();
  localStorage.clear();
  useUiStore.setState({ activeView: "today" });
});

describe("App time-tool navigation", () => {
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
});
