---
name: calendar-sync-review
description: "Google OAuth、Calendar / Tasks、Outbox、差分同期、競合、削除、再発、オフライン、token失効をデータ損失なしでレビューする。同期領域の変更では必ず使う。"
---

# Calendar / Tasks Sync Review Skill

## 1. 発動条件

- OAuth、account / calendar / Task List、scope、token、keyring
- Calendar / Tasks request、response、mapping、ETag、base snapshot
- initial / incremental sync、watermark、`nextSyncToken`、pagination、full reconcile
- Outbox、retry、idempotency、conflict、delete、recurrence、attendees、reminders
- sync status、offline、manual retry、disconnect、同期結果が見えるUI

## 2. 必読の正本

- rootと変更対象に最も近い `AGENTS.md`
- [`docs/product-invariants.md`](../../../docs/product-invariants.md)
- [`docs/architecture-boundaries.md`](../../../docs/architecture-boundaries.md)
- [`docs/engineering/calendar-sync.md`](../../../docs/engineering/calendar-sync.md)
- [`docs/engineering/google-tasks-sync.md`](../../../docs/engineering/google-tasks-sync.md)
- [`SECURITY.md`](../../../SECURITY.md) と `docs/security-publication-checklist.md`
- schema変更なら [`data-migration-review`](../data-migration-review/SKILL.md)、time変更なら [`time-notification-review`](../time-notification-review/SKILL.md)、表示変更なら [`ui-ux-review`](../ui-ux-review/SKILL.md)

request / failure / recurrenceの網羅matrixはcalendar / Tasks engineering docを正本にし、ここへ複製しません。

## 3. 手順と必須境界

1. OAuth、local write、pull、push、merge、retry、disconnectのどこが変わるかを分類する。
2. UI edit→typed IPC→SQLite transaction→Outbox→worker→remote write→mapping/statusの流れを追う。
3. local-firstとしてnetwork failureでlocal editを拒否せず、local write・history・Outboxを同一transactionで確定し、networkをtransaction内で待たないことを確認する。
4. token / watermarkは全page処理とlocal commit後だけ進め、410でlocal-owned data / pending Outboxを消さないことを確認する。
5. ETag / current remote state、412再取得、field単位3-way merge、delete conflict、未知remote field保持を確認する。
6. retry分類、backoff、restart、manual/auto concurrency、uncertain createを確認する。
7. 必要なfixture・integration・UI state・redaction evidenceをengineering docのmatrixから選ぶ。

## 4. 停止条件と証跡

- local data loss、silent overwrite、duplicate create、token exposure、未解決conflictのsynced表示はP0。
- access token、refresh token、authorization code、remote payload、account・予定内容をSQLite、log、frontend DTO、fixture、screenshotへ出さない。
- data flow、invariant impact、対象matrix、実行結果、未実行範囲、残るrisk、UI stateを対象commitに結び付けて記録する。

未確認の実アカウントやOS挙動を、mock testの結果から推定して完了扱いしません。
