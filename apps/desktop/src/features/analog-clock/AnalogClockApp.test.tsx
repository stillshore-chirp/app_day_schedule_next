import { cleanup, render, screen, waitFor } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { afterEach, describe, expect, it, vi } from "vitest";
import { MemoryAppClient } from "../../shared/ipc/memory-client";
import { AnalogClockApp } from "./AnalogClockApp";

afterEach(() => {
  cleanup();
  localStorage.clear();
  delete document.documentElement.dataset.theme;
});

describe("AnalogClockApp", () => {
  it("shows the migrated clock controls without an audio-device selector", async () => {
    localStorage.setItem("day-schedule-next.analog-clock-theme", "dark");
    const client = new MemoryAppClient();
    const resize = vi.spyOn(client, "resizeAnalogClockWindow");
    const setAlwaysOnTop = vi.spyOn(client, "setWindowAlwaysOnTop");
    const queryClient = new QueryClient({ defaultOptions: { queries: { retry: false } } });
    const user = userEvent.setup();
    render(
      <QueryClientProvider client={queryClient}>
        <AnalogClockApp client={client} />
      </QueryClientProvider>,
    );

    expect(await screen.findByRole("heading", { name: "アナログ時計" })).toBeVisible();
    expect(screen.getByRole("img", { name: /^現在時刻/ })).toBeVisible();
    expect(screen.getByRole("checkbox", { name: "秒針音" })).not.toBeChecked();
    expect(screen.getByRole("slider", { name: "秒針音の音量" })).toHaveValue("50");
    expect(screen.queryByRole("combobox", { name: /音声出力/ })).toBeNull();
    expect(document.documentElement.dataset.theme).toBe("dark");

    await user.click(screen.getByRole("button", { name: "サイズ変更（1×）" }));
    expect(resize).toHaveBeenCalledWith(1.5);
    expect(await screen.findByRole("button", { name: "サイズ変更（1.5×）" })).toBeVisible();

    const topmost = screen.getByRole("checkbox", { name: "常に手前" });
    await waitFor(() => expect(topmost).toBeEnabled());
    await user.click(topmost);
    expect(setAlwaysOnTop).toHaveBeenCalledWith("analog-clock", true);
  });

  it("keeps sound off and explains recovery when Web Audio is unavailable", async () => {
    const queryClient = new QueryClient({ defaultOptions: { queries: { retry: false } } });
    const user = userEvent.setup();
    render(
      <QueryClientProvider client={queryClient}>
        <AnalogClockApp client={new MemoryAppClient()} />
      </QueryClientProvider>,
    );
    const sound = await screen.findByRole("checkbox", { name: "秒針音" });
    await user.click(sound);
    expect(sound).not.toBeChecked();
    expect(
      screen.getByText(/秒針音を開始できませんでした。OSの音量と音声出力を確認/),
    ).toBeVisible();
  });
});
