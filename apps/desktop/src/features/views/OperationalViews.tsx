import { appLocale, translate } from "../../shared/i18n/messages";
import { useEffect, useState } from "react";
import { open, save } from "@tauri-apps/plugin-dialog";
import {
  isPermissionGranted,
  requestPermission,
  sendNotification,
} from "@tauri-apps/plugin-notification";
import type {
  Bootstrap,
  BackupRecord,
  FocusState,
  FocusHistoryReport,
  Schedule,
  GoogleConnection,
  ImportPreview,
  ImportResult,
  LegacyImportPreview,
  LegacyImportResult,
  NotificationLedgerItem,
  Settings,
  SyncConflictItem,
  SyncQueueItem,
  ConflictChoice,
} from "../../shared/contracts";
import { AppClientError, type AppClient, type DiagnosticsSnapshot } from "../../shared/ipc/client";
import { StatusMessage } from "../../shared/ui/StatusMessage";
import { ViewTitle } from "./CalendarViews";

function isCancelled(error: unknown): boolean {
  return error instanceof AppClientError && error.detail.code === "cancelled";
}

export function FocusView({ client, bootstrap }: { client: AppClient; bootstrap: Bootstrap }) {
  const [focus, setFocus] = useState<FocusState>(bootstrap.focus);
  const [busy, setBusy] = useState(false);
  const [now, setNow] = useState(() => new Date());
  const [linkedScheduleId, setLinkedScheduleId] = useState(bootstrap.focus.linkedScheduleId ?? "");
  const [schedules, setSchedules] = useState<Schedule[]>([]);
  const [history, setHistory] = useState<FocusHistoryReport | null>(null);
  const [loadError, setLoadError] = useState(false);
  useEffect(() => {
    const start = new Date();
    start.setHours(0, 0, 0, 0);
    const end = new Date(start);
    end.setDate(end.getDate() + 1);
    void Promise.all([
      client.listSchedules({
        startUtc: start.toISOString(),
        endUtc: end.toISOString(),
        limit: 500,
      }),
      client.focusHistoryToday(),
    ])
      .then(([page, report]) => {
        setSchedules(page.items);
        setHistory(report);
      })
      .catch(() => setLoadError(true));
  }, [client]);
  useEffect(() => {
    const id = window.setInterval(() => {
      setNow(new Date());
      void client
        .currentFocus()
        .then(setFocus)
        .catch(() => undefined);
    }, 1000);
    return () => window.clearInterval(id);
  }, [client]);
  const command = async (value: "start" | "pause" | "resume" | "stop" | "skip") => {
    setBusy(true);
    try {
      setFocus(
        await client.focusCommand(
          value,
          value === "start" && linkedScheduleId ? linkedScheduleId : undefined,
        ),
      );
      setHistory(await client.focusHistoryToday());
    } finally {
      setBusy(false);
    }
  };
  const remaining = focus.endsAt
    ? Math.max(0, Math.ceil((Date.parse(focus.endsAt) - now.getTime()) / 1000))
    : bootstrap.settings.focusWorkMinutes * 60;
  const minutes = Math.floor(remaining / 60);
  const seconds = remaining % 60;
  return (
    <main className="secondary-view focus-view">
      <ViewTitle
        eyebrow={translate("features.views.OperationalViews.001")}
        title={translate("features.views.OperationalViews.002")}
        description={translate("features.views.OperationalViews.003")}
      />
      {loadError ? (
        <StatusMessage tone="warning" title={translate("features.views.OperationalViews.004")}>
          {translate("features.views.OperationalViews.005")}
        </StatusMessage>
      ) : null}
      <section className="focus-card" aria-labelledby="focus-phase">
        <span className="eyebrow">{translate("features.views.OperationalViews.006")}</span>
        <h2 id="focus-phase">{focusLabel(focus.phase)}</h2>
        <output
          className="focus-time"
          aria-label={translate("features.views.OperationalViews.007", [minutes, seconds])}
        >
          {String(minutes).padStart(2, "0")}:{String(seconds).padStart(2, "0")}
        </output>
        <p>
          {translate("features.views.OperationalViews.008")}
          {focus.cycle + 1} {translate("features.views.OperationalViews.009")}
          {bootstrap.settings.focusWorkMinutes}
          {translate("features.views.OperationalViews.010")} {bootstrap.settings.focusBreakMinutes}
          {translate("features.views.OperationalViews.011")}
          {bootstrap.settings.focusLongBreakMinutes}
          {translate("features.views.OperationalViews.012")}
          {bootstrap.settings.focusLongBreakEvery}
          {translate("features.views.OperationalViews.013")}
        </p>
        {focus.phase === "idle" || focus.phase === "waiting_next" ? (
          <label className="focus-link">
            {translate("features.views.OperationalViews.014")}
            <select
              value={linkedScheduleId}
              onChange={(event) => setLinkedScheduleId(event.target.value)}
            >
              <option value="">{translate("features.views.OperationalViews.015")}</option>
              {schedules.map((schedule) => (
                <option key={`${schedule.id}-${schedule.startUtc}`} value={schedule.id}>
                  {`${formatFocusTime(schedule.startUtc)} ${schedule.title}`}
                </option>
              ))}
            </select>
          </label>
        ) : focus.linkedScheduleId ? (
          <p>
            {translate("features.views.OperationalViews.016")}{" "}
            <strong>
              {schedules.find((schedule) => schedule.id === focus.linkedScheduleId)?.title ??
                translate("features.views.OperationalViews.017")}
            </strong>
          </p>
        ) : null}
        <div className="button-row button-row--center">
          {focus.phase === "idle" || focus.phase === "waiting_next" ? (
            <button
              className="button button--primary"
              disabled={busy}
              onClick={() => void command("start")}
            >
              {translate("features.views.OperationalViews.018")}
            </button>
          ) : null}
          {focus.phase === "working" || focus.phase === "break" ? (
            <button className="button" disabled={busy} onClick={() => void command("pause")}>
              {translate("features.views.OperationalViews.019")}
            </button>
          ) : null}
          {focus.phase === "paused" ? (
            <button
              className="button button--primary"
              disabled={busy}
              onClick={() => void command("resume")}
            >
              {translate("features.views.OperationalViews.020")}
            </button>
          ) : null}
          {focus.phase === "working" ? (
            <button className="button" disabled={busy} onClick={() => void command("skip")}>
              {translate("features.views.OperationalViews.021")}
            </button>
          ) : null}
          {focus.phase !== "idle" ? (
            <button
              className="button button--danger-outline"
              disabled={busy}
              onClick={() => void command("stop")}
            >
              {translate("features.views.OperationalViews.022")}
            </button>
          ) : null}
        </div>
      </section>
      <section className="focus-history" aria-labelledby="focus-history-title">
        <div className="section-heading section-heading--compact">
          <h2 id="focus-history-title">{translate("features.views.OperationalViews.023")}</h2>
          <strong>
            {translate("features.views.OperationalViews.024")}
            {Math.floor((history?.workSeconds ?? 0) / 60)}
            {translate("features.views.OperationalViews.025")}
            {String((history?.workSeconds ?? 0) % 60).padStart(2, "0")}
            {translate("features.views.OperationalViews.026")}
          </strong>
        </div>
        {history?.entries.length ? (
          <ol>
            {history.entries.map((entry) => (
              <li key={entry.id}>
                <time>{formatFocusTime(entry.occurredAt)}</time>
                <span>{focusEventLabel(entry.event)}</span>
                {entry.elapsedSeconds > 0 ? (
                  <small>
                    {Math.round(entry.elapsedSeconds / 60)}
                    {translate("features.views.OperationalViews.027")}
                  </small>
                ) : null}
              </li>
            ))}
          </ol>
        ) : (
          <p>{translate("features.views.OperationalViews.028")}</p>
        )}
      </section>
      <StatusMessage title={translate("features.views.OperationalViews.029")}>
        {translate("features.views.OperationalViews.030")}
      </StatusMessage>
    </main>
  );
}

function formatFocusTime(value: string): string {
  return new Intl.DateTimeFormat(appLocale, {
    hour: "2-digit",
    minute: "2-digit",
  }).format(new Date(value));
}

function focusEventLabel(event: FocusHistoryReport["entries"][number]["event"]): string {
  return {
    start: translate("features.views.OperationalViews.031"),
    pause: translate("features.views.OperationalViews.032"),
    resume: translate("features.views.OperationalViews.033"),
    work_end: translate("features.views.OperationalViews.034"),
    break_end: translate("features.views.OperationalViews.035"),
    stop: translate("features.views.OperationalViews.036"),
    skip: translate("features.views.OperationalViews.037"),
  }[event];
}

export function SettingsView({ client, bootstrap }: { client: AppClient; bootstrap: Bootstrap }) {
  const [settings, setSettings] = useState<Settings>(bootstrap.settings);
  const [saved, setSaved] = useState(false);
  const [resetState, setResetState] = useState<"loaded" | "failed" | null>(null);
  const [busy, setBusy] = useState(false);
  const [windowPreferences, setWindowPreferences] = useState(bootstrap.windowPreferences);
  const [notificationPermission, setNotificationPermission] = useState<
    "unknown" | "granted" | "denied" | "unavailable"
  >("unknown");
  useEffect(() => {
    if (!("__TAURI_INTERNALS__" in window)) {
      setNotificationPermission("unavailable");
      return;
    }
    void isPermissionGranted()
      .then((granted) => setNotificationPermission(granted ? "granted" : "unknown"))
      .catch(() => setNotificationPermission("unavailable"));
  }, []);

  const askNotificationPermission = async () => {
    try {
      const result = await requestPermission();
      setNotificationPermission(result === "granted" ? "granted" : "denied");
    } catch {
      setNotificationPermission("unavailable");
    }
  };

  const testNotification = () => {
    sendNotification({
      title: "Day Schedule Next",
      body: translate("features.views.OperationalViews.038"),
    });
  };
  const save = async () => {
    setBusy(true);
    try {
      setSettings(await client.updateSettings(settings));
      setSaved(true);
      setResetState(null);
    } finally {
      setBusy(false);
    }
  };
  const resetDefaults = async () => {
    setBusy(true);
    setSaved(false);
    setResetState(null);
    try {
      const defaults = await client.defaultSettings();
      setSettings(defaults);
      setResetState("loaded");
    } catch {
      setResetState("failed");
    } finally {
      setBusy(false);
    }
  };
  return (
    <main className="secondary-view settings-view">
      <ViewTitle
        eyebrow={translate("features.views.OperationalViews.039")}
        title={translate("features.views.OperationalViews.040")}
        description={translate("features.views.OperationalViews.041")}
      />
      {saved ? (
        <StatusMessage tone="success" title={translate("features.views.OperationalViews.042")} />
      ) : null}
      {resetState === "loaded" ? (
        <StatusMessage tone="success" title={translate("settings.states.defaultsLoaded")} />
      ) : null}
      {resetState === "failed" ? (
        <StatusMessage tone="warning" title={translate("settings.states.defaultsFailed")} />
      ) : null}
      <div className="settings-grid">
        <section>
          <h2>{translate("features.views.OperationalViews.043")}</h2>
          <label>
            {translate("features.views.OperationalViews.044")}
            <select
              value={settings.theme}
              onChange={(event) =>
                setSettings({ ...settings, theme: event.target.value as Settings["theme"] })
              }
            >
              <option value="system">{translate("features.views.OperationalViews.045")}</option>
              <option value="light">{translate("features.views.OperationalViews.046")}</option>
              <option value="dark">{translate("features.views.OperationalViews.047")}</option>
            </select>
          </label>
          <label>
            {translate("features.views.OperationalViews.048")}
            <select
              value={settings.snapMinutes}
              onChange={(event) =>
                setSettings({
                  ...settings,
                  snapMinutes: Number(event.target.value) as Settings["snapMinutes"],
                })
              }
            >
              {[1, 5, 10, 15, 30].map((value) => (
                <option key={value} value={value}>
                  {value}
                  {translate("features.views.OperationalViews.049")}
                </option>
              ))}
            </select>
          </label>
          <p className="field-help">{translate("features.views.OperationalViews.050")}</p>
        </section>
        <section>
          <h2>{translate("features.views.OperationalViews.051")}</h2>
          <label>
            <input
              type="radio"
              name="close"
              checked={settings.closeBehavior === "tray"}
              onChange={() => setSettings({ ...settings, closeBehavior: "tray" })}
            />{" "}
            {translate("features.views.OperationalViews.052")}
          </label>
          <label>
            <input
              type="radio"
              name="close"
              checked={settings.closeBehavior === "quit"}
              onChange={() => setSettings({ ...settings, closeBehavior: "quit" })}
            />{" "}
            {translate("features.views.OperationalViews.053")}
          </label>
          <p className="field-help">{translate("features.views.OperationalViews.054")}</p>
          <fieldset className="window-preferences">
            <legend>{translate("features.views.OperationalViews.055")}</legend>
            <label>
              <input
                type="checkbox"
                checked={windowPreferences.mainAlwaysOnTop}
                onChange={(event) => {
                  const value = event.target.checked;
                  setWindowPreferences({ ...windowPreferences, mainAlwaysOnTop: value });
                  void client.setWindowAlwaysOnTop("main", value);
                }}
              />
              {translate("features.views.OperationalViews.056")}
            </label>
            <label>
              <input
                type="checkbox"
                checked={windowPreferences.compactAlwaysOnTop}
                onChange={(event) => {
                  const value = event.target.checked;
                  setWindowPreferences({ ...windowPreferences, compactAlwaysOnTop: value });
                  void client.setWindowAlwaysOnTop("compact", value);
                }}
              />
              {translate("features.views.OperationalViews.057")}
            </label>
          </fieldset>
        </section>
        <section>
          <h2>{translate("features.views.OperationalViews.058")}</h2>
          <p className="permission-state" data-state={notificationPermission}>
            {translate("features.views.OperationalViews.059")}
            {permissionLabel(notificationPermission)}
          </p>
          <div className="button-row">
            {notificationPermission !== "granted" ? (
              <button
                className="button"
                type="button"
                onClick={() => void askNotificationPermission()}
              >
                {translate("features.views.OperationalViews.060")}
              </button>
            ) : (
              <button className="button" type="button" onClick={testNotification}>
                {translate("features.views.OperationalViews.061")}
              </button>
            )}
          </div>
          {notificationPermission === "denied" ? (
            <StatusMessage tone="warning" title={translate("features.views.OperationalViews.062")}>
              {translate("features.views.OperationalViews.063")}
            </StatusMessage>
          ) : null}
          <label>
            <input
              type="checkbox"
              checked={settings.scheduleNotificationsEnabled}
              onChange={(event) =>
                setSettings({ ...settings, scheduleNotificationsEnabled: event.target.checked })
              }
            />{" "}
            {translate("features.views.OperationalViews.064")}
          </label>
          <label>
            <input
              type="checkbox"
              checked={settings.osNotificationsEnabled}
              onChange={(event) =>
                setSettings({ ...settings, osNotificationsEnabled: event.target.checked })
              }
            />{" "}
            {translate("features.views.OperationalViews.065")}
          </label>
          <label>
            <input
              type="checkbox"
              checked={settings.soundNotificationsEnabled}
              onChange={(event) =>
                setSettings({ ...settings, soundNotificationsEnabled: event.target.checked })
              }
            />{" "}
            {translate("features.views.OperationalViews.066")}
          </label>
          <label>
            {translate("features.views.OperationalViews.067")}
            <input
              type="number"
              min={0}
              max={120}
              value={settings.notificationGraceMinutes}
              onChange={(event) =>
                setSettings({ ...settings, notificationGraceMinutes: Number(event.target.value) })
              }
            />
          </label>
          <label>
            {translate("features.views.OperationalViews.068")}
            <input
              type="number"
              min={0}
              max={20}
              value={settings.notificationMaxReplay}
              onChange={(event) =>
                setSettings({ ...settings, notificationMaxReplay: Number(event.target.value) })
              }
            />
          </label>
        </section>
        <section>
          <h2>Focus</h2>
          <label>
            {translate("features.views.OperationalViews.069")}
            <input
              type="number"
              min={1}
              max={180}
              value={settings.focusWorkMinutes}
              onChange={(event) =>
                setSettings({ ...settings, focusWorkMinutes: Number(event.target.value) })
              }
            />
          </label>
          <label>
            {translate("features.views.OperationalViews.070")}
            <input
              type="number"
              min={1}
              max={180}
              value={settings.focusBreakMinutes}
              onChange={(event) =>
                setSettings({ ...settings, focusBreakMinutes: Number(event.target.value) })
              }
            />
          </label>
          <label>
            {translate("features.views.OperationalViews.071")}
            <input
              type="number"
              min={1}
              max={180}
              value={settings.focusLongBreakMinutes}
              onChange={(event) =>
                setSettings({ ...settings, focusLongBreakMinutes: Number(event.target.value) })
              }
            />
          </label>
          <label>
            {translate("features.views.OperationalViews.072")}
            <input
              type="number"
              min={1}
              max={12}
              value={settings.focusLongBreakEvery}
              onChange={(event) =>
                setSettings({ ...settings, focusLongBreakEvery: Number(event.target.value) })
              }
            />
          </label>
          <label>
            <input
              type="checkbox"
              checked={settings.focusAutoStart}
              onChange={(event) =>
                setSettings({ ...settings, focusAutoStart: event.target.checked })
              }
            />{" "}
            {translate("features.views.OperationalViews.073")}
          </label>
          <label>
            <input
              type="checkbox"
              checked={settings.focusNotificationsEnabled}
              onChange={(event) =>
                setSettings({ ...settings, focusNotificationsEnabled: event.target.checked })
              }
            />{" "}
            {translate("features.views.OperationalViews.074")}
          </label>
        </section>
      </div>
      <div className="button-row">
        <button
          className="button button--primary"
          type="button"
          disabled={busy}
          onClick={() => void save()}
        >
          {busy
            ? translate("features.views.OperationalViews.075")
            : translate("features.views.OperationalViews.076")}
        </button>
        <button
          className="button"
          type="button"
          disabled={busy}
          onClick={() => void resetDefaults()}
        >
          {translate("settings.actions.resetDefaults")}
        </button>
      </div>
      <p className="field-help">{translate("settings.help.resetDefaults")}</p>
      <GooglePanel client={client} />
      <DataTransferPanel client={client} />
    </main>
  );
}

function GooglePanel({ client }: { client: AppClient }) {
  const [connection, setConnection] = useState<GoogleConnection | null>(null);
  const [busy, setBusy] = useState(false);
  const [message, setMessage] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [disconnectMode, setDisconnectMode] = useState<"keep_local" | "delete_mapped_local" | null>(
    null,
  );

  const refresh = async () => setConnection(await client.googleConnection());

  useEffect(() => {
    let active = true;
    const read = () =>
      client
        .googleConnection()
        .then((value) => active && setConnection(value))
        .catch(() => active && setError(translate("features.views.OperationalViews.077")));
    void read();
    const timer = window.setInterval(() => {
      if (connection?.state === "connecting") void read();
    }, 2_000);
    return () => {
      active = false;
      window.clearInterval(timer);
    };
  }, [client, connection?.state]);

  const importConfig = async () => {
    setBusy(true);
    setError(null);
    try {
      const path = await open({
        title: translate("features.views.OperationalViews.078"),
        multiple: false,
        directory: false,
        filters: [{ name: "Google OAuth JSON", extensions: ["json"] }],
      });
      if (typeof path !== "string") return;
      const configured = await client.importGoogleOAuthConfig(path);
      await refresh();
      setMessage(translate("features.views.OperationalViews.079", [configured.clientIdHint]));
    } catch {
      setError(translate("features.views.OperationalViews.080"));
    } finally {
      setBusy(false);
    }
  };

  const connect = async () => {
    setBusy(true);
    setError(null);
    try {
      const result = await client.beginGoogleOAuth();
      setMessage(
        result.openedInSystemBrowser
          ? translate("features.views.OperationalViews.081")
          : translate("features.views.OperationalViews.082"),
      );
      await refresh();
    } catch {
      setError(translate("features.views.OperationalViews.083"));
    } finally {
      setBusy(false);
    }
  };

  const updateCalendar = async (id: string, selected: boolean, defaultWriteTarget: boolean) => {
    setBusy(true);
    try {
      await client.updateGoogleCalendar(id, selected, defaultWriteTarget);
      await refresh();
    } catch {
      setError(translate("features.views.OperationalViews.084"));
    } finally {
      setBusy(false);
    }
  };

  const disconnect = async (mode: "keep_local" | "delete_mapped_local") => {
    setBusy(true);
    try {
      const affected = await client.disconnectGoogle(mode);
      await refresh();
      setMessage(
        mode === "keep_local"
          ? translate("features.views.OperationalViews.085", [affected])
          : translate("features.views.OperationalViews.086", [affected]),
      );
      setDisconnectMode(null);
    } catch {
      setError(translate("features.views.OperationalViews.087"));
    } finally {
      setBusy(false);
    }
  };

  return (
    <section className="google-panel" aria-labelledby="google-panel-title">
      <div className="section-heading-row">
        <div>
          <h2 id="google-panel-title">Google Calendar</h2>
          <p>{translate("features.views.OperationalViews.088")}</p>
        </div>
        <span className="state-chip" data-state={connection?.state ?? "loading"}>
          {googleStateLabel(connection?.state)}
        </span>
      </div>
      {message ? <StatusMessage tone="success" title={message} /> : null}
      {error ? <StatusMessage tone="danger" title={error} /> : null}
      {connection?.state === "feature_disabled" ? (
        <StatusMessage title={translate("features.views.OperationalViews.089")}>
          {translate("features.views.OperationalViews.090")}
        </StatusMessage>
      ) : null}
      {!connection?.configured && connection?.state !== "feature_disabled" ? (
        <div className="button-row">
          <button className="button" disabled={busy} onClick={() => void importConfig()}>
            {translate("features.views.OperationalViews.091")}
          </button>
        </div>
      ) : null}
      {connection?.configured && !connection.accountId ? (
        <div className="button-row">
          <button className="button button--primary" disabled={busy} onClick={() => void connect()}>
            {translate("features.views.OperationalViews.092")}
          </button>
          <button className="button" disabled={busy} onClick={() => void importConfig()}>
            {translate("features.views.OperationalViews.093")}
          </button>
        </div>
      ) : null}
      {connection?.state === "connecting" ? (
        <StatusMessage title={translate("features.views.OperationalViews.094")}>
          {translate("features.views.OperationalViews.095")}
        </StatusMessage>
      ) : null}
      {connection?.accountId ? (
        <>
          <p>
            {translate("features.views.OperationalViews.096")}
            <strong>{connection.displayLabel ?? "Google Calendar"}</strong>
          </p>
          <div
            className="google-calendar-list"
            role="group"
            aria-label={translate("features.views.OperationalViews.097")}
          >
            {connection.calendars.map((calendar) => (
              <article key={calendar.id}>
                <i style={{ backgroundColor: calendar.color }} aria-hidden="true" />
                <span>
                  <strong>{calendar.displayName}</strong>
                  <small>
                    {calendar.timezoneId}・
                    {calendar.writable
                      ? translate("features.views.OperationalViews.098")
                      : translate("features.views.OperationalViews.099")}
                  </small>
                </span>
                <label>
                  <input
                    type="checkbox"
                    checked={calendar.selected}
                    disabled={busy}
                    onChange={(event) =>
                      void updateCalendar(
                        calendar.id,
                        event.target.checked,
                        event.target.checked && calendar.defaultWriteTarget,
                      )
                    }
                  />
                  {translate("features.views.OperationalViews.100")}
                </label>
                <label>
                  <input
                    type="radio"
                    name="default-google-calendar"
                    checked={calendar.defaultWriteTarget}
                    disabled={busy || !calendar.writable}
                    onChange={() => void updateCalendar(calendar.id, true, true)}
                  />
                  {translate("features.views.OperationalViews.101")}
                </label>
              </article>
            ))}
          </div>
          {disconnectMode ? (
            <div className="disconnect-confirm">
              <StatusMessage
                tone="warning"
                title={translate("features.views.OperationalViews.102")}
              >
                {translate("features.views.OperationalViews.103")}
                {connection.mappedScheduleCount}
                {translate("features.views.OperationalViews.104")}
                {disconnectMode === "keep_local"
                  ? translate("features.views.OperationalViews.105")
                  : translate("features.views.OperationalViews.106")}
              </StatusMessage>
              <div className="button-row">
                <button
                  className="button button--danger"
                  disabled={busy}
                  onClick={() => void disconnect(disconnectMode)}
                >
                  {translate("features.views.OperationalViews.107")}
                </button>
                <button className="button" onClick={() => setDisconnectMode(null)}>
                  {translate("features.views.OperationalViews.108")}
                </button>
              </div>
            </div>
          ) : (
            <div className="button-row">
              <button className="button" onClick={() => setDisconnectMode("keep_local")}>
                {translate("features.views.OperationalViews.109")}
              </button>
              <button
                className="button button--danger-outline"
                onClick={() => setDisconnectMode("delete_mapped_local")}
              >
                {translate("features.views.OperationalViews.110")}
              </button>
            </div>
          )}
        </>
      ) : null}
      <details>
        <summary>{translate("features.views.OperationalViews.111")}</summary>
        <p>{translate("features.views.OperationalViews.112")}</p>
        <p>
          {translate("features.views.OperationalViews.113")}
          <code>calendar.events</code> {translate("features.views.OperationalViews.114")}
          <code>calendar.calendarlist.readonly</code>
          {translate("features.views.OperationalViews.115")}
        </p>
      </details>
    </section>
  );
}

function DataTransferPanel({ client }: { client: AppClient }) {
  const [importPath, setImportPath] = useState<string | null>(null);
  const [preview, setPreview] = useState<ImportPreview | null>(null);
  const [mode, setMode] = useState<"add" | "replace">("add");
  const [result, setResult] = useState<ImportResult | null>(null);
  const [message, setMessage] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const [activeExportId, setActiveExportId] = useState<string | null>(null);
  const [legacyPath, setLegacyPath] = useState<string | null>(null);
  const [legacyPreview, setLegacyPreview] = useState<LegacyImportPreview | null>(null);
  const [legacyResult, setLegacyResult] = useState<LegacyImportResult | null>(null);
  const [deleteConfirmation, setDeleteConfirmation] = useState("");
  const [deletedScheduleCount, setDeletedScheduleCount] = useState<number | null>(null);

  const exportData = async () => {
    setBusy(true);
    setError(null);
    try {
      const path = await save({
        title: translate("features.views.OperationalViews.116"),
        defaultPath: `day-schedule-next-${new Date().toISOString().slice(0, 10)}.json`,
        filters: [{ name: "Day Schedule Next JSON", extensions: ["json"] }],
      });
      if (!path) return;
      const operationId = crypto.randomUUID();
      setActiveExportId(operationId);
      const exported = await client.exportData(path, operationId);
      setMessage(
        translate("features.views.OperationalViews.117", [
          exported.fileName,
          exported.scheduleCount,
          exported.templateCount,
          exported.timerCount,
          exported.timerSetCount,
        ]),
      );
    } catch (caught) {
      if (isCancelled(caught)) {
        setMessage(translate("features.views.OperationalViews.118"));
      } else {
        setError(translate("features.views.OperationalViews.119"));
      }
    } finally {
      setActiveExportId(null);
      setBusy(false);
    }
  };

  const cancelExport = async () => {
    if (!activeExportId) return;
    const accepted = await client.cancelOperation(activeExportId);
    setMessage(
      accepted
        ? translate("features.views.OperationalViews.120")
        : translate("features.views.OperationalViews.121"),
    );
  };

  const selectImport = async () => {
    setBusy(true);
    setError(null);
    setResult(null);
    try {
      const path = await open({
        title: translate("features.views.OperationalViews.122"),
        multiple: false,
        directory: false,
        filters: [{ name: "Day Schedule Next JSON", extensions: ["json"] }],
      });
      if (typeof path !== "string") return;
      setImportPath(path);
      setPreview(await client.previewImport(path));
    } catch {
      setPreview(null);
      setImportPath(null);
      setError(translate("features.views.OperationalViews.123"));
    } finally {
      setBusy(false);
    }
  };

  const commitImport = async () => {
    if (!preview || !importPath) return;
    setBusy(true);
    setError(null);
    try {
      const imported = await client.importData(importPath, preview.fingerprint, mode);
      setResult(imported);
      setPreview(null);
      setImportPath(null);
      setMessage(translate("features.views.OperationalViews.124"));
    } catch {
      setError(translate("features.views.OperationalViews.125"));
    } finally {
      setBusy(false);
    }
  };

  const selectLegacy = async () => {
    setBusy(true);
    setError(null);
    setLegacyResult(null);
    try {
      const path = await open({
        title: translate("features.views.OperationalViews.126"),
        multiple: false,
        directory: false,
        filters: [{ name: "SQLite database", extensions: ["db", "sqlite", "sqlite3"] }],
      });
      if (typeof path !== "string") return;
      setLegacyPath(path);
      setLegacyPreview(await client.previewLegacyImport(path));
    } catch {
      setLegacyPath(null);
      setLegacyPreview(null);
      setError(translate("features.views.OperationalViews.127"));
    } finally {
      setBusy(false);
    }
  };

  const commitLegacy = async () => {
    if (!legacyPath || !legacyPreview) return;
    setBusy(true);
    setError(null);
    try {
      setLegacyResult(await client.importLegacy(legacyPath, legacyPreview.fingerprint));
      setLegacyPath(null);
      setLegacyPreview(null);
      setMessage(translate("features.views.OperationalViews.128"));
    } catch {
      setError(translate("features.views.OperationalViews.129"));
    } finally {
      setBusy(false);
    }
  };

  const deleteAllData = async () => {
    if (deleteConfirmation !== translate("features.views.OperationalViews.130")) return;
    setBusy(true);
    setError(null);
    setMessage(null);
    try {
      setDeletedScheduleCount(await client.deleteAllUserData(deleteConfirmation));
      setDeleteConfirmation("");
    } catch {
      setError(translate("features.views.OperationalViews.131"));
    } finally {
      setBusy(false);
    }
  };

  return (
    <section className="data-transfer" aria-labelledby="data-transfer-title">
      <h2 id="data-transfer-title">{translate("features.views.OperationalViews.132")}</h2>
      <p>{translate("features.views.OperationalViews.133")}</p>
      {message ? <StatusMessage tone="success" title={message} /> : null}
      {error ? <StatusMessage tone="danger" title={error} /> : null}
      {deletedScheduleCount !== null ? (
        <StatusMessage
          tone="success"
          title={translate("features.views.OperationalViews.134", [deletedScheduleCount])}
          action={
            <button className="button" type="button" onClick={() => window.location.reload()}>
              {translate("features.views.OperationalViews.135")}
            </button>
          }
        >
          {translate("features.views.OperationalViews.136")}
        </StatusMessage>
      ) : null}
      {result ? (
        <StatusMessage tone="success" title={translate("features.views.OperationalViews.137")}>
          {translate("features.views.OperationalViews.138")}
          {result.importedScheduleCount}
          {translate("features.views.OperationalViews.139")}
          {result.importedTemplateCount}
          {translate("features.views.OperationalViews.140")}
          {result.importedQuickBlockCount}
          {translate("features.views.OperationalViews.141")}
          {result.importedAlarmCount}
          {translate("features.views.OperationalViews.346")}
          {result.importedTimerCount}
          {translate("features.views.OperationalViews.347")}
          {result.importedTimerSetCount}
          {translate("features.views.OperationalViews.142")}
          {result.preservedExternalScheduleCount > 0
            ? translate("features.views.OperationalViews.143", [
                result.preservedExternalScheduleCount,
              ])
            : ""}
        </StatusMessage>
      ) : null}
      <div className="button-row">
        <button className="button" type="button" disabled={busy} onClick={() => void exportData()}>
          {translate("features.views.OperationalViews.144")}
        </button>
        {activeExportId ? (
          <button className="button" type="button" onClick={() => void cancelExport()}>
            {translate("features.views.OperationalViews.145")}
          </button>
        ) : null}
        <button
          className="button"
          type="button"
          disabled={busy}
          onClick={() => void selectImport()}
        >
          {translate("features.views.OperationalViews.146")}
        </button>
      </div>
      {preview ? (
        <div className="import-preview">
          <h3>{translate("features.views.OperationalViews.147")}</h3>
          <dl>
            <div>
              <dt>{translate("features.views.OperationalViews.148")}</dt>
              <dd>
                {preview.scheduleCount}
                {translate("features.views.OperationalViews.149")}
              </dd>
            </div>
            <div>
              <dt>{translate("features.views.OperationalViews.150")}</dt>
              <dd>
                {preview.templateCount}
                {translate("features.views.OperationalViews.151")}
              </dd>
            </div>
            <div>
              <dt>Quick Block</dt>
              <dd>
                {preview.quickBlockCount}
                {translate("features.views.OperationalViews.152")}
              </dd>
            </div>
            <div>
              <dt>{translate("features.views.OperationalViews.153")}</dt>
              <dd>
                {preview.alarmCount}
                {translate("features.views.OperationalViews.154")}
              </dd>
            </div>
            <div>
              <dt>{translate("features.views.OperationalViews.348")}</dt>
              <dd>
                {preview.timerCount}
                {translate("features.views.OperationalViews.149")}
              </dd>
            </div>
            <div>
              <dt>{translate("features.views.OperationalViews.349")}</dt>
              <dd>
                {preview.timerSetCount}
                {translate("features.views.OperationalViews.149")}
              </dd>
            </div>
          </dl>
          <ul>
            {preview.warnings.map((warning) => (
              <li key={warning}>{warning}</li>
            ))}
          </ul>
          <fieldset>
            <legend>{translate("features.views.OperationalViews.155")}</legend>
            <label>
              <input
                type="radio"
                name="import-mode"
                checked={mode === "add"}
                onChange={() => setMode("add")}
              />{" "}
              {translate("features.views.OperationalViews.156")}
            </label>
            <label>
              <input
                type="radio"
                name="import-mode"
                checked={mode === "replace"}
                onChange={() => setMode("replace")}
              />{" "}
              {translate("features.views.OperationalViews.157")}
            </label>
          </fieldset>
          {mode === "replace" ? (
            <StatusMessage tone="warning" title={translate("features.views.OperationalViews.158")}>
              {translate("features.views.OperationalViews.159")}
            </StatusMessage>
          ) : null}
          <div className="button-row">
            <button
              className={mode === "replace" ? "button button--danger" : "button button--primary"}
              type="button"
              disabled={busy}
              onClick={() => void commitImport()}
            >
              {mode === "replace"
                ? translate("features.views.OperationalViews.160")
                : translate("features.views.OperationalViews.161")}
            </button>
            <button
              className="button"
              type="button"
              onClick={() => {
                setPreview(null);
                setImportPath(null);
              }}
            >
              {translate("features.views.OperationalViews.162")}
            </button>
          </div>
        </div>
      ) : null}
      <hr />
      <h3>{translate("features.views.OperationalViews.163")}</h3>
      <p>
        {translate("features.views.OperationalViews.164")}
        <code>schedule.db</code> {translate("features.views.OperationalViews.165")}
      </p>
      {legacyResult ? (
        <StatusMessage tone="success" title={translate("features.views.OperationalViews.166")}>
          {translate("features.views.OperationalViews.167")}
          {legacyResult.importedTemplateCount}
          {translate("features.views.OperationalViews.168")}
          {legacyResult.importedTemplateBlockCount}
          {translate("features.views.OperationalViews.169")}
          {legacyResult.importedQuickBlockCount}
          {translate("features.views.OperationalViews.170")}
          {legacyResult.importedAlarmCount}
          {translate("features.views.OperationalViews.171")}
        </StatusMessage>
      ) : null}
      <button className="button" type="button" disabled={busy} onClick={() => void selectLegacy()}>
        {translate("features.views.OperationalViews.172")}
      </button>
      {legacyPreview ? (
        <div className="import-preview">
          <h3>{translate("features.views.OperationalViews.173")}</h3>
          <dl>
            <div>
              <dt>{translate("features.views.OperationalViews.174")}</dt>
              <dd>
                {legacyPreview.templateCount}
                {translate("features.views.OperationalViews.175")}
                {legacyPreview.templateBlockCount}
                {translate("features.views.OperationalViews.176")}
              </dd>
            </div>
            <div>
              <dt>{translate("features.views.OperationalViews.177")}</dt>
              <dd>
                {legacyPreview.quickBlockCount}
                {translate("features.views.OperationalViews.178")}
                {legacyPreview.alarmCount}
                {translate("features.views.OperationalViews.179")}
              </dd>
            </div>
            <div>
              <dt>{translate("features.views.OperationalViews.180")}</dt>
              <dd>
                {legacyPreview.orphanCount}
                {translate("features.views.OperationalViews.181")}
                {legacyPreview.invalidTimeCount}
                {translate("features.views.OperationalViews.182")}
                {legacyPreview.duplicateNameCount}
                {translate("features.views.OperationalViews.183")}
              </dd>
            </div>
            <div>
              <dt>{translate("features.views.OperationalViews.184")}</dt>
              <dd>
                {legacyPreview.lastProfileFound
                  ? translate("features.views.OperationalViews.185")
                  : translate("features.views.OperationalViews.186")}
              </dd>
            </div>
          </dl>
          {legacyPreview.warnings.length > 0 ? (
            <ul>
              {legacyPreview.warnings.map((warning) => (
                <li key={warning}>{warning}</li>
              ))}
            </ul>
          ) : (
            <p>{translate("features.views.OperationalViews.187")}</p>
          )}
          <p>
            {translate("features.views.OperationalViews.188")}
            <strong>{legacyPreview.excluded.join("、")}</strong>
          </p>
          <div className="button-row">
            <button
              className="button button--primary"
              type="button"
              disabled={busy}
              onClick={() => void commitLegacy()}
            >
              {translate("features.views.OperationalViews.189")}
            </button>
            <button
              className="button"
              type="button"
              onClick={() => {
                setLegacyPath(null);
                setLegacyPreview(null);
              }}
            >
              {translate("features.views.OperationalViews.190")}
            </button>
          </div>
        </div>
      ) : null}
      <hr />
      <details className="data-delete-zone">
        <summary>{translate("features.views.OperationalViews.191")}</summary>
        <StatusMessage tone="danger" title={translate("features.views.OperationalViews.192")}>
          {translate("features.views.OperationalViews.193")}
        </StatusMessage>
        <label>
          {translate("features.views.OperationalViews.194")}
          <input
            value={deleteConfirmation}
            autoComplete="off"
            spellCheck={false}
            onChange={(event) => setDeleteConfirmation(event.target.value)}
          />
        </label>
        <div className="button-row">
          <button
            className="button button--danger"
            type="button"
            disabled={
              busy || deleteConfirmation !== translate("features.views.OperationalViews.195")
            }
            onClick={() => void deleteAllData()}
          >
            {translate("features.views.OperationalViews.196")}
          </button>
          <button
            className="button"
            type="button"
            disabled={busy || deleteConfirmation.length === 0}
            onClick={() => setDeleteConfirmation("")}
          >
            {translate("features.views.OperationalViews.197")}
          </button>
        </div>
      </details>
    </section>
  );
}

export function DiagnosticsView({ client }: { client: AppClient }) {
  const [snapshot, setSnapshot] = useState<DiagnosticsSnapshot | null>(null);
  const [error, setError] = useState(false);
  const [message, setMessage] = useState<string | null>(null);
  const [notificationHistory, setNotificationHistory] = useState<NotificationLedgerItem[]>([]);
  const [notificationHistoryError, setNotificationHistoryError] = useState(false);
  useEffect(() => {
    let active = true;
    void client
      .diagnostics()
      .then((value) => {
        if (active) setSnapshot(value);
      })
      .catch(() => {
        if (active) setError(true);
      });
    return () => {
      active = false;
    };
  }, [client]);
  useEffect(() => {
    let active = true;
    void client
      .notificationLedger()
      .then((items) => {
        if (active) setNotificationHistory(items);
      })
      .catch(() => {
        if (active) setNotificationHistoryError(true);
      });
    return () => {
      active = false;
    };
  }, [client]);

  const copyVersions = async () => {
    if (!snapshot) return;
    const text = [
      `Day Schedule Next ${snapshot.appVersion}`,
      `DB schema ${snapshot.schemaVersion}`,
      `OS/WebView ${navigator.userAgent}`,
      `sync queue ${snapshot.outboxCount}, conflicts ${snapshot.conflictCount}`,
    ].join("\n");
    try {
      await navigator.clipboard.writeText(text);
      setMessage(translate("features.views.OperationalViews.198"));
    } catch {
      setMessage(translate("features.views.OperationalViews.199"));
    }
  };

  const exportDiagnostics = async () => {
    try {
      const path = await save({
        title: translate("features.views.OperationalViews.200"),
        defaultPath: `day-schedule-next-diagnostics-${new Date().toISOString().slice(0, 10)}.json`,
        filters: [{ name: "Redacted diagnostics JSON", extensions: ["json"] }],
      });
      if (!path) return;
      const result = await client.exportDiagnostics(path, navigator.userAgent);
      setMessage(
        translate("features.views.OperationalViews.201", [result.fileName, result.eventCount]),
      );
    } catch {
      setMessage(translate("features.views.OperationalViews.202"));
    }
  };
  return (
    <main className="secondary-view diagnostics-view">
      <ViewTitle
        eyebrow={translate("features.views.OperationalViews.203")}
        title={translate("features.views.OperationalViews.204")}
        description={translate("features.views.OperationalViews.205")}
      />
      {error ? (
        <StatusMessage tone="danger" title={translate("features.views.OperationalViews.206")}>
          {translate("features.views.OperationalViews.207")}
        </StatusMessage>
      ) : null}
      {!snapshot && !error ? (
        <StatusMessage title={translate("features.views.OperationalViews.208")} />
      ) : null}
      {snapshot ? (
        <dl className="diagnostics-grid">
          <div>
            <dt>{translate("features.views.OperationalViews.209")}</dt>
            <dd>{snapshot.appVersion}</dd>
          </div>
          <div>
            <dt>{translate("features.views.OperationalViews.210")}</dt>
            <dd>Version {snapshot.schemaVersion}</dd>
          </div>
          <div>
            <dt>{translate("features.views.OperationalViews.211")}</dt>
            <dd>
              {snapshot.scheduleCount}
              {translate("features.views.OperationalViews.212")}
            </dd>
          </div>
          <div>
            <dt>{translate("features.views.OperationalViews.213")}</dt>
            <dd>
              {snapshot.deletedCount}
              {translate("features.views.OperationalViews.214")}
            </dd>
          </div>
          <div>
            <dt>{translate("features.views.OperationalViews.215")}</dt>
            <dd>
              {snapshot.outboxCount}
              {translate("features.views.OperationalViews.216")}
            </dd>
          </div>
          <div>
            <dt>{translate("features.views.OperationalViews.217")}</dt>
            <dd>
              {snapshot.conflictCount}
              {translate("features.views.OperationalViews.218")}
            </dd>
          </div>
          <div>
            <dt>{translate("features.views.OperationalViews.219")}</dt>
            <dd>
              {snapshot.integrity === "ok"
                ? translate("features.views.OperationalViews.220")
                : translate("features.views.OperationalViews.221")}
            </dd>
          </div>
          <div>
            <dt>{translate("features.views.OperationalViews.222")}</dt>
            <dd>{snapshot.lastBackupAt ?? translate("features.views.OperationalViews.223")}</dd>
          </div>
        </dl>
      ) : null}
      {message ? <StatusMessage title={message} /> : null}
      <div className="button-row">
        <button
          className="button"
          type="button"
          disabled={!snapshot}
          onClick={() => void copyVersions()}
        >
          {translate("features.views.OperationalViews.224")}
        </button>
        <button
          className="button"
          type="button"
          disabled={!snapshot}
          onClick={() => void exportDiagnostics()}
        >
          {translate("features.views.OperationalViews.225")}
        </button>
      </div>
      <StatusMessage title={translate("features.views.OperationalViews.226")}>
        {translate("features.views.OperationalViews.227")}
      </StatusMessage>
      <section className="notification-history" aria-labelledby="notification-history-title">
        <div className="section-heading-row">
          <div>
            <h2 id="notification-history-title">
              {translate("features.views.OperationalViews.228")}
            </h2>
            <p>{translate("features.views.OperationalViews.229")}</p>
          </div>
        </div>
        {notificationHistoryError ? (
          <StatusMessage tone="warning" title={translate("features.views.OperationalViews.230")} />
        ) : notificationHistory.length ? (
          <div className="table-scroll">
            <table>
              <thead>
                <tr>
                  <th>{translate("features.views.OperationalViews.231")}</th>
                  <th>{translate("features.views.OperationalViews.232")}</th>
                  <th>{translate("features.views.OperationalViews.233")}</th>
                  <th>{translate("features.views.OperationalViews.234")}</th>
                </tr>
              </thead>
              <tbody>
                {notificationHistory.map((item, index) => (
                  <tr key={`${item.attemptedAt}-${index}`}>
                    <td>{new Date(item.occurrenceAt).toLocaleString(appLocale)}</td>
                    <td>{new Date(item.attemptedAt).toLocaleString(appLocale)}</td>
                    <td>{notificationResultLabel(item.result)}</td>
                    <td>{notificationErrorLabel(item.errorCategory)}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        ) : (
          <p>{translate("features.views.OperationalViews.236")}</p>
        )}
      </section>
      <SyncOperationsPanel client={client} />
      <BackupPanel client={client} />
    </main>
  );
}

function notificationResultLabel(result: NotificationLedgerItem["result"]): string {
  return {
    delivered: translate("features.views.OperationalViews.237"),
    skipped: translate("features.views.OperationalViews.238"),
    failed: translate("features.views.OperationalViews.239"),
    expired: translate("features.views.OperationalViews.240"),
  }[result];
}

function notificationErrorLabel(category: string | null): string {
  if (!category) return translate("features.views.OperationalViews.235");
  return (
    {
      dst_gap: translate("features.views.OperationalViews.338"),
      dst_ambiguous: translate("features.views.OperationalViews.339"),
      channels_disabled: translate("features.views.OperationalViews.340"),
      delivery_pending: translate("features.views.OperationalViews.341"),
      permission_not_granted: translate("features.views.OperationalViews.342"),
      os_notification_failed: translate("features.views.OperationalViews.343"),
      sound_failed: translate("features.views.OperationalViews.344"),
      replay_limit: translate("features.views.OperationalViews.350"),
    }[category] ?? translate("features.views.OperationalViews.345")
  );
}

function SyncOperationsPanel({ client }: { client: AppClient }) {
  const [queue, setQueue] = useState<SyncQueueItem[]>([]);
  const [conflicts, setConflicts] = useState<SyncConflictItem[]>([]);
  const [busy, setBusy] = useState(false);
  const [message, setMessage] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [activeOperationId, setActiveOperationId] = useState<string | null>(null);

  const refresh = async () => {
    const [nextQueue, nextConflicts] = await Promise.all([
      client.listSyncQueue(),
      client.listSyncConflicts(),
    ]);
    setQueue(nextQueue);
    setConflicts(nextConflicts);
  };

  useEffect(() => {
    let active = true;
    void Promise.all([client.listSyncQueue(), client.listSyncConflicts()])
      .then(([nextQueue, nextConflicts]) => {
        if (!active) return;
        setQueue(nextQueue);
        setConflicts(nextConflicts);
      })
      .catch(() => {
        if (active) setError(translate("features.views.OperationalViews.241"));
      });
    return () => {
      active = false;
    };
  }, [client]);

  const runTrackedSync = async () => {
    const operationId = crypto.randomUUID();
    setActiveOperationId(operationId);
    try {
      return await client.runSync(operationId);
    } finally {
      setActiveOperationId(null);
    }
  };

  const cancelSync = async () => {
    if (!activeOperationId) return;
    const accepted = await client.cancelOperation(activeOperationId);
    setMessage(
      accepted
        ? translate("features.views.OperationalViews.242")
        : translate("features.views.OperationalViews.243"),
    );
  };

  const synchronize = async () => {
    setBusy(true);
    setError(null);
    try {
      await runTrackedSync();
      await refresh();
      setMessage(translate("features.views.OperationalViews.244"));
    } catch (caught) {
      await refresh().catch(() => undefined);
      if (isCancelled(caught)) {
        setMessage(translate("features.views.OperationalViews.245"));
      } else {
        setError(translate("features.views.OperationalViews.246"));
      }
    } finally {
      setBusy(false);
    }
  };

  const retry = async (id?: string) => {
    setBusy(true);
    setError(null);
    try {
      await client.retrySyncQueue(id);
      await runTrackedSync();
      await refresh();
      setMessage(
        id
          ? translate("features.views.OperationalViews.247")
          : translate("features.views.OperationalViews.248"),
      );
    } catch (caught) {
      await refresh().catch(() => undefined);
      if (isCancelled(caught)) {
        setMessage(translate("features.views.OperationalViews.249"));
      } else {
        setError(translate("features.views.OperationalViews.250"));
      }
    } finally {
      setBusy(false);
    }
  };

  return (
    <section className="sync-operations" aria-labelledby="sync-operations-title">
      <div className="section-heading-row">
        <div>
          <h2 id="sync-operations-title">{translate("features.views.OperationalViews.251")}</h2>
          <p>{translate("features.views.OperationalViews.252")}</p>
        </div>
        <div className="button-row">
          <button className="button" disabled={busy} onClick={() => void synchronize()}>
            {translate("features.views.OperationalViews.253")}
          </button>
          {activeOperationId ? (
            <button className="button" onClick={() => void cancelSync()}>
              {translate("features.views.OperationalViews.254")}
            </button>
          ) : null}
          {queue.some((item) => item.errorCategory) ? (
            <button className="button" disabled={busy} onClick={() => void retry()}>
              {translate("features.views.OperationalViews.255")}
            </button>
          ) : null}
        </div>
      </div>
      {message ? <StatusMessage tone="success" title={message} /> : null}
      {error ? <StatusMessage tone="danger" title={error} /> : null}
      {queue.length === 0 ? (
        <StatusMessage title={translate("features.views.OperationalViews.256")} />
      ) : null}
      {queue.length > 0 ? (
        <div
          className="table-scroll"
          tabIndex={0}
          aria-label={translate("features.views.OperationalViews.257")}
        >
          <table className="sync-queue-table">
            <thead>
              <tr>
                <th>{translate("features.views.OperationalViews.258")}</th>
                <th>{translate("features.views.OperationalViews.259")}</th>
                <th>{translate("features.views.OperationalViews.260")}</th>
                <th>{translate("features.views.OperationalViews.261")}</th>
                <th>{translate("features.views.OperationalViews.262")}</th>
                <th>{translate("features.views.OperationalViews.263")}</th>
              </tr>
            </thead>
            <tbody>
              {queue.map((item) => (
                <tr key={item.id}>
                  <td>{item.title}</td>
                  <td>{syncOperationLabel(item.operation)}</td>
                  <td>{syncErrorLabel(item.errorCategory)}</td>
                  <td>
                    {item.attemptCount}
                    {translate("features.views.OperationalViews.264")}
                  </td>
                  <td>
                    {new Intl.DateTimeFormat(appLocale, {
                      dateStyle: "short",
                      timeStyle: "short",
                    }).format(new Date(item.nextAttemptAt))}
                  </td>
                  <td>
                    <button
                      className="link-button"
                      disabled={busy}
                      onClick={() => void retry(item.id)}
                    >
                      {translate("features.views.OperationalViews.265")}
                    </button>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      ) : null}
      {conflicts.length === 0 ? (
        <StatusMessage title={translate("features.views.OperationalViews.266")} />
      ) : null}
      <div className="conflict-list">
        {conflicts.map((conflict) => (
          <ConflictResolver
            key={conflict.id}
            conflict={conflict}
            busy={busy}
            onResolve={async (choices) => {
              setBusy(true);
              setError(null);
              try {
                await client.resolveSyncConflict(conflict.id, choices);
                await runTrackedSync();
                await refresh();
                setMessage(translate("features.views.OperationalViews.267", [conflict.title]));
              } catch (caught) {
                if (isCancelled(caught)) {
                  setMessage(translate("features.views.OperationalViews.268"));
                } else {
                  setError(translate("features.views.OperationalViews.269"));
                }
              } finally {
                setBusy(false);
              }
            }}
          />
        ))}
      </div>
    </section>
  );
}

function ConflictResolver({
  conflict,
  busy,
  onResolve,
}: {
  conflict: SyncConflictItem;
  busy: boolean;
  onResolve: (choices: ConflictChoice[]) => Promise<void>;
}) {
  const [choices, setChoices] = useState<Record<string, "local" | "remote">>(() =>
    Object.fromEntries(conflict.fields.map((field) => [field.field, "local"])),
  );
  return (
    <article className="conflict-card">
      <header>
        <div>
          <h3>{conflict.title}</h3>
          <p>
            {conflict.calendarName}・
            {new Intl.DateTimeFormat(appLocale, { dateStyle: "medium", timeStyle: "short" }).format(
              new Date(conflict.createdAt),
            )}
          </p>
        </div>
        <span className="state-chip" data-state="conflict">
          {translate("features.views.OperationalViews.270")}
        </span>
      </header>
      <fieldset>
        <legend>
          {conflict.deletionConflict
            ? translate("features.views.OperationalViews.271")
            : translate("features.views.OperationalViews.272")}
        </legend>
        {conflict.fields.map((field) => (
          <div className="conflict-field" key={field.field}>
            <strong>{conflictFieldLabel(field.field)}</strong>
            <label>
              <input
                type="radio"
                name={`${conflict.id}-${field.field}`}
                checked={choices[field.field] === "local"}
                onChange={() => setChoices({ ...choices, [field.field]: "local" })}
              />
              <span>{translate("features.views.OperationalViews.273")}</span>
              <code>{formatConflictValue(field.localValue)}</code>
            </label>
            <label>
              <input
                type="radio"
                name={`${conflict.id}-${field.field}`}
                checked={choices[field.field] === "remote"}
                onChange={() => setChoices({ ...choices, [field.field]: "remote" })}
              />
              <span>Google</span>
              <code>{formatConflictValue(field.remoteValue)}</code>
            </label>
          </div>
        ))}
      </fieldset>
      <button
        className="button button--primary"
        disabled={busy}
        onClick={() =>
          void onResolve(
            conflict.fields.map((field) => ({
              field: field.field,
              source: choices[field.field] ?? "local",
            })),
          )
        }
      >
        {translate("features.views.OperationalViews.274")}
      </button>
    </article>
  );
}

function formatConflictValue(value: unknown): string {
  if (value === null || value === undefined || value === "")
    return translate("features.views.OperationalViews.275");
  if (Array.isArray(value))
    return value.join(", ") || translate("features.views.OperationalViews.276");
  if (typeof value === "object") return JSON.stringify(value);
  if (typeof value === "string" || typeof value === "number" || typeof value === "boolean") {
    return `${value}`;
  }
  return translate("features.views.OperationalViews.277");
}

function conflictFieldLabel(field: string): string {
  return (
    {
      title: translate("features.views.OperationalViews.278"),
      description: translate("features.views.OperationalViews.279"),
      location: translate("features.views.OperationalViews.280"),
      startUtc: translate("features.views.OperationalViews.281"),
      endUtc: translate("features.views.OperationalViews.282"),
      timezoneId: translate("features.views.OperationalViews.283"),
      allDay: translate("features.views.OperationalViews.284"),
      status: translate("features.views.OperationalViews.285"),
      project: translate("features.views.OperationalViews.286"),
      category: translate("features.views.OperationalViews.287"),
      tags: translate("features.views.OperationalViews.288"),
      color: translate("features.views.OperationalViews.289"),
      priority: translate("features.views.OperationalViews.290"),
      recurrenceRule: translate("features.views.OperationalViews.291"),
      delete: translate("features.views.OperationalViews.292"),
    }[field] ?? field
  );
}

function syncOperationLabel(operation: SyncQueueItem["operation"]): string {
  return {
    create: translate("features.views.OperationalViews.293"),
    update: translate("features.views.OperationalViews.294"),
    delete: translate("features.views.OperationalViews.295"),
  }[operation];
}

function syncErrorLabel(category: string | null): string {
  if (!category) return translate("features.views.OperationalViews.296");
  return (
    {
      auth_required: translate("features.views.OperationalViews.297"),
      conflict: translate("features.views.OperationalViews.298"),
      retryable: translate("features.views.OperationalViews.299"),
      permanent: translate("features.views.OperationalViews.300"),
      merged: translate("features.views.OperationalViews.301"),
    }[category] ?? category
  );
}

function BackupPanel({ client }: { client: AppClient }) {
  const [backups, setBackups] = useState<BackupRecord[]>([]);
  const [busy, setBusy] = useState(false);
  const [confirmId, setConfirmId] = useState<string | null>(null);
  const [message, setMessage] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [activeOperationId, setActiveOperationId] = useState<string | null>(null);
  const refresh = async () => setBackups(await client.listBackups());

  useEffect(() => {
    let active = true;
    void client
      .listBackups()
      .then((items) => active && setBackups(items))
      .catch(() => active && setError(translate("features.views.OperationalViews.302")));
    return () => {
      active = false;
    };
  }, [client]);

  const createBackup = async () => {
    setBusy(true);
    setError(null);
    try {
      const operationId = crypto.randomUUID();
      setActiveOperationId(operationId);
      await client.createBackup(operationId);
      await refresh();
      setMessage(translate("features.views.OperationalViews.303"));
    } catch (caught) {
      if (isCancelled(caught)) {
        setMessage(translate("features.views.OperationalViews.304"));
      } else {
        setError(translate("features.views.OperationalViews.305"));
      }
    } finally {
      setActiveOperationId(null);
      setBusy(false);
    }
  };

  const cancelBackup = async () => {
    if (!activeOperationId) return;
    const accepted = await client.cancelOperation(activeOperationId);
    setMessage(
      accepted
        ? translate("features.views.OperationalViews.306")
        : translate("features.views.OperationalViews.307"),
    );
  };

  const stageRestore = async (backup: BackupRecord) => {
    setBusy(true);
    setError(null);
    try {
      await client.stageRestore(backup.id);
      setMessage(translate("features.views.OperationalViews.308"));
      setConfirmId(null);
    } catch {
      setError(translate("features.views.OperationalViews.309"));
    } finally {
      setBusy(false);
    }
  };

  return (
    <section className="backup-panel" aria-labelledby="backup-title">
      <div className="section-heading-row">
        <div>
          <h2 id="backup-title">{translate("features.views.OperationalViews.310")}</h2>
          <p>{translate("features.views.OperationalViews.311")}</p>
        </div>
        <div className="button-row">
          <button className="button" disabled={busy} onClick={() => void createBackup()}>
            {translate("features.views.OperationalViews.312")}
          </button>
          {activeOperationId ? (
            <button className="button" onClick={() => void cancelBackup()}>
              {translate("features.views.OperationalViews.313")}
            </button>
          ) : null}
        </div>
      </div>
      {message ? <StatusMessage tone="success" title={message} /> : null}
      {error ? <StatusMessage tone="danger" title={error} /> : null}
      {backups.length === 0 ? (
        <StatusMessage title={translate("features.views.OperationalViews.314")} />
      ) : null}
      <ol className="backup-list">
        {backups.map((backup) => (
          <li key={backup.id}>
            <span>
              <strong>
                {new Intl.DateTimeFormat(appLocale, {
                  dateStyle: "medium",
                  timeStyle: "short",
                }).format(new Date(backup.createdAt))}
              </strong>
              <small>
                DB v{backup.schemaVersion}・{formatBytes(backup.sizeBytes)}・
                {backup.verified
                  ? translate("features.views.OperationalViews.315")
                  : translate("features.views.OperationalViews.316")}
              </small>
            </span>
            {confirmId === backup.id ? (
              <span className="inline-confirm">
                <button
                  className="button button--danger"
                  disabled={busy}
                  onClick={() => void stageRestore(backup)}
                >
                  {translate("features.views.OperationalViews.317")}
                </button>
                <button className="button" onClick={() => setConfirmId(null)}>
                  {translate("features.views.OperationalViews.318")}
                </button>
              </span>
            ) : (
              <button className="button" disabled={busy} onClick={() => setConfirmId(backup.id)}>
                {translate("features.views.OperationalViews.319")}
              </button>
            )}
          </li>
        ))}
      </ol>
      {confirmId ? (
        <StatusMessage tone="warning" title={translate("features.views.OperationalViews.320")}>
          {translate("features.views.OperationalViews.321")}
        </StatusMessage>
      ) : null}
    </section>
  );
}

function formatBytes(value: number): string {
  if (value < 1024) return `${value} B`;
  if (value < 1024 * 1024) return `${(value / 1024).toFixed(1)} KB`;
  return `${(value / (1024 * 1024)).toFixed(1)} MB`;
}

function focusLabel(phase: FocusState["phase"]): string {
  return {
    idle: translate("features.views.OperationalViews.322"),
    working: translate("features.views.OperationalViews.323"),
    paused: translate("features.views.OperationalViews.324"),
    break: translate("features.views.OperationalViews.325"),
    waiting_next: translate("features.views.OperationalViews.326"),
  }[phase];
}

function permissionLabel(value: "unknown" | "granted" | "denied" | "unavailable"): string {
  return {
    unknown: translate("features.views.OperationalViews.327"),
    granted: translate("features.views.OperationalViews.328"),
    denied: translate("features.views.OperationalViews.329"),
    unavailable: translate("features.views.OperationalViews.330"),
  }[value];
}

function googleStateLabel(state?: GoogleConnection["state"]): string {
  if (!state) return translate("features.views.OperationalViews.331");
  return {
    not_configured: translate("features.views.OperationalViews.332"),
    configured: translate("features.views.OperationalViews.333"),
    connecting: translate("features.views.OperationalViews.334"),
    connected: translate("features.views.OperationalViews.335"),
    auth_required: translate("features.views.OperationalViews.336"),
    feature_disabled: translate("features.views.OperationalViews.337"),
  }[state];
}
