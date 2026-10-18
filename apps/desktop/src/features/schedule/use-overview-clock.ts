import { useEffect, useState } from "react";

const OVERVIEW_CLOCK_INTERVAL_MS = 30_000;

export function useOverviewClock(refreshKey?: unknown): Date {
  const [now, setNow] = useState(() => new Date());

  useEffect(() => {
    let timer: number | undefined;
    const stop = () => {
      if (timer !== undefined) window.clearInterval(timer);
      timer = undefined;
    };
    const refresh = () => setNow(new Date());
    const start = () => {
      stop();
      if (document.visibilityState !== "visible") return;
      refresh();
      timer = window.setInterval(refresh, OVERVIEW_CLOCK_INTERVAL_MS);
    };
    const handleVisibilityChange = () => {
      if (document.visibilityState === "visible") start();
      else stop();
    };

    start();
    document.addEventListener("visibilitychange", handleVisibilityChange);
    return () => {
      stop();
      document.removeEventListener("visibilitychange", handleVisibilityChange);
    };
  }, [refreshKey]);

  return now;
}
