import { useState, type ReactNode } from "react";
import { useQuery } from "@tanstack/react-query";
import {
  addDays,
  differenceInCalendarDays,
  endOfMonth,
  endOfWeek,
  format,
  startOfMonth,
  startOfWeek,
} from "date-fns";
import { formatInTimeZone } from "date-fns-tz";
import type {
  BulkClassificationPatch,
  Schedule,
  ScheduleDraft,
  ScheduleQuery,
} from "../../shared/contracts";
import type { AppClient } from "../../shared/ipc/client";
import { formatDateHeading, formatTime } from "../../shared/time";
import { StatusMessage } from "../../shared/ui/StatusMessage";
import { useUiStore } from "../../app/ui-store";

function useRangeSchedules(
  client: AppClient,
  start: Date,
  end: Date,
  search = "",
  options: Omit<ScheduleQuery, "startUtc" | "endUtc" | "search"> = {},
) {
  const startUtc = start.toISOString();
  const endUtc = end.toISOString();
  return useQuery({
    queryKey: ["schedules", startUtc, endUtc, search, options],
    queryFn: () => client.listSchedules({ startUtc, endUtc, search, limit: 500, ...options }),
  });
}

export function WeekView({ client }: { client: AppClient }) {
  const { selectedDate, setSelectedDate, setActiveView } = useUiStore();
  const start = startOfWeek(selectedDate, { weekStartsOn: 1 });
  const end = addDays(start, 7);
  const query = useRangeSchedules(client, start, end);
  if (query.isError) return <ViewError onRetry={() => void query.refetch()} />;
  const items = query.data?.items ?? [];
  return (
    <main className="secondary-view">
      <ViewTitle
        eyebrow="一週間を調整"
        title="週"
        description="予定の密度と空き時間を日ごとに確認します。"
      />
      <div className="week-grid" aria-label="一週間の予定">
        {Array.from({ length: 7 }, (_, index) => {
          const date = addDays(start, index);
          const schedules = schedulesForDate(items, date);
          return (
            <section className="week-day" key={date.toISOString()}>
              <button
                className="week-day__heading"
                type="button"
                onClick={() => {
                  setSelectedDate(date);
                  setActiveView("today");
                }}
              >
                <span>{new Intl.DateTimeFormat("ja-JP", { weekday: "short" }).format(date)}</span>
                <strong>{date.getDate()}</strong>
                <small>{schedules.length}件</small>
              </button>
              <ol>
                {schedules.map((schedule) => (
                  <li
                    key={`${schedule.id}-${schedule.startUtc}`}
                    style={{ borderInlineStartColor: schedule.color }}
                  >
                    <time>{formatTime(schedule.startUtc)}</time>
                    <span>{schedule.title}</span>
                  </li>
                ))}
              </ol>
            </section>
          );
        })}
      </div>
    </main>
  );
}

export function MonthView({ client }: { client: AppClient }) {
  const { selectedDate, setSelectedDate, setActiveView } = useUiStore();
  const monthStart = startOfMonth(selectedDate);
  const gridStart = startOfWeek(monthStart, { weekStartsOn: 1 });
  const gridEnd = endOfWeek(endOfMonth(selectedDate), { weekStartsOn: 1 });
  const query = useRangeSchedules(client, gridStart, addDays(gridEnd, 1));
  if (query.isError) return <ViewError onRetry={() => void query.refetch()} />;
  const items = query.data?.items ?? [];
  return (
    <main className="secondary-view">
      <ViewTitle
        eyebrow="月全体の負荷"
        title="月"
        description="予定件数と合計時間を数値で比較できます。"
      />
      <div
        className="month-grid"
        role="grid"
        aria-label={`${selectedDate.getFullYear()}年${selectedDate.getMonth() + 1}月`}
      >
        {Array.from(
          {
            length: Math.round((addDays(gridEnd, 1).getTime() - gridStart.getTime()) / 86_400_000),
          },
          (_, index) => {
            const date = addDays(gridStart, index);
            const schedules = schedulesForDate(items, date);
            const minutes = schedules.reduce(
              (total, schedule) =>
                total +
                Math.max(0, (Date.parse(schedule.endUtc) - Date.parse(schedule.startUtc)) / 60_000),
              0,
            );
            return (
              <button
                role="gridcell"
                className="month-day"
                data-outside={date.getMonth() !== selectedDate.getMonth() || undefined}
                key={date.toISOString()}
                type="button"
                onClick={() => {
                  setSelectedDate(date);
                  setActiveView("today");
                }}
              >
                <strong>{date.getDate()}</strong>
                <span>{schedules.length}件</span>
                <small>{Math.round((minutes / 60) * 10) / 10}時間</small>
              </button>
            );
          },
        )}
      </div>
    </main>
  );
}

export function ListView({ client }: { client: AppClient }) {
  const { search, setSearch, setSelectedDate, setActiveView, openEdit } = useUiStore();
  const today = new Date();
  const [startDate, setStartDate] = useState(() => format(addDays(today, -365), "yyyy-MM-dd"));
  const [endDate, setEndDate] = useState(() => format(addDays(today, 365), "yyyy-MM-dd"));
  const [status, setStatus] = useState("");
  const [project, setProject] = useState("");
  const [category, setCategory] = useState("");
  const [tag, setTag] = useState("");
  const [priority, setPriority] = useState("");
  const [syncStatus, setSyncStatus] = useState("");
  const [syncTarget, setSyncTarget] = useState("");
  const [completion, setCompletion] = useState<"all" | "open" | "completed">("all");
  const [sortBy, setSortBy] = useState<NonNullable<ScheduleQuery["sortBy"]>>("start");
  const [sortDescending, setSortDescending] = useState(false);
  const [page, setPage] = useState(0);
  const [carryDate, setCarryDate] = useState(() => format(addDays(today, 1), "yyyy-MM-dd"));
  const [message, setMessage] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [selectedIds, setSelectedIds] = useState<Set<string>>(() => new Set());
  const [bulkEnabled, setBulkEnabled] = useState({
    project: false,
    category: false,
    tags: false,
    color: false,
    priority: false,
  });
  const [bulkValues, setBulkValues] = useState({
    project: "",
    category: "",
    tags: "",
    color: "#6F96F4",
    priority: "normal" as Schedule["priority"],
  });
  const pageSize = 100;
  const start = new Date(`${startDate}T00:00:00`);
  const end = addDays(new Date(`${endDate}T00:00:00`), 1);
  const query = useRangeSchedules(client, start, end, search, {
    limit: pageSize,
    offset: page * pageSize,
    ...(status ? { status: status as Schedule["status"] } : {}),
    ...(project ? { project } : {}),
    ...(category ? { category } : {}),
    ...(tag ? { tag } : {}),
    ...(priority ? { priority: priority as Schedule["priority"] } : {}),
    ...(syncStatus ? { syncStatus: syncStatus as Schedule["syncStatus"] } : {}),
    ...(syncTarget ? { syncTarget } : {}),
    completion,
    sortBy,
    sortDescending,
  });
  if (query.isError) return <ViewError onRetry={() => void query.refetch()} />;
  const items = query.data?.items ?? [];
  const total = query.data?.total ?? 0;

  const resetFilters = () => {
    setSearch("");
    setStatus("");
    setProject("");
    setCategory("");
    setTag("");
    setPriority("");
    setSyncStatus("");
    setSyncTarget("");
    setCompletion("all");
    setPage(0);
  };

  const carryOver = async (schedule: Schedule) => {
    setError(null);
    setMessage(null);
    if (schedule.recurrenceRule) {
      setError("繰り返し予定は編集画面で「今回のみ／これ以降／すべて」の範囲を選んでください。");
      return;
    }
    try {
      const next = await carriedDraft(client, schedule, carryDate);
      await client.updateSchedule({
        id: schedule.id,
        expectedVersion: schedule.version,
        draft: next,
      });
      setMessage(`「${schedule.title}」を${carryDate}へ繰り越しました。`);
      await query.refetch();
    } catch {
      setError(
        "繰り越し先がDSTで存在しないか曖昧です。編集画面でUTCオフセットを確認してください。",
      );
    }
  };

  const applyBulkClassification = async () => {
    setError(null);
    setMessage(null);
    const patch: BulkClassificationPatch = {};
    if (bulkEnabled.project) patch.project = bulkValues.project;
    if (bulkEnabled.category) patch.category = bulkValues.category;
    if (bulkEnabled.tags) {
      patch.tags = bulkValues.tags
        .split(",")
        .map((value) => value.trim())
        .filter(Boolean);
    }
    if (bulkEnabled.color) patch.color = bulkValues.color;
    if (bulkEnabled.priority) patch.priority = bulkValues.priority;
    if (selectedIds.size === 0 || Object.keys(patch).length === 0) {
      setError("予定を1件以上選び、変更する分類を1つ以上有効にしてください。");
      return;
    }
    try {
      await client.bulkClassifySchedules([...selectedIds], patch);
      setMessage(`${selectedIds.size}件の分類を一括変更しました。「元に戻す」で一括回復できます。`);
      setSelectedIds(new Set());
      await query.refetch();
    } catch {
      setError("一括変更を適用できませんでした。読み取り専用予定と入力値を確認してください。");
    }
  };
  return (
    <main className="secondary-view">
      <ViewTitle
        eyebrow="検索と一括確認"
        title="予定一覧"
        description="タイトル、説明、場所、分類、タグを横断して検索します。"
      />
      <label className="list-search">
        <span>予定を検索</span>
        <input
          type="search"
          value={search}
          onChange={(event) => {
            setSearch(event.target.value);
            setPage(0);
          }}
          placeholder="タイトル、タグ、プロジェクト…"
        />
      </label>
      <section className="list-filters" aria-labelledby="list-filter-title">
        <div className="section-heading section-heading--compact">
          <h2 id="list-filter-title">絞り込みと並べ替え</h2>
          <button className="button button--subtle" type="button" onClick={resetFilters}>
            条件を解除
          </button>
        </div>
        <div className="list-filter-grid">
          <label>
            開始日
            <input
              type="date"
              value={startDate}
              onChange={(event) => {
                setStartDate(event.target.value);
                setPage(0);
              }}
            />
          </label>
          <label>
            終了日
            <input
              type="date"
              value={endDate}
              min={startDate}
              onChange={(event) => {
                setEndDate(event.target.value);
                setPage(0);
              }}
            />
          </label>
          <label>
            状態
            <select
              value={status}
              onChange={(event) => {
                setStatus(event.target.value);
                setPage(0);
              }}
            >
              <option value="">すべて</option>
              <option value="not_started">未着手</option>
              <option value="scheduled">予定済み</option>
              <option value="in_progress">進行中</option>
              <option value="completed">完了</option>
              <option value="cancelled">取消</option>
            </select>
          </label>
          <label>
            完了条件
            <select
              value={completion}
              onChange={(event) => {
                setCompletion(event.target.value as typeof completion);
                setPage(0);
              }}
            >
              <option value="all">すべて</option>
              <option value="open">未完了のみ</option>
              <option value="completed">完了のみ</option>
            </select>
          </label>
          <label>
            プロジェクト
            <input
              value={project}
              onChange={(event) => {
                setProject(event.target.value);
                setPage(0);
              }}
            />
          </label>
          <label>
            カテゴリ
            <input
              value={category}
              onChange={(event) => {
                setCategory(event.target.value);
                setPage(0);
              }}
            />
          </label>
          <label>
            タグ（完全一致）
            <input
              value={tag}
              onChange={(event) => {
                setTag(event.target.value);
                setPage(0);
              }}
            />
          </label>
          <label>
            優先度
            <select
              value={priority}
              onChange={(event) => {
                setPriority(event.target.value);
                setPage(0);
              }}
            >
              <option value="">すべて</option>
              <option value="low">低</option>
              <option value="normal">通常</option>
              <option value="high">高</option>
              <option value="urgent">緊急</option>
            </select>
          </label>
          <label>
            同期状態
            <select
              value={syncStatus}
              onChange={(event) => {
                setSyncStatus(event.target.value);
                setPage(0);
              }}
            >
              <option value="">すべて</option>
              <option value="local_only">ローカルのみ</option>
              <option value="pending">保留</option>
              <option value="syncing">同期中</option>
              <option value="synced">同期済み</option>
              <option value="retry_scheduled">再試行待ち</option>
              <option value="conflict">競合</option>
              <option value="read_only">読み取り専用</option>
            </select>
          </label>
          <label>
            同期先カレンダー名
            <input
              value={syncTarget}
              onChange={(event) => {
                setSyncTarget(event.target.value);
                setPage(0);
              }}
            />
          </label>
          <label>
            並べ替え
            <select
              value={sortBy}
              onChange={(event) => {
                setSortBy(event.target.value as typeof sortBy);
                setPage(0);
              }}
            >
              <option value="start">開始時刻</option>
              <option value="end">終了時刻</option>
              <option value="updated">更新時刻</option>
              <option value="priority">優先度</option>
              <option value="title">タイトル</option>
            </select>
          </label>
          <label className="checkbox-label">
            <input
              type="checkbox"
              checked={sortDescending}
              onChange={(event) => {
                setSortDescending(event.target.checked);
                setPage(0);
              }}
            />
            降順
          </label>
        </div>
      </section>
      <fieldset className="bulk-classification">
        <legend>選択した予定の分類を一括変更</legend>
        <p>
          現在 {selectedIds.size}件を選択中です。有効にした項目だけを変更し、ほかの値は保持します。
        </p>
        <div className="bulk-classification__grid">
          <BulkField
            label="プロジェクト"
            enabled={bulkEnabled.project}
            onEnabled={(enabled) => setBulkEnabled({ ...bulkEnabled, project: enabled })}
          >
            <input
              value={bulkValues.project}
              disabled={!bulkEnabled.project}
              onChange={(event) => setBulkValues({ ...bulkValues, project: event.target.value })}
            />
          </BulkField>
          <BulkField
            label="カテゴリ"
            enabled={bulkEnabled.category}
            onEnabled={(enabled) => setBulkEnabled({ ...bulkEnabled, category: enabled })}
          >
            <input
              value={bulkValues.category}
              disabled={!bulkEnabled.category}
              onChange={(event) => setBulkValues({ ...bulkValues, category: event.target.value })}
            />
          </BulkField>
          <BulkField
            label="タグ（カンマ区切り）"
            enabled={bulkEnabled.tags}
            onEnabled={(enabled) => setBulkEnabled({ ...bulkEnabled, tags: enabled })}
          >
            <input
              value={bulkValues.tags}
              disabled={!bulkEnabled.tags}
              onChange={(event) => setBulkValues({ ...bulkValues, tags: event.target.value })}
            />
          </BulkField>
          <BulkField
            label="色"
            enabled={bulkEnabled.color}
            onEnabled={(enabled) => setBulkEnabled({ ...bulkEnabled, color: enabled })}
          >
            <input
              type="color"
              value={bulkValues.color}
              disabled={!bulkEnabled.color}
              onChange={(event) => setBulkValues({ ...bulkValues, color: event.target.value })}
            />
          </BulkField>
          <BulkField
            label="優先度"
            enabled={bulkEnabled.priority}
            onEnabled={(enabled) => setBulkEnabled({ ...bulkEnabled, priority: enabled })}
          >
            <select
              value={bulkValues.priority}
              disabled={!bulkEnabled.priority}
              onChange={(event) =>
                setBulkValues({
                  ...bulkValues,
                  priority: event.target.value as Schedule["priority"],
                })
              }
            >
              <option value="low">低</option>
              <option value="normal">通常</option>
              <option value="high">高</option>
              <option value="urgent">緊急</option>
            </select>
          </BulkField>
        </div>
        <div className="button-row button-row--wrap">
          <button
            className="button button--primary"
            type="button"
            onClick={() => void applyBulkClassification()}
          >
            {selectedIds.size}件へ一括適用
          </button>
          <button
            className="button button--subtle"
            type="button"
            onClick={() => setSelectedIds(new Set())}
          >
            選択を解除
          </button>
        </div>
      </fieldset>
      <section className="carry-control" aria-labelledby="carry-title">
        <h2 id="carry-title">未完了予定を繰り越す</h2>
        <label>
          繰り越し先
          <input
            type="date"
            value={carryDate}
            onChange={(event) => setCarryDate(event.target.value)}
          />
        </label>
        <p>各行の「繰り越す」で、ローカル時刻と所要時間を保ったまま移動します。</p>
      </section>
      {message ? <StatusMessage tone="success" title={message} /> : null}
      {error ? <StatusMessage tone="warning" title={error} /> : null}
      {items.length === 0 ? (
        <StatusMessage
          title="条件に一致する予定はありません"
          action={
            <button className="button" onClick={() => setSearch("")}>
              検索を解除
            </button>
          }
        >
          予定自体は削除されていません。検索語を変えるか、条件を解除してください。
        </StatusMessage>
      ) : (
        <div className="table-scroll">
          <table>
            <caption>
              {total}件中 {page * pageSize + 1}〜{Math.min(total, (page + 1) * pageSize)}件
            </caption>
            <thead>
              <tr>
                <th scope="col">
                  <label className="table-selection">
                    <span className="sr-only">現在のページをすべて選択</span>
                    <input
                      type="checkbox"
                      checked={items.length > 0 && items.every((item) => selectedIds.has(item.id))}
                      onChange={(event) => {
                        const next = new Set(selectedIds);
                        for (const item of items) {
                          if (event.target.checked) next.add(item.id);
                          else next.delete(item.id);
                        }
                        setSelectedIds(next);
                      }}
                    />
                  </label>
                </th>
                <th>開始</th>
                <th>タイトル</th>
                <th>分類</th>
                <th>状態</th>
                <th>同期</th>
                <th>操作</th>
              </tr>
            </thead>
            <tbody>
              {items.map((schedule) => (
                <tr
                  key={`${schedule.id}-${schedule.startUtc}`}
                  tabIndex={0}
                  onDoubleClick={() =>
                    openFromList(schedule, setSelectedDate, setActiveView, openEdit)
                  }
                  onKeyDown={(event) => {
                    if (event.key === "Enter")
                      openFromList(schedule, setSelectedDate, setActiveView, openEdit);
                  }}
                >
                  <td>
                    <input
                      type="checkbox"
                      checked={selectedIds.has(schedule.id)}
                      aria-label={`${schedule.title}を一括変更の対象にする`}
                      onClick={(event) => event.stopPropagation()}
                      onChange={(event) => {
                        const next = new Set(selectedIds);
                        if (event.target.checked) next.add(schedule.id);
                        else next.delete(schedule.id);
                        setSelectedIds(next);
                      }}
                    />
                  </td>
                  <td>
                    <time>
                      {formatDateHeading(new Date(schedule.startUtc))}{" "}
                      {formatTime(schedule.startUtc)}
                    </time>
                  </td>
                  <td>
                    <strong>{schedule.title}</strong>
                  </td>
                  <td>
                    {schedule.project || "未分類"} / {schedule.category || "未分類"}
                  </td>
                  <td>{schedule.status}</td>
                  <td>{schedule.syncStatus}</td>
                  <td>
                    <button
                      className="button button--subtle"
                      type="button"
                      disabled={["completed", "cancelled"].includes(schedule.status)}
                      onClick={(event) => {
                        event.stopPropagation();
                        void carryOver(schedule);
                      }}
                    >
                      繰り越す
                    </button>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}
      {total > pageSize ? (
        <nav className="pagination" aria-label="予定一覧のページ">
          <button
            className="button"
            type="button"
            disabled={page === 0}
            onClick={() => setPage((current) => Math.max(0, current - 1))}
          >
            前へ
          </button>
          <span>
            {page + 1} / {Math.ceil(total / pageSize)}
          </span>
          <button
            className="button"
            type="button"
            disabled={(page + 1) * pageSize >= total}
            onClick={() => setPage((current) => current + 1)}
          >
            次へ
          </button>
        </nav>
      ) : null}
    </main>
  );
}

function BulkField({
  label,
  enabled,
  onEnabled,
  children,
}: {
  label: string;
  enabled: boolean;
  onEnabled: (enabled: boolean) => void;
  children: ReactNode;
}) {
  return (
    <div className="bulk-classification__field">
      <label className="checkbox-label">
        <input
          type="checkbox"
          checked={enabled}
          onChange={(event) => onEnabled(event.target.checked)}
        />
        {label}を変更
      </label>
      {children}
    </div>
  );
}

async function carriedDraft(
  client: AppClient,
  schedule: Schedule,
  targetDate: string,
): Promise<ScheduleDraft> {
  const startDate = formatInTimeZone(schedule.startUtc, schedule.timezoneId, "yyyy-MM-dd");
  const endDate = formatInTimeZone(schedule.endUtc, schedule.timezoneId, "yyyy-MM-dd");
  const daySpan = differenceInCalendarDays(
    new Date(`${endDate}T12:00:00`),
    new Date(`${startDate}T12:00:00`),
  );
  const targetEndDate = format(addDays(new Date(`${targetDate}T12:00:00`), daySpan), "yyyy-MM-dd");
  const startLocal = schedule.allDay
    ? `${targetDate}T00:00`
    : `${targetDate}T${formatInTimeZone(schedule.startUtc, schedule.timezoneId, "HH:mm")}`;
  const endLocal = schedule.allDay
    ? `${targetEndDate}T00:00`
    : `${targetEndDate}T${formatInTimeZone(schedule.endUtc, schedule.timezoneId, "HH:mm")}`;
  const [startResolution, endResolution] = await Promise.all([
    client.resolveLocalTime(startLocal, schedule.timezoneId),
    client.resolveLocalTime(endLocal, schedule.timezoneId),
  ]);
  if (startResolution.kind !== "single" || endResolution.kind !== "single") {
    throw new Error("ambiguous carryover time");
  }
  return {
    title: schedule.title,
    description: schedule.description,
    location: schedule.location,
    startUtc: startResolution.candidates[0] ?? "",
    endUtc: endResolution.candidates[0] ?? "",
    timezoneId: schedule.timezoneId,
    allDay: schedule.allDay,
    allDayStartDate: schedule.allDay ? targetDate : null,
    allDayEndDateExclusive: schedule.allDay ? targetEndDate : null,
    status: schedule.status,
    project: schedule.project,
    category: schedule.category,
    tags: schedule.tags,
    color: schedule.color,
    priority: schedule.priority,
    recurrenceRule: schedule.recurrenceRule,
    recurrenceExdates: schedule.recurrenceExdates,
    startNotificationMinutes: schedule.startNotificationMinutes,
    endNotificationMinutes: schedule.endNotificationMinutes,
  };
}

function openFromList(
  schedule: Schedule,
  setDate: (date: Date) => void,
  setView: (view: "today") => void,
  openEdit: (id: string) => void,
) {
  setDate(new Date(schedule.startUtc));
  setView("today");
  openEdit(schedule.id);
}

function schedulesForDate(items: Schedule[], date: Date): Schedule[] {
  const start = new Date(date);
  start.setHours(0, 0, 0, 0);
  const end = addDays(start, 1);
  return items
    .filter(
      (item) =>
        Date.parse(item.startUtc) < end.getTime() && Date.parse(item.endUtc) > start.getTime(),
    )
    .sort((left, right) => Date.parse(left.startUtc) - Date.parse(right.startUtc));
}

export function ViewTitle({
  eyebrow,
  title,
  description,
}: {
  eyebrow: string;
  title: string;
  description: string;
}) {
  return (
    <header className="view-title">
      <span className="eyebrow">{eyebrow}</span>
      <h1>{title}</h1>
      <p>{description}</p>
    </header>
  );
}

function ViewError({ onRetry }: { onRetry: () => void }) {
  return (
    <main className="secondary-view">
      <StatusMessage
        tone="danger"
        title="予定を読み込めませんでした"
        action={
          <button className="button" onClick={onRetry}>
            再読み込み
          </button>
        }
      >
        この端末のデータは変更されていません。
      </StatusMessage>
    </main>
  );
}
