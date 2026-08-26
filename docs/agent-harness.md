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

## 3. WordPack baselineとDay Schedule固有overlay

WordPack for Englishは共通ガバナンスの上流正本です。再適用は共通hard gate、4層配置、3製品adapterを差分として取り込み、repository全体を一括置換しません。このrepositoryで現在有効な製品固有契約はlocal正本を優先し、[`ai-governance/13-maintenance-policy.md`](ai-governance/13-maintenance-policy.md) の再適用手順で保護します。

Day Schedule固有overlayの中心は、[`testing/index.md`](testing/index.md) のrisk-based delivery、[`engineering/desktop-platform-and-release.md`](engineering/desktop-platform-and-release.md) のlatest app handoff、変更面に比例するUI証跡です。検証重複は抑えますが、ユーザー向け変更の最新アプリinstall / launch、データ・同期・時刻・通知・migration・securityのhard gateは弱めません。

## 4. 3製品への接続

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

## 5. path topology

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

## 6. task topology

共有Skillの正本:

- `ui-ux-review`
- `calendar-sync-review`
- `time-notification-review`
- `data-migration-review`
- `desktop-release-review`
- `github-delivery`
- `security-publication`

Skillは発動条件、読む正本、実行順序、成果物、停止条件に集中します。判定項目の長文はproduct invariants、engineering docs、AI governanceへ置きます。

## 7. Hard gateとheuristic

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

## 8. Instruction budget

machine verifierは次を上限として検査します。

| 対象 | 上限 |
|---|---:|
| root `AGENTS.md` | 180行 / 16 KiB |
| nested `AGENTS.md` | 100行 / 8 KiB |
| root + 1 nested rule | 24 KiB |
| canonical Skill | 180行 / 16 KiB |
| Claude / Cursor adapter | 30行 / 4 KiB |

上限は常時指示量の暴走を防ぐhard gateです。上限内でも意味上の重複、曖昧な命令、広すぎるscopeはreviewで確認します。

## 9. 配置判断

1. file存在、format、禁止pattern、sizeなど機械判定できる内容はscript / test / CIへ置く。
2. 全作業で必要なhard gateだけをrootへ置く。
3. 特定pathだけに必要な内容はnearest `AGENTS.md`へ置く。
4. 特定taskの手順はSkillへ置く。
5. 理由、比較、詳細checklistはdocsへ置く。
6. tool固有の発動条件だけをadapterへ置く。

rootへ詳細手順を追加する変更は、他の配置で成立しない理由をIssueとPRへ記録します。

## 10. 包括レビュー収束

Contract ID: `DSN-COMPREHENSIVE-REVIEW-ROUNDS`

「包括レビューラウンド」は、同一のverified snapshotと同一のrisk lane集合を対象に、変更全体を再評価する監査です。verified snapshotは対象commitに、review判断へ影響する生成物、設定、実行証拠を対応付けた単位とします。使用したagent、review機能、実行環境が異なっても、対象snapshotとrisk lane集合が同じなら同じ種類の包括レビューとして数えます。

初回包括レビューはlatest meaningful changeを含む配送候補HEADを対象にします。

包括レビューは次の順序と回数で収束させます。

1. 配送候補HEADに対する初回包括レビューを1回実行する。
2. 指摘修正後は変更pathのfocused testを先に実行する。
3. 必要な場合だけ、修正後の再レビューを1回実行する。
4. 3回目以降の包括レビューは原則実行しない。

3回目以降の確認は、次のいずれかを具体的な証拠で確認した場合に限ります。

- 未解決のP0またはP1がある。
- セキュリティ、秘密情報、データ整合性、破壊的操作に関わる未解決事項がある。
- 前回レビュー後に新しい変更pathまたはrisk laneが追加された。
- 前回レビューの対象漏れ、証拠不足、一次証拠との矛盾が具体的に確認された。
- 受け入れ条件またはhard gateを満たさない新しい証拠が得られた。

3回目以降を行う場合も、変更全体の監査をそのまま反復しません。失効した証拠、対象risk lane、変更path、確認する具体的な問いを限定し、additional review justificationとともにrisk lane台帳へ記録します。

P2以下の指摘だけが残る場合も、回数だけで機械的に無視しません。受け入れ条件、verifierの正しさ、利用者に影響する不具合へ直結する指摘は同じPRで解消します。それ以外は影響、non-blockingと判断した根拠、必要なfollow-upを記録し、同一snapshotへの包括レビュー周回を終了します。

review threadへの回答、修正pathだけのfocused確認、既知の指摘に対する回帰testは包括レビューラウンドへ数えません。ただし、これらの名目で変更全体を再監査した場合は包括レビューとして数え、回数制限を迂回しません。reviewが提供されない場合は代替自己レビューと未確認範囲を記録し、特定review機能の不在だけを未完了理由にしません。merge、close、releaseは別の明示指示がある場合だけ行います。

同一snapshotへのclean reviewを増やす目的で包括レビューを反復しません。

検証とreviewは次の順序を原則とします。

1. 実装中は変更pathに対応するfocused testを実行する。
2. 配送候補HEADで初回包括レビューを実行する。
3. 指摘修正後は変更pathのfocused testを実行する。
4. 必要な場合だけ2回目の包括レビューを実行する。
5. review収束後に配送対象の最終HEADを確定する。
6. 最終HEADで必要なfull gateを原則1回実行する。

成功済みのreviewまたはfull gateを再実行する時は、対象変更、生成物変更、環境変更、証拠期限切れなど、前回証拠が失効した具体的な理由をrisk lane台帳へ記録します。

## 11. 機械検証

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

## 12. 変更時の確認

- 3製品のいずれかが共通hard gateへ到達できない状態を残さない。
- adapterだけに新しい品質基準を置かない。
- root縮小で製品固有Skill・nested ruleへのroutingを落とさない。
- adapterのglob / pathを正本の適用範囲と一致させる。
- Node製bootstrapを維持し、Windows開発へUnix shell依存を追加しない。
- UI、runtime、DB、sync、notification、releaseへ影響しないharness変更は、GitHub共同作業面の証跡として評価する。

## 13. Subagent orchestration

サブエージェントは専門riskを独立して並列化するために使い、同じ証拠を読む担当を増やすために使いません。メインエージェントは委任前に、次を満たす重複しないlaneを定義します。

- そのagentだけが担当するrisk lane。
- 対象HEAD、対象path、確認する具体的な問い。
- 既存報告やメインエージェント自身の一次証拠確認では不足する理由。

この3点を定義できない委任は行いません。同じ包括レビューラウンドを複数agentへ同時委任せず、同一HEAD・同一risk laneの独立監査は原則1回とします。担当laneまたは修正pathのfocused再監査を認めるのは、対象コードが変わった、新しい実行証拠が得られた、前回監査に明確な不足がある、または未解決の証拠矛盾がある場合です。変更全体の包括レビューには包括レビュー収束の回数と例外条件を適用し、修正後に変更pathを対象再検証することと、未変更HEADへ同じ監査を繰り返すことを区別します。

監査結果が矛盾した場合は追加agentの多数決を取りません。メインエージェントがsource code、test設定、実際のcommand結果、commit hashなどの一次証拠を確認して解決します。

委任時は全履歴の共有を既定にせず、必要なHEAD、path、acceptance、既知の指摘だけを短く渡します。報告は変更path、P0 / P1、実行結果、未実行項目と残るriskを中心に簡潔にします。

検証と包括レビューの順序、再実行時の証拠失効記録は、包括レビュー収束のsectionに従います。

メインエージェントは次のrisk lane台帳を保ち、担当scopeと結果を統合して重複を止めます。

| Field | Meaning |
|---|---|
| review round | 包括レビューの通算回数。ラウンド外のfocused確認はnot countedと明記 |
| owner | agentまたはメインエージェント |
| verified snapshot | 報告と証拠が対応するcommit、生成物、設定、実行証拠 |
| reviewed risk lanes | 包括レビューまたはfocused確認の対象lane集合 |
| changed paths | 対象pathと、前回snapshotから追加・変更されたpath |
| status | pending / active / passed / finding / blocked |
| invalidation condition | 再検証が必要になる対象変更または新証拠 |
| additional review justification | 追加レビューの例外条件、失効した証拠、限定した具体的な問い |
