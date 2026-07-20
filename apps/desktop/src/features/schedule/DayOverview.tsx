import { translate } from "../../shared/i18n/messages";
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
          <span className="eyebrow">{translate("features.schedule.DayOverview.001")}</span>
          <h2 id="overview-title">{translate("features.schedule.DayOverview.002")}</h2>
        </div>
        <span className="legend">
          <i className="legend__pending" /> {translate("features.schedule.DayOverview.003")}
        </span>
      </div>
      <div
        className="overview-track"
        aria-label={translate("features.schedule.DayOverview.004")}
        style={{ minHeight: 62 + Math.min(maxLevels, 8) * 7 }}
      >
        {[0, 3, 6, 9, 12, 15, 18, 21, 24].map((hour) => (
          <span className="overview-tick" key={hour} style={{ left: `${(hour / 24) * 100}%` }}>
            {String(hour).padStart(2, "0")}
          </span>
        ))}
        {items.map(({ schedule, startMinute, endMinute, level, levelCount }) => {
          const durationMinutes = endMinute - startMinute;
          const density = durationMinutes <= 45 ? "micro" : "regular";
          const accessibleLabel = translate("features.schedule.DayOverview.005", [
            schedule.title,
            formatTime(schedule.startUtc),
            formatTime(schedule.endUtc),
          ]);
          return (
            <button
              className="overview-event"
              key={`${schedule.id}-${schedule.startUtc}`}
              type="button"
              aria-label={accessibleLabel}
              aria-pressed={selectedId === schedule.id}
              title={accessibleLabel}
              data-density={density}
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
        <span>{translate("features.schedule.DayOverview.006")}</span>
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
