import { act, render, screen, waitFor } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import axe from "axe-core";
import { describe, expect, it, vi } from "vitest";
import { MarkdownDescriptionField } from "./MarkdownDescriptionField";

async function expectNoSeriousOrCriticalViolations(container: HTMLElement) {
  const result = await act(() =>
    axe.run(container, {
      runOnly: { type: "tag", values: ["wcag2a", "wcag2aa", "wcag21aa", "wcag22aa"] },
      rules: { "color-contrast": { enabled: false } },
    }),
  );
  expect(
    result.violations.filter((item) => ["serious", "critical"].includes(item.impact ?? "")),
  ).toEqual([]);
}

describe("MarkdownDescriptionField accessibility", () => {
  it("exposes named tabs and panels without serious violations in all modes", async () => {
    const user = userEvent.setup();
    const { container } = render(
      <MarkdownDescriptionField
        id="a11y-description"
        label="説明"
        rows={8}
        value={
          "# 計画\n\n- [x] 完了\n- [ ] 確認中\n\n| 項目 | 状態 |\n| --- | --- |\n| native | 確認中 |\n\nhttps://example.invalid/runbook"
        }
        onChange={vi.fn()}
      />,
    );

    expect(screen.getByRole("tablist", { name: "説明の表示切替" })).toBeVisible();
    expect(screen.getAllByRole("tab")).toHaveLength(3);
    expect(screen.getByRole("tab", { name: "通常プレビュー" })).toHaveAttribute(
      "aria-selected",
      "true",
    );
    expect(screen.getByRole("tabpanel", { name: "通常プレビュー" })).toBeVisible();
    await expectNoSeriousOrCriticalViolations(container);

    await user.click(screen.getByRole("tab", { name: "Markdownプレビュー" }));
    expect(await screen.findByRole("heading", { name: "計画" })).toBeVisible();
    expect(screen.getByRole("tabpanel", { name: "Markdownプレビュー" })).toBeVisible();
    await expectNoSeriousOrCriticalViolations(container);

    await user.click(screen.getByRole("tab", { name: "編集" }));
    await waitFor(() => expect(screen.getByRole("textbox", { name: "説明" })).toHaveFocus());
    expect(screen.getByRole("tabpanel", { name: "編集" })).toBeVisible();
    await expectNoSeriousOrCriticalViolations(container);
  });
});
