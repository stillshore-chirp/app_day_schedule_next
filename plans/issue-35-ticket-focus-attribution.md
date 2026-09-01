# 実装計画

## メタデータ

- Issue: #35 Focus実績をチケットへ帰属し、見積・予定・実績を集計する
- Branch: `codex/issue-35-ticket-focus-attribution`
- Owner: Codex
- Status: in-progress
- Updated: 2026-08-03

## 目標

- Focus開始時点の有効なSchedule→Ticket関連を不変スナップショットとして保存する。
- 既存Focus履歴のworking秒を正本に、見積・予定・実績・残り・差分を一括集計する。
- Board、Ticket詳細、Focus画面で帰属先と集計根拠を明示し、Ticket状態は暗黙に変更しない。

## 非対象

- 過去の未帰属Focusを後から手動帰属する操作。
- Ticketの自動In Progress化、Focus終了時の自動Done化。
- Google CalendarへFocus実績を同期すること。

## 完了条件

- [ ] linked / unlinked / relink / archive / delete / schedule delete後も開始時帰属が不変である。
- [ ] pause・breakを除外し、重複終了・sleep/resume・clock jumpで実績を二重加算しない。
- [ ] 500 Ticket / 50,000 Focus履歴をN+1なしで集計できる。
- [ ] Board・詳細・Focus文脈がkeyboard/a11yを含めて明確である。
- [ ] migration、backup/restore、JSON export/importの保持または明示的制約を検証する。

## 不変条件とリスク

- 関連する product invariant: SQLite local source of truth、Focus monotonic time、TicketとSchedule/状態の非連動。
- データ損失リスク: 帰属表にdurationを複製せず、focus history削除時のみcascadeする。既存履歴は未帰属のまま保持する。
- 同期 / 時刻 / OS 差分: Focus実績はlocal-only。内部は秒、UIは丸め分。macOS native E2EとWindows CIを分離報告する。
- 秘密・個人データ: 診断へTicket名・予定名・ID・履歴本文を出さない。

## 実装 slice

| Priority | Slice | Expected result | Verification | Status |
|---:|---|---|---|---|
| P0 | migrationと開始時帰属 | sessionと帰属snapshotが原子的 | Rust migration/repository tests | completed |
| P0 | 秒単位集計 | planned/actual/remaining/varianceを一括取得 | linked/unlinked/relink/performance tests | completed |
| P0 | typed IPCとUI | Board・詳細・Focusで帰属と指標を明示 | Vitest/a11y/native E2E | completed |
| P1 | data lifecycle/docs | backup/restore/export/importとMVP制約を明記 | transfer tests/doc checks | completed |
| P0 | 反証・配布証跡 | P0なし、CI/review、artifact検証 | full gates/DMG smoke | completed |

## 再開情報

- Current state: 実装、local full gates、対象native E2E、通常構成DMG検証まで成功。
- Last completed slice: UI/DB/backup/performance/native E2E/DMG検証。
- Next smallest action: final review、commit、push、PR、CI/review、normal merge。
- Blocking fact: なし。
- Resume command: `git status --short --branch && cargo test -p day-schedule-next ticket_focus`

## 最小スモーク

```bash
node scripts/validate-governance.mjs
```

## 検証記録

| Command / check | Result | Evidence |
|---|---|---|
| start gate | pass | clean main at #34 merge before branch creation |
| frontend | pass | 21 files / 118 tests、a11y 3 files / 7 tests |
| Rust | pass | workspace all-features 136 tests + provisioning 1 test |
| performance | pass | 500 Ticket / 50,000 Focus rows 0.31s |
| backup | pass | Ticket relation / Focus attribution / 600秒実績 round-trip |
| native E2E | pass | explicit related schedule -> attributed Focus -> stop/history |

## 未実行と残リスク

- Windows native install/launchはこのmacOS環境では実行不能。
- 最終Epic完了時に最新#36コミットのアプリ本体へ更新するため、#35単独では `/Applications` を置換しない。
