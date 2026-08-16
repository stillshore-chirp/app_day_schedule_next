import { useMemo, useState } from "react";
import { useQuery } from "@tanstack/react-query";
import type { Ticket } from "../../shared/contracts";
import { translate } from "../../shared/i18n/messages";
import type { AppClient } from "../../shared/ipc/client";
import { StatusMessage } from "../../shared/ui/StatusMessage";

type VisiblePriority = Extract<Ticket["priority"], "urgent" | "high">;

const visiblePriorities: VisiblePriority[] = ["urgent", "high"];
const priorityRank: Record<VisiblePriority, number> = { urgent: 0, high: 1 };

async function listAllPriorityTickets(
  client: AppClient,
  priority: VisiblePriority,
): Promise<Ticket[]> {
  const items: Ticket[] = [];
  let offset = 0;

  while (true) {
    const page = await client.listTickets({ priority, limit: 1_000, offset });
    items.push(...page.items);
    if (items.length >= page.total || page.items.length === 0) return items;
    offset += page.items.length;
  }
}

export function PriorityTicketDrawer({ client }: { client: AppClient }) {
  const [open, setOpen] = useState(true);
  const boardQuery = useQuery({
    queryKey: ["ticket-board"],
    queryFn: () => client.ticketBoard(),
  });
  const ticketsQuery = useQuery({
    queryKey: ["tickets", "priority"],
    queryFn: async () =>
      (
        await Promise.all(
          visiblePriorities.map((priority) => listAllPriorityTickets(client, priority)),
        )
      ).flat(),
  });
  const loading = boardQuery.isLoading || ticketsQuery.isLoading;
  const failed = boardQuery.isError || ticketsQuery.isError;
  const tickets = useMemo(() => {
    const columns = new Map(
      (boardQuery.data?.columns ?? []).map((column) => [
        column.id,
        { kind: column.kind, sortOrder: column.sortOrder },
      ]),
    );

    return (ticketsQuery.data ?? [])
      .filter((ticket): ticket is Ticket & { priority: VisiblePriority } => {
        if (ticket.priority !== "urgent" && ticket.priority !== "high") return false;
        const kind = columns.get(ticket.columnId)?.kind;
        return kind !== undefined && kind !== "done" && kind !== "omit";
      })
      .sort((left, right) => {
        const priorityDifference = priorityRank[left.priority] - priorityRank[right.priority];
        if (priorityDifference !== 0) return priorityDifference;
        const columnDifference =
          (columns.get(left.columnId)?.sortOrder ?? Number.MAX_SAFE_INTEGER) -
          (columns.get(right.columnId)?.sortOrder ?? Number.MAX_SAFE_INTEGER);
        if (columnDifference !== 0) return columnDifference;
        return left.sortKey - right.sortKey || left.id.localeCompare(right.id);
      });
  }, [boardQuery.data?.columns, ticketsQuery.data]);

  return (
    <section className="priority-ticket-drawer" aria-labelledby="priority-ticket-title">
      <button
        className="priority-ticket-drawer__toggle"
        type="button"
        aria-expanded={open}
        aria-controls="priority-ticket-content"
        onClick={() => setOpen((value) => !value)}
      >
        <strong id="priority-ticket-title">
          {translate("features.schedule.PriorityTicketDrawer.title")}
        </strong>
        <span className="priority-ticket-drawer__summary">
          {loading
            ? translate("features.schedule.PriorityTicketDrawer.loadingCount")
            : translate("features.schedule.PriorityTicketDrawer.count", [tickets.length])}
          <span aria-hidden="true">{open ? "▲" : "▼"}</span>
        </span>
      </button>
      {open ? (
        <div id="priority-ticket-content" className="priority-ticket-drawer__content">
          {loading ? (
            <p role="status">{translate("features.schedule.PriorityTicketDrawer.loading")}</p>
          ) : failed ? (
            <StatusMessage
              tone="danger"
              title={translate("features.schedule.PriorityTicketDrawer.error")}
              action={
                <button
                  className="button"
                  type="button"
                  onClick={() => void Promise.all([boardQuery.refetch(), ticketsQuery.refetch()])}
                >
                  {translate("features.schedule.PriorityTicketDrawer.retry")}
                </button>
              }
            >
              {translate("features.schedule.PriorityTicketDrawer.errorRecovery")}
            </StatusMessage>
          ) : tickets.length === 0 ? (
            <p>{translate("features.schedule.PriorityTicketDrawer.empty")}</p>
          ) : (
            <ul className="priority-ticket-list">
              {tickets.map((ticket) => (
                <li key={ticket.id}>
                  <article className="priority-ticket-card" data-priority={ticket.priority}>
                    <strong>{ticket.title}</strong>
                    <span>
                      {translate("features.schedule.PriorityTicketDrawer.priority", [
                        translate(`features.tickets.KanbanView.priority.${ticket.priority}`),
                      ])}
                    </span>
                  </article>
                </li>
              ))}
            </ul>
          )}
        </div>
      ) : null}
    </section>
  );
}
