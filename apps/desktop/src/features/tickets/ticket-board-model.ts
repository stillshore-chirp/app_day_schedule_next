import type { Ticket } from "../../shared/contracts";

export type TicketDueFilter = "all" | "overdue" | "today" | "upcoming" | "none";
export type TicketStateFilter = "active" | "completed" | "archived";
export type TicketSort = "board" | "due" | "priority" | "updated";

export interface TicketFilters {
  search: string;
  columnId: string;
  priority: "all" | Ticket["priority"];
  due: TicketDueFilter;
  tag: string;
  state: TicketStateFilter;
  sort: TicketSort;
}

const priorityRank: Record<Ticket["priority"], number> = {
  urgent: 0,
  high: 1,
  normal: 2,
  low: 3,
};

export const initialTicketFilters: TicketFilters = {
  search: "",
  columnId: "all",
  priority: "all",
  due: "all",
  tag: "all",
  state: "active",
  sort: "board",
};

export function canFreelyReorder(filters: TicketFilters): boolean {
  return (
    filters.search.trim() === "" &&
    filters.columnId === "all" &&
    filters.priority === "all" &&
    filters.due === "all" &&
    filters.tag === "all" &&
    filters.state === "active" &&
    filters.sort === "board"
  );
}

function matchesDue(ticket: Ticket, due: TicketDueFilter, today: string): boolean {
  if (due === "all") return true;
  if (due === "none") return ticket.dueDate === null;
  if (!ticket.dueDate) return false;
  if (due === "today") return ticket.dueDate === today;
  if (due === "overdue") return ticket.dueDate < today && ticket.completedAt === null;
  return ticket.dueDate > today;
}

export function filterAndSortTickets(
  tickets: Ticket[],
  filters: TicketFilters,
  today: string,
): Ticket[] {
  const search = filters.search.trim().toLocaleLowerCase();
  const filtered = tickets.filter((ticket) => {
    const stateMatches =
      filters.state === "archived"
        ? ticket.archivedAt !== null
        : ticket.archivedAt === null &&
          (filters.state === "completed" ? ticket.completedAt !== null : true);
    return (
      stateMatches &&
      (filters.columnId === "all" || ticket.columnId === filters.columnId) &&
      (filters.priority === "all" || ticket.priority === filters.priority) &&
      matchesDue(ticket, filters.due, today) &&
      (filters.tag === "all" || ticket.tags.some((tag) => tag.name === filters.tag)) &&
      (search === "" ||
        ticket.title.toLocaleLowerCase().includes(search) ||
        ticket.description.toLocaleLowerCase().includes(search))
    );
  });

  return filtered.sort((left, right) => {
    if (filters.sort === "due") {
      return (left.dueDate ?? "9999-12-31").localeCompare(right.dueDate ?? "9999-12-31");
    }
    if (filters.sort === "priority") {
      return priorityRank[left.priority] - priorityRank[right.priority];
    }
    if (filters.sort === "updated") {
      return right.updatedAt.localeCompare(left.updatedAt);
    }
    return left.sortKey - right.sortKey;
  });
}

export function nextKeyboardTarget(
  columnIds: string[],
  tickets: Ticket[],
  ticket: Ticket,
  direction: "left" | "right" | "up" | "down",
): { columnId: string; beforeTicketId: string | null } | null {
  const columnIndex = columnIds.indexOf(ticket.columnId);
  if (columnIndex < 0) return null;
  if (direction === "left" || direction === "right") {
    const targetIndex = columnIndex + (direction === "left" ? -1 : 1);
    const columnId = columnIds[targetIndex];
    if (!columnId) return null;
    return { columnId, beforeTicketId: null };
  }
  const peers = tickets
    .filter((candidate) => candidate.columnId === ticket.columnId && candidate.id !== ticket.id)
    .sort((left, right) => left.sortKey - right.sortKey);
  const currentIndex = tickets
    .filter((candidate) => candidate.columnId === ticket.columnId)
    .sort((left, right) => left.sortKey - right.sortKey)
    .findIndex((candidate) => candidate.id === ticket.id);
  if (direction === "up") {
    if (currentIndex <= 0) return null;
    return { columnId: ticket.columnId, beforeTicketId: peers[currentIndex - 1]?.id ?? null };
  }
  if (currentIndex < 0 || currentIndex >= peers.length) return null;
  return { columnId: ticket.columnId, beforeTicketId: peers[currentIndex + 1]?.id ?? null };
}
