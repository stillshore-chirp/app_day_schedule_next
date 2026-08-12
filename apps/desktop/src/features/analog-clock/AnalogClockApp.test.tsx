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
  it("keeps the clock dominant and opens migrated controls on demand", async () => {
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
    expect(screen.getByText(/\d{4}\/\d{2}\/\d{2}.*\d{2}:\d{2}:\d{2}/)).toBeVisible();
    expect(screen.queryByRole("dialog", { name: "時計の設定" })).toBeNull();
    const pin = await screen.findByRole("button", { name: "常に手前に固定" });
    expect(pin).toHaveAttribute("title", "常に手前に固定");
    expect(pin).toHaveAttribute("aria-pressed", "false");
    await waitFor(() => expect(pin).toBeEnabled());
    await user.click(pin);
    expect(setAlwaysOnTop).toHaveBeenCalledWith("analog-clock", true);
    expect(await screen.findByRole("button", { name: "常に手前を解除" })).toHaveAttribute(
      "aria-pressed",
      "true",
    );

    await user.click(screen.getByRole("button", { name: "時計の設定を開く" }));
    expect(screen.getByRole("dialog", { name: "時計の設定" })).toBeVisible();
    expect(screen.getByRole("checkbox", { name: "秒針音" })).not.toBeChecked();
    expect(screen.getByRole("slider", { name: "秒針音の音量" })).toHaveValue("50");
    expect(screen.queryByRole("combobox", { name: /音声出力/ })).toBeNull();
    expect(document.documentElement.dataset.theme).toBe("dark");

    await user.click(screen.getByRole("button", { name: "サイズ変更（1×）" }));
    expect(resize).toHaveBeenCalledWith(1.5);
    expect(await screen.findByRole("button", { name: "サイズ変更（1.5×）" })).toBeVisible();

    const topmost = screen.getByRole("checkbox", { name: "常に手前" });
    await waitFor(() => expect(topmost).toBeEnabled());
    expect(topmost).toBeChecked();
    await user.click(topmost);
    expect(setAlwaysOnTop).toHaveBeenLastCalledWith("analog-clock", false);
    expect(screen.getByRole("button", { name: "常に手前に固定" })).toHaveAttribute(
      "aria-pressed",
      "false",
    );

    await user.keyboard("{Escape}");
    expect(screen.queryByRole("dialog", { name: "時計の設定" })).toBeNull();
    expect(screen.getByRole("button", { name: "時計の設定を開く" })).toHaveFocus();
  });

  it("restores the pin state and explains recovery when the native update fails", async () => {
    const client = new MemoryAppClient();
    vi.spyOn(client, "setWindowAlwaysOnTop").mockRejectedValueOnce(new Error("window"));
    const queryClient = new QueryClient({ defaultOptions: { queries: { retry: false } } });
    const user = userEvent.setup();
    render(
      <QueryClientProvider client={queryClient}>
        <AnalogClockApp client={client} />
      </QueryClientProvider>,
    );

    const pin = await screen.findByRole("button", { name: "常に手前に固定" });
    await waitFor(() => expect(pin).toBeEnabled());
    await user.click(pin);

    await waitFor(() => expect(pin).toHaveAttribute("aria-pressed", "false"));
    expect(pin).toHaveAccessibleName("常に手前に固定");
    expect(screen.getByRole("alert")).toHaveTextContent(
      "常に手前の設定を保存できませんでした。もう一度試してください。",
    );
  });

  it("remeasures the clock after the resized native layout has settled", async () => {
    const queryClient = new QueryClient({ defaultOptions: { queries: { retry: false } } });
    render(
      <QueryClientProvider client={queryClient}>
        <AnalogClockApp client={new MemoryAppClient()} />
      </QueryClientProvider>,
    );

    await screen.findByRole("heading", { name: "アナログ時計" });
    const stage = document.querySelector<HTMLElement>(".analog-clock-stage");
    expect(stage).not.toBeNull();
    Object.defineProperties(stage, {
      clientHeight: { configurable: true, value: 280 },
      clientWidth: { configurable: true, value: 280 },
    });

    window.dispatchEvent(new Event("resize"));

    await waitFor(() => expect(stage).toHaveStyle({ "--analog-clock-face-size": "268px" }));
  });

  it("keeps sound off and explains recovery when Web Audio is unavailable", async () => {
    const queryClient = new QueryClient({ defaultOptions: { queries: { retry: false } } });
    const user = userEvent.setup();
    render(
      <QueryClientProvider client={queryClient}>
        <AnalogClockApp client={new MemoryAppClient()} />
      </QueryClientProvider>,
    );
    await user.click(await screen.findByRole("button", { name: "時計の設定を開く" }));
    const sound = await screen.findByRole("checkbox", { name: "秒針音" });
    await user.click(sound);
    expect(sound).not.toBeChecked();
    expect(
      screen.getByText(/秒針音を開始できませんでした。OSの音量と音声出力を確認/),
    ).toBeVisible();
  });
});
