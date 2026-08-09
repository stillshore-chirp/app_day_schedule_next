import { act, render, screen } from "@testing-library/react";
import axe from "axe-core";
import { describe, expect, it, vi } from "vitest";
import { MarkdownDescriptionField } from "./MarkdownDescriptionField";

describe("MarkdownDescriptionField accessibility", () => {
  it("has no serious or critical automated violations in preview mode", async () => {
    const { container } = render(
      <MarkdownDescriptionField
        id="a11y-description"
        label="説明"
        rows={8}
        value={
          "# 計画\n\n- [x] 完了\n- [ ] 確認中\n\n| 項目 | 状態 |\n| --- | --- |\n| native | 確認中 |"
        }
        onChange={vi.fn()}
      />,
    );
    await screen.findByRole("heading", { name: "計画" });

    const result = await act(() =>
      axe.run(container, {
        runOnly: { type: "tag", values: ["wcag2a", "wcag2aa", "wcag21aa", "wcag22aa"] },
        rules: { "color-contrast": { enabled: false } },
      }),
    );
    expect(
      result.violations.filter((item) => ["serious", "critical"].includes(item.impact ?? "")),
    ).toEqual([]);
  });
});
