import { useEffect, useMemo, useState } from "react";
import { fromZonedTime } from "date-fns-tz";
import type { FocusState, FreeAlarm, Schedule } from "../../shared/contracts";
import { formatTime } from "../../shared/time";
import { isCurrent, nextSchedule } from "./timeline-layout";

interface NowDockProps {
  schedules: Schedule[];
  focus: FocusState;
  alarms: FreeAlarm[];
}

function remainingLabel(target: string, now: Date): string {
  const seconds = Math.max(0, Math.floor((Date.parse(target) - now.getTime()) / 1000));
  return durationLabel(seconds);
}

function durationLabel(seconds: number): string {
  const hours = Math.floor(seconds / 3600);
  const minutes = Math.floor((seconds % 3600) / 60);
  const rest = seconds % 60;
  return hours > 0
    ? `${hours}:${String(minutes).padStart(2, "0")}:${String(rest).padStart(2, "0")}`
    : `${minutes}:${String(rest).padStart(2, "0")}`;
}

export function NowDock({ schedules, focus, alarms }: NowDockProps) {
  const [now, setNow] = useState(() => new Date());
  useEffect(() => {
    const id = window.setInterval(() => setNow(new Date()), 1000);
    return () => window.clearInterval(id);
  }, []);
  const current = useMemo(
    () => schedules.filter((schedule) => isCurrent(schedule, now)),
    [schedules, now],
  );
  const next = useMemo(() => nextSchedule(schedules, now), [schedules, now]);
  const nextAlarm = useMemo(() => findNextAlarm(alarms, now), [alarms, now]);
  const primary = current[0] ?? null;
  const progress = primary
    ? Math.min(
        100,
        Math.max(
          0,
          ((now.getTime() - Date.parse(primary.startUtc)) /
            (Date.parse(primary.endUtc) - Date.parse(primary.startUtc))) *
            100,
        ),
      )
    : 0;

  return (
    <footer className="now-dock" aria-label="現在と次の予定">
      <div className="now-dock__current">
        <span className="eyebrow eyebrow--inverse">NOW</span>
        <strong>{primary?.title ?? "進行中の予定はありません"}</strong>
        {primary ? (
          <span>
            経過{" "}
            {durationLabel(
              Math.max(0, Math.floor((now.getTime() - Date.parse(primary.startUtc)) / 1000)),
            )}
            ・残り {remainingLabel(primary.endUtc, now)}・{formatTime(primary.endUtc)}終了
          </span>
        ) : null}
        {current.length > 1 ? (
          <details className="now-dock__concurrent">
            <summary className="state-chip state-chip--inverse">
              進行中をすべて表示（{current.length}件）
            </summary>
            <ul>
              {current.map((item) => (
                <li key={item.id}>
                  <strong>{item.title}</strong>
                  <span>
                    {formatTime(item.startUtc)}–{formatTime(item.endUtc)}・残り
                    {remainingLabel(item.endUtc, now)}
                  </span>
                </li>
              ))}
            </ul>
          </details>
        ) : null}
      </div>
      <div
        className="now-dock__progress"
        role="progressbar"
        aria-valuemin={0}
        aria-valuemax={100}
        aria-valuenow={Math.round(progress)}
        aria-label={primary ? `進捗 ${Math.round(progress)}%` : "進行中の予定なし"}
      >
        <i style={{ width: `${progress}%` }} />
      </div>
      <div className="now-dock__next">
        <span>次の予定</span>
        <strong>
          {next ? `${next.title} ${formatTime(next.startUtc)}` : "24時間以内に予定はありません"}
        </strong>
        <small>
          次のアラーム:{" "}
          {nextAlarm ? `${nextAlarm.label}・${remainingLabel(nextAlarm.at, now)}` : "なし"}
        </small>
      </div>
      <div className="now-dock__focus">
        <span>Focus</span>
        <strong>{focusPhaseLabel(focus.phase)}</strong>
      </div>
    </footer>
  );
}

function focusPhaseLabel(phase: FocusState["phase"]): string {
  return {
    idle: "待機中",
    working: "作業中",
    paused: "一時停止",
    break: "休憩中",
    waiting_next: "次の作業待ち",
  }[phase];
}

function findNextAlarm(alarms: FreeAlarm[], now: Date): { label: string; at: string } | null {
  let best: { label: string; at: string } | null = null;
  for (const alarm of alarms) {
    if (!alarm.enabled) continue;
    for (let offset = 0; offset < 8; offset += 1) {
      const day = new Date(now);
      day.setDate(day.getDate() + offset);
      const weekdayIndex = (day.getDay() + 6) % 7;
      if ((alarm.weekdaysMask & (1 << weekdayIndex)) === 0) continue;
      const date = `${day.getFullYear()}-${String(day.getMonth() + 1).padStart(2, "0")}-${String(day.getDate()).padStart(2, "0")}`;
      const time = `${String(Math.floor(alarm.minuteOfDay / 60)).padStart(2, "0")}:${String(alarm.minuteOfDay % 60).padStart(2, "0")}:00`;
      const candidate = fromZonedTime(`${date}T${time}`, alarm.timezoneId);
      if (candidate <= now) continue;
      if (!best || candidate < new Date(best.at))
        best = { label: alarm.label, at: candidate.toISOString() };
      break;
    }
  }
  return best;
}
