import { useEffect, useLayoutEffect, useRef, useState } from "react";
import { useQuery } from "@tanstack/react-query";
import type { AppClient } from "../../shared/ipc/client";
import { appLocale, translate } from "../../shared/i18n/messages";
import { AnalogClockFace } from "./AnalogClockFace";
import {
  nextAnalogClockScale,
  resolvedClockTheme,
  type AnalogClockScale,
  type AnalogClockThemeMode,
} from "./clock-model";
import { TickSoundPlayer } from "./tick-sound";
import { useWallClock } from "./use-wall-clock";

const themeStorageKey = "day-schedule-next.analog-clock-theme";
const scaleStorageKey = "day-schedule-next.analog-clock-scale";
const volumeStorageKey = "day-schedule-next.analog-clock-volume";

function storedTheme(): AnalogClockThemeMode {
  const value = localStorage.getItem(themeStorageKey);
  return value === "light" || value === "dark" ? value : "auto";
}

function storedScale(): AnalogClockScale {
  const value = Number(localStorage.getItem(scaleStorageKey));
  return value === 1.5 || value === 2 || value === 2.5 ? value : 1;
}

function storedVolume(): number {
  const stored = localStorage.getItem(volumeStorageKey);
  if (stored === null) return 50;
  const value = Number(stored);
  return Number.isFinite(value) ? Math.max(0, Math.min(100, value)) : 50;
}

export function AnalogClockApp({ client }: { client: AppClient }) {
  const now = useWallClock();
  const bootstrap = useQuery({ queryKey: ["bootstrap"], queryFn: () => client.bootstrap() });
  const [themeMode, setThemeMode] = useState<AnalogClockThemeMode>(storedTheme);
  const [scale, setScale] = useState<AnalogClockScale>(storedScale);
  const [soundEnabled, setSoundEnabled] = useState(false);
  const [volume, setVolume] = useState(storedVolume);
  const [alwaysOnTop, setAlwaysOnTop] = useState(false);
  const [status, setStatus] = useState("");
  const [settingsOpen, setSettingsOpen] = useState(false);
  const settingsButton = useRef<HTMLButtonElement | null>(null);
  const settingsPanel = useRef<HTMLElement | null>(null);
  const sound = useRef<TickSoundPlayer | null>(null);
  if (sound.current === null) sound.current = new TickSoundPlayer();
  const soundPlayer = sound.current;
  const lastSoundSecond = useRef(Math.floor(now.getTime() / 1_000));
  const resolvedTheme = resolvedClockTheme(themeMode, now);

  useLayoutEffect(() => {
    document.documentElement.dataset.theme = resolvedTheme;
  }, [resolvedTheme]);

  useEffect(() => {
    if (bootstrap.data) {
      setAlwaysOnTop(bootstrap.data.windowPreferences.analogClockAlwaysOnTop);
    }
  }, [bootstrap.data]);

  useEffect(() => {
    return () => soundPlayer.close();
  }, [soundPlayer]);

  useEffect(() => {
    const currentSecond = Math.floor(now.getTime() / 1_000);
    if (soundEnabled && currentSecond !== lastSoundSecond.current) soundPlayer.play(volume);
    lastSoundSecond.current = currentSecond;
  }, [now, soundEnabled, soundPlayer, volume]);

  useEffect(() => {
    if (!settingsOpen) return;
    const previouslyFocused = document.activeElement;
    const panel = settingsPanel.current;
    const focusableSelector =
      'button:not([disabled]), input:not([disabled]), [href], [tabindex]:not([tabindex="-1"])';
    panel?.querySelector<HTMLElement>(focusableSelector)?.focus();

    const handleKeyDown = (event: KeyboardEvent) => {
      if (event.key === "Escape") {
        event.preventDefault();
        setSettingsOpen(false);
        return;
      }
      if (event.key !== "Tab" || !panel) return;
      const focusable = Array.from(panel.querySelectorAll<HTMLElement>(focusableSelector));
      const first = focusable.at(0);
      const last = focusable.at(-1);
      if (!first || !last) return;
      if (event.shiftKey && document.activeElement === first) {
        event.preventDefault();
        last.focus();
      } else if (!event.shiftKey && document.activeElement === last) {
        event.preventDefault();
        first.focus();
      }
    };

    document.addEventListener("keydown", handleKeyDown);
    return () => {
      document.removeEventListener("keydown", handleKeyDown);
      if (previouslyFocused instanceof HTMLElement) previouslyFocused.focus();
    };
  }, [settingsOpen]);

  const toggleSound = async (enabled: boolean) => {
    if (!enabled) {
      setSoundEnabled(false);
      setStatus(translate("app.AnalogClock.014"));
      return;
    }
    try {
      await soundPlayer.prepare();
      setSoundEnabled(true);
      setStatus(translate("app.AnalogClock.013"));
    } catch {
      setSoundEnabled(false);
      setStatus(translate("app.AnalogClock.015"));
    }
  };

  const toggleAlwaysOnTop = async (enabled: boolean) => {
    const previous = alwaysOnTop;
    setAlwaysOnTop(enabled);
    try {
      await client.setWindowAlwaysOnTop("analog-clock", enabled);
      setStatus(translate(enabled ? "app.AnalogClock.016" : "app.AnalogClock.017"));
    } catch {
      setAlwaysOnTop(previous);
      setStatus(translate("app.AnalogClock.018"));
    }
  };

  const cycleScale = async () => {
    const next = nextAnalogClockScale(scale);
    try {
      await client.resizeAnalogClockWindow(next);
      setScale(next);
      localStorage.setItem(scaleStorageKey, String(next));
      setStatus(translate("app.AnalogClock.019", [String(next)]));
    } catch {
      setStatus(translate("app.AnalogClock.020"));
    }
  };

  return (
    <main className="analog-clock-shell" data-clock-scale={scale}>
      <h1 className="sr-only">{translate("app.AnalogClock.001")}</h1>
      <div className="analog-clock-stage">
        <AnalogClockFace now={now} />
      </div>

      <time className="analog-clock-digital" dateTime={now.toISOString()}>
        {new Intl.DateTimeFormat(appLocale, {
          year: "numeric",
          month: "2-digit",
          day: "2-digit",
          hour: "2-digit",
          minute: "2-digit",
          second: "2-digit",
        }).format(now)}
      </time>

      <button
        ref={settingsButton}
        className="analog-clock-settings-trigger"
        type="button"
        aria-label={translate("app.AnalogClock.023")}
        aria-controls="analog-clock-settings"
        aria-expanded={settingsOpen}
        title={translate("app.AnalogClock.023")}
        onClick={() => setSettingsOpen(true)}
      >
        <svg viewBox="0 0 24 24" aria-hidden="true">
          <path d="M4 7h10M18 7h2M4 12h2M10 12h10M4 17h8M16 17h4" />
          <circle cx="16" cy="7" r="2" />
          <circle cx="8" cy="12" r="2" />
          <circle cx="14" cy="17" r="2" />
        </svg>
      </button>

      {settingsOpen ? (
        <div className="analog-clock-settings-layer">
          <button
            className="analog-clock-settings-backdrop"
            type="button"
            aria-hidden="true"
            tabIndex={-1}
            onClick={() => setSettingsOpen(false)}
          />
          <section
            ref={settingsPanel}
            id="analog-clock-settings"
            className="analog-clock-settings-panel"
            role="dialog"
            aria-modal="true"
            aria-labelledby="analog-clock-settings-title"
          >
            <header className="analog-clock-settings-panel__header">
              <h2 id="analog-clock-settings-title">{translate("app.AnalogClock.002")}</h2>
              <button
                className="icon-button analog-clock-settings-close"
                type="button"
                aria-label={translate("app.AnalogClock.024")}
                onClick={() => setSettingsOpen(false)}
              >
                ×
              </button>
            </header>

            <div className="analog-clock-controls">
              <fieldset>
                <legend>{translate("app.AnalogClock.003")}</legend>
                <div className="analog-clock-theme-options">
                  <label>
                    <input
                      type="radio"
                      name="analog-clock-theme"
                      value="auto"
                      checked={themeMode === "auto"}
                      onChange={() => {
                        setThemeMode("auto");
                        localStorage.setItem(themeStorageKey, "auto");
                      }}
                    />
                    {translate("app.AnalogClock.004")}
                  </label>
                  <label>
                    <input
                      type="radio"
                      name="analog-clock-theme"
                      value="light"
                      checked={themeMode === "light"}
                      onChange={() => {
                        setThemeMode("light");
                        localStorage.setItem(themeStorageKey, "light");
                      }}
                    />
                    {translate("app.AnalogClock.005")}
                  </label>
                  <label>
                    <input
                      type="radio"
                      name="analog-clock-theme"
                      value="dark"
                      checked={themeMode === "dark"}
                      onChange={() => {
                        setThemeMode("dark");
                        localStorage.setItem(themeStorageKey, "dark");
                      }}
                    />
                    {translate("app.AnalogClock.006")}
                  </label>
                </div>
              </fieldset>

              <button className="button" type="button" onClick={() => void cycleScale()}>
                {translate("app.AnalogClock.007", [String(scale)])}
              </button>
              <label>
                <input
                  type="checkbox"
                  checked={soundEnabled}
                  onChange={(event) => void toggleSound(event.target.checked)}
                />
                {translate("app.AnalogClock.008")}
              </label>
              <label className="analog-clock-volume">
                <span>{translate("app.AnalogClock.009", [String(volume)])}</span>
                <input
                  type="range"
                  min="0"
                  max="100"
                  step="1"
                  value={volume}
                  aria-label={translate("app.AnalogClock.010")}
                  onChange={(event) => {
                    const next = Number(event.target.value);
                    setVolume(next);
                    localStorage.setItem(volumeStorageKey, String(next));
                  }}
                />
              </label>
              <label>
                <input
                  type="checkbox"
                  checked={alwaysOnTop}
                  disabled={bootstrap.isLoading || bootstrap.isError}
                  onChange={(event) => void toggleAlwaysOnTop(event.target.checked)}
                />
                {translate("app.AnalogClock.011")}
              </label>
              <p className="analog-clock-controls__help">{translate("app.AnalogClock.012")}</p>
              {bootstrap.isError ? (
                <p className="inline-error">{translate("app.AnalogClock.021")}</p>
              ) : null}
              <p className="analog-clock-controls__status" role="status">
                {status}
              </p>
            </div>
          </section>
        </div>
      ) : null}
    </main>
  );
}
