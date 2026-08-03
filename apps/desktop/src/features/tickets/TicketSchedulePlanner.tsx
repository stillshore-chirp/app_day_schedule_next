import { useEffect, useMemo, useState } from "react";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import type { Ticket } from "../../shared/contracts";
import { appLocale, translate } from "../../shared/i18n/messages";
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
  const [focusState, setFocusState] = useState<"idle" | "starting" | "started">("idle");
  const [taskAction, setTaskAction] = useState<"idle" | "saving">("idle");
  const [taskMessage, setTaskMessage] = useState("");
  const [taskDeleteChoice, setTaskDeleteChoice] = useState<"detach" | "delete" | null>(null);
  const linksQuery = useQuery({
    queryKey: ["ticket-schedules", ticket.id],
    queryFn: () => client.ticketSchedules(ticket.id),
  });
  const summaryQuery = useQuery({
    queryKey: ["ticket-planning-summary", ticket.id],
    queryFn: async () => (await client.ticketPlanningSummaries([ticket.id]))[0],
  });
  const focusHistoryQuery = useQuery({
    queryKey: ["ticket-focus-history", ticket.id],
    queryFn: () => client.ticketFocusHistory(ticket.id, 20),
  });
  const googleConnectionQuery = useQuery({
    queryKey: ["google-connection"],
    queryFn: () => client.googleConnection(),
  });
  const googleTaskStatusQuery = useQuery({
    queryKey: ["ticket-google-task-status", ticket.id],
    queryFn: async () => (await client.ticketGoogleTaskStatuses([ticket.id]))[0],
  });
  useEffect(() => {
    setDuration(ticket.estimateMinutes === null ? "" : String(ticket.estimateMinutes));
  }, [ticket.id, ticket.estimateMinutes]);
  const durationMinutes = Number(duration);
  const canSave =
    localStart.length > 0 &&
    Number.isInteger(durationMinutes) &&
    durationMinutes >= 1 &&
    durationMinutes <= 1_440 &&
    (resolution?.kind !== "ambiguous" || foldChoice !== null);

  const nextLabel = useMemo(() => {
    const next = summaryQuery.data?.nextScheduledAt;
    return next
      ? new Date(next).toLocaleString(appLocale)
      : translate("features.tickets.TicketSchedulePlanner.001");
  }, [summaryQuery.data?.nextScheduledAt]);

  async function inspectTime() {
    setError("");
    const next = await client.resolveLocalTime(localStart, timezoneId);
    setResolution(next);
    setFoldChoice(null);
    if (next.kind === "gap") {
      setError(translate("features.tickets.TicketSchedulePlanner.002"));
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
          : translate("features.tickets.TicketSchedulePlanner.003"),
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
      setError(translate("features.tickets.TicketSchedulePlanner.004"));
    }
  }

  async function startFocus(scheduleId: string, reopen: boolean) {
    setFocusState("starting");
    setError("");
    try {
      const currentFocus = await client.currentFocus();
      if (currentFocus.phase !== "idle") {
        throw new AppClientError({
          code: "focus_active",
          message: translate("features.tickets.TicketSchedulePlanner.037"),
          recovery: translate("features.tickets.TicketSchedulePlanner.038"),
          retryable: true,
          diagnosticId: null,
        });
      }
      if (reopen) {
        await client.reopenTicket(crypto.randomUUID(), ticket.id, ticket.version);
        await queryClient.invalidateQueries({ queryKey: ["tickets"] });
      }
      await client.focusCommand("start", scheduleId);
      await Promise.all([
        queryClient.invalidateQueries({ queryKey: ["ticket-focus-history", ticket.id] }),
        queryClient.invalidateQueries({ queryKey: ["ticket-planning-summary", ticket.id] }),
        queryClient.invalidateQueries({ queryKey: ["ticket-planning-summaries"] }),
      ]);
      setFocusState("started");
    } catch (caught) {
      setFocusState("idle");
      setError(
        caught instanceof AppClientError
          ? `${caught.detail.message} ${caught.detail.recovery}`
          : translate("features.tickets.TicketSchedulePlanner.021"),
      );
    }
  }

  async function updateGoogleTaskTarget(taskListId: string | null, deleteRemote = false) {
    setTaskAction("saving");
    setError("");
    setTaskMessage("");
    try {
      await client.updateTicketGoogleTaskTarget({
        ticketId: ticket.id,
        taskListId,
        deleteRemote,
        operationId: crypto.randomUUID(),
      });
      await Promise.all([
        queryClient.invalidateQueries({ queryKey: ["ticket-google-task-status", ticket.id] }),
        queryClient.invalidateQueries({ queryKey: ["google-connection"] }),
      ]);
      setTaskDeleteChoice(null);
      setTaskMessage(
        taskListId
          ? "Google Tasks同期先を保存しました。反映状態はこの欄で確認できます。"
          : deleteRemote
            ? "Google側Taskの削除を反映待ちにしました。Local Ticketは保持されています。"
            : "Google Tasks同期を解除しました。Local TicketとGoogle側Taskは保持されています。",
      );
    } catch (caught) {
      setError(
        caught instanceof AppClientError
          ? `${caught.detail.message} ${caught.detail.recovery}`
          : "Google Tasks同期先を変更できませんでした。",
      );
    } finally {
      setTaskAction("idle");
    }
  }

  return (
    <section className="ticket-planner" aria-labelledby={`ticket-planner-${ticket.id}`}>
      <div className="ticket-planner__heading">
        <div>
          <h3 id={`ticket-planner-${ticket.id}`}>
            {translate("features.tickets.TicketSchedulePlanner.005")}
          </h3>
          <p>{translate("features.tickets.TicketSchedulePlanner.006")}</p>
        </div>
        <p className="ticket-planner__summary" aria-live="polite">
          {translate("features.tickets.TicketSchedulePlanner.007", [
            summaryQuery.data?.scheduleCount ?? 0,
            summaryQuery.data?.futurePlannedMinutes ?? 0,
            summaryQuery.data?.totalPlannedMinutes ?? 0,
            nextLabel,
          ])}
        </p>
      </div>
      <dl className="ticket-focus-metrics">
        <div>
          <dt>{translate("features.tickets.TicketSchedulePlanner.022")}</dt>
          <dd>
            {summaryQuery.data?.estimateMinutes ??
              translate("features.tickets.TicketSchedulePlanner.023")}
          </dd>
        </div>
        <div>
          <dt>{translate("features.tickets.TicketSchedulePlanner.024")}</dt>
          <dd>{Math.round((summaryQuery.data?.actualFocusSeconds ?? 0) / 60)}</dd>
        </div>
        <div>
          <dt>{translate("features.tickets.TicketSchedulePlanner.025")}</dt>
          <dd>
            {summaryQuery.data?.remainingMinutes ??
              translate("features.tickets.TicketSchedulePlanner.023")}
          </dd>
        </div>
        <div>
          <dt>{translate("features.tickets.TicketSchedulePlanner.026")}</dt>
          <dd>
            {summaryQuery.data?.varianceMinutes ??
              translate("features.tickets.TicketSchedulePlanner.023")}
          </dd>
        </div>
      </dl>
      <p className="field-help">{translate("features.tickets.TicketSchedulePlanner.027")}</p>
      <section className="ticket-google-task" aria-labelledby={`ticket-google-task-${ticket.id}`}>
        <div className="ticket-planner__heading">
          <div>
            <h4 id={`ticket-google-task-${ticket.id}`}>Google Tasks</h4>
            <p>タイトル・説明・日付・完了・親子・Listだけを同期します。</p>
          </div>
          <span className="state-chip" data-state={googleTaskStatusQuery.data?.state ?? "loading"}>
            {ticketGoogleTaskStateLabel(googleTaskStatusQuery.data?.state)}
          </span>
        </div>
        {!googleConnectionQuery.data?.tasks.scopeGranted ? (
          <StatusMessage tone="warning" title="Google Tasksの再同意が必要です">
            設定でCalendar +
            Tasksをまとめて再同意してください。現在のCalendar接続は成功まで保持されます。
          </StatusMessage>
        ) : !googleConnectionQuery.data.tasks.enabled ? (
          <StatusMessage title="Google Tasks同期は無効です">
            設定でTasks同期を有効にしてから、このTicketの同期先を選んでください。
          </StatusMessage>
        ) : (
          <>
            <label>
              同期先Task List
              <select
                value={googleTaskStatusQuery.data?.taskListId ?? ""}
                disabled={taskAction === "saving"}
                onChange={(event) =>
                  void updateGoogleTaskTarget(event.target.value.length ? event.target.value : null)
                }
              >
                {googleTaskStatusQuery.data?.taskListId ? null : (
                  <option value="">同期先を選択</option>
                )}
                {googleConnectionQuery.data.tasks.taskLists
                  .filter((list) => list.selected && list.syncState !== "unavailable")
                  .map((list) => (
                    <option key={list.id} value={list.id}>
                      {list.displayName}
                    </option>
                  ))}
              </select>
            </label>
            <p className="field-help">
              priority・見積・tags・Schedule・Focus実績はLocal専用で、Google notesへ埋め込みません。
            </p>
            {googleTaskStatusQuery.data?.taskListId ? (
              taskDeleteChoice ? (
                <StatusMessage
                  tone="warning"
                  title={
                    taskDeleteChoice === "delete"
                      ? "Google Tasksからも削除しますか？"
                      : "同期だけを解除しますか？"
                  }
                >
                  {taskDeleteChoice === "delete"
                    ? "Local Ticketは削除せず、Google側のTaskだけを明示的に削除します。失敗時はOutboxで再試行します。"
                    : "Local TicketとLocal専用項目はすべて保持されます。Google側のTaskは残ります。"}
                  <span className="button-row">
                    <button
                      className={
                        taskDeleteChoice === "delete"
                          ? "button button--danger"
                          : "button button--primary"
                      }
                      type="button"
                      disabled={taskAction === "saving"}
                      onClick={() =>
                        void updateGoogleTaskTarget(null, taskDeleteChoice === "delete")
                      }
                    >
                      この操作を実行
                    </button>
                    <button
                      className="button"
                      type="button"
                      onClick={() => setTaskDeleteChoice(null)}
                    >
                      取消
                    </button>
                  </span>
                </StatusMessage>
              ) : (
                <div className="button-row">
                  <button
                    className="button"
                    type="button"
                    onClick={() => setTaskDeleteChoice("detach")}
                  >
                    同期を解除してLocalに残す
                  </button>
                  <button
                    className="button button--danger-outline"
                    type="button"
                    onClick={() => setTaskDeleteChoice("delete")}
                  >
                    Google Tasksからも削除
                  </button>
                </div>
              )
            ) : null}
          </>
        )}
      </section>
      {taskMessage ? (
        <p className="success-text" role="status">
          {taskMessage}
        </p>
      ) : null}
      <div className="ticket-planner__form">
        <label>
          {translate("features.tickets.TicketSchedulePlanner.008")}
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
          <p className="field-help">{translate("features.tickets.TicketSchedulePlanner.009")}</p>
        ) : null}
        <label>
          {translate("features.tickets.TicketSchedulePlanner.010")}
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
          {state === "saving"
            ? translate("features.tickets.TicketSchedulePlanner.011")
            : translate("features.tickets.TicketSchedulePlanner.012")}
        </button>
      </div>
      {resolution?.kind === "ambiguous" ? (
        <fieldset className="ticket-planner__fold">
          <legend>{translate("features.tickets.TicketSchedulePlanner.013")}</legend>
          {resolution.candidates.map((candidate, index) => (
            <label key={candidate}>
              <input
                type="radio"
                name={`ticket-fold-${ticket.id}`}
                checked={foldChoice === index}
                onChange={() => setFoldChoice(index as 0 | 1)}
              />
              {translate(
                index === 0
                  ? "features.tickets.TicketSchedulePlanner.014"
                  : "features.tickets.TicketSchedulePlanner.015",
                [new Date(candidate).toISOString()],
              )}
            </label>
          ))}
        </fieldset>
      ) : null}
      {error ? (
        <StatusMessage
          tone="danger"
          title={translate("features.tickets.TicketSchedulePlanner.016")}
        >
          {error}
        </StatusMessage>
      ) : null}
      {state === "saved" ? (
        <p className="success-text" role="status">
          {translate("features.tickets.TicketSchedulePlanner.017")}
        </p>
      ) : null}
      <p className="field-help">{translate("features.tickets.TicketSchedulePlanner.018")}</p>
      <ul
        className="ticket-planner__links"
        aria-label={translate("features.tickets.TicketSchedulePlanner.019")}
      >
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
              {translate("features.tickets.TicketSchedulePlanner.020")}
            </button>
            {ticket.completedAt === null ? (
              <button
                className="button button--subtle"
                type="button"
                disabled={focusState === "starting"}
                onClick={() => void startFocus(link.schedule.id, false)}
              >
                {translate("features.tickets.TicketSchedulePlanner.028")}
              </button>
            ) : (
              <span className="ticket-planner__focus-actions">
                <button
                  className="button button--subtle"
                  type="button"
                  disabled={focusState === "starting"}
                  onClick={() => void startFocus(link.schedule.id, false)}
                >
                  {translate("features.tickets.TicketSchedulePlanner.029")}
                </button>
                <button
                  className="button button--subtle"
                  type="button"
                  disabled={focusState === "starting"}
                  onClick={() => void startFocus(link.schedule.id, true)}
                >
                  {translate("features.tickets.TicketSchedulePlanner.030")}
                </button>
              </span>
            )}
          </li>
        ))}
      </ul>
      {focusState === "started" ? (
        <p className="success-text" role="status">
          {translate("features.tickets.TicketSchedulePlanner.031")}
        </p>
      ) : null}
      <section aria-labelledby={`ticket-focus-history-${ticket.id}`}>
        <h4 id={`ticket-focus-history-${ticket.id}`}>
          {translate("features.tickets.TicketSchedulePlanner.032")}
        </h4>
        {focusHistoryQuery.data?.length ? (
          <ol className="ticket-focus-history">
            {focusHistoryQuery.data.map((item) => (
              <li key={item.sessionId}>
                <time>{new Date(item.startedAt).toLocaleString(appLocale)}</time>
                <span>
                  {translate("features.tickets.TicketSchedulePlanner.033", [
                    Math.round(item.workSeconds / 60),
                  ])}
                </span>
                <span>
                  {item.endedAt
                    ? translate("features.tickets.TicketSchedulePlanner.034")
                    : translate("features.tickets.TicketSchedulePlanner.035")}
                </span>
              </li>
            ))}
          </ol>
        ) : (
          <p>{translate("features.tickets.TicketSchedulePlanner.036")}</p>
        )}
      </section>
    </section>
  );
}

function ticketGoogleTaskStateLabel(
  state: Awaited<ReturnType<AppClient["ticketGoogleTaskStatuses"]>>[number]["state"] | undefined,
): string {
  if (!state) return "確認中";
  return {
    not_connected: "未接続",
    scope_missing: "再同意が必要",
    disabled: "無効",
    never: "未同期",
    syncing: "同期中",
    synced: "同期済み",
    pending: "反映待ち",
    offline: "オフライン",
    retry_scheduled: "再試行待ち",
    conflict: "競合あり",
    auth_required: "再認証が必要",
    unsupported: "未対応操作",
    validation_required: "入力確認が必要",
  }[state];
}
