import { translate } from "../../shared/i18n/messages";
import {
  useEffect,
  useMemo,
  useRef,
  useState,
  type PointerEvent as ReactPointerEvent,
} from "react";
import type { Schedule } from "../../shared/contracts";
import { formatDuration, formatTime } from "../../shared/time";
import { assignTimelineLanes, isCurrent } from "./timeline-layout";

interface TimelineProps {
  schedules: Schedule[];
  selectedDate: Date;
  selectedId: string | null;
  snapMinutes: number;
  onSelect: (schedule: Schedule) => void;
  onCreate: () => void;
  onCreateRange: (startUtc: string, endUtc: string) => void;
  onAdjust: (schedule: Schedule, startUtc: string, endUtc: string) => Promise<void>;
  referenceMinute: number;
}

type DragKind = "create" | "move" | "resize-start" | "resize-end";

interface DragState {
  kind: DragKind;
  schedule: Schedule | null;
  originMinute: number;
  currentMinute: number;
  startUtc: string;
  endUtc: string;
  moved: boolean;
}

const ZOOM_LEVELS = [48, 60, 72, 96];

function initialZoom(): number {
  const stored = Number(localStorage.getItem("day-schedule-next.timeline.zoom"));
  return ZOOM_LEVELS.includes(stored) ? stored : 72;
}

export function Timeline({
  schedules,
  selectedDate,
  selectedId,
  snapMinutes,
  onSelect,
  onCreate,
  onCreateRange,
  onAdjust,
  referenceMinute,
}: TimelineProps) {
  const viewportRef = useRef<HTMLDivElement>(null);
  const canvasRef = useRef<HTMLDivElement>(null);
  const suppressClickRef = useRef(false);
  const [now, setNow] = useState(() => new Date());
  const [hourHeight, setHourHeight] = useState(initialZoom);
  const [drag, setDrag] = useState<DragState | null>(null);
  const [saving, setSaving] = useState(false);
  const [visibleRange, setVisibleRange] = useState({ startMinute: 0, endMinute: 1440 });
  const items = useMemo(
    () => assignTimelineLanes(schedules, selectedDate),
    [schedules, selectedDate],
  );
  const visibleItems = useMemo(
    () =>
      items.filter(
        (item) =>
          item.endMinute >= visibleRange.startMinute && item.startMinute <= visibleRange.endMinute,
      ),
    [items, visibleRange],
  );
  const isToday = selectedDate.toDateString() === now.toDateString();
  const nowMinute = now.getHours() * 60 + now.getMinutes() + now.getSeconds() / 60;

  useEffect(() => {
    const timer = window.setInterval(() => setNow(new Date()), 30_000);
    return () => window.clearInterval(timer);
  }, []);

  useEffect(() => {
    if (!viewportRef.current) return;
    const targetHour = isToday ? Math.max(0, now.getHours() - 2) : 7;
    const storageKey = `day-schedule-next.timeline.scroll.${localDateKey(selectedDate)}`;
    const stored = Number(sessionStorage.getItem(storageKey));
    viewportRef.current.scrollTop =
      Number.isFinite(stored) && stored > 0 ? stored : targetHour * hourHeight;
    const viewport = viewportRef.current;
    const updateViewport = () => {
      sessionStorage.setItem(storageKey, String(viewport.scrollTop));
      if (viewport.clientHeight <= 0) return;
      const startMinute = Math.max(0, (viewport.scrollTop / hourHeight) * 60 - 60);
      const endMinute = Math.min(
        1440,
        ((viewport.scrollTop + viewport.clientHeight) / hourHeight) * 60 + 60,
      );
      setVisibleRange((current) =>
        Math.abs(current.startMinute - startMinute) < 1 &&
        Math.abs(current.endMinute - endMinute) < 1
          ? current
          : { startMinute, endMinute },
      );
    };
    updateViewport();
    viewport.addEventListener("scroll", updateViewport, { passive: true });
    return () => viewport.removeEventListener("scroll", updateViewport);
  }, [hourHeight, isToday, selectedDate]);

  useEffect(() => {
    if (viewportRef.current) {
      viewportRef.current.scrollTop = Math.max(0, (referenceMinute / 60) * hourHeight - hourHeight);
    }
  }, [hourHeight, referenceMinute]);

  useEffect(() => {
    if (!drag) return;
    const cancel = (event: KeyboardEvent) => {
      if (event.key === "Escape") {
        event.preventDefault();
        setDrag(null);
      }
    };
    window.addEventListener("keydown", cancel);
    return () => window.removeEventListener("keydown", cancel);
  }, [drag]);

  const snappedMinute = (event: ReactPointerEvent): number => {
    const canvas = canvasRef.current;
    if (!canvas) return 0;
    const bounds = canvas.getBoundingClientRect();
    const raw = ((event.clientY - bounds.top) / hourHeight) * 60;
    return Math.max(0, Math.min(1440, Math.round(raw / snapMinutes) * snapMinutes));
  };

  const beginCreate = (event: ReactPointerEvent<HTMLDivElement>) => {
    if (event.button !== 0 || (event.target as HTMLElement).closest(".timeline-event")) return;
    const minute = snappedMinute(event);
    const start = dateAtMinute(selectedDate, Math.min(minute, 1439));
    const end = new Date(start.getTime() + Math.max(1, snapMinutes) * 60_000);
    event.currentTarget.setPointerCapture(event.pointerId);
    setDrag({
      kind: "create",
      schedule: null,
      originMinute: minute,
      currentMinute: minute,
      startUtc: start.toISOString(),
      endUtc: end.toISOString(),
      moved: false,
    });
  };

  const beginEventDrag = (
    event: ReactPointerEvent<HTMLButtonElement | HTMLSpanElement>,
    schedule: Schedule,
    kind: Exclude<DragKind, "create">,
  ) => {
    if (event.button !== 0) return;
    event.preventDefault();
    event.stopPropagation();
    event.currentTarget.setPointerCapture(event.pointerId);
    const minute = snappedMinute(event);
    setDrag({
      kind,
      schedule,
      originMinute: minute,
      currentMinute: minute,
      startUtc: schedule.startUtc,
      endUtc: schedule.endUtc,
      moved: false,
    });
  };

  const updateDrag = (event: ReactPointerEvent<HTMLDivElement>) => {
    if (!drag) return;
    const minute = snappedMinute(event);
    const delta = minute - drag.originMinute;
    const next = { ...drag, currentMinute: minute, moved: drag.moved || delta !== 0 };
    if (drag.kind === "create") {
      const first = Math.min(drag.originMinute, minute);
      const last = Math.max(drag.originMinute, minute);
      const start = dateAtMinute(selectedDate, Math.min(first, 1439));
      const duration = Math.max(snapMinutes, last - first || snapMinutes);
      next.startUtc = start.toISOString();
      next.endUtc = new Date(start.getTime() + duration * 60_000).toISOString();
    } else if (drag.schedule) {
      const originStart = Date.parse(drag.schedule.startUtc);
      const originEnd = Date.parse(drag.schedule.endUtc);
      if (drag.kind === "move") {
        next.startUtc = new Date(originStart + delta * 60_000).toISOString();
        next.endUtc = new Date(originEnd + delta * 60_000).toISOString();
      } else if (drag.kind === "resize-start") {
        next.startUtc = new Date(
          Math.min(originStart + delta * 60_000, originEnd - 60_000),
        ).toISOString();
      } else {
        next.endUtc = new Date(
          Math.max(originEnd + delta * 60_000, originStart + 60_000),
        ).toISOString();
      }
    }
    setDrag(next);
    autoScroll(event.clientY);
  };

  const finishDrag = async () => {
    if (!drag) return;
    const completed = drag;
    setDrag(null);
    if (!completed.moved && completed.kind !== "create") return;
    suppressClickRef.current = completed.moved;
    window.setTimeout(() => {
      suppressClickRef.current = false;
    }, 0);
    if (completed.kind === "create") {
      onCreateRange(completed.startUtc, completed.endUtc);
      return;
    }
    if (!completed.schedule) return;
    setSaving(true);
    try {
      await onAdjust(completed.schedule, completed.startUtc, completed.endUtc);
    } finally {
      setSaving(false);
    }
  };

  const autoScroll = (clientY: number) => {
    const viewport = viewportRef.current;
    if (!viewport) return;
    const bounds = viewport.getBoundingClientRect();
    if (clientY < bounds.top + 44) viewport.scrollBy({ top: -32 });
    if (clientY > bounds.bottom - 44) viewport.scrollBy({ top: 32 });
  };

  const keyboardAdjust = async (event: React.KeyboardEvent, schedule: Schedule) => {
    if (!(["ArrowUp", "ArrowDown"] as string[]).includes(event.key)) return;
    event.preventDefault();
    const direction = event.key === "ArrowUp" ? -1 : 1;
    const delta = direction * snapMinutes * 60_000;
    let start = Date.parse(schedule.startUtc);
    let end = Date.parse(schedule.endUtc);
    if (event.shiftKey) end = Math.max(start + 60_000, end + delta);
    else if (event.altKey) start = Math.min(end - 60_000, start + delta);
    else {
      start += delta;
      end += delta;
    }
    setSaving(true);
    try {
      await onAdjust(schedule, new Date(start).toISOString(), new Date(end).toISOString());
    } finally {
      setSaving(false);
    }
  };

  const changeZoom = (direction: -1 | 1) => {
    const currentIndex = ZOOM_LEVELS.indexOf(hourHeight);
    const next =
      ZOOM_LEVELS[Math.max(0, Math.min(ZOOM_LEVELS.length - 1, currentIndex + direction))];
    if (!next) return;
    setHourHeight(next);
    localStorage.setItem("day-schedule-next.timeline.zoom", String(next));
  };

  const preview = drag ? previewPosition(drag, selectedDate, hourHeight) : null;

  return (
    <section className="timeline-panel" aria-labelledby="timeline-title">
      <div className="section-heading">
        <div>
          <span className="eyebrow">{translate("features.schedule.Timeline.001")}</span>
          <h2 id="timeline-title">{translate("features.schedule.Timeline.002")}</h2>
        </div>
        <div className="button-row">
          <button
            className="icon-button"
            type="button"
            aria-label={translate("features.schedule.Timeline.003")}
            onClick={() => changeZoom(-1)}
          >
            −
          </button>
          <output className="zoom-label" aria-live="polite">
            {Math.round((hourHeight / 72) * 100)}%
          </output>
          <button
            className="icon-button"
            type="button"
            aria-label={translate("features.schedule.Timeline.004")}
            onClick={() => changeZoom(1)}
          >
            ＋
          </button>
          <button className="button button--subtle" type="button" onClick={onCreate}>
            {translate("features.schedule.Timeline.005")}
          </button>
        </div>
      </div>
      <p className="timeline-instructions" id="timeline-instructions">
        {translate("features.schedule.Timeline.006")}
      </p>
      {saving ? (
        <p className="save-indicator" role="status">
          {translate("features.schedule.Timeline.007")}
        </p>
      ) : null}
      <div
        className="timeline-viewport"
        ref={viewportRef}
        tabIndex={0}
        aria-label={translate("features.schedule.Timeline.008")}
        aria-describedby="timeline-instructions"
      >
        <div
          className="timeline-canvas"
          ref={canvasRef}
          style={{ height: 24 * hourHeight }}
          onPointerDown={beginCreate}
          onPointerMove={updateDrag}
          onPointerUp={() => void finishDrag()}
          onPointerCancel={() => setDrag(null)}
        >
          {Array.from({ length: 25 }, (_, hour) => (
            <div className="timeline-hour" key={hour} style={{ top: hour * hourHeight }}>
              <span>{String(hour).padStart(2, "0")}:00</span>
            </div>
          ))}
          {visibleItems.map((item) => {
            const top = (item.startMinute / 60) * hourHeight;
            const height = Math.max(28, ((item.endMinute - item.startMinute) / 60) * hourHeight);
            const width = `calc(${100 / item.laneCount}% - 8px)`;
            const left = `calc(${(item.lane * 100) / item.laneCount}% + 4px)`;
            const current = isToday && isCurrent(item.schedule, now);
            const density = height < (current ? 84 : 56) ? "compact" : "regular";
            const detailsId = `timeline-details-${item.schedule.id}`;
            return (
              <button
                className="timeline-event"
                key={`${item.schedule.id}-${item.schedule.startUtc}`}
                type="button"
                aria-label={translate("features.schedule.Timeline.009", [
                  item.schedule.title,
                  formatTime(item.schedule.startUtc),
                  formatTime(item.schedule.endUtc),
                  item.schedule.syncStatus,
                ])}
                aria-describedby={detailsId}
                aria-pressed={selectedId === item.schedule.id}
                data-current={current || undefined}
                data-density={density}
                data-sync={item.schedule.syncStatus}
                data-priority={item.schedule.priority}
                style={{ top, height, width, left, backgroundColor: item.schedule.color }}
                onPointerDown={(event) => beginEventDrag(event, item.schedule, "move")}
                onClick={() => {
                  if (!suppressClickRef.current) onSelect(item.schedule);
                }}
                onDoubleClick={() => onSelect(item.schedule)}
                onKeyDown={(event) => void keyboardAdjust(event, item.schedule)}
              >
                <span
                  className="timeline-resize-handle timeline-resize-handle--start"
                  aria-hidden="true"
                  onPointerDown={(event) => beginEventDrag(event, item.schedule, "resize-start")}
                />
                <strong className="timeline-event-title">{item.schedule.title}</strong>
                <span className="timeline-event-time">
                  {formatTime(item.schedule.startUtc)}–{formatTime(item.schedule.endUtc)}
                </span>
                {current ? (
                  <span className="state-chip">{translate("features.schedule.Timeline.010")}</span>
                ) : null}
                <span className="timeline-event-details" id={detailsId} role="tooltip">
                  <strong>{item.schedule.title}</strong>
                  {item.schedule.description ? <span>{item.schedule.description}</span> : null}
                  {item.schedule.location ? (
                    <span>
                      {translate("features.schedule.Timeline.011")}
                      {item.schedule.location}
                    </span>
                  ) : null}
                  {item.schedule.project || item.schedule.category ? (
                    <span>
                      {translate("features.schedule.Timeline.012")}
                      {item.schedule.project || translate("features.schedule.Timeline.013")} /{" "}
                      {item.schedule.category || translate("features.schedule.Timeline.014")}
                    </span>
                  ) : null}
                  {item.schedule.tags.length ? (
                    <span>
                      {translate("features.schedule.Timeline.015")}
                      {item.schedule.tags.join("、")}
                    </span>
                  ) : null}
                  <span>
                    {translate("features.schedule.Timeline.016")}
                    {item.schedule.syncStatus}
                  </span>
                </span>
                <span
                  className="timeline-resize-handle timeline-resize-handle--end"
                  aria-hidden="true"
                  onPointerDown={(event) => beginEventDrag(event, item.schedule, "resize-end")}
                />
              </button>
            );
          })}
          {preview ? (
            <div
              className="timeline-drag-preview"
              style={{ top: preview.top, height: preview.height }}
              role="status"
            >
              <strong>
                {drag?.kind === "create"
                  ? translate("features.schedule.Timeline.017")
                  : drag?.schedule?.title}
              </strong>
              <span>
                {formatTime(drag?.startUtc ?? "")}–{formatTime(drag?.endUtc ?? "")}・
                {formatDuration(preview.durationMinutes)}
              </span>
              <small>{translate("features.schedule.Timeline.018")}</small>
            </div>
          ) : null}
          {isToday ? (
            <div
              className="current-time-line"
              style={{ top: (nowMinute / 60) * hourHeight }}
              aria-hidden="true"
            >
              <span>{formatTime(now.toISOString())}</span>
            </div>
          ) : null}
        </div>
      </div>
    </section>
  );
}

function dateAtMinute(date: Date, minute: number): Date {
  const value = new Date(date);
  value.setHours(0, minute, 0, 0);
  return value;
}

function localDateKey(date: Date): string {
  return `${date.getFullYear()}-${date.getMonth() + 1}-${date.getDate()}`;
}

function previewPosition(drag: DragState, selectedDate: Date, hourHeight: number) {
  const dayStart = dateAtMinute(selectedDate, 0).getTime();
  const startMinute = (Date.parse(drag.startUtc) - dayStart) / 60_000;
  const endMinute = (Date.parse(drag.endUtc) - dayStart) / 60_000;
  return {
    top: (Math.max(0, startMinute) / 60) * hourHeight,
    height: Math.max(
      28,
      ((Math.min(1440, endMinute) - Math.max(0, startMinute)) / 60) * hourHeight,
    ),
    durationMinutes: Math.max(
      1,
      Math.round((Date.parse(drag.endUtc) - Date.parse(drag.startUtc)) / 60_000),
    ),
  };
}
