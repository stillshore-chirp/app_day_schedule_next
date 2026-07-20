import { appLocale, translate } from "../../shared/i18n/messages";
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
        eyebrow={translate("features.views.CalendarViews.001")}
        title={translate("features.views.CalendarViews.002")}
        description={translate("features.views.CalendarViews.003")}
      />
      <div className="week-grid" aria-label={translate("features.views.CalendarViews.004")}>
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
                <span>{new Intl.DateTimeFormat(appLocale, { weekday: "short" }).format(date)}</span>
                <strong>{date.getDate()}</strong>
                <small>
                  {schedules.length}
                  {translate("features.views.CalendarViews.005")}
                </small>
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
        eyebrow={translate("features.views.CalendarViews.006")}
        title={translate("features.views.CalendarViews.007")}
        description={translate("features.views.CalendarViews.008")}
      />
      <div
        className="month-grid"
        role="grid"
        aria-label={translate("features.views.CalendarViews.009", [
          selectedDate.getFullYear(),
          selectedDate.getMonth() + 1,
        ])}
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
                <span>
                  {schedules.length}
                  {translate("features.views.CalendarViews.010")}
                </span>
                <small>
                  {Math.round((minutes / 60) * 10) / 10}
                  {translate("features.views.CalendarViews.011")}
                </small>
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
      setError(translate("features.views.CalendarViews.012"));
      return;
    }
    try {
      const next = await carriedDraft(client, schedule, carryDate);
      await client.updateSchedule({
        id: schedule.id,
        expectedVersion: schedule.version,
        draft: next,
      });
      setMessage(translate("features.views.CalendarViews.013", [schedule.title, carryDate]));
      await query.refetch();
    } catch {
      setError(translate("features.views.CalendarViews.014"));
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
      setError(translate("features.views.CalendarViews.015"));
      return;
    }
    try {
      await client.bulkClassifySchedules([...selectedIds], patch);
      setMessage(translate("features.views.CalendarViews.016", [selectedIds.size]));
      setSelectedIds(new Set());
      await query.refetch();
    } catch {
      setError(translate("features.views.CalendarViews.017"));
    }
  };
  return (
    <main className="secondary-view">
      <ViewTitle
        eyebrow={translate("features.views.CalendarViews.018")}
        title={translate("features.views.CalendarViews.019")}
        description={translate("features.views.CalendarViews.020")}
      />
      <label className="list-search">
        <span>{translate("features.views.CalendarViews.021")}</span>
        <input
          type="search"
          value={search}
          onChange={(event) => {
            setSearch(event.target.value);
            setPage(0);
          }}
          placeholder={translate("features.views.CalendarViews.022")}
        />
      </label>
      <section className="list-filters" aria-labelledby="list-filter-title">
        <div className="section-heading section-heading--compact">
          <h2 id="list-filter-title">{translate("features.views.CalendarViews.023")}</h2>
          <button className="button button--subtle" type="button" onClick={resetFilters}>
            {translate("features.views.CalendarViews.024")}
          </button>
        </div>
        <div className="list-filter-grid">
          <label>
            {translate("features.views.CalendarViews.025")}
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
            {translate("features.views.CalendarViews.026")}
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
            {translate("features.views.CalendarViews.027")}
            <select
              value={status}
              onChange={(event) => {
                setStatus(event.target.value);
                setPage(0);
              }}
            >
              <option value="">{translate("features.views.CalendarViews.028")}</option>
              <option value="not_started">{translate("features.views.CalendarViews.029")}</option>
              <option value="scheduled">{translate("features.views.CalendarViews.030")}</option>
              <option value="in_progress">{translate("features.views.CalendarViews.031")}</option>
              <option value="completed">{translate("features.views.CalendarViews.032")}</option>
              <option value="cancelled">{translate("features.views.CalendarViews.033")}</option>
            </select>
          </label>
          <label>
            {translate("features.views.CalendarViews.034")}
            <select
              value={completion}
              onChange={(event) => {
                setCompletion(event.target.value as typeof completion);
                setPage(0);
              }}
            >
              <option value="all">{translate("features.views.CalendarViews.035")}</option>
              <option value="open">{translate("features.views.CalendarViews.036")}</option>
              <option value="completed">{translate("features.views.CalendarViews.037")}</option>
            </select>
          </label>
          <label>
            {translate("features.views.CalendarViews.038")}
            <input
              value={project}
              onChange={(event) => {
                setProject(event.target.value);
                setPage(0);
              }}
            />
          </label>
          <label>
            {translate("features.views.CalendarViews.039")}
            <input
              value={category}
              onChange={(event) => {
                setCategory(event.target.value);
                setPage(0);
              }}
            />
          </label>
          <label>
            {translate("features.views.CalendarViews.040")}
            <input
              value={tag}
              onChange={(event) => {
                setTag(event.target.value);
                setPage(0);
              }}
            />
          </label>
          <label>
            {translate("features.views.CalendarViews.041")}
            <select
              value={priority}
              onChange={(event) => {
                setPriority(event.target.value);
                setPage(0);
              }}
            >
              <option value="">{translate("features.views.CalendarViews.042")}</option>
              <option value="low">{translate("features.views.CalendarViews.043")}</option>
              <option value="normal">{translate("features.views.CalendarViews.044")}</option>
              <option value="high">{translate("features.views.CalendarViews.045")}</option>
              <option value="urgent">{translate("features.views.CalendarViews.046")}</option>
            </select>
          </label>
          <label>
            {translate("features.views.CalendarViews.047")}
            <select
              value={syncStatus}
              onChange={(event) => {
                setSyncStatus(event.target.value);
                setPage(0);
              }}
            >
              <option value="">{translate("features.views.CalendarViews.048")}</option>
              <option value="local_only">{translate("features.views.CalendarViews.049")}</option>
              <option value="pending">{translate("features.views.CalendarViews.050")}</option>
              <option value="syncing">{translate("features.views.CalendarViews.051")}</option>
              <option value="synced">{translate("features.views.CalendarViews.052")}</option>
              <option value="retry_scheduled">
                {translate("features.views.CalendarViews.053")}
              </option>
              <option value="conflict">{translate("features.views.CalendarViews.054")}</option>
              <option value="read_only">{translate("features.views.CalendarViews.055")}</option>
            </select>
          </label>
          <label>
            {translate("features.views.CalendarViews.056")}
            <input
              value={syncTarget}
              onChange={(event) => {
                setSyncTarget(event.target.value);
                setPage(0);
              }}
            />
          </label>
          <label>
            {translate("features.views.CalendarViews.057")}
            <select
              value={sortBy}
              onChange={(event) => {
                setSortBy(event.target.value as typeof sortBy);
                setPage(0);
              }}
            >
              <option value="start">{translate("features.views.CalendarViews.058")}</option>
              <option value="end">{translate("features.views.CalendarViews.059")}</option>
              <option value="updated">{translate("features.views.CalendarViews.060")}</option>
              <option value="priority">{translate("features.views.CalendarViews.061")}</option>
              <option value="title">{translate("features.views.CalendarViews.062")}</option>
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
            {translate("features.views.CalendarViews.063")}
          </label>
        </div>
      </section>
      <fieldset className="bulk-classification">
        <legend>{translate("features.views.CalendarViews.064")}</legend>
        <p>
          {translate("features.views.CalendarViews.065")}
          {selectedIds.size}
          {translate("features.views.CalendarViews.066")}
        </p>
        <div className="bulk-classification__grid">
          <BulkField
            label={translate("features.views.CalendarViews.067")}
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
            label={translate("features.views.CalendarViews.068")}
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
            label={translate("features.views.CalendarViews.069")}
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
            label={translate("features.views.CalendarViews.070")}
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
            label={translate("features.views.CalendarViews.071")}
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
              <option value="low">{translate("features.views.CalendarViews.072")}</option>
              <option value="normal">{translate("features.views.CalendarViews.073")}</option>
              <option value="high">{translate("features.views.CalendarViews.074")}</option>
              <option value="urgent">{translate("features.views.CalendarViews.075")}</option>
            </select>
          </BulkField>
        </div>
        <div className="button-row button-row--wrap">
          <button
            className="button button--primary"
            type="button"
            onClick={() => void applyBulkClassification()}
          >
            {selectedIds.size}
            {translate("features.views.CalendarViews.076")}
          </button>
          <button
            className="button button--subtle"
            type="button"
            onClick={() => setSelectedIds(new Set())}
          >
            {translate("features.views.CalendarViews.077")}
          </button>
        </div>
      </fieldset>
      <section className="carry-control" aria-labelledby="carry-title">
        <h2 id="carry-title">{translate("features.views.CalendarViews.078")}</h2>
        <label>
          {translate("features.views.CalendarViews.079")}
          <input
            type="date"
            value={carryDate}
            onChange={(event) => setCarryDate(event.target.value)}
          />
        </label>
        <p>{translate("features.views.CalendarViews.080")}</p>
      </section>
      {message ? <StatusMessage tone="success" title={message} /> : null}
      {error ? <StatusMessage tone="warning" title={error} /> : null}
      {items.length === 0 ? (
        <StatusMessage
          title={translate("features.views.CalendarViews.081")}
          action={
            <button className="button" onClick={() => setSearch("")}>
              {translate("features.views.CalendarViews.082")}
            </button>
          }
        >
          {translate("features.views.CalendarViews.083")}
        </StatusMessage>
      ) : (
        <div className="table-scroll">
          <table>
            <caption>
              {total}
              {translate("features.views.CalendarViews.084")}
              {page * pageSize + 1}〜{Math.min(total, (page + 1) * pageSize)}
              {translate("features.views.CalendarViews.085")}
            </caption>
            <thead>
              <tr>
                <th scope="col">
                  <label className="table-selection">
                    <span className="sr-only">{translate("features.views.CalendarViews.086")}</span>
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
                <th>{translate("features.views.CalendarViews.087")}</th>
                <th>{translate("features.views.CalendarViews.088")}</th>
                <th>{translate("features.views.CalendarViews.089")}</th>
                <th>{translate("features.views.CalendarViews.090")}</th>
                <th>{translate("features.views.CalendarViews.091")}</th>
                <th>{translate("features.views.CalendarViews.092")}</th>
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
                      aria-label={translate("features.views.CalendarViews.093", [schedule.title])}
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
                    {schedule.project || translate("features.views.CalendarViews.094")} /{" "}
                    {schedule.category || translate("features.views.CalendarViews.095")}
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
                      {translate("features.views.CalendarViews.096")}
                    </button>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}
      {total > pageSize ? (
        <nav className="pagination" aria-label={translate("features.views.CalendarViews.097")}>
          <button
            className="button"
            type="button"
            disabled={page === 0}
            onClick={() => setPage((current) => Math.max(0, current - 1))}
          >
            {translate("features.views.CalendarViews.098")}
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
            {translate("features.views.CalendarViews.099")}
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
        {label}
        {translate("features.views.CalendarViews.100")}
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
        title={translate("features.views.CalendarViews.101")}
        action={
          <button className="button" onClick={onRetry}>
            {translate("features.views.CalendarViews.102")}
          </button>
        }
      >
        {translate("features.views.CalendarViews.103")}
      </StatusMessage>
    </main>
  );
}
