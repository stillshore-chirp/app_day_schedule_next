# Google Calendar Sync Contract

## 1. Architecture

```text
UI edit
  -> typed Tauri command
  -> SQLite transaction
       schedule_items
       change_history
       sync_outbox
  -> immediate UI success (local saved)
  -> background sync worker
       refresh token from OS keyring
       fetch remote state
       3-way merge
       conditional remote write
       mapping/base update
  -> UI sync status
```

network request を DB write transaction 中に待ちません。

## 2. OAuth

- Google Cloud Desktop app client IDを`DAY_SCHEDULE_GOOGLE_OAUTH_CLIENT_ID`からcompile-time設定し、通常利用者へOAuth JSONを要求しない。
- installed appはsecretを秘匿できないため、標準経路はclient secretをbundleしない。追跡外の初回provisioningからOS keyringへ登録し、Google公式authorization/token endpointへのtoken交換と更新時だけRust adapterが読む。
- 既存のDesktop OAuth JSON設定は開発者向けoverrideとして維持し、保存済み設定をbuild設定より優先する。
- system browser。
- Authorization Code + PKCE S256。
- random high-entropy `state`。
- `127.0.0.1` random port listener。
- callback session は single-use + timeout。
- refresh token は OS keyring。
- access token / authorization code / verifier を永続ログへ出さない。
- re-authは既存account IDとcredential keyを再利用し、calendar、mapping、`nextSyncToken`を削除しない。

## 3. Local model

- `google_accounts`: non-secret metadata only。
- `google_calendars`: remote ID の暗号化要否を privacy review。role、timezone、selected、sync state。
- `sync_mappings`: local ID、remote event ID、ETag、base snapshot、remote updated time。
- `sync_outbox`: operation、entity/version、idempotency key、attempt、next attempt、error category。
- `sync_conflicts`: base / local / remote snapshot、field set、resolution。

## 4. Initial / incremental sync

- `events.list` は initial / incremental / pagination の全 request で `showDeleted=true`、`singleEvents=false`、`maxResults=250` を固定する。Google公式の既定responseを使い、未検証のpartial-response selectorを送らない。
- initial full sync の最後の page で `nextSyncToken` を取得する。
- page processing と new token 保存は一つの local transaction へまとめる。
- incremental は同じ query shape と previous token を使う。
- deleted events を含めて処理する。
- 410 は対象 calendar の remote shadow と token を再構築する。full sync の全ページに現れなかった既存 mapping は remote deletion として同じ transaction で照合し、未送信ローカル変更があれば削除競合として保持する。
- full resync が local entity / pending Outbox を削除しない。
- network requestはtransaction外で完了させ、page群をmemoryへstageした後、event適用・missing照合・token更新をcalendar単位の単一transactionで確定する。

### 4.1 Calendar state

`google_calendars`は`sync_state`、試行／完了時刻、次回再試行、allowlist error categoryを保持する。token、remote payload、予定本文は状態列へ保存しない。

| Result | Calendar state | Token / local data | Batch behavior |
|---|---|---|---|
| final page + transaction commit | `synced` | new tokenとeventを同時確定 | 継続 |
| timeout / DNS / 429 / 5xx | `retry_scheduled` | previous tokenとlocal dataを保持 | 他calendarを継続 |
| 403 / 404 / invalid or unrepresentable event | `unavailable` | previous tokenとlocal dataを保持 | 他calendarを継続 |
| 401 / invalid refresh | `auth_required` | 全calendarのtokenとlocal dataを保持 | account batchを中止 |
| cancellation / database failure | previous stable state | 未commit変更を破棄 | batchを中止 |

`freeBusyReader`はevent本文を読めないため選択不可とし、`reader`以上だけをpull対象にする。account summaryは一つでも`unavailable`なら「確認が必要」、一時失敗なら「再試行予定」とし、初回pull完了前を「同期済み」と表示しない。

### 4.2 Recurrence import

- master eventをexceptionより先に適用する。API response順には依存しない。
- moved / edited exceptionは`recurringEventId`でmaster mappingを解決し、`originalStartTime`をmaster EXDATEへ追加する。exceptionは`recurrence_series_id`と`recurrence_original_start_utc`を持つ非再発scheduleとして保存する。
- cancelled exceptionはmaster EXDATEだけを追加し、既存linked exceptionがあればsoft deleteする。
- full syncで既存exception resourceが欠落した場合は、linked exceptionをsoft deleteし、master EXDATEから元の開始instantを除去する。
- deleted masterは未送信local exceptionがないことを確認してlinked remote exceptionもsoft deleteする。未送信変更があればtokenを更新せず競合として停止する。
- eventにtimezoneがない場合はcalendar timezoneをfallbackにする。`EXDATE;TZID=...`と`EXDATE;VALUE=DATE`をIANA timezoneで解釈し、DST gap / ambiguityを黙って補正しない。
- primary `RRULE`、追加`RRULE`、`RDATE`、`EXDATE`、legacy `EXRULE`を一つのrecurrence setとして取り込む。序数付き`BYDAY`、`BYSETPOS`、`WKST`、負の`BYMONTHDAY`を含むRFC 5545 rule partを手書きの部分parserで制限しない。
- primary `RRULE`以外のinclusion / exclusion lineは順序に依存しない補助集合としてSQLiteへ保存し、Googleへ戻す際も欠落させない。`EXDATE`は比較可能なUTC instantへ正規化する。
- 追加rule / dateを持つGoogle masterは表示・pull・incremental token更新を継続するが、系列編集による意味の破壊を避けるためlocal UIでは読み取り専用にする。
- 補助lineは64件、1件2,000文字、`EXDATE`は10,000件を上限とする。許可外property、壊れたRFC入力、`RDATE;VALUE=PERIOD`など固定長scheduleで表現できない入力だけを`unavailable / validation`にし、page適用とnew tokenをcommitしない。

## 5. Push

- create は app-generated idempotency / mapping recovery を考慮する。
- update / delete は ETag / current remote state を使う。
- 412 は remote refetch + remerge。
- remote success と local mapping update の間で crash した場合の recovery を設計する。

## 6. Merge

field group 例:

- time / all-day / timezone。
- title / description / location。
- recurrence / exceptions。
- reminders。
- status / deletion。
- attendees / conference metadata。

base から local だけ変更、remote だけ変更は自動 merge。両方が同じ field を異なる値へ変更、delete-vs-edit、series scope mismatch は conflict。

## 7. Retry

| Category | Policy |
|---|---|
| offline / timeout / DNS | backoff + connectivity trigger |
| 401 / invalid token | one refresh, then re-auth required |
| 403 scope / access removed | permanent until user action |
| 404 remote missing | deletion / recreation policy based on ownership |
| 409 | operation-specific retry / duplicate recovery |
| 410 sync token | full sync |
| 412 | refetch + merge |
| 429 / 5xx | capped exponential backoff + jitter |
| validation | permanent, surface field error |

## 8. UI states

- Local saved / Sync pending / Syncing / Synced / Offline / Retry scheduled / Conflict / Auth required / Calendar unavailable。
- status は item と account / calendar summary の両方で scope を示す。
- manual retry は duplicate worker を作らない。
- conflict resolution は local / Google / field-by-field の影響を示す。
- manual sync は operation ID に紐づく cancel token を持つ。取消要求は page fetch 前後、Outbox item 間、pull transaction commit 前で検査する。remote write 完了後の取消では確定済み結果を保持し、未完了 Outbox を決定的 event ID で再試行する。
- Undo / Redo は同一 transaction 内で過去版の未完了 Outbox を `superseded` として完了し、復元した entity に単調増加する version を与えて create / update / delete の補償操作を積み直す。
- Google disconnect は account / mapping の削除前に未完了 Outbox を `disconnected` として完了し、その対象 entity を `local_only` へ戻す。別アカウントや別カレンダーへの再接続で古い操作を暗黙に転送しない。
- Google disconnect は OS 秘密ストアの credential 削除が成功してから account / mapping を transaction で削除する。credential 削除に失敗した場合は接続 metadata、mapping、未完了 Outbox、ローカル予定を変更せず、再試行できる状態を保つ。

## 9. Tests

`.agents/skills/calendar-sync-review/SKILL.md` の matrix を必須とします。

最低fixtureはinitial 1 page / multi page、incremental create / update / delete、page failure、410、401、403、404、429、5xx、offline、同時worker、master、moved exception、cancelled exception、exception reset、series deletion、timezone fallback、複数RRULE、RDATE、EXDATE、EXRULE、ordinal BYDAY、BYSETPOS、WKST、invalid / unrepresentable recurrenceを含めます。
