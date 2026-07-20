import { useEffect, useRef } from "react";
import { isPermissionGranted, sendNotification } from "@tauri-apps/plugin-notification";
import type { AppClient } from "../shared/ipc/client";

export function NotificationRuntime({ client }: { client: AppClient }) {
  const polling = useRef(false);

  useEffect(() => {
    if (!("__TAURI_INTERNALS__" in window)) return;
    let active = true;
    const poll = async () => {
      if (!active || polling.current) return;
      polling.current = true;
      try {
        const deliveries = await client.pollNotifications();
        for (const delivery of deliveries) {
          let delivered = false;
          let category: string | undefined;
          if (delivery.osNotification) {
            try {
              if (await isPermissionGranted()) {
                sendNotification({ title: delivery.title, body: delivery.body });
                delivered = true;
              } else {
                category = "permission_not_granted";
              }
            } catch {
              category = "os_notification_failed";
            }
          }
          if (delivery.sound) {
            try {
              playNotificationTone();
              delivered = true;
            } catch {
              category ??= "sound_failed";
            }
          }
          await client.recordNotificationResult(
            delivery.deliveryKey,
            delivered ? "delivered" : category === "permission_not_granted" ? "skipped" : "failed",
            category,
          );
        }
      } catch {
        // A poll failure must not interrupt local editing. The next bounded poll retries discovery.
      } finally {
        polling.current = false;
      }
    };
    void poll();
    const timer = window.setInterval(() => void poll(), 5_000);
    const onResume = () => void poll();
    window.addEventListener("focus", onResume);
    document.addEventListener("visibilitychange", onResume);
    return () => {
      active = false;
      window.clearInterval(timer);
      window.removeEventListener("focus", onResume);
      document.removeEventListener("visibilitychange", onResume);
    };
  }, [client]);

  return null;
}

function playNotificationTone(): void {
  const AudioContextClass = window.AudioContext;
  const context = new AudioContextClass();
  const oscillator = context.createOscillator();
  const gain = context.createGain();
  oscillator.type = "sine";
  oscillator.frequency.value = 660;
  gain.gain.setValueAtTime(0.0001, context.currentTime);
  gain.gain.exponentialRampToValueAtTime(0.16, context.currentTime + 0.02);
  gain.gain.exponentialRampToValueAtTime(0.0001, context.currentTime + 0.3);
  oscillator.connect(gain);
  gain.connect(context.destination);
  oscillator.start();
  oscillator.stop(context.currentTime + 0.32);
  oscillator.addEventListener("ended", () => void context.close(), { once: true });
}
