# AI / UIUX Governance Index

このディレクトリは Day Schedule Next の UI/UX、証跡、反証レビュー、エージェント運用の詳細正本です。ルート [`AGENTS.md`](../../AGENTS.md) が rule origin、`.agents/skills/` が実行 workflow、本ディレクトリが判断基準です。

## 読む順序

### すべてのユーザー向け変更

1. [`01-agent-operating-contract.md`](01-agent-operating-contract.md)
2. [`02-uiux-review-framework.md`](02-uiux-review-framework.md)
3. [`03-evidence-and-completion-gates.md`](03-evidence-and-completion-gates.md)
4. 変更領域に応じた `04`〜`12`
5. `.agents/skills/ui-ux-review/SKILL.md`

### 詳細

- [`04-cognitive-psychology-principles.md`](04-cognitive-psychology-principles.md): 認知負荷、認識、mental model、失敗回復。
- [`05-accessibility-and-inclusive-design.md`](05-accessibility-and-inclusive-design.md): keyboard、focus、drag equivalent、name / role / state、contrast。
- [`06-visual-hierarchy-and-information-architecture.md`](06-visual-hierarchy-and-information-architecture.md): Today / timeline / Now / Compact の階層。
- [`07-ui-copy-and-microcopy.md`](07-ui-copy-and-microcopy.md): local save、sync、conflict、permission、notification のコピー。
- [`08-state-design-and-error-recovery.md`](08-state-design-and-error-recovery.md): empty、offline、conflict、auth、restore、error。
- [`09-ai-agent-review-protocol.md`](09-ai-agent-review-protocol.md): review role と実行順。
- [`10-utility-user-goal-and-product-fit.md`](10-utility-user-goal-and-product-fit.md): ユーザー価値と製品目的。
- [`11-efficiency-and-expert-use.md`](11-efficiency-and-expert-use.md): 分単位編集の反復効率。
- [`12-satisfaction-trust-and-emotional-ux.md`](12-satisfaction-trust-and-emotional-ux.md): データ・同期・通知への信頼感。
- [`13-maintenance-policy.md`](13-maintenance-policy.md): rule 保守と重複防止。
- [`glossary.md`](glossary.md): 英語用語の日本語対応。
- [`references/canonical-sources.md`](references/canonical-sources.md): 標準・公式資料。

## テンプレート

- [`templates/agent-task-prompt.md`](templates/agent-task-prompt.md)
- [`templates/user-goal-assessment.md`](templates/user-goal-assessment.md)
- [`templates/novice-simulation.md`](templates/novice-simulation.md)
- [`templates/state-matrix.md`](templates/state-matrix.md)
- [`templates/efficiency-review.md`](templates/efficiency-review.md)
- [`templates/trust-satisfaction-review.md`](templates/trust-satisfaction-review.md)
- [`templates/counter-review.md`](templates/counter-review.md)
- [`templates/uiux-review-report.md`](templates/uiux-review-report.md)
- [`templates/completion-gate-report.md`](templates/completion-gate-report.md)

## チェックリスト

- [`checklists/p0-p1-p2.md`](checklists/p0-p1-p2.md)
- [`checklists/accessibility.md`](checklists/accessibility.md)
- [`checklists/cognitive-walkthrough.md`](checklists/cognitive-walkthrough.md)
- [`checklists/visual-hierarchy.md`](checklists/visual-hierarchy.md)
- [`checklists/content-stress.md`](checklists/content-stress.md)
- [`checklists/utility-user-goal.md`](checklists/utility-user-goal.md)
- [`checklists/efficiency.md`](checklists/efficiency.md)
- [`checklists/satisfaction-trust.md`](checklists/satisfaction-trust.md)

## 基本原則

- build / test success だけで UI/UX completion としない。
- 理論名を並べず、画面上の観察点、Pass / Fail、証跡、修正案へ変換する。
- 実ユーザーテストと AI novice simulation を混同しない。
- P0 は残したまま merge / complete としない。
- native desktop の mouse / keyboard / WebView / OS permission / window lifecycle を対象にする。
- 同期・通知・データ損失の UI は見た目より trust と recovery を優先する。
