import type { Schedule } from "../../shared/contracts";
import { formatTime } from "../../shared/time";
import { layoutOverview } from "./overview-layout";

interface DayOverviewProps {
  schedules: Schedule[];
  selectedDate: Date;
  selectedId: string | null;
  onSelect: (schedule: Schedule) => void;
  referenceMinute: number;
  onReferenceChange: (minute: number) => void;
}

export function DayOverview({
  schedules,
  selectedDate,
  selectedId,
  onSelect,
  referenceMinute,
  onReferenceChange,
}: DayOverviewProps) {
  const now = new Date();
  const isToday = selectedDate.toDateString() === now.toDateString();
  const nowPercent = ((now.getHours() * 60 + now.getMinutes()) / 1440) * 100;
  const items = layoutOverview(schedules, selectedDate);
  const maxLevels = Math.max(1, ...items.map((item) => item.levelCount));
  return (
    <section className="overview" aria-labelledby="overview-title">
      <div className="section-heading section-heading--compact">
        <div>
          <span className="eyebrow">一日の分布</span>
          <h2 id="overview-title">24時間ストリップ</h2>
        </div>
        <span className="legend">
          <i className="legend__pending" /> 同期待ちを点線で表示
        </span>
      </div>
      <div
        className="overview-track"
        aria-label="0時から24時の予定概要"
        style={{ minHeight: 62 + Math.min(maxLevels, 8) * 7 }}
      >
        {[0, 3, 6, 9, 12, 15, 18, 21, 24].map((hour) => (
          <span className="overview-tick" key={hour} style={{ left: `${(hour / 24) * 100}%` }}>
            {String(hour).padStart(2, "0")}
          </span>
        ))}
        {items.map(({ schedule, startMinute, endMinute, level, levelCount }) => {
          return (
            <button
              className="overview-event"
              key={`${schedule.id}-${schedule.startUtc}`}
              type="button"
              aria-label={`${schedule.title} ${formatTime(schedule.startUtc)}から${formatTime(schedule.endUtc)}`}
              aria-pressed={selectedId === schedule.id}
              data-sync={schedule.syncStatus}
              style={{
                left: `${(startMinute / 1440) * 100}%`,
                width: `${Math.max(0.8, ((endMinute - startMinute) / 1440) * 100)}%`,
                top: 28 + Math.min(level, 8) * 7,
                zIndex: levelCount - level,
                backgroundColor: schedule.color,
              }}
              onClick={() => onSelect(schedule)}
            >
              <span>{schedule.title}</span>
            </button>
          );
        })}
        {isToday ? (
          <i className="overview-now" style={{ left: `${nowPercent}%` }} aria-hidden="true" />
        ) : null}
      </div>
      <label className="reference-time-control">
        <span>詳細表示の基準時刻</span>
        <input
          type="range"
          min={0}
          max={1439}
          step={5}
          value={referenceMinute}
          onChange={(event) => onReferenceChange(Number(event.target.value))}
        />
        <output>{`${String(Math.floor(referenceMinute / 60)).padStart(2, "0")}:${String(referenceMinute % 60).padStart(2, "0")}`}</output>
      </label>
    </section>
  );
}
