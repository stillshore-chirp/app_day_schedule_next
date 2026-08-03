import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { render, screen, waitFor } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { describe, expect, it } from "vitest";
import type { Schedule } from "../../shared/contracts";
import { MemoryAppClient } from "../../shared/ipc/memory-client";
import { ScheduleTicketLink } from "./ScheduleTicketLink";

const schedule: Schedule = {
  id: "00000000-0000-4000-8000-000000000080",
  title: "既存予定",
  description: "",
  location: "",
  startUtc: "2026-08-03T00:00:00.000Z",
  endUtc: "2026-08-03T01:00:00.000Z",
  timezoneId: "Asia/Tokyo",
  allDay: false,
  allDayStartDate: null,
  allDayEndDateExclusive: null,
  status: "scheduled",
  project: "",
  category: "",
  tags: [],
  color: "#6F96F4",
  priority: "normal",
  recurrenceRule: null,
  recurrenceSupplementalLines: [],
  recurrenceExdates: [],
  startNotificationMinutes: null,
  endNotificationMinutes: null,
  syncStatus: "local_only",
  version: 0,
  deletedAt: null,
};

describe("ScheduleTicketLink", () => {
  it("links and unlinks an existing schedule without changing either title", async () => {
    const client = new MemoryAppClient([schedule]);
    const board = await client.ticketBoard();
    const ticket = await client.createTicket(crypto.randomUUID(), {
      boardId: board.id,
      columnId: board.columns[0]!.id,
      parentTicketId: null,
      title: "独立したチケット名",
      description: "",
      priority: "normal",
      dueDate: null,
      estimateMinutes: 30,
      tags: [],
      checklist: [],
    });
    const queryClient = new QueryClient({ defaultOptions: { queries: { retry: false } } });
    const user = userEvent.setup();
    render(
      <QueryClientProvider client={queryClient}>
        <ScheduleTicketLink client={client} schedule={schedule} />
      </QueryClientProvider>,
    );
    await screen.findByRole("option", { name: "独立したチケット名" });
    await user.selectOptions(screen.getByLabelText("チケット"), ticket.id);
    await user.click(screen.getByRole("button", { name: "関連付ける" }));
    expect(await screen.findByText(/関連中:/)).toBeVisible();
    expect(await client.ticket(ticket.id)).toHaveProperty("title", "独立したチケット名");
    expect((await client.scheduleTicketLink(schedule.id))?.schedule.title).toBe("既存予定");

    await user.click(screen.getByRole("button", { name: "関連を解除" }));
    await waitFor(async () => expect(await client.scheduleTicketLink(schedule.id)).toBeNull());
  });
});
