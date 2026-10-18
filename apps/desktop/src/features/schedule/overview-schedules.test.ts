import { describe, expect, it, vi } from "vitest";
import type { Schedule, ScheduleQuery } from "../../shared/contracts";
import { fetchCenteredOverviewSchedules } from "./overview-schedules";

const query: ScheduleQuery = {
  startUtc: "2026-07-19T23:00:00.000Z",
  endUtc: "2026-07-21T02:00:00.000Z",
  search: "",
};

function makeSchedule(index: number, visibleTail = false, id?: string): Schedule {
  const day = visibleTail ? "2026-07-20" : "2026-07-19";
  const generatedId = String(index + 1).padStart(12, "0");
  return {
    id: id ?? `00000000-0000-4000-8000-${generatedId}`,
    title: visibleTail ? "Visible tail" : "Leading buffer",
    description: "",
    location: "",
    startUtc: `${day}T23:30:00.000Z`,
    endUtc: `${day}T23:45:00.000Z`,
    timezoneId: "UTC",
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
}

describe("fetchCenteredOverviewSchedules", () => {
  it("fetches the visible tail beyond the first 500 buffered schedules", async () => {
    const leadingScheduleId = makeSchedule(0).id;
    const schedules = Array.from({ length: 501 }, (_, index) =>
      makeSchedule(index, index === 500, index === 500 ? leadingScheduleId : undefined),
    );
    const listSchedules = vi.fn((pageQuery: ScheduleQuery) => {
      const offset = pageQuery.offset ?? 0;
      const limit = pageQuery.limit ?? 500;
      return Promise.resolve({
        items: schedules.slice(offset, offset + limit),
        total: schedules.length,
      });
    });

    const result = await fetchCenteredOverviewSchedules({ listSchedules }, query);

    expect(result.items).toHaveLength(501);
    expect(result.items.at(-1)?.title).toBe("Visible tail");
    expect(result.items.at(-1)?.id).toBe(result.items[0]?.id);
    expect(result.items.at(-1)?.startUtc).not.toBe(result.items[0]?.startUtc);
    expect(listSchedules).toHaveBeenCalledTimes(2);
    expect(listSchedules).toHaveBeenNthCalledWith(1, { ...query, limit: 500, offset: 0 });
    expect(listSchedules).toHaveBeenNthCalledWith(2, { ...query, limit: 500, offset: 500 });
  });

  it("keeps the normal one-page path to one call", async () => {
    const items = [makeSchedule(0)];
    const listSchedules = vi.fn().mockResolvedValue({ items, total: 1 });

    const result = await fetchCenteredOverviewSchedules({ listSchedules }, query);

    expect(result).toEqual({ items, total: 1 });
    expect(listSchedules).toHaveBeenCalledTimes(1);
  });

  it("stops when a later page is empty", async () => {
    const items = Array.from({ length: 500 }, (_, index) => makeSchedule(index));
    const listSchedules = vi
      .fn()
      .mockResolvedValueOnce({ items, total: 501 })
      .mockResolvedValueOnce({ items: [], total: 501 });

    const result = await fetchCenteredOverviewSchedules({ listSchedules }, query);

    expect(result.items).toHaveLength(500);
    expect(result.total).toBe(501);
    expect(listSchedules).toHaveBeenCalledTimes(2);
  });
});
