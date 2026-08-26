import { act, cleanup, render, screen, waitFor } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { afterEach, describe, expect, it, vi } from "vitest";
import type { Settings } from "../../shared/contracts";
import { MemoryAppClient } from "../../shared/ipc/memory-client";
import { AnalogClockApp } from "./AnalogClockApp";

const listenMock = vi.hoisted(() => vi.fn());

vi.mock("@tauri-apps/api/event", () => ({ listen: listenMock }));

afterEach(() => {
  cleanup();
  localStorage.clear();
  delete document.documentElement.dataset.theme;
  delete document.documentElement.dataset.textScale;
  delete document.documentElement.dataset.textScaleLevel;
  delete document.documentElement.dataset.windowKind;
  delete document.documentElement.dataset.window;
  document.documentElement.style.removeProperty("--app-font-scale-percent");
  document.documentElement.style.removeProperty("--app-font-scale-factor");
  document.documentElement.style.removeProperty("font-size");
  delete (window as unknown as { __TAURI_INTERNALS__?: unknown }).__TAURI_INTERNALS__;
  listenMock.mockReset();
});

describe("AnalogClockApp", () => {
  it("keeps the clock dominant and opens migrated controls on demand", async () => {
    localStorage.setItem("day-schedule-next.analog-clock-theme", "dark");
    const client = new MemoryAppClient();
    const bootstrap = await client.bootstrap();
    await client.updateSettings({ ...bootstrap.settings, textScalePercent: 250 });
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
    expect(pin).toHaveAttribute("aria-pressed", "false");
    await waitFor(() => expect(pin).toBeEnabled());
    await user.hover(pin);
    expect(await screen.findByRole("tooltip", { name: "常に手前に固定" })).toBeVisible();
    await user.unhover(pin);
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
    expect(document.documentElement.dataset.textScale).toBe("250");
    expect(document.documentElement.dataset.textScaleLevel).toBe("extra");

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

  it("subscribes to native settings updates and unregisters the listener on unmount", async () => {
    type SettingsEvent = { event: string; id: number; payload: Settings };
    const unlisten = vi.fn();
    let onSettingsUpdated: ((event: SettingsEvent) => void) | undefined;
    listenMock.mockImplementation(
      (_eventName: string, listener: (event: SettingsEvent) => void) => {
        onSettingsUpdated = listener;
        return Promise.resolve(unlisten);
      },
    );
    Object.defineProperty(window, "__TAURI_INTERNALS__", {
      configurable: true,
      value: {},
    });

    const client = new MemoryAppClient();
    const currentSettings = (await client.bootstrap()).settings;
    const updatedSettings: Settings = { ...currentSettings, textScalePercent: 200 };
    await client.updateSettings(updatedSettings);
    const queryClient = new QueryClient({ defaultOptions: { queries: { retry: false } } });
    const { unmount } = render(
      <QueryClientProvider client={queryClient}>
        <AnalogClockApp client={client} />
      </QueryClientProvider>,
    );

    await waitFor(() => {
      expect(listenMock).toHaveBeenCalledWith("settings-updated", expect.any(Function));
      expect(onSettingsUpdated).toBeTypeOf("function");
    });
    act(() => {
      onSettingsUpdated?.({
        event: "settings-updated",
        id: 1,
        payload: updatedSettings,
      });
    });
    expect(document.documentElement.dataset.textScale).toBe("200");

    unmount();
    expect(unlisten).toHaveBeenCalledTimes(1);
  });

  it("handles native settings listener registration failure", async () => {
    listenMock.mockRejectedValueOnce(new Error("event permission denied"));
    Object.defineProperty(window, "__TAURI_INTERNALS__", {
      configurable: true,
      value: {},
    });
    const queryClient = new QueryClient({ defaultOptions: { queries: { retry: false } } });
    const unhandledRejection = vi.fn();
    window.addEventListener("unhandledrejection", unhandledRejection);

    render(
      <QueryClientProvider client={queryClient}>
        <AnalogClockApp client={new MemoryAppClient()} />
      </QueryClientProvider>,
    );

    await waitFor(() =>
      expect(listenMock).toHaveBeenCalledWith("settings-updated", expect.any(Function)),
    );
    await Promise.resolve();
    window.removeEventListener("unhandledrejection", unhandledRejection);
    expect(unhandledRejection).not.toHaveBeenCalled();
  });
});
