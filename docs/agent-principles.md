# Agent Principles

この文書は、Day Schedule Nextの設計・実装判断に使うheuristicだけを定めます。hard gateと権限境界はroot [`AGENTS.md`](../AGENTS.md)、委任・証跡・task-stateは [`docs/agent-harness.md`](agent-harness.md)、実行手順は該当Skillを優先します。数値だけでFailにせず、要件、既存構造、変更容易性、誤用リスク、検証可能性を比較します。

## KISSとYAGNI

- 要件を満たす最小の構造から始め、未使用の拡張点、設定、抽象化を先行追加しない。
- nesting、間接参照、dynamic dispatch、DSLは、単純な型と関数より明確な利点がある場合に使う。
- security、data recovery、observability、error handlingに必要な備えは、利用前でも追加できる。

## DRYと正本

- 重複回数だけで抽象化を強制しない。
- 変更理由、lifecycle、contractが同じ重複は共通化し、偶然似ていて別方向へ変化する処理は分ける。
- domain rule、schema、validation、error mapping、redaction、retry、IPC contract、test fixtureは不整合を防げる単位へ集約する。
- 同じ長文をroot、Skill、docs、adapterへ複製せず、正本と短いroutingを分ける。

## SRP、SoC、依存方向

- UI / Presentation、Application、Domain、Infrastructure、Tauri commandの責務と依存方向を区別する。
- domainはpure Rustを保ち、Tauri、SQLx、HTTP、keyring、OS APIの詳細を漏らさない。
- commandはthin adapterとし、SQL、HTTP、merge、recurrence expansionを置かない。
- component内のinvoke、取得、状態、描画、formatting、業務判断は、独立変更・検証できる境界で分ける。
- file分割は行数でなく、公開API、変更理由、test境界、追跡コストで判断する。

## OCPと外部統合

- 種別追加のたびに広範囲の条件分岐を変更する構造では、strategy、registry、exhaustive enumを検討する。
- Google Calendar / Tasks、keyring、notification、clock、repositoryの抽象化は、contract test、障害分離、OS差分に実益がある境界へ置く。
- 一つの実装しかなく差し替え需要もない処理へinterface追加を目的化しない。
- persisted schema、IPC、app identifier、data directory、remote mappingを変える場合は、compatibility、migration、versioning、recoveryを確認する。

## POLAと可読性

- 同種のAPI、async処理、Result、error code、validation messageを一貫したcontractにする。
- 副作用や破壊的操作は名前、引数、戻り値、UI copyから予測できるようにする。
- `sync token`、`etag`、`outbox`、`schema`などの内部用語を利用者向けUIへ出さない。
- commentは処理の逐語説明でなく、コードから分からない理由、invariant、OS制約を補う。

## エラー処理と可観測性

- errorを消すこと自体を目的にせず、根本原因、利用者影響、回復方法を特定する。
- retryable、permanent、auth、conflict、validation、permission、corruptionを区別する。
- fallbackでdata integrity、設定不備、token失効、通知失敗を隠さない。
- structured logはlevel、event、必要最小限のredacted contextを持ち、token、account、予定本文、raw remote payload、絶対pathを出さない。

## Determinism

- wall clockとmonotonic clockを区別し、clock、timezone、locale、random、UUID、port、network、filesystem、OS integrationをtestで制御可能にする。
- timeline、lane assignment、merge、recurrence expansion、notification delivery keyは同一入力で同一結果にする。
- timer testへreal sleepを使わず、observable conditionとfake clockを使う。concurrent sync、retry、restart、sleep / resumeの順序を制御する。

## テスト

- Unit Testをvalue object、time boundary、merge、Focus state、notification keyへ、Integration TestをSQLite migration / transaction、IPC、Google adapterへ、E2Eをcritical flowへ使う。
- native permission、sleep / resume、multi-monitor、installerはaffected OSのmanual matrixで確認する。
- bug修正では修正前に失敗する条件と期待結果を回帰testへ残す。
- coverageは未検査領域を探す信号とし、flaky testはretryで隠さずwait condition、race、clock、environment差を直す。

## Security、依存、file

- dependency追加時はlicense、maintenance、native binary、bundle size、capability、CVE、postinstallを確認する。
- lockfileを依存変更へ追従させ、generated artifact、DB、backup、diagnostics、credentialを追跡しない。
- Tauri capabilityとCSPは最小権限を保ち、remote code、general shell、general filesystemを許可しない。
- Rust production pathで`unwrap`、`expect`、到達可能な`panic!`を使わない。名前は短さより意味を優先する。

## Architecture documentation

architectureを説明する時は、責務、依存方向、transaction boundary、failure mode、extension point、test boundaryを示す。local-first、Outbox、同期、時刻、通知、migration、restore、Tauriの詳細契約はproduct invariants、engineering docs、専門Skillへリンクし、この文書へ複製しない。
