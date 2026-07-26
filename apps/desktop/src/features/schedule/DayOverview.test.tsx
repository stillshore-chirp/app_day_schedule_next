import { render, screen } from "@testing-library/react";
import { describe, expect, it, vi } from "vitest";
import type { Schedule } from "../../shared/contracts";
import { DayOverview } from "./DayOverview";

const schedule: Schedule = {
  id: "00000000-0000-4000-8000-000000000011",
  title: "30分の短時間予定",
  description: "",
  location: "",
  startUtc: "2026-07-20T00:00:00.000Z",
  endUtc: "2026-07-20T00:30:00.000Z",
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

describe("DayOverview", () => {
  it("renders a short schedule as a marker with full tooltip and accessible text", () => {
    render(
      <DayOverview
        schedules={[schedule]}
        selectedDate={new Date("2026-07-20T00:00:00.000Z")}
        selectedId={null}
        onSelect={vi.fn()}
        referenceMinute={0}
        onReferenceChange={vi.fn()}
      />,
    );

    const event = screen.getByRole("button", { name: /30分の短時間予定/ });
    expect(event).toHaveAttribute("data-density", "micro");
    expect(event).toHaveAttribute("title", expect.stringContaining("30分の短時間予定"));
  });
});
