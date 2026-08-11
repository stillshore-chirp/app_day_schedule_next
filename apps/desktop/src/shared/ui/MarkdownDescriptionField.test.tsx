import { openUrl } from "@tauri-apps/plugin-opener";
import { render, screen, waitFor, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { useState } from "react";
import { beforeEach, describe, expect, it, vi } from "vitest";
import { MarkdownDescriptionField } from "./MarkdownDescriptionField";

vi.mock("@tauri-apps/plugin-opener", () => ({
  openUrl: vi.fn(),
}));

const openUrlMock = vi.mocked(openUrl);

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
  beforeEach(() => {
    openUrlMock.mockReset();
    openUrlMock.mockResolvedValue(undefined);
  });

  it("starts existing content in the plain preview without interpreting Markdown or HTML", async () => {
    const user = userEvent.setup();
    const { container } = render(
      <ControlledField
        initialValue={[
          "# リリース計画",
          "  インデントを保持",
          "<script>window.previewAttack = true</script>",
          "参照: https://example.invalid/docs。",
          "補足（https://example.invalid/path(foo)）。",
          "日本語URL「https://例え.テスト/資料」",
          "危険: javascript:alert(1)",
          "![外部画像](https://example.invalid/tracker.png)",
        ].join("\n")}
      />,
    );

    const plainTab = screen.getByRole("tab", { name: "通常プレビュー" });
    expect(plainTab).toHaveAttribute("aria-selected", "true");
    const plainPreview = screen.getByRole("tabpanel", { name: "通常プレビュー" });
    expect(plainPreview).toHaveTextContent("# リリース計画");
    expect(plainPreview).toHaveTextContent("<script>window.previewAttack = true</script>");
    expect(screen.queryByRole("heading", { name: "リリース計画" })).not.toBeInTheDocument();
    expect(container.querySelector("script")).not.toBeInTheDocument();
    expect(container.querySelector("img")).not.toBeInTheDocument();

    const docsLink = within(plainPreview).getByRole("link", {
      name: "https://example.invalid/docs",
    });
    expect(docsLink).toHaveAttribute("href", "https://example.invalid/docs");
    expect(within(plainPreview).getByText("。")).toBeVisible();
    expect(
      within(plainPreview).getByRole("link", { name: /https:\/\/example\.invalid\/path\(foo\)/ }),
    ).toHaveAttribute("href", "https://example.invalid/path(foo)");
    expect(
      within(plainPreview).getByRole("link", { name: "https://例え.テスト/資料" }),
    ).toHaveAttribute("href", new URL("https://例え.テスト/資料").toString());
    expect(
      within(plainPreview).queryByRole("link", { name: /javascript/ }),
    ).not.toBeInTheDocument();

    await user.click(docsLink);
    expect(openUrlMock).toHaveBeenCalledWith("https://example.invalid/docs");
  });

  it("renders GFM only in the Markdown preview and preserves the source while editing", async () => {
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

    await user.click(screen.getByRole("tab", { name: "Markdownプレビュー" }));
    expect(screen.getByRole("tabpanel", { name: "Markdownプレビュー" })).toBeVisible();
    expect(await screen.findByRole("heading", { name: "リリース計画" })).toBeVisible();
    expect(screen.getByRole("table")).toBeVisible();
    expect(screen.getAllByRole("checkbox")[0]).toBeChecked();

    await user.click(screen.getByRole("tab", { name: "編集" }));
    const editor = screen.getByRole("textbox", { name: "説明" });
    expect((editor as HTMLTextAreaElement).value).toContain("| テスト | 完了 |");
    await user.type(editor, "\n\n> 入力は保持されます");
    await user.click(screen.getByRole("tab", { name: "Markdownプレビュー" }));

    expect(screen.getByText("入力は保持されます")).toBeVisible();
  });

  it("supports automatic tab activation with arrow, Home, and End keys", async () => {
    const user = userEvent.setup();
    render(<ControlledField initialValue="# 見出し" />);

    const plainTab = screen.getByRole("tab", { name: "通常プレビュー" });
    plainTab.focus();
    await user.keyboard("{ArrowRight}");
    const markdownTab = screen.getByRole("tab", { name: "Markdownプレビュー" });
    expect(markdownTab).toHaveFocus();
    expect(markdownTab).toHaveAttribute("aria-selected", "true");
    expect(await screen.findByRole("heading", { name: "見出し" })).toBeVisible();

    await user.keyboard("{End}");
    const editTab = screen.getByRole("tab", { name: "編集" });
    expect(editTab).toHaveFocus();
    expect(screen.getByRole("textbox", { name: "説明" })).toBeVisible();

    await user.keyboard("{Home}");
    expect(plainTab).toHaveFocus();
    expect(plainTab).toHaveAttribute("aria-selected", "true");
  });

  it("keeps a read-only source focusable for selection and copying", async () => {
    const user = userEvent.setup();
    render(
      <MarkdownDescriptionField
        id="read-only-description"
        label="説明"
        rows={4}
        value="共有元の説明"
        onChange={vi.fn()}
        readOnly
      />,
    );

    await user.click(screen.getByRole("tab", { name: "編集" }));
    const editor = screen.getByRole("textbox", { name: "説明" });
    await waitFor(() => expect(editor).toHaveFocus());
    expect(editor).toHaveAttribute("readonly");
    expect(editor).not.toBeDisabled();
    expect(editor).toHaveValue("共有元の説明");
  });

  it("explains empty previews and returns focus to editing", async () => {
    const user = userEvent.setup();
    render(<ControlledField initialValue="" />);

    expect(screen.getByRole("tab", { name: "編集" })).toHaveAttribute("aria-selected", "true");
    expect(screen.getByRole("textbox", { name: "説明" })).toBeVisible();
    await user.click(screen.getByRole("tab", { name: "通常プレビュー" }));
    expect(screen.getByText("プレビューする説明がまだありません。")).toBeVisible();
    await user.click(screen.getByRole("button", { name: "編集に戻る" }));
    await waitFor(() => expect(screen.getByRole("textbox", { name: "説明" })).toHaveFocus());
  });

  it("opens Markdown HTTP links while blocking unsafe content", async () => {
    const user = userEvent.setup();
    const { container } = render(
      <ControlledField
        initialValue={[
          "<script>window.markdownAttack = true</script>",
          "[安全なリンク](https://example.invalid/docs)",
          "[HTTPリンク](http://example.invalid/legacy-docs)",
          "[危険なリンク](javascript:alert(1))",
          "![外部画像](https://example.invalid/tracker.png)",
        ].join("\n\n")}
      />,
    );

    await user.click(screen.getByRole("tab", { name: "Markdownプレビュー" }));
    const safeLink = await screen.findByRole("link", { name: /安全なリンク/ });
    expect(safeLink).toHaveAttribute("href", "https://example.invalid/docs");
    expect(safeLink).toHaveTextContent("https://example.invalid/docs");
    expect(screen.getByRole("link", { name: /HTTPリンク/ })).toHaveAttribute(
      "href",
      "http://example.invalid/legacy-docs",
    );

    await user.click(safeLink);
    expect(openUrlMock).toHaveBeenLastCalledWith("https://example.invalid/docs");

    safeLink.focus();
    await user.keyboard("{Enter}");
    expect(openUrlMock).toHaveBeenCalledTimes(2);
    expect(screen.queryByRole("link", { name: "危険なリンク" })).not.toBeInTheDocument();
    expect(screen.getByText("危険なリンク")).toHaveClass("markdown-preview__blocked-link");
    expect(screen.getByText(/画像「外部画像」/)).toBeVisible();
    expect(container.querySelector("img")).not.toBeInTheDocument();
    expect(container.querySelector("script")).not.toBeInTheDocument();
  });

  it("reports an opener failure in the plain preview and allows retry", async () => {
    const user = userEvent.setup();
    openUrlMock.mockRejectedValueOnce(new Error("native opener unavailable"));
    render(<ControlledField initialValue="https://example.invalid/runbook" />);

    const link = screen.getByRole("link", { name: "https://example.invalid/runbook" });
    await user.click(link);

    expect(await screen.findByRole("alert")).toHaveTextContent("リンクを開けませんでした");
    expect(link).toBeVisible();

    await user.click(link);
    await waitFor(() => expect(screen.queryByRole("alert")).not.toBeInTheDocument());
    expect(openUrlMock).toHaveBeenCalledTimes(2);
  });
});
