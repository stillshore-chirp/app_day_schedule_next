import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { render, screen, waitFor } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { describe, expect, it } from "vitest";
import { MemoryAppClient } from "../../shared/ipc/memory-client";
import { TicketSchedulePlanner } from "./TicketSchedulePlanner";

describe("TicketSchedulePlanner", () => {
  it("creates multiple explicit schedule links without changing the ticket", async () => {
    const client = new MemoryAppClient([]);
    const board = await client.ticketBoard();
    const ticket = await client.createTicket(crypto.randomUUID(), {
      boardId: board.id,
      columnId: board.columns[0]!.id,
      parentTicketId: null,
      title: "設計をまとめる",
      description: "",
      priority: "high",
      dueDate: null,
      estimateMinutes: 45,
      tags: [],
      checklist: [],
    });
    const queryClient = new QueryClient({ defaultOptions: { queries: { retry: false } } });
    const user = userEvent.setup();
    render(
      <QueryClientProvider client={queryClient}>
        <TicketSchedulePlanner
          client={client}
          ticket={ticket}
          today="2026-08-03"
          timezoneId="Asia/Tokyo"
        />
      </QueryClientProvider>,
    );

    await user.click(screen.getByRole("button", { name: "新しい予定を作成" }));
    expect(await screen.findByText("予定を作成し、チケットへ関連付けました。")).toBeVisible();
    await user.click(screen.getByRole("button", { name: "新しい予定を作成" }));

    await waitFor(async () => expect((await client.ticketSchedules(ticket.id)).length).toBe(2));
    expect((await client.ticket(ticket.id)).title).toBe("設計をまとめる");
  });
});
