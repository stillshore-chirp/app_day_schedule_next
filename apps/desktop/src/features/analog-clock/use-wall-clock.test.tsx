import { act, renderHook } from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vitest";
import { useWallClock } from "./use-wall-clock";

afterEach(() => {
  vi.useRealTimers();
});

describe("useWallClock", () => {
  it("re-reads wall time after focus and continues from the corrected clock", () => {
    vi.useFakeTimers();
    vi.setSystemTime(new Date("2026-08-09T10:00:00.250Z"));
    const { result } = renderHook(() => useWallClock());
    expect(result.current.toISOString()).toBe("2026-08-09T10:00:00.250Z");

    act(() => {
      vi.setSystemTime(new Date("2026-08-09T12:34:56.500Z"));
      window.dispatchEvent(new Event("focus"));
    });
    expect(result.current.toISOString()).toBe("2026-08-09T12:34:56.500Z");

    act(() => {
      vi.advanceTimersByTime(520);
    });
    expect(result.current.toISOString()).toBe("2026-08-09T12:34:57.020Z");
  });
});
