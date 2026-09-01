# ガバナンス保守方針

この文書は、rule、Skill、adapter、validator、fixture、self-test、workflowを増減・変更する判断基準です。3製品の読者、委任、evidence、task-stateの詳細は [`docs/agent-harness.md`](../agent-harness.md) を正本とします。

## 上流baselineとDay Schedule overlay

共通ガバナンスの再適用で参照した上流の対象revisionを固定します。

`stillshore-chirp/wordpack-for-english@c40782e15a8799ea74e68414d97ddd4f6a9166fa`（2026-09-01 JSTに確認）

参照した上流正本は `AGENTS.md`、`docs/agent-harness.md`、`docs/agent-principles.md`、`docs/ai-governance/00-index.md`、`03-evidence-and-completion-gates.md`、`13-maintenance-policy.md`、`14-issue-quality-gate.md`、`templates/task-state.json` です。このrepositoryへは、reader routing、minimal execution、checkpoint、closure-bound evidence、task-state、static/runtime境界を取り込み、Day Schedule固有のpath bridgeと製品不変条件を維持します。file単位の全置換は行いません。

Contract ID: `DSN-WORDPACK-OVERLAY`

overlayは [`docs/testing/index.md`](../testing/index.md) の `DSN-RISK-BASED-DELIVERY`、[`docs/engineering/desktop-platform-and-release.md`](../engineering/desktop-platform-and-release.md) の `DSN-LATEST-APP-HANDOFF`、およびlocal-first、同期、時刻、通知、migration、backup、Tauri、securityの正本です。検証重複を減らしても、これらのhard gateを弱めません。governance / docsだけの変更へnative screenshot、全state matrix、アプリ再生成を定型要求しません。明示的な再評価なしにoverlayを削除・弱化・重厚化しません。

## 正本と責務

- 全体のhard gate、権限、path bridge、最小実行: root `AGENTS.md`
- path固有契約: 対象に最も近いnested `AGENTS.md`
- taskの発動条件・手順・成果物: `.agents/skills/<name>/SKILL.md`
- 製品不変条件・architecture: `docs/product-invariants.md`、`docs/architecture-boundaries.md`
- UI/Issue/evidenceの判定基準: `docs/ai-governance/`
- 公開安全性: `docs/security-publication-checklist.md` とsecurity-publication Skill
- Claude Code / Cursor: `.claude/`、`.cursor/`の薄いadapter
- 決定的な形式・参照・budget検査: `scripts/validate-governance.mjs`

`CLAUDE.md`は`@AGENTS.md`だけをimportし、adapterへ品質基準本文を複製しません。validatorはstatic検査であり、製品runtime、Hook、権限、実際のrule discoveryを証明しません。

## 追加・変更・削除の基準

各変更は、対象scope、発動条件、正本owner、enforcement（static / test / runtime / advisory）、coverage、関連risk、instruction・実行cost、sunsetまたはreplacementを先に記録します。

1. 既存の正本、adapter、Skill、validator、fixture、self-test、workflowを検索し、統合またはreplacementを先に検討する。
2. 全作業のhard gateはroot、path差分はnearest rule、task手順はSkill、理由と詳細checklistはdocsへ置く。
3. 決定的な検査はscript / test / CIへ置き、static結果をruntimeやlive benchmarkの成功と表現しない。
4. workflow / jobはtrigger locus、failure mode、runner・wall-clock cost、artifact、failure owner、統合できない理由、sunset条件を記録する。
5. security、authorization、data integrity、公開API、production safetyは可能なenforcementへ結び、repositoryで観測できない部分はadvisory / unverifiedとする。
6. 削除はconsumer、link、coverage、replacement、sunset理由を確認してから行う。

soft heuristicをexact-matchや大規模fixtureだけで固定せず、判断理由と観測可能な結果を残します。

## 3製品・重複・レビュー

rule、Skill、adapter、validatorを変更するPRでは、Codexのroot/nearest routing、Claude Codeの`CLAUDE.md`/path/Skill接続、Cursorの`alwaysApply: false`と限定globを同じ変更で確認します。adapterは正本への接続だけを持ち、`.cursor` directory自体を禁止しません。

同じhard gate、checklist、workflow本文を複数箇所で正本化しません。indexは入口、Skillは実行順、詳細docsは判定基準、validatorは機械判定を担当します。rootへ詳細手順を追加する場合は、他の配置で成立しない理由をIssue / PRへ記録します。

包括reviewとfull gateの回数、証拠失効、risk lane台帳は [`docs/agent-harness.md`](../agent-harness.md) の `DSN-COMPREHENSIVE-REVIEW-ROUNDS` を唯一のtool非依存正本とします。同じsnapshotへのclean reviewを繰り返しません。merge、close、release、deployは別の明示指示が必要です。

### サブエージェント運用

委任、再監査、timeout、scope shrink、evidence packageの契約もharnessへ集約し、各adapterやSkillへ複製しません。

## 包括レビュー契約の配置

Contract ID: `DSN-REVIEW-ROUND-CANONICAL-PLACEMENT`

`DSN-COMPREHENSIVE-REVIEW-ROUNDS`はtool非依存の唯一の詳細正本です。root `AGENTS.md`には全agentが到達する短い入口だけを置き、nested `AGENTS.md`、adapter、Skillへ契約本文や数え方を複製しません。agent runtime固有の起動方法は共有正本へ追加せず、adapterは正本への薄い参照に限定します。

## Issue、対象面、研究

Issueは [`14-issue-quality-gate.md`](14-issue-quality-gate.md) に従い、理由、根拠、現在と目標、scope、acceptance、verification、riskを記録します。GitHub共同作業面を含む対象面は [`02-uiux-review-framework.md`](02-uiux-review-framework.md) で分類し、harness / template / Markdownだけの変更へnative screenshotや全state matrixを要求しません。app UI変更ではDay Schedule固有state、native evidence、platform差分を維持します。

新しい研究やguidanceはofficial specification、安定したHCI / accessibility standard、cognitive accessibility guidance、current research、single studyの順に強制力を判断します。単発研究や一時的なtool挙動だけでhard gateを増やしません。tool仕様変更時は3製品の現行仕様を確認し、adapterとvalidatorを整合させます。

## 保守ゲートと停止条件

変更前に対象path、正本、読者、owner、enforcement、公開範囲、必要な検証を確認します。変更後は3製品の到達性、frontmatter、重要link、budget、重複、公開安全性、関連fixture / self-testを確認し、次を観測値・未確認に分けて報告します。

```bash
node scripts/validate-governance.mjs
npm run verify:bootstrap
```

共通hard gateへ到達できない、adapterだけに重要判断がある、正本間で食い違う、replacementなしに増える、owner・enforcement・coverage・cost・sunsetが不明、budget超過、壊れたlink、公開範囲未確認がある場合は完了扱いにしません。実行できない検証は理由と残るriskを記録します。
