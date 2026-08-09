import { describe, expect, it } from "vitest";
import { createTickSamples } from "./tick-sound";

describe("analog clock tick sound", () => {
  it("recreates a deterministic 60ms mechanical click", () => {
    const first = createTickSamples(44_100);
    const second = createTickSamples(44_100);
    expect(first).toHaveLength(2_646);
    expect(Array.from(first)).toEqual(Array.from(second));
    expect(first.some((sample) => sample !== 0)).toBe(true);
    expect(Math.max(...first)).toBeLessThanOrEqual(1);
    expect(Math.min(...first)).toBeGreaterThanOrEqual(-1);
  });
});
