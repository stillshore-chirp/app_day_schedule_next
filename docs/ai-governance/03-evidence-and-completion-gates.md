# 証跡と完了ゲート

この文書は、アプリ本体UIとGitHub共同作業面を区別し、変更を完了扱いするための証跡と判定条件を定義します。

## 1. 対象面

最初に `02-uiux-review-framework.md` で分類します。

| 対象面 | 必要な証跡 |
|---|---|
| アプリ本体UI | 画面、状態、操作、accessibility、前後差分、native behavior |
| GitHub共同作業面 | 文言、項目、順序、必須性、Markdown / YAML / frontmatter、link、公開安全性 |
| 混在 | 両方を別々に満たす |
| N/A | UIまたは共同作業面を変更しない理由 |

## 2. アプリ本体UIの証跡

変更に該当する範囲で、次から判断に必要なものを残します。全項目を定型的に別成果物へしません。

- 対象ユーザー、目的、支援するtask
- 変更画面、component、window、state、input、output
- novice simulation
- state matrix
- accessibility
- visual hierarchy、copy
- expert efficiency
- satisfaction / trust
- counter-review
- Unit / Integration / E2E、manual observation
- affected OS、app version / commit
- 未実行検証、その理由、残るリスク

### 前後screenshot

visual / layout / copyの意味が変わるアプリ本体UIまたはrepository独自UIでは、該当画面・状態の変更前後screenshotをPRへ添付します。同じviewport、OS、synthetic fixtureで比較します。

表示差分を持たないnative interaction、data contract、内部状態変更は、focused test、accessibility tree、native observation、保存結果など、変更を直接判定できる証跡を優先します。意味のないbefore / after screenshotや全state matrixを要求せず、非該当理由をPRへ短く記録します。

取得できない場合は、取得できなかった検証、理由、代替証跡、残るリスク、次に必要な確認を示します。受け入れ条件上必須なら完了扱いにしません。

### native evidence

- browser previewだけでTauri WebView、OS permission、tray、notification、installerを確認済みにしない。
- mock Google testを実アカウント・実データ確認として扱わない。
- screenshotをkeyboard / accessibility tree / data recoveryの代替にしない。
- build成功、install済み、launch済み、permission確認済みを別の状態として記録する。

## 3. GitHub共同作業面の証跡

Issue / PR template、repository Markdown、workflow説明、agent ruleでは次を確認します。

- 変更した文言、項目、順序、必須性、設定
- Markdown、YAML、frontmatter、glob / path、instruction budget
- link、command、移動先file
- 正本とadapterの重複
- 公開安全性
- previewや実ページ確認の要否
- 未実行検証と残るリスク

GitHubが所有する未変更のlayout、keyboard、focus、loadingへアプリ本体UIと同じstate matrixを要求しません。screenshotはrepository独自の視覚構成・操作が変わる場合、受け入れ条件、明示依頼がある場合に取得します。

## 4. 共通完了ゲート

- 依頼の成果と受け入れ条件を満たす。
- product invariantとarchitecture boundaryを保つ。
- P0が残っていない。
- 対象面に対応する証跡がある。
- 実行した検証と結果を示す。
- 未実行検証、その理由、残るリスクを示す。
- 実施していない確認を成功扱いしていない。
- 公開物の安全性を確認している。
- 無関係な差分やユーザーデータを破壊していない。

## 5. アプリ本体UIの完了ゲート

- ユーザー価値を説明できる。
- initial comprehensionと主要状態を確認している。
- accessibility、visual hierarchy、copy、efficiency、trustを確認している。
- counter-reviewを実施している。
- visual / layout / copyへ影響する場合、必要な前後screenshotをPRで確認できる。
- time / sync / migration / platformへ影響する場合、該当Skillのmatrixを満たす。
- ユーザー向けdesktop runtimeを変更した場合、[`docs/engineering/desktop-platform-and-release.md`](../engineering/desktop-platform-and-release.md) のlatest app handoffに従い、checksum、復旧可能なinstall、launch証跡を残す。

## 6. Pull Requestの完了ゲート

PRをreadyまたはmerge可能として報告する場合は次を満たします。

- latest headの必須CIが成功している。
- latest meaningful changeに対する利用可能な自動・手動reviewを確認している。
- actionableな未解決review threadがない。
- reviewが提供されない場合は、代替自己reviewと未確認範囲を記録している。
- draft状態、pending check、権限上の未完了を明示している。

同じheadでclean reviewを複数回集める必要はありません。指摘対応でheadが変わった場合だけCIと該当reviewを再確認します。mergeまたはcloseは別の明示指示がある場合だけ行います。

## 7. 推奨検証

変更範囲に応じて選びます。

- harness / Markdown / YAML / frontmatter / link / security scan
- format、lint、typecheck
- Unit / Integration / contract / property test
- native E2E
- axe-core、keyboard walkthrough、accessibility tree
- screenshot / visual diff
- content stress、narrow、200% text
- macOS / Windows manual matrix

利用できない検証を捏造せず、理由と残るリスクを報告します。

## 8. 報告

`templates/completion-gate-report.md` を使うか、同等の情報をPR本文へ記録します。今回の対象面と未確認範囲が伝わる項目だけを具体的に書きます。
