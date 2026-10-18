import { useEffect, useLayoutEffect, useMemo, useRef, useState } from "react";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import { listen } from "@tauri-apps/api/event";
import { dayOverviewWindowHeightSchema, type Settings } from "../../shared/contracts";
import type { AppClient } from "../../shared/ipc/client";
import { applyAppAppearance } from "../../shared/appearance";
import { formatDateHeading, dayRange, dateInputValue } from "../../shared/time";
import { translate } from "../../shared/i18n/messages";
import { StatusMessage } from "../../shared/ui/StatusMessage";
import { Tooltip } from "../../shared/ui/Tooltip";
import { resolveDisplayedTemplate } from "./template-selection";
import { DayOverview } from "./DayOverview";
import { quickBlocksAsSchedules } from "./quick-block-schedules";

type OverviewMode = "both" | "schedule" | "template";
type OverviewTheme = "auto" | "light" | "dark";

const modeStorageKey = "day-schedule-next.day-overview-mode";
const themeStorageKey = "day-schedule-next.day-overview-theme";
const expandedHeightStorageKey = "day-schedule-next.day-overview-expanded-height";
const defaultExpandedHeight = 420;

function storedMode(): OverviewMode {
  const value = localStorage.getItem(modeStorageKey);
  return value === "schedule" || value === "template" ? value : "both";
}

function storedTheme(): OverviewTheme {
  const value = localStorage.getItem(themeStorageKey);
  return value === "light" || value === "dark" ? value : "auto";
}

function storedExpandedHeight(): number {
  const stored = Number(localStorage.getItem(expandedHeightStorageKey));
  const parsed = dayOverviewWindowHeightSchema.safeParse(stored);
  return parsed.success ? parsed.data : defaultExpandedHeight;
}

function localDateFromDateKey(dateKey: string): Date {
  const [year, month, day] = dateKey.split("-").map(Number);
  return new Date(year ?? 1970, (month ?? 1) - 1, day ?? 1);
}

function unlistenSafely(unlisten: () => void): void {
  try {
    void Promise.resolve(unlisten()).catch(() => undefined);
  } catch {
    // Listener cleanup is best effort and must not escape as an unhandled error.
  }
}

export function FloatingDayOverviewApp({ client }: { client: AppClient }) {
  const queryClient = useQueryClient();
  const bootstrap = useQuery({
    queryKey: ["bootstrap"],
    queryFn: () => client.bootstrap(),
    refetchInterval: 30_000,
  });
  const date = useMemo(
    () => (bootstrap.data ? localDateFromDateKey(bootstrap.data.today) : null),
    [bootstrap.data?.today, bootstrap.dataUpdatedAt],
  );
  const range = date ? dayRange(date) : null;
  const schedules = useQuery({
    queryKey: ["schedules", range?.startUtc, range?.endUtc, ""],
    queryFn: () => client.listSchedules({ ...range!, search: "", limit: 500 }),
    enabled: range !== null,
    refetchInterval: 30_000,
    staleTime: 15_000,
  });
  const quickBlocks = useQuery({
    queryKey: ["quick-blocks"],
    queryFn: () => client.listQuickBlocks(),
    refetchInterval: 30_000,
  });
  const templates = useQuery({
    queryKey: ["templates"],
    queryFn: () => client.listTemplates(),
    refetchInterval: 30_000,
  });
  const [mode, setMode] = useState<OverviewMode>(storedMode);
  const initialMode = useRef(mode);
  const initialWindowModeSync = useRef(false);
  const [modeChangePending, setModeChangePending] = useState(false);
  const [themeMode, setThemeMode] = useState<OverviewTheme>(storedTheme);
  const [alwaysOnTop, setAlwaysOnTop] = useState(false);
  const [alwaysOnTopPending, setAlwaysOnTopPending] = useState(false);
  const [alwaysOnTopError, setAlwaysOnTopError] = useState(false);
  const [settingsOpen, setSettingsOpen] = useState(false);
  const [status, setStatus] = useState("");
  const settingsButton = useRef<HTMLButtonElement | null>(null);
  const settingsPanel = useRef<HTMLElement | null>(null);
  const alwaysOnTopRequestPending = useRef(false);
  const modeChangePendingRef = useRef(false);

  useEffect(() => {
    localStorage.setItem(modeStorageKey, mode);
  }, [mode]);

  useEffect(() => {
    if (initialWindowModeSync.current) return;
    initialWindowModeSync.current = true;
    if (initialMode.current === "both") return;
    void client
      .setDayOverviewWindowMode("single", storedExpandedHeight())
      .catch(() => setStatus(translate("app.DayOverview.026")));
  }, [client]);

  useEffect(() => {
    localStorage.setItem(themeStorageKey, themeMode);
  }, [themeMode]);

  useLayoutEffect(() => {
    if (!bootstrap.data) return;
    applyAppAppearance({
      theme: themeMode === "auto" ? bootstrap.data.settings.theme : themeMode,
      textScalePercent: bootstrap.data.settings.textScalePercent,
    });
  }, [bootstrap.data, themeMode]);

  useEffect(() => {
    if (bootstrap.data) {
      setAlwaysOnTop(bootstrap.data.windowPreferences.dayOverviewAlwaysOnTop);
    }
  }, [bootstrap.data]);

  useEffect(() => {
    if (!("__TAURI_INTERNALS__" in window)) return;
    let active = true;
    let stop: (() => void) | undefined;
    void listen<Settings>("settings-updated", () => {
      void queryClient.invalidateQueries({ queryKey: ["bootstrap"] }).catch(() => undefined);
    })
      .then((unlisten) => {
        if (active) stop = unlisten;
        else unlistenSafely(unlisten);
      })
      .catch(() => undefined);
    return () => {
      active = false;
      const unlisten = stop;
      stop = undefined;
      if (unlisten) unlistenSafely(unlisten);
    };
  }, [queryClient]);

  useEffect(() => {
    if (!settingsOpen) return;
    const previouslyFocused = document.activeElement;
    const panel = settingsPanel.current;
    const focusableSelector = 'button:not([disabled]), [href], [tabindex]:not([tabindex="-1"])';
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

  const toggleAlwaysOnTop = async (enabled: boolean) => {
    if (alwaysOnTopRequestPending.current) return;
    alwaysOnTopRequestPending.current = true;
    const previous = alwaysOnTop;
    setAlwaysOnTopPending(true);
    setAlwaysOnTopError(false);
    setAlwaysOnTop(enabled);
    try {
      await client.setWindowAlwaysOnTop("day-overview", enabled);
      setStatus(translate(enabled ? "app.DayOverview.016" : "app.DayOverview.017"));
    } catch {
      setAlwaysOnTop(previous);
      setAlwaysOnTopError(true);
      setStatus(translate("app.DayOverview.015"));
    } finally {
      alwaysOnTopRequestPending.current = false;
      setAlwaysOnTopPending(false);
    }
  };

  const changeMode = async (nextMode: OverviewMode) => {
    if (nextMode === mode || modeChangePendingRef.current) return;
    setStatus("");

    const wasBoth = mode === "both";
    const willBeBoth = nextMode === "both";
    if (wasBoth === willBeBoth) {
      setMode(nextMode);
      return;
    }

    modeChangePendingRef.current = true;
    setModeChangePending(true);
    try {
      if (willBeBoth) {
        await client.setDayOverviewWindowMode("both", storedExpandedHeight());
      } else {
        const expandedHeight = await client.setDayOverviewWindowMode("single");
        localStorage.setItem(expandedHeightStorageKey, String(expandedHeight));
      }
      setMode(nextMode);
    } catch {
      setStatus(translate("app.DayOverview.026"));
    } finally {
      modeChangePendingRef.current = false;
      setModeChangePending(false);
    }
  };

  const retryOverview = () => {
    void Promise.all([bootstrap.refetch(), schedules.refetch(), quickBlocks.refetch()]);
  };

  const submitMainAction = async (
    action:
      | { type: "edit-schedule"; scheduleId: string; date: string }
      | { type: "create-schedule"; date: string }
      | { type: "open-templates" },
  ) => {
    setStatus("");
    try {
      await client.openMainWithDayOverviewAction(action);
    } catch {
      setStatus(translate("app.DayOverview.025"));
    }
  };

  const pinLabel = translate(
    bootstrap.isLoading
      ? "app.DayOverview.013"
      : bootstrap.isError
        ? "app.DayOverview.014"
        : alwaysOnTop
          ? "app.DayOverview.012"
          : "app.DayOverview.011",
  );
  const settingsLabel = translate("app.DayOverview.018");
  const activeDate = date ? dateInputValue(date) : "";
  const displayedTemplate = resolveDisplayedTemplate(
    templates.data ?? [],
    bootstrap.data?.settings.lastTemplateId ?? null,
  );
  const quickBlockIds = new Set((quickBlocks.data ?? []).map((item) => item.id));
  const displaySchedules = [
    ...(schedules.data?.items ?? []),
    ...(date ? quickBlocksAsSchedules(quickBlocks.data ?? [], date) : []),
  ];

  return (
    <main className="day-overview-shell" data-display-mode={mode}>
      <header className="day-overview-window__header">
        <div>
          <span className="eyebrow">{translate("app.DayOverview.001")}</span>
          {date ? <time dateTime={activeDate}>{formatDateHeading(date)}</time> : null}
        </div>
        <div className="day-overview-window__controls">
          <Tooltip label={pinLabel}>
            <button
              className="day-overview-corner-control day-overview-pin-trigger"
              type="button"
              aria-label={pinLabel}
              aria-pressed={alwaysOnTop}
              disabled={bootstrap.isLoading || bootstrap.isError || alwaysOnTopPending}
              onClick={() => void toggleAlwaysOnTop(!alwaysOnTop)}
            >
              <svg viewBox="0 0 24 24" aria-hidden="true">
                <path d="M9 3h6l-.8 5 3.3 3.3v1.2H13v7l-1 1-1-1v-7H6.5v-1.2L9.8 8 9 3Z" />
              </svg>
            </button>
          </Tooltip>
          <Tooltip label={settingsLabel}>
            <button
              ref={settingsButton}
              className="day-overview-corner-control"
              type="button"
              aria-label={settingsLabel}
              aria-controls="day-overview-settings"
              aria-expanded={settingsOpen}
              onClick={() => setSettingsOpen(true)}
            >
              <svg viewBox="0 0 24 24" aria-hidden="true">
                <path d="M12 8.1a3.9 3.9 0 1 0 0 7.8 3.9 3.9 0 0 0 0-7.8Z" />
                <path d="m19.4 13.5 1.1.9-1.1 2-1.4-.5a7.9 7.9 0 0 1-1.7 1l-.2 1.5h-2.3l-.4-1.4a8 8 0 0 1-2 0L11 18.4H8.7l-.2-1.5a7.9 7.9 0 0 1-1.7-1l-1.4.5-1.1-2 1.1-.9a7.2 7.2 0 0 1 0-2L4.3 10.6l1.1-2 1.4.5a7.9 7.9 0 0 1 1.7-1l.2-1.5H11l.4 1.4a8 8 0 0 1 2 0l.4-1.4h2.3l.2 1.5a7.9 7.9 0 0 1 1.7 1l1.4-.5 1.1 2-1.1.9a7.2 7.2 0 0 1 0 2Z" />
              </svg>
            </button>
          </Tooltip>
        </div>
      </header>

      {status ? (
        <p className="day-overview-window__status" role="status">
          {status}
        </p>
      ) : null}

      {bootstrap.isError && !bootstrap.data ? (
        <StatusMessage
          tone="danger"
          title={translate("app.DayOverview.021")}
          action={
            <button className="button" type="button" onClick={retryOverview}>
              {translate("app.DayOverview.022")}
            </button>
          }
        />
      ) : !bootstrap.data ? (
        <StatusMessage title={translate("app.DayOverview.020")} />
      ) : schedules.isLoading || quickBlocks.isLoading ? (
        <StatusMessage title={translate("app.DayOverview.020")} />
      ) : schedules.isError || quickBlocks.isError ? (
        <StatusMessage
          tone="danger"
          title={translate("app.DayOverview.023")}
          action={
            <button className="button" type="button" onClick={retryOverview}>
              {translate("app.DayOverview.022")}
            </button>
          }
        />
      ) : date ? (
        <DayOverview
          schedules={displaySchedules}
          scheduleState="ready"
          selectedDate={date}
          selectedId={null}
          onSelect={(schedule) =>
            void submitMainAction(
              quickBlockIds.has(schedule.id)
                ? { type: "open-templates" }
                : { type: "edit-schedule", scheduleId: schedule.id, date: activeDate },
            )
          }
          onCreateSchedule={() =>
            void submitMainAction({ type: "create-schedule", date: activeDate })
          }
          template={displayedTemplate}
          templateState={templates.isLoading ? "loading" : templates.isError ? "error" : "ready"}
          onRetryTemplate={() => void templates.refetch()}
          referenceMinute={8 * 60}
          onReferenceChange={() => undefined}
          textScalePercent={bootstrap.data.settings.textScalePercent}
          visibleLanes={mode}
          showReferenceSlider={false}
        />
      ) : null}

      {alwaysOnTopError && !settingsOpen ? (
        <p className="day-overview-pin-error" role="alert">
          {translate("app.DayOverview.015")}
        </p>
      ) : null}

      {settingsOpen ? (
        <div className="day-overview-settings-layer">
          <button
            className="day-overview-settings-backdrop"
            type="button"
            aria-label={translate("app.DayOverview.019")}
            onClick={() => setSettingsOpen(false)}
          />
          <section
            ref={settingsPanel}
            id="day-overview-settings"
            className="day-overview-settings-panel"
            role="dialog"
            aria-modal="true"
            aria-labelledby="day-overview-settings-title"
          >
            <header className="day-overview-settings-panel__header">
              <h2 id="day-overview-settings-title">{translate("app.DayOverview.002")}</h2>
              <button
                className="icon-button day-overview-settings-close"
                type="button"
                aria-label={translate("app.DayOverview.019")}
                onClick={() => setSettingsOpen(false)}
              >
                ×
              </button>
            </header>
            <div className="day-overview-controls">
              <fieldset>
                <legend>{translate("app.DayOverview.003")}</legend>
                <div
                  className="day-overview-choice-group"
                  role="group"
                  aria-label={translate("app.DayOverview.003")}
                >
                  {(
                    [
                      ["auto", "app.DayOverview.004"],
                      ["light", "app.DayOverview.005"],
                      ["dark", "app.DayOverview.006"],
                    ] as const
                  ).map(([value, messageKey]) => (
                    <button
                      key={value}
                      className="button button--subtle"
                      type="button"
                      aria-pressed={themeMode === value}
                      onClick={() => setThemeMode(value)}
                    >
                      {translate(messageKey)}
                    </button>
                  ))}
                </div>
              </fieldset>
              <fieldset>
                <legend>{translate("app.DayOverview.007")}</legend>
                <div
                  className="day-overview-choice-group"
                  role="group"
                  aria-label={translate("app.DayOverview.007")}
                >
                  {(
                    [
                      ["both", "app.DayOverview.008"],
                      ["schedule", "app.DayOverview.009"],
                      ["template", "app.DayOverview.010"],
                    ] as const
                  ).map(([value, messageKey]) => (
                    <button
                      key={value}
                      className="button button--subtle"
                      type="button"
                      aria-pressed={mode === value}
                      disabled={modeChangePending}
                      onClick={() => void changeMode(value)}
                    >
                      {translate(messageKey)}
                    </button>
                  ))}
                </div>
              </fieldset>
            </div>
          </section>
        </div>
      ) : null}
    </main>
  );
}
