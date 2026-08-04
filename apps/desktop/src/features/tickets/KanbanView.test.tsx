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

async function createTicket(client: MemoryAppClient, title = "Review release") {
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
    tags: ["release"],
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

    expect(await screen.findByText("First task")).toBeVisible();
    expect((await client.listTickets({})).total).toBe(1);
  });

  it("shows only the priority badge and moves the focused card or dragged card", async () => {
    const client = new MemoryAppClient([]);
    const created = await createTicket(client);
    const board = await client.ticketBoard();
    const user = userEvent.setup();
    renderBoard(client);

    const open = await screen.findByRole("button", { name: "Review releaseの詳細を開く" });
    const initialCard = open.closest("article")!;
    expect(initialCard.querySelectorAll(".ticket-card__meta > span")).toHaveLength(1);
    expect(within(initialCard).getByText("優先度: 高")).toBeVisible();
    expect(within(initialCard).queryByRole("button", { name: "移動" })).not.toBeInTheDocument();
    expect(open).toHaveAttribute("aria-keyshortcuts", "ArrowLeft ArrowRight ArrowUp ArrowDown");

    fireEvent.keyDown(open, { key: "ArrowRight", repeat: true });
    expect((await client.ticket(created.id)).columnId).toBe(board.columns[0]!.id);
    fireEvent.keyDown(open, { key: "ArrowRight" });
    await waitFor(async () =>
      expect((await client.ticket(created.id)).columnId).toBe(board.columns[1]!.id),
    );

    const card = screen.getByText(created.title).closest("article")!;
    const nextColumn = screen.getByRole("heading", { name: "Next" }).closest("section")!;
    fireEvent.dragStart(card);
    fireEvent.dragOver(nextColumn);
    fireEvent.drop(nextColumn);
    await waitFor(async () =>
      expect((await client.ticket(created.id)).columnId).toBe(board.columns[2]!.id),
    );

    await user.type(screen.getByLabelText("タイトル・説明を検索"), "Review");
    expect(screen.getByText(/見えていないチケットの順序を守るため/)).toBeVisible();
    expect(screen.getByText(created.title).closest("article")).toHaveAttribute(
      "draggable",
      "false",
    );
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

    expect(await screen.findByText("ほかの変更が先に保存されています")).toBeVisible();
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

    expect(await screen.findByText("保存できませんでした")).toBeVisible();
    expect(title).toHaveValue("Unsaved but retained");
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
