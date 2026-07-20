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

- Google Cloud Desktop app client。
- system browser。
- Authorization Code + PKCE S256。
- random high-entropy `state`。
- `127.0.0.1` random port listener。
- callback session は single-use + timeout。
- refresh token は OS keyring。
- access token / authorization code / verifier を永続ログへ出さない。

## 3. Local model

- `google_accounts`: non-secret metadata only。
- `google_calendars`: remote ID の暗号化要否を privacy review。role、timezone、selected、sync state。
- `sync_mappings`: local ID、remote event ID、ETag、base snapshot、remote updated time。
- `sync_outbox`: operation、entity/version、idempotency key、attempt、next attempt、error category。
- `sync_conflicts`: base / local / remote snapshot、field set、resolution。

## 4. Initial / incremental sync

- initial full sync の最後の page で `nextSyncToken` を取得する。
- page processing と new token 保存は一つの local transaction へまとめる。
- incremental は同じ query shape と previous token を使う。
- deleted events を含めて処理する。
- 410 は対象 calendar の remote shadow と token を再構築する。
- full resync が local entity / pending Outbox を削除しない。

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

## 9. Tests

`.agents/skills/calendar-sync-review/SKILL.md` の matrix を必須とします。
