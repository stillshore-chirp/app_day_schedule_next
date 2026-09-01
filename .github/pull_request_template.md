<!--
PRのタイトルと本文は日本語を原則とします。固有名詞、製品名・ライブラリ名、code identifier、version/path、GitHub構文は正確な識別のため原表記を維持できます。
Issue / PRの判断に必要な説明、受け入れ条件、検証、未実行項目、リスクは日本語で記録してください。
完全解決: Closes #123 / 部分対応: Refs #123。省略時は短い理由を書いてください。
-->

## 関連Issue

- 関連Issue:
- 対応範囲:
- 対応していないこと:
- 完了条件との差分:

## 変更内容

-

## 維持した既存挙動

-

## User value / product invariants

- 対象ユーザーと目的:
- 支援する理解・判断・行動・回復:
- 影響する `docs/product-invariants.md`:
- 影響するarchitecture boundary:

## Architecture / data impact

- React / IPC / application / domain / infrastructure:
- SQLite schema / migration / backup / restore:
- Google OAuth / Calendar / Tasks / Outbox / conflict:
- Timezone / DST / recurrence / notification / Focus:
- Tauri capability / CSP / OS integration / installer:

## 検証結果

<!-- 実行したcommand、test件数、手動確認、結果を書く。未実行は理由と残るriskを記載する。 -->

| Check | Result | Evidence |
|---|---|---|
| Harness / docs / security text |  |  |
| Frontend format / lint / typecheck / test |  |  |
| Rust fmt / clippy / test |  |  |
| DB / sync / time integration |  |  |
| Native E2E |  |  |
| macOS build / manual |  |  |
| Windows build / manual |  |  |

## UI/UX・GitHub共同作業面の証跡

<!-- 対象面を「アプリ本体UI / GitHub共同作業面 / 混在 / N/A」から選ぶ。 -->

- 対象面:
- アプリ本体UIの対象画面・状態:
- User value / novice simulation / state matrix:
- Accessibility / keyboard / drag equivalent:
- Visual hierarchy / copy / expert efficiency / trust:
- Counter-review:
- Before / after screenshots:
- GitHub共同作業面の文言・構造・frontmatter・link確認:
- Screenshotを添付できない場合の理由・代替証跡・残るrisk:

## 公開安全性・運用

- OAuth token / credential / keyring:
- Calendar / event / task / personal data:
- Logs / diagnostics / screenshots redaction:
- Tauri capabilities / CSP:
- Dependency / license:
- Invisible controls / secret scan:
- 公開安全性の確認:
- Remaining security risk:

## Data recovery / rollback

- Migration rollback:
- Backup / restore:
- Sync retry / conflict recovery:
- User-facing Undo / recovery:
- Repository change rollback:

## CI / レビュー

- latest commit:
- draft / ready state:
- required CI:
- 利用可能な自動・手動review:
- 未解決review thread:
- 対応不要と判断した指摘と理由:
- review未提供時の代替自己review:
- GitHubのmergeability:

## 未実行の検証

| Check | Reason | Remaining risk | Next action |
|---|---|---|---|
|  |  |  |  |

## Remaining risks

-
