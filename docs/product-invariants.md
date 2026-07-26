# Product Invariants

この文書は Day Schedule Next の実装が常に守る製品・データ・同期・時間・通知の不変条件です。要件追加やリファクタリングで解釈を変える場合は、設計 Issue、migration / compatibility 方針、テスト更新を同じ変更に含めます。

## 1. 製品目的

対象は、自分一人の一日を分単位で設計し、計画と実行状況を素早く把握したいユーザーです。

主要 Job:

- 一日の予定を全体像と詳細の両方で確認する。
- 予定を短い操作で作成、移動、リサイズ、分類、再利用する。
- 現在、経過、残り、次、空き、アラームを継続的に把握する。
- Google Calendar と接続しても、オフラインで計画を失わない。
- Focus / Pomodoro を予定と同じ文脈で利用する。

## 2. 対象範囲

- Today / Week / Month / List / Template views。
- 24時間 overview と分精度 detail timeline。
- 予定 CRUD、日跨ぎ、重複、drag、resize、direct edit、keyboard equivalent、Undo / Redo。
- project、category、tag、priority、status、memo、estimate / actual、saved filter。
- 日次 template、weekday template、Quick Block。
- current / next / remaining / free time、Compact Window、always-on-top。
- free alarm、schedule start/end notification、複数 timer、stopwatch、Focus / Pomodoro。
- Google Calendar 1 account / multiple calendars、双方向差分同期、競合解決。
- backup / restore、legacy Python app DB import、diagnostics。
- macOS / Windows desktop distribution。

## 3. 明示的な対象外

- team / organization / multi-user。
- custom cloud backend / web sync。
- billing / ads / analytics / telemetry。
- mobile / web client。
- Outlook / iCloud / CalDAV。
- AI auto scheduling。

対象外を実装するには、新しい Issue と threat / privacy / architecture review が必要です。

## 4. UI・操作

- 保存精度は 1 分。
- display grid / drag snap は 1 / 5 / 10 / 15 / 30 分等から選べるが、保存値を丸めない。
- pointer drag の開始閾値を設け、drag 中は ghost / time preview を出す。
- move は所要時間を保持する。resize は開始または終了を変更する。
- `Esc` で interaction を取消し、commit 後は Undo できる。
- pointer drag の全機能に keyboard または direct input の等価手段を持つ。
- current-time line、selection、conflict、sync、category を色だけで表さない。
- overview と detail は同じ entity を異なる密度で表す。hidden data や inconsistent selection を作らない。
- window position / size は display 構成変更後も可視領域へ復元する。

## 5. 参照アプリ互換契約

参照アプリの技術・コード・画面をコピーせず、次の利用価値を新実装で包含します。

| ID | 互換価値 |
|---|---|
| RF-01 | 基準時刻を変更できる24時間タイムライン |
| RF-02 | 予定追加・編集・削除と個別色 |
| RF-03 | 複数の一日パターン。新実装では日次 template |
| RF-04 | 5分以上の重なりを認識する24時間 overview 表示 |
| RF-05 | tooltip / Inspector で予定詳細、進行中は経過・残り |
| RF-06 | drag 移動、誤操作閾値、preview、snap |
| RF-07 | 現在予定の進捗、複数同時進行 |
| RF-08 | 次の予定と開始までの残り |
| RF-09 | profile 非依存の instant schedule。新実装では Quick Block |
| RF-10 | free alarm の時刻・label・enable |
| RF-11 | 予定開始・終了 notification と重複抑止 |
| RF-12 | 25/5 Focus cycle、pause/resume、自動次 cycle |
| RF-13 | DB の安全な診断 viewer / export |
| RF-14 | window position 記憶 |
| RF-15 | always-on-top |
| RF-16 | cross-midnight schedule |
| RF-17 | current date/time display |
| RF-18 | free time / unallocated time の視覚化 |
| RF-19 | SQLite persistence |
| RF-20 | 一日 pattern の最大24時間制約 |

## 6. 時間モデル

### 6.1 具体予定

- `start_instant_utc` と `end_instant_utc`。
- `timezone_id` は IANA timezone。
- local date/time は表示・入力・recurrence interpretation に使う。
- interval は `[start, end)`。
- duration は 1 分以上。24時間超の具体予定を許すかは要件で制約し、template block の24時間制約と混同しない。

### 6.2 Template / Quick Block

- `start_minute_of_day`: 0..1439。
- `duration_minutes`: 1..1440。
- timezone / target date へ適用する時に concrete instant へ変換する。
- `start == end` の暗黙24時間表現を使わない。

### 6.3 DST / timezone

- 存在しない local time は silent shift しない。
- ambiguous local time は offset choice を保持する。
- timezone change で instant を維持する entity と wall-clock intent を維持する entity を区別する。
- all-day event は date range として扱う。

### 6.4 Timer / Stopwatch

- timer は1秒〜7日の設定時間、任意ラベル、独立した実行状態を持つ。最大500件とする。
- timer set はラベルと設定時間だけを保存し、実行状態や残り時間を保存しない。適用は既存 timer を置換せず、停止状態で追加する。
- stopwatch は端末ごとに1件の状態を持つ。
- process 内の経過計測は monotonic clock、再起動後の最初の復旧だけは永続化した UTC timestamp を使う。wall clock の逆行で、起動中の経過時間を減らさない。

## 7. 重なり

- 基本判定は positive overlap。接する `[a,b)` と `[b,c)` は重ならない。
- detail timeline は同時進行を side-by-side lane で表示し、全予定へ到達できる。
- 24時間 overview は参照互換として、同一日の分割区間を含む重なり合計が5分以上の予定を同一 component として扱える。
- cross-midnight は day segment に分割して判定するが、entity identity は一つ。
- layout algorithm は deterministic とし、同一入力で lane が揺れない。

## 8. SQLite

- SQLite が local source of truth。
- Rust infrastructure だけが SQL を実行する。
- foreign keys、WAL、busy timeout、schema migration を有効化する。
- write use case は transaction boundary を明示する。
- user write と sync Outbox enqueue は同一 transaction。
- entity は stable UUID と optimistic version を持つ。
- soft delete、change history、sync mapping の lifecycle を整合させる。
- token / secret / raw auth response は保存しない。

## 9. Google OAuth

- Desktop app client IDはgit追跡外のbuild設定から埋め込み、通常利用者へOAuth JSONを要求しない。
- installed appはsecretを秘匿できないため、標準経路にclient secretをbundleしない。
- Google token endpointが要求するDesktop client secretは、追跡外の初回provisioningからOS keyringへ登録し、client IDとの一致を確認してRust adapterだけが使用する。
- 保存済みDesktop OAuth JSON設定は開発者向け互換経路としてbuild設定より優先する。
- system browser + Authorization Code + PKCE S256。
- random `state` と `127.0.0.1` random port loopback listener。
- listener は single-use、timeout、state validation。
- refresh token は OS keyring。access token は memory 優先。
- scope は最小化し、同意前に用途を説明する。
- reconnect / revoke / disconnect の data impact を UI に示す。
- reconnectは既存account、calendar、sync mapping、差分同期tokenを保持し、認証情報だけを安全に更新する。

## 10. Google Calendar sync

- local-first: network failure で local edit を拒否しない。
- Outbox operation は idempotency key、entity version、retry state を持つ。
- calendar ごとに initial full sync と `nextSyncToken` を保持する。
- initial / incremental / paginationは`showDeleted=true`、`singleEvents=false`、同一page sizeとquery shapeを使い、未検証のpartial-response selectorを実アカウントへ送らない。
- pagination 完了と local transaction commit 後にだけ new sync token を保存する。
- deleted remote entries を処理する。
- 410 は対象 calendar の remote shadow を full resync する。local-owned item と pending Outbox を消さない。
- 412 は remote 再取得後に 3-way merge。
- 429 / 5xx は capped exponential backoff + jitter。
- base / local / remote の同一 field divergent change と delete-vs-edit を conflict とする。
- conflict は明示解決まで sync complete と表示しない。
- attendees、conferenceData、reminders、unknown field を意図せず破棄しない。
- recurrence master / exception / cancellation を round-trip する。
- moved exceptionはmaster EXDATEとlinked exception、cancelled exceptionはmaster EXDATE、full-sync missing exceptionはEXDATE解除として表現し、deleted masterのlinked exceptionを孤立させない。
- calendar timezoneをevent timezone欠落時のfallbackにし、`TZID` / all-day exceptionをIANA timezoneで解釈する。未対応recurrence要素は黙って破棄せずprevious tokenを保持する。
- 403 / 404 / validation / 429 / 5xxはcalendar単位で状態を保存し、他の読み取り可能なcalendarを継続する。401 / invalid refreshだけをaccount-wide re-authとする。
- `freeBusyReader` calendarはevent本文同期の対象にしない。
- 手動取消は operation ID ごとに分離し、pagination / Outbox item / local transaction の安全な境界で停止する。確定済み remote write は戻さず、未完了 Outbox と決定的 remote event ID により再試行を冪等にする。
- Undo / Redo は古い entity version の未完了 Outbox を同一 transaction で無効化し、復元版へ単調増加する version と補償 Outbox を与える。
- Google disconnect は未完了 Outbox を無効化し、未送信 entity を `local_only` へ戻してから account / mapping を削除する。再接続先へ古い操作を暗黙に転送しない。

## 11. Notification / Focus

- notification rule と delivery ledger を分離する。
- delivery key は occurrence と phase を含み一意。
- timer callback、restart、resume で同一通知を重複送信しない。
- missed notification の grace window と最大件数を設定し、長時間 sleep 後に一斉送信しない。
- permission denied / OS muted / delivery failure を成功扱いしない。
- complete exit と tray residency の能力差を明示する。
- Focus state は `Idle / Working / Paused / Break / WaitingNext`。
- elapsed time は monotonic clock を基本にし、wall clock change で壊れない。
- timer completion は run ID ごとに永続化し、同じ run の再観測・再起動で delivery を重複生成しない。
- timer / stopwatch の状態は SQLite に保持するが、Google Calendar 同期対象にはしない。

## 12. Backup / restore / legacy import

- migration 前、手動、日次の backup policy を持つ。
- backup は hash、schema version、verification result を記録する。
- restore 前に現 DB を退避する。
- candidate を別 path で integrity check、migration、smoke query してから切り替える。
- restore 切替は既存 DB の上書き rename に依存せず、同一 directory の一時退避を経由する。中断時に active DB がなければ退避済み DB を次回起動時に回復する。
- import source は read-only。
- preview で counts、mapping、warnings、skips を表示する。
- import commit は single transaction。source を変更しない。
- export は一時ファイルへ書いて取消時に削除し、完成ファイルだけを公開する。
- backup は取消後に未検証ファイルを削除し、検証・履歴記録が完了した世代だけを一覧へ出す。

## 13. Security / privacy

- strict CSP、window / command 単位の Tauri capability。
- no remote script / CDN / general shell / general fs / frontend direct SQL / frontend direct Google HTTP。
- diagnostics は allowlist と redaction。
- telemetry は導入しない。
- public repo を前提に OAuth config、secret、personal data、local path を追跡しない。

## 14. 性能目標

正式な測定条件は実装 Issue で固定します。最低目標:

- local schedule edit の視覚反映: p95 100ms 以内。
- 500 予定の Today 表示で主要操作が継続可能。
- 50,000 schedule item の indexed list / search が実用範囲。
- sync / backup / export が UI thread を block せず、operation ID で取り消せる。
- timer / current-line update が過剰な CPU / screen-reader noise を生まない。

## 15. release blockers

- RF-01..RF-20 の重要シナリオ未確認。
- migration / backup / restore / import の破壊試験未通過。
- sync 410 / 412 / 429 / conflict / recurrence 未検証。
- keyboard / WCAG / visual regression に P0。
- capability / CSP / secret scan に重大問題。
- macOS / Windows build / install / launch 未確認。
- dummy、reachable TODO、panic、swallowed error、unconnected UI が残る。
- clean-room 違反または license 不明。
