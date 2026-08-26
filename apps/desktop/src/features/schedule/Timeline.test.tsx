import { fireEvent, render, screen, waitFor } from "@testing-library/react";
import { describe, expect, it, vi } from "vitest";
import type { Schedule } from "../../shared/contracts";
import { formatTime } from "../../shared/time";
import { Timeline } from "./Timeline";

const schedule: Schedule = {
  id: "00000000-0000-4000-8000-000000000010",
  title: "キーボード調整",
  description: "",
  location: "",
  startUtc: "2026-07-20T00:00:00.000Z",
  endUtc: "2026-07-20T01:00:00.000Z",
  timezoneId: "Asia/Tokyo",
  allDay: false,
  allDayStartDate: null,
  allDayEndDateExclusive: null,
  status: "scheduled",
  project: "",
  category: "",
  tags: [],
  color: "#336699",
  priority: "normal",
  recurrenceRule: null,
  recurrenceSupplementalLines: [],
  recurrenceExdates: [],
  startNotificationMinutes: null,
  endNotificationMinutes: null,
  syncStatus: "local_only",
  version: 0,
  deletedAt: null,
};

describe("Timeline interactions", () => {
  it("expands timeline time geometry enough to contain 250% text", () => {
    const { container } = render(
      <Timeline
        schedules={[schedule]}
        selectedDate={new Date("2026-07-20T00:00:00.000Z")}
        selectedId={null}
        snapMinutes={5}
        onSelect={vi.fn()}
        onCreate={vi.fn()}
        onCreateRange={vi.fn()}
        onAdjust={vi.fn().mockResolvedValue(undefined)}
        referenceMinute={0}
        textScalePercent={250}
      />,
    );

    expect(container.querySelector<HTMLElement>(".timeline-canvas")?.style.height).toBe("4320px");
    const readableItem = screen.getByRole("button", { name: /キーボード調整/ });
    expect(readableItem.closest(".timeline-readable-list")).not.toBeNull();
    expect(readableItem).toHaveTextContent("キーボード調整");
    const timelineEvent = container.querySelector<HTMLButtonElement>(".timeline-event");
    expect(timelineEvent?.style.height).toBe("180px");
    expect(timelineEvent).toHaveAttribute("aria-hidden", "true");
    expect(timelineEvent).toHaveAttribute("data-text-mode", "summary");
    expect(timelineEvent).toHaveAttribute("tabindex", "-1");
  });

  it("keeps long short-event names readable without overflowing their scaled time bars", () => {
    const title = "Quick-1787750482669 の長い短時間予定";
    const { container } = render(
      <Timeline
        schedules={[
          {
            ...schedule,
            title,
            endUtc: "2026-07-20T00:15:00.000Z",
          },
        ]}
        selectedDate={new Date("2026-07-20T00:00:00.000Z")}
        selectedId={null}
        snapMinutes={5}
        onSelect={vi.fn()}
        onCreate={vi.fn()}
        onCreateRange={vi.fn()}
        onAdjust={vi.fn().mockResolvedValue(undefined)}
        referenceMinute={0}
        textScalePercent={250}
      />,
    );

    const readableItem = screen.getByRole("button", { name: new RegExp(title) });
    expect(readableItem).toHaveTextContent(title);
    const timelineEvent = container.querySelector<HTMLButtonElement>(".timeline-event");
    expect(timelineEvent).toHaveAttribute("data-density", "compact");
    expect(timelineEvent).toHaveAttribute("data-text-mode", "summary");
    expect(timelineEvent?.querySelector(".timeline-event-title")).toHaveTextContent(title);
  });

  it("keeps the current-time line aligned with the scaled timeline", () => {
    vi.useFakeTimers();
    const now = new Date("2026-07-20T12:34:00.000Z");
    vi.setSystemTime(now);
    try {
      const { container } = render(
        <Timeline
          schedules={[]}
          selectedDate={new Date(now.getFullYear(), now.getMonth(), now.getDate())}
          selectedId={null}
          snapMinutes={5}
          onSelect={vi.fn()}
          onCreate={vi.fn()}
          onCreateRange={vi.fn()}
          onAdjust={vi.fn().mockResolvedValue(undefined)}
          referenceMinute={0}
          textScalePercent={250}
        />,
      );

      const line = container.querySelector<HTMLElement>(".current-time-line");
      expect(line).not.toBeNull();
      const expectedTop =
        ((now.getHours() * 60 + now.getMinutes() + now.getSeconds() / 60) / 60) * 180;
      expect(Number.parseFloat(line?.style.top ?? "NaN")).toBe(expectedTop);
    } finally {
      vi.useRealTimers();
    }
  });

  it("scales the minimum height of a short drag preview with the timeline", () => {
    const { container } = render(
      <Timeline
        schedules={[]}
        selectedDate={new Date(2026, 6, 20)}
        selectedId={null}
        snapMinutes={5}
        onSelect={vi.fn()}
        onCreate={vi.fn()}
        onCreateRange={vi.fn()}
        onAdjust={vi.fn().mockResolvedValue(undefined)}
        referenceMinute={0}
        textScalePercent={250}
      />,
    );
    const canvas = container.querySelector<HTMLElement>(".timeline-canvas");
    expect(canvas).not.toBeNull();
    vi.spyOn(canvas!, "getBoundingClientRect").mockReturnValue({
      top: 0,
      left: 0,
      right: 800,
      bottom: 4320,
      width: 800,
      height: 4320,
      x: 0,
      y: 0,
      toJSON: () => ({}),
    });

    fireEvent.pointerDown(canvas!, { button: 0, clientY: 0, pointerId: 1 });
    const preview = container.querySelector<HTMLElement>(".timeline-drag-preview");
    expect(preview?.style.height).toBe("70px");
  });

  it("uses a single-row layout for a 30-minute schedule without losing its full name", () => {
    render(
      <Timeline
        schedules={[
          {
            ...schedule,
            title: "30分の短時間予定",
            endUtc: "2026-07-20T00:30:00.000Z",
          },
        ]}
        selectedDate={new Date("2026-07-20T00:00:00.000Z")}
        selectedId={null}
        snapMinutes={5}
        onSelect={vi.fn()}
        onCreate={vi.fn()}
        onCreateRange={vi.fn()}
        onAdjust={vi.fn().mockResolvedValue(undefined)}
        referenceMinute={0}
        textScalePercent={100}
      />,
    );

    const event = screen.getByRole("button", { name: /30分の短時間予定/ });
    expect(event).toHaveAttribute("data-density", "compact");
    expect(event.querySelector(".timeline-event-title")).toHaveTextContent("30分の短時間予定");
    expect(event.querySelector(".timeline-event-time")).toHaveTextContent(
      `${formatTime(schedule.startUtc)}–${formatTime("2026-07-20T00:30:00.000Z")}`,
    );
  });

  it("provides a keyboard equivalent for moving an event", async () => {
    const adjust = vi.fn().mockResolvedValue(undefined);
    render(
      <Timeline
        schedules={[schedule]}
        selectedDate={new Date("2026-07-20T00:00:00.000Z")}
        selectedId={null}
        snapMinutes={5}
        onSelect={vi.fn()}
        onCreate={vi.fn()}
        onCreateRange={vi.fn()}
        onAdjust={adjust}
        referenceMinute={480}
        textScalePercent={100}
      />,
    );
    fireEvent.keyDown(screen.getByRole("button", { name: /キーボード調整/ }), {
      key: "ArrowDown",
    });
    await waitFor(() => expect(adjust).toHaveBeenCalledTimes(1));
    expect(adjust.mock.calls[0]?.[1]).toBe("2026-07-20T00:05:00.000Z");
    expect(adjust.mock.calls[0]?.[2]).toBe("2026-07-20T01:05:00.000Z");
  });

  it("opens a prefilled editor range after dragging empty time", () => {
    const createRange = vi.fn();
    const { container } = render(
      <Timeline
        schedules={[]}
        selectedDate={new Date(2026, 6, 20)}
        selectedId={null}
        snapMinutes={5}
        onSelect={vi.fn()}
        onCreate={vi.fn()}
        onCreateRange={createRange}
        onAdjust={vi.fn().mockResolvedValue(undefined)}
        referenceMinute={480}
        textScalePercent={100}
      />,
    );
    const canvas = container.querySelector<HTMLElement>(".timeline-canvas");
    expect(canvas).not.toBeNull();
    vi.spyOn(canvas!, "getBoundingClientRect").mockReturnValue({
      top: 0,
      left: 0,
      right: 800,
      bottom: 1728,
      width: 800,
      height: 1728,
      x: 0,
      y: 0,
      toJSON: () => ({}),
    });
    fireEvent.pointerDown(canvas!, { button: 0, clientY: 648, pointerId: 1 });
    fireEvent.pointerMove(canvas!, { clientY: 684, pointerId: 1 });
    fireEvent.pointerUp(canvas!, { clientY: 684, pointerId: 1 });
    expect(createRange).toHaveBeenCalledTimes(1);
    const [start, end] = createRange.mock.calls[0] as [string, string];
    expect((Date.parse(end) - Date.parse(start)) / 60_000).toBe(30);
  });

  it("virtualizes a 500-item day to the visible timeline window", async () => {
    const clientHeight = Object.getOwnPropertyDescriptor(HTMLElement.prototype, "clientHeight");
    Object.defineProperty(HTMLElement.prototype, "clientHeight", {
      configurable: true,
      get: function (this: HTMLElement) {
        return this.classList.contains("timeline-viewport") ? 300 : 0;
      },
    });
    const schedules = Array.from({ length: 500 }, (_, index): Schedule => {
      const start = new Date(2026, 6, 20, 0, index * 3);
      const end = new Date(start.getTime() + 2 * 60_000);
      return {
        ...schedule,
        id: `00000000-0000-4000-8${String(index).padStart(3, "0")}-000000000010`,
        title: `仮想化予定${index}`,
        startUtc: start.toISOString(),
        endUtc: end.toISOString(),
      };
    });
    try {
      render(
        <Timeline
          schedules={schedules}
          selectedDate={new Date(2026, 6, 20)}
          selectedId={null}
          snapMinutes={5}
          onSelect={vi.fn()}
          onCreate={vi.fn()}
          onCreateRange={vi.fn()}
          onAdjust={vi.fn().mockResolvedValue(undefined)}
          referenceMinute={480}
          textScalePercent={100}
        />,
      );
      await waitFor(() => {
        const visible = screen.getAllByRole("button", { name: /仮想化予定/ });
        expect(visible.length).toBeGreaterThan(0);
        expect(visible.length).toBeLessThan(180);
      });
    } finally {
      if (clientHeight) {
        Object.defineProperty(HTMLElement.prototype, "clientHeight", clientHeight);
      }
    }
  });
});
