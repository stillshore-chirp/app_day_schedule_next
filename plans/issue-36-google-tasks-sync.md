# 実装計画

## メタデータ

- Issue: #36 Google Tasks OAuth・API・部分双方向同期を実装する
- Branch: `codex/issue-36-google-tasks-sync`
- Owner: Codex
- Status: in-progress
- Updated: 2026-08-03

## 目標

- SQLite上のTicketを正本とし、Google Tasksが表現できるtitle / notes / due date / completed / parent / listだけを部分双方向同期する。
- Calendar接続済みユーザーのcredentialを失わず、Calendar + Tasks scopeの再同意とgranted scope検証を行う。
- polling + overlap watermark +定期full reconcile、Outbox、field単位3-way conflictでoffline/retry/競合から回復する。

## 非対象

- assigned task、Task List作成・rename・delete、Google recurring rule、reminder、webhook。
- priority / estimate / tags / Schedule / FocusをGoogle notesへ埋め込むこと。
- Google TasksをLocal Kanban列の正本にすること。

## 実装 slice

| Priority | Slice | Expected result | Verification | Status |
|---:|---|---|---|---|
| P0 | schema / domain | list・mapping・outbox・conflict・watermarkを分離保存 | migration/rollback/backup tests | in-progress |
| P0 | OAuth / Tasks adapter | 3 scope再同意、pagination、official endpoint限定 | mock OAuth/API matrix | pending |
| P0 | pull / push / conflict | 全page atomic、idempotent Outbox、field merge | integration matrix | pending |
| P0 | typed IPC / UI | Settings・Ticket・conflict・危険操作を明示 | Vitest/a11y/native E2E | pending |
| P1 | docs / diagnostics | redaction・運用・制約を実装と一致 | doc/security checks | pending |
| P0 | counter-review / delivery | Calendar回帰、CI/review、最終artifact | full gates/DMG/install smoke | pending |

## 不変条件とリスク

- Local Ticket write・history・Tasks Outboxは同一SQLite transaction。
- OAuth tokenはkeyringのみ。remote ID・本文・email・tokenを診断、log、PR、fixtureへ出さない。
- create timeoutはremote成功有無が不明なため自動再createせず、uncertain stateからfull reconcile / user recoveryする。
- pagination途中失敗ではwatermarkを進めない。full result不在だけでlocal-only Ticketを削除しない。
- Windows native OAuth/keyring/installerはmacOSから実行できないためCIと未実行リスクを分離する。

## 再開情報

- Current state: Issue、公式仕様、既存Calendar/OAuth/DB境界を調査しschema v17を開始。
- Last completed slice: #35 normal merge。
- Next smallest action: domain modelとTasks repositoryを追加。
- Blocking fact: なし。
- Resume command: `git status --short --branch && cargo test -p day-schedule-next google_tasks`
