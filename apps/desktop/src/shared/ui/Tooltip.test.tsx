import { cleanup, render, screen, waitFor } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { afterEach, describe, expect, it, vi } from "vitest";
import { Tooltip } from "./Tooltip";

afterEach(() => {
  cleanup();
});

describe("Tooltip", () => {
  it("renders a body-level DOM tooltip on hover without using a native title", async () => {
    const user = userEvent.setup();
    render(
      <div style={{ overflow: "hidden" }}>
        <Tooltip label="予定の詳細を表示">
          <button type="button" aria-label="予定を開く">
            開く
          </button>
        </Tooltip>
      </div>,
    );

    const trigger = screen.getByRole("button", { name: "予定を開く" });
    expect(trigger).not.toHaveAttribute("title");
    expect(screen.queryByRole("tooltip")).not.toBeInTheDocument();

    await user.hover(trigger);

    const tooltip = await screen.findByRole("tooltip", { name: "予定の詳細を表示" });
    expect(tooltip).toBeVisible();
    expect(tooltip.parentElement).toBe(document.body);
    expect(trigger.getAttribute("aria-describedby")).toContain(tooltip.id);

    await user.unhover(trigger);
    expect(screen.queryByRole("tooltip")).not.toBeInTheDocument();
    expect(trigger).not.toHaveAttribute("aria-describedby");
  });

  it("shows on focus and preserves an existing description and focus handler", async () => {
    const user = userEvent.setup();
    const onFocus = vi.fn();
    const onKeyDown = vi.fn();
    render(
      <>
        <span id="existing-description">既存の説明</span>
        <Tooltip label="キーボード操作の説明">
          <button
            type="button"
            aria-label="操作"
            aria-describedby="existing-description"
            onFocus={onFocus}
            onKeyDown={onKeyDown}
          >
            操作
          </button>
        </Tooltip>
        <button type="button">次の操作</button>
      </>,
    );

    const trigger = screen.getByRole("button", { name: "操作" });
    await user.tab();

    const tooltip = await screen.findByRole("tooltip", { name: "キーボード操作の説明" });
    expect(trigger).toHaveFocus();
    expect(onFocus).toHaveBeenCalledTimes(1);
    expect(trigger.getAttribute("aria-describedby")).toBe(`existing-description ${tooltip.id}`);

    await user.keyboard("{Escape}");
    expect(trigger).toHaveFocus();
    expect(onKeyDown).toHaveBeenCalledTimes(1);
    await waitFor(() => expect(screen.queryByRole("tooltip")).not.toBeInTheDocument());
    expect(trigger).toHaveAttribute("aria-describedby", "existing-description");

    await user.tab();
    expect(screen.getByRole("button", { name: "次の操作" })).toHaveFocus();

    await user.tab({ shift: true });
    expect(trigger).toHaveFocus();
    const refocusedTooltip = await screen.findByRole("tooltip", { name: "キーボード操作の説明" });
    expect(refocusedTooltip).toBeVisible();
    expect(trigger).toHaveAttribute(
      "aria-describedby",
      `existing-description ${refocusedTooltip.id}`,
    );
  });

  it("does not add interaction or markup for an empty label", () => {
    render(
      <Tooltip label="">
        <button type="button">操作</button>
      </Tooltip>,
    );

    const trigger = screen.getByRole("button", { name: "操作" });
    expect(trigger).not.toHaveAttribute("aria-describedby");
    expect(screen.queryByRole("tooltip")).not.toBeInTheDocument();
  });
});
