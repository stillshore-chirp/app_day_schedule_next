# エージェントハーネス設計

この文書は、Day Schedule NextでCodex、Claude Code、Cursorへ同じ品質契約を接続する構造の正本です。製品固有の安全契約は最寄りの `AGENTS.md`、task手順は `.agents/skills/`、詳細な判断根拠は `docs/` に置きます。

## 1. 目的

- secret、データ整合性、製品不変条件、証跡などのhard gateを3製品で一貫して適用する。
- 作業に無関係な詳細を常時読み込ませない。
- Tauri / React / Rust / SQLite / Google同期 / 時刻・通知の専門契約を維持する。
- tool固有機能を活用しつつ、特定toolだけで成立する条件を共通正本へ置かない。
- instruction budget、frontmatter、adapter参照、廃止ルールをCIで検出する。

## 2. 4層

| 層 | 正本 | 責務 |
|---|---|---|
| common | root `AGENTS.md` | 全作業で必要な開始手順、routing、hard gate、完了条件 |
| path | 最寄りのnested `AGENTS.md` | frontend、Rust / Tauri、native E2E、docs、GitHub automationの局所契約 |
| task | `.agents/skills/<name>/SKILL.md` | UI、sync、time、migration、release、GitHub配送、公開安全性の実行順序 |
| machine | test / lint / `scripts/verify-agent-harness.mjs` / CI | file存在、size、frontmatter、adapter、禁止pattern、link、安全性 |

同じ判断基準を複数層へコピーしません。commonは入口、pathは局所差分、Skillは手順、docsは理由と判定基準を担当します。

## 3. 3製品への接続

### Codex

- rootから作業pathに向かって最寄りの `AGENTS.md` を適用する。
- taskが該当する場合は `.agents/skills/` を読む。
- adapterがなくてもcommon・path・taskへ到達できる構造を保つ。

### Claude Code

- `CLAUDE.md` は `@AGENTS.md` だけをimportする。
- `.claude/rules/` はpath条件からroot・最寄りの `AGENTS.md`・関連Skillを案内する。
- `.claude/skills/` は `.agents/skills/` を唯一の手順正本として参照する。
- rule / Skill adapterへ品質基準本文を複製しない。

### Cursor

- root契約と `.cursor/rules/*.mdc` を併用する。
- MDCは `alwaysApply: false` と限定した `globs` を持ち、root・近接ルール・共有Skillへ接続する。
- `.cursor` directoryの存在自体を禁止しない。
- Cursor固有ruleだけにhard gateを置かない。

## 4. path topology

```text
AGENTS.md
├── apps/desktop/AGENTS.md
│   ├── apps/desktop/src/AGENTS.md
│   ├── apps/desktop/src-tauri/AGENTS.md
│   └── apps/desktop/tests/AGENTS.md
├── docs/AGENTS.md
└── .github/AGENTS.md
```

root外の `UserManual.md`、`README.md`、`OPERATIONS.md`、`SECURITY.md` はrootのpath bridgeから関連正本へ接続します。

## 5. task topology

共有Skillの正本:

- `ui-ux-review`
- `calendar-sync-review`
- `time-notification-review`
- `data-migration-review`
- `desktop-release-review`
- `github-delivery`
- `security-publication`

Skillは発動条件、読む正本、実行順序、成果物、停止条件に集中します。判定項目の長文はproduct invariants、engineering docs、AI governanceへ置きます。

## 6. Hard gateとheuristic

### hard gate

具体的な損害または虚偽を防ぎ、観測可能な証跡でPass / Failを判定できる条件です。

- secret・個人データの公開
- データ損失、silent overwrite、duplicate create、partial migration
- product invariant・公開contract・権限境界の破壊
- 未実施検証や未確認OSの成功扱い
- P0、必須CI失敗、重大な未解決指摘の隠蔽
- 無関係な差分・ユーザーデータ・履歴の破壊

### heuristic

複数の妥当解があり、contextで採否が変わる設計判断です。

- DRY、抽象化、file分割、layering
- component / functionの大きさ
- coverage目標、test配分
- interface、strategy、factory、plugin
- 将来拡張、再利用性、汎用化

heuristicを採用しないこと自体をFailにせず、品質・保守性・誤用リスクへの実質的な影響で判断します。

## 7. Instruction budget

machine verifierは次を上限として検査します。

| 対象 | 上限 |
|---|---:|
| root `AGENTS.md` | 180行 / 16 KiB |
| nested `AGENTS.md` | 100行 / 8 KiB |
| root + 1 nested rule | 24 KiB |
| canonical Skill | 180行 / 16 KiB |
| Claude / Cursor adapter | 30行 / 4 KiB |

上限は常時指示量の暴走を防ぐhard gateです。上限内でも意味上の重複、曖昧な命令、広すぎるscopeはreviewで確認します。

## 8. 配置判断

1. file存在、format、禁止pattern、sizeなど機械判定できる内容はscript / test / CIへ置く。
2. 全作業で必要なhard gateだけをrootへ置く。
3. 特定pathだけに必要な内容はnearest `AGENTS.md`へ置く。
4. 特定taskの手順はSkillへ置く。
5. 理由、比較、詳細checklistはdocsへ置く。
6. tool固有の発動条件だけをadapterへ置く。

rootへ詳細手順を追加する変更は、他の配置で成立しない理由をIssueとPRへ記録します。

## 9. review収束

- latest meaningful changeに対する必須CIと利用可能なreviewを確認する。
- 指摘対応でheadが変わった場合だけ再確認する。
- 変更のないheadへclean reviewを複数回要求しない。
- 特定review botが存在しない環境を未完了にしない。
- reviewが提供されない場合は代替自己レビューと未確認範囲を記録する。
- merge、close、releaseは別の明示指示がある場合だけ行う。

## 10. 機械検証

既存のWindows / macOS開発入口を保つため、Node製verifierを正本にします。

```bash
node scripts/verify-agent-harness.mjs
npm run verify:bootstrap
```

`verify:bootstrap` はharness、document link、公開テキスト、repository boundary、i18n、workflow policyをまとめて検査し、PR CIのQuality gateから実行されます。追加のpackage installを必要としません。

検証対象:

- 必須fileとadapterの存在
- line / byte budget
- Skill / Claude rule / Cursor ruleのfrontmatter
- `CLAUDE.md` import契約
- adapterの正本参照
- Codex・Claude Code・Cursorへの到達性
- 廃止したtool固定条件と `.cursor` 禁止の再混入
- Issue / PR template、UI evidence、保守方針の接続

自動検査だけで各製品の実際のrule discoveryを完全に保証したとは扱いません。製品仕様変更や発動漏れを確認した場合は、adapter、正本、verifierを同じ変更で更新します。

## 11. 変更時の確認

- 3製品のいずれかが共通hard gateへ到達できない状態を残さない。
- adapterだけに新しい品質基準を置かない。
- root縮小で製品固有Skill・nested ruleへのroutingを落とさない。
- adapterのglob / pathを正本の適用範囲と一致させる。
- Node製bootstrapを維持し、Windows開発へUnix shell依存を追加しない。
- UI、runtime、DB、sync、notification、releaseへ影響しないharness変更は、GitHub共同作業面の証跡として評価する。

## 12. Subagent orchestration

サブエージェントは専門riskを独立して並列化するために使い、同じ証拠を読む担当を増やすために使いません。メインエージェントは委任前に、次を満たす重複しないlaneを定義します。

- そのagentだけが担当するrisk lane。
- 対象HEAD、対象path、確認する具体的な問い。
- 既存報告やメインエージェント自身の一次証拠確認では不足する理由。

この3点を定義できない委任は行いません。包括監査を複数agentへ同時委任せず、同一HEAD・同一risk laneの独立監査は原則1回とします。再監査を認めるのは、対象コードが変わった、新しい実行証拠が得られた、前回監査に明確な不足がある、または未解決の証拠矛盾がある場合です。修正後に変更pathを対象再検証することと、未変更HEADへ同じ監査を繰り返すことを区別します。

監査結果が矛盾した場合は追加agentの多数決を取りません。メインエージェントがsource code、test設定、実際のcommand結果、commit hashなどの一次証拠を確認して解決します。

委任時はfull-history forkを既定にしません。必要なHEAD、path、acceptance、既知の指摘だけを短く渡します。報告は変更path、P0 / P1、実行結果、未実行項目と残るriskを中心に簡潔にします。

検証は次の段階を守ります。

1. 開発中は変更によって影響を受けるfocused testを先に実行する。
2. 配送対象の最終HEADが確定した時点でfrontend / Rust / nativeなど必要なfull gateを原則1回実行する。
3. 成功済み検証を再実行する時は、対象変更、binary変更、実行条件変更、証拠期限切れなど、証拠が失効した理由を記録する。

メインエージェントは次のrisk lane台帳を保ち、担当scopeと結果を統合して重複を止めます。

| Field | Meaning |
|---|---|
| risk lane | 重複しない確認責務 |
| owner | agentまたはメインエージェント |
| verified HEAD | 報告と証拠が対応するcommit |
| status | pending / active / passed / finding / blocked |
| invalidation condition | 再検証が必要になる対象変更または新証拠 |
