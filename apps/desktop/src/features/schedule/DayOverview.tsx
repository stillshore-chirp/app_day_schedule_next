import { translate } from "../../shared/i18n/messages";
import type { DayTemplate, Schedule } from "../../shared/contracts";
import { formatTime } from "../../shared/time";
import { Tooltip } from "../../shared/ui/Tooltip";
import { layoutSchedulesForDay, minuteToPercent } from "./overview-layout";
import { layoutTemplateBlocks } from "./template-overview-layout";

const MAX_VISIBLE_LEVELS = 8;
const OVERVIEW_BLOCK_HEIGHT = 60;
const OVERVIEW_BLOCK_GAP = 3;
const OVERVIEW_SINGLE_LEVEL_HEIGHT = 76;
const OVERVIEW_MULTI_LEVEL_PADDING = 6;

interface DayOverviewProps {
  schedules: Schedule[];
  scheduleState: "loading" | "ready";
  selectedDate: Date;
  selectedId: string | null;
  onSelect: (schedule: Schedule) => void;
  onCreateSchedule: () => void;
  template: DayTemplate | null;
  templateState: "loading" | "error" | "ready";
  onRetryTemplate: () => void;
  referenceMinute: number;
  onReferenceChange: (minute: number) => void;
  textScalePercent: number;
}

function minuteToTime(minute: number): string {
  if (minute >= 1440) return "24:00";
  return `${String(Math.floor(minute / 60)).padStart(2, "0")}:${String(minute % 60).padStart(2, "0")}`;
}

function laneHeight(levelCount: number, textScaleFactor: number): number {
  const visibleLevelCount = Math.min(Math.max(1, levelCount), MAX_VISIBLE_LEVELS);
  if (visibleLevelCount === 1) return OVERVIEW_SINGLE_LEVEL_HEIGHT * textScaleFactor;
  return (
    OVERVIEW_MULTI_LEVEL_PADDING * 2 * textScaleFactor +
    visibleLevelCount * OVERVIEW_BLOCK_HEIGHT * textScaleFactor +
    (visibleLevelCount - 1) * OVERVIEW_BLOCK_GAP
  );
}

function blockTop(level: number, levelCount: number, textScaleFactor: number): number {
  const visibleLevelCount = Math.min(Math.max(1, levelCount), MAX_VISIBLE_LEVELS);
  if (visibleLevelCount === 1) {
    return ((OVERVIEW_SINGLE_LEVEL_HEIGHT - OVERVIEW_BLOCK_HEIGHT) / 2) * textScaleFactor;
  }
  return (
    OVERVIEW_MULTI_LEVEL_PADDING * textScaleFactor +
    level * (OVERVIEW_BLOCK_HEIGHT * textScaleFactor + OVERVIEW_BLOCK_GAP)
  );
}

export function DayOverview({
  schedules,
  scheduleState,
  selectedDate,
  selectedId,
  onSelect,
  onCreateSchedule,
  template,
  templateState,
  onRetryTemplate,
  referenceMinute,
  onReferenceChange,
  textScalePercent,
}: DayOverviewProps) {
  const now = new Date();
  const isToday = selectedDate.toDateString() === now.toDateString();
  const nowPercent = ((now.getHours() * 60 + now.getMinutes()) / 1440) * 100;
  const scheduleItems = layoutSchedulesForDay(schedules, selectedDate);
  const templateItems = layoutTemplateBlocks(template?.blocks ?? []);
  const scheduleLevelCount = Math.max(1, ...scheduleItems.map((item) => item.level + 1));
  const templateLevelCount = Math.max(1, ...templateItems.map((item) => item.level + 1));
  const hiddenScheduleCount = scheduleItems.filter(
    (item) => item.level >= MAX_VISIBLE_LEVELS,
  ).length;
  const hiddenTemplateCount = templateItems.filter(
    (item) => item.level >= MAX_VISIBLE_LEVELS,
  ).length;
  const textScaleFactor = Math.max(1, textScalePercent / 100);
  const highTextScale = textScalePercent >= 175;
  const hideTemplateTrackFromAssistiveTech =
    highTextScale && templateState === "ready" && templateItems.length > 0;
  const overviewBlockHeight = OVERVIEW_BLOCK_HEIGHT * textScaleFactor;
  const scheduleLaneHeight = laneHeight(scheduleLevelCount, textScaleFactor);
  const templateLaneHeight = laneHeight(templateLevelCount, textScaleFactor);

  return (
    <section className="overview" aria-labelledby="overview-title">
      <div className="section-heading section-heading--compact">
        <div>
          <span className="eyebrow">{translate("features.schedule.DayOverview.001")}</span>
          <h2 id="overview-title">{translate("features.schedule.DayOverview.007")}</h2>
        </div>
        <span className="legend">
          <i className="legend__pending" /> {translate("features.schedule.DayOverview.003")}
        </span>
      </div>

      <div className="overview-axis" aria-hidden="true">
        {Array.from({ length: 25 }, (_, hour) => hour).map((hour) => (
          <span className="overview-tick" key={hour} style={{ left: `${(hour / 24) * 100}%` }}>
            {String(hour).padStart(2, "0")}
          </span>
        ))}
      </div>

      <div className="overview-lanes">
        <section className="overview-lane" aria-labelledby="schedule-lane-title">
          <div className="overview-lane__heading">
            <div>
              <span className="overview-lane__kind">
                {translate("features.schedule.DayOverview.008")}
              </span>
              <h3 id="schedule-lane-title">{translate("features.schedule.DayOverview.009")}</h3>
            </div>
          </div>
          <div
            className="overview-lane__track"
            aria-label={translate("features.schedule.DayOverview.010")}
            style={{ height: scheduleLaneHeight, minHeight: scheduleLaneHeight }}
          >
            {scheduleItems
              .filter((item) => item.level < MAX_VISIBLE_LEVELS)
              .map(({ schedule, startMinute, endMinute, level, levelCount, key }, index) => {
                const accessibleLabel = translate("features.schedule.DayOverview.005", [
                  schedule.title,
                  formatTime(schedule.startUtc),
                  formatTime(schedule.endUtc),
                ]);
                return (
                  <Tooltip key={key} label={accessibleLabel}>
                    <button
                      className="overview-event"
                      type="button"
                      aria-label={highTextScale ? undefined : accessibleLabel}
                      aria-hidden={highTextScale || undefined}
                      aria-pressed={highTextScale ? undefined : selectedId === schedule.id}
                      disabled={highTextScale}
                      tabIndex={highTextScale ? -1 : undefined}
                      data-overview-index={index + 1}
                      data-sync={schedule.syncStatus}
                      style={{
                        left: `${minuteToPercent(startMinute)}%`,
                        width: `${Math.max(0.8, minuteToPercent(endMinute) - minuteToPercent(startMinute))}%`,
                        top: blockTop(level, levelCount, textScaleFactor),
                        height: overviewBlockHeight,
                        zIndex: levelCount - level,
                        backgroundColor: schedule.color,
                      }}
                      onClick={() => onSelect(schedule)}
                    >
                      <span className="overview-event__content" aria-hidden="true">
                        <span className="overview-event__index">{index + 1}</span>
                        <span className="overview-event__start">{minuteToTime(startMinute)}</span>
                        <b className="overview-event__title">{schedule.title}</b>
                      </span>
                    </button>
                  </Tooltip>
                );
              })}
            {scheduleState === "loading" ? (
              <div className="overview-lane__state" role="status">
                {translate("features.schedule.DayOverview.026")}
              </div>
            ) : null}
            {scheduleState === "ready" && schedules.length === 0 ? (
              <div className="overview-lane__state">
                <span>{translate("features.schedule.DayOverview.011")}</span>
                <button className="button button--subtle" type="button" onClick={onCreateSchedule}>
                  {translate("features.schedule.TodayView.019")}
                </button>
              </div>
            ) : null}
            {hiddenScheduleCount > 0 ? (
              <span className="overview-overflow-summary">
                {translate("features.schedule.DayOverview.012", [hiddenScheduleCount])}
              </span>
            ) : null}
            {isToday ? (
              <i className="overview-now" style={{ left: `${nowPercent}%` }} aria-hidden="true" />
            ) : null}
          </div>
          {highTextScale ? (
            <ol
              className="overview-readable-list"
              aria-label={translate("features.schedule.DayOverview.010")}
            >
              {scheduleItems.map(({ schedule, startMinute, endMinute, key }, index) => (
                <li key={`readable-${key}`}>
                  <button type="button" onClick={() => onSelect(schedule)}>
                    <span>{index + 1}</span>
                    <time>{`${minuteToTime(startMinute)}–${minuteToTime(endMinute)}`}</time>
                    <strong>{schedule.title}</strong>
                  </button>
                </li>
              ))}
            </ol>
          ) : null}
        </section>

        <section className="overview-lane" aria-labelledby="template-lane-title">
          <div className="overview-lane__heading">
            <div>
              <span className="overview-lane__kind">
                {translate("features.schedule.DayOverview.013")}
              </span>
              <h3 id="template-lane-title">
                {template?.name ?? translate("features.schedule.DayOverview.014")}
              </h3>
            </div>
          </div>
          <div
            className="overview-lane__track overview-lane__track--template"
            role={
              !highTextScale && templateState === "ready" && templateItems.length > 0
                ? "list"
                : undefined
            }
            aria-hidden={hideTemplateTrackFromAssistiveTech || undefined}
            aria-label={translate("features.schedule.DayOverview.017")}
            style={{ height: templateLaneHeight, minHeight: templateLaneHeight }}
          >
            {templateState === "loading" ? (
              <div className="overview-lane__state" role="status">
                {translate("features.schedule.DayOverview.018")}
              </div>
            ) : null}
            {templateState === "error" ? (
              <div className="overview-lane__state">
                <span>{translate("features.schedule.DayOverview.019")}</span>
                <button className="button button--subtle" type="button" onClick={onRetryTemplate}>
                  {translate("features.schedule.DayOverview.020")}
                </button>
              </div>
            ) : null}
            {templateState === "ready" && !template ? (
              <div className="overview-lane__state">
                {translate("features.schedule.DayOverview.021")}
              </div>
            ) : null}
            {templateState === "ready" && template && template.blocks.length === 0 ? (
              <div className="overview-lane__state">
                {translate("features.schedule.DayOverview.022")}
              </div>
            ) : null}
            {templateState === "ready"
              ? templateItems
                  .filter((item) => item.level < MAX_VISIBLE_LEVELS)
                  .map(
                    (
                      { block, startMinute, endMinute, continuesNextDay, level, levelCount, key },
                      index,
                    ) => {
                      const timeRange = `${minuteToTime(startMinute)}–${minuteToTime(endMinute)}`;
                      const accessibleLabel = continuesNextDay
                        ? translate("features.schedule.DayOverview.023", [block.title, timeRange])
                        : translate("features.schedule.DayOverview.024", [block.title, timeRange]);
                      return (
                        <Tooltip key={key} label={accessibleLabel}>
                          <div
                            className="overview-template-block"
                            role={highTextScale ? undefined : "listitem"}
                            aria-label={highTextScale ? undefined : accessibleLabel}
                            data-overview-index={index + 1}
                            data-continues-next-day={continuesNextDay ? "true" : undefined}
                            style={{
                              left: `${minuteToPercent(startMinute)}%`,
                              width: `${Math.max(0.8, minuteToPercent(endMinute) - minuteToPercent(startMinute))}%`,
                              top: blockTop(level, levelCount, textScaleFactor),
                              height: overviewBlockHeight,
                              zIndex: levelCount - level,
                              backgroundColor: block.color,
                            }}
                          >
                            <span className="overview-template-block__content" aria-hidden="true">
                              <span className="overview-template-block__index">{index + 1}</span>
                              <span className="overview-template-block__start">
                                {minuteToTime(startMinute)}
                              </span>
                              <b className="overview-template-block__title">{block.title}</b>
                            </span>
                            {continuesNextDay ? (
                              <strong className="overview-template-continuation" aria-hidden="true">
                                {translate("features.schedule.DayOverview.025")}
                              </strong>
                            ) : null}
                          </div>
                        </Tooltip>
                      );
                    },
                  )
              : null}
            {templateState === "ready" && hiddenTemplateCount > 0 ? (
              <span className="overview-overflow-summary">
                {translate("features.schedule.DayOverview.012", [hiddenTemplateCount])}
              </span>
            ) : null}
            {isToday ? (
              <i className="overview-now" style={{ left: `${nowPercent}%` }} aria-hidden="true" />
            ) : null}
          </div>
          {highTextScale && templateState === "ready" && templateItems.length > 0 ? (
            <ol
              className="overview-readable-list"
              aria-label={translate("features.schedule.DayOverview.017")}
            >
              {templateItems.map(({ block, startMinute, endMinute, key }, index) => (
                <li key={`readable-${key}`}>
                  <span>
                    <b>{index + 1}</b>
                    <time>{`${minuteToTime(startMinute)}–${minuteToTime(endMinute)}`}</time>
                    <strong>{block.title}</strong>
                  </span>
                </li>
              ))}
            </ol>
          ) : null}
        </section>
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
        <output>{minuteToTime(referenceMinute)}</output>
      </label>
    </section>
  );
}
