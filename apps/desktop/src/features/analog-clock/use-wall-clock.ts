import { useEffect, useState } from "react";

const systemNow = () => new Date();

export function useWallClock(now: () => Date = systemNow): Date {
  const [snapshot, setSnapshot] = useState(now);

  useEffect(() => {
    let timer: number | undefined;

    const scheduleNextSnapshot = () => {
      const current = now();
      setSnapshot(current);
      const delay = Math.max(20, 1_020 - (current.getTime() % 1_000));
      timer = window.setTimeout(scheduleNextSnapshot, delay);
    };
    const refreshAfterResume = () => {
      if (document.visibilityState !== "visible") return;
      if (timer !== undefined) window.clearTimeout(timer);
      scheduleNextSnapshot();
    };

    scheduleNextSnapshot();
    document.addEventListener("visibilitychange", refreshAfterResume);
    window.addEventListener("focus", refreshAfterResume);
    return () => {
      if (timer !== undefined) window.clearTimeout(timer);
      document.removeEventListener("visibilitychange", refreshAfterResume);
      window.removeEventListener("focus", refreshAfterResume);
    };
  }, [now]);

  return snapshot;
}
