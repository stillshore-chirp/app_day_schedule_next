# Documentation Structure

## 1. 正本の責務

| 文書 | 責務 |
|---|---|
| `README.md` | GitHub の入口。概要、最短確認、主要文書リンク |
| `UserManual.md` | 一般ユーザー向けの現行操作、状態、権限、制約 |
| `AGENTS.md` | AI エージェントの実行順、blocker、Issue / PR / CI / 完了ゲート |
| `.agents/skills/` | 領域ごとの具体的なレビュー / 実行 workflow |
| `docs/product-invariants.md` | 製品・時間・同期・通知・データ保護の変更禁止条件 |
| `docs/architecture-boundaries.md` | React / command / application / domain / infrastructure の責務 |
| `docs/engineering/` | 時間、同期、通知、移行、配布の技術契約 |
| `docs/testing/index.md` | テスト種別、コマンド、fixture、成果物、platform matrix |
| `docs/release-quality-gates.md` | 出荷可否のゲート |
| `docs/ai-governance/` | UI/UX・証跡・反証レビューの詳細正本 |
| `OPERATIONS.md` | 障害、診断、復旧、同期、通知、installer の運用 |
| `SECURITY.md` | security report と実装 security policy |
| `plans/` | 長期タスクの一時的だが追跡可能な計画 |

## 2. README に書くこと

- 何のアプリか。
- 対応 OS と技術の短い説明。
- 最短 bootstrap / verify。
- 現在の実装状態。
- 詳細文書へのリンク。
- license。

詳細な OAuth、DB schema、sync algorithm、migration、release 手順を重複させません。

## 3. 更新判断

1. UI / copy / shortcut / permission: `UserManual.md`。
2. domain / IPC / dependency direction: `docs/architecture-boundaries.md`。
3. time / recurrence: `docs/engineering/time-and-recurrence.md` と product invariants。
4. Google sync / OAuth: `docs/engineering/calendar-sync.md` と security。
5. notification / Focus: `docs/engineering/notifications-and-focus.md`。
6. schema / migration / backup / import: `docs/engineering/data-migrations-and-backup.md`。
7. Tauri / installer / platform: `docs/engineering/desktop-platform-and-release.md` と operations。
8. test command / CI / artifact: `docs/testing/index.md`。
9. agent rules: `AGENTS.md`、governance maintenance、relevant Skill。

## 4. DRY

- 同じ仕様本文を複数文書へコピーしない。
- 正本を一つ決め、他は要約と link にする。
- historical decision が重要なら ADR を追加し、current contract と混ぜない。
- code identifier / command / path は実在確認する。

## 5. 公開安全性

文書、Issue、PR、screenshot、fixture は `docs/security-publication-checklist.md` に従います。secret、token、account、calendar / event content、local path、raw logs を残しません。
