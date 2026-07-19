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
import { useScheduleActions, useSchedules } from "./use-schedules";

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
  const alarmsQuery = useQuery({
    queryKey: ["free-alarms"],
    queryFn: () => client.listFreeAlarms(),
  });
  const actions = useScheduleActions(client);
  const [status, setStatus] = useState<string | null>(null);
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
      setStatus("この端末に変更を保存しました。Google 接続時は同期待ちになります。");
    } else {
      await actions.create.mutateAsync(draft);
      setStatus("この端末に予定を保存しました。");
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
    setStatus("この端末から予定を削除しました。「元に戻す」で回復できます。");
    closeEditor();
    selectSchedule(null);
  };

  const duplicate = async () => {
    if (!selected) return;
    await actions.create.mutateAsync({
      title: `${selected.title}（コピー）`,
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
      recurrenceExdates: selected.recurrenceExdates,
      startNotificationMinutes: selected.startNotificationMinutes,
      endNotificationMinutes: selected.endNotificationMinutes,
    });
    setStatus("予定を新しいローカル予定として複製しました。");
    closeEditor();
    selectSchedule(null);
  };

  const adjustSchedule = async (schedule: Schedule, startUtc: string, endUtc: string) => {
    if (quickBlockIds.has(schedule.id)) {
      setStatus("Quick Blockの時刻はテンプレート画面で編集してください。");
      setActiveView("templates");
      return;
    }
    await actions.update.mutateAsync({
      id: schedule.id,
      expectedVersion: schedule.version,
      draft: { ...schedule, startUtc, endUtc },
    });
    setStatus("タイムライン上の変更をこの端末に保存しました。");
  };

  if (schedulesQuery.isError) {
    return (
      <main className="workspace-main">
        <StatusMessage
          tone="danger"
          title="予定を読み込めませんでした"
          action={
            <button className="button" onClick={() => void schedulesQuery.refetch()}>
              もう一度読み込む
            </button>
          }
        >
          入力済みのデータは変更されていません。続く場合は「データと診断」を確認してください。
        </StatusMessage>
      </main>
    );
  }

  return (
    <>
      <main
        className={`workspace-main ${editorMode !== "closed" ? "workspace-main--with-inspector" : ""}`}
      >
        <header className="today-heading">
          <div>
            <span className="eyebrow">現在・次・残り・空きを確認</span>
            <h1>今日の予定</h1>
          </div>
          <p>予定を選ぶと詳細を編集できます。空き時間から作成することもできます。</p>
        </header>
        {status ? (
          <StatusMessage
            tone="success"
            title={status}
            action={
              <button className="link-button" onClick={() => setStatus(null)}>
                閉じる
              </button>
            }
          />
        ) : null}
        {schedulesQuery.isLoading ? (
          <StatusMessage title="この日の予定を読み込んでいます">
            保存済みの画面状態は保持されます。
          </StatusMessage>
        ) : null}
        {!schedulesQuery.isLoading && schedules.length === 0 ? (
          <section className="empty-state">
            <span className="empty-state__icon" aria-hidden="true">
              ＋
            </span>
            <h2>この日にはまだ予定がありません</h2>
            <p>最初の予定を作成するか、一日のテンプレートを適用できます。</p>
            <button className="button button--primary" type="button" onClick={() => openCreate()}>
              予定を作成
            </button>
          </section>
        ) : (
          <>
            <DayOverview
              schedules={schedules}
              selectedDate={selectedDate}
              selectedId={selectedScheduleId}
              onSelect={choose}
              referenceMinute={referenceMinute}
              onReferenceChange={setReferenceMinute}
            />
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
          </>
        )}
      </main>
      {editorMode !== "closed" ? (
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
        />
      ) : null}
      <div className="history-actions" aria-label="変更履歴">
        <button
          className="button button--subtle"
          type="button"
          disabled={actions.undo.isPending}
          onClick={() => void actions.undo.mutateAsync()}
        >
          ↶ 元に戻す
        </button>
        <button
          className="button button--subtle"
          type="button"
          disabled={actions.redo.isPending}
          onClick={() => void actions.redo.mutateAsync()}
        >
          ↷ やり直す
        </button>
      </div>
      <NowDock schedules={schedules} focus={bootstrap.focus} alarms={alarmsQuery.data ?? []} />
    </>
  );
}

function localDateKey(date: Date): string {
  return `${date.getFullYear()}-${String(date.getMonth() + 1).padStart(2, "0")}-${String(date.getDate()).padStart(2, "0")}`;
}

function minuteToTime(minute: number): string {
  return `${String(Math.floor(minute / 60)).padStart(2, "0")}:${String(minute % 60).padStart(2, "0")}`;
}
