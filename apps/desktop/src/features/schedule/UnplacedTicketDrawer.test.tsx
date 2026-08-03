import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { render, screen, waitFor, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { describe, expect, it, vi } from "vitest";
import { MemoryAppClient } from "../../shared/ipc/memory-client";
import { UnplacedTicketDrawer } from "./UnplacedTicketDrawer";

function renderDrawer(client: MemoryAppClient, onAssign = vi.fn().mockResolvedValue(undefined)) {
  const queryClient = new QueryClient({ defaultOptions: { queries: { retry: false } } });
  render(
    <QueryClientProvider client={queryClient}>
      <UnplacedTicketDrawer
        client={client}
        selectedDate={new Date(2026, 7, 3)}
        onAssign={onAssign}
        onDragStart={vi.fn()}
        onDragEnd={vi.fn()}
      />
    </QueryClientProvider>,
  );
  return onAssign;
}

describe("UnplacedTicketDrawer", () => {
  it("offers an explicit keyboard path when a ticket has no estimate", async () => {
    const client = new MemoryAppClient([]);
    const board = await client.ticketBoard();
    await client.createTicket(crypto.randomUUID(), {
      boardId: board.id,
      columnId: board.columns[0]!.id,
      parentTicketId: null,
      title: "所要時間を決める",
      description: "",
      priority: "normal",
      dueDate: "2026-08-03",
      estimateMinutes: null,
      tags: [],
      checklist: [],
    });
    const assign = renderDrawer(client);
    const user = userEvent.setup();
    await user.click(screen.getByRole("button", { name: /未配置チケット/ }));
    const ticket = await screen.findByRole("button", { name: /所要時間を決める/ });
    expect(ticket).toHaveAttribute("draggable", "false");
    await user.click(ticket);
    await user.type(screen.getByLabelText("所要時間（分）"), "40");
    await user.click(screen.getByRole("button", { name: "予定を作成" }));
    await waitFor(() =>
      expect(assign).toHaveBeenCalledWith(expect.anything(), "2026-08-03T09:00", 40),
    );
  });

  it("keeps five hundred due tickets reachable in the opened drawer", async () => {
    const client = new MemoryAppClient([]);
    const board = await client.ticketBoard();
    await Promise.all(
      Array.from({ length: 500 }, (_, index) =>
        client.createTicket(crypto.randomUUID(), {
          boardId: board.id,
          columnId: board.columns[0]!.id,
          parentTicketId: null,
          title: `大量チケット ${index + 1}`,
          description: "",
          priority: "normal",
          dueDate: "2026-08-03",
          estimateMinutes: 30,
          tags: [],
          checklist: [],
        }),
      ),
    );
    renderDrawer(client);
    const user = userEvent.setup();
    await user.click(screen.getByRole("button", { name: /未配置チケット/ }));
    const list = await screen.findByRole("list");
    await waitFor(() => expect(within(list).getAllByRole("button")).toHaveLength(500));
  });
});
