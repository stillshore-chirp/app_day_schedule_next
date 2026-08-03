import { useState } from "react";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import type { Schedule } from "../../shared/contracts";
import { translate } from "../../shared/i18n/messages";
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
          : translate("features.schedule.ScheduleTicketLink.001"),
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
          : translate("features.schedule.ScheduleTicketLink.002"),
      );
    }
  }

  return (
    <section className="schedule-ticket-link" aria-labelledby="schedule-ticket-link-title">
      <h3 id="schedule-ticket-link-title">
        {translate("features.schedule.ScheduleTicketLink.003")}
      </h3>
      <p>{translate("features.schedule.ScheduleTicketLink.004")}</p>
      {current ? (
        <div className="schedule-ticket-link__current">
          <span>
            {translate("features.schedule.ScheduleTicketLink.005")}{" "}
            <strong>{current.ticketTitle}</strong>
          </span>
          <div>
            {onOpenTickets ? (
              <button className="button button--subtle" type="button" onClick={onOpenTickets}>
                {translate("features.schedule.ScheduleTicketLink.006")}
              </button>
            ) : null}
            <button className="button button--subtle" type="button" onClick={() => void unlink()}>
              {translate("features.schedule.ScheduleTicketLink.007")}
            </button>
          </div>
        </div>
      ) : (
        <p>{translate("features.schedule.ScheduleTicketLink.008")}</p>
      )}
      <div className="schedule-ticket-link__form">
        <label>
          {translate("features.schedule.ScheduleTicketLink.009")}
          <select value={ticketId} onChange={(event) => setTicketId(event.target.value)}>
            <option value="">{translate("features.schedule.ScheduleTicketLink.010")}</option>
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
            {translate("features.schedule.ScheduleTicketLink.011", [
              current.ticketTitle,
              selected.title,
            ])}
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
          {current
            ? translate("features.schedule.ScheduleTicketLink.012")
            : translate("features.schedule.ScheduleTicketLink.013")}
        </button>
      </div>
      {error ? (
        <StatusMessage tone="danger" title={translate("features.schedule.ScheduleTicketLink.014")}>
          {error}
        </StatusMessage>
      ) : null}
    </section>
  );
}
