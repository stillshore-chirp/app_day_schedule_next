import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { act, render, screen, waitFor, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import axe from "axe-core";
import { describe, expect, it } from "vitest";
import type { TicketDraft } from "../../shared/contracts";
import { MemoryAppClient } from "../../shared/ipc/memory-client";
import { PriorityTicketDrawer } from "./PriorityTicketDrawer";

function renderDrawer(client: MemoryAppClient) {
  const queryClient = new QueryClient({ defaultOptions: { queries: { retry: false } } });
  return render(
    <QueryClientProvider client={queryClient}>
      <PriorityTicketDrawer client={client} />
    </QueryClientProvider>,
  );
}

async function createTicket(
  client: MemoryAppClient,
  draft: Pick<TicketDraft, "columnId" | "title" | "priority">,
) {
  const board = await client.ticketBoard();
  return client.createTicket(crypto.randomUUID(), {
    boardId: board.id,
    parentTicketId: null,
    description: "synthetic fixture",
    dueDate: null,
    estimateMinutes: 30,
    tags: [],
    checklist: [],
    ...draft,
  });
}

describe("PriorityTicketDrawer", () => {
  it("opens by default and shows only urgent and high tickets outside Done and Omit", async () => {
    const client = new MemoryAppClient([]);
    const board = await client.ticketBoard();
    const columnId = (kind: (typeof board.columns)[number]["kind"]) =>
      board.columns.find((column) => column.kind === kind)!.id;
    await Promise.all([
      createTicket(client, {
        columnId: columnId("next"),
        title: "最優先の確認事項",
        priority: "urgent",
      }),
      createTicket(client, {
        columnId: columnId("inbox"),
        title: "優先して進める",
        priority: "high",
      }),
      createTicket(client, {
        columnId: columnId("in_progress"),
        title: "通常の作業",
        priority: "normal",
      }),
      createTicket(client, {
        columnId: columnId("done"),
        title: "完了済み最優先",
        priority: "urgent",
      }),
      createTicket(client, {
        columnId: columnId("omit"),
        title: "対応しない高優先",
        priority: "high",
      }),
    ]);
    const { container } = renderDrawer(client);

    const toggle = await screen.findByRole("button", { name: /優先チケット/ });
    expect(toggle).toHaveAttribute("aria-expanded", "true");
    const list = await screen.findByRole("list");
    expect(within(list).getByText("最優先の確認事項")).toBeVisible();
    expect(within(list).getByText("優先して進める")).toBeVisible();
    expect(within(list).getByText("優先度: 最優先")).toBeVisible();
    expect(within(list).getByText("優先度: 高")).toBeVisible();
    expect(screen.queryByText("通常の作業")).not.toBeInTheDocument();
    expect(screen.queryByText("完了済み最優先")).not.toBeInTheDocument();
    expect(screen.queryByText("対応しない高優先")).not.toBeInTheDocument();
    expect(screen.queryByText(/タイムラインへドラッグ/)).not.toBeInTheDocument();
    expect(screen.queryByRole("combobox")).not.toBeInTheDocument();
    expect(screen.queryByRole("button", { name: "予定を作成" })).not.toBeInTheDocument();

    const result = await act(() =>
      axe.run(container, {
        runOnly: { type: "tag", values: ["wcag2a", "wcag2aa", "wcag21aa", "wcag22aa"] },
        rules: { "color-contrast": { enabled: false } },
      }),
    );
    expect(
      result.violations.filter((item) => ["serious", "critical"].includes(item.impact ?? "")),
    ).toEqual([]);

    const user = userEvent.setup();
    toggle.focus();
    await user.keyboard("{Enter}");
    expect(toggle).toHaveAttribute("aria-expanded", "false");
    expect(screen.queryByRole("list")).not.toBeInTheDocument();
    await user.keyboard(" ");
    expect(await screen.findByRole("list")).toBeVisible();
  });

  it("keeps more than one page of high-priority tickets reachable", async () => {
    const client = new MemoryAppClient([]);
    const board = await client.ticketBoard();
    await Promise.all(
      Array.from({ length: 1_001 }, (_, index) =>
        createTicket(client, {
          columnId: board.columns[0]!.id,
          title: `大量の優先チケット ${index + 1}`,
          priority: "high",
        }),
      ),
    );
    renderDrawer(client);

    const list = await screen.findByRole("list");
    await waitFor(() => expect(within(list).getAllByRole("article")).toHaveLength(1_001));
  });

  it("distinguishes query failure and remains accessible", async () => {
    class FailureClient extends MemoryAppClient {
      override listTickets() {
        return Promise.reject(new Error("synthetic ticket query failure"));
      }
    }
    const { container } = renderDrawer(new FailureClient([]));

    expect(await screen.findByRole("alert")).toHaveTextContent(
      "優先チケットを読み込めませんでした",
    );
    expect(screen.getByRole("button", { name: "再読み込み" })).toBeVisible();
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
