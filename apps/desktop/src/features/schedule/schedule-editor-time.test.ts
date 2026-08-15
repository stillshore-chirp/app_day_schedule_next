import { describe, expect, it } from "vitest";
import {
  addLocalMinutes,
  combineLocalDateAndTime,
  localDatePart,
  localDayOffset,
  localDurationMinutes,
  localTimePart,
  timeOptions,
} from "./schedule-editor-time";

describe("schedule editor local time helpers", () => {
  it("moves civil time without depending on the operating-system timezone", () => {
    expect(addLocalMinutes("2026-03-08T01:58", 5)).toBe("2026-03-08T02:03");
    expect(addLocalMinutes("2026-12-31T23:59", 2)).toBe("2027-01-01T00:01");
    expect(localDurationMinutes("2026-12-31T23:59", "2027-01-01T00:01")).toBe(2);
    expect(localDayOffset("2026-12-31T23:59", "2027-01-01T00:01")).toBe(1);
  });

  it("splits and combines valid local values without UTC conversion", () => {
    expect(localDatePart("2026-08-16T10:30")).toBe("2026-08-16");
    expect(localTimePart("2026-08-16T10:30")).toBe("10:30");
    expect(combineLocalDateAndTime("2026-08-16", "10:07")).toBe("2026-08-16T10:07");
    expect(combineLocalDateAndTime("2026-02-30", "10:07")).toBeNull();
  });

  it("keeps an off-grid current value alongside snap-aligned choices", () => {
    const options = timeOptions(15, "10:07");
    expect(options).toContain("10:00");
    expect(options).toContain("10:07");
    expect(options).toContain("10:15");
    expect(options).not.toContain("10:08");
  });
});
