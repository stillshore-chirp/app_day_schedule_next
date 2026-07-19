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

const WEEKDAYS = ["月", "火", "水", "木", "金", "土", "日"];

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
      .catch(() => active && setError("テンプレートを読み込めませんでした。"));
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
      setError(parsed.error.issues[0]?.message ?? "入力を確認してください。");
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
      setMessage("テンプレートをこの端末に保存しました。");
    } catch {
      setError("保存できませんでした。一覧を更新してから再試行してください。");
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
      setMessage("テンプレートを削除しました。");
    } catch {
      setError("既定テンプレートは削除できません。一覧を更新して再試行してください。");
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
      setError("Quick Blockのタイトル、時刻、所要分を確認してください。");
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
      setMessage(quickEditing ? "Quick Blockを更新しました。" : "Quick Blockを保存しました。");
    } catch {
      setError("Quick Blockを保存できませんでした。一覧を更新して再試行してください。");
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
    setQuickTitle(duplicate ? `${item.title} のコピー` : item.title);
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
      setError("プレビューできませんでした。夏時間の境界またはブロック時刻を確認してください。");
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
          ? "対象日の予定を置き換えました。「元に戻す」で一括回復できます。"
          : "対象日へテンプレートを追加しました。「元に戻す」で一括回復できます。",
      );
    } catch {
      setError("適用できませんでした。既存の予定は変更されていません。");
    } finally {
      setBusy(false);
    }
  };

  return (
    <main className="secondary-view library-view">
      <ViewTitle
        eyebrow="一日の型と定常ブロック"
        title="テンプレート"
        description="複数の一日の型と、テンプレートに依存しないQuick Blockを永続管理します。"
      />
      {message ? (
        <StatusMessage
          tone="success"
          title={message}
          action={<button onClick={() => setMessage(null)}>閉じる</button>}
        />
      ) : null}
      {error ? <StatusMessage tone="danger" title={error} /> : null}
      <div className="library-layout">
        <section className="library-list" aria-labelledby="template-list-title">
          <div className="section-heading section-heading--compact">
            <h2 id="template-list-title">一日のテンプレート</h2>
            <button
              className="button button--subtle"
              type="button"
              onClick={() => {
                setSelected(null);
                setDraft(emptyTemplate());
              }}
            >
              ＋ 新規
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
                  <small>{template.blocks.length}ブロック</small>
                </span>
                {template.isBuiltin ? <em>既定</em> : null}
              </button>
              <div className="compact-actions" aria-label={`${template.name}の一覧操作`}>
                <button
                  className="icon-button"
                  disabled={index === 0}
                  aria-label={`${template.name}を上へ移動`}
                  onClick={() => void moveTemplate(template.id, -1)}
                >
                  ↑
                </button>
                <button
                  className="icon-button"
                  disabled={index === templates.length - 1}
                  aria-label={`${template.name}を下へ移動`}
                  onClick={() => void moveTemplate(template.id, 1)}
                >
                  ↓
                </button>
                <button
                  className="icon-button"
                  aria-label={`${template.name}を複製`}
                  onClick={() => {
                    setSelected(null);
                    setDraft({ ...toTemplateDraft(template), name: `${template.name} のコピー` });
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
            {selected ? "テンプレートを編集" : "テンプレートを作成"}
          </h2>
          <div className="field-pair">
            <label>
              名前
              <input
                value={draft.name}
                disabled={selected?.isBuiltin}
                onChange={(event) => setDraft({ ...draft, name: event.target.value })}
              />
            </label>
            <label>
              色
              <input
                type="color"
                value={draft.color}
                onChange={(event) => setDraft({ ...draft, color: event.target.value })}
              />
            </label>
          </div>
          <label>
            説明
            <textarea
              value={draft.description}
              onChange={(event) => setDraft({ ...draft, description: event.target.value })}
            />
          </label>
          <fieldset className="weekday-picker">
            <legend>対象曜日</legend>
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
            <h3>ブロック</h3>
            <button
              type="button"
              className="button button--subtle"
              onClick={() =>
                setDraft({
                  ...draft,
                  blocks: [
                    ...draft.blocks,
                    {
                      title: "新しいブロック",
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
              ＋ ブロック
            </button>
          </div>
          {draft.blocks.length === 0 ? (
            <p className="field-help">ブロックはまだありません。</p>
          ) : (
            <TemplateVisualEditor draft={draft} setDraft={setDraft} />
          )}
          <div className="block-editor-list">
            {draft.blocks.map((block, index) => (
              <div className="block-editor" key={`${index}-${block.startMinute}`}>
                <label>
                  タイトル
                  <input
                    value={block.title}
                    onChange={(event) =>
                      updateBlock(draft, setDraft, index, { title: event.target.value })
                    }
                  />
                </label>
                <label>
                  開始
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
                  所要分
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
                  色
                  <input
                    type="color"
                    value={block.color}
                    onChange={(event) =>
                      updateBlock(draft, setDraft, index, { color: event.target.value })
                    }
                  />
                </label>
                <label>
                  プロジェクト
                  <input
                    value={block.project}
                    onChange={(event) =>
                      updateBlock(draft, setDraft, index, { project: event.target.value })
                    }
                  />
                </label>
                <label>
                  カテゴリ
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
                  aria-label={`${block.title}を上へ移動`}
                  onClick={() => setDraft({ ...draft, blocks: moveAt(draft.blocks, index, -1) })}
                >
                  ↑
                </button>
                <button
                  type="button"
                  className="icon-button"
                  disabled={index === draft.blocks.length - 1}
                  aria-label={`${block.title}を下へ移動`}
                  onClick={() => setDraft({ ...draft, blocks: moveAt(draft.blocks, index, 1) })}
                >
                  ↓
                </button>
                <button
                  type="button"
                  className="icon-button"
                  aria-label={`${block.title}を複製`}
                  onClick={() => {
                    const blocks = [...draft.blocks];
                    blocks.splice(index + 1, 0, { ...block, title: `${block.title} のコピー` });
                    setDraft({ ...draft, blocks });
                  }}
                >
                  ⧉
                </button>
                <button
                  type="button"
                  className="icon-button"
                  aria-label={`${block.title}を削除`}
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
              {busy ? "保存中…" : "テンプレートを保存"}
            </button>
            {selected && !selected.isBuiltin ? (
              deleteTarget === selected.id ? (
                <span className="inline-confirm" role="alert">
                  <strong>削除しますか？</strong>
                  <button
                    className="button button--danger"
                    onClick={() => void removeTemplate(selected)}
                  >
                    削除
                  </button>
                  <button className="button" onClick={() => setDeleteTarget(null)}>
                    残す
                  </button>
                </span>
              ) : (
                <button
                  className="button button--danger-outline"
                  onClick={() => setDeleteTarget(selected.id)}
                >
                  削除…
                </button>
              )
            ) : null}
          </div>
          {selected ? (
            <section className="template-apply" aria-labelledby="template-apply-title">
              <h3 id="template-apply-title">日付へ適用</h3>
              <div className="inline-form">
                <label>
                  対象日
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
                  適用方式
                  <select
                    value={applyMode}
                    onChange={(event) => {
                      setApplyMode(event.target.value as "add" | "replace");
                      setPreview(null);
                    }}
                  >
                    <option value="add">既存予定へ追加</option>
                    <option value="replace">対象日の予定を置換</option>
                  </select>
                </label>
                <button className="button" disabled={busy} onClick={() => void previewTemplate()}>
                  適用前にプレビュー
                </button>
              </div>
              {applyMode === "replace" ? (
                <StatusMessage
                  tone="warning"
                  title="置換は対象日のローカル予定だけを削除対象にします"
                >
                  Google由来の予定は保持します。適用は1操作として保存され、直後なら「元に戻す」でローカル予定をまとめて回復できます。
                </StatusMessage>
              ) : null}
              {preview ? (
                <div className="apply-preview">
                  <h4>{preview.items.length}件を適用します</h4>
                  <dl className="preview-summary">
                    <div>
                      <dt>重複する生成予定</dt>
                      <dd>{preview.overlappingItemCount}件</dd>
                    </div>
                    <div>
                      <dt>置換対象のローカル予定</dt>
                      <dd>{preview.localReplaceCandidateCount}件</dd>
                    </div>
                    <div>
                      <dt>保持する外部予定</dt>
                      <dd>{preview.externalPreservedCount}件</dd>
                    </div>
                    <div>
                      <dt>同期先</dt>
                      <dd>{preview.syncTarget}</dd>
                    </div>
                  </dl>
                  <ol>
                    {preview.items.map((item) => (
                      <li key={`${item.startUtc}-${item.title}`}>
                        <i style={{ background: item.color }} />
                        <time>
                          {new Intl.DateTimeFormat("ja-JP", {
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
                      {applyMode === "replace" ? "この内容で置換" : "この内容を追加"}
                    </button>
                    <button className="button" onClick={() => setPreview(null)}>
                      戻って修正
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
        <p>毎日のNowとタイムラインへ含める、テンプレート非依存の定常ブロックです。</p>
        <p className="field-help">
          無効にすると24時間表示、Now、通知から外れます。データと設定は残ります。
        </p>
        <div className="inline-form">
          <label>
            タイトル
            <input value={quickTitle} onChange={(event) => setQuickTitle(event.target.value)} />
          </label>
          <label>
            開始
            <input
              type="time"
              value={quickTime}
              onChange={(event) => setQuickTime(event.target.value)}
            />
          </label>
          <label>
            所要分
            <input
              type="number"
              min={1}
              max={1440}
              value={quickDuration}
              onChange={(event) => setQuickDuration(Number(event.target.value))}
            />
          </label>
          <label>
            色
            <input
              type="color"
              value={quickColor}
              onChange={(event) => setQuickColor(event.target.value)}
            />
          </label>
          <label>
            プロジェクト
            <input value={quickProject} onChange={(event) => setQuickProject(event.target.value)} />
          </label>
          <label>
            カテゴリ
            <input
              value={quickCategory}
              onChange={(event) => setQuickCategory(event.target.value)}
            />
          </label>
          <NotificationOffsetSelect
            label="開始通知"
            value={quickStartNotification}
            onChange={setQuickStartNotification}
          />
          <NotificationOffsetSelect
            label="終了通知"
            value={quickEndNotification}
            onChange={setQuickEndNotification}
          />
          <button
            className="button button--primary"
            disabled={busy}
            onClick={() => void saveQuickBlock()}
          >
            {quickEditing ? "変更を保存" : "追加"}
          </button>
          {quickEditing ? (
            <button className="button" onClick={clearQuickEditor}>
              編集を取消
            </button>
          ) : null}
        </div>
        <ul className="operational-list">
          {quickBlocks.map((item, index) => (
            <li key={item.id}>
              <span>
                <strong>{item.title}</strong>
                <small>
                  {minuteToTime(item.startMinute)}・{item.durationMinutes}分・{item.timezoneId}
                  {item.project || item.category
                    ? `・${item.project || "未分類"}/${item.category || "未分類"}`
                    : ""}
                  ・開始通知{notificationSummary(item.startNotificationMinutes)}・終了通知
                  {notificationSummary(item.endNotificationMinutes)}
                </small>
              </span>
              <button className="button" onClick={() => editQuickBlock(item)}>
                編集
              </button>
              <button className="button" onClick={() => editQuickBlock(item, true)}>
                複製
              </button>
              <button className="button" onClick={() => void toggleQuickBlock(item)}>
                {item.isActive ? "有効" : "無効"}
              </button>
              <button
                className="icon-button"
                disabled={index === 0}
                aria-label={`${item.title}を上へ移動`}
                onClick={() => void moveQuickBlock(item.id, -1)}
              >
                ↑
              </button>
              <button
                className="icon-button"
                disabled={index === quickBlocks.length - 1}
                aria-label={`${item.title}を下へ移動`}
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
                削除
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
      .catch(() => setError("アラームを読み込めませんでした。"));
  useEffect(() => void refresh(), [client]);
  const save = async () => {
    const parsed = freeAlarmDraftSchema.safeParse({
      label,
      minuteOfDay: timeToMinute(time),
      timezoneId,
      weekdaysMask,
      enabled: true,
    });
    if (!parsed.success) return setError("ラベル、時刻、曜日を確認してください。");
    try {
      await client.saveFreeAlarm({
        ...(editing ? { id: editing.id, expectedVersion: editing.version } : {}),
        draft: parsed.data,
      });
      clearEditor();
      await refresh();
    } catch {
      setError("アラームを保存できませんでした。一覧を更新して再試行してください。");
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
    setLabel(duplicate ? `${item.label} のコピー` : item.label);
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
      setError("一覧が更新されました。読み込み直してから並べ替えてください。");
    }
  };
  return (
    <main className="secondary-view library-view">
      <ViewTitle
        eyebrow="予定から独立した通知"
        title="アラーム"
        description="ローカル時刻、IANAタイムゾーン、曜日、有効状態を明示して管理します。"
      />
      {error ? <StatusMessage tone="danger" title={error} /> : null}
      <section className="alarm-editor">
        <div className="inline-form">
          <label>
            ラベル
            <input value={label} onChange={(event) => setLabel(event.target.value)} />
          </label>
          <label>
            時刻
            <input type="time" value={time} onChange={(event) => setTime(event.target.value)} />
          </label>
          <button className="button button--primary" onClick={() => void save()}>
            {editing ? "変更を保存" : "アラームを追加"}
          </button>
          {editing ? (
            <button className="button" onClick={clearEditor}>
              編集を取消
            </button>
          ) : null}
        </div>
        <fieldset className="weekday-picker">
          <legend>曜日</legend>
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
        <StatusMessage title="アラームはまだありません">
          予定とは独立した最初のアラームを追加できます。
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
              編集
            </button>
            <button className="button" onClick={() => edit(item, true)}>
              複製
            </button>
            <button className="button" onClick={() => void toggle(item)}>
              {item.enabled ? "有効" : "無効"}
            </button>
            <button
              className="icon-button"
              disabled={index === 0}
              aria-label={`${item.label}を上へ移動`}
              onClick={() => void move(item.id, -1)}
            >
              ↑
            </button>
            <button
              className="icon-button"
              disabled={index === alarms.length - 1}
              aria-label={`${item.label}を下へ移動`}
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
              削除
            </button>
          </li>
        ))}
      </ul>
      <StatusMessage title="通知権限と完全終了">
        OS通知が未許可の場合は設定画面から許可してください。アプリが完全終了している間は通知できません。
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
          <h3 id="template-strip-title">24時間ストリップ</h3>
          <p className="field-help">日跨ぎ部分は「翌日」として表示します。</p>
        </div>
      </div>
      <div className="template-strip-scale" aria-hidden="true">
        <span>00</span>
        <span>06</span>
        <span>12</span>
        <span>18</span>
        <span>24</span>
      </div>
      <div className="template-strip" role="list" aria-label="テンプレートの24時間ストリップ">
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
                aria-label={`${block.title}、${minuteToTime(block.startMinute)}開始、${block.durationMinutes}分`}
                onClick={() => document.getElementById(`template-block-${index}`)?.focus()}
              >
                {block.title}
              </button>
              {nextDayMinutes > 0 ? (
                <span className="template-strip-overflow">翌日 +{nextDayMinutes}分</span>
              ) : null}
            </div>
          );
        })}
      </div>
      <div className="template-detail-timeline" aria-labelledby="template-detail-title">
        <h3 id="template-detail-title">詳細タイムライン</h3>
        <p className="field-help">
          スライダーをドラッグ、または矢印キーで1分ずつ移動・リサイズできます。下の入力欄でも同じ値を編集できます。
        </p>
        {draft.blocks.map((block, index) => {
          const endMinute = block.startMinute + block.durationMinutes;
          return (
            <fieldset className="template-range-editor" key={`${block.title}-${index}`}>
              <legend>{block.title}</legend>
              <label>
                開始 {minuteToTime(block.startMinute)}
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
                終了 {formatTemplateEnd(endMinute)}
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
  return day > 0 ? `翌日 ${time}` : time;
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
  return WEEKDAYS.filter((_, index) => (mask & (1 << index)) !== 0).join("・") || "曜日なし";
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
  if (value === null) return "なし";
  return value === 0 ? "ちょうど" : `${value}分前`;
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
        <option value="">なし</option>
        <option value="0">時刻ちょうど</option>
        <option value="5">5分前</option>
        <option value="10">10分前</option>
        <option value="15">15分前</option>
        <option value="30">30分前</option>
        <option value="60">60分前</option>
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
