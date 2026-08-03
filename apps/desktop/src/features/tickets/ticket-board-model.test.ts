import { describe, expect, it } from "vitest";
import type { Ticket } from "../../shared/contracts";
import {
  canFreelyReorder,
  filterAndSortTickets,
  initialTicketFilters,
  nextKeyboardTarget,
} from "./ticket-board-model";

function ticket(overrides: Partial<Ticket> & Pick<Ticket, "id" | "columnId" | "title">): Ticket {
  const { id, columnId, title, ...rest } = overrides;
  return {
    id,
    boardId: "00000000-0000-4000-8000-000000000100",
    columnId,
    lastNonDoneColumnId: columnId,
    parentTicketId: null,
    title,
    description: "",
    priority: "normal",
    dueDate: null,
    estimateMinutes: null,
    sortKey: 1_024,
    tags: [],
    checklist: [],
    version: 0,
    createdAt: "2026-08-03T00:00:00Z",
    updatedAt: "2026-08-03T00:00:00Z",
    completedAt: null,
    archivedAt: null,
    deletedAt: null,
    ...rest,
  };
}

describe("ticket board model", () => {
  const first = ticket({
    id: "00000000-0000-4000-8000-000000000201",
    columnId: "00000000-0000-4000-8000-000000000101",
    title: "Alpha",
    description: "find this phrase",
    priority: "low",
    dueDate: "2026-08-02",
    tags: [{ id: "00000000-0000-4000-8000-000000000301", name: "design" }],
  });
  const second = ticket({
    id: "00000000-0000-4000-8000-000000000202",
    columnId: first.columnId,
    title: "Beta",
    priority: "urgent",
    dueDate: "2026-08-04",
    sortKey: 2_048,
  });

  it("combines search, due, priority, tag and state filters deterministically", () => {
    expect(
      filterAndSortTickets(
        [first, second],
        {
          ...initialTicketFilters,
          search: "phrase",
          priority: "low",
          due: "overdue",
          tag: "design",
        },
        "2026-08-03",
      ),
    ).toEqual([first]);
  });

  it("sorts by priority without mutating the input", () => {
    const input = [first, second];
    expect(
      filterAndSortTickets(input, { ...initialTicketFilters, sort: "priority" }, "2026-08-03").map(
        (item) => item.id,
      ),
    ).toEqual([second.id, first.id]);
    expect(input).toEqual([first, second]);
  });

  it("disables free reorder whenever hidden tickets or a derived sort can affect order", () => {
    expect(canFreelyReorder(initialTicketFilters)).toBe(true);
    expect(canFreelyReorder({ ...initialTicketFilters, search: "alpha" })).toBe(false);
    expect(canFreelyReorder({ ...initialTicketFilters, state: "archived" })).toBe(false);
    expect(canFreelyReorder({ ...initialTicketFilters, sort: "due" })).toBe(false);
  });

  it("keeps completed cards visible on the normal six-column board", () => {
    const completed = { ...second, completedAt: "2026-08-03T01:00:00Z" };
    expect(filterAndSortTickets([completed], initialTicketFilters, "2026-08-03")).toEqual([
      completed,
    ]);
    expect(
      filterAndSortTickets(
        [first, completed],
        { ...initialTicketFilters, state: "completed" },
        "2026-08-03",
      ),
    ).toEqual([completed]);
  });

  it("computes one-step keyboard movement across columns and within a column", () => {
    const columns = [
      first.columnId,
      "00000000-0000-4000-8000-000000000102",
      "00000000-0000-4000-8000-000000000103",
    ];
    expect(nextKeyboardTarget(columns, [first, second], first, "right")).toEqual({
      columnId: columns[1],
      beforeTicketId: null,
    });
    expect(nextKeyboardTarget(columns, [first, second], first, "down")).toEqual({
      columnId: first.columnId,
      beforeTicketId: null,
    });
    expect(nextKeyboardTarget(columns, [first, second], first, "left")).toBeNull();
  });

  it("keeps a 500-ticket board searchable within a stable result", () => {
    const many = Array.from({ length: 500 }, (_, index) =>
      ticket({
        id: `00000000-0000-4000-8000-${String(index + 1).padStart(12, "0")}`,
        columnId: first.columnId,
        title: index === 499 ? "needle" : `ticket ${index}`,
        sortKey: (index + 1) * 1_024,
      }),
    );
    expect(
      filterAndSortTickets(many, { ...initialTicketFilters, search: "needle" }, "2026-08-03"),
    ).toHaveLength(1);
  });
});
