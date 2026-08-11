import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import type { Ticket, TicketDraft } from "../../shared/contracts";
import { appLocale, translate } from "../../shared/i18n/messages";
import { AppClientError, type AppClient } from "../../shared/ipc/client";
import { MarkdownDescriptionField } from "../../shared/ui/MarkdownDescriptionField";
import { StatusMessage } from "../../shared/ui/StatusMessage";
import {
  canFreelyReorder,
  filterAndSortTickets,
  initialTicketFilters,
  nextKeyboardTarget,
  type TicketFilters,
} from "./ticket-board-model";
import { TicketSchedulePlanner } from "./TicketSchedulePlanner";

interface EditorState {
  mode: "create" | "edit";
  ticket: Ticket | null;
  columnId: string;
}

interface FormState {
  title: string;
  description: string;
  priority: Ticket["priority"];
  dueDate: string;
  estimateMinutes: string;
  tags: string;
  checklist: string;
}

const blankForm: FormState = {
  title: "",
  description: "",
  priority: "normal",
  dueDate: "",
  estimateMinutes: "",
  tags: "",
  checklist: "",
};

function formForTicket(ticket: Ticket | null): FormState {
  if (!ticket) return blankForm;
  return {
    title: ticket.title,
    description: ticket.description,
    priority: ticket.priority,
    dueDate: ticket.dueDate ?? "",
    estimateMinutes: ticket.estimateMinutes?.toString() ?? "",
    tags: ticket.tags.map((tag) => tag.name).join(", "),
    checklist: ticket.checklist
      .map((item) => `${item.completed ? "[x]" : "[ ]"} ${item.title}`)
      .join("\n"),
  };
}

function draftFromForm(boardId: string, columnId: string, form: FormState): TicketDraft {
  return {
    boardId,
    columnId,
    parentTicketId: null,
    title: form.title,
    description: form.description,
    priority: form.priority,
    dueDate: form.dueDate || null,
    estimateMinutes: form.estimateMinutes ? Number(form.estimateMinutes) : null,
    tags: form.tags
      .split(",")
      .map((tag) => tag.trim())
      .filter(Boolean),
    checklist: form.checklist
      .split("\n")
      .map((line) => line.trim())
      .filter(Boolean)
      .map((line) => ({
        completed: /^\[x\]\s*/i.test(line),
        title: line.replace(/^\[(?:x| )\]\s*/i, "").trim(),
      })),
  };
}

function priorityLabel(priority: Ticket["priority"]): string {
  return translate(`features.tickets.KanbanView.priority.${priority}`);
}

function errorKind(error: unknown): "conflict" | "failure" {
  if (error instanceof AppClientError && error.detail.code === "version_conflict")
    return "conflict";
  if (error instanceof Error && error.message.includes("version_conflict")) return "conflict";
  return "failure";
}

export function KanbanView({ client, today }: { client: AppClient; today: string }) {
  const queryClient = useQueryClient();
  const boardQuery = useQuery({ queryKey: ["ticket-board"], queryFn: () => client.ticketBoard() });
  const ticketsQuery = useQuery({
    queryKey: ["tickets"],
    queryFn: () => client.listTickets({ includeArchived: true, limit: 1_000 }),
  });
  const [filters, setFilters] = useState<TicketFilters>(initialTicketFilters);
  const [quickTitles, setQuickTitles] = useState<Record<string, string>>({});
  const [editor, setEditor] = useState<EditorState | null>(null);
  const [form, setForm] = useState<FormState>(blankForm);
  const [saveState, setSaveState] = useState<"idle" | "pending" | "saved" | "failure" | "conflict">(
    "idle",
  );
  const [announcement, setAnnouncement] = useState("");
  const [draggingId, setDraggingId] = useState<string | null>(null);
  const [deleteTarget, setDeleteTarget] = useState<Ticket | null>(null);
  const [deletedDraft, setDeletedDraft] = useState<TicketDraft | null>(null);
  const [actionError, setActionError] = useState<"failure" | "conflict" | null>(null);
  const openerRef = useRef<HTMLElement | null>(null);
  const dialogRef = useRef<HTMLDivElement>(null);
  const confirmRef = useRef<HTMLDivElement>(null);
  const deleteButtonRef = useRef<HTMLButtonElement>(null);
  const titleRef = useRef<HTMLInputElement>(null);
  const boardRef = useRef<HTMLDivElement>(null);

  const refresh = useCallback(async () => {
    await queryClient.invalidateQueries({ queryKey: ["tickets"] });
  }, [queryClient]);

  const board = boardQuery.data;
  const tickets = ticketsQuery.data?.items ?? [];
  const ticketIds = useMemo(() => tickets.map((ticket) => ticket.id), [tickets]);
  const planningQuery = useQuery({
    queryKey: ["ticket-planning-summaries", ticketIds],
    queryFn: () => client.ticketPlanningSummaries(ticketIds),
    enabled: ticketIds.length > 0,
  });
  const planningByTicket = useMemo(
    () => new Map((planningQuery.data ?? []).map((summary) => [summary.ticketId, summary])),
    [planningQuery.data],
  );
  const visibleTickets = useMemo(
    () => filterAndSortTickets(tickets, filters, today),
    [filters, tickets, today],
  );
  const allTags = useMemo(
    () => [...new Set(tickets.flatMap((ticket) => ticket.tags.map((tag) => tag.name)))].sort(),
    [tickets],
  );
  const reorderEnabled = canFreelyReorder(filters);

  useEffect(() => {
    if (!draggingId) return;
    const cancelDrag = (event: KeyboardEvent) => {
      if (event.key !== "Escape") return;
      setDraggingId(null);
      setAnnouncement(translate("features.tickets.KanbanView.moveCancelled"));
    };
    window.addEventListener("keydown", cancelDrag);
    return () => window.removeEventListener("keydown", cancelDrag);
  }, [draggingId]);

  const openEditor = useCallback((next: EditorState, opener?: HTMLElement | null) => {
    openerRef.current = opener ?? (document.activeElement as HTMLElement | null);
    setEditor(next);
    setForm(formForTicket(next.ticket));
    setSaveState("idle");
  }, []);

  const closeEditor = useCallback(
    (force = false) => {
      if (saveState === "pending") return;
      if (
        !force &&
        editor &&
        JSON.stringify(form) !== JSON.stringify(formForTicket(editor.ticket))
      ) {
        if (!window.confirm(translate("features.tickets.KanbanView.dirtyConfirm"))) return;
      }
      setEditor(null);
      setSaveState("idle");
      requestAnimationFrame(() => openerRef.current?.focus());
    },
    [editor, form, saveState],
  );

  useEffect(() => {
    if (!editor || deleteTarget) return;
    titleRef.current?.focus();
  }, [deleteTarget, editor?.mode, editor?.ticket?.id]);

  useEffect(() => {
    if (!editor || deleteTarget) return;
    const onKeyDown = (event: KeyboardEvent) => {
      if (event.key === "Escape") {
        event.preventDefault();
        closeEditor();
        return;
      }
      if (event.key !== "Tab" || !dialogRef.current) return;
      const focusable = [
        ...dialogRef.current.querySelectorAll<HTMLElement>(
          'button:not(:disabled), input:not(:disabled), select:not(:disabled), textarea:not(:disabled), [tabindex="0"]',
        ),
      ];
      if (focusable.length === 0) return;
      const first = focusable[0]!;
      const last = focusable[focusable.length - 1]!;
      if (event.shiftKey && document.activeElement === first) {
        event.preventDefault();
        last.focus();
      } else if (!event.shiftKey && document.activeElement === last) {
        event.preventDefault();
        first.focus();
      }
    };
    window.addEventListener("keydown", onKeyDown);
    return () => window.removeEventListener("keydown", onKeyDown);
  }, [closeEditor, deleteTarget, editor]);

  useEffect(() => {
    if (!deleteTarget) return;
    const onKeyDown = (event: KeyboardEvent) => {
      if (event.key === "Escape") {
        event.preventDefault();
        setDeleteTarget(null);
        requestAnimationFrame(() => deleteButtonRef.current?.focus());
        return;
      }
      if (event.key !== "Tab" || !confirmRef.current) return;
      const focusable = [
        ...confirmRef.current.querySelectorAll<HTMLElement>("button:not(:disabled)"),
      ];
      const first = focusable[0];
      const last = focusable[focusable.length - 1];
      if (!first || !last) return;
      if (event.shiftKey && document.activeElement === first) {
        event.preventDefault();
        last.focus();
      } else if (!event.shiftKey && document.activeElement === last) {
        event.preventDefault();
        first.focus();
      }
    };
    window.addEventListener("keydown", onKeyDown);
    return () => window.removeEventListener("keydown", onKeyDown);
  }, [deleteTarget]);

  async function createQuick(columnId: string) {
    if (!board) return;
    const title = quickTitles[columnId]?.trim();
    if (!title) return;
    setActionError(null);
    try {
      await client.createTicket(crypto.randomUUID(), {
        ...draftFromForm(board.id, columnId, blankForm),
        title,
      });
      setQuickTitles((current) => ({ ...current, [columnId]: "" }));
      setAnnouncement(translate("features.tickets.KanbanView.created", [title]));
      await refresh();
    } catch (error) {
      setActionError(errorKind(error));
    }
  }

  async function saveEditor() {
    if (!board || !editor || !form.title.trim()) return;
    const draft = draftFromForm(board.id, editor.columnId, form);
    setSaveState("pending");
    try {
      const saved =
        editor.mode === "create"
          ? await client.createTicket(crypto.randomUUID(), draft)
          : await client.updateTicket({
              operationId: crypto.randomUUID(),
              id: editor.ticket!.id,
              expectedVersion: editor.ticket!.version,
              patch: {
                title: draft.title,
                description: draft.description,
                priority: draft.priority,
                dueDate: draft.dueDate,
                estimateMinutes: draft.estimateMinutes,
                tags: draft.tags,
                checklist: draft.checklist,
              },
            });
      setEditor({ mode: "edit", ticket: saved, columnId: saved.columnId });
      setForm(formForTicket(saved));
      setSaveState("saved");
      setAnnouncement(translate("features.tickets.KanbanView.saved", [saved.title]));
      await refresh();
    } catch (error) {
      setSaveState(errorKind(error));
    }
  }

  async function moveTicket(ticket: Ticket, targetColumnId: string, beforeTicketId: string | null) {
    setActionError(null);
    try {
      const moved = await client.moveTicket({
        operationId: crypto.randomUUID(),
        id: ticket.id,
        expectedVersion: ticket.version,
        targetColumnId,
        beforeTicketId,
      });
      setAnnouncement(translate("features.tickets.KanbanView.moved", [moved.title]));
      await refresh();
    } catch (error) {
      setActionError(errorKind(error));
    }
  }

  async function keyboardMove(ticket: Ticket, direction: "left" | "right" | "up" | "down") {
    if (!board || !reorderEnabled) return;
    const target = nextKeyboardTarget(
      board.columns.map((column) => column.id),
      tickets.filter((candidate) => candidate.archivedAt === null && candidate.deletedAt === null),
      ticket,
      direction,
    );
    if (!target) {
      setAnnouncement(translate("features.tickets.KanbanView.moveBoundary"));
      return;
    }
    await moveTicket(ticket, target.columnId, target.beforeTicketId);
  }

  function scrollBoardDuringDrag(clientX: number) {
    if (!boardRef.current) return;
    const bounds = boardRef.current.getBoundingClientRect();
    const edge = 72;
    if (clientX < bounds.left + edge) boardRef.current.scrollLeft -= 18;
    if (clientX > bounds.right - edge) boardRef.current.scrollLeft += 18;
  }

  function dropTicketAtPoint(ticket: Ticket, clientX: number, clientY: number) {
    const dropElement = document.elementFromPoint(clientX, clientY);
    const targetColumn = dropElement?.closest<HTMLElement>("[data-ticket-column-id]");
    const targetCard = dropElement?.closest<HTMLElement>("[data-ticket-id]");
    setDraggingId(null);
    if (!targetColumn || !reorderEnabled) {
      setAnnouncement(translate("features.tickets.KanbanView.moveCancelled"));
      return;
    }
    const targetColumnId = targetColumn.dataset.ticketColumnId;
    const beforeTicketId = targetCard?.dataset.ticketId ?? null;
    if (!targetColumnId || beforeTicketId === ticket.id) {
      setAnnouncement(translate("features.tickets.KanbanView.moveCancelled"));
      return;
    }
    void moveTicket(ticket, targetColumnId, beforeTicketId);
  }

  async function toggleArchive(ticket: Ticket, archived: boolean) {
    const planning = planningByTicket.get(ticket.id);
    if (
      archived &&
      !window.confirm(
        translate("features.tickets.KanbanView.archivePlanningConfirm", [
          ticket.title,
          planning?.scheduleCount ?? 0,
          planning?.futurePlannedMinutes ?? 0,
        ]),
      )
    )
      return;
    try {
      await client.archiveTicket(crypto.randomUUID(), ticket.id, ticket.version, archived);
      setAnnouncement(
        translate(
          archived
            ? "features.tickets.KanbanView.archived"
            : "features.tickets.KanbanView.restored",
          [ticket.title],
        ),
      );
      closeEditor(true);
      await refresh();
    } catch (error) {
      setActionError(errorKind(error));
    }
  }

  async function confirmDelete() {
    if (!deleteTarget || !board) return;
    const recoveryDraft = draftFromForm(
      board.id,
      deleteTarget.columnId,
      formForTicket(deleteTarget),
    );
    try {
      await client.deleteTicket(crypto.randomUUID(), deleteTarget.id, deleteTarget.version);
      setDeletedDraft(recoveryDraft);
      setAnnouncement(translate("features.tickets.KanbanView.deleted", [deleteTarget.title]));
      setDeleteTarget(null);
      closeEditor(true);
      await refresh();
    } catch (error) {
      setActionError(errorKind(error));
      setDeleteTarget(null);
    }
  }

  async function undoDelete() {
    if (!deletedDraft) return;
    try {
      const restored = await client.createTicket(crypto.randomUUID(), deletedDraft);
      setDeletedDraft(null);
      setAnnouncement(translate("features.tickets.KanbanView.deleteUndone", [restored.title]));
      await refresh();
    } catch (error) {
      setActionError(errorKind(error));
    }
  }

  if (boardQuery.isLoading || ticketsQuery.isLoading) {
    return (
      <main className="ticket-view ticket-view--state" aria-busy="true">
        <h1>{translate("features.tickets.KanbanView.heading")}</h1>
        <p role="status">{translate("features.tickets.KanbanView.loading")}</p>
      </main>
    );
  }

  if (boardQuery.isError || ticketsQuery.isError || !board) {
    return (
      <main className="ticket-view ticket-view--state">
        <h1>{translate("features.tickets.KanbanView.heading")}</h1>
        <StatusMessage
          tone="danger"
          title={translate("features.tickets.KanbanView.loadFailed")}
          action={
            <button
              className="button"
              onClick={() => {
                void boardQuery.refetch();
                void ticketsQuery.refetch();
              }}
            >
              {translate("features.tickets.KanbanView.retry")}
            </button>
          }
        >
          {translate("features.tickets.KanbanView.loadRecovery")}
        </StatusMessage>
      </main>
    );
  }

  return (
    <main className="ticket-view">
      <div className="ticket-view__header">
        <div>
          <p className="eyebrow">{translate("features.tickets.KanbanView.eyebrow")}</p>
          <h1>{translate("features.tickets.KanbanView.heading")}</h1>
          <p>{translate("features.tickets.KanbanView.intro")}</p>
        </div>
        <button
          className="button button--primary"
          onClick={(event) =>
            openEditor(
              { mode: "create", ticket: null, columnId: board.columns[0]!.id },
              event.currentTarget,
            )
          }
        >
          {translate("features.tickets.KanbanView.create")}
        </button>
      </div>
      {ticketsQuery.isFetching && !ticketsQuery.isLoading ? (
        <p className="ticket-refreshing" role="status">
          {translate("features.tickets.KanbanView.refreshing")}
        </p>
      ) : null}

      <section
        className="ticket-toolbar"
        aria-label={translate("features.tickets.KanbanView.filters")}
      >
        <label className="ticket-toolbar__search">
          <span>{translate("features.tickets.KanbanView.search")}</span>
          <input
            type="search"
            value={filters.search}
            onChange={(event) => setFilters({ ...filters, search: event.target.value })}
          />
        </label>
        <FilterSelect
          label={translate("features.tickets.KanbanView.column")}
          value={filters.columnId}
          onChange={(columnId) => setFilters({ ...filters, columnId })}
          options={[
            ["all", translate("features.tickets.KanbanView.allColumns")],
            ...board.columns.map((column) => [column.id, column.name] as [string, string]),
          ]}
        />
        <FilterSelect
          label={translate("features.tickets.KanbanView.priority")}
          value={filters.priority}
          onChange={(priority) =>
            setFilters({ ...filters, priority: priority as TicketFilters["priority"] })
          }
          options={[
            ["all", translate("features.tickets.KanbanView.all")],
            ...(["urgent", "high", "normal", "low"] as const).map(
              (priority) => [priority, priorityLabel(priority)] as [string, string],
            ),
          ]}
        />
        <FilterSelect
          label={translate("features.tickets.KanbanView.due")}
          value={filters.due}
          onChange={(due) => setFilters({ ...filters, due: due as TicketFilters["due"] })}
          options={(["all", "overdue", "today", "upcoming", "none"] as const).map(
            (due) => [due, translate(`features.tickets.KanbanView.due.${due}`)] as [string, string],
          )}
        />
        <FilterSelect
          label={translate("features.tickets.KanbanView.tag")}
          value={filters.tag}
          onChange={(tag) => setFilters({ ...filters, tag })}
          options={[
            ["all", translate("features.tickets.KanbanView.all")],
            ...allTags.map((tag) => [tag, tag] as [string, string]),
          ]}
        />
        <FilterSelect
          label={translate("features.tickets.KanbanView.state")}
          value={filters.state}
          onChange={(state) => setFilters({ ...filters, state: state as TicketFilters["state"] })}
          options={(["active", "completed", "archived"] as const).map(
            (state) =>
              [state, translate(`features.tickets.KanbanView.state.${state}`)] as [string, string],
          )}
        />
        <FilterSelect
          label={translate("features.tickets.KanbanView.sort")}
          value={filters.sort}
          onChange={(sort) => setFilters({ ...filters, sort: sort as TicketFilters["sort"] })}
          options={(["board", "due", "priority", "updated"] as const).map(
            (sort) =>
              [sort, translate(`features.tickets.KanbanView.sort.${sort}`)] as [string, string],
          )}
        />
        <button className="button button--subtle" onClick={() => setFilters(initialTicketFilters)}>
          {translate("features.tickets.KanbanView.clearFilters")}
        </button>
      </section>

      {!reorderEnabled ? (
        <p className="ticket-reorder-notice" role="note">
          {translate("features.tickets.KanbanView.reorderDisabled")}
        </p>
      ) : null}
      {actionError ? (
        <StatusMessage
          tone="danger"
          title={translate(
            actionError === "conflict"
              ? "features.tickets.KanbanView.conflictTitle"
              : "features.tickets.KanbanView.saveFailed",
          )}
          action={
            <button className="button" onClick={() => void refresh()}>
              {translate("features.tickets.KanbanView.reload")}
            </button>
          }
        >
          {translate(
            actionError === "conflict"
              ? "features.tickets.KanbanView.conflictRecovery"
              : "features.tickets.KanbanView.failureRecovery",
          )}
        </StatusMessage>
      ) : null}
      {deletedDraft ? (
        <StatusMessage
          tone="success"
          title={translate("features.tickets.KanbanView.deleteComplete")}
          action={
            <button className="button" onClick={() => void undoDelete()}>
              {translate("features.tickets.KanbanView.undoDelete")}
            </button>
          }
        >
          {translate("features.tickets.KanbanView.deleteRecovery")}
        </StatusMessage>
      ) : null}

      {visibleTickets.length === 0 && tickets.length > 0 ? (
        <div className="ticket-no-results">
          <h2>{translate("features.tickets.KanbanView.noResults")}</h2>
          <p>{translate("features.tickets.KanbanView.noResultsHelp")}</p>
        </div>
      ) : null}

      <div
        className="ticket-board"
        aria-label={board.name}
        data-dragging={draggingId ? "true" : "false"}
        ref={boardRef}
      >
        {board.columns.map((column) => {
          const columnTickets = visibleTickets.filter((ticket) => ticket.columnId === column.id);
          return (
            <section
              className="ticket-column"
              key={column.id}
              data-ticket-column-id={column.id}
              aria-labelledby={`ticket-column-${column.id}`}
            >
              <header className="ticket-column__header">
                <h2 id={`ticket-column-${column.id}`}>{column.name}</h2>
                <span
                  aria-label={translate("features.tickets.KanbanView.ticketCount", [
                    columnTickets.length,
                  ])}
                >
                  {columnTickets.length}
                </span>
              </header>
              <div className="ticket-column__cards" role="list">
                {columnTickets.map((ticket) => (
                  <TicketCard
                    key={ticket.id}
                    ticket={ticket}
                    draggable={reorderEnabled}
                    dragging={draggingId === ticket.id}
                    onOpen={(opener) =>
                      openEditor({ mode: "edit", ticket, columnId: ticket.columnId }, opener)
                    }
                    onDragStart={() => {
                      setDraggingId(ticket.id);
                      setAnnouncement(
                        translate("features.tickets.KanbanView.dragStarted", [ticket.title]),
                      );
                    }}
                    onDragEnd={() => {
                      setDraggingId(null);
                      setAnnouncement(translate("features.tickets.KanbanView.moveCancelled"));
                    }}
                    onDragMove={scrollBoardDuringDrag}
                    onDropAtPoint={(clientX, clientY) =>
                      dropTicketAtPoint(ticket, clientX, clientY)
                    }
                    onMove={(direction) => void keyboardMove(ticket, direction)}
                  />
                ))}
                {columnTickets.length === 0 ? (
                  <p className="ticket-column__empty">
                    {translate("features.tickets.KanbanView.emptyColumn")}
                  </p>
                ) : null}
              </div>
              {filters.state === "active" ? (
                <form
                  className="ticket-quick-create"
                  onSubmit={(event) => {
                    event.preventDefault();
                    void createQuick(column.id);
                  }}
                >
                  <label>
                    <span className="sr-only">
                      {translate("features.tickets.KanbanView.quickTitle", [column.name])}
                    </span>
                    <input
                      value={quickTitles[column.id] ?? ""}
                      onChange={(event) =>
                        setQuickTitles((current) => ({
                          ...current,
                          [column.id]: event.target.value,
                        }))
                      }
                      placeholder={translate("features.tickets.KanbanView.quickPlaceholder")}
                      maxLength={1_024}
                    />
                  </label>
                  <button
                    className="button button--subtle"
                    disabled={!quickTitles[column.id]?.trim()}
                  >
                    {translate("features.tickets.KanbanView.add")}
                  </button>
                </form>
              ) : null}
            </section>
          );
        })}
      </div>

      {tickets.length === 0 ? (
        <div className="ticket-empty-board">
          <h2>{translate("features.tickets.KanbanView.emptyBoard")}</h2>
          <p>{translate("features.tickets.KanbanView.emptyBoardHelp")}</p>
        </div>
      ) : null}

      <p className="sr-only" aria-live="polite" aria-atomic="true">
        {announcement}
      </p>

      {editor ? (
        <div
          className="ticket-dialog-backdrop"
          onClick={(event) => {
            if (event.target === event.currentTarget) closeEditor();
          }}
        >
          <div
            className="ticket-dialog"
            role="dialog"
            aria-modal="true"
            aria-labelledby="ticket-dialog-title"
            aria-hidden={deleteTarget ? true : undefined}
            aria-busy={saveState === "pending"}
            ref={dialogRef}
          >
            <div className="ticket-dialog__header">
              <div>
                <p className="eyebrow">{translate("features.tickets.KanbanView.localOnly")}</p>
                <h2 id="ticket-dialog-title">
                  {translate(
                    editor.mode === "create"
                      ? "features.tickets.KanbanView.createDetail"
                      : "features.tickets.KanbanView.editDetail",
                  )}
                </h2>
              </div>
              <button
                className="icon-button"
                aria-label={translate("features.tickets.KanbanView.close")}
                disabled={saveState === "pending"}
                onClick={() => closeEditor()}
              >
                ×
              </button>
            </div>
            <div className="ticket-dialog__body">
              <fieldset className="ticket-dialog__fields" disabled={saveState === "pending"}>
                <legend className="sr-only">
                  {translate("features.tickets.KanbanView.fields")}
                </legend>
                <label>
                  {translate("features.tickets.KanbanView.title")}
                  <input
                    ref={titleRef}
                    required
                    maxLength={1_024}
                    value={form.title}
                    onChange={(event) => setForm({ ...form, title: event.target.value })}
                  />
                </label>
                <MarkdownDescriptionField
                  key={editor.ticket?.id ?? "new-ticket"}
                  id="ticket-description"
                  label={translate("features.tickets.KanbanView.description")}
                  rows={8}
                  maxLength={10_000}
                  value={form.description}
                  onChange={(description) => setForm({ ...form, description })}
                />
                <div className="ticket-dialog__grid">
                  <label>
                    {translate("features.tickets.KanbanView.priority")}
                    <select
                      value={form.priority}
                      onChange={(event) =>
                        setForm({ ...form, priority: event.target.value as Ticket["priority"] })
                      }
                    >
                      {(["urgent", "high", "normal", "low"] as const).map((priority) => (
                        <option key={priority} value={priority}>
                          {priorityLabel(priority)}
                        </option>
                      ))}
                    </select>
                  </label>
                  <label>
                    {translate("features.tickets.KanbanView.due")}
                    <input
                      type="date"
                      value={form.dueDate}
                      onChange={(event) => setForm({ ...form, dueDate: event.target.value })}
                    />
                  </label>
                  <label>
                    {translate("features.tickets.KanbanView.estimate")}
                    <input
                      type="number"
                      min="1"
                      max="100800"
                      value={form.estimateMinutes}
                      onChange={(event) =>
                        setForm({ ...form, estimateMinutes: event.target.value })
                      }
                    />
                  </label>
                  <label>
                    {translate("features.tickets.KanbanView.tags")}
                    <input
                      value={form.tags}
                      onChange={(event) => setForm({ ...form, tags: event.target.value })}
                      placeholder={translate("features.tickets.KanbanView.tagsHelp")}
                    />
                  </label>
                </div>
                <label>
                  {translate("features.tickets.KanbanView.checklist")}
                  <textarea
                    rows={5}
                    value={form.checklist}
                    onChange={(event) => setForm({ ...form, checklist: event.target.value })}
                    placeholder={translate("features.tickets.KanbanView.checklistHelp")}
                  />
                </label>
                {editor.ticket?.completedAt ? (
                  <p>
                    {translate("features.tickets.KanbanView.completedAt", [
                      new Date(editor.ticket.completedAt).toLocaleString(appLocale),
                    ])}
                  </p>
                ) : null}
                {editor.ticket &&
                editor.ticket.archivedAt === null &&
                editor.ticket.deletedAt === null ? (
                  <TicketSchedulePlanner
                    client={client}
                    ticket={editor.ticket}
                    today={today}
                    timezoneId={Intl.DateTimeFormat().resolvedOptions().timeZone || "UTC"}
                  />
                ) : null}
              </fieldset>
              {saveState === "pending" ? (
                <p role="status">{translate("features.tickets.KanbanView.saving")}</p>
              ) : null}
              {saveState === "saved" ? (
                <StatusMessage
                  tone="success"
                  title={translate("features.tickets.KanbanView.savedState")}
                />
              ) : null}
              {saveState === "failure" || saveState === "conflict" ? (
                <StatusMessage
                  tone="danger"
                  title={translate(
                    saveState === "conflict"
                      ? "features.tickets.KanbanView.conflictTitle"
                      : "features.tickets.KanbanView.saveFailed",
                  )}
                >
                  {translate(
                    saveState === "conflict"
                      ? "features.tickets.KanbanView.conflictRecovery"
                      : "features.tickets.KanbanView.failureRecovery",
                  )}
                </StatusMessage>
              ) : null}
            </div>
            <div className="ticket-dialog__actions">
              {editor.ticket ? (
                <button
                  className="button button--subtle"
                  disabled={saveState === "pending"}
                  onClick={() =>
                    void toggleArchive(editor.ticket!, editor.ticket!.archivedAt === null)
                  }
                >
                  {translate(
                    editor.ticket.archivedAt === null
                      ? "features.tickets.KanbanView.archive"
                      : "features.tickets.KanbanView.restore",
                  )}
                </button>
              ) : null}
              {editor.ticket ? (
                <button
                  className="button button--danger"
                  ref={deleteButtonRef}
                  disabled={saveState === "pending"}
                  onClick={() => setDeleteTarget(editor.ticket)}
                >
                  {translate("features.tickets.KanbanView.delete")}
                </button>
              ) : null}
              <span />
              <button
                className="button button--subtle"
                disabled={saveState === "pending"}
                onClick={() => closeEditor()}
              >
                {translate("features.tickets.KanbanView.cancel")}
              </button>
              <button
                className="button button--primary"
                disabled={!form.title.trim() || saveState === "pending"}
                onClick={() => void saveEditor()}
              >
                {translate("features.tickets.KanbanView.save")}
              </button>
            </div>
          </div>
        </div>
      ) : null}

      {deleteTarget ? (
        <div className="ticket-dialog-backdrop ticket-dialog-backdrop--confirm">
          <div
            className="ticket-confirm"
            role="alertdialog"
            aria-modal="true"
            aria-labelledby="ticket-delete-title"
            ref={confirmRef}
          >
            <h2 id="ticket-delete-title">
              {translate("features.tickets.KanbanView.deleteTitle", [deleteTarget.title])}
            </h2>
            <ul>
              <li>{translate("features.tickets.KanbanView.deleteLocal")}</li>
              <li>
                {translate("features.tickets.KanbanView.deletePlanningImpact", [
                  planningByTicket.get(deleteTarget.id)?.scheduleCount ?? 0,
                  planningByTicket.get(deleteTarget.id)?.futurePlannedMinutes ?? 0,
                ])}
              </li>
              <li>{translate("features.tickets.KanbanView.deleteScheduleImpact")}</li>
              <li>{translate("features.tickets.KanbanView.deleteGoogleImpact")}</li>
              <li>{translate("features.tickets.KanbanView.deleteUndoImpact")}</li>
            </ul>
            <div className="button-row">
              <button
                className="button button--subtle"
                autoFocus
                onClick={() => {
                  setDeleteTarget(null);
                  requestAnimationFrame(() => deleteButtonRef.current?.focus());
                }}
              >
                {translate("features.tickets.KanbanView.cancel")}
              </button>
              <button className="button button--danger" onClick={() => void confirmDelete()}>
                {translate("features.tickets.KanbanView.confirmDelete")}
              </button>
            </div>
          </div>
        </div>
      ) : null}
    </main>
  );
}

function FilterSelect({
  label,
  value,
  options,
  onChange,
}: {
  label: string;
  value: string;
  options: [string, string][];
  onChange: (value: string) => void;
}) {
  return (
    <label>
      <span>{label}</span>
      <select value={value} onChange={(event) => onChange(event.target.value)}>
        {options.map(([optionValue, optionLabel]) => (
          <option key={optionValue} value={optionValue}>
            {optionLabel}
          </option>
        ))}
      </select>
    </label>
  );
}

function TicketCard({
  ticket,
  draggable,
  dragging,
  onOpen,
  onDragStart,
  onDragEnd,
  onDragMove,
  onDropAtPoint,
  onMove,
}: {
  ticket: Ticket;
  draggable: boolean;
  dragging: boolean;
  onOpen: (opener: HTMLElement) => void;
  onDragStart: () => void;
  onDragEnd: () => void;
  onDragMove: (clientX: number) => void;
  onDropAtPoint: (clientX: number, clientY: number) => void;
  onMove: (direction: "left" | "right" | "up" | "down") => void;
}) {
  const moveHintId = `ticket-move-hint-${ticket.id}`;
  const metadataId = `ticket-metadata-${ticket.id}`;
  const mouseDragRef = useRef<{
    startX: number;
    startY: number;
    active: boolean;
  } | null>(null);
  const cleanupMouseDragRef = useRef<(() => void) | null>(null);
  const suppressClickRef = useRef(false);
  const suppressClickTimerRef = useRef<number | null>(null);

  useEffect(() => {
    if (dragging || !mouseDragRef.current?.active) return;
    cleanupMouseDragRef.current?.();
  }, [dragging]);

  useEffect(
    () => () => {
      cleanupMouseDragRef.current?.();
      if (suppressClickTimerRef.current !== null) {
        window.clearTimeout(suppressClickTimerRef.current);
      }
    },
    [],
  );

  return (
    <article
      className="ticket-card"
      role="listitem"
      data-ticket-id={ticket.id}
      data-priority={ticket.priority}
      data-dragging={dragging ? "true" : "false"}
    >
      <button
        className="ticket-card__open"
        onClick={(event) => {
          if (suppressClickRef.current) {
            suppressClickRef.current = false;
            event.preventDefault();
            return;
          }
          onOpen(event.currentTarget);
        }}
        aria-label={translate("features.tickets.KanbanView.openTicket", [ticket.title])}
        aria-describedby={`${metadataId}${draggable ? ` ${moveHintId}` : ""}`}
        aria-keyshortcuts={draggable ? "ArrowLeft ArrowRight ArrowUp ArrowDown" : undefined}
        title={draggable ? translate("features.tickets.KanbanView.moveHint") : undefined}
        onMouseDown={(event) => {
          if (!draggable || event.button !== 0) return;
          cleanupMouseDragRef.current?.();
          const mouseDrag = {
            startX: event.clientX,
            startY: event.clientY,
            active: false,
          };
          mouseDragRef.current = mouseDrag;
          const cleanupMouseDrag = () => {
            window.removeEventListener("mousemove", handleMouseMove);
            window.removeEventListener("mouseup", handleMouseUp);
            window.removeEventListener("blur", handleWindowBlur);
            mouseDragRef.current = null;
            cleanupMouseDragRef.current = null;
          };
          const handleMouseMove = (moveEvent: MouseEvent) => {
            if (!mouseDrag.active) {
              const distance = Math.hypot(
                moveEvent.clientX - mouseDrag.startX,
                moveEvent.clientY - mouseDrag.startY,
              );
              if (distance < 6) return;
              mouseDrag.active = true;
              onDragStart();
            }
            moveEvent.preventDefault();
            onDragMove(moveEvent.clientX);
          };
          const handleMouseUp = (upEvent: MouseEvent) => {
            const wasActive = mouseDrag.active;
            cleanupMouseDrag();
            if (!wasActive) return;
            upEvent.preventDefault();
            suppressClickRef.current = true;
            suppressClickTimerRef.current = window.setTimeout(() => {
              suppressClickRef.current = false;
              suppressClickTimerRef.current = null;
            }, 0);
            onDropAtPoint(upEvent.clientX, upEvent.clientY);
          };
          const handleWindowBlur = () => {
            const wasActive = mouseDrag.active;
            cleanupMouseDrag();
            if (wasActive) onDragEnd();
          };
          cleanupMouseDragRef.current = cleanupMouseDrag;
          window.addEventListener("mousemove", handleMouseMove);
          window.addEventListener("mouseup", handleMouseUp);
          window.addEventListener("blur", handleWindowBlur);
        }}
        onKeyDown={(event) => {
          if (event.altKey || event.ctrlKey || event.metaKey || event.shiftKey || event.repeat)
            return;
          if (!draggable) return;
          const direction = {
            ArrowLeft: "left",
            ArrowRight: "right",
            ArrowUp: "up",
            ArrowDown: "down",
          }[event.key] as "left" | "right" | "up" | "down" | undefined;
          if (!direction) return;
          event.preventDefault();
          event.stopPropagation();
          onMove(direction);
        }}
      >
        <strong>{ticket.title}</strong>
        <span className="ticket-card__meta">
          <span className="ticket-card__priority">
            {translate("features.tickets.KanbanView.priorityValue", [
              priorityLabel(ticket.priority),
            ])}
          </span>
          {ticket.tags.map((tag) => (
            <span className="ticket-card__tag" key={tag.id}>
              {tag.name}
            </span>
          ))}
        </span>
        <span className="sr-only" id={metadataId}>
          {translate("features.tickets.KanbanView.priorityValue", [priorityLabel(ticket.priority)])}
          {ticket.tags.length > 0
            ? ` ${ticket.tags
                .map((tag) => translate("features.tickets.KanbanView.tagValue", [tag.name]))
                .join("、")}`
            : ""}
        </span>
        {draggable ? (
          <span className="sr-only" id={moveHintId}>
            {translate("features.tickets.KanbanView.moveHint")}
          </span>
        ) : null}
      </button>
    </article>
  );
}
