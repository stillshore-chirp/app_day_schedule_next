import { describe, expect, it } from "vitest";
import type { DayTemplate, QuickBlock } from "../../shared/contracts";
import { layoutSchedulesForDay } from "./overview-layout";
import { quickBlocksForDayOverview } from "./quick-block-schedules";
import { resolveDisplayedTemplate } from "./template-selection";

function template(id: string, sortOrder: number): DayTemplate {
  return {
    id,
    name: id,
    description: "",
    color: "#6F96F4",
    weekdaysMask: 127,
    isBuiltin: false,
    sortOrder,
    version: 0,
    blocks: [],
  };
}

describe("resolveDisplayedTemplate", () => {
  const first = template("00000000-0000-4000-8000-000000000001", 0);
  const second = template("00000000-0000-4000-8000-000000000002", 1);

  it("uses lastTemplateId when it exists", () => {
    expect(resolveDisplayedTemplate([first, second], second.id)).toBe(second);
  });

  it("falls back deterministically for null or stale IDs", () => {
    expect(resolveDisplayedTemplate([first, second], null)).toBe(first);
    expect(resolveDisplayedTemplate([first, second], "00000000-0000-4000-8000-000000000099")).toBe(
      first,
    );
  });

  it("returns null when no template exists", () => {
    expect(resolveDisplayedTemplate([], null)).toBeNull();
  });
});

describe("quickBlocksForDayOverview", () => {
  it("includes a previous-day Quick Block that crosses the selected start time", () => {
    const selectedDate = new Date(2026, 0, 2, 12);
    const previousDate = new Date(selectedDate);
    previousDate.setDate(previousDate.getDate() - 1);
    previousDate.setHours(23, 0, 0, 0);
    const quickBlock: QuickBlock = {
      id: "00000000-0000-4000-8000-000000000051",
      title: "夜間の集中ブロック",
      startMinute: 23 * 60,
      durationMinutes: 9 * 60,
      timezoneId: Intl.DateTimeFormat().resolvedOptions().timeZone || "Asia/Tokyo",
      color: "#6F96F4",
      project: "",
      category: "",
      startNotificationMinutes: null,
      endNotificationMinutes: null,
      isActive: true,
      sortOrder: 0,
      version: 0,
    };

    const schedules = quickBlocksForDayOverview([quickBlock], selectedDate);
    const previousOccurrence = schedules.find(
      (schedule) => new Date(schedule.startUtc).getTime() === previousDate.getTime(),
    );
    const visible = layoutSchedulesForDay(schedules, selectedDate, 7 * 60).find(
      (item) => item.schedule.startUtc === previousOccurrence?.startUtc,
    );

    expect(visible).toMatchObject({ startMinute: 0, endMinute: 60 });
  });
});
