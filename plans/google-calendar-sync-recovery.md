# Google Calendar 同期復旧 実装計画

## メタデータ

- Issue: #14
- Branch: `codex/google-recurrence-sync`
- Owner: Codex
- Status: in-progress
- Updated: 2026-07-26

## 目標

- OAuth 接続後の初回同期で、読み取り可能な選択カレンダーの予定をローカルへ安全に取り込み、Day Schedule Next の Today / Week / Month / List に表示する。
- calendar ごとの initial full sync と incremental sync を同一 query contract で実行し、最後の page と local transaction の commit 後にだけ `nextSyncToken` を更新する。
- 一つの calendar の失敗で、他の読み取り可能な calendar の同期済みデータを失わず、全体を誤って「同期済み」と表示しない。
- Google の recurrence master、moved exception、cancelled exception をローカルの master、`recurrence_series_id`、`recurrence_original_start_utc`、EXDATE と対応させる。
- Google が返す `RRULE` / `RDATE` / `EXDATE` / legacy `EXRULE` を再発集合として保持・展開し、標準的な再発形式を理由に calendar 全体を停止しない。

## 非対象

- Outlook、iCloud、CalDAV、独自クラウド、複数 Google account。
- `timeMin` / `timeMax` による同期範囲制限。archive policy を別途定義せず導入しない。
- Google API の event 本文、account、calendar ID、event ID を fixture、ログ、Issue、PR、スクリーンショットへ転記すること。
- `singleEvents=true` による無制限な occurrence 展開。

## 完了条件

- [x] `events.list` は `showDeleted=true`、`singleEvents=false`、`maxResults=250` を初回・差分・全 page で固定し、差分時は同じ `syncToken` を全 page に付ける。
- [x] Google 公式の既定 response を使い、未検証の partial-response selector を実アカウントへ持ち込まない。
- [x] `nextPageToken` がある page では token を保存せず、最後の `nextSyncToken` と全 event 適用を calendar 単位の一 transaction で確定する。
- [x] `410` は対象 calendar だけ full sync し、local-owned item、pending Outbox、競合を失わない。
- [x] `401`、`403`、`404`、`410`、`429`、`5xx`、timeout / DNS、validation を分類し、calendar 単位の状態と安全な category を保存する。
- [x] `freeBusyReader` は event 本文を読めないため同期対象にせず、owner / writer / reader calendar の部分成功を許す。
- [x] calendar timezone を event の IANA timezone fallback とし、all-day は inclusive start / exclusive end の date range を保持する。
- [x] recurrence master、moved exception、cancelled exception、exception reset、series deletion を fixture で固定する。
- [x] `RRULE` / `RDATE` / `EXDATE` / legacy `EXRULE` と、序数付き `BYDAY` / `BYSETPOS` / `WKST` を意味を変えずに取り込む。
- [x] 複数 inclusion / exclusion を含む recurrence set をローカル表示と Google round-trip の双方で保持する。
- [x] RFC上未定義、安全上限超過、固定長scheduleで表現不能な入力だけを calendar 単位で停止し、標準Google形式を `validation` にしない。
- [x] account summary は同期中、同期済み、再試行予定、認証必要、calendar unavailable、競合を区別し、初回完了前を同期済みにしない。
- [x] 初回 1 page / multi page / page failure、incremental create / update / delete / empty、410、部分失敗、再発例外、同時 worker のテストを通す。
- [ ] 実アカウント確認は synthetic / mock 契約と全ローカル gate 完了後、最新ビルドで一度だけ行う。

## 不変条件とリスク

- 関連する product invariant:
  - SQLite が local source of truth。
  - network request を DB transaction 中に待たない。
  - token は最後の page の transaction commit 後にだけ更新する。
  - remote delete、410、recurrence master / exception / cancellation を安全に処理する。
  - attendees、conferenceData、reminders、unknown field を意図せず破棄しない。
- データ損失リスク:
  - full sync の missing reconciliation が exception reset と series deletion を混同すると、予定が消失または重複する。
  - calendar 部分失敗を account success と扱うと、未取得 event を同期済みに見せる。
- 同期 / 時刻 / OS 差分:
  - all-day、event timezone fallback、DST gap / overlap、recurrence original start の解釈を fixture で固定する。
  - keyring は macOS / Windows adapter のまま変更せず、実機では秘密値を出力しない。
- 秘密・個人データ:
  - token / client secret / raw response は SQLite、frontend DTO、ログ、診断へ保存しない。
  - calendar の error state は allowlist category と timestamp だけを保存する。

## 公式 API 契約

| 領域 | 固定する契約 |
|---|---|
| Initial sync | 全 resource を page 単位で取得し、最後の page だけが返す `nextSyncToken` を保存する |
| Incremental sync | previous `syncToken` と同じ query parameter set を全 page で使い、deleted entry を含める |
| Pagination | `nextPageToken` がある限り継続し、page 間で query shape と sync token を変えない |
| 410 | 対象 calendar の remote shadow を full sync で再構築する |
| Event shape | timed は `dateTime`、all-day は `date`。start / end は同じ種別 |
| Recurrence | master の `RRULE` / `RDATE` / `EXDATE` / legacy `EXRULE` を一つの集合として扱い、exception の `recurringEventId` と `originalStartTime`、cancelled status を別契約として扱う |
| Access role | `freeBusyReader` は free/busy のみ。event sync は reader 以上 |
| Page size | Calendar API の既定値と同じ 250。最大値 2500 を初回同期で使わない |

参照:

- <https://developers.google.com/workspace/calendar/api/guides/sync>
- <https://developers.google.com/workspace/calendar/api/v3/reference/events/list>
- <https://developers.google.com/workspace/calendar/api/v3/reference/events>
- <https://developers.google.com/workspace/calendar/api/concepts/events-calendars>
- <https://developers.google.com/workspace/calendar/api/v3/reference/calendarList>

## calendar 同期状態

| Current | Trigger | Next | Token / local data |
|---|---|---|---|
| never | selected sync start | syncing | token と既存 local data を保持 |
| synced / retry_scheduled / unavailable | sync start | syncing | old token を保持 |
| syncing | final page + transaction commit | synced | new token と event / mapping を同時確定 |
| syncing | timeout / 429 / 5xx | retry_scheduled | old token と local data を保持 |
| syncing | 403 / 404 / validation | unavailable | old token と local data を保持 |
| syncing | 401 / invalid refresh | auth_required | old token と local data を保持 |
| syncing | 410 | syncing (full) | stale token を commit せず full sync |
| syncing | cancellation | previous stable state | transaction 未確定分と new token を破棄 |

## recurrence mapping

| Google resource | Local representation |
|---|---|
| master | primary RRULE、supplemental recurrence lines、EXDATE を持つ schedule + master event mapping |
| moved / edited exception | master EXDATE + linked non-recurring schedule + exception event mapping |
| cancelled exception | master EXDATE。既存 linked exception があれば soft delete |
| exception reset / full-sync missing exception | linked exception を soft deleteし、master EXDATE から original start を除去 |
| deleted master | master と linked exception を削除競合規則に従って処理 |

## 実装 slice

| Priority | Slice | Expected result | Verification | Status |
|---:|---|---|---|---|
| P0 | 契約 fixture と request assertion | 実装前に query / page / token / recurrence 契約が失敗テストとして固定される | targeted Rust tests | completed |
| P0 | calendar sync state migration | calendar 部分成功・失敗・retry が restart 後も真実になる | fresh / v11→v12 migration、constraint test | completed |
| P0 | pull adapter | initial / incremental / 410 / partial failure が calendar 単位で安全に確定する | mock HTTP matrix | completed |
| P0 | recurrence import | master / moved / cancelled / reset が重複せず表示される | recurrence + timezone fixtures | completed |
| P1 | UI state / copy | calendar ごとの状態と回復手段が分かる | component / a11y / native keyboard smoke | completed |
| P1 | 文書と反証レビュー | invariant、state matrix、未対応を追跡できる | docs / security / counter-review | completed |
| P1 | 実機確認 | Google予定がアプリに表示され、token と mapping が確定する | private count-only DB evidence + native UI | completed |
| P0 | recurrence set regression | RDATE / EXRULE / additional RRULE / ordinal BYDAY / BYSETPOS / WKST がcalendar停止せず展開される | domain + Google adapter fixture | completed |
| P0 | recurrence set storage migration | 既存RRULE / EXDATEを保持したままsupplemental lineを追加し、fresh / v12 upgradeが原子的に成功する | fresh / previous migration / 50,000-row fixture | completed |
| P0 | recurrence round-trip | remote recurrence setをlocal editなしでGoogleへ戻しても要素が欠落しない | pull / push fixture | completed |
| P1 | UI状態と証跡の訂正 | 標準形式を未対応扱いしない契約へstate matrixとcopy/evidenceを更新する | component / a11y / native state | completed |
| P1 | 実アカウント再検証 | 選択calendarがvalidation停止せず、token / mapping / active itemが非0になる | private count-only evidence | pending |

## 再開情報

- Current state: Google公式recurrence lineをRFC recurrence setとして保持・表示し、表現不能入力だけを安全停止する自動・native契約はPass。実アカウントcount-only再確認は未実施。
- Last completed slice: v13 migration、recurrence set parser、round-trip、read-only explanation、通常 / 200% native証跡を完了した。
- Next smallest action: 最新通常buildで実アカウントを一度同期し、calendar state / token / mapping / active mapped itemの件数だけを確認する。
- Blocking fact: 通常profileのGoogle接続件数が0。古い検証コピーのcredential参照もOS秘密ストア段階で再試行となるため、実アカウント証跡にはGoogle再接続が必要。
- Resume command: `cargo test --workspace --all-features domain::recurrence::tests infrastructure::google::tests`

## 最小スモーク

```bash
node scripts/verify-agent-harness.mjs
```

## 検証記録

| Command / check | Result | Evidence |
|---|---|---|
| Google公式 incremental sync / events / CalendarList 仕様確認 | Pass | 本計画の公式 API 契約 |
| current code / migration / recurrence schema audit | Pass | master / exception linkage と不足テストを特定 |
| 実機試行停止 | Pass | 検証用 app と SecurityAgent が終了 |
| `cargo fmt` / clippy / `cargo test --workspace --all-features` | Pass | Rust 107 + provision binary 1 |
| frontend format / lint / typecheck / test / a11y / build | Pass | 70 / 7、production build |
| recurrence v13 migration performance | Pass | synthetic 50,000 rows、30秒budget内 |
| synthetic native E2E | Pass | E2E専用SQLx fixtureへ統一し、Compact windowをWDIO公式label APIだけで往復後、全3 spec / 14 testとGoogle関連2 testの独立実行がPass |
| native fixture portability | Pass | OS付属`sqlite3` CLIを廃止。production buildへ登録されないE2E feature限定commandで同じapp DB adapterを使用 |
| native window isolation | Pass | WDIO公式label APIでmainへ戻った後、E2E feature限定commandでcompactを閉じる。E2E configだけcompactへWDIO権限を付与し、後続のrecurrence / notification / short-scheduleを同一full runで完走 |
| normal macOS debug DMG | Pass | aarch64 debug app / DMG bundle |
| `rrule` dependency audit | Pass | 0.14、MIT OR Apache-2.0、既存のchrono / chrono-tz / regex / log / thiserrorのみ、parser入力にhard limit |
| Issue #14 visual baseline review | Pass | normalは独立CI actualがbyte一致。200%は最新CI actualで文字拡大とsynthetic状態を目視確認し、誤って100%だったbaselineを置換 |
| personal debug DMG / count-only sync / List UI | Fail | 一部eventは表示されたが、選択calendarが標準recurrenceを`validation`扱いして停止したため完了証跡にならない |
| latest personal count-only revalidation | Blocked | 通常profileは接続0件。古い検証コピーはcredential取得段階で再試行となり、event取得へ進めない。実DB・元backupは変更せず、一時コピーを削除 |
| PR CI / dependency audit | Pass | recurrence fixture portability変更後のrun `30201348234` / `30201348235` |
| all-platform native / installer | In progress | run `30201938793`はmacOS arm64 / WindowsがE2E・installerまでPass。macOS x64はcompactを閉じる際にWDIO label状態とraw handle操作を混在させ、以降のwindowを失って製品assertion到達前に失敗。公式label APIとE2E限定closeへ統一し、local full runで検証済み。最新headで再実行する |
| PR review state | Pending | 最新headのCI成功後にconversation / review submission / review threadを再確認する |

## 未実行と残リスク

- 実Google OAuth / keyringの対話確認はmacOS arm64のみ。macOS x64 / Windowsの実account接続は未確認だが、各target OSでsynthetic native E2Eと通常installer buildを通した。
- 生成したunsigned installerからのinstall / launch / OS permission操作は未確認。個人利用のdebug artifactであり、署名・notarizationは本Issueの対象外。
- 標準recurrenceでcalendar全体が`validation`停止する既知P0はsynthetic / mock / native契約上は修正済み。実アカウントの再接続後にcount-onlyでtoken / mapping / active itemが非0になる確認は未実施。
