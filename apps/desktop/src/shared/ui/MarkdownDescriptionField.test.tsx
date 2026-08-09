import { render, screen, waitFor } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { useState } from "react";
import { describe, expect, it } from "vitest";
import { MarkdownDescriptionField } from "./MarkdownDescriptionField";

function ControlledField({ initialValue }: { initialValue: string }) {
  const [value, setValue] = useState(initialValue);
  return (
    <MarkdownDescriptionField
      id="test-description"
      label="説明"
      rows={5}
      maxLength={10_000}
      value={value}
      onChange={setValue}
    />
  );
}

describe("MarkdownDescriptionField", () => {
  it("renders existing GFM content first and preserves the source while switching modes", async () => {
    const user = userEvent.setup();
    render(
      <ControlledField
        initialValue={[
          "# リリース計画",
          "",
          "| 項目 | 状態 |",
          "| --- | --- |",
          "| テスト | 完了 |",
          "",
          "- [x] unit test",
          "- [ ] native smoke",
        ].join("\n")}
      />,
    );

    expect(screen.getByRole("region", { name: "説明のMarkdownプレビュー" })).toBeVisible();
    expect(await screen.findByRole("heading", { name: "リリース計画" })).toBeVisible();
    expect(screen.getByRole("table")).toBeVisible();
    expect(screen.getAllByRole("checkbox")[0]).toBeChecked();

    await user.click(screen.getByRole("button", { name: "編集" }));
    const editor = screen.getByRole("textbox", { name: "説明" });
    expect((editor as HTMLTextAreaElement).value).toContain("| テスト | 完了 |");
    await user.type(editor, "\n\n> 入力は保持されます");
    await user.click(screen.getByRole("button", { name: "プレビュー" }));

    expect(screen.getByText("入力は保持されます")).toBeVisible();
  });

  it("explains an empty preview and returns to editing", async () => {
    const user = userEvent.setup();
    render(<ControlledField initialValue="" />);

    expect(screen.getByRole("textbox", { name: "説明" })).toBeVisible();
    await user.click(screen.getByRole("button", { name: "プレビュー" }));
    expect(screen.getByText("プレビューする説明がまだありません。")).toBeVisible();
    await user.click(screen.getByRole("button", { name: "編集に戻る" }));
    await waitFor(() => expect(screen.getByRole("textbox", { name: "説明" })).toHaveFocus());
  });

  it("ignores raw HTML, blocks unsafe links, and never creates remote image elements", async () => {
    const { container } = render(
      <ControlledField
        initialValue={[
          "<script>window.markdownAttack = true</script>",
          "[安全なリンク](https://example.invalid/docs)",
          "[危険なリンク](javascript:alert(1))",
          "![外部画像](https://example.invalid/tracker.png)",
        ].join("\n\n")}
      />,
    );

    expect(await screen.findByText("安全なリンク", { exact: false })).toHaveTextContent(
      "https://example.invalid/docs",
    );
    expect(screen.queryByRole("link", { name: "安全なリンク" })).not.toBeInTheDocument();
    expect(screen.queryByRole("link", { name: "危険なリンク" })).not.toBeInTheDocument();
    expect(screen.getByText("危険なリンク")).toHaveClass("markdown-preview__blocked-link");
    expect(screen.getByText(/画像「外部画像」/)).toBeVisible();
    expect(container.querySelector("img")).not.toBeInTheDocument();
    expect(container.querySelector("script")).not.toBeInTheDocument();
  });
});
