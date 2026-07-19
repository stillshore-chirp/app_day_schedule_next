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
import { StatusMessage } from "../../shared/ui/StatusMessage";

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
      : "時刻を確認してください";
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
        setErrors({ form: "DSTで存在しない時刻があるため、繰り返しをプレビューできません。" });
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
        setErrors({ form: "先にDSTのUTCオフセットを選んでください。" });
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
      setErrors({ form: "RRULE、日時、タイムゾーンを確認してください。" });
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
        nextErrors.startUtc = "この開始時刻はDST移行で存在しません。別の時刻を選んでください。";
      }
      if (endResolution.kind === "gap") {
        nextErrors.endUtc = "この終了時刻はDST移行で存在しません。別の時刻を選んでください。";
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
        setErrors({ form: "DSTで同じ時刻が2回あります。UTCオフセットを選んでください。" });
        return;
      }
      startUtc = startResolution.candidates[foldChoice.start ?? 0] ?? "";
      endUtc = endResolution.candidates[foldChoice.end ?? 0] ?? "";
    } catch {
      setErrors({
        startUtc: "開始・終了とIANAタイムゾーンを確認してください。入力は保持されています。",
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
          <span className="eyebrow">{mode === "create" ? "新しい予定" : "選択中の予定"}</span>
          <h2 id="inspector-title">{mode === "create" ? "予定を作成" : "予定を編集"}</h2>
        </div>
        <button className="icon-button" type="button" aria-label="編集を閉じる" onClick={onClose}>
          ×
        </button>
      </div>

      <form className="inspector__form" onSubmit={(event) => void submit(event)} noValidate>
        {readOnly ? (
          <StatusMessage tone="warning" title="Google側で編集できない予定です">
            特殊イベントまたは読み取り専用カレンダーのため、この予定は変更・削除できません。複製すると通常のローカル予定として編集できます。
          </StatusMessage>
        ) : null}
        <label>
          タイトル
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
            開始
            <input
              type="datetime-local"
              value={state.start}
              onChange={(event) => updateLocalTime("start", event.target.value)}
              aria-invalid={Boolean(errors.startUtc)}
            />
          </label>
          <label>
            終了
            <input
              type="datetime-local"
              value={state.end}
              onChange={(event) => updateLocalTime("end", event.target.value)}
              aria-invalid={Boolean(errors.endUtc)}
            />
          </label>
          <label>
            優先度
            <select
              value={state.priority}
              onChange={(event) => update("priority", event.target.value as FormState["priority"])}
            >
              <option value="low">低</option>
              <option value="normal">通常</option>
              <option value="high">高</option>
              <option value="urgent">最優先</option>
            </select>
          </label>
        </div>
        <div className="field-pair">
          <label>
            繰り返し
            <select
              value={presetRecurrence(state.recurrenceRule)}
              onChange={(event) => {
                update("recurrenceRule", event.target.value);
                setRecurrencePreview(null);
              }}
            >
              <option value="">繰り返さない</option>
              <option value="FREQ=DAILY">毎日</option>
              <option value="FREQ=WEEKLY">毎週</option>
              <option value="FREQ=MONTHLY">毎月</option>
              <option value="FREQ=YEARLY">毎年</option>
              <option value="FREQ=WEEKLY;BYDAY=MO,TU,WE,TH,FR">平日</option>
              <option value="custom">カスタム RRULE</option>
            </select>
          </label>
          <label className="checkbox-label">
            <input
              type="checkbox"
              checked={state.allDay}
              onChange={(event) => setAllDay(event.target.checked)}
            />
            終日予定
          </label>
        </div>
        {presetRecurrence(state.recurrenceRule) === "custom" ? (
          <label>
            カスタム RRULE
            <input
              value={state.recurrenceRule}
              onChange={(event) => {
                update("recurrenceRule", event.target.value);
                setRecurrencePreview(null);
              }}
              placeholder="FREQ=WEEKLY;INTERVAL=2;BYDAY=MO,TH"
            />
          </label>
        ) : null}
        {state.recurrenceRule ? (
          <div className="recurrence-preview">
            <button className="button" type="button" onClick={() => void showRecurrencePreview()}>
              次の10件をプレビュー
            </button>
            {recurrencePreview ? (
              <div role="status">
                <p>
                  {recurrencePreview.items.length}件
                  {recurrencePreview.infinite ? "・終了なし" : "・終了条件あり"}
                </p>
                <ol>
                  {recurrencePreview.items.map((item) => (
                    <li key={item.startUtc}>
                      {new Intl.DateTimeFormat("ja-JP", {
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
            <legend>変更する範囲</legend>
            <label>
              <input
                type="radio"
                name="recurrence-scope"
                checked={recurrenceScope === "this"}
                onChange={() => setRecurrenceScope("this")}
              />
              この予定だけ
            </label>
            <label>
              <input
                type="radio"
                name="recurrence-scope"
                checked={recurrenceScope === "following"}
                onChange={() => setRecurrenceScope("following")}
              />
              これ以降
            </label>
            <label>
              <input
                type="radio"
                name="recurrence-scope"
                checked={recurrenceScope === "series"}
                onChange={() => setRecurrenceScope("series")}
              />
              すべて
            </label>
            <p className="field-help">
              「この予定だけ」は系列へ例外を作成し、「これ以降」は系列を分割します。
            </p>
          </fieldset>
        ) : null}
        <label>
          タイムゾーン（IANA）
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
          所要時間: {duration} ／ タイムゾーン: {state.timezoneId}
        </p>
        {mode === "edit" ? (
          <p className="field-help">
            この予定に紐付いたFocus実績: {formatElapsedSeconds(focusSummary.data?.workSeconds ?? 0)}
          </p>
        ) : null}

        <fieldset>
          <legend>予定の通知</legend>
          <div className="field-pair">
            <NotificationSelect
              label="開始の通知"
              value={state.startNotificationMinutes}
              onChange={(value) => update("startNotificationMinutes", value)}
            />
            <NotificationSelect
              label="終了の通知"
              value={state.endNotificationMinutes}
              onChange={(value) => update("endNotificationMinutes", value)}
            />
          </div>
          <p className="field-help">
            OS通知は設定と権限が有効な場合だけ配信されます。完全終了中は配信できません。
          </p>
        </fieldset>

        {mode === "edit" ? (
          <fieldset className="time-adjuster">
            <legend>キーボード・クリックで時刻を調整</legend>
            <div className="button-row button-row--wrap">
              <button type="button" onClick={() => shift(-snapMinutes)}>
                −{snapMinutes}分 移動
              </button>
              <button type="button" onClick={() => shift(snapMinutes)}>
                ＋{snapMinutes}分 移動
              </button>
              <button type="button" onClick={() => resize("start", -snapMinutes)}>
                開始を早める
              </button>
              <button type="button" onClick={() => resize("end", snapMinutes)}>
                終了を延ばす
              </button>
            </div>
          </fieldset>
        ) : null}

        <div className="field-pair">
          <label>
            プロジェクト
            <input
              value={state.project}
              onChange={(event) => update("project", event.target.value)}
            />
          </label>
          <label>
            カテゴリ
            <input
              value={state.category}
              onChange={(event) => update("category", event.target.value)}
            />
          </label>
        </div>
        <label>
          タグ（カンマ区切り）
          <input value={state.tags} onChange={(event) => update("tags", event.target.value)} />
        </label>
        <div className="field-pair">
          <label>
            状態
            <select
              value={state.status}
              onChange={(event) => update("status", event.target.value as FormState["status"])}
            >
              <option value="not_started">未着手</option>
              <option value="scheduled">予定済み</option>
              <option value="in_progress">進行中</option>
              <option value="completed">完了</option>
              <option value="cancelled">取消</option>
            </select>
          </label>
          <label>
            色
            <input
              type="color"
              value={state.color}
              onChange={(event) => update("color", event.target.value)}
            />
          </label>
        </div>
        <label>
          場所
          <input
            value={state.location}
            onChange={(event) => update("location", event.target.value)}
          />
        </label>
        <label>
          説明
          <textarea
            rows={3}
            value={state.description}
            onChange={(event) => update("description", event.target.value)}
          />
        </label>

        <div className="inspector__actions">
          <button className="button button--primary" type="submit" disabled={busy || readOnly}>
            {busy ? "この端末に保存中…" : mode === "create" ? "予定を作成" : "変更を保存"}
          </button>
          <button className="button" type="button" onClick={onClose}>
            キャンセル
          </button>
          {mode === "edit" && onDuplicate ? (
            <button
              className="button"
              type="button"
              disabled={busy}
              onClick={() => void onDuplicate()}
            >
              複製して編集
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
                予定を削除…
              </button>
            ) : (
              <div role="alert">
                <strong>この予定をこの端末から削除しますか？</strong>
                <p>
                  {schedule?.recurrenceRule
                    ? recurrenceScope === "this"
                      ? "この発生だけを系列の例外として削除します。"
                      : recurrenceScope === "following"
                        ? "この発生以降を系列から削除します。"
                        : "繰り返し系列全体を削除します。"
                    : "この予定を削除します。"}
                  削除後も「元に戻す」で回復できます。
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
                    この端末から削除
                  </button>
                  <button className="button" type="button" onClick={() => setDeletePending(false)}>
                    削除しない
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
  return hours > 0 ? `${hours}時間${minutes}分${seconds}秒` : `${minutes}分${seconds}秒`;
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
      <legend>{edge === "start" ? "開始" : "終了"}はDSTで2回現れる時刻です</legend>
      <p className="field-help">保存するUTCオフセットを選んでください。黙って補正しません。</p>
      {candidates.map((candidate, index) => (
        <label key={candidate}>
          <input
            type="radio"
            name={`dst-${edge}`}
            checked={selected === index}
            onChange={() => onChange(index)}
          />
          {new Intl.DateTimeFormat("ja-JP", {
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
        <option value="">なし</option>
        <option value="0">時刻ちょうど</option>
        <option value="5">5分前</option>
        <option value="10">10分前</option>
        <option value="15">15分前</option>
        <option value="30">30分前</option>
        <option value="60">1時間前</option>
      </select>
    </label>
  );
}
