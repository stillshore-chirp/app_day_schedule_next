import { useMemo, useState } from "react";
import { useQuery } from "@tanstack/react-query";
import type { Ticket } from "../../shared/contracts";
import { translate } from "../../shared/i18n/messages";
import type { AppClient } from "../../shared/ipc/client";

export function UnplacedTicketDrawer({
  client,
  selectedDate,
  onAssign,
  onDragStart,
  onDragEnd,
}: {
  client: AppClient;
  selectedDate: Date;
  onAssign: (ticket: Ticket, localStart: string, durationMinutes: number) => Promise<void>;
  onDragStart: (ticket: Ticket, durationMinutes: number) => void;
  onDragEnd: () => void;
}) {
  const [open, setOpen] = useState(false);
  const [selectedId, setSelectedId] = useState("");
  const [time, setTime] = useState("09:00");
  const [duration, setDuration] = useState("30");
  const [saving, setSaving] = useState(false);
  const [filter, setFilter] = useState<"recommended" | "all" | "next" | "in_progress" | "due">(
    "recommended",
  );
  const boardQuery = useQuery({
    queryKey: ["ticket-board"],
    queryFn: () => client.ticketBoard(),
  });
  const ticketsQuery = useQuery({
    queryKey: ["tickets", "unplaced"],
    queryFn: () => client.listTickets({ limit: 1_000 }),
  });
  const ticketIds = (ticketsQuery.data?.items ?? []).map((ticket) => ticket.id);
  const summariesQuery = useQuery({
    queryKey: ["ticket-planning-summaries", ticketIds],
    queryFn: () => client.ticketPlanningSummaries(ticketIds),
    enabled: ticketIds.length > 0,
  });
  const summaries = useMemo(
    () => new Map((summariesQuery.data ?? []).map((summary) => [summary.ticketId, summary])),
    [summariesQuery.data],
  );
  const columnKinds = useMemo(
    () => new Map((boardQuery.data?.columns ?? []).map((column) => [column.id, column.kind])),
    [boardQuery.data?.columns],
  );
  const date = `${selectedDate.getFullYear()}-${String(selectedDate.getMonth() + 1).padStart(
    2,
    "0",
  )}-${String(selectedDate.getDate()).padStart(2, "0")}`;
  const tickets = useMemo(
    () =>
      (ticketsQuery.data?.items ?? []).filter((ticket) => {
        if (
          ticket.archivedAt !== null ||
          ticket.deletedAt !== null ||
          (summaries.get(ticket.id)?.futurePlannedMinutes ?? 0) !== 0
        )
          return false;
        const kind = columnKinds.get(ticket.columnId);
        const due = ticket.dueDate !== null && ticket.dueDate <= date;
        if (filter === "all") return true;
        if (filter === "next") return kind === "next";
        if (filter === "in_progress") return kind === "in_progress";
        if (filter === "due") return due;
        return kind === "next" || kind === "in_progress" || due;
      }),
    [columnKinds, date, filter, summaries, ticketsQuery.data?.items],
  );
  const selected = tickets.find((ticket) => ticket.id === selectedId) ?? null;
  const durationMinutes = Number(duration);

  async function assign() {
    if (
      !selected ||
      !Number.isInteger(durationMinutes) ||
      durationMinutes < 1 ||
      durationMinutes > 1_440
    )
      return;
    setSaving(true);
    try {
      await onAssign(selected, `${date}T${time}`, durationMinutes);
      setSelectedId("");
    } finally {
      setSaving(false);
    }
  }

  return (
    <section className="unplaced-ticket-drawer" aria-labelledby="unplaced-ticket-title">
      <button
        className="unplaced-ticket-drawer__toggle"
        type="button"
        aria-expanded={open}
        aria-controls="unplaced-ticket-content"
        onClick={() => setOpen((value) => !value)}
      >
        <span>
          <strong id="unplaced-ticket-title">
            {translate("features.schedule.UnplacedTicketDrawer.001")}
          </strong>
          <small>{translate("features.schedule.UnplacedTicketDrawer.002")}</small>
        </span>
        <span>
          {translate("features.schedule.UnplacedTicketDrawer.003", [
            tickets.length,
            open ? "▲" : "▼",
          ])}
        </span>
      </button>
      {open ? (
        <div id="unplaced-ticket-content" className="unplaced-ticket-drawer__content">
          <p>{translate("features.schedule.UnplacedTicketDrawer.004")}</p>
          <label className="unplaced-ticket-filter">
            {translate("features.schedule.UnplacedTicketDrawer.005")}
            <select
              value={filter}
              onChange={(event) => setFilter(event.target.value as typeof filter)}
            >
              <option value="recommended">
                {translate("features.schedule.UnplacedTicketDrawer.006")}
              </option>
              <option value="next">
                {translate("features.schedule.UnplacedTicketDrawer.007")}
              </option>
              <option value="in_progress">
                {translate("features.schedule.UnplacedTicketDrawer.008")}
              </option>
              <option value="due">{translate("features.schedule.UnplacedTicketDrawer.009")}</option>
              <option value="all">{translate("features.schedule.UnplacedTicketDrawer.010")}</option>
            </select>
          </label>
          {tickets.length === 0 ? (
            <p>{translate("features.schedule.UnplacedTicketDrawer.011")}</p>
          ) : (
            <ul className="unplaced-ticket-list">
              {tickets.map((ticket) => {
                const estimate = ticket.estimateMinutes;
                return (
                  <li key={ticket.id}>
                    <button
                      type="button"
                      draggable={estimate !== null}
                      aria-pressed={selectedId === ticket.id}
                      onDragStart={(event) => {
                        event.dataTransfer.effectAllowed = "copy";
                        event.dataTransfer.setData("text/plain", ticket.id);
                        if (estimate !== null) onDragStart(ticket, estimate);
                      }}
                      onDragEnd={onDragEnd}
                      onClick={() => {
                        setSelectedId(ticket.id);
                        setDuration(estimate === null ? "" : String(estimate));
                      }}
                    >
                      <strong>{ticket.title}</strong>
                      <span>
                        {ticket.estimateMinutes === null
                          ? translate("features.schedule.UnplacedTicketDrawer.012")
                          : translate("features.schedule.UnplacedTicketDrawer.013", [
                              ticket.estimateMinutes,
                            ])}
                      </span>
                    </button>
                  </li>
                );
              })}
            </ul>
          )}
          {selected ? (
            <div className="unplaced-ticket-form">
              <p>{translate("features.schedule.UnplacedTicketDrawer.014", [selected.title])}</p>
              <label>
                {translate("features.schedule.UnplacedTicketDrawer.015")}
                <input type="date" value={date} readOnly />
              </label>
              <label>
                {translate("features.schedule.UnplacedTicketDrawer.016")}
                <input type="time" value={time} onChange={(event) => setTime(event.target.value)} />
              </label>
              <label>
                {translate("features.schedule.UnplacedTicketDrawer.017")}
                <input
                  type="number"
                  min="1"
                  max="1440"
                  value={duration}
                  onChange={(event) => setDuration(event.target.value)}
                />
              </label>
              <button
                className="button button--primary"
                type="button"
                disabled={saving}
                onClick={() => void assign()}
              >
                {saving
                  ? translate("features.schedule.UnplacedTicketDrawer.018")
                  : translate("features.schedule.UnplacedTicketDrawer.019")}
              </button>
              <button
                className="button button--subtle"
                type="button"
                onClick={() => setSelectedId("")}
              >
                {translate("features.schedule.UnplacedTicketDrawer.020")}
              </button>
            </div>
          ) : null}
        </div>
      ) : null}
    </section>
  );
}
