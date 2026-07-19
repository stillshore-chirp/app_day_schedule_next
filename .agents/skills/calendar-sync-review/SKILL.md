---
name: calendar-sync-review
description: "Google OAuth、Google Calendar API、Outbox、差分同期、競合、削除、再発、オフライン、token失効をデータ損失なしでレビューする。同期領域の変更では必ず使う。"
---

# Calendar Sync Review Skill

## 1. 発動条件

- `google_oauth_*`, account / calendar selection、scope、token、keyring。
- Google Events API request / response、mapping、etag、base snapshot。
- initial / incremental sync、`nextSyncToken`、pagination、full resync。
- Outbox、retry、idempotency、conflict、delete、recurrence、attendees、reminders。
- sync status UI、offline、manual retry、disconnect。

## 2. 必読

1. `AGENTS.md`
2. `docs/product-invariants.md`
3. `docs/engineering/calendar-sync.md`
4. `docs/security-publication-checklist.md`
5. user-visible 変更なら UI/UX Skill
6. schema 変更なら data-migration Skill

## 3. 認証ゲート

- Desktop app client、system browser、Authorization Code、PKCE S256、random `state`、`127.0.0.1` random port を使う。
- loopback listener は必要最小期間だけ bind し、single-use session と timeout を持つ。
- callback の `state`、session、redirect port を検証する。
- refresh token は keyring、access token は memory 優先。SQLite / log / frontend DTO に出さない。
- scope は最小化し、接続前に用途を説明する。
- cancel、access_denied、invalid_grant、revocation、keyring failure を扱う。
- disconnect は local data、mapping、remote event、token revoke の各影響を明示する。

## 4. ローカル書き込み契約

- schedule transaction と Outbox enqueue を同じ SQLite transaction で確定する。
- UI は local save 完了と remote sync 完了を区別する。
- operation は stable idempotency key と local entity version を持つ。
- retry で create を重複させない。remote ID が不明な partial failure を回収できる設計にする。
- user edit を sync worker が lock や長い transaction で妨げない。

## 5. pull sync 契約

- calendar ごとに initial full sync と `nextSyncToken` を保持する。
- pagination 中は同じ query contract と同じ sync token を使う。
- token は最後の page の transaction commit 後にだけ更新する。
- deleted entry を処理する。
- 410 では対象 calendar の remote shadow / mapping state を再構築するが、local-owned data と pending Outbox を消さない。
- full resync 中に user edit が発生しても失われない。
- 取得範囲・timeMin を導入する場合は、sync token 制約と archive policy を文書化する。

## 6. push / merge 契約

- update / delete は current remote state と ETag を使い、必要に応じて `If-Match` を送る。
- 412 は remote 再取得後に 3-way merge をやり直す。
- base / local / remote の field ごとの差分を計算する。
- 同一 field の divergent edit、delete-vs-edit、recurrence master / exception を conflict とする。
- unknown remote field、attendees、conferenceData、reminders を意図せず破棄しない。
- conflict 解決結果を新しい base として保存し、未解決 conflict を sync 済みに見せない。

## 7. retry / rate limit

- 401、403、404、409、410、412、429、5xx、timeout、DNS、offline を分類する。
- transient error は capped exponential backoff + jitter。
- permanent error は無限 retry しない。
- manual retry が自動 retry と重複実行しない。
- retry count、next attempt、last error category を保存するが、response body や token を保存しない。
- app restart 後も Outbox を再開する。

## 8. recurrence / time

- Google event の start / end / all-day / timezone と local model の変換を round-trip test する。
- RFC 5545 rule、master、exception、cancelled instance、moved instance を扱う。
- local timezone 変更で remote instant を壊さない。
- floating template time を concrete Google event へ展開する境界を明示する。
- DST gap / ambiguity を calendar sync が黙って補正しない。

## 9. security / privacy

- log、telemetry、error、PR、fixture、screenshot に account email、calendar ID、event content、token を含めない。
- OAuth callback page は remote content を読み込まず、code を表示しない。
- frontend へ access token / raw Google response を渡さない。
- diagnostics export は counts、categories、timestamps の丸めを使う。

## 10. 必須テスト matrix

- OAuth success / cancel / state mismatch / timeout / port unavailable / token exchange failure / keyring failure。
- initial sync 1 page / multi page / page failure / resume policy。
- incremental create / update / delete / empty。
- 410 full resync、412 remerge、429 / 5xx backoff、offline / online。
- local create partial failure、idempotent retry、app restart。
- local / remote disjoint merge、same-field conflict、delete conflict。
- recurring master / exception / all-day / cross-midnight / timezone / DST。
- disconnect / re-auth / calendar access removed。
- two sync workers or manual + auto concurrency。

## 11. review output

- Data-flow diagram or textual sequence。
- Invariant impact。
- Failure matrix。
- Test evidence。
- Security redaction evidence。
- User-visible state evidence。
- P0 / P1 / P2、未実行、残リスク。

データ損失、silent overwrite、duplicate create、token exposure の可能性が残る場合は P0 です。
