# AIエージェント向け作業プロンプト

この作業はDay Schedule Nextのアプリ本体UI、repositoryが制御する独自UI、またはdata / sync / time / notification / releaseへ影響する変更を含みます。

1. root `AGENTS.md` と変更対象に最も近い `AGENTS.md` を読んでください。
2. 変更領域に該当する `.agents/skills/*/SKILL.md` を発動してください。
3. UI変更では `02-uiux-review-framework.md` で対象面を分類し、`03-evidence-and-completion-gates.md` と直接関係する詳細正本だけを読んでください。
4. product behaviorへ触れる場合は `docs/product-invariants.md` と `docs/architecture-boundaries.md` を確認してください。
5. repository変更ではGitHub配送Skill、公開物では公開安全性Skillを使ってください。
6. 実装、test、documentation、証跡、反証review、PRまで依頼範囲内で完遂してください。

## 作業前に記載

- Issue:
- User goal:
- Target paths / screens / commands / tables:
- 対象面: アプリ本体UI / GitHub共同作業面 / 混在 / N/A
- Non-goals:
- Product invariants:
- Required Skills:
- OS impact: macOS / Windows / both / N/A
- Data / sync / time / permission risk:

## 必須成果物

アプリ本体UI:

- user value assessment
- novice simulation
- state matrix
- accessibility、visual hierarchy、copy、efficiency、trust
- counter-review
- before / after screenshot
- affected OSのnative evidence

GitHub共同作業面:

- 文言、項目、順序、必須性
- Markdown / YAML / frontmatter / glob / path
- linkと正本参照
- 公開安全性
- instruction budgetまたはCI evidence

領域変更:

- sync failure matrix、time boundary matrix、migration recovery、platform matrixの該当物
- executed tests and evidence
- unexecuted checks and remaining risks

P0、必須証跡不足、未実施検証しか根拠がない状態を完了扱いにしないでください。
