import { useCallback, useEffect, useLayoutEffect, useMemo, useRef, useState } from "react";
import { useQuery } from "@tanstack/react-query";
import { listen } from "@tauri-apps/api/event";
import { addDays } from "date-fns";
import type { AppClient } from "../shared/ipc/client";
import { translate, messages } from "../shared/i18n/messages";
import { formatDateHeading } from "../shared/time";
import { StatusMessage } from "../shared/ui/StatusMessage";
import { TodayView } from "../features/schedule/TodayView";
import { ListView, MonthView, WeekView } from "../features/views/CalendarViews";
import { DiagnosticsView, FocusView, SettingsView } from "../features/views/OperationalViews";
import { AlarmsView, TemplatesView } from "../features/views/LibraryViews";
import { TimersView } from "../features/timers/TimersView";
import { StopwatchView } from "../features/stopwatch/StopwatchView";
import { KanbanView } from "../features/tickets/KanbanView";
import { AnalogClockLauncher } from "../features/analog-clock/AnalogClockLauncher";
import { useUiStore, type AppView } from "./ui-store";
import { NotificationRuntime } from "./NotificationRuntime";
import { SyncRuntime } from "./SyncRuntime";

const navItems: Array<{ view: AppView; label: string; symbol: string }> = [
  { view: "today", label: messages.navigation.today, symbol: "●" },
  { view: "week", label: messages.navigation.week, symbol: "▥" },
  { view: "month", label: messages.navigation.month, symbol: "▦" },
  { view: "list", label: messages.navigation.list, symbol: "≡" },
  { view: "templates", label: messages.navigation.templates, symbol: "◇" },
  { view: "tickets", label: translate("navigation.tickets"), symbol: "▤" },
  { view: "focus", label: messages.navigation.focus, symbol: "◎" },
  { view: "timers", label: messages.navigation.timers, symbol: "◴" },
  { view: "stopwatch", label: messages.navigation.stopwatch, symbol: "◉" },
  { view: "alarms", label: messages.navigation.alarms, symbol: "◷" },
  { view: "settings", label: messages.navigation.settings, symbol: "⚙" },
  { view: "diagnostics", label: messages.navigation.diagnostics, symbol: "▤" },
];

const sidebarExpandedStorageKey = "day-schedule-next.sidebar-expanded";

export function App({
  client,
  notificationRuntimeEnabled = true,
}: {
  client: AppClient;
  notificationRuntimeEnabled?: boolean;
}) {
  const [sidebarExpanded, setSidebarExpanded] = useState(
    () => localStorage.getItem(sidebarExpandedStorageKey) === "true",
  );
  const bootstrapQuery = useQuery({ queryKey: ["bootstrap"], queryFn: () => client.bootstrap() });
  const readyReported = useRef(false);
  const refreshBootstrap = useCallback(() => {
    void bootstrapQuery.refetch();
  }, [bootstrapQuery.refetch]);
  const {
    activeView,
    selectedDate,
    search,
    setActiveView,
    setSelectedDate,
    setSearch,
    openCreate,
  } = useUiStore();

  useEffect(() => {
    if (!bootstrapQuery.data || readyReported.current) return;
    readyReported.current = true;
    void client.markUiReady().catch(() => undefined);
  }, [bootstrapQuery.data, client]);

  useEffect(() => {
    const onKeyDown = (event: KeyboardEvent) => {
      const command = event.metaKey || event.ctrlKey;
      if (command && event.key.toLowerCase() === "n") {
        event.preventDefault();
        setActiveView("today");
        openCreate();
      }
      if (event.altKey && event.key === "ArrowLeft") {
        event.preventDefault();
        setSelectedDate(addDays(selectedDate, -1));
      }
      if (event.altKey && event.key === "ArrowRight") {
        event.preventDefault();
        setSelectedDate(addDays(selectedDate, 1));
      }
    };
    window.addEventListener("keydown", onKeyDown);
    return () => window.removeEventListener("keydown", onKeyDown);
  }, [openCreate, selectedDate, setActiveView, setSelectedDate]);

  useLayoutEffect(() => {
    const theme = bootstrapQuery.data?.settings.theme ?? "system";
    document.documentElement.dataset.theme = theme;
  }, [bootstrapQuery.data?.settings.theme]);

  useEffect(() => {
    if (!("__TAURI_INTERNALS__" in window)) return;
    let active = true;
    const stops: Array<() => void> = [];
    const handleAction = (action: string) => {
      if (action === "today") setActiveView("today");
      if (action === "quick-add") {
        setActiveView("today");
        openCreate();
      }
      if (action === "focus") setActiveView("focus");
      if (action === "sync") void bootstrapQuery.refetch();
    };
    const register = (eventName: "tray-action" | "compact-action") =>
      listen<string>(eventName, (event) => {
        handleAction(event.payload);
      }).then((unlisten) => {
        if (active) stops.push(unlisten);
        else unlisten();
      });
    void register("tray-action");
    void register("compact-action");
    return () => {
      active = false;
      stops.forEach((stop) => stop());
    };
  }, [bootstrapQuery.refetch, openCreate, setActiveView]);

  const syncLabel = useMemo(() => {
    const state = bootstrapQuery.data?.sync.state;
    if (!state) return translate("app.App.001");
    switch (state) {
      case "disconnected":
        return messages.states.disconnected;
      case "connecting":
        return translate("app.App.002");
      case "synced":
        return messages.states.synced;
      case "pending":
        return messages.states.pending;
      case "syncing":
        return messages.states.syncing;
      case "offline":
        return messages.states.offline;
      case "retry_scheduled":
        return translate("app.App.003");
      case "conflict":
        return messages.states.conflict;
      case "auth_required":
        return messages.states.authRequired;
      case "calendar_unavailable":
        return translate("app.App.017");
    }
  }, [bootstrapQuery.data?.sync.state]);

  if (bootstrapQuery.isLoading) {
    return (
      <main className="boot-screen">
        <div className="brand-mark" aria-hidden="true">
          24
        </div>
        <h1>Day Schedule Next</h1>
        <p role="status">{translate("app.App.004")}</p>
      </main>
    );
  }

  if (bootstrapQuery.isError || !bootstrapQuery.data) {
    return (
      <main className="boot-screen boot-screen--error">
        <div className="brand-mark" aria-hidden="true">
          !
        </div>
        <StatusMessage
          tone="danger"
          title={translate("app.App.005")}
          action={
            <button className="button" onClick={() => void bootstrapQuery.refetch()}>
              {translate("app.App.006")}
            </button>
          }
        >
          {translate("app.App.007")}
        </StatusMessage>
      </main>
    );
  }

  const bootstrap = bootstrapQuery.data;
  return (
    <div className="app-shell" data-sidebar={sidebarExpanded ? "expanded" : "collapsed"}>
      {notificationRuntimeEnabled ? <NotificationRuntime client={client} /> : null}
      <SyncRuntime client={client} onSettled={refreshBootstrap} />
      <header className="topbar">
        <div className="topbar__brand">
          <div className="brand-mark" aria-hidden="true">
            24
          </div>
          <strong>{messages.appName}</strong>
        </div>
        <div className="date-navigation" aria-label={translate("app.App.008")}>
          <button
            className="icon-button"
            aria-label={translate("app.App.009")}
            onClick={() => setSelectedDate(addDays(selectedDate, -1))}
          >
            ‹
          </button>
          <button className="date-navigation__date" onClick={() => setSelectedDate(new Date())}>
            {formatDateHeading(selectedDate)}
          </button>
          <button
            className="icon-button"
            aria-label={translate("app.App.010")}
            onClick={() => setSelectedDate(addDays(selectedDate, 1))}
          >
            ›
          </button>
          <button className="button button--subtle" onClick={() => setSelectedDate(new Date())}>
            {translate("app.App.011")}
          </button>
          <AnalogClockLauncher client={client} />
        </div>
        <div className="topbar__actions">
          {activeView !== "tickets" && (
            <label className="global-search">
              <span className="sr-only">{translate("app.App.012")}</span>
              <input
                value={search}
                onChange={(event) => setSearch(event.target.value)}
                placeholder={translate("app.App.013")}
                type="search"
              />
            </label>
          )}
          <button
            className="button button--primary"
            onClick={() => {
              setActiveView("today");
              openCreate();
            }}
          >
            {translate("app.App.014")}
          </button>
          <button
            className="sync-indicator"
            type="button"
            onClick={() => setActiveView("settings")}
          >
            <i data-state={bootstrap.sync.state} /> {syncLabel}
          </button>
        </div>
      </header>
      <aside className="sidebar" aria-label={translate("app.App.015")}>
        <div className="sidebar__header">
          <button
            className="icon-button sidebar-toggle"
            type="button"
            aria-controls="primary-navigation"
            aria-expanded={sidebarExpanded}
            aria-label={translate(sidebarExpanded ? "app.App.019" : "app.App.018")}
            title={translate(sidebarExpanded ? "app.App.019" : "app.App.018")}
            onClick={() => {
              setSidebarExpanded((expanded) => {
                const nextExpanded = !expanded;
                localStorage.setItem(sidebarExpandedStorageKey, String(nextExpanded));
                return nextExpanded;
              });
            }}
          >
            <span aria-hidden="true">{sidebarExpanded ? "‹" : "›"}</span>
          </button>
        </div>
        <nav id="primary-navigation">
          {navItems.map((item) => (
            <button
              key={item.view}
              type="button"
              aria-current={activeView === item.view ? "page" : undefined}
              aria-label={item.label}
              title={sidebarExpanded ? undefined : item.label}
              onClick={() => setActiveView(item.view)}
            >
              <span className="sidebar__icon" aria-hidden="true">
                {item.symbol}
              </span>
              <span className="sidebar__label">{item.label}</span>
              {item.view === "diagnostics" && bootstrap.sync.conflictCount > 0 ? (
                <strong className="count-badge">{bootstrap.sync.conflictCount}</strong>
              ) : null}
            </button>
          ))}
        </nav>
        <button
          className="compact-button"
          type="button"
          aria-label={translate("actions.openCompact")}
          title={sidebarExpanded ? undefined : translate("actions.openCompact")}
          onClick={() => void client.openCompactWindow()}
        >
          <span className="compact-button__icon" aria-hidden="true">
            ▱
          </span>
          <span className="sidebar__label">{translate("actions.openCompact")}</span>
        </button>
      </aside>
      <div className="app-content">
        {activeView === "today" ? <TodayView client={client} bootstrap={bootstrap} /> : null}
        {activeView === "week" ? <WeekView client={client} /> : null}
        {activeView === "month" ? <MonthView client={client} /> : null}
        {activeView === "list" ? <ListView client={client} /> : null}
        {activeView === "focus" ? <FocusView client={client} bootstrap={bootstrap} /> : null}
        {activeView === "timers" ? <TimersView client={client} /> : null}
        {activeView === "stopwatch" ? <StopwatchView client={client} /> : null}
        {activeView === "settings" ? (
          <SettingsView client={client} bootstrap={bootstrap} onSettingsSaved={refreshBootstrap} />
        ) : null}
        {activeView === "diagnostics" ? <DiagnosticsView client={client} /> : null}
        {activeView === "templates" ? (
          <TemplatesView
            client={client}
            timezoneId={bootstrap.timezoneId}
            settings={bootstrap.settings}
          />
        ) : null}
        {activeView === "tickets" ? <KanbanView client={client} today={bootstrap.today} /> : null}
        {activeView === "alarms" ? (
          <AlarmsView client={client} timezoneId={bootstrap.timezoneId} />
        ) : null}
      </div>
    </div>
  );
}
