import { useEffect, useState } from "react";

const OVERVIEW_CLOCK_INTERVAL_MS = 30_000;

export function useOverviewClock(): Date {
  const [now, setNow] = useState(() => new Date());

  useEffect(() => {
    const refresh = () => {
      if (document.visibilityState === "visible") setNow(new Date());
    };
    const timer = window.setInterval(refresh, OVERVIEW_CLOCK_INTERVAL_MS);
    document.addEventListener("visibilitychange", refresh);
    return () => {
      window.clearInterval(timer);
      document.removeEventListener("visibilitychange", refresh);
    };
  }, []);

  return now;
}
