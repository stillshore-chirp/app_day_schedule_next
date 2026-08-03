import { useMemo, useState } from "react";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import type { Ticket } from "../../shared/contracts";
import { appLocale } from "../../shared/i18n/messages";
import { AppClientError, type AppClient } from "../../shared/ipc/client";
import { StatusMessage } from "../../shared/ui/StatusMessage";

interface TicketSchedulePlannerProps {
  client: AppClient;
  ticket: Ticket;
  today: string;
  timezoneId: string;
}

export function TicketSchedulePlanner({
  client,
  ticket,
  today,
  timezoneId,
}: TicketSchedulePlannerProps) {
  const queryClient = useQueryClient();
  const [localStart, setLocalStart] = useState(`${today}T09:00`);
  const [duration, setDuration] = useState(
    ticket.estimateMinutes === null ? "" : String(ticket.estimateMinutes),
  );
  const [foldChoice, setFoldChoice] = useState<0 | 1 | null>(null);
  const [resolution, setResolution] = useState<Awaited<
    ReturnType<AppClient["resolveLocalTime"]>
  > | null>(null);
  const [state, setState] = useState<"idle" | "saving" | "saved" | "error">("idle");
  const [error, setError] = useState("");
  const linksQuery = useQuery({
    queryKey: ["ticket-schedules", ticket.id],
    queryFn: () => client.ticketSchedules(ticket.id),
  });
  const summaryQuery = useQuery({
    queryKey: ["ticket-planning-summary", ticket.id],
    queryFn: async () => (await client.ticketPlanningSummaries([ticket.id]))[0],
  });
  const durationMinutes = Number(duration);
  const canSave =
    localStart.length > 0 &&
    Number.isInteger(durationMinutes) &&
    durationMinutes >= 1 &&
    durationMinutes <= 1_440 &&
    (resolution?.kind !== "ambiguous" || foldChoice !== null);

  const nextLabel = useMemo(() => {
    const next = summaryQuery.data?.nextScheduledAt;
    return next ? new Date(next).toLocaleString(appLocale) : "次の予定なし";
  }, [summaryQuery.data?.nextScheduledAt]);

  async function inspectTime() {
    setError("");
    const next = await client.resolveLocalTime(localStart, timezoneId);
    setResolution(next);
    setFoldChoice(null);
    if (next.kind === "gap") {
      setError("夏時間の切り替えで存在しない時刻です。前後の時刻を選んでください。");
    }
    return next;
  }

  async function assign() {
    setState("saving");
    setError("");
    try {
      const checked = resolution ?? (await inspectTime());
      if (checked.kind === "gap" || (checked.kind === "ambiguous" && foldChoice === null)) {
        setState("idle");
        return;
      }
      await client.assignTicketSchedule({
        operationId: crypto.randomUUID(),
        ticketId: ticket.id,
        expectedTicketVersion: ticket.version,
        localStart,
        durationMinutes,
        timezoneId,
        offsetChoice: checked.kind === "ambiguous" ? foldChoice : null,
        source: "board",
      });
      await Promise.all([
        queryClient.invalidateQueries({ queryKey: ["ticket-schedules", ticket.id] }),
        queryClient.invalidateQueries({ queryKey: ["ticket-planning-summary", ticket.id] }),
        queryClient.invalidateQueries({ queryKey: ["schedules"] }),
      ]);
      setState("saved");
    } catch (caught) {
      setError(
        caught instanceof AppClientError
          ? `${caught.detail.message} ${caught.detail.recovery}`
          : "予定への割り当てに失敗しました。最新のチケットを読み込んで再試行してください。",
      );
      setState("error");
    }
  }

  async function unlink(linkId: string, expectedLinkVersion: number) {
    try {
      await client.unlinkTicketSchedule({
        operationId: crypto.randomUUID(),
        linkId,
        expectedLinkVersion,
      });
      await Promise.all([
        queryClient.invalidateQueries({ queryKey: ["ticket-schedules", ticket.id] }),
        queryClient.invalidateQueries({ queryKey: ["ticket-planning-summary", ticket.id] }),
      ]);
    } catch {
      setError("関連解除に失敗しました。最新の関連予定を読み込んで再試行してください。");
    }
  }

  return (
    <section className="ticket-planner" aria-labelledby={`ticket-planner-${ticket.id}`}>
      <div className="ticket-planner__heading">
        <div>
          <h3 id={`ticket-planner-${ticket.id}`}>予定へ割り当て</h3>
          <p>チケットは残したまま、実行する時間を複数確保できます。</p>
        </div>
        <p className="ticket-planner__summary" aria-live="polite">
          {summaryQuery.data?.scheduleCount ?? 0}件・今後
          {summaryQuery.data?.futurePlannedMinutes ?? 0}分・合計
          {summaryQuery.data?.totalPlannedMinutes ?? 0}分 / {nextLabel}
        </p>
      </div>
      <div className="ticket-planner__form">
        <label>
          開始
          <input
            type="datetime-local"
            value={localStart}
            onChange={(event) => {
              setLocalStart(event.target.value);
              setResolution(null);
              setFoldChoice(null);
            }}
          />
        </label>
        {ticket.estimateMinutes === null && duration === "" ? (
          <p className="field-help">見積未設定です。保存前に所要時間を入力してください。</p>
        ) : null}
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
          disabled={!canSave || state === "saving"}
          onClick={() => void assign()}
        >
          {state === "saving" ? "保存中…" : "新しい予定を作成"}
        </button>
      </div>
      {resolution?.kind === "ambiguous" ? (
        <fieldset className="ticket-planner__fold">
          <legend>この時刻は2回存在します。UTCオフセットを選択してください。</legend>
          {resolution.candidates.map((candidate, index) => (
            <label key={candidate}>
              <input
                type="radio"
                name={`ticket-fold-${ticket.id}`}
                checked={foldChoice === index}
                onChange={() => setFoldChoice(index as 0 | 1)}
              />
              {index === 0 ? "早い方" : "遅い方"}（{new Date(candidate).toISOString()}）
            </label>
          ))}
        </fieldset>
      ) : null}
      {error ? (
        <StatusMessage tone="danger" title="予定を保存できません">
          {error}
        </StatusMessage>
      ) : null}
      {state === "saved" ? (
        <p className="success-text" role="status">
          予定を作成し、チケットへ関連付けました。
        </p>
      ) : null}
      <p className="field-help">
        Focus実績との比較はIssue #35で対応します。ここでは予定時間だけを表示しています。
      </p>
      <ul className="ticket-planner__links" aria-label="関連予定">
        {(linksQuery.data ?? []).map((link) => (
          <li key={link.id}>
            <span>
              <strong>{link.schedule.title}</strong>{" "}
              {new Date(link.schedule.startUtc).toLocaleString(appLocale)}–
              {new Date(link.schedule.endUtc).toLocaleTimeString(appLocale, {
                hour: "2-digit",
                minute: "2-digit",
              })}
            </span>
            <button
              className="button button--subtle"
              type="button"
              onClick={() => void unlink(link.id, link.version)}
            >
              関連を解除
            </button>
          </li>
        ))}
      </ul>
    </section>
  );
}
