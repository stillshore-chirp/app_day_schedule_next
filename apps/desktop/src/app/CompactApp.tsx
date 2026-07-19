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
        予定を開いています…
      </main>
    );
  }
  if (!bootstrap.data || bootstrap.isError || schedules.isError) {
    return (
      <main className="compact-shell compact-shell--center">
        <StatusMessage tone="danger" title="コンパクト表示を開けませんでした">
          データは変更されていません。メイン画面の「データと診断」を確認してください。
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
          {new Intl.DateTimeFormat("ja-JP", {
            hour: "2-digit",
            minute: "2-digit",
            second: "2-digit",
          }).format(now)}
        </time>
      </header>
      <section className="compact-current" aria-labelledby="compact-current-title">
        <span>現在</span>
        <h2 id="compact-current-title">{primary?.title ?? "進行中の予定はありません"}</h2>
        {primary ? (
          <p>
            {formatTime(primary.startUtc)}–{formatTime(primary.endUtc)}・残り{" "}
            {remaining(primary.endUtc, now)}
          </p>
        ) : (
          <p>次の予定まで、自由に使える時間です。</p>
        )}
        {current.length > 1 ? <p className="state-chip">同時進行 {current.length}件</p> : null}
      </section>
      <section className="compact-next" aria-labelledby="compact-next-title">
        <span>次</span>
        <h2 id="compact-next-title">{next?.title ?? "24時間以内の予定はありません"}</h2>
        {next ? (
          <p>
            {formatTime(next.startUtc)} 開始・あと {remaining(next.startUtc, now)}
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
          {bootstrap.data.focus.phase === "idle" ? "Focus開始" : "Focus終了"}
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
      <h2 id="compact-agenda-title">この後の予定</h2>
      {upcoming.length === 0 ? <p>表示する予定はありません。</p> : null}
      <ol>
        {upcoming.map((item) => (
          <li key={item.id}>
            <i style={{ backgroundColor: item.color }} aria-hidden="true" />
            <time dateTime={item.startUtc}>{formatTime(item.startUtc)}</time>
            <strong>{item.title}</strong>
            <span>{item.syncStatus === "conflict" ? "競合あり" : statusLabel(item.status)}</span>
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
      disconnected: "ローカルのみ",
      connecting: "接続中",
      synced: "同期済み",
      pending: "同期待ち",
      syncing: "同期中",
      offline: "オフライン",
      retry_scheduled: "再試行待ち",
      conflict: "競合あり",
      auth_required: "再接続が必要",
    }[state] ?? "状態確認中"
  );
}

function statusLabel(status: Schedule["status"]): string {
  return {
    not_started: "未着手",
    scheduled: "予定済み",
    in_progress: "進行中",
    completed: "完了",
    cancelled: "取消",
  }[status];
}
