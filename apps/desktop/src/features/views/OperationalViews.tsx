import { useEffect, useState } from "react";
import { open, save } from "@tauri-apps/plugin-dialog";
import {
  isPermissionGranted,
  requestPermission,
  sendNotification,
} from "@tauri-apps/plugin-notification";
import type {
  Bootstrap,
  BackupRecord,
  FocusState,
  FocusHistoryReport,
  Schedule,
  GoogleConnection,
  ImportPreview,
  ImportResult,
  LegacyImportPreview,
  LegacyImportResult,
  NotificationLedgerItem,
  Settings,
  SyncConflictItem,
  SyncQueueItem,
  ConflictChoice,
} from "../../shared/contracts";
import type { AppClient, DiagnosticsSnapshot } from "../../shared/ipc/client";
import { StatusMessage } from "../../shared/ui/StatusMessage";
import { ViewTitle } from "./CalendarViews";

export function FocusView({ client, bootstrap }: { client: AppClient; bootstrap: Bootstrap }) {
  const [focus, setFocus] = useState<FocusState>(bootstrap.focus);
  const [busy, setBusy] = useState(false);
  const [now, setNow] = useState(() => new Date());
  const [linkedScheduleId, setLinkedScheduleId] = useState(bootstrap.focus.linkedScheduleId ?? "");
  const [schedules, setSchedules] = useState<Schedule[]>([]);
  const [history, setHistory] = useState<FocusHistoryReport | null>(null);
  const [loadError, setLoadError] = useState(false);
  useEffect(() => {
    const start = new Date();
    start.setHours(0, 0, 0, 0);
    const end = new Date(start);
    end.setDate(end.getDate() + 1);
    void Promise.all([
      client.listSchedules({
        startUtc: start.toISOString(),
        endUtc: end.toISOString(),
        limit: 500,
      }),
      client.focusHistoryToday(),
    ])
      .then(([page, report]) => {
        setSchedules(page.items);
        setHistory(report);
      })
      .catch(() => setLoadError(true));
  }, [client]);
  useEffect(() => {
    const id = window.setInterval(() => {
      setNow(new Date());
      void client
        .currentFocus()
        .then(setFocus)
        .catch(() => undefined);
    }, 1000);
    return () => window.clearInterval(id);
  }, [client]);
  const command = async (value: "start" | "pause" | "resume" | "stop" | "skip") => {
    setBusy(true);
    try {
      setFocus(
        await client.focusCommand(
          value,
          value === "start" && linkedScheduleId ? linkedScheduleId : undefined,
        ),
      );
      setHistory(await client.focusHistoryToday());
    } finally {
      setBusy(false);
    }
  };
  const remaining = focus.endsAt
    ? Math.max(0, Math.ceil((Date.parse(focus.endsAt) - now.getTime()) / 1000))
    : bootstrap.settings.focusWorkMinutes * 60;
  const minutes = Math.floor(remaining / 60);
  const seconds = remaining % 60;
  return (
    <main className="secondary-view focus-view">
      <ViewTitle
        eyebrow="予定と同じ文脈で集中"
        title="フォーカス"
        description="作業・一時停止・休憩の状態を保存し、再起動後も回復します。"
      />
      {loadError ? (
        <StatusMessage tone="warning" title="予定または今日のFocus履歴を読み込めませんでした">
          Focusタイマーは利用できます。履歴を再表示するには、この画面を開き直してください。
        </StatusMessage>
      ) : null}
      <section className="focus-card" aria-labelledby="focus-phase">
        <span className="eyebrow">現在のフェーズ</span>
        <h2 id="focus-phase">{focusLabel(focus.phase)}</h2>
        <output className="focus-time" aria-label={`残り${minutes}分${seconds}秒`}>
          {String(minutes).padStart(2, "0")}:{String(seconds).padStart(2, "0")}
        </output>
        <p>
          サイクル {focus.cycle + 1} ／ 作業 {bootstrap.settings.focusWorkMinutes}分・休憩{" "}
          {bootstrap.settings.focusBreakMinutes}分・長休憩
          {bootstrap.settings.focusLongBreakMinutes}分（{bootstrap.settings.focusLongBreakEvery}
          サイクルごと）
        </p>
        {focus.phase === "idle" || focus.phase === "waiting_next" ? (
          <label className="focus-link">
            紐付ける予定（任意）
            <select
              value={linkedScheduleId}
              onChange={(event) => setLinkedScheduleId(event.target.value)}
            >
              <option value="">予定に紐付けない</option>
              {schedules.map((schedule) => (
                <option key={`${schedule.id}-${schedule.startUtc}`} value={schedule.id}>
                  {`${formatFocusTime(schedule.startUtc)} ${schedule.title}`}
                </option>
              ))}
            </select>
          </label>
        ) : focus.linkedScheduleId ? (
          <p>
            対象予定:{" "}
            <strong>
              {schedules.find((schedule) => schedule.id === focus.linkedScheduleId)?.title ??
                "紐付けた予定"}
            </strong>
          </p>
        ) : null}
        <div className="button-row button-row--center">
          {focus.phase === "idle" || focus.phase === "waiting_next" ? (
            <button
              className="button button--primary"
              disabled={busy}
              onClick={() => void command("start")}
            >
              作業を開始
            </button>
          ) : null}
          {focus.phase === "working" || focus.phase === "break" ? (
            <button className="button" disabled={busy} onClick={() => void command("pause")}>
              一時停止
            </button>
          ) : null}
          {focus.phase === "paused" ? (
            <button
              className="button button--primary"
              disabled={busy}
              onClick={() => void command("resume")}
            >
              再開
            </button>
          ) : null}
          {focus.phase === "working" ? (
            <button className="button" disabled={busy} onClick={() => void command("skip")}>
              休憩へ進む
            </button>
          ) : null}
          {focus.phase !== "idle" ? (
            <button
              className="button button--danger-outline"
              disabled={busy}
              onClick={() => void command("stop")}
            >
              Focusを終了
            </button>
          ) : null}
        </div>
      </section>
      <section className="focus-history" aria-labelledby="focus-history-title">
        <div className="section-heading section-heading--compact">
          <h2 id="focus-history-title">今日のFocus履歴</h2>
          <strong>
            作業 {Math.floor((history?.workSeconds ?? 0) / 60)}分
            {String((history?.workSeconds ?? 0) % 60).padStart(2, "0")}秒
          </strong>
        </div>
        {history?.entries.length ? (
          <ol>
            {history.entries.map((entry) => (
              <li key={entry.id}>
                <time>{formatFocusTime(entry.occurredAt)}</time>
                <span>{focusEventLabel(entry.event)}</span>
                {entry.elapsedSeconds > 0 ? (
                  <small>{Math.round(entry.elapsedSeconds / 60)}分</small>
                ) : null}
              </li>
            ))}
          </ol>
        ) : (
          <p>今日の履歴はまだありません。作業を開始するとここへ記録します。</p>
        )}
      </section>
      <StatusMessage title="通知と終了中の動作">
        アプリが完全終了している間は Focus
        の通知を配信できません。ウィンドウを閉じても続ける場合は、設定で「トレイへ格納」を選びます。
      </StatusMessage>
    </main>
  );
}

function formatFocusTime(value: string): string {
  return new Intl.DateTimeFormat("ja-JP", {
    hour: "2-digit",
    minute: "2-digit",
  }).format(new Date(value));
}

function focusEventLabel(event: FocusHistoryReport["entries"][number]["event"]): string {
  return {
    start: "作業開始",
    pause: "一時停止",
    resume: "再開",
    work_end: "作業終了",
    break_end: "休憩終了",
    stop: "Focus終了",
    skip: "フェーズをスキップ",
  }[event];
}

export function SettingsView({ client, bootstrap }: { client: AppClient; bootstrap: Bootstrap }) {
  const [settings, setSettings] = useState<Settings>(bootstrap.settings);
  const [saved, setSaved] = useState(false);
  const [busy, setBusy] = useState(false);
  const [windowPreferences, setWindowPreferences] = useState(bootstrap.windowPreferences);
  const [notificationPermission, setNotificationPermission] = useState<
    "unknown" | "granted" | "denied" | "unavailable"
  >("unknown");
  useEffect(() => {
    if (!("__TAURI_INTERNALS__" in window)) {
      setNotificationPermission("unavailable");
      return;
    }
    void isPermissionGranted()
      .then((granted) => setNotificationPermission(granted ? "granted" : "unknown"))
      .catch(() => setNotificationPermission("unavailable"));
  }, []);

  const askNotificationPermission = async () => {
    try {
      const result = await requestPermission();
      setNotificationPermission(result === "granted" ? "granted" : "denied");
    } catch {
      setNotificationPermission("unavailable");
    }
  };

  const testNotification = () => {
    sendNotification({
      title: "Day Schedule Next",
      body: "OS標準通知を確認できました。",
    });
  };
  const save = async () => {
    setBusy(true);
    try {
      setSettings(await client.updateSettings(settings));
      setSaved(true);
    } finally {
      setBusy(false);
    }
  };
  return (
    <main className="secondary-view settings-view">
      <ViewTitle
        eyebrow="動作と表示を調整"
        title="設定"
        description="一般、表示、通知、Focus、Google、データの既定動作を確認します。"
      />
      {saved ? <StatusMessage tone="success" title="設定をこの端末に保存しました" /> : null}
      <div className="settings-grid">
        <section>
          <h2>表示と操作</h2>
          <label>
            テーマ
            <select
              value={settings.theme}
              onChange={(event) =>
                setSettings({ ...settings, theme: event.target.value as Settings["theme"] })
              }
            >
              <option value="system">システム設定に合わせる</option>
              <option value="light">ライト</option>
              <option value="dark">ダーク</option>
            </select>
          </label>
          <label>
            タイムラインのスナップ幅
            <select
              value={settings.snapMinutes}
              onChange={(event) =>
                setSettings({
                  ...settings,
                  snapMinutes: Number(event.target.value) as Settings["snapMinutes"],
                })
              }
            >
              {[1, 5, 10, 15, 30].map((value) => (
                <option key={value} value={value}>
                  {value}分
                </option>
              ))}
            </select>
          </label>
          <p className="field-help">
            直接入力した時刻は1分単位で保存され、スナップ幅には丸められません。
          </p>
        </section>
        <section>
          <h2>アプリを閉じる動作</h2>
          <label>
            <input
              type="radio"
              name="close"
              checked={settings.closeBehavior === "tray"}
              onChange={() => setSettings({ ...settings, closeBehavior: "tray" })}
            />{" "}
            トレイへ格納して通知・同期を続ける
          </label>
          <label>
            <input
              type="radio"
              name="close"
              checked={settings.closeBehavior === "quit"}
              onChange={() => setSettings({ ...settings, closeBehavior: "quit" })}
            />{" "}
            完全終了する
          </label>
          <p className="field-help">完全終了中は通知、同期、Focusタイマーを実行できません。</p>
          <fieldset className="window-preferences">
            <legend>常に手前へ表示</legend>
            <label>
              <input
                type="checkbox"
                checked={windowPreferences.mainAlwaysOnTop}
                onChange={(event) => {
                  const value = event.target.checked;
                  setWindowPreferences({ ...windowPreferences, mainAlwaysOnTop: value });
                  void client.setWindowAlwaysOnTop("main", value);
                }}
              />
              メインウィンドウ
            </label>
            <label>
              <input
                type="checkbox"
                checked={windowPreferences.compactAlwaysOnTop}
                onChange={(event) => {
                  const value = event.target.checked;
                  setWindowPreferences({ ...windowPreferences, compactAlwaysOnTop: value });
                  void client.setWindowAlwaysOnTop("compact", value);
                }}
              />
              コンパクトウィンドウ
            </label>
          </fieldset>
        </section>
        <section>
          <h2>通知の復帰</h2>
          <p className="permission-state" data-state={notificationPermission}>
            OS通知権限: {permissionLabel(notificationPermission)}
          </p>
          <div className="button-row">
            {notificationPermission !== "granted" ? (
              <button
                className="button"
                type="button"
                onClick={() => void askNotificationPermission()}
              >
                OS通知を許可する
              </button>
            ) : (
              <button className="button" type="button" onClick={testNotification}>
                テスト通知
              </button>
            )}
          </div>
          {notificationPermission === "denied" ? (
            <StatusMessage tone="warning" title="OS通知は拒否されています">
              OSのアプリ通知設定で Day Schedule Next
              を許可してください。通知音だけを有効にした場合は、アプリ起動中に音のみ動作します。
            </StatusMessage>
          ) : null}
          <label>
            <input
              type="checkbox"
              checked={settings.scheduleNotificationsEnabled}
              onChange={(event) =>
                setSettings({ ...settings, scheduleNotificationsEnabled: event.target.checked })
              }
            />{" "}
            予定の通知を有効にする
          </label>
          <label>
            <input
              type="checkbox"
              checked={settings.osNotificationsEnabled}
              onChange={(event) =>
                setSettings({ ...settings, osNotificationsEnabled: event.target.checked })
              }
            />{" "}
            OS標準通知を使う
          </label>
          <label>
            <input
              type="checkbox"
              checked={settings.soundNotificationsEnabled}
              onChange={(event) =>
                setSettings({ ...settings, soundNotificationsEnabled: event.target.checked })
              }
            />{" "}
            アプリ内の通知音を使う
          </label>
          <label>
            スリープ後に補う範囲（分）
            <input
              type="number"
              min={0}
              max={120}
              value={settings.notificationGraceMinutes}
              onChange={(event) =>
                setSettings({ ...settings, notificationGraceMinutes: Number(event.target.value) })
              }
            />
          </label>
          <label>
            一度に補う最大件数
            <input
              type="number"
              min={0}
              max={20}
              value={settings.notificationMaxReplay}
              onChange={(event) =>
                setSettings({ ...settings, notificationMaxReplay: Number(event.target.value) })
              }
            />
          </label>
        </section>
        <section>
          <h2>Focus</h2>
          <label>
            作業時間（分）
            <input
              type="number"
              min={1}
              max={180}
              value={settings.focusWorkMinutes}
              onChange={(event) =>
                setSettings({ ...settings, focusWorkMinutes: Number(event.target.value) })
              }
            />
          </label>
          <label>
            休憩時間（分）
            <input
              type="number"
              min={1}
              max={180}
              value={settings.focusBreakMinutes}
              onChange={(event) =>
                setSettings({ ...settings, focusBreakMinutes: Number(event.target.value) })
              }
            />
          </label>
          <label>
            長休憩（分）
            <input
              type="number"
              min={1}
              max={180}
              value={settings.focusLongBreakMinutes}
              onChange={(event) =>
                setSettings({ ...settings, focusLongBreakMinutes: Number(event.target.value) })
              }
            />
          </label>
          <label>
            長休憩までのサイクル数
            <input
              type="number"
              min={1}
              max={12}
              value={settings.focusLongBreakEvery}
              onChange={(event) =>
                setSettings({ ...settings, focusLongBreakEvery: Number(event.target.value) })
              }
            />
          </label>
          <label>
            <input
              type="checkbox"
              checked={settings.focusAutoStart}
              onChange={(event) =>
                setSettings({ ...settings, focusAutoStart: event.target.checked })
              }
            />{" "}
            休憩後に次の作業を自動開始
          </label>
          <label>
            <input
              type="checkbox"
              checked={settings.focusNotificationsEnabled}
              onChange={(event) =>
                setSettings({ ...settings, focusNotificationsEnabled: event.target.checked })
              }
            />{" "}
            Focus通知を有効にする
          </label>
        </section>
      </div>
      <button
        className="button button--primary"
        type="button"
        disabled={busy}
        onClick={() => void save()}
      >
        {busy ? "保存中…" : "設定を保存"}
      </button>
      <GooglePanel client={client} />
      <DataTransferPanel client={client} />
    </main>
  );
}

function GooglePanel({ client }: { client: AppClient }) {
  const [connection, setConnection] = useState<GoogleConnection | null>(null);
  const [busy, setBusy] = useState(false);
  const [message, setMessage] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [disconnectMode, setDisconnectMode] = useState<"keep_local" | "delete_mapped_local" | null>(
    null,
  );

  const refresh = async () => setConnection(await client.googleConnection());

  useEffect(() => {
    let active = true;
    const read = () =>
      client
        .googleConnection()
        .then((value) => active && setConnection(value))
        .catch(() => active && setError("Google接続状態を取得できませんでした。"));
    void read();
    const timer = window.setInterval(() => {
      if (connection?.state === "connecting") void read();
    }, 2_000);
    return () => {
      active = false;
      window.clearInterval(timer);
    };
  }, [client, connection?.state]);

  const importConfig = async () => {
    setBusy(true);
    setError(null);
    try {
      const path = await open({
        title: "Google OAuth Desktop app JSONを選択",
        multiple: false,
        directory: false,
        filters: [{ name: "Google OAuth JSON", extensions: ["json"] }],
      });
      if (typeof path !== "string") return;
      const configured = await client.importGoogleOAuthConfig(path);
      await refresh();
      setMessage(
        `OAuth設定 ${configured.clientIdHint} を読み込みました。client secretはOS秘密ストアへ保存しました。`,
      );
    } catch {
      setError(
        "OAuth JSONを読み込めませんでした。Google CloudでDesktop appとして作成したJSONを確認してください。",
      );
    } finally {
      setBusy(false);
    }
  };

  const connect = async () => {
    setBusy(true);
    setError(null);
    try {
      const result = await client.beginGoogleOAuth();
      setMessage(
        result.openedInSystemBrowser
          ? "システムブラウザを開きました。3分以内にGoogleの同意を完了してください。"
          : "ブラウザでGoogleの同意を完了してください。",
      );
      await refresh();
    } catch {
      setError("Google接続を開始できませんでした。OAuth設定と既定ブラウザを確認してください。");
    } finally {
      setBusy(false);
    }
  };

  const updateCalendar = async (id: string, selected: boolean, defaultWriteTarget: boolean) => {
    setBusy(true);
    try {
      await client.updateGoogleCalendar(id, selected, defaultWriteTarget);
      await refresh();
    } catch {
      setError("カレンダー設定を保存できませんでした。権限と接続状態を確認してください。");
    } finally {
      setBusy(false);
    }
  };

  const disconnect = async (mode: "keep_local" | "delete_mapped_local") => {
    setBusy(true);
    try {
      const affected = await client.disconnectGoogle(mode);
      await refresh();
      setMessage(
        mode === "keep_local"
          ? `Google接続を解除し、対応するローカル予定${affected}件を保持しました。`
          : `Google接続を解除し、対応するローカル予定${affected}件を削除待ちにしました。`,
      );
      setDisconnectMode(null);
    } catch {
      setError("Google接続を解除できませんでした。認証情報とローカル予定は保持されています。");
    } finally {
      setBusy(false);
    }
  };

  return (
    <section className="google-panel" aria-labelledby="google-panel-title">
      <div className="section-heading-row">
        <div>
          <h2 id="google-panel-title">Google Calendar</h2>
          <p>
            Desktop OAuth、PKCE
            S256、127.0.0.1の一時ポートを使い、予定編集とカレンダー一覧だけを許可します。
          </p>
        </div>
        <span className="state-chip" data-state={connection?.state ?? "loading"}>
          {googleStateLabel(connection?.state)}
        </span>
      </div>
      {message ? <StatusMessage tone="success" title={message} /> : null}
      {error ? <StatusMessage tone="danger" title={error} /> : null}
      {connection?.state === "feature_disabled" ? (
        <StatusMessage title="このビルドはローカル専用です">
          Google同期を含まない機能フラグでビルドされています。ローカル予定、通知、Focusは利用できます。
        </StatusMessage>
      ) : null}
      {!connection?.configured && connection?.state !== "feature_disabled" ? (
        <div className="button-row">
          <button className="button" disabled={busy} onClick={() => void importConfig()}>
            Desktop OAuth JSONを読み込む
          </button>
        </div>
      ) : null}
      {connection?.configured && !connection.accountId ? (
        <div className="button-row">
          <button className="button button--primary" disabled={busy} onClick={() => void connect()}>
            システムブラウザでGoogleへ接続
          </button>
          <button className="button" disabled={busy} onClick={() => void importConfig()}>
            OAuth JSONを変更
          </button>
        </div>
      ) : null}
      {connection?.state === "connecting" ? (
        <StatusMessage title="ブラウザでGoogle接続を待っています">
          このアプリが認可コード、state、PKCE
          verifierを検証します。ブラウザに表示されたコードを貼り付ける必要はありません。
        </StatusMessage>
      ) : null}
      {connection?.accountId ? (
        <>
          <p>
            接続: <strong>{connection.displayLabel ?? "Google Calendar"}</strong>
          </p>
          <div className="google-calendar-list" role="group" aria-label="同期するカレンダー">
            {connection.calendars.map((calendar) => (
              <article key={calendar.id}>
                <i style={{ backgroundColor: calendar.color }} aria-hidden="true" />
                <span>
                  <strong>{calendar.displayName}</strong>
                  <small>
                    {calendar.timezoneId}・{calendar.writable ? "書き込み可能" : "読み取り専用"}
                  </small>
                </span>
                <label>
                  <input
                    type="checkbox"
                    checked={calendar.selected}
                    disabled={busy}
                    onChange={(event) =>
                      void updateCalendar(
                        calendar.id,
                        event.target.checked,
                        event.target.checked && calendar.defaultWriteTarget,
                      )
                    }
                  />
                  同期
                </label>
                <label>
                  <input
                    type="radio"
                    name="default-google-calendar"
                    checked={calendar.defaultWriteTarget}
                    disabled={busy || !calendar.writable}
                    onChange={() => void updateCalendar(calendar.id, true, true)}
                  />
                  新規予定の同期先
                </label>
              </article>
            ))}
          </div>
          {disconnectMode ? (
            <div className="disconnect-confirm">
              <StatusMessage tone="warning" title="Google接続を解除します">
                対応するローカル予定は{connection.mappedScheduleCount}件です。
                {disconnectMode === "keep_local"
                  ? " 予定を端末に残し、以後はローカル予定として扱います。"
                  : " 対応するローカル予定を削除待ちにします。Google上のイベントは削除しません。"}
              </StatusMessage>
              <div className="button-row">
                <button
                  className="button button--danger"
                  disabled={busy}
                  onClick={() => void disconnect(disconnectMode)}
                >
                  影響を確認して解除
                </button>
                <button className="button" onClick={() => setDisconnectMode(null)}>
                  やめる
                </button>
              </div>
            </div>
          ) : (
            <div className="button-row">
              <button className="button" onClick={() => setDisconnectMode("keep_local")}>
                ローカル予定を残して解除…
              </button>
              <button
                className="button button--danger-outline"
                onClick={() => setDisconnectMode("delete_mapped_local")}
              >
                対応ローカル予定も削除して解除…
              </button>
            </div>
          )}
        </>
      ) : null}
      <details>
        <summary>Google Cloud設定の注意</summary>
        <p>
          OAuth同意画面が「Testing」の場合、refresh
          tokenが短期間で失効することがあります。継続利用する場合はGoogle
          Cloudの公開状態とテストユーザー設定を確認してください。未確認アプリの警告が表示される場合があります。
        </p>
        <p>
          要求スコープ: <code>calendar.events</code> と <code>calendar.calendarlist.readonly</code>
          のみ。client secret、access token、refresh
          tokenはOS秘密ストアへ保存し、SQLiteと画面には返しません。
        </p>
      </details>
    </section>
  );
}

function DataTransferPanel({ client }: { client: AppClient }) {
  const [importPath, setImportPath] = useState<string | null>(null);
  const [preview, setPreview] = useState<ImportPreview | null>(null);
  const [mode, setMode] = useState<"add" | "replace">("add");
  const [result, setResult] = useState<ImportResult | null>(null);
  const [message, setMessage] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const [legacyPath, setLegacyPath] = useState<string | null>(null);
  const [legacyPreview, setLegacyPreview] = useState<LegacyImportPreview | null>(null);
  const [legacyResult, setLegacyResult] = useState<LegacyImportResult | null>(null);
  const [deleteConfirmation, setDeleteConfirmation] = useState("");
  const [deletedScheduleCount, setDeletedScheduleCount] = useState<number | null>(null);

  const exportData = async () => {
    setBusy(true);
    setError(null);
    try {
      const path = await save({
        title: "予定データをJSONへエクスポート",
        defaultPath: `day-schedule-next-${new Date().toISOString().slice(0, 10)}.json`,
        filters: [{ name: "Day Schedule Next JSON", extensions: ["json"] }],
      });
      if (!path) return;
      const exported = await client.exportData(path);
      setMessage(
        `${exported.fileName}へ予定${exported.scheduleCount}件、テンプレート${exported.templateCount}件を保存しました。`,
      );
    } catch {
      setError("エクスポートできませんでした。保存先を選び直して再試行してください。");
    } finally {
      setBusy(false);
    }
  };

  const selectImport = async () => {
    setBusy(true);
    setError(null);
    setResult(null);
    try {
      const path = await open({
        title: "取り込むDay Schedule Next JSONを選択",
        multiple: false,
        directory: false,
        filters: [{ name: "Day Schedule Next JSON", extensions: ["json"] }],
      });
      if (typeof path !== "string") return;
      setImportPath(path);
      setPreview(await client.previewImport(path));
    } catch {
      setPreview(null);
      setImportPath(null);
      setError("ファイルをプレビューできませんでした。元データは変更されていません。");
    } finally {
      setBusy(false);
    }
  };

  const commitImport = async () => {
    if (!preview || !importPath) return;
    setBusy(true);
    setError(null);
    try {
      const imported = await client.importData(importPath, preview.fingerprint, mode);
      setResult(imported);
      setPreview(null);
      setImportPath(null);
      setMessage("インポートを1つのトランザクションで確定しました。画面を再読込してください。");
    } catch {
      setError(
        "インポートを確定できませんでした。データは部分適用されていません。再プレビューしてください。",
      );
    } finally {
      setBusy(false);
    }
  };

  const selectLegacy = async () => {
    setBusy(true);
    setError(null);
    setLegacyResult(null);
    try {
      const path = await open({
        title: "旧Day Scheduleのschedule.dbを選択",
        multiple: false,
        directory: false,
        filters: [{ name: "SQLite database", extensions: ["db", "sqlite", "sqlite3"] }],
      });
      if (typeof path !== "string") return;
      setLegacyPath(path);
      setLegacyPreview(await client.previewLegacyImport(path));
    } catch {
      setLegacyPath(null);
      setLegacyPreview(null);
      setError(
        "旧DBを読み取り専用でプレビューできませんでした。元アプリを閉じ、DBのコピーを選んでください。",
      );
    } finally {
      setBusy(false);
    }
  };

  const commitLegacy = async () => {
    if (!legacyPath || !legacyPreview) return;
    setBusy(true);
    setError(null);
    try {
      setLegacyResult(await client.importLegacy(legacyPath, legacyPreview.fingerprint));
      setLegacyPath(null);
      setLegacyPreview(null);
      setMessage("旧DBの有効な項目を1つのトランザクションで取り込みました。");
    } catch {
      setError(
        "旧DBを取り込めませんでした。新しいデータは部分適用されていません。もう一度プレビューしてください。",
      );
    } finally {
      setBusy(false);
    }
  };

  const deleteAllData = async () => {
    if (deleteConfirmation !== "すべてのローカルデータを削除") return;
    setBusy(true);
    setError(null);
    setMessage(null);
    try {
      setDeletedScheduleCount(await client.deleteAllUserData(deleteConfirmation));
      setDeleteConfirmation("");
    } catch {
      setError(
        "全データ削除を確定できませんでした。表示された回復手順に従い、OSの資格情報ストアと保存領域を確認してください。",
      );
    } finally {
      setBusy(false);
    }
  };

  return (
    <section className="data-transfer" aria-labelledby="data-transfer-title">
      <h2 id="data-transfer-title">データ</h2>
      <p>
        予定、テンプレート、Quick
        Block、アラーム、設定をJSONへ保存します。Google認証情報と同期識別子は含めません。
      </p>
      {message ? <StatusMessage tone="success" title={message} /> : null}
      {error ? <StatusMessage tone="danger" title={error} /> : null}
      {deletedScheduleCount !== null ? (
        <StatusMessage
          tone="success"
          title={`この端末の予定${deletedScheduleCount}件と関連データを削除しました`}
          action={
            <button className="button" type="button" onClick={() => window.location.reload()}>
              初期状態を再読み込み
            </button>
          }
        >
          追加テンプレート、Quick Block、アラーム、Focus履歴、同期情報、Google認証情報、
          診断履歴、バックアップ、設定を消去しました。Google Calendar上の予定は削除していません。
        </StatusMessage>
      ) : null}
      {result ? (
        <StatusMessage tone="success" title="取り込み結果">
          予定{result.importedScheduleCount}件、テンプレート{result.importedTemplateCount}件、Quick
          Block{result.importedQuickBlockCount}件、アラーム{result.importedAlarmCount}
          件を追加しました。
          {result.preservedExternalScheduleCount > 0
            ? ` Google由来の予定${result.preservedExternalScheduleCount}件は保護しました。`
            : ""}
        </StatusMessage>
      ) : null}
      <div className="button-row">
        <button className="button" type="button" disabled={busy} onClick={() => void exportData()}>
          JSONへエクスポート
        </button>
        <button
          className="button"
          type="button"
          disabled={busy}
          onClick={() => void selectImport()}
        >
          JSONを選んでプレビュー
        </button>
      </div>
      {preview ? (
        <div className="import-preview">
          <h3>適用前の確認</h3>
          <dl>
            <div>
              <dt>予定</dt>
              <dd>{preview.scheduleCount}件</dd>
            </div>
            <div>
              <dt>テンプレート</dt>
              <dd>{preview.templateCount}件</dd>
            </div>
            <div>
              <dt>Quick Block</dt>
              <dd>{preview.quickBlockCount}件</dd>
            </div>
            <div>
              <dt>アラーム</dt>
              <dd>{preview.alarmCount}件</dd>
            </div>
          </dl>
          <ul>
            {preview.warnings.map((warning) => (
              <li key={warning}>{warning}</li>
            ))}
          </ul>
          <fieldset>
            <legend>適用方法</legend>
            <label>
              <input
                type="radio"
                name="import-mode"
                checked={mode === "add"}
                onChange={() => setMode("add")}
              />{" "}
              新しい項目として追加（推奨）
            </label>
            <label>
              <input
                type="radio"
                name="import-mode"
                checked={mode === "replace"}
                onChange={() => setMode("replace")}
              />{" "}
              ローカル項目を置換（Google由来の予定は保持）
            </label>
          </fieldset>
          {mode === "replace" ? (
            <StatusMessage tone="warning" title="ローカル項目を置き換えます">
              現在のローカル予定、追加テンプレート、Quick
              Block、アラームを削除してから取り込みます。Google由来の予定と既定テンプレートは保持します。
            </StatusMessage>
          ) : null}
          <div className="button-row">
            <button
              className={mode === "replace" ? "button button--danger" : "button button--primary"}
              type="button"
              disabled={busy}
              onClick={() => void commitImport()}
            >
              {mode === "replace" ? "確認した内容で置換" : "確認した内容を追加"}
            </button>
            <button
              className="button"
              type="button"
              onClick={() => {
                setPreview(null);
                setImportPath(null);
              }}
            >
              取り消す
            </button>
          </div>
        </div>
      ) : null}
      <hr />
      <h3>旧Day Scheduleから移行</h3>
      <p>
        旧 <code>schedule.db</code> を読み取り専用で解析し、件数と変換警告を確認してから追加します。
        元DBは変更しません。
      </p>
      {legacyResult ? (
        <StatusMessage tone="success" title="旧DBの取り込み結果">
          テンプレート{legacyResult.importedTemplateCount}件、ブロック
          {legacyResult.importedTemplateBlockCount}件、Quick Block
          {legacyResult.importedQuickBlockCount}件、アラーム{legacyResult.importedAlarmCount}
          件を追加しました。
        </StatusMessage>
      ) : null}
      <button className="button" type="button" disabled={busy} onClick={() => void selectLegacy()}>
        schedule.dbを選んでプレビュー
      </button>
      {legacyPreview ? (
        <div className="import-preview">
          <h3>旧DBの適用前確認</h3>
          <dl>
            <div>
              <dt>テンプレート／ブロック</dt>
              <dd>
                {legacyPreview.templateCount}件／{legacyPreview.templateBlockCount}件
              </dd>
            </div>
            <div>
              <dt>Quick Block／アラーム</dt>
              <dd>
                {legacyPreview.quickBlockCount}件／{legacyPreview.alarmCount}件
              </dd>
            </div>
            <div>
              <dt>孤児／無効時刻／重複名</dt>
              <dd>
                {legacyPreview.orphanCount}件／{legacyPreview.invalidTimeCount}件／
                {legacyPreview.duplicateNameCount}件
              </dd>
            </div>
            <div>
              <dt>最後のテンプレート</dt>
              <dd>{legacyPreview.lastProfileFound ? "移行します" : "既定へフォールバック"}</dd>
            </div>
          </dl>
          {legacyPreview.warnings.length > 0 ? (
            <ul>
              {legacyPreview.warnings.map((warning) => (
                <li key={warning}>{warning}</li>
              ))}
            </ul>
          ) : (
            <p>変換警告はありません。</p>
          )}
          <p>
            移行しない項目: <strong>{legacyPreview.excluded.join("、")}</strong>
          </p>
          <div className="button-row">
            <button
              className="button button--primary"
              type="button"
              disabled={busy}
              onClick={() => void commitLegacy()}
            >
              確認した有効項目を追加
            </button>
            <button
              className="button"
              type="button"
              onClick={() => {
                setLegacyPath(null);
                setLegacyPreview(null);
              }}
            >
              取り消す
            </button>
          </div>
        </div>
      ) : null}
      <hr />
      <details className="data-delete-zone">
        <summary>この端末のすべてのデータを削除</summary>
        <StatusMessage tone="danger" title="元に戻せない操作です">
          対象は、この端末の予定（Googleから取得したローカルコピーを含む）、追加テンプレート、Quick
          Block、アラーム、Focus履歴、同期情報、Google認証情報、診断履歴、バックアップ、設定です。
          Google Calendar上の予定は削除しません。必要なら先にJSONへエクスポートしてください。
        </StatusMessage>
        <label>
          続けるには「すべてのローカルデータを削除」と入力
          <input
            value={deleteConfirmation}
            autoComplete="off"
            spellCheck={false}
            onChange={(event) => setDeleteConfirmation(event.target.value)}
          />
        </label>
        <div className="button-row">
          <button
            className="button button--danger"
            type="button"
            disabled={busy || deleteConfirmation !== "すべてのローカルデータを削除"}
            onClick={() => void deleteAllData()}
          >
            理解して全データを削除
          </button>
          <button
            className="button"
            type="button"
            disabled={busy || deleteConfirmation.length === 0}
            onClick={() => setDeleteConfirmation("")}
          >
            入力を取り消す
          </button>
        </div>
      </details>
    </section>
  );
}

export function DiagnosticsView({ client }: { client: AppClient }) {
  const [snapshot, setSnapshot] = useState<DiagnosticsSnapshot | null>(null);
  const [error, setError] = useState(false);
  const [message, setMessage] = useState<string | null>(null);
  const [notificationHistory, setNotificationHistory] = useState<NotificationLedgerItem[]>([]);
  const [notificationHistoryError, setNotificationHistoryError] = useState(false);
  useEffect(() => {
    let active = true;
    void client
      .diagnostics()
      .then((value) => {
        if (active) setSnapshot(value);
      })
      .catch(() => {
        if (active) setError(true);
      });
    return () => {
      active = false;
    };
  }, [client]);
  useEffect(() => {
    let active = true;
    void client
      .notificationLedger()
      .then((items) => {
        if (active) setNotificationHistory(items);
      })
      .catch(() => {
        if (active) setNotificationHistoryError(true);
      });
    return () => {
      active = false;
    };
  }, [client]);

  const copyVersions = async () => {
    if (!snapshot) return;
    const text = [
      `Day Schedule Next ${snapshot.appVersion}`,
      `DB schema ${snapshot.schemaVersion}`,
      `OS/WebView ${navigator.userAgent}`,
      `sync queue ${snapshot.outboxCount}, conflicts ${snapshot.conflictCount}`,
    ].join("\n");
    try {
      await navigator.clipboard.writeText(text);
      setMessage("予定本文や識別子を含まないバージョン情報をコピーしました。");
    } catch {
      setMessage("クリップボードへコピーできませんでした。診断JSONを保存してください。");
    }
  };

  const exportDiagnostics = async () => {
    try {
      const path = await save({
        title: "マスク済み診断JSONを保存",
        defaultPath: `day-schedule-next-diagnostics-${new Date().toISOString().slice(0, 10)}.json`,
        filters: [{ name: "Redacted diagnostics JSON", extensions: ["json"] }],
      });
      if (!path) return;
      const result = await client.exportDiagnostics(path, navigator.userAgent);
      setMessage(
        `${result.fileName}へ構造化イベント${result.eventCount}件をマスク済みで保存しました。`,
      );
    } catch {
      setMessage("診断JSONを保存できませんでした。保存先を選び直してください。");
    }
  };
  return (
    <main className="secondary-view diagnostics-view">
      <ViewTitle
        eyebrow="安全な復旧と確認"
        title="データと診断"
        description="予定本文やアカウント情報を表示せず、保存状態と回復手段を確認します。"
      />
      {error ? (
        <StatusMessage tone="danger" title="診断情報を取得できませんでした">
          予定データは変更されていません。アプリを再起動してもう一度確認してください。
        </StatusMessage>
      ) : null}
      {!snapshot && !error ? <StatusMessage title="診断情報を確認しています" /> : null}
      {snapshot ? (
        <dl className="diagnostics-grid">
          <div>
            <dt>アプリバージョン</dt>
            <dd>{snapshot.appVersion}</dd>
          </div>
          <div>
            <dt>データ形式</dt>
            <dd>Version {snapshot.schemaVersion}</dd>
          </div>
          <div>
            <dt>予定</dt>
            <dd>{snapshot.scheduleCount}件</dd>
          </div>
          <div>
            <dt>削除待ち</dt>
            <dd>{snapshot.deletedCount}件</dd>
          </div>
          <div>
            <dt>Google反映待ち</dt>
            <dd>{snapshot.outboxCount}件</dd>
          </div>
          <div>
            <dt>未解決の競合</dt>
            <dd>{snapshot.conflictCount}件</dd>
          </div>
          <div>
            <dt>データ整合性</dt>
            <dd>{snapshot.integrity === "ok" ? "正常" : "確認が必要"}</dd>
          </div>
          <div>
            <dt>最終バックアップ</dt>
            <dd>{snapshot.lastBackupAt ?? "まだありません"}</dd>
          </div>
        </dl>
      ) : null}
      {message ? <StatusMessage title={message} /> : null}
      <div className="button-row">
        <button
          className="button"
          type="button"
          disabled={!snapshot}
          onClick={() => void copyVersions()}
        >
          バージョン情報をコピー
        </button>
        <button
          className="button"
          type="button"
          disabled={!snapshot}
          onClick={() => void exportDiagnostics()}
        >
          マスク済み診断JSONを保存
        </button>
      </div>
      <StatusMessage title="公開用の診断情報について">
        コピー・エクスポートには予定名、説明、場所、メールアドレス、カレンダーID、認証情報、端末上の絶対パスを含めません。
      </StatusMessage>
      <section className="notification-history" aria-labelledby="notification-history-title">
        <div className="section-heading-row">
          <div>
            <h2 id="notification-history-title">通知配信履歴</h2>
            <p>直近100件の結果だけを表示します。予定名や通知本文は保存・表示しません。</p>
          </div>
        </div>
        {notificationHistoryError ? (
          <StatusMessage tone="warning" title="通知履歴を読み込めませんでした" />
        ) : notificationHistory.length ? (
          <div className="table-scroll">
            <table>
              <thead>
                <tr>
                  <th>対象時刻</th>
                  <th>試行時刻</th>
                  <th>結果</th>
                  <th>分類</th>
                </tr>
              </thead>
              <tbody>
                {notificationHistory.map((item, index) => (
                  <tr key={`${item.attemptedAt}-${index}`}>
                    <td>{new Date(item.occurrenceAt).toLocaleString("ja-JP")}</td>
                    <td>{new Date(item.attemptedAt).toLocaleString("ja-JP")}</td>
                    <td>{notificationResultLabel(item.result)}</td>
                    <td>{item.errorCategory ?? "なし"}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        ) : (
          <p>通知配信履歴はまだありません。</p>
        )}
      </section>
      <SyncOperationsPanel client={client} />
      <BackupPanel client={client} />
    </main>
  );
}

function notificationResultLabel(result: NotificationLedgerItem["result"]): string {
  return {
    delivered: "配信済み",
    skipped: "スキップ",
    failed: "失敗",
    expired: "期限切れ",
  }[result];
}

function SyncOperationsPanel({ client }: { client: AppClient }) {
  const [queue, setQueue] = useState<SyncQueueItem[]>([]);
  const [conflicts, setConflicts] = useState<SyncConflictItem[]>([]);
  const [busy, setBusy] = useState(false);
  const [message, setMessage] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);

  const refresh = async () => {
    const [nextQueue, nextConflicts] = await Promise.all([
      client.listSyncQueue(),
      client.listSyncConflicts(),
    ]);
    setQueue(nextQueue);
    setConflicts(nextConflicts);
  };

  useEffect(() => {
    let active = true;
    void Promise.all([client.listSyncQueue(), client.listSyncConflicts()])
      .then(([nextQueue, nextConflicts]) => {
        if (!active) return;
        setQueue(nextQueue);
        setConflicts(nextConflicts);
      })
      .catch(() => {
        if (active) setError("同期キューと競合を読み込めませんでした。");
      });
    return () => {
      active = false;
    };
  }, [client]);

  const synchronize = async () => {
    setBusy(true);
    setError(null);
    try {
      await client.runSync();
      await refresh();
      setMessage("同期を実行しました。保留中の項目は次回時刻に再試行します。");
    } catch {
      await refresh().catch(() => undefined);
      setError("同期を完了できませんでした。ローカル変更は保持されています。");
    } finally {
      setBusy(false);
    }
  };

  const retry = async (id?: string) => {
    setBusy(true);
    setError(null);
    try {
      await client.retrySyncQueue(id);
      await client.runSync();
      await refresh();
      setMessage(id ? "選択した項目を再試行しました。" : "同期キュー全体を再試行しました。");
    } catch {
      await refresh().catch(() => undefined);
      setError("再試行を完了できませんでした。予定とキューは保持されています。");
    } finally {
      setBusy(false);
    }
  };

  return (
    <section className="sync-operations" aria-labelledby="sync-operations-title">
      <div className="section-heading-row">
        <div>
          <h2 id="sync-operations-title">同期キューと競合</h2>
          <p>ローカル変更の反映状況を確認し、失敗項目と同時変更を回復します。</p>
        </div>
        <div className="button-row">
          <button className="button" disabled={busy} onClick={() => void synchronize()}>
            今すぐ同期
          </button>
          {queue.some((item) => item.errorCategory) ? (
            <button className="button" disabled={busy} onClick={() => void retry()}>
              失敗をすべて再試行
            </button>
          ) : null}
        </div>
      </div>
      {message ? <StatusMessage tone="success" title={message} /> : null}
      {error ? <StatusMessage tone="danger" title={error} /> : null}
      {queue.length === 0 ? <StatusMessage title="Google反映待ちはありません" /> : null}
      {queue.length > 0 ? (
        <div className="table-scroll" tabIndex={0} aria-label="同期キュー一覧">
          <table className="sync-queue-table">
            <thead>
              <tr>
                <th>予定</th>
                <th>操作</th>
                <th>状態</th>
                <th>試行</th>
                <th>次回</th>
                <th>操作</th>
              </tr>
            </thead>
            <tbody>
              {queue.map((item) => (
                <tr key={item.id}>
                  <td>{item.title}</td>
                  <td>{syncOperationLabel(item.operation)}</td>
                  <td>{syncErrorLabel(item.errorCategory)}</td>
                  <td>{item.attemptCount}回</td>
                  <td>
                    {new Intl.DateTimeFormat("ja-JP", {
                      dateStyle: "short",
                      timeStyle: "short",
                    }).format(new Date(item.nextAttemptAt))}
                  </td>
                  <td>
                    <button
                      className="link-button"
                      disabled={busy}
                      onClick={() => void retry(item.id)}
                    >
                      再試行
                    </button>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      ) : null}
      {conflicts.length === 0 ? <StatusMessage title="未解決の競合はありません" /> : null}
      <div className="conflict-list">
        {conflicts.map((conflict) => (
          <ConflictResolver
            key={conflict.id}
            conflict={conflict}
            busy={busy}
            onResolve={async (choices) => {
              setBusy(true);
              setError(null);
              try {
                await client.resolveSyncConflict(conflict.id, choices);
                await client.runSync();
                await refresh();
                setMessage(`「${conflict.title}」の競合を解決しました。`);
              } catch {
                setError("競合を解決できませんでした。選択内容と最新状態を確認してください。");
              } finally {
                setBusy(false);
              }
            }}
          />
        ))}
      </div>
    </section>
  );
}

function ConflictResolver({
  conflict,
  busy,
  onResolve,
}: {
  conflict: SyncConflictItem;
  busy: boolean;
  onResolve: (choices: ConflictChoice[]) => Promise<void>;
}) {
  const [choices, setChoices] = useState<Record<string, "local" | "remote">>(() =>
    Object.fromEntries(conflict.fields.map((field) => [field.field, "local"])),
  );
  return (
    <article className="conflict-card">
      <header>
        <div>
          <h3>{conflict.title}</h3>
          <p>
            {conflict.calendarName}・
            {new Intl.DateTimeFormat("ja-JP", { dateStyle: "medium", timeStyle: "short" }).format(
              new Date(conflict.createdAt),
            )}
          </p>
        </div>
        <span className="state-chip" data-state="conflict">
          競合
        </span>
      </header>
      <fieldset>
        <legend>
          {conflict.deletionConflict
            ? "削除と変更のどちらを採用するか選択"
            : "項目ごとに採用する値を選択"}
        </legend>
        {conflict.fields.map((field) => (
          <div className="conflict-field" key={field.field}>
            <strong>{conflictFieldLabel(field.field)}</strong>
            <label>
              <input
                type="radio"
                name={`${conflict.id}-${field.field}`}
                checked={choices[field.field] === "local"}
                onChange={() => setChoices({ ...choices, [field.field]: "local" })}
              />
              <span>この端末</span>
              <code>{formatConflictValue(field.localValue)}</code>
            </label>
            <label>
              <input
                type="radio"
                name={`${conflict.id}-${field.field}`}
                checked={choices[field.field] === "remote"}
                onChange={() => setChoices({ ...choices, [field.field]: "remote" })}
              />
              <span>Google</span>
              <code>{formatConflictValue(field.remoteValue)}</code>
            </label>
          </div>
        ))}
      </fieldset>
      <button
        className="button button--primary"
        disabled={busy}
        onClick={() =>
          void onResolve(
            conflict.fields.map((field) => ({
              field: field.field,
              source: choices[field.field] ?? "local",
            })),
          )
        }
      >
        選択内容で解決
      </button>
    </article>
  );
}

function formatConflictValue(value: unknown): string {
  if (value === null || value === undefined || value === "") return "（空）";
  if (Array.isArray(value)) return value.join(", ") || "（なし）";
  if (typeof value === "object") return JSON.stringify(value);
  if (typeof value === "string" || typeof value === "number" || typeof value === "boolean") {
    return `${value}`;
  }
  return "（表示できない値）";
}

function conflictFieldLabel(field: string): string {
  return (
    {
      title: "タイトル",
      description: "説明",
      location: "場所",
      startUtc: "開始",
      endUtc: "終了",
      timezoneId: "タイムゾーン",
      allDay: "終日",
      status: "状態",
      project: "プロジェクト",
      category: "カテゴリ",
      tags: "タグ",
      color: "色",
      priority: "優先度",
      recurrenceRule: "繰り返し",
      delete: "保持または削除",
    }[field] ?? field
  );
}

function syncOperationLabel(operation: SyncQueueItem["operation"]): string {
  return { create: "作成", update: "更新", delete: "削除" }[operation];
}

function syncErrorLabel(category: string | null): string {
  if (!category) return "待機中";
  return (
    {
      auth_required: "再認証が必要",
      conflict: "競合の解決待ち",
      retryable: "一時失敗",
      permanent: "手動確認が必要",
      merged: "自動統合後の再試行",
    }[category] ?? category
  );
}

function BackupPanel({ client }: { client: AppClient }) {
  const [backups, setBackups] = useState<BackupRecord[]>([]);
  const [busy, setBusy] = useState(false);
  const [confirmId, setConfirmId] = useState<string | null>(null);
  const [message, setMessage] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const refresh = async () => setBackups(await client.listBackups());

  useEffect(() => {
    let active = true;
    void client
      .listBackups()
      .then((items) => active && setBackups(items))
      .catch(() => active && setError("バックアップ一覧を取得できませんでした。"));
    return () => {
      active = false;
    };
  }, [client]);

  const createBackup = async () => {
    setBusy(true);
    setError(null);
    try {
      await client.createBackup();
      await refresh();
      setMessage("整合性を確認したバックアップを作成しました。");
    } catch {
      setError("バックアップを作成できませんでした。現在のデータは変更されていません。");
    } finally {
      setBusy(false);
    }
  };

  const stageRestore = async (backup: BackupRecord) => {
    setBusy(true);
    setError(null);
    try {
      await client.stageRestore(backup.id);
      setMessage(
        "復元を準備しました。アプリを完全終了して再起動すると、現在のDBを退避してから切り替えます。",
      );
      setConfirmId(null);
    } catch {
      setError("復元を準備できませんでした。現在のデータは切り替えていません。");
    } finally {
      setBusy(false);
    }
  };

  return (
    <section className="backup-panel" aria-labelledby="backup-title">
      <div className="section-heading-row">
        <div>
          <h2 id="backup-title">バックアップと復元</h2>
          <p>日次で最大10世代を保持します。復元は再起動時に整合性確認後だけ切り替えます。</p>
        </div>
        <button className="button" disabled={busy} onClick={() => void createBackup()}>
          今すぐバックアップ
        </button>
      </div>
      {message ? <StatusMessage tone="success" title={message} /> : null}
      {error ? <StatusMessage tone="danger" title={error} /> : null}
      {backups.length === 0 ? <StatusMessage title="検証済みバックアップはまだありません" /> : null}
      <ol className="backup-list">
        {backups.map((backup) => (
          <li key={backup.id}>
            <span>
              <strong>
                {new Intl.DateTimeFormat("ja-JP", {
                  dateStyle: "medium",
                  timeStyle: "short",
                }).format(new Date(backup.createdAt))}
              </strong>
              <small>
                DB v{backup.schemaVersion}・{formatBytes(backup.sizeBytes)}・
                {backup.verified ? "整合性確認済み" : "未検証"}
              </small>
            </span>
            {confirmId === backup.id ? (
              <span className="inline-confirm">
                <button
                  className="button button--danger"
                  disabled={busy}
                  onClick={() => void stageRestore(backup)}
                >
                  この世代で復元準備
                </button>
                <button className="button" onClick={() => setConfirmId(null)}>
                  やめる
                </button>
              </span>
            ) : (
              <button className="button" disabled={busy} onClick={() => setConfirmId(backup.id)}>
                復元…
              </button>
            )}
          </li>
        ))}
      </ol>
      {confirmId ? (
        <StatusMessage tone="warning" title="復元の影響">
          次回起動時、現在のDBを別世代として退避し、選択したバックアップを検証してから切り替えます。現在のDBを削除せず、復元失敗時は切り替えません。
        </StatusMessage>
      ) : null}
    </section>
  );
}

function formatBytes(value: number): string {
  if (value < 1024) return `${value} B`;
  if (value < 1024 * 1024) return `${(value / 1024).toFixed(1)} KB`;
  return `${(value / (1024 * 1024)).toFixed(1)} MB`;
}

function focusLabel(phase: FocusState["phase"]): string {
  return {
    idle: "待機中",
    working: "作業中",
    paused: "一時停止",
    break: "休憩中",
    waiting_next: "次の作業待ち",
  }[phase];
}

function permissionLabel(value: "unknown" | "granted" | "denied" | "unavailable"): string {
  return {
    unknown: "未確認",
    granted: "許可済み",
    denied: "拒否",
    unavailable: "この実行環境では利用不可",
  }[value];
}

function googleStateLabel(state?: GoogleConnection["state"]): string {
  if (!state) return "確認中";
  return {
    not_configured: "未設定",
    configured: "接続前",
    connecting: "接続中",
    connected: "接続済み",
    auth_required: "再接続が必要",
    feature_disabled: "ローカル専用",
  }[state];
}
