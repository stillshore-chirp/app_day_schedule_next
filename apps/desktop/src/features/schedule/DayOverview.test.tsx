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
    onEditTemplate: vi.fn(),
    referenceMinute: 0,
    onReferenceChange: vi.fn(),
    ...overrides,
  };
  return { ...render(<DayOverview {...props} />), props };
}

describe("DayOverview", () => {
  it("renders one shared axis and independent schedule and template lanes", () => {
    const { container } = renderOverview();

    expect(screen.getByRole("heading", { name: "予定と日次テンプレート" })).toBeVisible();
    expect(screen.getByRole("heading", { name: "今日の予定" })).toBeVisible();
    expect(screen.getByRole("heading", { name: "集中日の型" })).toBeVisible();
    expect(container.querySelectorAll(".overview-axis")).toHaveLength(1);
    expect(container.querySelectorAll(".overview-tick")).toHaveLength(9);
  });

  it("keeps schedule selection while template blocks remain read-only information", async () => {
    const user = userEvent.setup();
    const { props } = renderOverview();

    const event = screen.getByRole("button", { name: /30分の短時間予定/ });
    expect(event).toHaveAttribute("data-density", "micro");
    await user.click(event);
    expect(props.onSelect).toHaveBeenCalledWith(schedule);

    const templateBlock = screen.getByRole("listitem", { name: /集中作業 09:00–10:00/ });
    expect(templateBlock.tagName).toBe("DIV");
    expect(screen.queryByRole("button", { name: /集中作業/ })).toBeNull();
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
    expect(scheduleTrack?.style.minHeight).toBe("74px");
  });

  it("uses the explicit edit action as the only template navigation control", async () => {
    const user = userEvent.setup();
    const { props } = renderOverview();

    await user.click(screen.getByRole("button", { name: "テンプレートを編集" }));
    expect(props.onEditTemplate).toHaveBeenCalledOnce();
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
        onEditTemplate={vi.fn()}
        referenceMinute={0}
        onReferenceChange={vi.fn()}
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
        onEditTemplate={vi.fn()}
        referenceMinute={0}
        onReferenceChange={vi.fn()}
      />,
    );
    expect(screen.getByText("表示できる日次テンプレートがありません")).toBeVisible();
    expect(screen.getByRole("button", { name: "日次テンプレートを作成" })).toBeVisible();
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
