import { useCallback, useEffect, useId, useRef, useState } from "react";
import type { Timer, TimerCommand, TimerDraft, TimerSet } from "../../shared/contracts";
import { translate } from "../../shared/i18n/messages";
import { AppClientError, type AppClient } from "../../shared/ipc/client";
import { StatusMessage } from "../../shared/ui/StatusMessage";
import { ViewTitle } from "../views/CalendarViews";

interface DurationParts {
  hours: number;
  minutes: number;
  seconds: number;
}

export function TimersView({ client }: { client: AppClient }) {
  const [timers, setTimers] = useState<Timer[]>([]);
  const [timerSets, setTimerSets] = useState<TimerSet[]>([]);
  const [loading, setLoading] = useState(true);
  const [loadError, setLoadError] = useState(false);
  const [actionError, setActionError] = useState<string | null>(null);
  const [announcement, setAnnouncement] = useState("");
  const [busyKey, setBusyKey] = useState<string | null>(null);
  const [newLabel, setNewLabel] = useState("");
  const [newDuration, setNewDuration] = useState<DurationParts>({
    hours: 0,
    minutes: 5,
    seconds: 0,
  });
  const [newTimerError, setNewTimerError] = useState<string | null>(null);
  const [setName, setSetName] = useState("");
  const [setNameError, setSetNameError] = useState<string | null>(null);
  const [confirmSetDeleteId, setConfirmSetDeleteId] = useState<string | null>(null);
  const timerStatusRef = useRef(new Map<string, Timer["status"]>());

  const acceptTimers = useCallback((nextTimers: Timer[], announceCompletion: boolean) => {
    if (announceCompletion) {
      const completed = nextTimers.filter(
        (timer) =>
          timer.status === "completed" && timerStatusRef.current.get(timer.id) === "running",
      );
      if (completed.length > 0) {
        setAnnouncement(
          completed.length === 1 && completed[0]?.label
            ? `${completed[0].label}：${translate("features.timers.TimersView.078")}`
            : translate("features.timers.TimersView.081", [completed.length]),
        );
      }
    }
    timerStatusRef.current = new Map(nextTimers.map((timer) => [timer.id, timer.status]));
    setTimers(nextTimers);
  }, []);

  const load = useCallback(
    async (showLoading = false) => {
      if (showLoading) setLoading(true);
      try {
        const [nextTimers, nextSets] = await Promise.all([
          client.listTimers(),
          client.listTimerSets(),
        ]);
        acceptTimers(nextTimers, !showLoading);
        setTimerSets(nextSets);
        setLoadError(false);
      } catch {
        setLoadError(true);
      } finally {
        if (showLoading) setLoading(false);
      }
    },
    [acceptTimers, client],
  );

  useEffect(() => {
    void load(true);
  }, [load]);

  useEffect(() => {
    const interval = window.setInterval(() => {
      if (document.visibilityState === "hidden") return;
      void client
        .listTimers()
        .then((nextTimers) => {
          acceptTimers(nextTimers, true);
        })
        .catch(() => undefined);
    }, 1_000);
    return () => window.clearInterval(interval);
  }, [acceptTimers, client]);

  const runAction = async (key: string, success: string, action: () => Promise<unknown>) => {
    setBusyKey(key);
    setActionError(null);
    try {
      await action();
      await load();
      setAnnouncement(success);
    } catch (error) {
      setActionError(errorMessage(error));
    } finally {
      setBusyKey(null);
    }
  };

  const addTimer = async (event: React.FormEvent) => {
    event.preventDefault();
    const durationSeconds = partsToSeconds(newDuration);
    if (!isValidDuration(durationSeconds)) {
      setNewTimerError(translate("features.timers.TimersView.014"));
      return;
    }
    setNewTimerError(null);
    await runAction("new-timer", translate("features.timers.TimersView.017"), async () => {
      await client.createTimer({ label: newLabel, durationSeconds });
      setNewLabel("");
    });
  };

  const saveTimerSet = async (event: React.FormEvent) => {
    event.preventDefault();
    if (!setName.trim()) {
      setSetNameError(translate("features.timers.TimersView.073"));
      return;
    }
    setSetNameError(null);
    await runAction("new-set", translate("features.timers.TimersView.066"), async () => {
      await client.createTimerSet(setName);
      setSetName("");
    });
  };

  if (loading) {
    return (
      <main className="secondary-view timer-view">
        <p role="status">{translate("features.timers.TimersView.080")}</p>
      </main>
    );
  }

  return (
    <main className="secondary-view timer-view">
      <ViewTitle
        eyebrow={translate("features.timers.TimersView.001")}
        title={translate("features.timers.TimersView.002")}
        description={translate("features.timers.TimersView.003")}
      />
      {loadError ? (
        <StatusMessage
          tone="danger"
          title={translate("features.timers.TimersView.004")}
          action={
            <button className="button" type="button" onClick={() => void load(true)}>
              {translate("features.timers.TimersView.006")}
            </button>
          }
        >
          {translate("features.timers.TimersView.005")}
        </StatusMessage>
      ) : null}
      {actionError ? (
        <StatusMessage tone="danger" title={translate("features.timers.TimersView.070")}>
          {actionError}
        </StatusMessage>
      ) : null}
      <p className="sr-only" role="status" aria-live="polite">
        {announcement}
      </p>

      <div className="timer-workspace">
        <section className="timer-panel timer-panel--primary" aria-labelledby="timer-list-title">
          <header className="timer-panel__heading">
            <div>
              <span className="eyebrow">{translate("features.timers.TimersView.007")}</span>
              <h2 id="timer-list-title">{translate("features.timers.TimersView.002")}</h2>
              <p>{translate("features.timers.TimersView.008")}</p>
            </div>
          </header>

          <form className="timer-create-form" onSubmit={(event) => void addTimer(event)}>
            <label>
              {translate("features.timers.TimersView.009")}
              <input
                value={newLabel}
                maxLength={100}
                onChange={(event) => setNewLabel(event.target.value)}
                placeholder={translate("features.timers.TimersView.010")}
              />
            </label>
            <DurationInputs
              value={newDuration}
              onChange={setNewDuration}
              legend={translate("features.timers.TimersView.076")}
              error={newTimerError}
            />
            <button className="button button--primary" disabled={busyKey !== null} type="submit">
              {busyKey === "new-timer"
                ? translate("features.timers.TimersView.016")
                : translate("features.timers.TimersView.015")}
            </button>
          </form>

          {timers.length === 0 ? (
            <div className="timer-empty">
              <strong>{translate("features.timers.TimersView.018")}</strong>
              <p>{translate("features.timers.TimersView.019")}</p>
            </div>
          ) : (
            <div className="timer-list">
              {timers.map((timer, index) => (
                <TimerCard
                  key={timer.id}
                  timer={timer}
                  index={index}
                  busy={busyKey === `timer-${timer.id}`}
                  onSave={(draft) =>
                    runAction(
                      `timer-${timer.id}`,
                      translate("features.timers.TimersView.040"),
                      () => client.updateTimer(timer.id, timer.version, draft),
                    )
                  }
                  onCommand={(command) =>
                    runAction(
                      `timer-${timer.id}`,
                      translate("features.timers.TimersView.041"),
                      () => client.timerCommand(timer.id, timer.version, command),
                    )
                  }
                  onDelete={() =>
                    runAction(
                      `timer-${timer.id}`,
                      translate("features.timers.TimersView.042"),
                      () => client.deleteTimer(timer.id, timer.version),
                    )
                  }
                />
              ))}
            </div>
          )}
        </section>

        <div className="timer-side-column">
          <section className="timer-panel" aria-labelledby="timer-set-title">
            <span className="eyebrow">{translate("features.timers.TimersView.052")}</span>
            <h2 id="timer-set-title">{translate("features.timers.TimersView.053")}</h2>
            <p>{translate("features.timers.TimersView.054")}</p>
            <form className="timer-set-form" onSubmit={(event) => void saveTimerSet(event)}>
              <label>
                {translate("features.timers.TimersView.055")}
                <input
                  value={setName}
                  maxLength={100}
                  onChange={(event) => setSetName(event.target.value)}
                  placeholder={translate("features.timers.TimersView.056")}
                  aria-describedby={setNameError ? "timer-set-name-error" : undefined}
                />
              </label>
              {setNameError ? (
                <small className="field-error" id="timer-set-name-error">
                  {setNameError}
                </small>
              ) : null}
              <button
                className="button"
                disabled={timers.length === 0 || busyKey !== null}
                type="submit"
              >
                {busyKey === "new-set"
                  ? translate("features.timers.TimersView.058")
                  : translate("features.timers.TimersView.057")}
              </button>
            </form>
            <p className="timer-set-note">{translate("features.timers.TimersView.074")}</p>
            {timerSets.length === 0 ? (
              <p className="timer-empty timer-empty--compact">
                {translate("features.timers.TimersView.059")}
              </p>
            ) : (
              <ul className="timer-set-list">
                {timerSets.map((set) => (
                  <li key={set.id}>
                    <div>
                      <strong>{set.name}</strong>
                      <small>
                        {translate("features.timers.TimersView.060", [set.items.length])}
                      </small>
                    </div>
                    <p>{set.items.map(timerSetItemLabel).join(" ・ ")}</p>
                    <div className="button-row">
                      <button
                        className="button button--subtle"
                        disabled={busyKey !== null}
                        type="button"
                        onClick={() =>
                          void runAction(
                            `set-${set.id}`,
                            translate("features.timers.TimersView.067", [set.items.length]),
                            () => client.applyTimerSet(set.id, set.version),
                          )
                        }
                      >
                        {translate("features.timers.TimersView.061")}
                      </button>
                      <button
                        className="button button--danger-text"
                        disabled={busyKey !== null}
                        type="button"
                        onClick={() => setConfirmSetDeleteId(set.id)}
                      >
                        {translate("features.timers.TimersView.063")}
                      </button>
                    </div>
                    {confirmSetDeleteId === set.id ? (
                      <div className="inline-confirm" role="alert">
                        <strong>{translate("features.timers.TimersView.064", [set.name])}</strong>
                        <p>{translate("features.timers.TimersView.075")}</p>
                        <div className="button-row">
                          <button
                            className="button button--danger"
                            type="button"
                            onClick={() => {
                              setConfirmSetDeleteId(null);
                              void runAction(
                                `set-${set.id}`,
                                translate("features.timers.TimersView.065"),
                                () => client.deleteTimerSet(set.id, set.version),
                              );
                            }}
                          >
                            {translate("features.timers.TimersView.063")}
                          </button>
                          <button
                            className="button"
                            type="button"
                            onClick={() => setConfirmSetDeleteId(null)}
                          >
                            {translate("features.timers.TimersView.038")}
                          </button>
                        </div>
                      </div>
                    ) : null}
                  </li>
                ))}
              </ul>
            )}
          </section>

          <aside className="timer-lifecycle-note">
            <strong>{translate("features.timers.TimersView.068")}</strong>
            <p>{translate("features.timers.TimersView.069")}</p>
          </aside>
        </div>
      </div>
    </main>
  );
}

function TimerCard({
  timer,
  index,
  busy,
  onSave,
  onCommand,
  onDelete,
}: {
  timer: Timer;
  index: number;
  busy: boolean;
  onSave: (draft: TimerDraft) => Promise<unknown>;
  onCommand: (command: TimerCommand) => Promise<unknown>;
  onDelete: () => Promise<unknown>;
}) {
  const titleId = useId();
  const [label, setLabel] = useState(timer.label);
  const [duration, setDuration] = useState(() => secondsToParts(timer.durationSeconds));
  const [durationError, setDurationError] = useState<string | null>(null);
  const [confirmDelete, setConfirmDelete] = useState(false);
  const editable = timer.status === "idle" || timer.status === "completed";
  const displayLabel = timer.label || translate("features.timers.TimersView.072", [index + 1]);

  useEffect(() => {
    setLabel(timer.label);
    setDuration(secondsToParts(timer.durationSeconds));
  }, [timer.durationSeconds, timer.label, timer.version]);

  const save = async () => {
    const durationSeconds = partsToSeconds(duration);
    if (!isValidDuration(durationSeconds)) {
      setDurationError(translate("features.timers.TimersView.014"));
      return;
    }
    setDurationError(null);
    await onSave({ label, durationSeconds });
  };

  return (
    <article className="timer-card" data-status={timer.status} aria-labelledby={titleId}>
      <header>
        <div>
          <span className="timer-status" data-status={timer.status}>
            {timerStatusLabel(timer.status)}
          </span>
          <h3 id={titleId}>{displayLabel}</h3>
        </div>
        <output aria-label={translate("features.timers.TimersView.024", [displayLabel])}>
          {formatClock(timer.remainingSeconds)}
        </output>
      </header>
      <progress
        max={timer.durationSeconds}
        value={timer.elapsedSeconds}
        aria-label={translate("features.timers.TimersView.025", [displayLabel])}
      />

      <div className="timer-card__editor" aria-disabled={!editable}>
        <label>
          {translate("features.timers.TimersView.026")}
          <input
            value={label}
            maxLength={100}
            disabled={!editable || busy}
            onChange={(event) => setLabel(event.target.value)}
          />
        </label>
        <DurationInputs
          value={duration}
          onChange={setDuration}
          disabled={!editable || busy}
          legend={translate("features.timers.TimersView.027")}
          error={durationError}
        />
        {!editable ? <small>{translate("features.timers.TimersView.077")}</small> : null}
      </div>

      <div className="button-row timer-card__actions">
        {editable ? (
          <button className="button" disabled={busy} type="button" onClick={() => void save()}>
            {translate("features.timers.TimersView.028")}
          </button>
        ) : null}
        {timer.status === "idle" || timer.status === "completed" ? (
          <button
            className="button button--primary"
            disabled={busy}
            type="button"
            onClick={() => void onCommand("start")}
          >
            {timer.status === "completed"
              ? translate("features.timers.TimersView.033")
              : translate("features.timers.TimersView.030")}
          </button>
        ) : null}
        {timer.status === "running" ? (
          <button
            className="button button--primary"
            disabled={busy}
            type="button"
            onClick={() => void onCommand("pause")}
          >
            {translate("features.timers.TimersView.031")}
          </button>
        ) : null}
        {timer.status === "paused" ? (
          <button
            className="button button--primary"
            disabled={busy}
            type="button"
            onClick={() => void onCommand("resume")}
          >
            {translate("features.timers.TimersView.032")}
          </button>
        ) : null}
        {timer.status !== "idle" ? (
          <button
            className="button button--subtle"
            disabled={busy}
            type="button"
            onClick={() => void onCommand("reset")}
          >
            {translate("features.timers.TimersView.034")}
          </button>
        ) : null}
        <button
          className="button button--danger-text"
          disabled={busy}
          type="button"
          onClick={() => setConfirmDelete(true)}
        >
          {translate("features.timers.TimersView.035")}
        </button>
      </div>

      {confirmDelete ? (
        <div className="inline-confirm" role="alert">
          <strong>{translate("features.timers.TimersView.036", [displayLabel])}</strong>
          <p>{translate("features.timers.TimersView.037")}</p>
          <div className="button-row">
            <button
              className="button button--danger"
              disabled={busy}
              type="button"
              onClick={() => void onDelete()}
            >
              {translate("features.timers.TimersView.039")}
            </button>
            <button className="button" type="button" onClick={() => setConfirmDelete(false)}>
              {translate("features.timers.TimersView.038")}
            </button>
          </div>
        </div>
      ) : null}
    </article>
  );
}

function DurationInputs({
  value,
  onChange,
  legend,
  error,
  disabled = false,
}: {
  value: DurationParts;
  onChange: (value: DurationParts) => void;
  legend: string;
  error?: string | null;
  disabled?: boolean;
}) {
  const errorId = useId();
  return (
    <fieldset className="duration-inputs" aria-describedby={error ? errorId : undefined}>
      <legend>{legend}</legend>
      <label>
        <span>{translate("features.timers.TimersView.011")}</span>
        <input
          type="number"
          inputMode="numeric"
          min={0}
          max={168}
          disabled={disabled}
          value={value.hours}
          onChange={(event) => onChange({ ...value, hours: numericValue(event.target.value) })}
        />
      </label>
      <label>
        <span>{translate("features.timers.TimersView.012")}</span>
        <input
          type="number"
          inputMode="numeric"
          min={0}
          max={59}
          disabled={disabled}
          value={value.minutes}
          onChange={(event) => onChange({ ...value, minutes: numericValue(event.target.value) })}
        />
      </label>
      <label>
        <span>{translate("features.timers.TimersView.013")}</span>
        <input
          type="number"
          inputMode="numeric"
          min={0}
          max={59}
          disabled={disabled}
          value={value.seconds}
          onChange={(event) => onChange({ ...value, seconds: numericValue(event.target.value) })}
        />
      </label>
      {error ? (
        <small className="field-error" id={errorId}>
          {error}
        </small>
      ) : null}
    </fieldset>
  );
}

function numericValue(value: string): number {
  const parsed = Number(value);
  return Number.isFinite(parsed) ? Math.max(0, Math.trunc(parsed)) : 0;
}

function partsToSeconds(parts: DurationParts): number {
  return parts.hours * 3_600 + parts.minutes * 60 + parts.seconds;
}

function secondsToParts(total: number): DurationParts {
  return {
    hours: Math.floor(total / 3_600),
    minutes: Math.floor((total % 3_600) / 60),
    seconds: total % 60,
  };
}

function isValidDuration(total: number): boolean {
  return Number.isInteger(total) && total >= 1 && total <= 604_800;
}

function formatClock(totalSeconds: number, alwaysHours = false): string {
  const hours = Math.floor(totalSeconds / 3_600);
  const minutes = Math.floor((totalSeconds % 3_600) / 60);
  const seconds = totalSeconds % 60;
  if (alwaysHours || hours > 0) {
    return `${String(hours).padStart(2, "0")}:${String(minutes).padStart(2, "0")}:${String(seconds).padStart(2, "0")}`;
  }
  return `${String(minutes).padStart(2, "0")}:${String(seconds).padStart(2, "0")}`;
}

function timerStatusLabel(status: Timer["status"]): string {
  return {
    idle: translate("features.timers.TimersView.020"),
    running: translate("features.timers.TimersView.021"),
    paused: translate("features.timers.TimersView.022"),
    completed: translate("features.timers.TimersView.023"),
  }[status];
}

function timerSetItemLabel(item: TimerSet["items"][number]): string {
  const label = item.label || translate("features.timers.TimersView.079");
  return `${label} ${formatClock(item.durationSeconds)}`;
}

function errorMessage(error: unknown): string {
  if (error instanceof AppClientError) {
    return `${error.detail.message} ${error.detail.recovery}`;
  }
  return translate("features.timers.TimersView.071");
}
