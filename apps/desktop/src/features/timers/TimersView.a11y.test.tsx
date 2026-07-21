import { act, cleanup, render, screen } from "@testing-library/react";
import axe from "axe-core";
import { afterEach, describe, expect, it } from "vitest";
import { MemoryAppClient } from "../../shared/ipc/memory-client";
import { TimersView } from "./TimersView";

afterEach(cleanup);

describe("TimersView accessibility", () => {
  it("has no automated serious or critical WCAG violations in the empty state", async () => {
    const { container } = render(<TimersView client={new MemoryAppClient([])} />);
    await screen.findByRole("heading", { name: "タイマー", level: 1 });
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

  it("has no automated serious or critical WCAG violations with timers and a saved set", async () => {
    const client = new MemoryAppClient([]);
    await client.createTimer({ label: "紅茶", durationSeconds: 180 });
    await client.createTimer({ label: "ストレッチ", durationSeconds: 300 });
    await client.createTimerSet("休憩セット");
    const { container } = render(<TimersView client={client} />);
    await screen.findByRole("heading", { name: "紅茶" });

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
