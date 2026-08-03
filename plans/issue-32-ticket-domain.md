# Issue 32 チケット基盤 実装計画

## メタデータ

- Issue: #32
- Branch: `codex/issue-32-ticket-domain`
- Owner: Codex
- Status: in-progress
- Updated: 2026-08-03

## 目標

- Kanban型チケット管理のローカル正本となる pure domain、SQLite schema、application use case、versioned IPC contract を実装する。
- Ticket本体、tag、checklist、履歴を単一transactionで確定し、後続のScheduleリンク、Focus集計、Google Tasks同期が安全に拡張できる基盤を作る。

## 非対象

- Kanban画面、Scheduleリンク、Focus帰属、Google Tasks API、任意列編集。

## 完了条件

- [x] fresh / v13 upgradeで既定boardと6列が一度だけ作成される。
- [x] CRUD、移動、並べ替え、親子、完了復帰、archive、tombstone、tag、checklist、履歴がrepository / application / IPC経由で成立する。
- [x] optimistic version、循環参照、validation境界、500件reorder、transaction rollbackを自動テストで固定する。
- [x] backup / restore、既存JSON互換、データ全削除、公開安全性を確認する。

## 不変条件とリスク

- 関連する product invariant: SQLite一次データ、Rust infrastructureだけがSQLを実行、stable UUID、optimistic version、soft deleteと履歴の整合。
- データ損失リスク: 関連表の部分更新、Done復帰列の欠落、parent循環、古いversionの上書き、restore後のticket table未検証。
- 同期 / 時刻 / OS 差分: dueはdate-only。Google Tasks Outboxは後続Issueで追加し、既存Calendar schemaとworkerを変更しない。
- 秘密・個人データ: fixtureはsyntheticのみ。診断・公開証跡へtitle、description、内部ID実値を出さない。

## 実装 slice

| Priority | Slice | Expected result | Verification | Status |
|---:|---|---|---|---|
| P0 | pure domainと境界test | validation、Done復帰、tag/checklist、sort規則がside-effectなしで固定される | targeted Rust tests | completed |
| P0 | v14 migration | schema、制約、index、既定board/6列、v13 upgradeが安全 | migration / FK / seed tests | completed |
| P0 | repository / application | CRUD・移動・親子・履歴が原子的かつversion安全 | repository integration tests | completed |
| P0 | typed IPC | Rust / TypeScript / memory clientが同じversioned DTOを検証 | contract tests | completed |
| P1 | backup / export / delete | backup round-trip、既存export互換、全削除がTicketを取りこぼさない | backup / transfer tests | completed |
| P1 | 文書と反証レビュー | schema、recovery、非対象、残リスクが追跡可能 | docs / security gates | completed |

## 再開情報

- Current state: 実装とlocal gate完了。commit / push / PR / CI / review待ち。
- Last completed slice: native IPC smokeとDMG debug bundle。
- Next smallest action: 差分をcommitし、非Draft PRを作成する。
- Blocking fact: なし。
- Resume command: `cargo test --workspace --all-features ticket`

## 最小スモーク

```bash
node scripts/verify-agent-harness.mjs
```

## 検証記録

| Command / check | Result | Evidence |
|---|---|---|
| `node scripts/verify-agent-harness.mjs` | Pass | 81 required files / 5 skills |
| frontend unit / coverage | Pass | 16 files / 99 tests、coverage 89.48% statements |
| frontend a11y | Pass | 3 files / 7 tests |
| Rust all features | Pass | 120 lib + 1 provisioning test、Google localhost mockを許可付きで実行 |
| clippy / format / lint / typecheck | Pass | warnings 0 |
| docs / security / boundaries | Pass | 140 links、244 text files、47 frontend / 31 Rust files |
| production frontend / Tauri debug bundle | Pass | production Vite build、macOS arm64 debug DMG生成 |
| native IPC smoke | Pass | native-smoke 14/14、schema v14 boot / SQLite persistence |
| isolated sidebar native spec | Pass | 2/2。全spec連続実行では前specのWebView状態により初回1件のみ失敗 |

## 未実行と残リスク

- Windows build / install / launch、実スクリーンリーダー、disk-full実注入は未実行。
- 全native spec連続実行はsidebar幅1件が共有WebView状態で失敗したが、対象spec単独の新規一時DBでは2/2成功。今回未変更のUI test isolationリスクとしてPRへ記載する。
- CI、Codex review、未解決review thread確認はPR作成後に実行する。
