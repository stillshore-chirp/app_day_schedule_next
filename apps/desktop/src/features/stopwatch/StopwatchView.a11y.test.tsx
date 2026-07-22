import { act, cleanup, render, screen } from "@testing-library/react";
import axe from "axe-core";
import { afterEach, describe, expect, it } from "vitest";
import { MemoryAppClient } from "../../shared/ipc/memory-client";
import { StopwatchView } from "./StopwatchView";

afterEach(cleanup);

describe("StopwatchView accessibility", () => {
  it("has no automated serious or critical WCAG violations", async () => {
    const { container } = render(<StopwatchView client={new MemoryAppClient([])} />);
    await screen.findByRole("heading", { name: "ストップウォッチ", level: 1 });
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
