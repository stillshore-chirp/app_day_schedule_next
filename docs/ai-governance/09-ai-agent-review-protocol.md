# AIエージェントレビュー・プロトコル

この文書は、AIエージェントがUI/UXレビューを実行する時の手順を定義します。UI変更レビューでは、既存のフロー監査と同じ証跡体系を使いながら、変更scopeとfindingの由来を追加で確定します。

## 1. 目的

AIエージェントに「良さそう」と判断させるのではなく、観察、判定、反証、証跡提出を強制します。

## 2. 推奨ロール

1つのエージェントが実行する場合でも、次のロールを分けてください。

### 2.1 Scope評価者

UI変更レビューで差分を扱う場合は、target snapshot / ref、base / head ref / SHA、追加・削除差分、Issue / PR / commit messageの変更意図、直接consumerと代表surfaceのcoverageを確定します。shared primitive、global token、common componentの変更は代表surfaceへ展開し、findingをIntroduced / Regression / Pre-existingへ分類します。Pre-existingは通常の変更起因件数・責任から分離して記録しますが、変更目的または安全性を阻害するP0/P1等のblocking findingは完了可否と判定理由へ残し、scopeと完了判断を見直します。

### 2.2 実装者

要件を実装します。ただし、自分の実装を最終承認してはいけません。

### 2.3 価値評価者

対象ユーザー、目的、支援するタスク、意思決定への貢献を確認します。

### 2.4 初見ユーザー

画面を初めて見た前提で、目的、現在地、最初の行動、結果予測、回復手段を確認します。

### 2.5 認知負荷監査者

記憶要求、選択肢過多、内部用語、過剰説明、判断負荷を確認します。

### 2.6 アクセシビリティ監査者

キーボード、フォーカス、名前、ラベル、構造、コントラスト、ターゲット、状態通知を確認します。

### 2.7 視覚階層批評者

重要度と見え方の一致、主操作、情報密度、余白、グルーピング、スキャン性を確認します。

### 2.8 状態設計監査者

通常状態以外の状態を確認し、状態ごとの理解と次アクションを確認します。

### 2.9 熟練者評価者

反復作業の手数、再入力、確認の過剰さ、ショートカット、一括操作、復帰性を確認します。

### 2.10 信頼感評価者

待機、成功、失敗、危険操作、権限、個人情報、削除、送信、公開の安心感を確認します。

### 2.11 反証レビュアー

実装を落とすつもりで、P0を探します。

### 2.12 検証報告者

実行した検証、実行していない検証、残リスクを明示します。

## 3. 実行順序

```txt
レビュー経路の確定（UI変更レビュー / フロー監査 / 併用）
↓
差分を伴う場合のtarget snapshot / ref、base / head、変更意図、追加・削除、影響surfaceの確定
↓
ユーザー価値評価
↓
初見シミュレーション
↓
state matrix
↓
認知負荷確認
↓
アクセシビリティ確認
↓
視覚階層確認
↓
コピー確認
↓
熟練者効率確認
↓
満足感・信頼感確認
↓
変更差分reviewではfindingをIntroduced / Regression / Pre-existingへ分類
↓
反証レビュー
↓
証跡・未実行検証の報告
```

フロー監査または併用を選んだ場合は、Skillの重要stepの順序と03のcurrent-run証跡を同じ報告へ接続します。変更差分reviewのscope記録で、フロー監査のstep証跡を置き換えません。

## 4. 反証レビューのルール

反証レビューでは、次の態度を取ります。

- 実装を褒める前に、完了不可理由を探す。
- diffの追加側だけでなく、削除されたlabel、state、recovery、responsive、copy、token等のsignalを確認する。
- 通常状態以外を重点的に見る。
- スクリーンショットがhappy pathだけではないか疑う。
- shared primitive、global token、common componentの変更が未確認surfaceへ届いていないか確認する。
- 自動検査で検出できない使いにくさを探す。
- 初心者向け配慮が熟練者効率を壊していないか疑う。
- ユーザーに不安や責任転嫁を与えていないか疑う。
- 証跡が実際の確認を示しているか疑う。
- base側でも同じ問題が再現する場合、今回のRegressionと誤分類していないか確認する。
- Pre-existingを通常の変更起因findingや件数・責任へ混ぜていないか確認する。ただし、変更目的または安全性を阻害するP0/P1等のblocking findingを完了可否・判定理由から落としていないか、scopeと完了判断を見直したか確認する。

## 5. 出力の制約

禁止:

- 「問題ありません」とだけ報告する。
- 検証していないことを確認済みにする。
- 実ユーザーから得ていない反応を、ユーザー事実のように書く。
- 理論名だけを並べて指摘にしない。
- P0をP1やP2に格下げする。
- Pre-existingを今回の変更findingへ混ぜる。
- 未確認surfaceをreview済みと表現する。

必須:

- Pass/Failを明示する。
- 変更差分reviewではtarget snapshot / ref、base / head、追加・削除、変更意図、影響surface、coverageを明示する。
- P0/P1/P2を分ける。
- Introduced / RegressionとPre-existingを分け、Pre-existingの通常の変更起因件数・責任を分離する。変更目的または安全性を阻害するP0/P1等のblocking findingは完了可否・判定理由へ残し、scopeと完了判断を明示する。
- 証跡を示す。
- 未実行検証を示す。
- 残リスクを示す。

## Day Schedule Nextのレビュー境界

変更差分のレビューでは、shared UI primitive、design token、IPC clientの表示契約などから、Today / timeline / Compact / Ticket / Sync / Dataの代表surfaceへ影響を展開します。product invariantやarchitecture boundaryの変更をUI品質だけで承認せず、該当domain Skillと [docs/testing/index.md](../testing/index.md) のrisk laneへ接続します。

レビュー時は次の反証を追加します。

- 1分保存と5 / 10 / 15分等の表示snap、23:59、日跨ぎ、DST、複数current、overlapで、表示・入力・回復の意味が一致するか。
- local-first、Outbox、offline、410 / 412 / 429 / auth expired、conflictで、保存済み・同期待ち・未解決を誤表示しないか。
- notification permission、tray / complete exit、Focus phase、timer再起動で、能力・状態・delivery結果を誤って成功扱いしないか。
- backup / restore / import、delete、template replaceで、対象・件数・rollback・現DB保持が説明されるか。
- macOSとWindowsのscale、window bounds、keyboard / menu差、native notificationを一方のOSだけで一般化していないか。

AIの初見シミュレーションやstatic inspectionは、実ユーザー観察、実アカウント、実DB、OS permission、production挙動の証拠ではありません。実施していない境界をunexecuted validationと残し、P0 / P1 / P2の判定とは分けて報告します。
