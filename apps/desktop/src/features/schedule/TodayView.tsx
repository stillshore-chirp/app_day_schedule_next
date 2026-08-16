import { translate } from "../../shared/i18n/messages";
import { useMemo, useState } from "react";
import { useQuery } from "@tanstack/react-query";
import { fromZonedTime } from "date-fns-tz";
import type { Bootstrap, Schedule, ScheduleDraft } from "../../shared/contracts";
import type { AppClient } from "../../shared/ipc/client";
import { StatusMessage } from "../../shared/ui/StatusMessage";
import { useUiStore } from "../../app/ui-store";
import { DayOverview } from "./DayOverview";
import { NowDock } from "./NowDock";
import { ScheduleEditor } from "./ScheduleEditor";
import { Timeline } from "./Timeline";
import { resolveDisplayedTemplate } from "./template-selection";
import { useScheduleActions, useSchedules } from "./use-schedules";
import { PriorityTicketDrawer } from "./PriorityTicketDrawer";

interface TodayViewProps {
  client: AppClient;
  bootstrap: Bootstrap;
}

export function TodayView({ client, bootstrap }: TodayViewProps) {
  const {
    selectedDate,
    selectedScheduleId,
    editorMode,
    search,
    selectSchedule,
    openCreate,
    openEdit,
    closeEditor,
    createRange,
    referenceMinute,
    setReferenceMinute,
    setActiveView,
  } = useUiStore();
  const schedulesQuery = useSchedules(client, selectedDate, search);
  const quickBlocksQuery = useQuery({
    queryKey: ["quick-blocks"],
    queryFn: () => client.listQuickBlocks(),
  });
  const templatesQuery = useQuery({
    queryKey: ["templates"],
    queryFn: () => client.listTemplates(),
  });
  const alarmsQuery = useQuery({
    queryKey: ["free-alarms"],
    queryFn: () => client.listFreeAlarms(),
  });
  const actions = useScheduleActions(client);
  const [status, setStatus] = useState<string | null>(null);
  const [statusTone, setStatusTone] = useState<"success" | "danger">("success");
  const quickSchedules = useMemo(
    () =>
      (quickBlocksQuery.data ?? [])
        .filter((item) => item.isActive)
        .map((item): Schedule => {
          const date = localDateKey(selectedDate);
          const startUtc = fromZonedTime(
            `${date}T${minuteToTime(item.startMinute)}:00`,
            item.timezoneId,
          );
          const endUtc = new Date(startUtc.getTime() + item.durationMinutes * 60_000);
          return {
            id: item.id,
            title: item.title,
            description: "Quick Block",
            location: "",
            startUtc: startUtc.toISOString(),
            endUtc: endUtc.toISOString(),
            timezoneId: item.timezoneId,
            allDay: false,
            allDayStartDate: null,
            allDayEndDateExclusive: null,
            status: "scheduled",
            project: item.project,
            category: item.category,
            tags: ["Quick Block"],
            color: item.color,
            priority: "normal",
            recurrenceRule: null,
            recurrenceSupplementalLines: [],
            recurrenceExdates: [],
            startNotificationMinutes: item.startNotificationMinutes,
            endNotificationMinutes: item.endNotificationMinutes,
            syncStatus: "local_only",
            version: item.version,
            deletedAt: null,
          };
        }),
    [quickBlocksQuery.data, selectedDate],
  );
  const schedules = [...(schedulesQuery.data?.items ?? []), ...quickSchedules];
  const displayedTemplate = resolveDisplayedTemplate(
    templatesQuery.data ?? [],
    bootstrap.settings.lastTemplateId,
  );
  const quickBlockIds = new Set((quickBlocksQuery.data ?? []).map((item) => item.id));
  const selected = schedules.find((item) => item.id === selectedScheduleId) ?? null;
  const busy = actions.create.isPending || actions.update.isPending || actions.remove.isPending;

  const choose = (schedule: Schedule) => {
    if (quickBlockIds.has(schedule.id)) {
      setActiveView("templates");
      return;
    }
    selectSchedule(schedule.id);
    openEdit(schedule.id);
  };

  const save = async (
    draft: ScheduleDraft,
    recurrence?: { scope: "this" | "following" | "series"; occurrenceStartUtc: string },
  ) => {
    if (editorMode === "edit" && selected) {
      await actions.update.mutateAsync({
        id: selected.id,
        expectedVersion: selected.version,
        draft,
        ...(recurrence
          ? {
              recurrenceScope: recurrence.scope,
              occurrenceStartUtc: recurrence.occurrenceStartUtc,
            }
          : {}),
      });
      setStatusTone("success");
      setStatus(translate("features.schedule.TodayView.001"));
    } else {
      await actions.create.mutateAsync(draft);
      setStatusTone("success");
      setStatus(translate("features.schedule.TodayView.002"));
    }
    closeEditor();
  };

  const remove = async (recurrence?: {
    scope: "this" | "following" | "series";
    occurrenceStartUtc: string;
  }) => {
    if (!selected) return;
    await actions.remove.mutateAsync({
      id: selected.id,
      expectedVersion: selected.version,
      ...(recurrence
        ? {
            recurrenceScope: recurrence.scope,
            occurrenceStartUtc: recurrence.occurrenceStartUtc,
          }
        : {}),
    });
    setStatusTone("success");
    setStatus(translate("features.schedule.TodayView.003"));
    closeEditor();
    selectSchedule(null);
  };

  const duplicate = async () => {
    if (!selected) return;
    await actions.create.mutateAsync({
      title: translate("features.schedule.TodayView.004", [selected.title]),
      description: selected.description,
      location: selected.location,
      startUtc: selected.startUtc,
      endUtc: selected.endUtc,
      timezoneId: selected.timezoneId,
      allDay: selected.allDay,
      allDayStartDate: selected.allDayStartDate,
      allDayEndDateExclusive: selected.allDayEndDateExclusive,
      status: selected.status,
      project: selected.project,
      category: selected.category,
      tags: selected.tags,
      color: selected.color,
      priority: selected.priority,
      recurrenceRule: selected.recurrenceRule,
      recurrenceSupplementalLines: selected.recurrenceSupplementalLines,
      recurrenceExdates: selected.recurrenceExdates,
      startNotificationMinutes: selected.startNotificationMinutes,
      endNotificationMinutes: selected.endNotificationMinutes,
    });
    setStatusTone("success");
    setStatus(translate("features.schedule.TodayView.005"));
    closeEditor();
    selectSchedule(null);
  };

  const adjustSchedule = async (schedule: Schedule, startUtc: string, endUtc: string) => {
    if (quickBlockIds.has(schedule.id)) {
      setStatusTone("danger");
      setStatus(translate("features.schedule.TodayView.006"));
      setActiveView("templates");
      return;
    }
    await actions.update.mutateAsync({
      id: schedule.id,
      expectedVersion: schedule.version,
      draft: { ...schedule, startUtc, endUtc },
    });
    setStatusTone("success");
    setStatus(translate("features.schedule.TodayView.007"));
  };

  return (
    <>
      <main
        className={`workspace-main ${
          editorMode !== "closed" ? "workspace-main--with-inspector" : ""
        }`}
      >
        <header className="today-heading">
          <div>
            <span className="eyebrow">{translate("features.schedule.TodayView.011")}</span>
            <h1>{translate("features.schedule.TodayView.012")}</h1>
          </div>
          <p>{translate("features.schedule.TodayView.013")}</p>
        </header>
        {status ? (
          <StatusMessage
            tone={statusTone}
            title={status}
            action={
              <button className="link-button" onClick={() => setStatus(null)}>
                {translate("features.schedule.TodayView.014")}
              </button>
            }
          />
        ) : null}
        {schedulesQuery.isError ? (
          <StatusMessage
            tone="danger"
            title={translate("features.schedule.TodayView.008")}
            action={
              <button className="button" onClick={() => void schedulesQuery.refetch()}>
                {translate("features.schedule.TodayView.009")}
              </button>
            }
          >
            {translate("features.schedule.TodayView.010")}
          </StatusMessage>
        ) : null}
        {schedulesQuery.isLoading ? (
          <StatusMessage title={translate("features.schedule.TodayView.015")}>
            {translate("features.schedule.TodayView.016")}
          </StatusMessage>
        ) : null}
        {!schedulesQuery.isError ? (
          <DayOverview
            schedules={schedules}
            scheduleState={schedulesQuery.isLoading ? "loading" : "ready"}
            selectedDate={selectedDate}
            selectedId={selectedScheduleId}
            onSelect={choose}
            onCreateSchedule={() => openCreate()}
            template={displayedTemplate}
            templateState={
              templatesQuery.isLoading ? "loading" : templatesQuery.isError ? "error" : "ready"
            }
            onRetryTemplate={() => void templatesQuery.refetch()}
            referenceMinute={referenceMinute}
            onReferenceChange={setReferenceMinute}
          />
        ) : null}
        <PriorityTicketDrawer client={client} />
        {!schedulesQuery.isError ? (
          <Timeline
            schedules={schedules}
            selectedDate={selectedDate}
            selectedId={selectedScheduleId}
            onSelect={choose}
            snapMinutes={bootstrap.settings.snapMinutes}
            onCreate={() => openCreate()}
            onCreateRange={(startUtc, endUtc) => openCreate({ startUtc, endUtc })}
            onAdjust={(schedule, startUtc, endUtc) => adjustSchedule(schedule, startUtc, endUtc)}
            referenceMinute={referenceMinute}
          />
        ) : null}
      </main>
      {!schedulesQuery.isError && editorMode !== "closed" ? (
        <ScheduleEditor
          client={client}
          schedule={selected}
          selectedDate={selectedDate}
          timezoneId={bootstrap.timezoneId}
          snapMinutes={bootstrap.settings.snapMinutes}
          mode={editorMode}
          busy={busy}
          onSave={save}
          {...(editorMode === "edit" ? { onDelete: remove } : {})}
          {...(editorMode === "edit" ? { onDuplicate: duplicate } : {})}
          onClose={closeEditor}
          initialRange={createRange}
          onOpenTickets={() => setActiveView("tickets")}
        />
      ) : null}
      {!schedulesQuery.isError ? (
        <>
          <div
            className="history-actions"
            aria-label={translate("features.schedule.TodayView.020")}
          >
            <button
              className="button button--subtle"
              type="button"
              disabled={actions.undo.isPending}
              onClick={() => void actions.undo.mutateAsync()}
            >
              {translate("features.schedule.TodayView.021")}
            </button>
            <button
              className="button button--subtle"
              type="button"
              disabled={actions.redo.isPending}
              onClick={() => void actions.redo.mutateAsync()}
            >
              {translate("features.schedule.TodayView.022")}
            </button>
          </div>
          <NowDock schedules={schedules} focus={bootstrap.focus} alarms={alarmsQuery.data ?? []} />
        </>
      ) : null}
    </>
  );
}

function localDateKey(date: Date): string {
  return `${date.getFullYear()}-${String(date.getMonth() + 1).padStart(2, "0")}-${String(
    date.getDate(),
  ).padStart(2, "0")}`;
}

function minuteToTime(minute: number): string {
  return `${String(Math.floor(minute / 60)).padStart(2, "0")}:${String(minute % 60).padStart(
    2,
    "0",
  )}`;
}
