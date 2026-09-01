# AI / UIUX Governance Index

このディレクトリは、Day Schedule NextのUI/UX品質、Issue品質、証跡、完了条件を扱う詳細正本です。企業全体のAI統制、法務、倫理審査、モデル監査を意味しません。

3製品のルール配置、読者、委任、task-state、static検査は [`docs/agent-harness.md`](../agent-harness.md) を正本とします。

## 読み方

すべての文書を毎回読む必要はありません。

1. root `AGENTS.md` と変更対象に最も近い `AGENTS.md` を読む。
2. 該当する `.agents/skills/<name>/SKILL.md` を発動する。
3. UI変更では `02-uiux-review-framework.md` で対象面を分類する。
4. `03-evidence-and-completion-gates.md` と、変更内容に直接関係する詳細文書だけを読む。
5. Issue作成、ルール変更などUI外の作業は、該当する正本へ直接進む。

## 中心文書

| 文書 | 責務 |
|---|---|
| [`../agent-harness.md`](../agent-harness.md) | 3製品の到達性、checkpoint、委任、証跡再利用、instruction budget |
| [`01-agent-operating-contract.md`](01-agent-operating-contract.md) | UI / GitHub共同作業面の基本契約 |
| [`02-uiux-review-framework.md`](02-uiux-review-framework.md) | 対象面、品質定義、P0 / P1 / P2、レビュー観点 |
| [`03-evidence-and-completion-gates.md`](03-evidence-and-completion-gates.md) | 対象面別の証跡、closure、完了ゲート |
| [`13-maintenance-policy.md`](13-maintenance-policy.md) | ガバナンス、adapter、validator、workflowの保守 |
| [`14-issue-quality-gate.md`](14-issue-quality-gate.md) | Issueの理由、根拠、現在と目標、受け入れ条件 |

## 詳細文書

- [`04-cognitive-psychology-principles.md`](04-cognitive-psychology-principles.md): 認知負荷、初見理解、記憶負荷
- [`05-accessibility-and-inclusive-design.md`](05-accessibility-and-inclusive-design.md): keyboard、focus、name / role / state、contrast
- [`06-visual-hierarchy-and-information-architecture.md`](06-visual-hierarchy-and-information-architecture.md): Today / timeline / Now / Compactの階層
- [`07-ui-copy-and-microcopy.md`](07-ui-copy-and-microcopy.md): save、sync、delete、permission、notificationのcopy
- [`08-state-design-and-error-recovery.md`](08-state-design-and-error-recovery.md): empty、offline、conflict、auth、restore、error
- [`09-ai-agent-review-protocol.md`](09-ai-agent-review-protocol.md): AI reviewの役割分離と限界
- [`10-utility-user-goal-and-product-fit.md`](10-utility-user-goal-and-product-fit.md): ユーザー価値と製品目的
- [`11-efficiency-and-expert-use.md`](11-efficiency-and-expert-use.md): 分単位編集と反復利用の効率
- [`12-satisfaction-trust-and-emotional-ux.md`](12-satisfaction-trust-and-emotional-ux.md): データ・同期・通知への信頼感
- [`glossary.md`](glossary.md): 英語用語の日本語対応
- [`references/canonical-sources.md`](references/canonical-sources.md): 標準・公式資料

## テンプレートとチェックリスト

- [`templates/agent-task-prompt.md`](templates/agent-task-prompt.md)、[`templates/completion-gate-report.md`](templates/completion-gate-report.md)、[`templates/task-state.json`](templates/task-state.json)
- [`templates/uiux-review-report.md`](templates/uiux-review-report.md)、[`templates/state-matrix.md`](templates/state-matrix.md)、[`templates/counter-review.md`](templates/counter-review.md)
- [`templates/user-goal-assessment.md`](templates/user-goal-assessment.md)、[`templates/novice-simulation.md`](templates/novice-simulation.md)、[`templates/efficiency-review.md`](templates/efficiency-review.md)、[`templates/trust-satisfaction-review.md`](templates/trust-satisfaction-review.md)
- `checklists/p0-p1-p2.md`、`checklists/accessibility.md`、`checklists/cognitive-walkthrough.md`、`checklists/visual-hierarchy.md`
- `checklists/content-stress.md`、`checklists/utility-user-goal.md`、`checklists/efficiency.md`、`checklists/satisfaction-trust.md`

## 判定の入口

UIを見た目だけで評価せず、対象ユーザーが目的を達成し、状態を理解し、失敗から回復でき、慣れれば効率よく、安心して使えるかを確認します。主張は画面、test、DOM / accessibility tree、差分、手動確認などの証跡で支えます。GitHub共同作業面だけの変更は、リポジトリが制御する文言、構造、必須性、link、公開安全性へ範囲を絞り、native screenshotやruntimeを定型要求しません。
