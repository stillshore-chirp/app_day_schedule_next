import { act, renderHook } from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vitest";
import { useOverviewClock } from "./use-overview-clock";

afterEach(() => {
  vi.useRealTimers();
});

describe("useOverviewClock", () => {
  it("refreshes the shared display clock and corrects it when the window returns", () => {
    vi.useFakeTimers();
    vi.setSystemTime(new Date(2026, 6, 20, 23, 59, 45));
    const { result } = renderHook(() => useOverviewClock());
    expect(result.current).toEqual(new Date(2026, 6, 20, 23, 59, 45));

    act(() => {
      vi.advanceTimersByTime(30_000);
    });
    expect(result.current).toEqual(new Date(2026, 6, 21, 0, 0, 15));

    act(() => {
      vi.setSystemTime(new Date(2026, 6, 21, 7, 0));
      document.dispatchEvent(new Event("visibilitychange"));
    });
    expect(result.current).toEqual(new Date(2026, 6, 21, 7, 0));
  });
});
