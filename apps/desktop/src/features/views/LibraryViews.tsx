import { appLocale, translate } from "../../shared/i18n/messages";
import { useEffect, useState } from "react";
import { useQueryClient } from "@tanstack/react-query";
import {
  dayTemplateDraftSchema,
  freeAlarmDraftSchema,
  quickBlockDraftSchema,
  type DayTemplate,
  type DayTemplateDraft,
  type FreeAlarm,
  type QuickBlock,
  type Settings,
  type TemplatePreview,
} from "../../shared/contracts";
import type { AppClient } from "../../shared/ipc/client";
import { StatusMessage } from "../../shared/ui/StatusMessage";
import { ViewTitle } from "./CalendarViews";

const WEEKDAYS = [
  translate("features.views.LibraryViews.001"),
  translate("features.views.LibraryViews.002"),
  translate("features.views.LibraryViews.003"),
  translate("features.views.LibraryViews.004"),
  translate("features.views.LibraryViews.005"),
  translate("features.views.LibraryViews.006"),
  translate("features.views.LibraryViews.007"),
];

function minuteToTime(value: number): string {
  return `${String(Math.floor(value / 60)).padStart(2, "0")}:${String(value % 60).padStart(2, "0")}`;
}

function timeToMinute(value: string): number {
  const [hour = "0", minute = "0"] = value.split(":");
  return Number(hour) * 60 + Number(minute);
}

export function TemplatesView({
  client,
  timezoneId,
  settings,
}: {
  client: AppClient;
  timezoneId: string;
  settings: Settings;
}) {
  const queryClient = useQueryClient();
  const [templates, setTemplates] = useState<DayTemplate[]>([]);
  const [quickBlocks, setQuickBlocks] = useState<QuickBlock[]>([]);
  const [selected, setSelected] = useState<DayTemplate | null>(null);
  const [draft, setDraft] = useState<DayTemplateDraft>(emptyTemplate());
  const [quickTitle, setQuickTitle] = useState("");
  const [quickTime, setQuickTime] = useState("09:00");
  const [quickDuration, setQuickDuration] = useState(30);
  const [quickColor, setQuickColor] = useState("#68B984");
  const [quickProject, setQuickProject] = useState("");
  const [quickCategory, setQuickCategory] = useState("");
  const [quickStartNotification, setQuickStartNotification] = useState("");
  const [quickEndNotification, setQuickEndNotification] = useState("");
  const [quickEditing, setQuickEditing] = useState<QuickBlock | null>(null);
  const [busy, setBusy] = useState(false);
  const [message, setMessage] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [deleteTarget, setDeleteTarget] = useState<string | null>(null);
  const [applyDate, setApplyDate] = useState(() => localDateInput(new Date()));
  const [applyMode, setApplyMode] = useState<"add" | "replace">("add");
  const [preview, setPreview] = useState<TemplatePreview | null>(null);

  const refresh = async () => {
    const [nextTemplates, nextQuickBlocks] = await Promise.all([
      client.listTemplates(),
      client.listQuickBlocks(),
    ]);
    setTemplates(nextTemplates);
    setQuickBlocks(nextQuickBlocks);
    if (!selected && nextTemplates[0]) chooseTemplate(nextTemplates[0], false);
  };

  useEffect(() => {
    let active = true;
    void Promise.all([client.listTemplates(), client.listQuickBlocks()])
      .then(([nextTemplates, nextQuickBlocks]) => {
        if (!active) return;
        setTemplates(nextTemplates);
        setQuickBlocks(nextQuickBlocks);
        const initial =
          nextTemplates.find((template) => template.id === settings.lastTemplateId) ??
          nextTemplates[0];
        if (initial) {
          setSelected(initial);
          setDraft(toTemplateDraft(initial));
        }
      })
      .catch(() => active && setError(translate("features.views.LibraryViews.008")));
    return () => {
      active = false;
    };
  }, [client, settings.lastTemplateId]);

  const chooseTemplate = (template: DayTemplate, persist = true) => {
    setSelected(template);
    setDraft(toTemplateDraft(template));
    setDeleteTarget(null);
    setError(null);
    if (persist && settings.lastTemplateId !== template.id) {
      void client.updateSettings({ ...settings, lastTemplateId: template.id });
    }
  };

  const saveTemplate = async () => {
    const parsed = dayTemplateDraftSchema.safeParse(draft);
    if (!parsed.success) {
      setError(parsed.error.issues[0]?.message ?? translate("features.views.LibraryViews.009"));
      return;
    }
    setBusy(true);
    setError(null);
    try {
      const saved = await client.saveTemplate({
        ...(selected ? { id: selected.id, expectedVersion: selected.version } : {}),
        draft: parsed.data,
      });
      await refresh();
      chooseTemplate(saved);
      setMessage(translate("features.views.LibraryViews.010"));
    } catch {
      setError(translate("features.views.LibraryViews.011"));
    } finally {
      setBusy(false);
    }
  };

  const removeTemplate = async (template: DayTemplate) => {
    setBusy(true);
    try {
      await client.deleteTemplate({ id: template.id, expectedVersion: template.version });
      setSelected(null);
      setDraft(emptyTemplate());
      await refresh();
      setMessage(translate("features.views.LibraryViews.012"));
    } catch {
      setError(translate("features.views.LibraryViews.013"));
    } finally {
      setBusy(false);
      setDeleteTarget(null);
    }
  };

  const saveQuickBlock = async () => {
    const parsed = quickBlockDraftSchema.safeParse({
      title: quickTitle,
      startMinute: timeToMinute(quickTime),
      durationMinutes: quickDuration,
      timezoneId,
      color: quickColor,
      project: quickProject,
      category: quickCategory,
      startNotificationMinutes:
        quickStartNotification === "" ? null : Number(quickStartNotification),
      endNotificationMinutes: quickEndNotification === "" ? null : Number(quickEndNotification),
      isActive: quickEditing?.isActive ?? true,
    });
    if (!parsed.success) {
      setError(translate("features.views.LibraryViews.014"));
      return;
    }
    setBusy(true);
    try {
      await client.saveQuickBlock({
        ...(quickEditing ? { id: quickEditing.id, expectedVersion: quickEditing.version } : {}),
        draft: parsed.data,
      });
      clearQuickEditor();
      await refresh();
      setMessage(
        quickEditing
          ? translate("features.views.LibraryViews.015")
          : translate("features.views.LibraryViews.016"),
      );
    } catch {
      setError(translate("features.views.LibraryViews.017"));
    } finally {
      setBusy(false);
    }
  };

  const clearQuickEditor = () => {
    setQuickEditing(null);
    setQuickTitle("");
    setQuickTime("09:00");
    setQuickDuration(30);
    setQuickColor("#68B984");
    setQuickProject("");
    setQuickCategory("");
    setQuickStartNotification("");
    setQuickEndNotification("");
  };

  const editQuickBlock = (item: QuickBlock, duplicate = false) => {
    setQuickEditing(duplicate ? null : item);
    setQuickTitle(
      duplicate ? translate("features.views.LibraryViews.018", [item.title]) : item.title,
    );
    setQuickTime(minuteToTime(item.startMinute));
    setQuickDuration(item.durationMinutes);
    setQuickColor(item.color);
    setQuickProject(item.project);
    setQuickCategory(item.category);
    setQuickStartNotification(item.startNotificationMinutes?.toString() ?? "");
    setQuickEndNotification(item.endNotificationMinutes?.toString() ?? "");
  };

  const toggleQuickBlock = async (item: QuickBlock) => {
    await client.saveQuickBlock({
      id: item.id,
      expectedVersion: item.version,
      draft: {
        title: item.title,
        startMinute: item.startMinute,
        durationMinutes: item.durationMinutes,
        timezoneId: item.timezoneId,
        color: item.color,
        project: item.project,
        category: item.category,
        startNotificationMinutes: item.startNotificationMinutes,
        endNotificationMinutes: item.endNotificationMinutes,
        isActive: !item.isActive,
      },
    });
    await refresh();
  };

  const moveTemplate = async (id: string, direction: -1 | 1) => {
    const ids = movedIds(templates, id, direction);
    if (!ids) return;
    await client.reorderTemplates(ids);
    const next = await client.listTemplates();
    setTemplates(next);
    const current = next.find((item) => item.id === selected?.id);
    if (current) chooseTemplate(current, false);
  };

  const moveQuickBlock = async (id: string, direction: -1 | 1) => {
    const ids = movedIds(quickBlocks, id, direction);
    if (!ids) return;
    await client.reorderQuickBlocks(ids);
    setQuickBlocks(await client.listQuickBlocks());
  };

  const previewTemplate = async () => {
    if (!selected) return;
    setBusy(true);
    setError(null);
    try {
      setPreview(
        await client.previewTemplate({
          templateId: selected.id,
          date: applyDate,
          timezoneId,
          mode: applyMode,
        }),
      );
    } catch {
      setError(translate("features.views.LibraryViews.019"));
    } finally {
      setBusy(false);
    }
  };

  const applyTemplate = async () => {
    if (!selected || !preview) return;
    setBusy(true);
    try {
      await client.applyTemplate({
        templateId: selected.id,
        date: applyDate,
        timezoneId,
        mode: applyMode,
      });
      await queryClient.invalidateQueries({ queryKey: ["schedules"] });
      setPreview(null);
      setMessage(
        applyMode === "replace"
          ? translate("features.views.LibraryViews.020")
          : translate("features.views.LibraryViews.021"),
      );
    } catch {
      setError(translate("features.views.LibraryViews.022"));
    } finally {
      setBusy(false);
    }
  };

  return (
    <main className="secondary-view library-view">
      <ViewTitle
        eyebrow={translate("features.views.LibraryViews.023")}
        title={translate("features.views.LibraryViews.024")}
        description={translate("features.views.LibraryViews.025")}
      />
      {message ? (
        <StatusMessage
          tone="success"
          title={message}
          action={
            <button onClick={() => setMessage(null)}>
              {translate("features.views.LibraryViews.026")}
            </button>
          }
        />
      ) : null}
      {error ? <StatusMessage tone="danger" title={error} /> : null}
      <div className="library-layout">
        <section className="library-list" aria-labelledby="template-list-title">
          <div className="section-heading section-heading--compact">
            <h2 id="template-list-title">{translate("features.views.LibraryViews.027")}</h2>
            <button
              className="button button--subtle"
              type="button"
              onClick={() => {
                setSelected(null);
                setDraft(emptyTemplate());
              }}
            >
              {translate("features.views.LibraryViews.028")}
            </button>
          </div>
          {templates.map((template, index) => (
            <article className="library-card-row" key={template.id}>
              <button
                className="library-card"
                aria-pressed={selected?.id === template.id}
                type="button"
                onClick={() => chooseTemplate(template)}
              >
                <i style={{ backgroundColor: template.color }} />
                <span>
                  <strong>{template.name}</strong>
                  <small>
                    {template.blocks.length}
                    {translate("features.views.LibraryViews.029")}
                  </small>
                </span>
                {template.isBuiltin ? (
                  <em>{translate("features.views.LibraryViews.030")}</em>
                ) : null}
              </button>
              <div
                className="compact-actions"
                aria-label={translate("features.views.LibraryViews.031", [template.name])}
              >
                <button
                  className="icon-button"
                  disabled={index === 0}
                  aria-label={translate("features.views.LibraryViews.032", [template.name])}
                  onClick={() => void moveTemplate(template.id, -1)}
                >
                  ↑
                </button>
                <button
                  className="icon-button"
                  disabled={index === templates.length - 1}
                  aria-label={translate("features.views.LibraryViews.033", [template.name])}
                  onClick={() => void moveTemplate(template.id, 1)}
                >
                  ↓
                </button>
                <button
                  className="icon-button"
                  aria-label={translate("features.views.LibraryViews.034", [template.name])}
                  onClick={() => {
                    setSelected(null);
                    setDraft({
                      ...toTemplateDraft(template),
                      name: translate("features.views.LibraryViews.035", [template.name]),
                    });
                  }}
                >
                  ⧉
                </button>
              </div>
            </article>
          ))}
        </section>
        <section className="library-editor" aria-labelledby="template-editor-title">
          <h2 id="template-editor-title">
            {selected
              ? translate("features.views.LibraryViews.036")
              : translate("features.views.LibraryViews.037")}
          </h2>
          <div className="field-pair">
            <label>
              {translate("features.views.LibraryViews.038")}
              <input
                value={draft.name}
                disabled={selected?.isBuiltin}
                onChange={(event) => setDraft({ ...draft, name: event.target.value })}
              />
            </label>
            <label>
              {translate("features.views.LibraryViews.039")}
              <input
                type="color"
                value={draft.color}
                onChange={(event) => setDraft({ ...draft, color: event.target.value })}
              />
            </label>
          </div>
          <label>
            {translate("features.views.LibraryViews.040")}
            <textarea
              value={draft.description}
              onChange={(event) => setDraft({ ...draft, description: event.target.value })}
            />
          </label>
          <fieldset className="weekday-picker">
            <legend>{translate("features.views.LibraryViews.041")}</legend>
            {WEEKDAYS.map((label, index) => (
              <label key={label}>
                <input
                  type="checkbox"
                  checked={(draft.weekdaysMask & (1 << index)) !== 0}
                  onChange={() =>
                    setDraft({ ...draft, weekdaysMask: draft.weekdaysMask ^ (1 << index) })
                  }
                />
                {label}
              </label>
            ))}
          </fieldset>
          <div className="section-heading section-heading--compact">
            <h3>{translate("features.views.LibraryViews.042")}</h3>
            <button
              type="button"
              className="button button--subtle"
              onClick={() =>
                setDraft({
                  ...draft,
                  blocks: [
                    ...draft.blocks,
                    {
                      title: translate("features.views.LibraryViews.043"),
                      startMinute: 540,
                      durationMinutes: 30,
                      color: draft.color,
                      project: "",
                      category: "",
                    },
                  ],
                })
              }
            >
              {translate("features.views.LibraryViews.044")}
            </button>
          </div>
          {draft.blocks.length === 0 ? (
            <p className="field-help">{translate("features.views.LibraryViews.045")}</p>
          ) : (
            <TemplateVisualEditor draft={draft} setDraft={setDraft} />
          )}
          <div className="block-editor-list">
            {draft.blocks.map((block, index) => (
              <div className="block-editor" key={`${index}-${block.startMinute}`}>
                <label>
                  {translate("features.views.LibraryViews.046")}
                  <input
                    value={block.title}
                    onChange={(event) =>
                      updateBlock(draft, setDraft, index, { title: event.target.value })
                    }
                  />
                </label>
                <label>
                  {translate("features.views.LibraryViews.047")}
                  <input
                    type="time"
                    value={minuteToTime(block.startMinute)}
                    onChange={(event) =>
                      updateBlock(draft, setDraft, index, {
                        startMinute: timeToMinute(event.target.value),
                      })
                    }
                  />
                </label>
                <label>
                  {translate("features.views.LibraryViews.048")}
                  <input
                    type="number"
                    min={1}
                    max={1440}
                    value={block.durationMinutes}
                    onChange={(event) =>
                      updateBlock(draft, setDraft, index, {
                        durationMinutes: Number(event.target.value),
                      })
                    }
                  />
                </label>
                <label>
                  {translate("features.views.LibraryViews.049")}
                  <input
                    type="color"
                    value={block.color}
                    onChange={(event) =>
                      updateBlock(draft, setDraft, index, { color: event.target.value })
                    }
                  />
                </label>
                <label>
                  {translate("features.views.LibraryViews.050")}
                  <input
                    value={block.project}
                    onChange={(event) =>
                      updateBlock(draft, setDraft, index, { project: event.target.value })
                    }
                  />
                </label>
                <label>
                  {translate("features.views.LibraryViews.051")}
                  <input
                    value={block.category}
                    onChange={(event) =>
                      updateBlock(draft, setDraft, index, { category: event.target.value })
                    }
                  />
                </label>
                <button
                  type="button"
                  className="icon-button"
                  disabled={index === 0}
                  aria-label={translate("features.views.LibraryViews.052", [block.title])}
                  onClick={() => setDraft({ ...draft, blocks: moveAt(draft.blocks, index, -1) })}
                >
                  ↑
                </button>
                <button
                  type="button"
                  className="icon-button"
                  disabled={index === draft.blocks.length - 1}
                  aria-label={translate("features.views.LibraryViews.053", [block.title])}
                  onClick={() => setDraft({ ...draft, blocks: moveAt(draft.blocks, index, 1) })}
                >
                  ↓
                </button>
                <button
                  type="button"
                  className="icon-button"
                  aria-label={translate("features.views.LibraryViews.054", [block.title])}
                  onClick={() => {
                    const blocks = [...draft.blocks];
                    blocks.splice(index + 1, 0, {
                      ...block,
                      title: translate("features.views.LibraryViews.055", [block.title]),
                    });
                    setDraft({ ...draft, blocks });
                  }}
                >
                  ⧉
                </button>
                <button
                  type="button"
                  className="icon-button"
                  aria-label={translate("features.views.LibraryViews.056", [block.title])}
                  onClick={() =>
                    setDraft({
                      ...draft,
                      blocks: draft.blocks.filter((_, itemIndex) => itemIndex !== index),
                    })
                  }
                >
                  ×
                </button>
              </div>
            ))}
          </div>
          <div className="button-row">
            <button
              className="button button--primary"
              disabled={busy}
              onClick={() => void saveTemplate()}
            >
              {busy
                ? translate("features.views.LibraryViews.057")
                : translate("features.views.LibraryViews.058")}
            </button>
            {selected && !selected.isBuiltin ? (
              deleteTarget === selected.id ? (
                <span className="inline-confirm" role="alert">
                  <strong>{translate("features.views.LibraryViews.059")}</strong>
                  <button
                    className="button button--danger"
                    onClick={() => void removeTemplate(selected)}
                  >
                    {translate("features.views.LibraryViews.060")}
                  </button>
                  <button className="button" onClick={() => setDeleteTarget(null)}>
                    {translate("features.views.LibraryViews.061")}
                  </button>
                </span>
              ) : (
                <button
                  className="button button--danger-outline"
                  onClick={() => setDeleteTarget(selected.id)}
                >
                  {translate("features.views.LibraryViews.062")}
                </button>
              )
            ) : null}
          </div>
          {selected ? (
            <section className="template-apply" aria-labelledby="template-apply-title">
              <h3 id="template-apply-title">{translate("features.views.LibraryViews.063")}</h3>
              <div className="inline-form">
                <label>
                  {translate("features.views.LibraryViews.064")}
                  <input
                    type="date"
                    value={applyDate}
                    onChange={(event) => {
                      setApplyDate(event.target.value);
                      setPreview(null);
                    }}
                  />
                </label>
                <label>
                  {translate("features.views.LibraryViews.065")}
                  <select
                    value={applyMode}
                    onChange={(event) => {
                      setApplyMode(event.target.value as "add" | "replace");
                      setPreview(null);
                    }}
                  >
                    <option value="add">{translate("features.views.LibraryViews.066")}</option>
                    <option value="replace">{translate("features.views.LibraryViews.067")}</option>
                  </select>
                </label>
                <button className="button" disabled={busy} onClick={() => void previewTemplate()}>
                  {translate("features.views.LibraryViews.068")}
                </button>
              </div>
              {applyMode === "replace" ? (
                <StatusMessage tone="warning" title={translate("features.views.LibraryViews.069")}>
                  {translate("features.views.LibraryViews.070")}
                </StatusMessage>
              ) : null}
              {preview ? (
                <div className="apply-preview">
                  <h4>
                    {preview.items.length}
                    {translate("features.views.LibraryViews.071")}
                  </h4>
                  <dl className="preview-summary">
                    <div>
                      <dt>{translate("features.views.LibraryViews.072")}</dt>
                      <dd>
                        {preview.overlappingItemCount}
                        {translate("features.views.LibraryViews.073")}
                      </dd>
                    </div>
                    <div>
                      <dt>{translate("features.views.LibraryViews.074")}</dt>
                      <dd>
                        {preview.localReplaceCandidateCount}
                        {translate("features.views.LibraryViews.075")}
                      </dd>
                    </div>
                    <div>
                      <dt>{translate("features.views.LibraryViews.076")}</dt>
                      <dd>
                        {preview.externalPreservedCount}
                        {translate("features.views.LibraryViews.077")}
                      </dd>
                    </div>
                    <div>
                      <dt>{translate("features.views.LibraryViews.078")}</dt>
                      <dd>{preview.syncTarget}</dd>
                    </div>
                  </dl>
                  <ol>
                    {preview.items.map((item) => (
                      <li key={`${item.startUtc}-${item.title}`}>
                        <i style={{ background: item.color }} />
                        <time>
                          {new Intl.DateTimeFormat(appLocale, {
                            hour: "2-digit",
                            minute: "2-digit",
                          }).format(new Date(item.startUtc))}
                        </time>
                        <strong>{item.title}</strong>
                      </li>
                    ))}
                  </ol>
                  <div className="button-row">
                    <button
                      className={
                        applyMode === "replace" ? "button button--danger" : "button button--primary"
                      }
                      disabled={busy}
                      onClick={() => void applyTemplate()}
                    >
                      {applyMode === "replace"
                        ? translate("features.views.LibraryViews.079")
                        : translate("features.views.LibraryViews.080")}
                    </button>
                    <button className="button" onClick={() => setPreview(null)}>
                      {translate("features.views.LibraryViews.081")}
                    </button>
                  </div>
                </div>
              ) : null}
            </section>
          ) : null}
        </section>
      </div>
      <section className="quick-block-section" aria-labelledby="quick-block-title">
        <h2 id="quick-block-title">Quick Block</h2>
        <p>{translate("features.views.LibraryViews.082")}</p>
        <p className="field-help">{translate("features.views.LibraryViews.083")}</p>
        <div className="inline-form">
          <label>
            {translate("features.views.LibraryViews.084")}
            <input value={quickTitle} onChange={(event) => setQuickTitle(event.target.value)} />
          </label>
          <label>
            {translate("features.views.LibraryViews.085")}
            <input
              type="time"
              value={quickTime}
              onChange={(event) => setQuickTime(event.target.value)}
            />
          </label>
          <label>
            {translate("features.views.LibraryViews.086")}
            <input
              type="number"
              min={1}
              max={1440}
              value={quickDuration}
              onChange={(event) => setQuickDuration(Number(event.target.value))}
            />
          </label>
          <label>
            {translate("features.views.LibraryViews.087")}
            <input
              type="color"
              value={quickColor}
              onChange={(event) => setQuickColor(event.target.value)}
            />
          </label>
          <label>
            {translate("features.views.LibraryViews.088")}
            <input value={quickProject} onChange={(event) => setQuickProject(event.target.value)} />
          </label>
          <label>
            {translate("features.views.LibraryViews.089")}
            <input
              value={quickCategory}
              onChange={(event) => setQuickCategory(event.target.value)}
            />
          </label>
          <NotificationOffsetSelect
            label={translate("features.views.LibraryViews.090")}
            value={quickStartNotification}
            onChange={setQuickStartNotification}
          />
          <NotificationOffsetSelect
            label={translate("features.views.LibraryViews.091")}
            value={quickEndNotification}
            onChange={setQuickEndNotification}
          />
          <button
            className="button button--primary"
            disabled={busy}
            onClick={() => void saveQuickBlock()}
          >
            {quickEditing
              ? translate("features.views.LibraryViews.092")
              : translate("features.views.LibraryViews.093")}
          </button>
          {quickEditing ? (
            <button className="button" onClick={clearQuickEditor}>
              {translate("features.views.LibraryViews.094")}
            </button>
          ) : null}
        </div>
        <ul className="operational-list">
          {quickBlocks.map((item, index) => (
            <li key={item.id}>
              <span>
                <strong>{item.title}</strong>
                <small>
                  {minuteToTime(item.startMinute)}・{item.durationMinutes}
                  {translate("features.views.LibraryViews.095")}
                  {item.timezoneId}
                  {item.project || item.category
                    ? translate("features.views.LibraryViews.096", [
                        item.project || translate("features.schedule.Timeline.013"),
                        item.category || translate("features.schedule.Timeline.014"),
                      ])
                    : ""}
                  {translate("features.views.LibraryViews.097")}
                  {notificationSummary(item.startNotificationMinutes)}
                  {translate("features.views.LibraryViews.098")}
                  {notificationSummary(item.endNotificationMinutes)}
                </small>
              </span>
              <button className="button" onClick={() => editQuickBlock(item)}>
                {translate("features.views.LibraryViews.099")}
              </button>
              <button className="button" onClick={() => editQuickBlock(item, true)}>
                {translate("features.views.LibraryViews.100")}
              </button>
              <button className="button" onClick={() => void toggleQuickBlock(item)}>
                {item.isActive
                  ? translate("features.views.LibraryViews.101")
                  : translate("features.views.LibraryViews.102")}
              </button>
              <button
                className="icon-button"
                disabled={index === 0}
                aria-label={translate("features.views.LibraryViews.103", [item.title])}
                onClick={() => void moveQuickBlock(item.id, -1)}
              >
                ↑
              </button>
              <button
                className="icon-button"
                disabled={index === quickBlocks.length - 1}
                aria-label={translate("features.views.LibraryViews.104", [item.title])}
                onClick={() => void moveQuickBlock(item.id, 1)}
              >
                ↓
              </button>
              <button
                className="button button--danger-outline"
                onClick={() =>
                  void client
                    .deleteQuickBlock({ id: item.id, expectedVersion: item.version })
                    .then(refresh)
                }
              >
                {translate("features.views.LibraryViews.105")}
              </button>
            </li>
          ))}
        </ul>
      </section>
    </main>
  );
}

export function AlarmsView({ client, timezoneId }: { client: AppClient; timezoneId: string }) {
  const [alarms, setAlarms] = useState<FreeAlarm[]>([]);
  const [editing, setEditing] = useState<FreeAlarm | null>(null);
  const [label, setLabel] = useState("");
  const [time, setTime] = useState("08:00");
  const [weekdaysMask, setWeekdaysMask] = useState(127);
  const [error, setError] = useState<string | null>(null);
  const refresh = () =>
    client
      .listFreeAlarms()
      .then(setAlarms)
      .catch(() => setError(translate("features.views.LibraryViews.106")));
  useEffect(() => void refresh(), [client]);
  const save = async () => {
    const parsed = freeAlarmDraftSchema.safeParse({
      label,
      minuteOfDay: timeToMinute(time),
      timezoneId,
      weekdaysMask,
      enabled: true,
    });
    if (!parsed.success) return setError(translate("features.views.LibraryViews.107"));
    try {
      await client.saveFreeAlarm({
        ...(editing ? { id: editing.id, expectedVersion: editing.version } : {}),
        draft: parsed.data,
      });
      clearEditor();
      await refresh();
    } catch {
      setError(translate("features.views.LibraryViews.108"));
    }
  };
  const clearEditor = () => {
    setEditing(null);
    setLabel("");
    setTime("08:00");
    setWeekdaysMask(127);
  };
  const edit = (item: FreeAlarm, duplicate = false) => {
    setEditing(duplicate ? null : item);
    setLabel(duplicate ? translate("features.views.LibraryViews.109", [item.label]) : item.label);
    setTime(minuteToTime(item.minuteOfDay));
    setWeekdaysMask(item.weekdaysMask);
  };
  const toggle = async (item: FreeAlarm) => {
    await client.saveFreeAlarm({
      id: item.id,
      expectedVersion: item.version,
      draft: {
        label: item.label,
        minuteOfDay: item.minuteOfDay,
        timezoneId: item.timezoneId,
        weekdaysMask: item.weekdaysMask,
        enabled: !item.enabled,
      },
    });
    await refresh();
  };
  const move = async (id: string, direction: -1 | 1) => {
    const ids = movedIds(alarms, id, direction);
    if (!ids) return;
    try {
      await client.reorderFreeAlarms(ids);
      await refresh();
    } catch {
      setError(translate("features.views.LibraryViews.110"));
    }
  };
  return (
    <main className="secondary-view library-view">
      <ViewTitle
        eyebrow={translate("features.views.LibraryViews.111")}
        title={translate("features.views.LibraryViews.112")}
        description={translate("features.views.LibraryViews.113")}
      />
      {error ? <StatusMessage tone="danger" title={error} /> : null}
      <section className="alarm-editor">
        <div className="inline-form">
          <label>
            {translate("features.views.LibraryViews.114")}
            <input value={label} onChange={(event) => setLabel(event.target.value)} />
          </label>
          <label>
            {translate("features.views.LibraryViews.115")}
            <input type="time" value={time} onChange={(event) => setTime(event.target.value)} />
          </label>
          <button className="button button--primary" onClick={() => void save()}>
            {editing
              ? translate("features.views.LibraryViews.116")
              : translate("features.views.LibraryViews.117")}
          </button>
          {editing ? (
            <button className="button" onClick={clearEditor}>
              {translate("features.views.LibraryViews.118")}
            </button>
          ) : null}
        </div>
        <fieldset className="weekday-picker">
          <legend>{translate("features.views.LibraryViews.119")}</legend>
          {WEEKDAYS.map((day, index) => (
            <label key={day}>
              <input
                type="checkbox"
                checked={(weekdaysMask & (1 << index)) !== 0}
                onChange={() => setWeekdaysMask(weekdaysMask ^ (1 << index))}
              />
              {day}
            </label>
          ))}
        </fieldset>
      </section>
      {alarms.length === 0 ? (
        <StatusMessage title={translate("features.views.LibraryViews.120")}>
          {translate("features.views.LibraryViews.121")}
        </StatusMessage>
      ) : null}
      <ul className="operational-list">
        {alarms.map((item, index) => (
          <li key={item.id}>
            <span>
              <strong>{item.label}</strong>
              <small>
                {minuteToTime(item.minuteOfDay)}・{item.timezoneId}・
                {weekdaySummary(item.weekdaysMask)}
              </small>
            </span>
            <button className="button" onClick={() => edit(item)}>
              {translate("features.views.LibraryViews.122")}
            </button>
            <button className="button" onClick={() => edit(item, true)}>
              {translate("features.views.LibraryViews.123")}
            </button>
            <button className="button" onClick={() => void toggle(item)}>
              {item.enabled
                ? translate("features.views.LibraryViews.124")
                : translate("features.views.LibraryViews.125")}
            </button>
            <button
              className="icon-button"
              disabled={index === 0}
              aria-label={translate("features.views.LibraryViews.126", [item.label])}
              onClick={() => void move(item.id, -1)}
            >
              ↑
            </button>
            <button
              className="icon-button"
              disabled={index === alarms.length - 1}
              aria-label={translate("features.views.LibraryViews.127", [item.label])}
              onClick={() => void move(item.id, 1)}
            >
              ↓
            </button>
            <button
              className="button button--danger-outline"
              onClick={() =>
                void client
                  .deleteFreeAlarm({ id: item.id, expectedVersion: item.version })
                  .then(refresh)
              }
            >
              {translate("features.views.LibraryViews.128")}
            </button>
          </li>
        ))}
      </ul>
      <StatusMessage title={translate("features.views.LibraryViews.129")}>
        {translate("features.views.LibraryViews.130")}
      </StatusMessage>
    </main>
  );
}

function emptyTemplate(): DayTemplateDraft {
  return { name: "", description: "", color: "#6F96F4", weekdaysMask: 127, blocks: [] };
}

function toTemplateDraft(template: DayTemplate): DayTemplateDraft {
  return {
    name: template.name,
    description: template.description,
    color: template.color,
    weekdaysMask: template.weekdaysMask,
    blocks: template.blocks.map(
      ({ title, startMinute, durationMinutes, color, project, category }) => ({
        title,
        startMinute,
        durationMinutes,
        color,
        project,
        category,
      }),
    ),
  };
}

function TemplateVisualEditor({
  draft,
  setDraft,
}: {
  draft: DayTemplateDraft;
  setDraft: (value: DayTemplateDraft) => void;
}) {
  return (
    <section className="template-visual-editor" aria-labelledby="template-strip-title">
      <div className="section-heading section-heading--compact">
        <div>
          <h3 id="template-strip-title">{translate("features.views.LibraryViews.131")}</h3>
          <p className="field-help">{translate("features.views.LibraryViews.132")}</p>
        </div>
      </div>
      <div className="template-strip-scale" aria-hidden="true">
        <span>00</span>
        <span>06</span>
        <span>12</span>
        <span>18</span>
        <span>24</span>
      </div>
      <div
        className="template-strip"
        role="list"
        aria-label={translate("features.views.LibraryViews.133")}
      >
        {draft.blocks.map((block, index) => {
          const todayMinutes = Math.min(block.durationMinutes, 1440 - block.startMinute);
          const nextDayMinutes = Math.max(0, block.durationMinutes - todayMinutes);
          return (
            <div className="template-strip-row" role="listitem" key={`${block.title}-${index}`}>
              <button
                type="button"
                className="template-strip-block"
                style={{
                  left: `${(block.startMinute / 1440) * 100}%`,
                  width: `${Math.max(1.5, (todayMinutes / 1440) * 100)}%`,
                  backgroundColor: block.color,
                }}
                aria-label={translate("features.views.LibraryViews.134", [
                  block.title,
                  minuteToTime(block.startMinute),
                  block.durationMinutes,
                ])}
                onClick={() => document.getElementById(`template-block-${index}`)?.focus()}
              >
                {block.title}
              </button>
              {nextDayMinutes > 0 ? (
                <span className="template-strip-overflow">
                  {translate("features.views.LibraryViews.135")}
                  {nextDayMinutes}
                  {translate("features.views.LibraryViews.136")}
                </span>
              ) : null}
            </div>
          );
        })}
      </div>
      <div className="template-detail-timeline" aria-labelledby="template-detail-title">
        <h3 id="template-detail-title">{translate("features.views.LibraryViews.137")}</h3>
        <p className="field-help">{translate("features.views.LibraryViews.138")}</p>
        {draft.blocks.map((block, index) => {
          const endMinute = block.startMinute + block.durationMinutes;
          return (
            <fieldset className="template-range-editor" key={`${block.title}-${index}`}>
              <legend>{block.title}</legend>
              <label>
                {translate("features.views.LibraryViews.139")}
                {minuteToTime(block.startMinute)}
                <input
                  id={`template-block-${index}`}
                  type="range"
                  min={0}
                  max={1439}
                  step={1}
                  value={block.startMinute}
                  onChange={(event) =>
                    updateBlock(draft, setDraft, index, {
                      startMinute: Number(event.target.value),
                    })
                  }
                />
              </label>
              <label>
                {translate("features.views.LibraryViews.140")}
                {formatTemplateEnd(endMinute)}
                <input
                  type="range"
                  min={block.startMinute + 1}
                  max={block.startMinute + 1440}
                  step={1}
                  value={endMinute}
                  onChange={(event) =>
                    updateBlock(draft, setDraft, index, {
                      durationMinutes: Number(event.target.value) - block.startMinute,
                    })
                  }
                />
              </label>
            </fieldset>
          );
        })}
      </div>
    </section>
  );
}

function formatTemplateEnd(value: number): string {
  const day = Math.floor(value / 1440);
  const time = minuteToTime(value % 1440);
  return day > 0 ? translate("features.views.LibraryViews.141", [time]) : time;
}

function updateBlock(
  draft: DayTemplateDraft,
  setDraft: (value: DayTemplateDraft) => void,
  index: number,
  update: Partial<DayTemplateDraft["blocks"][number]>,
) {
  setDraft({
    ...draft,
    blocks: draft.blocks.map((item, itemIndex) =>
      itemIndex === index ? { ...item, ...update } : item,
    ),
  });
}

function moveAt<T>(items: T[], index: number, direction: -1 | 1): T[] {
  const target = index + direction;
  if (target < 0 || target >= items.length) return items;
  const next = [...items];
  [next[index], next[target]] = [next[target]!, next[index]!];
  return next;
}

function weekdaySummary(mask: number): string {
  return (
    WEEKDAYS.filter((_, index) => (mask & (1 << index)) !== 0).join("・") ||
    translate("features.views.LibraryViews.142")
  );
}

function movedIds<T extends { id: string }>(items: T[], id: string, direction: -1 | 1) {
  const index = items.findIndex((item) => item.id === id);
  const target = index + direction;
  if (index < 0 || target < 0 || target >= items.length) return null;
  const ids = items.map((item) => item.id);
  [ids[index], ids[target]] = [ids[target]!, ids[index]!];
  return ids;
}

function notificationSummary(value: number | null): string {
  if (value === null) return translate("features.views.LibraryViews.143");
  return value === 0
    ? translate("features.views.LibraryViews.144")
    : translate("features.views.LibraryViews.145", [value]);
}

function NotificationOffsetSelect({
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
        <option value="">{translate("features.views.LibraryViews.146")}</option>
        <option value="0">{translate("features.views.LibraryViews.147")}</option>
        <option value="5">{translate("features.views.LibraryViews.148")}</option>
        <option value="10">{translate("features.views.LibraryViews.149")}</option>
        <option value="15">{translate("features.views.LibraryViews.150")}</option>
        <option value="30">{translate("features.views.LibraryViews.151")}</option>
        <option value="60">{translate("features.views.LibraryViews.152")}</option>
      </select>
    </label>
  );
}

function localDateInput(date: Date): string {
  const year = date.getFullYear();
  const month = String(date.getMonth() + 1).padStart(2, "0");
  const day = String(date.getDate()).padStart(2, "0");
  return `${year}-${month}-${day}`;
}
