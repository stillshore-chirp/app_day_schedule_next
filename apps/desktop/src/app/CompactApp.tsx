import { appLocale, translate } from "../shared/i18n/messages";
import { useEffect, useMemo, useState } from "react";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import type { FocusState, Schedule } from "../shared/contracts";
import type { AppClient } from "../shared/ipc/client";
import { dayRange, formatTime } from "../shared/time";
import { StatusMessage } from "../shared/ui/StatusMessage";
import { isCurrent, nextSchedule } from "../features/schedule/timeline-layout";

export function CompactApp({ client }: { client: AppClient }) {
  const queryClient = useQueryClient();
  const [now, setNow] = useState(() => new Date());
  const [busy, setBusy] = useState(false);
  const bootstrap = useQuery({ queryKey: ["bootstrap"], queryFn: () => client.bootstrap() });
  const range = dayRange(now);
  const schedules = useQuery({
    queryKey: ["compact-schedules", range.startUtc, range.endUtc],
    queryFn: () => client.listSchedules({ ...range, limit: 500 }),
    refetchInterval: 30_000,
  });

  useEffect(() => {
    const timer = window.setInterval(() => setNow(new Date()), 1000);
    return () => window.clearInterval(timer);
  }, []);

  const items = schedules.data?.items ?? [];
  const current = useMemo(() => items.filter((schedule) => isCurrent(schedule, now)), [items, now]);
  const next = useMemo(() => nextSchedule(items, now), [items, now]);
  const primary = current[0] ?? null;

  const focusCommand = async (focus: FocusState) => {
    setBusy(true);
    try {
      await client.focusCommand(focus.phase === "idle" ? "start" : "stop");
      await queryClient.invalidateQueries({ queryKey: ["bootstrap"] });
    } finally {
      setBusy(false);
    }
  };

  if (bootstrap.isLoading || schedules.isLoading) {
    return (
      <main className="compact-shell compact-shell--center" role="status">
        {translate("app.CompactApp.001")}
      </main>
    );
  }
  if (!bootstrap.data || bootstrap.isError || schedules.isError) {
    return (
      <main className="compact-shell compact-shell--center">
        <StatusMessage tone="danger" title={translate("app.CompactApp.002")}>
          {translate("app.CompactApp.003")}
        </StatusMessage>
      </main>
    );
  }

  return (
    <main className="compact-shell">
      <header className="compact-header">
        <div>
          <span className="eyebrow">NOW</span>
          <h1>Day Schedule Next</h1>
        </div>
        <time dateTime={now.toISOString()}>
          {new Intl.DateTimeFormat(appLocale, {
            hour: "2-digit",
            minute: "2-digit",
            second: "2-digit",
          }).format(now)}
        </time>
      </header>
      <section className="compact-current" aria-labelledby="compact-current-title">
        <span>{translate("app.CompactApp.004")}</span>
        <h2 id="compact-current-title">{primary?.title ?? translate("app.CompactApp.005")}</h2>
        {primary ? (
          <p>
            {formatTime(primary.startUtc)}–{formatTime(primary.endUtc)}
            {translate("app.CompactApp.006")} {remaining(primary.endUtc, now)}
          </p>
        ) : (
          <p>{translate("app.CompactApp.007")}</p>
        )}
        {current.length > 1 ? (
          <p className="state-chip">
            {translate("app.CompactApp.008")}
            {current.length}
            {translate("app.CompactApp.009")}
          </p>
        ) : null}
      </section>
      <section className="compact-next" aria-labelledby="compact-next-title">
        <span>{translate("app.CompactApp.010")}</span>
        <h2 id="compact-next-title">{next?.title ?? translate("app.CompactApp.011")}</h2>
        {next ? (
          <p>
            {formatTime(next.startUtc)} {translate("app.CompactApp.012")}
            {remaining(next.startUtc, now)}
          </p>
        ) : null}
      </section>
      <CompactAgenda items={items} now={now} />
      <footer className="compact-actions">
        <button
          className="button button--primary"
          type="button"
          onClick={() => void client.showMainWindowWithAction("quick-add")}
        >
          ＋ Quick Add
        </button>
        <button
          className="button"
          type="button"
          disabled={busy}
          onClick={() => void focusCommand(bootstrap.data.focus)}
        >
          {bootstrap.data.focus.phase === "idle"
            ? translate("app.CompactApp.013")
            : translate("app.CompactApp.014")}
        </button>
        <span role="status">{syncLabel(bootstrap.data.sync.state)}</span>
      </footer>
    </main>
  );
}

function CompactAgenda({ items, now }: { items: Schedule[]; now: Date }) {
  const upcoming = items
    .filter((item) => Date.parse(item.endUtc) > now.getTime())
    .sort((a, b) => Date.parse(a.startUtc) - Date.parse(b.startUtc))
    .slice(0, 4);
  return (
    <section className="compact-agenda" aria-labelledby="compact-agenda-title">
      <h2 id="compact-agenda-title">{translate("app.CompactApp.015")}</h2>
      {upcoming.length === 0 ? <p>{translate("app.CompactApp.016")}</p> : null}
      <ol>
        {upcoming.map((item) => (
          <li key={item.id}>
            <i style={{ backgroundColor: item.color }} aria-hidden="true" />
            <time dateTime={item.startUtc}>{formatTime(item.startUtc)}</time>
            <strong>{item.title}</strong>
            <span>
              {item.syncStatus === "conflict"
                ? translate("app.CompactApp.017")
                : statusLabel(item.status)}
            </span>
          </li>
        ))}
      </ol>
    </section>
  );
}

function remaining(target: string, now: Date): string {
  const seconds = Math.max(0, Math.ceil((Date.parse(target) - now.getTime()) / 1000));
  const hours = Math.floor(seconds / 3600);
  const minutes = Math.floor((seconds % 3600) / 60);
  const rest = seconds % 60;
  return hours > 0
    ? `${hours}:${String(minutes).padStart(2, "0")}:${String(rest).padStart(2, "0")}`
    : `${minutes}:${String(rest).padStart(2, "0")}`;
}

function syncLabel(state: string): string {
  return (
    {
      disconnected: translate("app.CompactApp.018"),
      connecting: translate("app.CompactApp.019"),
      synced: translate("app.CompactApp.020"),
      pending: translate("app.CompactApp.021"),
      syncing: translate("app.CompactApp.022"),
      offline: translate("app.CompactApp.023"),
      retry_scheduled: translate("app.CompactApp.024"),
      conflict: translate("app.CompactApp.025"),
      auth_required: translate("app.CompactApp.026"),
    }[state] ?? translate("app.CompactApp.027")
  );
}

function statusLabel(status: Schedule["status"]): string {
  return {
    not_started: translate("app.CompactApp.028"),
    scheduled: translate("app.CompactApp.029"),
    in_progress: translate("app.CompactApp.030"),
    completed: translate("app.CompactApp.031"),
    cancelled: translate("app.CompactApp.032"),
  }[status];
}
