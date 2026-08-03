import { useMemo, useState } from "react";
import { useQuery } from "@tanstack/react-query";
import type { Ticket } from "../../shared/contracts";
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
  const date = `${selectedDate.getFullYear()}-${String(selectedDate.getMonth() + 1).padStart(2, "0")}-${String(selectedDate.getDate()).padStart(2, "0")}`;
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
          <strong id="unplaced-ticket-title">未配置チケット</strong>
          <small>今日以降の予定がないチケット</small>
        </span>
        <span>
          {tickets.length}件 {open ? "▲" : "▼"}
        </span>
      </button>
      {open ? (
        <div id="unplaced-ticket-content" className="unplaced-ticket-drawer__content">
          <p>
            チケットをタイムラインへドラッグすると仮配置になります。キーボードではチケットを選び、日時を入力してください。
          </p>
          <label className="unplaced-ticket-filter">
            表示対象
            <select
              value={filter}
              onChange={(event) => setFilter(event.target.value as typeof filter)}
            >
              <option value="recommended">Next・進行中・今日までの期限</option>
              <option value="next">Next</option>
              <option value="in_progress">In Progress</option>
              <option value="due">今日が期限・期限超過</option>
              <option value="all">すべての未配置</option>
            </select>
          </label>
          {tickets.length === 0 ? (
            <p>未配置のチケットはありません。</p>
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
                          ? "見積未設定・日時入力で配置"
                          : `見積 ${ticket.estimateMinutes}分`}
                      </span>
                    </button>
                  </li>
                );
              })}
            </ul>
          )}
          {selected ? (
            <div className="unplaced-ticket-form">
              <p>
                <strong>{selected.title}</strong> を予定に入れる
              </p>
              <label>
                日付
                <input type="date" value={date} readOnly />
              </label>
              <label>
                開始
                <input type="time" value={time} onChange={(event) => setTime(event.target.value)} />
              </label>
              <label>
                所要時間（分）
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
                {saving ? "保存中…" : "予定を作成"}
              </button>
              <button
                className="button button--subtle"
                type="button"
                onClick={() => setSelectedId("")}
              >
                取消
              </button>
            </div>
          ) : null}
        </div>
      ) : null}
    </section>
  );
}
