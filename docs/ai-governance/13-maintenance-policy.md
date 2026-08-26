# ガバナンス保守方針

この文書は、AIエージェント向けルールとUI/UXガバナンスを保守する方針です。Codex・Claude Code・Cursorを支援する全体構成は [`docs/agent-harness.md`](../agent-harness.md) を正本とします。

## 正本

- 共通の常時読込契約: root `AGENTS.md`
- 領域固有契約: 対象に最も近いnested `AGENTS.md`
- task固有手順: `.agents/skills/<name>/SKILL.md`
- product contract: `docs/product-invariants.md`
- architecture: `docs/architecture-boundaries.md`
- UI/UX詳細: `docs/ai-governance/`
- 公開安全性: `docs/security-publication-checklist.md`
- Claude Code adapter: `.claude/rules/`, `.claude/skills/`
- Cursor adapter: `.cursor/rules/`
- 機械検証: `scripts/verify-agent-harness.mjs`, `npm run verify:bootstrap`

`CLAUDE.md` は `@AGENTS.md` だけを維持します。tool adapterは正本を参照し、新しい判断基準を持ちません。

## 3製品確認

rule、Skill、adapter、verifierを変更する場合は同じPRで確認します。

### Codex

- rootとnearest `AGENTS.md`から必要な規則へ到達できる。
- task手順がrootへ混入せず `.agents/skills/` へ分離されている。
- rootとnestedのinstruction budgetを満たす。

### Claude Code

- `CLAUDE.md`がroot契約を一重にimportしている。
- `.claude/rules/` のpathsが必要な正本へ案内する。
- `.claude/skills/` が共有Skillを唯一の手順正本として参照する。
- adapterへ長文本文をcopyしていない。

### Cursor

- root `AGENTS.md`と `.cursor/rules/` が競合しない。
- MDC ruleは `alwaysApply: false` と限定したglobsを持つ。
- task手順は `.agents/skills/` を正本として利用する。
- `.cursor` directoryを禁止しない。
- adapterへ共通核やSkill本文をcopyしていない。

## ルール追加の判断

1. 機械判定できる場合はscript、test、lint、CIへ置く。
2. 全作業で必要なhard gateだけをrootへ置く。
3. 特定pathだけならnested `AGENTS.md`と薄いtool adapterへ置く。
4. 特定taskだけなら `.agents/skills/` と必要なadapterへ置く。
5. 詳細な根拠やchecklistは既存docsへ統合する。

rootへ詳細手順を追加する変更は、他の配置で成立しない理由をIssueとPRへ書きます。

## 重複禁止

同じhard gate、checklist、workflow本文を複数箇所で正本化しません。

良い構造:

```text
AGENTS.md -> nearest AGENTS.md / task Skill -> detailed docs
Claude / Cursor adapter -> same AGENTS or Skill
```

避ける構造:

```text
root、Skill、docs、tool ruleへ同じ長文を複製
```

表現を変えた意味上の重複も対象です。indexは入口、Skillは実行順、詳細docsは判定基準を担当します。

## Hard gateとheuristic

- P0、secret、証跡捏造、data loss、公開contract、権限境界はhard gateとして明確にする。
- DRY、KISS、SRP、OCP、file size、重複回数、coverage、test配分はheuristicとして扱う。
- heuristicを数値だけのFail条件へ変えない。
- P0を格下げする場合は、完了blockerでない根拠、replacement control、evidenceをIssueとPRへ記録する。

## Review収束

- latest meaningful changeに対するCIと利用可能なreviewを確認する。
- 指摘対応でheadが変わった場合だけ再確認する。
- 変更のないheadへclean reviewを複数回要求しない。
- 特定review botやclient名を3製品共通条件にしない。
- review未提供時は代替自己reviewと未確認範囲を記録する。
- merge、close、releaseは別の明示指示がある場合だけ行う。

## サブエージェント運用

委任、再監査、検証段階、risk lane台帳の正本は [`docs/agent-harness.md`](../agent-harness.md) のSubagent orchestrationとします。root `AGENTS.md`は全agentが到達する短い入口だけを持ち、nested rule、Skill、adapterへ同じ運用本文を複製しません。

運用を変更する時は、積極利用と重複防止の両方を保ちます。新しい専門riskを独立laneへ委任できることを維持しつつ、同一HEADの重複監査、根拠のない再実行、過剰なfork文脈を増やさないことをreviewします。

## Issueと対象面

- Issueは [`14-issue-quality-gate.md`](14-issue-quality-gate.md) に従い、理由、根拠、現在と目標、acceptance、riskを記録する。
- app UIとGitHub共同作業面を [`02-uiux-review-framework.md`](02-uiux-review-framework.md) で分類する。
- harness / template / Markdownだけの変更へ、native screenshotや全state matrixを定型要求しない。
- app UI変更では、Day Schedule固有state、native evidence、platform差分を弱めない。

## 研究・標準

新しい研究やguidanceを取り込む時は、official specification、安定したHCI / accessibility standard、cognitive accessibility guidance、current research、single studyの順に強制力を判断します。単発研究や一時的なtool挙動を根拠なくhard gateへしません。

tool仕様が変わった場合は、3製品の現行仕様を確認し、adapterとverifierを同じ変更で更新します。

## 検証

```bash
node scripts/verify-agent-harness.mjs
npm run verify:bootstrap
```

加えて、変更したNode / JSON / YAML / Markdown、document link、公開安全性、既存CIを確認します。検証できない項目は理由と残るリスクを報告します。

## Desktop固有contractの維持

ハーネス保守で次を一般化・削除しません。

- local-first、UTC instant + IANA timezone、transactional Outbox
- Google incremental sync、conflict、retry、token保護
- notification delivery ledger、Focus state machine
- forward-only migration、backup / restore、legacy import
- Tauri capability、CSP、keyring、macOS / Windows差分
- latest検証commitとartifact / install / launchの対応

これらの詳細はproduct invariants、engineering docs、5つの専門Skillを正本とし、rootからのroutingをmachine verifierで固定します。
