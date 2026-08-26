import { translate } from "../../shared/i18n/messages";
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
    <footer className="now-dock" aria-label={translate("features.schedule.NowDock.001")}>
      <div className="now-dock__current">
        <span className="eyebrow eyebrow--inverse">NOW</span>
        <strong>{primary?.title ?? translate("features.schedule.NowDock.002")}</strong>
        {primary ? (
          <span>
            {translate("features.schedule.NowDock.003")}{" "}
            {durationLabel(
              Math.max(0, Math.floor((now.getTime() - Date.parse(primary.startUtc)) / 1000)),
            )}
            {translate("features.schedule.NowDock.004")}
            {remainingLabel(primary.endUtc, now)}・{formatTime(primary.endUtc)}
            {translate("features.schedule.NowDock.005")}
          </span>
        ) : null}
        {current.length > 1 ? (
          <details className="now-dock__concurrent">
            <summary className="state-chip state-chip--inverse">
              {translate("features.schedule.NowDock.006")}
              {current.length}
              {translate("features.schedule.NowDock.007")}
            </summary>
            <ul>
              {current.map((item) => (
                <li key={item.id}>
                  <strong>{item.title}</strong>
                  <span>
                    {formatTime(item.startUtc)}–{formatTime(item.endUtc)}
                    {translate("features.schedule.NowDock.008")}
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
        aria-label={
          primary
            ? translate("features.schedule.NowDock.009", [Math.round(progress)])
            : translate("features.schedule.NowDock.010")
        }
      >
        <i style={{ width: `${progress}%` }} />
      </div>
      <div className="now-dock__next">
        <span>{translate("features.schedule.NowDock.011")}</span>
        <strong>
          {next
            ? `${next.title} ${formatTime(next.startUtc)}`
            : translate("features.schedule.NowDock.012")}
        </strong>
        <small className="now-dock__alarm">
          {translate("features.schedule.NowDock.013")}{" "}
          {nextAlarm
            ? `${nextAlarm.label}・${remainingLabel(nextAlarm.at, now)}`
            : translate("features.schedule.NowDock.014")}
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
    idle: translate("features.schedule.NowDock.015"),
    working: translate("features.schedule.NowDock.016"),
    paused: translate("features.schedule.NowDock.017"),
    break: translate("features.schedule.NowDock.018"),
    waiting_next: translate("features.schedule.NowDock.019"),
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
