import { act, cleanup, render, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import axe from "axe-core";
import { afterEach, describe, expect, it } from "vitest";
import { MemoryAppClient } from "../../shared/ipc/memory-client";
import { AnalogClockApp } from "./AnalogClockApp";

afterEach(() => {
  cleanup();
  localStorage.clear();
});

describe("AnalogClockApp accessibility", () => {
  it("has no automated serious or critical accessibility violations", async () => {
    const queryClient = new QueryClient({ defaultOptions: { queries: { retry: false } } });
    const { container } = render(
      <QueryClientProvider client={queryClient}>
        <AnalogClockApp client={new MemoryAppClient()} />
      </QueryClientProvider>,
    );
    await screen.findByRole("heading", { name: "アナログ時計" });
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

    const user = userEvent.setup();
    await user.click(screen.getByRole("button", { name: "時計の設定を開く" }));
    const settingsResult = await act(() =>
      axe.run(container, {
        runOnly: {
          type: "tag",
          values: ["wcag2a", "wcag2aa", "wcag21aa", "wcag22aa"],
        },
        rules: { "color-contrast": { enabled: false } },
      }),
    );
    expect(
      settingsResult.violations.filter((violation) =>
        ["serious", "critical"].includes(violation.impact ?? ""),
      ),
    ).toEqual([]);
  });
});
