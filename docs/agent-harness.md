# エージェントハーネス設計・保守ガイド

この文書は、Codex、Claude Code、Cursorへ同じ品質契約を接続する、正本・読者・委任・証跡・task-stateの最小契約です。説明文は機械検査や製品runtimeの代替ではありません。

## 1. 正本、読者、責務

| 正本 | 主な読者 | 責務 |
|---|---|---|
| `AGENTS.md`、最寄りの`AGENTS.md` | 3製品 | hard gate、権限境界、path契約、最小実行 |
| `CLAUDE.md`、`.claude/rules/`、`.claude/skills/`、`.cursor/rules/` | Claude Code / Cursor | 正本へ到達する薄いrouter |
| `.agents/skills/<name>/SKILL.md` | 3製品 | task固有の発動条件、手順、成果物、停止条件 |
| `docs/ai-governance/` | agent、reviewer | UI/UX、Issue、証跡、完了判定 |
| この文書 | agent、reviewer、保守者 | 読み分け、checkpoint、委任、再利用、runtime境界 |
| `scripts/validate-governance.mjs` | CI、保守者 | file、format、参照、budgetなど決定的なstatic検査 |

Codexはrootから最寄りの`AGENTS.md`と該当Skillを読みます。Claude Codeは`CLAUDE.md`からrootへimportし、path ruleとSkill adapterで接続します。Cursorはrootと`alwaysApply: false`のMDC routerから接続します。adapterへ本文を複製せず、adapterの不在を共通hard gateの代替・解除に使いません。

## 2. 読み分けとpath topology

全体の安全境界と権限はroot、path固有の契約は最寄りの`AGENTS.md`、task手順はSkill、設計heuristicは [`agent-principles.md`](agent-principles.md)、UI/Issue/evidenceの判定基準は [`ai-governance/00-index.md`](ai-governance/00-index.md)とそのリンク先が所有します。全ファイルを常時読ませません。

```text
AGENTS.md
├── apps/desktop/AGENTS.md
│   ├── apps/desktop/src/AGENTS.md
│   ├── apps/desktop/src-tauri/AGENTS.md
│   └── apps/desktop/tests/AGENTS.md
├── docs/AGENTS.md
└── .github/AGENTS.md
```

root外の`UserManual.md`、`README.md`、`OPERATIONS.md`、`SECURITY.md`はrootのpath bridgeから該当正本へ接続します。logic、共有処理、API、型、data契約、複数layerを変える場合は、参照追跡と実code・契約・関連testを入口にします。

共有Skillは `ui-ux-review`、`calendar-sync-review`、`time-notification-review`、`data-migration-review`、`desktop-release-review`、`github-delivery`、`security-publication` です。Skillは実行順序に集中し、詳細checklistは製品docsまたはAI governanceへ置きます。

## 3. Day Schedule固有overlay

WordPack for Englishの共通ガバナンスは、配置、読者、証跡、task-state、static検査の上流baselineです。Day Schedule Nextでは、製品固有のlocal正本を保ったまま適合する契約だけを取り込みます。詳細な固定 provenance は [`13-maintenance-policy.md`](ai-governance/13-maintenance-policy.md) に記録します。

overlayの中心は [`docs/testing/index.md`](testing/index.md) のrisk-based delivery、[`docs/engineering/desktop-platform-and-release.md`](engineering/desktop-platform-and-release.md) のlatest app handoff、変更面に比例するUI証跡です。local-first、Outbox、sync、time、notification、migration、backup、Tauri capability、securityのhard gateは緩和しません。governance / docsだけの変更へnative screenshot、full state matrix、アプリ再生成を定型要求しません。

## 4. hard gateとheuristic

### hard gate

具体的な損害または虚偽を観測可能な証跡で判定できる条件です。

- secret、token、個人データ、実アカウントやraw logの公開
- data loss、silent overwrite、duplicate create、partial migration
- product invariant、公開contract、authentication・authorization・architecture boundaryの破壊
- 未実施検証、未確認OS・本番・runtime状態の成功扱い
- P0、必須CI失敗、重大な未解決指摘、必須証跡の隠蔽
- 無関係な差分、ユーザーデータ、履歴、artifactの破壊

### heuristic

DRY、KISS、SRP、OCP、file分割、coverage、test配分など、複数の妥当解を比較する設計判断です。数値超過や原則不採用だけでFailにせず、品質、保守性、誤用リスク、検証可能性で判断します。

## 5. Instruction budgetと配置

machine verifierは次を上限として検査します。

| 対象 | 上限 |
|---|---:|
| root `AGENTS.md` | 180行 / 16 KiB |
| nested `AGENTS.md` | 100行 / 8 KiB |
| root + 1 nested rule | 24 KiB |
| canonical Skill | 180行 / 16 KiB |
| Claude / Cursor adapter | 30行 / 4 KiB |

file存在、format、frontmatter、参照、budget、禁止patternはscript / test / CIへ置きます。全作業のhard gateだけをroot、path差分をnearest rule、task手順をSkill、理由と詳細checklistをdocs、tool固有の発動条件だけをadapterへ置きます。rootへ詳細手順を追加する理由はIssue / PRへ記録します。

## 6. 配送checkpoint、evidence、task-state

配送は `implementation → focused_verification → code_freeze → measurement → publication_freeze → external_gate → review_fix → accepted` の順に進めます。各checkpointでHEAD / base、入力閉包、owner、終了条件を固定し、高コストgateの開始後は入力を変えません。

stable evidenceはHEAD / base、変更path、関連config、生成artifact、実行条件、結果、artifact参照へ束縛します。CI、review / thread、mergeability、待機status、時刻はvolatile delivery stateとして分けます。path・config・artifact・条件の閉包と交差したgateだけを失効させ、thread解決だけでは失効させません。measurement artifactへのpublication annotationは別gateへ分離し、source-size estimateをtoken telemetryへ格上げしません。

gate ledgerは `gate / phase・HEAD・base / input paths / config / artifacts / conditions / result / artifact reference` を持ち、失効時は理由と再取得範囲を追記します。判定不能をskipや成功へ変換しません。完了済みlaneはstatus、scope / revision、verification、unperformed checks、remaining risks、stop reason、snapshot / diff、artifact referenceを含む短いevidence packageを返します。

Cross-sessionのfield sourceは [`templates/task-state.json`](ai-governance/templates/task-state.json)だけです。resume時は現在のsnapshotとclosureが一致するevidenceを再利用し、長い完了出力を再取得しません。`timeout`は失敗やevidence失効ではなく、laneをrunningのままbackoff付きで再待機します。終端stateでは結果と停止理由を記録し、所有resource・scheduled taskをcleanupして詳細照会を止めます。

## 7. 包括レビュー収束

Contract ID: `DSN-COMPREHENSIVE-REVIEW-ROUNDS`

包括レビューラウンドは、同一verified snapshotと同一risk lane集合に対する変更全体の監査です。agent、review機能、実行環境が変わっても同じ対象なら同じラウンドとして数えます。latest meaningful changeを含む配送候補HEADで初回包括レビューを1回、指摘修正後にfocused checkを行い、必要な修正後の再レビューを1回だけ行います。同一snapshotへのclean reviewを増やしません。

3回目以降の包括レビューは、前回evidenceが次のいずれかで失効した場合だけ許可します。

- 未解決または新規のP0 / P1
- security、secret、data integrity、破壊的操作に関する失効
- acceptanceまたはhard gateを満たさない具体的な新証拠

追加する場合も、失効したevidence、対象path / risk lane、確認する問いだけを限定して台帳へ記録します。新しいpathやlaneの追加は、上記カテゴリのgateを失効させた場合に限ります。P2-onlyの調整、review threadへの回答、focused test、既知指摘の回帰testは包括ラウンドに数えません。ただし受け入れ条件、verifierの正しさ、利用者影響へ直結するP2は同じPRで解消します。

検証順序は、実装中のfocused check、候補HEADの初回包括レビュー、修正後focused check、必要時の一回の再レビュー、最終HEAD確定、必要なfull gate一回です。成功済みgateを再実行する場合は、closure、生成物、環境、証拠期限などの具体的な失効理由を記録します。

## 8. Subagent orchestration

委任は重複しない専門risk laneへ限定します。依頼時にrisk lane、owner、target HEAD / base、target paths、受け入れ条件、`depends_on`、`snapshot_phase`、write ownership、runtime resources、ports、cleanup、`output_cap`、completion、verification、`reuse_evidence`、`invalidation_condition`を固定します。同一PR・同一HEAD・同一risk laneの監査は原則一回です。全履歴を既定で渡さず、必要なsource、path、acceptance、既知の指摘だけを渡します。

timeoutやpartial結果だけでprimaryへ回収しません。同じownerへ一度だけ確認し、進展がなければscope shrink、再割当を行います。primaryが分離可能な作業を直接行う例外は、`specific_reason`、`evidence_subagent_cannot_continue`、`scope_shrink_history`、`reassignment_history`、`primary_only_question`、`target_paths`、`output_cap`を記録します。監査結果の矛盾は多数決にせず、source、設定、実コマンド結果、commit hashで解決します。

risk lane台帳は `review round`（ラウンド外focusedはnot counted）、`owner`、`verified snapshot`、`reviewed risk lanes`、`changed paths`、`status`、`invalidation condition`、`additional review justification`を持ちます。

## 9. runtimeと静的検査の境界

runtime / dev serverを使うlaneは、owner、PID、process group、port、readiness、cleanupを起動前に固定し、終了後にprocess groupとport解放を確認します。不明な実行はcurrent-run evidenceに採用しません。runtimeを使わない場合はその旨を記録します。

`validate-governance.mjs`はstaticな形式・参照・budget検査です。製品version、rule discovery、sandbox、権限、runtime routing、Hookによるcontext注入やpruningを保証しません。configured、observed、unverifiedを分け、static PASSをruntime成功と表現しません。

## 10. Workflow topology

workflowは同じgateを無条件に重複実行せず、classifierの入力閉包と選択結果をquality gateへ集約します。

| surface | contract |
|---|---|
| `.github/workflows/ci.yml` | PR / manual entry、`base...head`または`--full`分類、security scan、選択したgovernance / frontend / native / dependency gate、aggregate quality gate |
| `.github/workflows/dependency-audit.yml` | reusable / scheduled / manualのdependency gate |
| `.github/workflows/native-e2e.yml` | release判断向けmanual native validation |
| `scripts/classify-verification-inputs.mjs` | changed pathから実行面を決め、未知・分類失敗はfail closed |

CIのpending、failure、review、mergeabilityはvolatile stateであり、localのstable evidenceへ混ぜません。

## 11. 完了と機械検証

形式・参照・公開安全性・budgetの中心gateは次で実行します。

```bash
node scripts/validate-governance.mjs
npm run verify:bootstrap
```

`verify:bootstrap`はrepository固有の既存aggregateです。変更範囲に必要なfocused checkとlatest-head CIを選び、同一入力閉包の成功済みgateを重複実行しません。static検査だけで3製品の実際のrule discoveryやdesktopのnative behaviorを確認済みとは扱いません。
