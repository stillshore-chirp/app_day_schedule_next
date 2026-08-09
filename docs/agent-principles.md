# Agent Principles

この文書は、Day Schedule Nextで設計・実装を判断するためのheuristicをまとめます。実行順、安全境界、完了条件はroot [`AGENTS.md`](../AGENTS.md)、ルール配置は [`docs/agent-harness.md`](agent-harness.md) を優先します。

## Hard gateとheuristic

この文書の原則は原則としてheuristicです。複数の原則が競合する場合は、今回の要件、既存構造、変更容易性、誤用リスク、データ安全、検証可能性を比較します。

次はhard gateです。

- secret、個人予定、認証情報を公開しない
- product invariant、データ整合性、公開contractを壊さない
- 未実施の検証や未確認のOS・実機状態を確認済みとして報告しない
- P0、必須CI失敗、重大な未解決指摘を隠して完了扱いにしない
- 無関係な差分、ユーザーデータ、履歴、artifactを破壊しない

数値目安を超えたことだけでFailにせず、利用者と変更者が安全に扱えるかで判断します。

## 長期タスク

- 最初に目標、完了条件、非対象、依存関係、検証方法を明らかにする。
- boundedな依頼は、真のblockerがない限り調査、実装、検証、配送まで同じ作業で完遂する。
- 長期化する場合は `plans/` にcompleted、pending、next action、verification、riskを追跡可能な形で残す。
- vertical sliceごとにbehavior、test、docsを接続し、UIだけ・DBだけの長い未接続状態を避ける。
- 再実行される副作用にはidempotency、checkpoint、deduplicationを検討する。

## ドキュメント

- 実装、挙動、セットアップ、architecture、quality gateの意味が変わったら対応する正本を同じ変更で更新する。
- READMEは入口、UserManualは利用者向け操作、engineering docsは技術契約、OPERATIONSは復旧・運用とする。
- 同じ長文を複数文書へコピーせず、正本と要約linkを分ける。
- 作業メモや将来予定を恒久文書へ混ぜず、現時点のcontract、制約、手順を書く。
- 公開物では `security-publication` Skillを適用する。

## KISSとYAGNI

- 要件を満たす最小の構造から始め、使われない拡張点や設定を先行追加しない。
- nesting、間接参照、macro、dynamic dispatch、DSLは、単純な型と関数より明確な利点がある場合に使う。
- 将来可能性だけを理由にinterface、factory、plugin、feature flagを増やさない。
- security、data recovery、observability、error handlingに必要な備えは、利用前でも追加できる。

## DRYと正本

- 重複回数だけで抽象化を強制しない。
- 変更理由、lifecycle、contractが同じ重複は共通化を検討する。
- 偶然似ている処理や別方向へ変化する処理は分けて保つ。
- 共通化で呼び出し側の意図が隠れる場合は、明示的な重複を許容する。
- domain rule、time conversion、error mapping、redaction、retry、IPC contract、test fixtureは不整合を防げる単位へ集約する。
- TypeScriptとRustへ同じdomain判断を独立実装せず、Rust domainとtyped IPC contractの責務を明示する。

## SRP、SoC、依存方向

- UI / Presentation、Application、Domain、Infrastructure、Tauri commandの関心を区別する。
- domainはpure Rustを保ち、Tauri、SQLx、HTTP、keyring、OS APIの詳細を漏らさない。
- commandはthin adapterとし、SQL、HTTP、merge、recurrence expansionを置かない。
- component内のinvoke、取得、状態、描画、formatting、業務判断を、独立変更・検証できる責務に沿って分ける。
- file分割は行数だけで決めず、公開API、変更理由、test境界、追跡コストで判断する。
- logging、metrics、retry、redaction、authorizationなどの横断的関心は一貫して適用できる境界へ置く。

## OCPと外部統合

- providerや種別追加のたびに広範囲の条件分岐を変更する構造では、strategy、registry、exhaustive enumを検討する。
- Google Calendar / Tasks、keyring、notification、clock、repositoryの抽象化は、contract test、failure isolation、OS差分に実益がある境界へ置く。
- 一つの実装しかなく差し替え需要もない処理へ、interface追加を目的化しない。
- persisted schema、IPC、app identifier、data directory、remote mappingを変える場合は、compatibility、migration、versioning、recoveryを検討する。

## POLAと可読性

- 同種のAPI、async処理、Result、error code、validation messageを一貫したcontractにする。
- 副作用や破壊的操作は名前、引数、戻り値、UI copyから予測できるようにする。
- `sync token`、`etag`、`outbox`、`schema`などの内部用語を利用者向けUIへ出さない。
- commentはコードから分からない理由、invariant、OS制約を補い、処理内容の逐語説明を避ける。
- 新規参加者が安全な変更箇所と検証方法を判断できる情報を残す。

## エラー処理と可観測性

- errorを消すこと自体を目的にせず、根本原因、利用者影響、回復方法を特定する。
- retryable、permanent、auth、conflict、validation、permission、corruptionを区別する。
- fallbackでデータ不整合、設定不備、token失効、通知失敗を隠さない。
- user messageは何が起きたか、影響、data retention、recoveryを示す。
- structured logはlevel、event、必要最小限のredacted contextを持つ。
- token、account、予定本文、raw remote payload、絶対pathをlogへ出さない。

## Determinism

- wall clockとmonotonic clockを区別し、clock、timezone、locale、random、UUID、port、network、filesystem、OS integrationを注入可能にする。
- timeline layout、lane assignment、merge、recurrence expansion、notification delivery keyは同一入力で同一結果にする。
- timer testへreal sleepを使わず、observable conditionとfake clockを使う。
- concurrent sync、manual retry、app restart、sleep / resumeの順序をtestで制御する。

## テスト

- Unit Testをvalue object、time boundary、merge、Focus state、notification keyへ使う。
- Integration TestをSQLite migration / transaction、IPC contract、Google mock、adapter contractへ使う。
- E2EをToday、編集、同期状態、backup / restoreなどのcritical flowへ絞る。
- native permission、sleep / resume、multi-monitor、installerはaffected OSのmanual matrixで確認する。
- bug修正では修正前に失敗する条件と期待結果を回帰testへ残す。
- coverageは未検査領域を探す信号として使い、critical branchの証跡を数値で代替しない。
- flaky testはretryで恒久的に隠さず、wait condition、race、clock、environment差を直す。

## Security、dependency、file

- dependency追加時はlicense、maintenance、native binary、bundle size、capability、CVE、postinstallを確認する。
- lockfileを依存変更へ追従させ、generated artifact、DB、backup、diagnostics、credentialを追跡しない。
- Tauri capabilityとCSPは最小権限を保ち、remote code、general shell、general filesystemを許可しない。
- Rust production pathで `unwrap`、`expect`、到達可能な `panic!` を使わない。
- nameは短さより意味を優先し、一般的でないabbreviationを避ける。
- Rustは`rustfmt`、TypeScriptはrepository formatterを正本とする。

## Architecture documentation

architectureを説明する時は、責務、依存方向、transaction boundary、failure mode、extension point、test boundaryを示します。図がなくても別の開発者が安全な配置と検証を判断できる粒度にします。
