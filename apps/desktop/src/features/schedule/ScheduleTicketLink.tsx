import { useState } from "react";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import type { Schedule } from "../../shared/contracts";
import { AppClientError, type AppClient } from "../../shared/ipc/client";
import { StatusMessage } from "../../shared/ui/StatusMessage";

export function ScheduleTicketLink({
  client,
  schedule,
  onOpenTickets,
}: {
  client: AppClient;
  schedule: Schedule;
  onOpenTickets?: () => void;
}) {
  const queryClient = useQueryClient();
  const [ticketId, setTicketId] = useState("");
  const [replace, setReplace] = useState(false);
  const [error, setError] = useState("");
  const linkQuery = useQuery({
    queryKey: ["schedule-ticket-link", schedule.id],
    queryFn: () => client.scheduleTicketLink(schedule.id),
  });
  const ticketsQuery = useQuery({
    queryKey: ["tickets", "schedule-link"],
    queryFn: () => client.listTickets({ limit: 1_000 }),
  });
  const current = linkQuery.data;
  const selected = ticketsQuery.data?.items.find((ticket) => ticket.id === ticketId);

  async function refresh() {
    await Promise.all([
      queryClient.invalidateQueries({ queryKey: ["schedule-ticket-link", schedule.id] }),
      queryClient.invalidateQueries({ queryKey: ["ticket-schedules"] }),
      queryClient.invalidateQueries({ queryKey: ["ticket-planning-summary"] }),
    ]);
  }

  async function link() {
    if (!selected) return;
    setError("");
    try {
      await client.linkTicketSchedule({
        operationId: crypto.randomUUID(),
        ticketId: selected.id,
        expectedTicketVersion: selected.version,
        scheduleId: schedule.id,
        expectedScheduleVersion: schedule.version,
        source: "schedule_editor",
        replaceExisting: replace,
      });
      setReplace(false);
      await refresh();
    } catch (caught) {
      setError(
        caught instanceof AppClientError
          ? `${caught.detail.message} ${caught.detail.recovery}`
          : "関連付けに失敗しました。予定とチケットを再読み込みし、付け替える場合は確認を選択してください。",
      );
    }
  }

  async function unlink() {
    if (!current) return;
    setError("");
    try {
      await client.unlinkTicketSchedule({
        operationId: crypto.randomUUID(),
        linkId: current.id,
        expectedLinkVersion: current.version,
      });
      await refresh();
    } catch (caught) {
      setError(
        caught instanceof AppClientError
          ? `${caught.detail.message} ${caught.detail.recovery}`
          : "関連解除に失敗しました。最新の関連を読み込んで再試行してください。",
      );
    }
  }

  return (
    <section className="schedule-ticket-link" aria-labelledby="schedule-ticket-link-title">
      <h3 id="schedule-ticket-link-title">チケットとの関連</h3>
      <p>タイトルや完了状態は連動しません。関連の変更は明示的に行います。</p>
      {current ? (
        <div className="schedule-ticket-link__current">
          <span>
            関連中: <strong>{current.ticketTitle}</strong>
          </span>
          <div>
            {onOpenTickets ? (
              <button className="button button--subtle" type="button" onClick={onOpenTickets}>
                チケット画面へ
              </button>
            ) : null}
            <button className="button button--subtle" type="button" onClick={() => void unlink()}>
              関連を解除
            </button>
          </div>
        </div>
      ) : (
        <p>この予定に関連するチケットはありません。</p>
      )}
      <div className="schedule-ticket-link__form">
        <label>
          チケット
          <select value={ticketId} onChange={(event) => setTicketId(event.target.value)}>
            <option value="">選択してください</option>
            {(ticketsQuery.data?.items ?? []).map((ticket) => (
              <option key={ticket.id} value={ticket.id}>
                {ticket.title}
              </option>
            ))}
          </select>
        </label>
        {current && selected && selected.id !== current.ticketId ? (
          <label className="schedule-ticket-link__replace">
            <input
              type="checkbox"
              checked={replace}
              onChange={(event) => setReplace(event.target.checked)}
            />
            「{current.ticketTitle}」から「{selected.title}」へ付け替える
          </label>
        ) : null}
        <button
          className="button"
          type="button"
          disabled={
            !selected || (Boolean(current) && selected?.id !== current?.ticketId && !replace)
          }
          onClick={() => void link()}
        >
          {current ? "関連を変更" : "関連付ける"}
        </button>
      </div>
      {error ? (
        <StatusMessage tone="danger" title="関連を変更できません">
          {error}
        </StatusMessage>
      ) : null}
    </section>
  );
}
