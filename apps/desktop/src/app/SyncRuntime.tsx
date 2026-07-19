import { useEffect } from "react";
import type { AppClient } from "../shared/ipc/client";

const FIVE_MINUTES = 5 * 60 * 1000;

export function SyncRuntime({ client, onSettled }: { client: AppClient; onSettled: () => void }) {
  useEffect(() => {
    let active = true;
    let running = false;

    const synchronize = async () => {
      if (!active || running) return;
      running = true;
      try {
        await client.runSync();
      } catch {
        // The backend persists a user-safe sync state. Refreshing bootstrap exposes it.
      } finally {
        running = false;
        if (active) onSettled();
      }
    };
    const onResume = () => {
      if (document.visibilityState === "visible") void synchronize();
    };
    const onLocalChange = () => void synchronize();

    const startup = window.setTimeout(() => void synchronize(), 1_000);
    const interval = window.setInterval(() => void synchronize(), FIVE_MINUTES);
    window.addEventListener("focus", onResume);
    document.addEventListener("visibilitychange", onResume);
    window.addEventListener("day-schedule-local-change", onLocalChange);
    return () => {
      active = false;
      window.clearTimeout(startup);
      window.clearInterval(interval);
      window.removeEventListener("focus", onResume);
      document.removeEventListener("visibilitychange", onResume);
      window.removeEventListener("day-schedule-local-change", onLocalChange);
    };
  }, [client, onSettled]);

  return null;
}
