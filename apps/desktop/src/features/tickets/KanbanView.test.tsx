import { act, cleanup, fireEvent, render, screen, waitFor, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import axe from "axe-core";
import { afterEach, describe, expect, it, vi } from "vitest";
import type { TicketDraft } from "../../shared/contracts";
import { AppClientError } from "../../shared/ipc/client";
import { MemoryAppClient } from "../../shared/ipc/memory-client";
import { KanbanView } from "./KanbanView";

afterEach(cleanup);

function renderBoard(client: MemoryAppClient) {
  const queryClient = new QueryClient({ defaultOptions: { queries: { retry: false } } });
  return render(
    <QueryClientProvider client={queryClient}>
      <KanbanView client={client} today="2026-08-03" />
    </QueryClientProvider>,
  );
}

async function createTicket(
  client: MemoryAppClient,
  title = "Review release",
  tags = ["release", "desktop"],
) {
  const board = await client.ticketBoard();
  const draft: TicketDraft = {
    boardId: board.id,
    columnId: board.columns[0]!.id,
    parentTicketId: null,
    title,
    description: "Check every state",
    priority: "high",
    dueDate: "2026-08-02",
    estimateMinutes: 30,
    tags,
    checklist: [{ title: "Run tests", completed: true }],
  };
  return client.createTicket(crypto.randomUUID(), draft);
}

describe("KanbanView", () => {
  it("distinguishes empty board and creates a title-only ticket in a chosen column", async () => {
    const client = new MemoryAppClient([]);
    const user = userEvent.setup();
    renderBoard(client);

    expect(
      await screen.findByRole("heading", { name: "最初のチケットを作りましょう" }),
    ).toBeVisible();
    const inbox = screen.getByRole("heading", { name: "Inbox" }).closest("section")!;
    await user.type(
      within(inbox).getByLabelText("Inboxへ追加するチケットのタイトル"),
      "First task",
    );
    await user.click(within(inbox).getByRole("button", { name: "追加" }));

    const createdCard = (await screen.findByText("First task")).closest("article")!;
    expect(createdCard).toBeVisible();
    expect(createdCard.querySelector(".ticket-card__tag")).not.toBeInTheDocument();
    expect((await client.listTickets({})).total).toBe(1);
  });

  it("shows priority and tag badges and moves the focused card or dragged card", async () => {
    const client = new MemoryAppClient([]);
    const created = await createTicket(client);
    const board = await client.ticketBoard();
    const user = userEvent.setup();
    renderBoard(client);

    const open = await screen.findByRole("button", { name: "Review releaseの詳細を開く" });
    const initialCard = open.closest("article")!;
    expect(initialCard.querySelectorAll(".ticket-card__meta > span")).toHaveLength(3);
    expect(within(initialCard).getByText("優先度: 高")).toBeVisible();
    expect(within(initialCard).getByText("release")).toHaveClass("ticket-card__tag");
    expect(within(initialCard).getByText("desktop")).toHaveClass("ticket-card__tag");
    expect(open).toHaveAccessibleDescription(
      /優先度: 高.*タグ: release.*タグ: desktop.*カードをドラッグして移動できます/,
    );
    expect(within(initialCard).queryByRole("button", { name: "移動" })).not.toBeInTheDocument();
    expect(open).toHaveAttribute("aria-keyshortcuts", "ArrowLeft ArrowRight ArrowUp ArrowDown");

    fireEvent.keyDown(open, { key: "ArrowRight", repeat: true });
    expect((await client.ticket(created.id)).columnId).toBe(board.columns[0]!.id);
    fireEvent.keyDown(open, { key: "ArrowRight" });
    await waitFor(async () =>
      expect((await client.ticket(created.id)).columnId).toBe(board.columns[1]!.id),
    );

    const card = screen.getByRole("button", { name: "Review releaseの詳細を開く" });
    const nextColumn = screen.getByRole("heading", { name: "Next" }).closest("section")!;
    const elementFromPoint = vi.fn(() => nextColumn);
    Object.defineProperty(document, "elementFromPoint", {
      configurable: true,
      value: elementFromPoint,
    });
    fireEvent.mouseDown(card, { button: 0, clientX: 10, clientY: 10 });
    fireEvent.mouseMove(window, { clientX: 20, clientY: 10 });
    fireEvent.mouseUp(window, { clientX: 20, clientY: 10 });
    Reflect.deleteProperty(document, "elementFromPoint");
    await waitFor(async () =>
      expect((await client.ticket(created.id)).columnId).toBe(board.columns[2]!.id),
    );
    await user.click(screen.getByRole("button", { name: "Review releaseの詳細を開く" }));
    expect(screen.getByRole("dialog")).toBeVisible();
    await user.click(screen.getByRole("button", { name: "詳細を閉じる" }));
    await waitFor(() =>
      expect(screen.getByRole("button", { name: "Review releaseの詳細を開く" })).toHaveFocus(),
    );

    await user.type(screen.getByLabelText("タイトル・説明を検索"), "Review");
    expect(screen.getByText(/見えていないチケットの順序を守るため/)).toBeVisible();
    expect(screen.getByRole("button", { name: "Review releaseの詳細を開く" })).not.toHaveAttribute(
      "aria-keyshortcuts",
    );
  });

  it("renders long and numerous tag badges without dropping card metadata", async () => {
    const client = new MemoryAppClient([]);
    const longTag = `long-${"x".repeat(45)}`;
    const tags = [longTag, ...Array.from({ length: 19 }, (_, index) => `tag-${index + 2}`)];
    await createTicket(client, "Tag stress", tags);
    renderBoard(client);

    const open = await screen.findByRole("button", { name: "Tag stressの詳細を開く" });
    const card = open.closest("article")!;
    expect(card.querySelectorAll(".ticket-card__tag")).toHaveLength(20);
    expect(within(card).getByText(longTag)).toHaveClass("ticket-card__tag");
    expect(within(card).getByText("tag-20")).toHaveClass("ticket-card__tag");
    expect(open).toHaveAccessibleDescription(expect.stringContaining(`タグ: ${longTag}`));
    expect(open).toHaveAccessibleDescription(expect.stringContaining("タグ: tag-20"));
  });

  it("keeps edits visible on a stale-version conflict and restores focus after closing", async () => {
    class ConflictClient extends MemoryAppClient {
      override updateTicket() {
        return Promise.reject(
          new AppClientError({
            code: "version_conflict",
            message: "conflict",
            recovery: "reload",
            retryable: true,
            diagnosticId: null,
          }),
        );
      }
    }
    const client = new ConflictClient([]);
    await createTicket(client);
    const user = userEvent.setup();
    vi.spyOn(window, "confirm").mockReturnValue(true);
    renderBoard(client);

    const open = await screen.findByRole("button", { name: "Review releaseの詳細を開く" });
    await user.click(open);
    const title = screen.getByLabelText("タイトル");
    expect(title).toHaveFocus();
    await user.clear(title);
    await user.type(title, "Changed locally");
    await user.click(screen.getByRole("button", { name: "保存" }));

    expect(await screen.findByRole("alert")).toHaveTextContent("ほかの変更が先に保存されています");
    expect(title).toHaveValue("Changed locally");
    vi.spyOn(window, "confirm").mockReturnValue(true);
    await user.click(screen.getByRole("button", { name: "詳細を閉じる" }));
    await waitFor(() => expect(open).toHaveFocus());
  });

  it("keeps edits visible when a local save fails", async () => {
    class FailureClient extends MemoryAppClient {
      override updateTicket() {
        return Promise.reject(new Error("synthetic save failure"));
      }
    }
    const client = new FailureClient([]);
    await createTicket(client);
    const user = userEvent.setup();
    renderBoard(client);

    await user.click(await screen.findByRole("button", { name: "Review releaseの詳細を開く" }));
    const title = screen.getByLabelText("タイトル");
    await user.clear(title);
    await user.type(title, "Unsaved but retained");
    await user.click(screen.getByRole("button", { name: "保存" }));

    expect(await screen.findByRole("alert")).toHaveTextContent("保存できませんでした");
    expect(title).toHaveValue("Unsaved but retained");
  });

  it("keeps internal clicks open and closes from the backdrop with dirty-state confirmation", async () => {
    const client = new MemoryAppClient([]);
    await createTicket(client);
    const user = userEvent.setup();
    const confirm = vi.spyOn(window, "confirm").mockReturnValue(false);
    renderBoard(client);

    const opener = await screen.findByRole("button", { name: "Review releaseの詳細を開く" });
    await user.click(opener);
    const dialog = screen.getByRole("dialog");
    const title = screen.getByLabelText("タイトル");
    await user.clear(title);
    await user.type(title, "Backdrop keeps this edit");

    fireEvent.click(dialog);
    expect(dialog).toBeVisible();
    expect(confirm).not.toHaveBeenCalled();

    fireEvent.click(dialog.parentElement!);
    expect(confirm).toHaveBeenCalledWith("保存していない変更を破棄して閉じますか？");
    expect(dialog).toBeVisible();
    expect(title).toHaveValue("Backdrop keeps this edit");

    confirm.mockReturnValue(true);
    fireEvent.click(dialog.parentElement!);
    await waitFor(() => expect(screen.queryByRole("dialog")).not.toBeInTheDocument());
    await waitFor(() => expect(opener).toHaveFocus());
  });

  it("keeps the detail open while a save is pending", async () => {
    class PendingClient extends MemoryAppClient {
      private finishPendingSave: (() => void) | null = null;

      finishSave() {
        this.finishPendingSave?.();
      }

      override async updateTicket(input: Parameters<MemoryAppClient["updateTicket"]>[0]) {
        await new Promise<void>((resolve) => {
          this.finishPendingSave = resolve;
        });
        return super.updateTicket(input);
      }
    }

    const client = new PendingClient([]);
    await createTicket(client);
    const user = userEvent.setup();
    renderBoard(client);

    await user.click(await screen.findByRole("button", { name: "Review releaseの詳細を開く" }));
    await user.type(screen.getByLabelText("タイトル"), " updated");
    await user.click(screen.getByRole("button", { name: "保存" }));

    expect(await screen.findByText("この端末へ保存中…")).toBeVisible();
    expect(screen.getByRole("button", { name: "詳細を閉じる" })).toBeDisabled();
    expect(screen.getByRole("button", { name: "取り消す" })).toBeDisabled();
    const dialog = screen.getByRole("dialog");
    expect(dialog).toHaveAttribute("aria-busy", "true");
    expect(screen.getByRole("button", { name: "アーカイブ" })).toBeDisabled();
    expect(screen.getByRole("button", { name: "削除…" })).toBeDisabled();
    expect(screen.getByLabelText("タイトル")).toBeDisabled();
    expect(screen.getByPlaceholderText("カンマ区切りで入力")).toBeDisabled();
    fireEvent.click(dialog.parentElement!);
    expect(dialog).toBeVisible();

    client.finishSave();
    expect(await screen.findByText("この端末へ保存しました")).toBeVisible();
  });

  it("opens an existing ticket description as Markdown and saves the edited source", async () => {
    const client = new MemoryAppClient([]);
    const created = await createTicket(client);
    await client.updateTicket({
      operationId: crypto.randomUUID(),
      id: created.id,
      expectedVersion: created.version,
      patch: { description: "# 実装計画\n\n| 項目 | 状態 |\n| --- | --- |\n| UI | 確認中 |" },
    });
    const user = userEvent.setup();
    renderBoard(client);

    await user.click(await screen.findByRole("button", { name: "Review releaseの詳細を開く" }));
    expect(screen.getByRole("region", { name: "説明のMarkdownプレビュー" })).toBeVisible();
    expect(await screen.findByRole("heading", { name: "実装計画" })).toBeVisible();
    expect(screen.getByRole("table")).toBeVisible();

    await user.click(screen.getByRole("button", { name: "編集" }));
    const description = screen.getByRole("textbox", { name: "説明" });
    await waitFor(() => expect(description).toHaveFocus());
    await user.clear(description);
    await user.type(description, "# 実装計画\n\n- component test");
    expect(description).toHaveValue("# 実装計画\n\n- component test");
    await user.click(screen.getByRole("button", { name: "保存" }));
    const savedStatus = await screen.findByText("この端末へ保存しました");
    expect(savedStatus.closest(".status-message")).toHaveClass("status-message--success");
    expect(savedStatus.closest(".status-message")).toHaveAttribute("role", "status");

    expect((await client.ticket(created.id)).description).toContain("- component test");
  });

  it("archives, restores, deletes and offers immediate recovery", async () => {
    const client = new MemoryAppClient([]);
    await createTicket(client);
    const user = userEvent.setup();
    vi.spyOn(window, "confirm").mockReturnValue(true);
    renderBoard(client);

    await user.click(await screen.findByRole("button", { name: "Review releaseの詳細を開く" }));
    await user.click(screen.getByRole("button", { name: "アーカイブ" }));
    await user.selectOptions(screen.getByLabelText("表示"), "archived");
    await user.click(await screen.findByRole("button", { name: "Review releaseの詳細を開く" }));
    await user.click(screen.getByRole("button", { name: "ボードへ戻す" }));

    await user.selectOptions(screen.getByLabelText("表示"), "active");
    await user.click(await screen.findByRole("button", { name: "Review releaseの詳細を開く" }));
    await user.click(screen.getByRole("button", { name: "削除…" }));
    expect(
      screen.getByText(
        "関連する予定は削除・完了せず、そのまま残ります。チケットとの関連だけ解除されます。",
      ),
    ).toBeVisible();
    await user.click(screen.getByRole("button", { name: "このチケットを削除" }));
    await user.click(await screen.findByRole("button", { name: "削除を取り消す" }));

    expect(await screen.findByText("Review release")).toBeVisible();
  });

  it("has no serious or critical automated accessibility violations", async () => {
    const client = new MemoryAppClient([]);
    await createTicket(client);
    const { container } = renderBoard(client);
    await screen.findByRole("heading", { name: "チケット", level: 1 });
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
