import type { CSSProperties } from "react";
import { differenceInCalendarDays } from "date-fns";
import {
  dayOverviewStartMinuteStep,
  maxDayOverviewStartMinute,
  normalizeDayOverviewStartMinute,
} from "../../shared/day-overview-preferences";
import { appLocale, translate } from "../../shared/i18n/messages";
import type { DayTemplate, Schedule } from "../../shared/contracts";
import { dayOverviewMinuteAt, dayOverviewRange, formatTime } from "../../shared/time";
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
  scheduleState: "loading" | "error" | "ready";
  onRetrySchedules?: () => void;
  selectedDate: Date;
  now?: Date;
  selectedId: string | null;
  onSelect: (schedule: Schedule) => void;
  onCreateSchedule: () => void;
  template: DayTemplate | null;
  templateState: "loading" | "error" | "ready";
  onRetryTemplate: () => void;
  overviewStartMinute: number;
  onOverviewStartMinuteChange: (minute: number) => void;
  textScalePercent: number;
  visibleLanes?: "both" | "schedule" | "template";
  showStartTimeSlider?: boolean;
}

function minuteToTime(minute: number): string {
  const normalized = ((minute % 1440) + 1440) % 1440;
  return `${String(Math.floor(normalized / 60)).padStart(2, "0")}:${String(normalized % 60).padStart(2, "0")}`;
}

function windowTimeLabel(displayMinute: number, startMinute: number): string {
  const absoluteMinute = startMinute + displayMinute;
  const dayOffset = Math.floor(absoluteMinute / 1440);
  const time = minuteToTime(absoluteMinute);
  if (dayOffset === 0) return time;
  return translate(
    dayOffset > 0 ? "features.schedule.DayOverview.031" : "features.schedule.DayOverview.032",
    [time],
  );
}

function axisTimeLabel(displayMinute: number, startMinute: number): string {
  const absoluteMinute = startMinute + displayMinute;
  const clockMinute = ((absoluteMinute % 1440) + 1440) % 1440;
  return String(Math.floor(clockMinute / 60)).padStart(2, "0");
}

function scheduleDateTimeLabel(iso: string, selectedDate: Date): string {
  const date = new Date(iso);
  const dayOffset = differenceInCalendarDays(date, selectedDate);
  if (dayOffset === 0) return formatTime(iso);
  return translate(
    dayOffset > 0 ? "features.schedule.DayOverview.033" : "features.schedule.DayOverview.034",
    [formatTime(iso)],
  );
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
  onRetrySchedules = () => undefined,
  selectedDate,
  now = new Date(),
  selectedId,
  onSelect,
  onCreateSchedule,
  template,
  templateState,
  onRetryTemplate,
  overviewStartMinute,
  onOverviewStartMinuteChange,
  textScalePercent,
  visibleLanes = "both",
  showStartTimeSlider = true,
}: DayOverviewProps) {
  const visibleStartMinute = normalizeDayOverviewStartMinute(overviewStartMinute);
  const nowDisplayMinute = dayOverviewMinuteAt(now, selectedDate, visibleStartMinute);
  const nowVisible = nowDisplayMinute !== null;
  const nowPercent = minuteToPercent(nowDisplayMinute ?? 0);
  const scheduleItems = layoutSchedulesForDay(schedules, selectedDate, visibleStartMinute);
  const templateItems = layoutTemplateBlocks(template?.blocks ?? [], visibleStartMinute);
  const rangeStartLabel = minuteToTime(visibleStartMinute);
  const rangeEndLabel = windowTimeLabel(1440, visibleStartMinute);
  const dateTimeFormatter = new Intl.DateTimeFormat(appLocale, {
    month: "numeric",
    day: "numeric",
  });
  const overviewRange = dayOverviewRange(selectedDate, visibleStartMinute);
  const overviewRangeStart = new Date(overviewRange.startUtc);
  const overviewRangeEnd = new Date(overviewRange.endUtc);
  const rangeCaption = translate("features.schedule.DayOverview.035", [
    dateTimeFormatter.format(overviewRangeStart),
    formatTime(overviewRange.startUtc),
    dateTimeFormatter.format(overviewRangeEnd),
    formatTime(overviewRange.endUtc),
  ]);
  const hourWidthPercent = (60 / 1440) * 100;
  const hourOffsetPercent = (((60 - (visibleStartMinute % 60)) % 60) / 1440) * 100;
  const trackStyle = {
    "--overview-hour-width": `${hourWidthPercent}%`,
    "--overview-hour-offset": `${hourOffsetPercent}%`,
  } as CSSProperties;
  const axisMinutes = [0, 1440];
  const firstHourMinute = Math.ceil(visibleStartMinute / 60) * 60;
  for (let hourMinute = firstHourMinute; hourMinute < visibleStartMinute + 1440; hourMinute += 60) {
    const displayMinute = hourMinute - visibleStartMinute;
    if (displayMinute === 0 || displayMinute === 1440) continue;
    if (displayMinute < 60 || 1440 - displayMinute < 60) continue;
    axisMinutes.push(displayMinute);
  }
  axisMinutes.sort((left, right) => left - right);
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
  const showScheduleLane = visibleLanes !== "template";
  const showTemplateLane = visibleLanes !== "schedule";

  return (
    <section className="overview" aria-labelledby="overview-title">
      <div className="section-heading section-heading--compact">
        <div>
          <span className="eyebrow">{translate("features.schedule.DayOverview.001")}</span>
          <h2 id="overview-title">{translate("features.schedule.DayOverview.007")}</h2>
          <p className="overview-range-caption">{rangeCaption}</p>
        </div>
        {showScheduleLane ? (
          <span className="legend">
            <i className="legend__pending" /> {translate("features.schedule.DayOverview.003")}
          </span>
        ) : null}
      </div>

      <div className="overview-axis" aria-hidden="true">
        {axisMinutes.map((minute) => (
          <span
            className="overview-tick"
            key={minute}
            style={{ left: `${minuteToPercent(minute)}%` }}
          >
            <span className="overview-tick__label">
              {axisTimeLabel(minute, visibleStartMinute)}
            </span>
          </span>
        ))}
      </div>

      <div className="overview-lanes">
        <section
          className="overview-lane"
          aria-labelledby="schedule-lane-title"
          hidden={!showScheduleLane}
        >
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
            aria-label={translate("features.schedule.DayOverview.010", [
              rangeStartLabel,
              rangeEndLabel,
            ])}
            style={{ ...trackStyle, height: scheduleLaneHeight, minHeight: scheduleLaneHeight }}
          >
            {scheduleItems
              .filter((item) => item.level < MAX_VISIBLE_LEVELS)
              .map(({ schedule, startMinute, endMinute, level, levelCount, key }, index) => {
                const accessibleLabel = translate("features.schedule.DayOverview.005", [
                  schedule.title,
                  scheduleDateTimeLabel(schedule.startUtc, selectedDate),
                  scheduleDateTimeLabel(schedule.endUtc, selectedDate),
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
                        <span className="overview-event__start">
                          {windowTimeLabel(startMinute, visibleStartMinute)}
                        </span>
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
            {scheduleState === "error" ? (
              <div className="overview-lane__state" role="alert">
                <span>{translate("features.schedule.DayOverview.028")}</span>
                <button className="button button--subtle" type="button" onClick={onRetrySchedules}>
                  {translate("features.schedule.DayOverview.020")}
                </button>
              </div>
            ) : null}
            {scheduleState === "ready" && scheduleItems.length === 0 ? (
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
            {nowVisible ? (
              <i className="overview-now" style={{ left: `${nowPercent}%` }} aria-hidden="true" />
            ) : null}
          </div>
          {highTextScale ? (
            <ol
              className="overview-readable-list"
              aria-label={translate("features.schedule.DayOverview.010", [
                rangeStartLabel,
                rangeEndLabel,
              ])}
            >
              {scheduleItems.map(({ schedule, startMinute, endMinute, key }, index) => (
                <li key={`readable-${key}`}>
                  <button type="button" onClick={() => onSelect(schedule)}>
                    <span>{index + 1}</span>
                    <time>{`${windowTimeLabel(startMinute, visibleStartMinute)}–${windowTimeLabel(endMinute, visibleStartMinute)}`}</time>
                    <strong>{schedule.title}</strong>
                  </button>
                </li>
              ))}
            </ol>
          ) : null}
        </section>

        <section
          className="overview-lane"
          aria-labelledby="template-lane-title"
          hidden={!showTemplateLane}
        >
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
            aria-label={translate("features.schedule.DayOverview.017", [
              rangeStartLabel,
              rangeEndLabel,
            ])}
            style={{ ...trackStyle, height: templateLaneHeight, minHeight: templateLaneHeight }}
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
                      {
                        block,
                        startMinute,
                        endMinute,
                        continuesNextDay,
                        startsBeforeWindow,
                        continuesAfterWindow,
                        level,
                        levelCount,
                        key,
                      },
                      index,
                    ) => {
                      const timeRange = `${windowTimeLabel(startMinute, visibleStartMinute)}–${windowTimeLabel(endMinute, visibleStartMinute)}`;
                      const blockLabel = continuesNextDay
                        ? translate("features.schedule.DayOverview.023", [block.title, timeRange])
                        : translate("features.schedule.DayOverview.024", [block.title, timeRange]);
                      const accessibleLabel = [
                        startsBeforeWindow ? translate("features.schedule.DayOverview.029") : null,
                        blockLabel,
                        continuesAfterWindow && !continuesNextDay
                          ? translate("features.schedule.DayOverview.030")
                          : null,
                      ]
                        .filter(Boolean)
                        .join("、");
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
                                {windowTimeLabel(startMinute, visibleStartMinute)}
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
            {nowVisible ? (
              <i className="overview-now" style={{ left: `${nowPercent}%` }} aria-hidden="true" />
            ) : null}
          </div>
          {highTextScale && templateState === "ready" && templateItems.length > 0 ? (
            <ol
              className="overview-readable-list"
              aria-label={translate("features.schedule.DayOverview.017", [
                rangeStartLabel,
                rangeEndLabel,
              ])}
            >
              {templateItems.map(
                (
                  {
                    block,
                    startMinute,
                    endMinute,
                    startsBeforeWindow,
                    continuesAfterWindow,
                    continuesNextDay,
                    key,
                  },
                  index,
                ) => (
                  <li key={`readable-${key}`}>
                    <span>
                      <b>{index + 1}</b>
                      {startsBeforeWindow ? (
                        <small>{translate("features.schedule.DayOverview.029")}</small>
                      ) : null}
                      <time>{`${windowTimeLabel(startMinute, visibleStartMinute)}–${windowTimeLabel(endMinute, visibleStartMinute)}`}</time>
                      <strong>{block.title}</strong>
                      {continuesAfterWindow && !continuesNextDay ? (
                        <small>{translate("features.schedule.DayOverview.030")}</small>
                      ) : null}
                    </span>
                  </li>
                ),
              )}
            </ol>
          ) : null}
        </section>
      </div>

      {showStartTimeSlider ? (
        <label className="reference-time-control">
          <span>{translate("features.schedule.DayOverview.006")}</span>
          <input
            type="range"
            min={0}
            max={maxDayOverviewStartMinute}
            step={dayOverviewStartMinuteStep}
            value={visibleStartMinute}
            onChange={(event) => onOverviewStartMinuteChange(Number(event.target.value))}
          />
          <output>{minuteToTime(visibleStartMinute)}</output>
        </label>
      ) : null}
    </section>
  );
}
