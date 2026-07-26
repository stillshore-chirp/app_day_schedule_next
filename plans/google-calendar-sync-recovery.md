# Google Calendar 同期復旧 実装計画

## メタデータ

- Issue: #14
- Branch: `codex/google-oauth-connect`
- Owner: Codex
- Status: in-progress
- Updated: 2026-07-26

## 目標

- OAuth 接続後の初回同期で、読み取り可能な選択カレンダーの予定をローカルへ安全に取り込み、Day Schedule Next の Today / Week / Month / List に表示する。
- calendar ごとの initial full sync と incremental sync を同一 query contract で実行し、最後の page と local transaction の commit 後にだけ `nextSyncToken` を更新する。
- 一つの calendar の失敗で、他の読み取り可能な calendar の同期済みデータを失わず、全体を誤って「同期済み」と表示しない。
- Google の recurrence master、moved exception、cancelled exception をローカルの master、`recurrence_series_id`、`recurrence_original_start_utc`、EXDATE と対応させる。

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
- [x] remote event の unsupported recurrence property を黙って捨てず、その calendar を「確認が必要」として token を更新しない。
- [x] account summary は同期中、同期済み、再試行予定、認証必要、calendar unavailable、競合を区別し、初回完了前を同期済みにしない。
- [x] 初回 1 page / multi page / page failure、incremental create / update / delete / empty、410、部分失敗、再発例外、同時 worker のテストを通す。
- [x] 実アカウント確認は synthetic / mock 契約と全ローカル gate 完了後、最新ビルドで一度だけ行う。

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
| Recurrence | master の `recurrence`、exception の `recurringEventId` と `originalStartTime`、cancelled status を別契約として扱う |
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
| master | recurrence rule を持つ schedule + master event mapping |
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

## 再開情報

- Current state: 公式契約、v12 migration、initial / incremental / partial failure、recurrence、UI回復状態を実装。mock / native / personal count-only gateを通過。
- Last completed slice: personal debug DMGでtoken / mapping / active mapped itemの非0とList表示を確認。
- Next smallest action: PR #15の最新headでplatform CI、dependency audit、code reviewを完了する。
- Blocking fact: なし。
- Resume command: `cargo test --workspace --all-features infrastructure::google::tests`

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
| `cargo test --workspace --all-features` | Pass | 94 + provision binary 1 |
| frontend test / a11y | Pass | 68 / 7 |
| synthetic native E2E | Pass | 13 |
| Issue #14 visual baseline review | Pass | 独立した2回のmacOS arm64 CI actualがbyte一致。synthetic dataと画面状態を目視確認してbaselineへ昇格 |
| personal debug DMG / count-only sync / List UI | Pass | token / mapping / active mapped item非0、List非empty |

## 未実行と残リスク

- 更新baselineとE2E isolation修正を含む最新headのmacOS arm64 / x64 / Windows x64 CI、installer build、reviewは未完了。
- 既存5 snapshotのlocal全体比較は、旧baselineと現端末の画素寸法差により未完了。Issue #14の2 snapshotは独立CI actualの一致と目視を確認済みで、全体比較は更新後headのmacOS arm64同一環境で確認する。
- 実機の一部calendarは未対応形式を含むため、そのcalendar単位で`validation`停止した。previous token / local dataを保持し、他calendarの同期とList表示は完了した。
