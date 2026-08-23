# Documentation Structure

この文書は、Day Schedule Nextの情報をどこに書くかを定義する正本です。READMEは入口に保ち、利用者向け操作、技術契約、運用、agent ruleを分離します。

## 1. 正本の責務

| 文書 | 責務 |
|---|---|
| `README.md` | GitHub訪問者向け入口。概要、最短bootstrap、主要文書link |
| `UserManual.md` | 一般ユーザー向けの現行操作、状態、権限、制約 |
| root `AGENTS.md` | Codex・Claude Code・Cursorが常時共有する短い作業契約 |
| nested `AGENTS.md` | frontend、Rust / Tauri、native E2E、docs、GitHub automationのpath固有契約 |
| `docs/agent-harness.md` | 4層、3製品接続、instruction budget、正本・adapter・Skillの配置 |
| `docs/testing/index.md` | Day Schedule固有risk lane、test種別、local / CI検証選択、fixture、native / visual / platform matrix |
| `docs/engineering/desktop-platform-and-release.md` | latest app handoff、Tauri platform、installer、release contract |
| `docs/agent-principles.md` | 設計・実装のheuristicとhard gateの境界 |
| `.agents/skills/` | task固有の共有workflow |
| `.claude/rules/`, `.claude/skills/` | Claude Codeへ正本を接続する薄いadapter |
| `.cursor/rules/` | Cursorへ正本を接続する薄いpath adapter |
| `docs/product-invariants.md` | 製品、時間、同期、通知、データ保護の変更禁止条件 |
| `docs/architecture-boundaries.md` | React / command / application / domain / infrastructureの責務 |
| `docs/engineering/` | 時間、同期、通知、migration、配布の技術contract |
| `docs/release-quality-gates.md` | build、artifact、install、launch、release可否 |
| `docs/ai-governance/` | UI/UX、証跡、Issue品質、3製品互換性、完了条件 |
| `docs/security-publication-checklist.md` | 公開source、Issue、PR、fixture、screenshotの安全性 |
| `OPERATIONS.md` | 障害、diagnostics、復旧、同期、通知、installerの運用 |
| `SECURITY.md` | security reportと実装security policy |
| `plans/` | 長期taskの一時的だが追跡可能な計画 |

## 2. README

書く内容:

- 何のアプリか。
- 対応OSと技術の短い説明。
- 最短bootstrap / verify。
- 現在の実装状態。
- 主要文書へのlink。
- license。

次の詳細は各正本へ置き、READMEには要約とlinkだけを置きます。

- OAuth、PKCE、loopback、keyring
- SQLite schema、migration、backup / restore、legacy import
- sync algorithm、Outbox、conflict、retry
- timezone、DST、recurrence、notification ledger、Focus state
- Tauri capability、CSP、installer、platform差分
- agent task workflow、UI/UX checklist、release手順

## 3. 更新判断

1. UI、copy、shortcut、permission flow: `UserManual.md`
2. domain、IPC、dependency direction: `docs/architecture-boundaries.md`
3. time、timezone、recurrence: `docs/engineering/time-and-recurrence.md` とproduct invariants
4. Google Calendar / Tasks、OAuth、sync: `docs/engineering/calendar-sync.md` とsecurity
5. notification、Focus: `docs/engineering/notifications-and-focus.md`
6. schema、migration、backup、import: `docs/engineering/data-migrations-and-backup.md`
7. Tauri、installer、platform: `docs/engineering/desktop-platform-and-release.md` とoperations
8. test command、CI、artifact: `docs/testing/index.md`
9. 全作業共通のagent contract: root `AGENTS.md`
10. path固有contract: nearest `AGENTS.md` とClaude / Cursor adapter
11. task workflow: `.agents/skills/` とClaude Skill adapter
12. rule配置、instruction budget、3製品互換性: `docs/agent-harness.md` とverifier
13. UI/UX判定、証跡、Issue品質: `docs/ai-governance/`
14. 公開禁止情報とmasking: `docs/security-publication-checklist.md`

## 4. agent ruleの重複管理

- root、nested rule、Skill、詳細docs、tool adapterで同じ長文を正本化しない。
- rootは常時必要な共通核、nested ruleはpath固有差分、Skillはtaskの実行順、docsは判断基準を持つ。
- `.claude/` と `.cursor/` は正本への接続だけを行い、新しい品質基準を持たない。
- machine判定できるfile存在、size、frontmatter、禁止patternは `scripts/verify-agent-harness.mjs` へ置く。
- 配置判断の詳細は `docs/agent-harness.md` に従う。

## 5. 一般的なDRY

- 同じ仕様本文を複数文書へcopyしない。
- 正本を一つ決め、他は要約とlinkにする。
- historical decisionが必要ならADRを追加し、current contractと混ぜない。
- code identifier、command、pathは実在確認する。
- 作業メモ、未確定の予定、古い完了条件を恒久文書へ残さない。

## 6. 公開安全性

文書、Issue、PR、screenshot、fixtureは `docs/security-publication-checklist.md` とsecurity-publication Skillに従います。secret、token、account、予定内容、raw DB / backup / log、絶対path、追跡可能なIDを残しません。
