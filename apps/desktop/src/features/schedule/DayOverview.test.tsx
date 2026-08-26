import { render, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { describe, expect, it, vi } from "vitest";
import type { DayTemplate, Schedule } from "../../shared/contracts";
import { DayOverview } from "./DayOverview";

const schedule: Schedule = {
  id: "00000000-0000-4000-8000-000000000011",
  title: "30分の短時間予定",
  description: "",
  location: "",
  startUtc: new Date(2026, 6, 20, 9).toISOString(),
  endUtc: new Date(2026, 6, 20, 9, 30).toISOString(),
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

const template: DayTemplate = {
  id: "00000000-0000-4000-8000-000000000021",
  name: "集中日の型",
  description: "",
  color: "#6F96F4",
  weekdaysMask: 127,
  isBuiltin: false,
  sortOrder: 0,
  version: 0,
  blocks: [
    {
      id: "00000000-0000-4000-8000-000000000022",
      title: "集中作業",
      startMinute: 9 * 60,
      durationMinutes: 60,
      color: "#6F96F4",
      project: "",
      category: "",
      sortOrder: 0,
    },
  ],
};

function renderOverview(overrides: Partial<React.ComponentProps<typeof DayOverview>> = {}) {
  const props: React.ComponentProps<typeof DayOverview> = {
    schedules: [schedule],
    scheduleState: "ready",
    selectedDate: new Date(2026, 6, 20),
    selectedId: null,
    onSelect: vi.fn(),
    onCreateSchedule: vi.fn(),
    template,
    templateState: "ready",
    onRetryTemplate: vi.fn(),
    referenceMinute: 0,
    onReferenceChange: vi.fn(),
    textScalePercent: 100,
    ...overrides,
  };
  return { ...render(<DayOverview {...props} />), props };
}

describe("DayOverview", () => {
  it("expands only the overview vertical geometry needed by 250% text", () => {
    const { container } = renderOverview({ textScalePercent: 250 });
    const track = container.querySelector<HTMLElement>(".overview-lane__track");
    const templateTrack = container.querySelector<HTMLElement>(".overview-lane__track--template");
    const event = container.querySelector<HTMLElement>(".overview-event");

    expect(track?.style.height).toBe("190px");
    expect(event?.style.height).toBe("150px");
    expect(screen.getByRole("button", { name: /09:00–09:30.*30分の短時間予定/ })).toBeVisible();
    expect(event).toHaveAttribute("aria-hidden", "true");
    expect(templateTrack).toHaveAttribute("aria-hidden", "true");
  });

  it("renders one shared axis and independent schedule and template lanes", () => {
    const { container } = renderOverview();

    expect(screen.getByRole("heading", { name: "予定と日次テンプレート" })).toBeVisible();
    expect(screen.getByRole("heading", { name: "今日の予定" })).toBeVisible();
    expect(screen.getByRole("heading", { name: "集中日の型" })).toBeVisible();
    expect(container.querySelectorAll(".overview-axis")).toHaveLength(1);
    expect(container.querySelectorAll(".overview-tick")).toHaveLength(25);
    expect(
      Array.from(container.querySelectorAll<HTMLElement>(".overview-tick")).map(
        (tick) => tick.textContent,
      ),
    ).toEqual(Array.from({ length: 25 }, (_, hour) => String(hour).padStart(2, "0")));
  });

  it("keeps schedule selection while template blocks remain read-only information", async () => {
    const user = userEvent.setup();
    const { container, props } = renderOverview();

    const event = screen.getByRole("button", { name: /30分の短時間予定/ });
    expect(event).toHaveAttribute("data-overview-index", "1");
    expect(event).toHaveAttribute("aria-label", "30分の短時間予定 09:00から09:30");
    expect(event.querySelector(".overview-event__index")).toHaveTextContent("1");
    expect(event.querySelector(".overview-event__start")).toHaveTextContent("09:00");
    expect(event.querySelector(".overview-event__title")).toHaveTextContent("30分の短時間予定");
    await user.click(event);
    expect(props.onSelect).toHaveBeenCalledWith(schedule);

    const templateBlock = screen.getByRole("listitem", { name: /集中作業 09:00–10:00/ });
    expect(templateBlock.tagName).toBe("DIV");
    expect(templateBlock).toHaveAttribute("data-overview-index", "1");
    expect(templateBlock).toHaveAttribute("aria-label", "集中作業 09:00–10:00");
    expect(templateBlock.querySelector(".overview-template-block__index")).toHaveTextContent("1");
    expect(templateBlock.querySelector(".overview-template-block__start")).toHaveTextContent(
      "09:00",
    );
    expect(templateBlock.querySelector(".overview-template-block__title")).toHaveTextContent(
      "集中作業",
    );
    expect(container.querySelectorAll('[data-density="micro"]')).toHaveLength(0);
    expect(screen.queryByRole("button", { name: /集中作業/ })).toBeNull();
  });

  it("numbers each lane independently in stable start-time order", () => {
    const laterSchedule = {
      ...schedule,
      id: "00000000-0000-4000-8000-000000000012",
      title: "午後の予定",
      startUtc: new Date(2026, 6, 20, 13).toISOString(),
      endUtc: new Date(2026, 6, 20, 14).toISOString(),
    };
    const laterBlock = {
      ...template.blocks[0]!,
      id: "00000000-0000-4000-8000-000000000023",
      title: "午後の型",
      startMinute: 13 * 60,
    };
    const { container } = renderOverview({
      schedules: [laterSchedule, schedule],
      template: { ...template, blocks: [laterBlock, template.blocks[0]!] },
    });

    expect(
      Array.from(container.querySelectorAll<HTMLElement>(".overview-event")).map((event) => [
        event.dataset.overviewIndex,
        event.querySelector(".overview-event__title")?.textContent,
      ]),
    ).toEqual([
      ["1", "30分の短時間予定"],
      ["2", "午後の予定"],
    ]);
    expect(
      Array.from(container.querySelectorAll<HTMLElement>(".overview-template-block")).map(
        (block) => [
          block.dataset.overviewIndex,
          block.querySelector(".overview-template-block__title")?.textContent,
        ],
      ),
    ).toEqual([
      ["1", "集中作業"],
      ["2", "午後の型"],
    ]);
  });

  it("uses identical horizontal geometry for identical minute intervals in both lanes", () => {
    renderOverview({
      template: {
        ...template,
        blocks: [{ ...template.blocks[0]!, durationMinutes: 30 }],
      },
    });

    const scheduleBlock = screen.getByRole("button", { name: /30分の短時間予定/ });
    const templateBlock = screen.getByRole("listitem", { name: /集中作業 09:00–09:30/ });
    expect(templateBlock.style.left).toBe(scheduleBlock.style.left);
    expect(templateBlock.style.width).toBe(scheduleBlock.style.width);
  });

  it("makes both schedule strips 2.5 times taller without spending vertical space on headings", () => {
    const { container } = renderOverview();

    const tracks = Array.from(container.querySelectorAll<HTMLElement>(".overview-lane__track"));
    expect(tracks.map((track) => [track.style.height, track.style.minHeight])).toEqual([
      ["76px", "76px"],
      ["76px", "76px"],
    ]);

    const scheduleBlock = screen.getByRole("button", { name: /30分の短時間予定/ });
    const templateBlock = screen.getByRole("listitem", { name: /集中作業/ });
    expect(scheduleBlock.style.height).toBe("60px");
    expect(templateBlock.style.height).toBe("60px");
  });

  it("keeps every visible overlap level inside its own lane height", () => {
    const oneHour = {
      ...schedule,
      endUtc: new Date(2026, 6, 20, 10).toISOString(),
    };
    const overlapping = {
      ...schedule,
      id: "00000000-0000-4000-8000-000000000012",
      title: "重なる予定",
      startUtc: new Date(2026, 6, 20, 9, 55).toISOString(),
      endUtc: new Date(2026, 6, 20, 10, 40).toISOString(),
    };
    const { container } = renderOverview({ schedules: [oneHour, overlapping] });

    const scheduleTrack = container.querySelector<HTMLElement>(".overview-lane__track");
    expect(scheduleTrack?.style.height).toBe("135px");
    expect(scheduleTrack?.style.minHeight).toBe("135px");
  });

  it("keeps template editing out of the Today overview", () => {
    renderOverview();

    expect(screen.queryByRole("button", { name: "テンプレートを編集" })).toBeNull();
  });

  it("keeps the board and schedule creation action when the day has no schedules", async () => {
    const user = userEvent.setup();
    const { props } = renderOverview({ schedules: [] });

    expect(screen.getByText("今日の予定はありません")).toBeVisible();
    expect(screen.getByRole("heading", { name: "集中日の型" })).toBeVisible();
    await user.click(screen.getByRole("button", { name: "予定を作成" }));
    expect(props.onCreateSchedule).toHaveBeenCalledOnce();
  });

  it("isolates template loading, failure, retry, and empty states from schedules", async () => {
    const user = userEvent.setup();
    const retry = vi.fn();
    const { rerender } = renderOverview({
      template: null,
      templateState: "loading",
      onRetryTemplate: retry,
    });
    expect(screen.getByText("日次テンプレートを読み込み中")).toBeVisible();
    expect(screen.getByRole("button", { name: /30分の短時間予定/ })).toBeVisible();

    rerender(
      <DayOverview
        schedules={[schedule]}
        scheduleState="ready"
        selectedDate={new Date(2026, 6, 20)}
        selectedId={null}
        onSelect={vi.fn()}
        onCreateSchedule={vi.fn()}
        template={null}
        templateState="error"
        onRetryTemplate={retry}
        referenceMinute={0}
        onReferenceChange={vi.fn()}
        textScalePercent={100}
      />,
    );
    await user.click(screen.getByRole("button", { name: "再試行" }));
    expect(retry).toHaveBeenCalledOnce();

    rerender(
      <DayOverview
        schedules={[schedule]}
        scheduleState="ready"
        selectedDate={new Date(2026, 6, 20)}
        selectedId={null}
        onSelect={vi.fn()}
        onCreateSchedule={vi.fn()}
        template={null}
        templateState="ready"
        onRetryTemplate={retry}
        referenceMinute={0}
        onReferenceChange={vi.fn()}
        textScalePercent={100}
      />,
    );
    expect(screen.getByText("表示できる日次テンプレートがありません")).toBeVisible();
    expect(screen.queryByRole("button", { name: "日次テンプレートを作成" })).toBeNull();
  });

  it("keeps template recovery states reachable at high text scale", () => {
    const { container, rerender } = renderOverview({
      template: null,
      templateState: "loading",
      textScalePercent: 250,
    });
    const templateTrack = container.querySelector<HTMLElement>(".overview-lane__track--template");

    expect(templateTrack).not.toHaveAttribute("aria-hidden");
    expect(screen.getByText("日次テンプレートを読み込み中")).toBeVisible();

    rerender(
      <DayOverview
        schedules={[schedule]}
        scheduleState="ready"
        selectedDate={new Date(2026, 6, 20)}
        selectedId={null}
        onSelect={vi.fn()}
        onCreateSchedule={vi.fn()}
        template={null}
        templateState="error"
        onRetryTemplate={vi.fn()}
        referenceMinute={0}
        onReferenceChange={vi.fn()}
        textScalePercent={250}
      />,
    );

    expect(templateTrack).not.toHaveAttribute("aria-hidden");
    expect(screen.getByRole("button", { name: "再試行" })).toBeVisible();
  });

  it("announces a cross-midnight template block without wrapping it to the next day", () => {
    renderOverview({
      template: {
        ...template,
        blocks: [
          {
            ...template.blocks[0]!,
            startMinute: 1439,
            durationMinutes: 60,
          },
        ],
      },
    });

    expect(
      screen.getByRole("listitem", {
        name: "集中作業 23:59–24:00、翌日へ継続",
      }),
    ).toHaveAttribute("data-continues-next-day", "true");
  });
});
