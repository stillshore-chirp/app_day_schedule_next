import { act, cleanup, render, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import axe from "axe-core";
import { afterEach, describe, expect, it, vi } from "vitest";
import type { TicketDraft } from "../../shared/contracts";
import { MemoryAppClient } from "../../shared/ipc/memory-client";
import { KanbanView } from "./KanbanView";

vi.mock("./ticket-context-menu", () => ({
  showTicketMoveContextMenu: vi.fn(),
}));

afterEach(cleanup);

async function renderTicketBoard() {
  const client = new MemoryAppClient([]);
  const board = await client.ticketBoard();
  const draft: TicketDraft = {
    boardId: board.id,
    columnId: board.columns[0]!.id,
    parentTicketId: null,
    title: "A11y context move",
    description: "Synthetic accessibility fixture",
    priority: "normal",
    dueDate: null,
    estimateMinutes: null,
    tags: [],
    checklist: [],
  };
  await client.createTicket(crypto.randomUUID(), draft);
  const queryClient = new QueryClient({ defaultOptions: { queries: { retry: false } } });
  return render(
    <QueryClientProvider client={queryClient}>
      <KanbanView client={client} today="2026-08-03" />
    </QueryClientProvider>,
  );
}

async function expectNoSeriousViolations(container: HTMLElement) {
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

describe("KanbanView accessibility", () => {
  it("describes the context-menu trigger in normal and filtered states without serious violations", async () => {
    const user = userEvent.setup();
    const { container } = await renderTicketBoard();
    const card = await screen.findByRole("button", { name: "A11y context moveの詳細を開く" });

    expect(card).toHaveAccessibleDescription(expect.stringContaining("右クリックまたはShift+F10"));
    expect(card).toHaveAttribute(
      "aria-keyshortcuts",
      "ArrowLeft ArrowRight ArrowUp ArrowDown Shift+F10",
    );
    await expectNoSeriousViolations(container);

    await user.type(screen.getByLabelText("タイトル・説明を検索"), "A11y");
    expect(card).toHaveAccessibleDescription(expect.stringContaining("右クリックまたはShift+F10"));
    expect(card.getAttribute("aria-describedby")?.trim().split(/\s+/)).toHaveLength(2);
    expect(card).toHaveAttribute("aria-keyshortcuts", "Shift+F10");
    await expectNoSeriousViolations(container);
  });
});
