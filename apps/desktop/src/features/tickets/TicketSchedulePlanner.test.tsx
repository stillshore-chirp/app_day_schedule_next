import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { render, screen, waitFor } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { describe, expect, it } from "vitest";
import { MemoryAppClient } from "../../shared/ipc/memory-client";
import type { GoogleConnection, TicketGoogleTaskStatus } from "../../shared/contracts";
import { TicketSchedulePlanner } from "./TicketSchedulePlanner";

class GoogleTasksTicketClient extends MemoryAppClient {
  status: TicketGoogleTaskStatus | null = null;
  requests: Array<{ taskListId: string | null; deleteRemote: boolean }> = [];

  override googleConnection(): Promise<GoogleConnection> {
    return Promise.resolve({
      configured: true,
      state: "connected",
      accountId: "aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa",
      displayLabel: "Synthetic Google",
      calendars: [],
      lastError: null,
      mappedScheduleCount: 0,
      tasks: {
        enabled: true,
        scopeGranted: true,
        state: "synced",
        taskLists: [
          {
            id: "cccccccc-cccc-4ccc-8ccc-cccccccccccc",
            displayName: "Synthetic tasks",
            selected: true,
            defaultWriteTarget: true,
            syncState: "synced",
            lastSuccessAt: null,
            nextRetryAt: null,
            lastErrorCategory: null,
          },
        ],
        mappedTicketCount: this.status?.taskListId ? 1 : 0,
        pendingOutboxCount: 0,
        conflictCount: 0,
        selectedListCount: 1,
        lastSuccessAt: null,
        nextRetryAt: null,
      },
    });
  }

  override ticketGoogleTaskStatuses(ticketIds: string[]): Promise<TicketGoogleTaskStatus[]> {
    return Promise.resolve(
      ticketIds.map(
        (ticketId) =>
          this.status ?? {
            ticketId,
            state: "never",
            taskListId: null,
            taskListName: null,
            lastSyncAt: null,
            errorCategory: null,
            pendingOperation: null,
            conflictCount: 0,
          },
      ),
    );
  }

  override updateTicketGoogleTaskTarget(request: {
    ticketId: string;
    taskListId: string | null;
    deleteRemote: boolean;
    operationId: string;
  }): Promise<TicketGoogleTaskStatus> {
    this.requests.push({ taskListId: request.taskListId, deleteRemote: request.deleteRemote });
    this.status = {
      ticketId: request.ticketId,
      state: request.taskListId ? "pending" : "never",
      taskListId: request.taskListId,
      taskListName: request.taskListId ? "Synthetic tasks" : null,
      lastSyncAt: null,
      errorCategory: null,
      pendingOperation: request.deleteRemote ? "delete" : null,
      conflictCount: 0,
    };
    return Promise.resolve(this.status);
  }
}

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

  it("starts Focus from an explicit related schedule and preserves the Ticket state", async () => {
    const client = new MemoryAppClient([]);
    const board = await client.ticketBoard();
    const ticket = await client.createTicket(crypto.randomUUID(), {
      boardId: board.id,
      columnId: board.columns[0]!.id,
      parentTicketId: null,
      title: "Focus対象",
      description: "",
      priority: "normal",
      dueDate: null,
      estimateMinutes: 25,
      tags: [],
      checklist: [],
    });
    const queryClient = new QueryClient({ defaultOptions: { queries: { retry: false } } });
    const user = userEvent.setup();
    const { rerender } = render(
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
    await user.click(await screen.findByRole("button", { name: "この予定でFocus開始" }));

    await waitFor(async () => {
      const focus = await client.currentFocus();
      expect(focus.phase).toBe("working");
      expect(focus.linkedTicketId).toBe(ticket.id);
    });
    expect((await client.ticket(ticket.id)).completedAt).toBeNull();
    expect(screen.getByText(/Focusを開始しました。Ticketの状態は自動変更されません/)).toBeVisible();
    expect(await screen.findByText("進行中")).toBeVisible();

    await client.focusCommand("stop");
    const doneColumn = board.columns.find((column) => column.kind === "done")!;
    const completed = await client.moveTicket({
      operationId: crypto.randomUUID(),
      id: ticket.id,
      expectedVersion: ticket.version,
      targetColumnId: doneColumn.id,
      beforeTicketId: null,
    });
    rerender(
      <QueryClientProvider client={queryClient}>
        <TicketSchedulePlanner
          client={client}
          ticket={completed}
          today="2026-08-03"
          timezoneId="Asia/Tokyo"
        />
      </QueryClientProvider>,
    );
    expect(screen.getByRole("button", { name: "完了のままFocus開始" })).toBeVisible();
    expect(screen.getByRole("button", { name: "再開してFocus開始" })).toBeVisible();
  });

  it("requires an explicit confirmation to detach or delete a mapped Google Task", async () => {
    const client = new GoogleTasksTicketClient([]);
    const board = await client.ticketBoard();
    const ticket = await client.createTicket(crypto.randomUUID(), {
      boardId: board.id,
      columnId: board.columns[0]!.id,
      parentTicketId: null,
      title: "Tasks境界を確認",
      description: "",
      priority: "high",
      dueDate: null,
      estimateMinutes: 30,
      tags: ["local-only"],
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

    await user.selectOptions(
      await screen.findByLabelText("同期先Task List"),
      "cccccccc-cccc-4ccc-8ccc-cccccccccccc",
    );
    await waitFor(() => expect(client.requests).toHaveLength(1));
    expect(await screen.findByText("反映待ち")).toBeVisible();
    expect(screen.queryByRole("option", { name: "同期しない" })).toBeNull();

    await user.click(screen.getByRole("button", { name: "Google Tasksからも削除" }));
    expect(screen.getByText("Google Tasksからも削除しますか？")).toBeVisible();
    expect(client.requests).toHaveLength(1);
    await user.click(screen.getByRole("button", { name: "取消" }));
    expect(client.requests).toHaveLength(1);

    await user.click(screen.getByRole("button", { name: "同期を解除してLocalに残す" }));
    expect(screen.getByText("同期だけを解除しますか？")).toBeVisible();
    await user.click(screen.getByRole("button", { name: "この操作を実行" }));
    await waitFor(() =>
      expect(client.requests.at(-1)).toEqual({ taskListId: null, deleteRemote: false }),
    );
  });
});
