# エージェントハーネス互換性方針

この文書は、Codex、Claude Code、Cursorで同じDay Schedule Next品質契約を過不足なく適用するための詳細正本です。個別製品へ同じ長文を複製せず、共通正本、scope、adapter、Skill、machine verificationを組み合わせます。

## 1. 目的

- product invariant、secret、data safety、evidenceのhard gateを3製品で一貫して適用する。
- 作業に無関係な指示を常時読み込ませない。
- tool固有機能を活用しつつ、特定toolだけで成立する条件を共通正本へ置かない。
- rule追加によるinstruction budgetの無制限な増加を防ぐ。
- 発動漏れ、重複、循環参照、古いadapterをmachine verifierで検出する。

## 2. 用語

- **共通正本**: tool非依存の判断基準を置く `AGENTS.md`、`docs/`、`.agents/skills/`
- **近接ルール**: 特定directory以下へ適用するnested `AGENTS.md`
- **adapter**: tool固有scopeから共通正本へ接続する短いfile
- **Skill**: 特定taskで読む実行手順
- **hard gate**: 違反状態で完了または公開できない条件
- **heuristic**: contextに応じて採否を判断する目安
- **instruction budget**: 常時または対象scopeで読み込む指示量

## 3. 適用構造

| 対象 | 常時入口 | scope | task手順 | fallback |
|---|---|---|---|---|
| Codex | root `AGENTS.md` | nearest `AGENTS.md` | `.agents/skills/` | rootと関連docs |
| Claude Code | `CLAUDE.md` の `@AGENTS.md` | `.claude/rules/` のpaths | `.claude/skills/` から共有Skill | adapter未発動でもroot |
| Cursor | root `AGENTS.md` | `.cursor/rules/*.mdc` のglobs | `.agents/skills/` | adapter未発動でもroot |

共通の意味は常に共通正本へ置きます。adapterは適用path、追加で読むnear rule、使うSkillだけを示します。

## 4. 配置判断

1. machine判定できる形式、size、file存在、禁止patternはverifierへ置く。
2. 全作業で必要なhard gateだけをrootへ置く。
3. frontend、Rust、E2E、docs、GitHub automationの局所契約はnear ruleへ置く。
4. UI、sync、time、migration、release、delivery、publicationの手順はSkillへ置く。
5. 詳細な理由とPass / Failはdocsへ置く。
6. tool固有の発動条件だけをadapterへ置く。

## 5. instruction budget

- root `AGENTS.md`: 180行 / 16 KiB
- nested `AGENTS.md`: 100行 / 8 KiB
- root + 1 nested: 24 KiB
- canonical Skill: 180行 / 16 KiB
- adapter: 30行 / 4 KiB

Cursor adapterは `alwaysApply: false` を使い、常時適用ruleを増やしません。

adapterから別adapterを参照しません。複数domainを無関係に束ねず、paths / globsを正本のscopeと一致させます。

## 6. tool中立性

共通正本は結果とcontractを定義します。特定toolの操作方法はadapterまたはSkillの補足に留めます。

採用する表現:

- 利用可能で認証済みのGitHub clientでIssueとPRを作成する。
- latest meaningful changeに対する利用可能なreviewを確認する。
- path-scoped adapterからnear ruleを読む。
- draft / ready状態をclient policyと残るblockerに合わせて明示する。

共通条件へ置かないもの:

- 特定CLIの認証command
- 特定製品名を固定したbranch prefix
- 特定review botが存在しない環境を未完了にする条件
- 変更のない同一headへclean reviewを反復する条件
- `.cursor` directoryの禁止

## 7. product固有契約

3製品すべてが次へ到達できることを確認します。

- `docs/product-invariants.md`
- `docs/architecture-boundaries.md`
- `apps/desktop/src/AGENTS.md`
- `apps/desktop/src-tauri/AGENTS.md`
- UI / Calendar sync / Time & notification / Data migration / Desktop release Skills
- `docs/release-quality-gates.md`
- `docs/security-publication-checklist.md`

adapter追加でこれらのhard gateを再定義せず、参照だけを行います。

## 8. 互換性review

| 観点 | Codex | Claude Code | Cursor |
|---|---|---|---|
| 発見 | root / near rule / Skillから到達 | import / paths / Skill adapterから到達 | root / globs / shared Skillから到達 |
| scope | 無関係pathへ適用しない | pathsが広すぎない | globs / alwaysApplyが広すぎない |
| 正本 | tool固有copyがない | adapterへ本文をcopyしない | adapterへ本文をcopyしない |
| fallback | near ruleなしでも安全 | adapter未発動でもrootが残る | adapter未発動でもrootが残る |
| 実行可能性 | 利用可能なtoolで成果を完遂 | 固有機能なしでも代替経路 | 固有機能なしでも代替経路 |
| budget | root + near ruleが上限内 | import後の常時量が過密でない | alwaysApply ruleを増やさない |

PRには3製品への影響、scoped化した内容、追加した常時指示量、未確認の製品固有挙動を記録します。

## 9. machine verification

`scripts/verify-agent-harness.mjs` は最低限次を検査します。

- root、nested、Skill、adapterのline / byte budget
- `CLAUDE.md` のimport契約
- canonical SkillとClaude / Cursor adapterの存在
- Skill / rule / MDC frontmatter
- adapterから共通正本への参照
- rootからproduct docs、near rule、Skillへのrouting
- 廃止したCodex固定branch / review条件
- `.cursor`禁止規則の再混入
- Issue / PR templateの品質項目
- UI Skillの対象面分類
- governance / documentation structureの接続

Nodeだけで実行できる構造を保ち、Windowsの既存 `npm run verify:bootstrap` を壊しません。

## 10. 停止条件

次が残るハーネス変更は完了扱いにしません。

- 3製品のいずれかが共通hard gateまたはproduct固有契約へ到達できない。
- adapterだけに重要な判断基準が存在する。
- 同じhard gateが複数正本で異なる条件を持つ。
- root budgetを超えたままscope化・Skill化・machine化の検討がない。
- adapterのscopeが正本の対象と一致しない。
- 廃止したtool固定規則がverifierやtemplateから要求される。
- Windowsのbootstrapへ新しいUnix shell必須依存を持ち込む。
