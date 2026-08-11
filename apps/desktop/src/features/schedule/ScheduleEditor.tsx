import { appLocale, translate } from "../../shared/i18n/messages";
import { useEffect, useMemo, useState } from "react";
import { useQuery } from "@tanstack/react-query";
import { addMinutes } from "date-fns";
import { formatInTimeZone } from "date-fns-tz";
import {
  scheduleDraftSchema,
  type RecurrencePreview,
  type Schedule,
  type ScheduleDraft,
} from "../../shared/contracts";
import type { AppClient } from "../../shared/ipc/client";
import { formatDuration, localDateTimeInput } from "../../shared/time";
import { MarkdownDescriptionField } from "../../shared/ui/MarkdownDescriptionField";
import { StatusMessage } from "../../shared/ui/StatusMessage";
import { ScheduleTicketLink } from "./ScheduleTicketLink";

interface ScheduleEditorProps {
  client: AppClient;
  schedule: Schedule | null;
  selectedDate: Date;
  timezoneId: string;
  snapMinutes: number;
  mode: "create" | "edit";
  busy: boolean;
  onSave: (
    draft: ScheduleDraft,
    recurrence?: { scope: "this" | "following" | "series"; occurrenceStartUtc: string },
  ) => Promise<void>;
  onDelete?: (recurrence?: {
    scope: "this" | "following" | "series";
    occurrenceStartUtc: string;
  }) => Promise<void>;
  onDuplicate?: () => Promise<void>;
  onClose: () => void;
  initialRange?: { startUtc: string; endUtc: string } | null;
  onOpenTickets?: () => void;
}

interface FormState {
  title: string;
  start: string;
  end: string;
  description: string;
  location: string;
  project: string;
  category: string;
  tags: string;
  color: string;
  status: ScheduleDraft["status"];
  allDay: boolean;
  priority: ScheduleDraft["priority"];
  recurrenceRule: string;
  recurrenceSupplementalLines: string[];
  recurrenceExdates: string[];
  startNotificationMinutes: string;
  endNotificationMinutes: string;
  timezoneId: string;
}

function defaultTimes(selectedDate: Date): { start: string; end: string } {
  const start = new Date(selectedDate);
  const now = new Date();
  if (start.toDateString() === now.toDateString()) {
    start.setHours(now.getHours(), Math.ceil(now.getMinutes() / 5) * 5, 0, 0);
  } else {
    start.setHours(9, 0, 0, 0);
  }
  const end = addMinutes(start, 30);
  return {
    start: localDateTimeInput(start.toISOString()),
    end: localDateTimeInput(end.toISOString()),
  };
}

function toState(
  schedule: Schedule | null,
  selectedDate: Date,
  fallbackTimezoneId: string,
  initialRange?: { startUtc: string; endUtc: string } | null,
): FormState {
  const timezoneId = schedule?.timezoneId ?? fallbackTimezoneId;
  const times = schedule
    ? {
        start:
          schedule.allDay && schedule.allDayStartDate
            ? `${schedule.allDayStartDate}T00:00`
            : formatInTimeZone(schedule.startUtc, timezoneId, "yyyy-MM-dd'T'HH:mm"),
        end:
          schedule.allDay && schedule.allDayEndDateExclusive
            ? `${schedule.allDayEndDateExclusive}T00:00`
            : formatInTimeZone(schedule.endUtc, timezoneId, "yyyy-MM-dd'T'HH:mm"),
      }
    : initialRange
      ? {
          start: localDateTimeInput(initialRange.startUtc),
          end: localDateTimeInput(initialRange.endUtc),
        }
      : defaultTimes(selectedDate);
  return {
    title: schedule?.title ?? "",
    start: times.start,
    end: times.end,
    description: schedule?.description ?? "",
    location: schedule?.location ?? "",
    project: schedule?.project ?? "",
    category: schedule?.category ?? "",
    tags: schedule?.tags.join(", ") ?? "",
    color: schedule?.color ?? "#6F96F4",
    status: schedule?.status ?? "scheduled",
    allDay: schedule?.allDay ?? false,
    priority: schedule?.priority ?? "normal",
    recurrenceRule: schedule?.recurrenceRule ?? "",
    recurrenceSupplementalLines: schedule?.recurrenceSupplementalLines ?? [],
    recurrenceExdates: schedule?.recurrenceExdates ?? [],
    startNotificationMinutes: schedule?.startNotificationMinutes?.toString() ?? "",
    endNotificationMinutes: schedule?.endNotificationMinutes?.toString() ?? "",
    timezoneId,
  };
}

export function ScheduleEditor({
  client,
  schedule,
  selectedDate,
  timezoneId,
  snapMinutes,
  mode,
  busy,
  onSave,
  onDelete,
  onDuplicate,
  onClose,
  initialRange,
  onOpenTickets,
}: ScheduleEditorProps) {
  const [state, setState] = useState(() =>
    toState(schedule, selectedDate, timezoneId, initialRange),
  );
  const [errors, setErrors] = useState<Record<string, string>>({});
  const [deletePending, setDeletePending] = useState(false);
  const [ambiguity, setAmbiguity] = useState<Record<"start" | "end", string[] | undefined>>({
    start: undefined,
    end: undefined,
  });
  const [foldChoice, setFoldChoice] = useState<Record<"start" | "end", number | undefined>>({
    start: undefined,
    end: undefined,
  });
  const [recurrencePreview, setRecurrencePreview] = useState<RecurrencePreview | null>(null);
  const [recurrenceScope, setRecurrenceScope] = useState<"this" | "following" | "series">("this");
  const readOnly = schedule?.syncStatus === "read_only";
  const protectedGoogleRecurrence =
    readOnly && Boolean(schedule?.recurrenceSupplementalLines.length);
  const focusSummary = useQuery({
    queryKey: ["focus-schedule-summary", schedule?.id],
    queryFn: () => client.focusScheduleSummary(schedule?.id ?? ""),
    enabled: mode === "edit" && Boolean(schedule),
  });

  useEffect(() => {
    setState(toState(schedule, selectedDate, timezoneId, initialRange));
    setErrors({});
    setDeletePending(false);
    setAmbiguity({ start: undefined, end: undefined });
    setFoldChoice({ start: undefined, end: undefined });
    setRecurrencePreview(null);
    setRecurrenceScope("this");
  }, [schedule, selectedDate, timezoneId, mode, initialRange]);

  const duration = useMemo(() => {
    const minutes = Math.round((Date.parse(state.end) - Date.parse(state.start)) / 60_000);
    return Number.isFinite(minutes) && minutes > 0
      ? formatDuration(minutes)
      : translate("features.schedule.ScheduleEditor.001");
  }, [state.end, state.start]);

  const update = <Key extends keyof FormState>(key: Key, value: FormState[Key]) => {
    setState((current) => ({ ...current, [key]: value }));
  };

  const updateLocalTime = (edge: "start" | "end", value: string) => {
    update(edge, value);
    setFoldChoice((current) => ({ ...current, [edge]: undefined }));
    setAmbiguity((current) => ({ ...current, [edge]: undefined }));
  };

  const setAllDay = (checked: boolean) => {
    if (!checked) {
      update("allDay", false);
      return;
    }
    const startDate = state.start.slice(0, 10);
    const endDate = nextDateKey(startDate);
    setState((current) => ({
      ...current,
      allDay: true,
      start: `${startDate}T00:00`,
      end: `${endDate}T00:00`,
    }));
    setFoldChoice({ start: undefined, end: undefined });
    setAmbiguity({ start: undefined, end: undefined });
  };

  const shift = (minutes: number) => {
    const start = addMinutes(new Date(state.start), minutes);
    const end = addMinutes(new Date(state.end), minutes);
    update("start", localDateTimeInput(start.toISOString()));
    update("end", localDateTimeInput(end.toISOString()));
  };

  const resize = (edge: "start" | "end", minutes: number) => {
    const value = addMinutes(new Date(edge === "start" ? state.start : state.end), minutes);
    update(edge, localDateTimeInput(value.toISOString()));
  };

  const showRecurrencePreview = async () => {
    try {
      const [start, end] = await Promise.all([
        client.resolveLocalTime(state.start, state.timezoneId),
        client.resolveLocalTime(state.end, state.timezoneId),
      ]);
      if (start.kind === "gap" || end.kind === "gap") {
        setErrors({ form: translate("features.schedule.ScheduleEditor.002") });
        return;
      }
      if (
        (start.kind === "ambiguous" && foldChoice.start === undefined) ||
        (end.kind === "ambiguous" && foldChoice.end === undefined)
      ) {
        setAmbiguity({
          start: start.kind === "ambiguous" ? start.candidates : undefined,
          end: end.kind === "ambiguous" ? end.candidates : undefined,
        });
        setErrors({ form: translate("features.schedule.ScheduleEditor.003") });
        return;
      }
      setRecurrencePreview(
        await client.previewRecurrence({
          startUtc: start.candidates[foldChoice.start ?? 0] ?? "",
          endUtc: end.candidates[foldChoice.end ?? 0] ?? "",
          timezoneId: state.timezoneId,
          recurrenceRule: state.recurrenceRule,
        }),
      );
      setErrors({});
    } catch {
      setRecurrencePreview(null);
      setErrors({ form: translate("features.schedule.ScheduleEditor.004") });
    }
  };

  const submit = async (event: React.FormEvent) => {
    event.preventDefault();
    let startUtc: string;
    let endUtc: string;
    try {
      const [startResolution, endResolution] = await Promise.all([
        client.resolveLocalTime(state.start, state.timezoneId),
        client.resolveLocalTime(state.end, state.timezoneId),
      ]);
      const nextErrors: Record<string, string> = {};
      if (startResolution.kind === "gap") {
        nextErrors.startUtc = translate("features.schedule.ScheduleEditor.005");
      }
      if (endResolution.kind === "gap") {
        nextErrors.endUtc = translate("features.schedule.ScheduleEditor.006");
      }
      if (Object.keys(nextErrors).length > 0) {
        setErrors(nextErrors);
        return;
      }
      const nextAmbiguity = {
        start: startResolution.kind === "ambiguous" ? startResolution.candidates : undefined,
        end: endResolution.kind === "ambiguous" ? endResolution.candidates : undefined,
      };
      setAmbiguity(nextAmbiguity);
      if (
        (nextAmbiguity.start && foldChoice.start === undefined) ||
        (nextAmbiguity.end && foldChoice.end === undefined)
      ) {
        setErrors({ form: translate("features.schedule.ScheduleEditor.007") });
        return;
      }
      startUtc = startResolution.candidates[foldChoice.start ?? 0] ?? "";
      endUtc = endResolution.candidates[foldChoice.end ?? 0] ?? "";
    } catch {
      setErrors({
        startUtc: translate("features.schedule.ScheduleEditor.008"),
      });
      return;
    }
    const parsed = scheduleDraftSchema.safeParse({
      title: state.title,
      description: state.description,
      location: state.location,
      startUtc,
      endUtc,
      timezoneId: state.timezoneId,
      allDay: state.allDay,
      allDayStartDate: state.allDay ? state.start.slice(0, 10) : null,
      allDayEndDateExclusive: state.allDay ? state.end.slice(0, 10) : null,
      status: state.status,
      project: state.project,
      category: state.category,
      tags: state.tags
        .split(",")
        .map((tag) => tag.trim())
        .filter(Boolean),
      color: state.color,
      priority: state.priority,
      recurrenceRule: state.recurrenceRule.trim() || null,
      recurrenceSupplementalLines: state.recurrenceSupplementalLines,
      recurrenceExdates: state.recurrenceExdates,
      startNotificationMinutes:
        state.startNotificationMinutes === "" ? null : Number(state.startNotificationMinutes),
      endNotificationMinutes:
        state.endNotificationMinutes === "" ? null : Number(state.endNotificationMinutes),
    });
    if (!parsed.success) {
      const nextErrors: Record<string, string> = {};
      for (const issue of parsed.error.issues) {
        nextErrors[String(issue.path[0] ?? "form")] = issue.message;
      }
      setErrors(nextErrors);
      return;
    }
    setErrors({});
    await onSave(
      parsed.data,
      schedule?.recurrenceRule
        ? { scope: recurrenceScope, occurrenceStartUtc: schedule.startUtc }
        : undefined,
    );
  };

  return (
    <aside className="inspector" aria-labelledby="inspector-title">
      <div className="inspector__header">
        <div>
          <span className="eyebrow">
            {mode === "create"
              ? translate("features.schedule.ScheduleEditor.009")
              : translate("features.schedule.ScheduleEditor.010")}
          </span>
          <h2 id="inspector-title">
            {mode === "create"
              ? translate("features.schedule.ScheduleEditor.011")
              : translate("features.schedule.ScheduleEditor.012")}
          </h2>
        </div>
        <button
          className="icon-button"
          type="button"
          aria-label={translate("features.schedule.ScheduleEditor.013")}
          onClick={onClose}
        >
          ×
        </button>
      </div>

      <form className="inspector__form" onSubmit={(event) => void submit(event)} noValidate>
        {readOnly ? (
          <StatusMessage
            tone="warning"
            title={translate(
              protectedGoogleRecurrence
                ? "features.schedule.ScheduleEditor.095"
                : "features.schedule.ScheduleEditor.014",
            )}
          >
            {translate(
              protectedGoogleRecurrence
                ? "features.schedule.ScheduleEditor.096"
                : "features.schedule.ScheduleEditor.015",
            )}
          </StatusMessage>
        ) : null}
        <label>
          {translate("features.schedule.ScheduleEditor.016")}
          <input
            autoFocus
            value={state.title}
            onChange={(event) => update("title", event.target.value)}
            aria-invalid={Boolean(errors.title)}
            aria-describedby={errors.title ? "title-error" : undefined}
          />
        </label>
        {errors.title ? (
          <p className="field-error" id="title-error">
            {errors.title}
          </p>
        ) : null}

        <div className="field-pair">
          <label>
            {translate("features.schedule.ScheduleEditor.017")}
            <input
              type="datetime-local"
              value={state.start}
              onChange={(event) => updateLocalTime("start", event.target.value)}
              aria-invalid={Boolean(errors.startUtc)}
            />
          </label>
          <label>
            {translate("features.schedule.ScheduleEditor.018")}
            <input
              type="datetime-local"
              value={state.end}
              onChange={(event) => updateLocalTime("end", event.target.value)}
              aria-invalid={Boolean(errors.endUtc)}
            />
          </label>
          <label>
            {translate("features.schedule.ScheduleEditor.019")}
            <select
              value={state.priority}
              onChange={(event) => update("priority", event.target.value as FormState["priority"])}
            >
              <option value="low">{translate("features.schedule.ScheduleEditor.020")}</option>
              <option value="normal">{translate("features.schedule.ScheduleEditor.021")}</option>
              <option value="high">{translate("features.schedule.ScheduleEditor.022")}</option>
              <option value="urgent">{translate("features.schedule.ScheduleEditor.023")}</option>
            </select>
          </label>
        </div>
        <div className="field-pair">
          <label>
            {translate("features.schedule.ScheduleEditor.024")}
            <select
              value={presetRecurrence(state.recurrenceRule)}
              onChange={(event) => {
                update("recurrenceRule", event.target.value);
                update("recurrenceSupplementalLines", []);
                setRecurrencePreview(null);
              }}
            >
              <option value="">{translate("features.schedule.ScheduleEditor.025")}</option>
              <option value="FREQ=DAILY">
                {translate("features.schedule.ScheduleEditor.026")}
              </option>
              <option value="FREQ=WEEKLY">
                {translate("features.schedule.ScheduleEditor.027")}
              </option>
              <option value="FREQ=MONTHLY">
                {translate("features.schedule.ScheduleEditor.028")}
              </option>
              <option value="FREQ=YEARLY">
                {translate("features.schedule.ScheduleEditor.029")}
              </option>
              <option value="FREQ=WEEKLY;BYDAY=MO,TU,WE,TH,FR">
                {translate("features.schedule.ScheduleEditor.030")}
              </option>
              <option value="custom">{translate("features.schedule.ScheduleEditor.031")}</option>
            </select>
          </label>
          <label className="checkbox-label">
            <input
              type="checkbox"
              checked={state.allDay}
              onChange={(event) => setAllDay(event.target.checked)}
            />
            {translate("features.schedule.ScheduleEditor.032")}
          </label>
        </div>
        {presetRecurrence(state.recurrenceRule) === "custom" ? (
          <label>
            {translate("features.schedule.ScheduleEditor.033")}
            <input
              value={state.recurrenceRule}
              onChange={(event) => {
                update("recurrenceRule", event.target.value);
                update("recurrenceSupplementalLines", []);
                setRecurrencePreview(null);
              }}
              placeholder="FREQ=WEEKLY;INTERVAL=2;BYDAY=MO,TH"
            />
          </label>
        ) : null}
        {state.recurrenceRule ? (
          <div className="recurrence-preview">
            <button className="button" type="button" onClick={() => void showRecurrencePreview()}>
              {translate("features.schedule.ScheduleEditor.034")}
            </button>
            {recurrencePreview ? (
              <div role="status">
                <p>
                  {recurrencePreview.items.length}
                  {translate("features.schedule.ScheduleEditor.035")}
                  {recurrencePreview.infinite
                    ? translate("features.schedule.ScheduleEditor.036")
                    : translate("features.schedule.ScheduleEditor.037")}
                </p>
                <ol>
                  {recurrencePreview.items.map((item) => (
                    <li key={item.startUtc}>
                      {new Intl.DateTimeFormat(appLocale, {
                        dateStyle: "medium",
                        timeStyle: "short",
                        timeZone: state.timezoneId,
                      }).format(new Date(item.startUtc))}
                    </li>
                  ))}
                </ol>
                {recurrencePreview.warnings.map((warning) => (
                  <p className="field-error" key={warning}>
                    {warning}
                  </p>
                ))}
              </div>
            ) : null}
          </div>
        ) : null}
        {mode === "edit" && schedule?.recurrenceRule ? (
          <fieldset className="recurrence-scope">
            <legend>{translate("features.schedule.ScheduleEditor.038")}</legend>
            <label>
              <input
                type="radio"
                name="recurrence-scope"
                checked={recurrenceScope === "this"}
                onChange={() => setRecurrenceScope("this")}
              />
              {translate("features.schedule.ScheduleEditor.039")}
            </label>
            <label>
              <input
                type="radio"
                name="recurrence-scope"
                checked={recurrenceScope === "following"}
                onChange={() => setRecurrenceScope("following")}
              />
              {translate("features.schedule.ScheduleEditor.040")}
            </label>
            <label>
              <input
                type="radio"
                name="recurrence-scope"
                checked={recurrenceScope === "series"}
                onChange={() => setRecurrenceScope("series")}
              />
              {translate("features.schedule.ScheduleEditor.041")}
            </label>
            <p className="field-help">{translate("features.schedule.ScheduleEditor.042")}</p>
          </fieldset>
        ) : null}
        <label>
          {translate("features.schedule.ScheduleEditor.043")}
          <input
            list="schedule-timezones"
            value={state.timezoneId}
            onChange={(event) => {
              update("timezoneId", event.target.value);
              setFoldChoice({ start: undefined, end: undefined });
              setAmbiguity({ start: undefined, end: undefined });
            }}
            placeholder="Asia/Tokyo"
          />
          <datalist id="schedule-timezones">
            <option value="Asia/Tokyo" />
            <option value="UTC" />
            <option value="America/New_York" />
            <option value="America/Los_Angeles" />
            <option value="Europe/London" />
            <option value="Europe/Berlin" />
            <option value="Australia/Sydney" />
          </datalist>
        </label>
        {ambiguity.start ? (
          <AmbiguousTimeChoice
            edge="start"
            candidates={ambiguity.start}
            timezoneId={state.timezoneId}
            selected={foldChoice.start}
            onChange={(value) => setFoldChoice({ ...foldChoice, start: value })}
          />
        ) : null}
        {ambiguity.end ? (
          <AmbiguousTimeChoice
            edge="end"
            candidates={ambiguity.end}
            timezoneId={state.timezoneId}
            selected={foldChoice.end}
            onChange={(value) => setFoldChoice({ ...foldChoice, end: value })}
          />
        ) : null}
        {(errors.startUtc ?? errors.endUtc) ? (
          <p className="field-error">{errors.startUtc ?? errors.endUtc}</p>
        ) : null}
        {errors.form ? <p className="field-error">{errors.form}</p> : null}
        <p className="field-help">
          {translate("features.schedule.ScheduleEditor.044")}
          {duration} {translate("features.schedule.ScheduleEditor.045")}
          {state.timezoneId}
        </p>
        {mode === "edit" ? (
          <p className="field-help">
            {translate("features.schedule.ScheduleEditor.046")}
            {formatElapsedSeconds(focusSummary.data?.workSeconds ?? 0)}
          </p>
        ) : null}

        {mode === "edit" && schedule && !readOnly ? (
          <ScheduleTicketLink
            client={client}
            schedule={schedule}
            {...(onOpenTickets ? { onOpenTickets } : {})}
          />
        ) : null}

        <fieldset>
          <legend>{translate("features.schedule.ScheduleEditor.047")}</legend>
          <div className="field-pair">
            <NotificationSelect
              label={translate("features.schedule.ScheduleEditor.048")}
              value={state.startNotificationMinutes}
              onChange={(value) => update("startNotificationMinutes", value)}
            />
            <NotificationSelect
              label={translate("features.schedule.ScheduleEditor.049")}
              value={state.endNotificationMinutes}
              onChange={(value) => update("endNotificationMinutes", value)}
            />
          </div>
          <p className="field-help">{translate("features.schedule.ScheduleEditor.050")}</p>
        </fieldset>

        {mode === "edit" ? (
          <fieldset className="time-adjuster">
            <legend>{translate("features.schedule.ScheduleEditor.051")}</legend>
            <div className="button-row button-row--wrap">
              <button type="button" onClick={() => shift(-snapMinutes)}>
                −{snapMinutes}
                {translate("features.schedule.ScheduleEditor.052")}
              </button>
              <button type="button" onClick={() => shift(snapMinutes)}>
                ＋{snapMinutes}
                {translate("features.schedule.ScheduleEditor.053")}
              </button>
              <button type="button" onClick={() => resize("start", -snapMinutes)}>
                {translate("features.schedule.ScheduleEditor.054")}
              </button>
              <button type="button" onClick={() => resize("end", snapMinutes)}>
                {translate("features.schedule.ScheduleEditor.055")}
              </button>
            </div>
          </fieldset>
        ) : null}

        <div className="field-pair">
          <label>
            {translate("features.schedule.ScheduleEditor.056")}
            <input
              value={state.project}
              onChange={(event) => update("project", event.target.value)}
            />
          </label>
          <label>
            {translate("features.schedule.ScheduleEditor.057")}
            <input
              value={state.category}
              onChange={(event) => update("category", event.target.value)}
            />
          </label>
        </div>
        <label>
          {translate("features.schedule.ScheduleEditor.058")}
          <input value={state.tags} onChange={(event) => update("tags", event.target.value)} />
        </label>
        <div className="field-pair">
          <label>
            {translate("features.schedule.ScheduleEditor.059")}
            <select
              value={state.status}
              onChange={(event) => update("status", event.target.value as FormState["status"])}
            >
              <option value="not_started">
                {translate("features.schedule.ScheduleEditor.060")}
              </option>
              <option value="scheduled">{translate("features.schedule.ScheduleEditor.061")}</option>
              <option value="in_progress">
                {translate("features.schedule.ScheduleEditor.062")}
              </option>
              <option value="completed">{translate("features.schedule.ScheduleEditor.063")}</option>
              <option value="cancelled">{translate("features.schedule.ScheduleEditor.064")}</option>
            </select>
          </label>
          <label>
            {translate("features.schedule.ScheduleEditor.065")}
            <input
              type="color"
              value={state.color}
              onChange={(event) => update("color", event.target.value)}
            />
          </label>
        </div>
        <label>
          {translate("features.schedule.ScheduleEditor.066")}
          <input
            value={state.location}
            onChange={(event) => update("location", event.target.value)}
          />
        </label>
        <MarkdownDescriptionField
          key={schedule?.id ?? "new-schedule"}
          id="schedule-description"
          label={translate("features.schedule.ScheduleEditor.067")}
          rows={8}
          maxLength={10_000}
          value={state.description}
          readOnly={readOnly}
          onChange={(description) => update("description", description)}
        />

        <div className="inspector__actions">
          <button className="button button--primary" type="submit" disabled={busy || readOnly}>
            {busy
              ? translate("features.schedule.ScheduleEditor.068")
              : mode === "create"
                ? translate("features.schedule.ScheduleEditor.069")
                : translate("features.schedule.ScheduleEditor.070")}
          </button>
          <button className="button" type="button" onClick={onClose}>
            {translate("features.schedule.ScheduleEditor.071")}
          </button>
          {mode === "edit" && onDuplicate ? (
            <button
              className="button"
              type="button"
              disabled={busy}
              onClick={() => void onDuplicate()}
            >
              {translate("features.schedule.ScheduleEditor.072")}
            </button>
          ) : null}
        </div>

        {mode === "edit" && onDelete && !readOnly ? (
          <div className="danger-zone">
            {!deletePending ? (
              <button
                className="button button--danger-outline"
                type="button"
                onClick={() => setDeletePending(true)}
              >
                {translate("features.schedule.ScheduleEditor.073")}
              </button>
            ) : (
              <div role="alert">
                <strong>{translate("features.schedule.ScheduleEditor.074")}</strong>
                <p>
                  {schedule?.recurrenceRule
                    ? recurrenceScope === "this"
                      ? translate("features.schedule.ScheduleEditor.075")
                      : recurrenceScope === "following"
                        ? translate("features.schedule.ScheduleEditor.076")
                        : translate("features.schedule.ScheduleEditor.077")
                    : translate("features.schedule.ScheduleEditor.078")}
                  {translate("features.schedule.ScheduleEditor.079")}
                </p>
                <div className="button-row">
                  <button
                    className="button button--danger"
                    type="button"
                    disabled={busy}
                    onClick={() =>
                      void onDelete(
                        schedule?.recurrenceRule
                          ? { scope: recurrenceScope, occurrenceStartUtc: schedule.startUtc }
                          : undefined,
                      )
                    }
                  >
                    {translate("features.schedule.ScheduleEditor.080")}
                  </button>
                  <button className="button" type="button" onClick={() => setDeletePending(false)}>
                    {translate("features.schedule.ScheduleEditor.081")}
                  </button>
                </div>
              </div>
            )}
          </div>
        ) : null}
      </form>
    </aside>
  );
}

const RECURRENCE_PRESETS = new Set([
  "",
  "FREQ=DAILY",
  "FREQ=WEEKLY",
  "FREQ=MONTHLY",
  "FREQ=YEARLY",
  "FREQ=WEEKLY;BYDAY=MO,TU,WE,TH,FR",
]);

function presetRecurrence(value: string): string {
  return RECURRENCE_PRESETS.has(value) ? value : "custom";
}

function nextDateKey(value: string): string {
  const date = new Date(`${value}T00:00:00Z`);
  date.setUTCDate(date.getUTCDate() + 1);
  return date.toISOString().slice(0, 10);
}

function formatElapsedSeconds(totalSeconds: number): string {
  const hours = Math.floor(totalSeconds / 3600);
  const minutes = Math.floor((totalSeconds % 3600) / 60);
  const seconds = totalSeconds % 60;
  return hours > 0
    ? translate("features.schedule.ScheduleEditor.082", [hours, minutes, seconds])
    : translate("features.schedule.ScheduleEditor.083", [minutes, seconds]);
}

function AmbiguousTimeChoice({
  edge,
  candidates,
  timezoneId,
  selected,
  onChange,
}: {
  edge: "start" | "end";
  candidates: string[];
  timezoneId: string;
  selected: number | undefined;
  onChange: (value: number) => void;
}) {
  return (
    <fieldset className="dst-choice">
      <legend>
        {edge === "start"
          ? translate("features.schedule.ScheduleEditor.084")
          : translate("features.schedule.ScheduleEditor.085")}
        {translate("features.schedule.ScheduleEditor.086")}
      </legend>
      <p className="field-help">{translate("features.schedule.ScheduleEditor.087")}</p>
      {candidates.map((candidate, index) => (
        <label key={candidate}>
          <input
            type="radio"
            name={`dst-${edge}`}
            checked={selected === index}
            onChange={() => onChange(index)}
          />
          {new Intl.DateTimeFormat(appLocale, {
            dateStyle: "medium",
            timeStyle: "long",
            timeZone: timezoneId,
          }).format(new Date(candidate))}
          （UTC {candidate}）
        </label>
      ))}
    </fieldset>
  );
}

function NotificationSelect({
  label,
  value,
  onChange,
}: {
  label: string;
  value: string;
  onChange: (value: string) => void;
}) {
  return (
    <label>
      {label}
      <select value={value} onChange={(event) => onChange(event.target.value)}>
        <option value="">{translate("features.schedule.ScheduleEditor.088")}</option>
        <option value="0">{translate("features.schedule.ScheduleEditor.089")}</option>
        <option value="5">{translate("features.schedule.ScheduleEditor.090")}</option>
        <option value="10">{translate("features.schedule.ScheduleEditor.091")}</option>
        <option value="15">{translate("features.schedule.ScheduleEditor.092")}</option>
        <option value="30">{translate("features.schedule.ScheduleEditor.093")}</option>
        <option value="60">{translate("features.schedule.ScheduleEditor.094")}</option>
      </select>
    </label>
  );
}
