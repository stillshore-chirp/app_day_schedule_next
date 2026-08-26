import { act, cleanup, render, screen } from "@testing-library/react";
import axe from "axe-core";
import { afterEach, describe, expect, it, vi } from "vitest";
import type { ComponentProps } from "react";
import { DayOverview } from "./DayOverview";

afterEach(cleanup);

const baseProps: ComponentProps<typeof DayOverview> = {
  schedules: [],
  scheduleState: "ready",
  selectedDate: new Date(2026, 6, 20),
  selectedId: null,
  onSelect: vi.fn(),
  onCreateSchedule: vi.fn(),
  template: null,
  templateState: "loading",
  onRetryTemplate: vi.fn(),
  referenceMinute: 0,
  onReferenceChange: vi.fn(),
  textScalePercent: 250,
};

async function expectNoSeriousOrCriticalViolations(container: HTMLElement) {
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
}

describe("DayOverview accessibility", () => {
  it("keeps template loading and retry states reachable at high text scale", async () => {
    const { container, rerender } = render(<DayOverview {...baseProps} />);
    const templateTrack = container.querySelector<HTMLElement>(".overview-lane__track--template");

    expect(templateTrack).not.toHaveAttribute("aria-hidden");
    expect(screen.getByText("日次テンプレートを読み込み中")).toBeVisible();
    await expectNoSeriousOrCriticalViolations(container);

    rerender(<DayOverview {...baseProps} templateState="error" onRetryTemplate={vi.fn()} />);

    expect(templateTrack).not.toHaveAttribute("aria-hidden");
    expect(screen.getByRole("button", { name: "再試行" })).toBeVisible();
    await expectNoSeriousOrCriticalViolations(container);
  });
});
