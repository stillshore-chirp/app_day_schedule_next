import { describe, expect, it } from "vitest";
import { clockHandAngles, nextAnalogClockScale, resolvedClockTheme } from "./clock-model";

describe("analog clock model", () => {
  it("derives all hands from one wall-clock snapshot", () => {
    const angles = clockHandAngles(new Date(2026, 7, 9, 3, 15, 30, 0));
    expect(angles.hour).toBeCloseTo(97.75);
    expect(angles.minute).toBeCloseTo(93);
    expect(angles.second).toBeCloseTo(180);
  });

  it("keeps midnight and noon on the same twelve-hour dial", () => {
    expect(clockHandAngles(new Date(2026, 7, 9, 0, 0, 0)).hour).toBe(0);
    expect(clockHandAngles(new Date(2026, 7, 9, 12, 0, 0)).hour).toBe(0);
  });

  it("switches automatic theme at 06:00 and 18:00", () => {
    expect(resolvedClockTheme("auto", new Date(2026, 7, 9, 5, 59))).toBe("dark");
    expect(resolvedClockTheme("auto", new Date(2026, 7, 9, 6, 0))).toBe("light");
    expect(resolvedClockTheme("auto", new Date(2026, 7, 9, 17, 59))).toBe("light");
    expect(resolvedClockTheme("auto", new Date(2026, 7, 9, 18, 0))).toBe("dark");
  });

  it("cycles only through supported sizes", () => {
    expect(nextAnalogClockScale(1)).toBe(1.5);
    expect(nextAnalogClockScale(1.5)).toBe(2);
    expect(nextAnalogClockScale(2)).toBe(2.5);
    expect(nextAnalogClockScale(2.5)).toBe(1);
  });
});
