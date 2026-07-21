import { useCallback, useEffect, useState } from "react";
import type { Stopwatch, StopwatchCommand } from "../../shared/contracts";
import { translate } from "../../shared/i18n/messages";
import { AppClientError, type AppClient } from "../../shared/ipc/client";
import { StatusMessage } from "../../shared/ui/StatusMessage";
import { ViewTitle } from "../views/CalendarViews";

const EMPTY_STOPWATCH: Stopwatch = { status: "idle", elapsedSeconds: 0, version: 0 };

export function StopwatchView({ client }: { client: AppClient }) {
  const [stopwatch, setStopwatch] = useState<Stopwatch>(EMPTY_STOPWATCH);
  const [loading, setLoading] = useState(true);
  const [loadError, setLoadError] = useState(false);
  const [actionError, setActionError] = useState<string | null>(null);
  const [announcement, setAnnouncement] = useState("");
  const [busy, setBusy] = useState(false);

  const load = useCallback(
    async (showLoading = false) => {
      if (showLoading) setLoading(true);
      try {
        setStopwatch(await client.stopwatch());
        setLoadError(false);
      } catch {
        setLoadError(true);
      } finally {
        if (showLoading) setLoading(false);
      }
    },
    [client],
  );

  useEffect(() => {
    void load(true);
  }, [load]);

  useEffect(() => {
    const interval = window.setInterval(() => {
      if (document.visibilityState === "hidden") return;
      void client
        .stopwatch()
        .then(setStopwatch)
        .catch(() => undefined);
    }, 1_000);
    return () => window.clearInterval(interval);
  }, [client]);

  const runCommand = async (command: StopwatchCommand) => {
    setBusy(true);
    setActionError(null);
    try {
      setStopwatch(await client.stopwatchCommand(stopwatch.version, command));
      setAnnouncement(translate("features.stopwatch.StopwatchView.008"));
    } catch (error) {
      setActionError(errorMessage(error));
    } finally {
      setBusy(false);
    }
  };

  if (loading) {
    return (
      <main className="secondary-view stopwatch-view">
        <p role="status">{translate("features.stopwatch.StopwatchView.004")}</p>
      </main>
    );
  }

  return (
    <main className="secondary-view stopwatch-view">
      <ViewTitle
        eyebrow={translate("features.stopwatch.StopwatchView.001")}
        title={translate("features.timers.TimersView.044")}
        description={translate("features.stopwatch.StopwatchView.002")}
      />
      {loadError ? (
        <StatusMessage
          tone="danger"
          title={translate("features.stopwatch.StopwatchView.005")}
          action={
            <button className="button" type="button" onClick={() => void load(true)}>
              {translate("features.stopwatch.StopwatchView.007")}
            </button>
          }
        >
          {translate("features.stopwatch.StopwatchView.006")}
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

      <section
        className="timer-panel stopwatch-card stopwatch-view__panel"
        aria-labelledby="stopwatch-title"
      >
        <span className="eyebrow">{translate("features.timers.TimersView.043")}</span>
        <h2 id="stopwatch-title">{translate("features.timers.TimersView.044")}</h2>
        <p>{translate("features.timers.TimersView.045")}</p>
        <output aria-label={translate("features.timers.TimersView.046")}>
          {formatClock(stopwatch.elapsedSeconds)}
        </output>
        <span className="timer-status" data-status={stopwatch.status}>
          {stopwatchStatusLabel(stopwatch.status)}
        </span>
        <div className="button-row">
          {stopwatch.status === "idle" ? (
            <button
              className="button button--primary"
              disabled={busy}
              type="button"
              onClick={() => void runCommand("start")}
            >
              {translate("features.timers.TimersView.047")}
            </button>
          ) : null}
          {stopwatch.status === "running" ? (
            <button
              className="button button--primary"
              disabled={busy}
              type="button"
              onClick={() => void runCommand("pause")}
            >
              {translate("features.timers.TimersView.048")}
            </button>
          ) : null}
          {stopwatch.status === "paused" ? (
            <button
              className="button button--primary"
              disabled={busy}
              type="button"
              onClick={() => void runCommand("resume")}
            >
              {translate("features.timers.TimersView.049")}
            </button>
          ) : null}
          {stopwatch.status !== "idle" || stopwatch.elapsedSeconds > 0 ? (
            <button
              className="button button--subtle"
              disabled={busy}
              type="button"
              onClick={() => void runCommand("reset")}
            >
              {translate("features.timers.TimersView.050")}
            </button>
          ) : null}
        </div>
      </section>
    </main>
  );
}

function formatClock(totalSeconds: number): string {
  const hours = Math.floor(totalSeconds / 3_600);
  const minutes = Math.floor((totalSeconds % 3_600) / 60);
  const seconds = totalSeconds % 60;
  return `${String(hours).padStart(2, "0")}:${String(minutes).padStart(2, "0")}:${String(seconds).padStart(2, "0")}`;
}

function stopwatchStatusLabel(status: Stopwatch["status"]): string {
  return {
    idle: translate("features.timers.TimersView.020"),
    running: translate("features.timers.TimersView.051"),
    paused: translate("features.timers.TimersView.022"),
  }[status];
}

function errorMessage(error: unknown): string {
  if (error instanceof AppClientError) {
    return `${error.detail.message} ${error.detail.recovery}`;
  }
  return translate("features.timers.TimersView.071");
}
