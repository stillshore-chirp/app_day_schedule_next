# 証跡と完了ゲート

この文書は、アプリ本体UIとGitHub共同作業面を区別し、変更を完了扱いする証跡と判定条件を定義します。差分レビューでは、比較snapshot、追加・削除、影響coverage、変更意図、findingの由来を既存証跡へ統合します。

## 1. 対象面

最初に [`02-uiux-review-framework.md`](02-uiux-review-framework.md) で分類します。

| 対象面 | 必要な証跡 |
|---|---|
| アプリ本体UI | 画面、状態、操作、アクセシビリティ、必要な前後差分、native behavior |
| GitHub共同作業面 | リポジトリが制御する文言、項目、順序、必須性、Markdown / YAML / frontmatter、link、公開安全性 |
| 混在 | 両方を別々に満たす |
| N/A | UIまたはGitHub共同作業面を変更しない理由 |

表示場所だけで分類しません。リポジトリが独自のlayout、操作、状態を実装する画面はアプリ本体UIとして扱います。

## 2. 変更scopeの証跡
<!-- agent-harness:uiux-change-scope-evidence:start -->

差分を伴うUI変更では、品質判定前に比較対象と影響範囲を固定します。これはUI影響の証跡であり、GitHub配送一般の完了条件ではありません。

| 項目 | 記録 |
|---|---|
| Target snapshot / ref | working tree、base / head ref、PR等のレビュー対象 |
| Base / Head ref・SHA | 比較に使ったbaseとhead |
| 変更内容 | 追加側・削除側と、Issue / PR / 受け入れ条件から確認した意図 |
| Expanded surfaces | changed fileの直接consumer、parent、route、state、代表surface |
| Coverage / unknowns | 確認したsurface、未確認consumer、除外と理由 |

changed fileは入口であり、直接変更箇所だけにレビューを限定しません。shared primitive、global style / token、common component、themeは代表consumerへ展開し、未確認範囲を残します。追加側と削除側を同じ重さで確認し、削除されたlabel、semantic element、focus、state、recovery、responsive rule、copy、tokenに等価な代替があるかを見ます。
<!-- agent-harness:uiux-change-scope-evidence:end -->

## 3. アプリ本体UIの証跡

該当する範囲で次を残します。

- 対象ユーザー、目的、支援するtask
- 変更画面、component、window、state、input、output
- 初見シミュレーション、state matrix、accessibility、visual hierarchy、copy
- 熟練者効率、trust、counter-review
- 実行したtest、manual observation、未実行検証、理由、残るrisk

### 前後screenshot

visual / layout / copyが変わるアプリ本体UIでは、同じviewport、OS、synthetic fixtureでbefore / afterを比較し、base / head、state、runtime条件、artifact参照を記録します。表示差分を持たないnative interaction、data contract、内部状態変更は、focused test、accessibility tree、native observation、保存結果を優先し、意味のないscreenshotや全state matrixを要求しません。

UIの受け入れ判断に使うafterは、確認対象の変更が反映されたheadから取得します。対象surfaceへ影響する変更やruntime条件が変われば取り直します。必須証跡を取得できない場合は、理由、代替証跡、残るrisk、次の確認を記録し、受け入れ条件上必須なら完了扱いにしません。

### native evidenceとruntime

- browser previewだけでTauri WebView、OS permission、tray、notification、installerを確認済みにしない。
- mock Google testを実アカウント・実データ確認として扱わない。
- screenshotをsemantic structure、keyboard / accessibility、data recovery、時間変化の代替にしない。
- build、install、launch、permission確認は別の状態として記録する。

runtimeを証跡に使う場合は、実際に観察した環境、対象surface、状態、結果を記録します。静的確認やbrowser previewだけでnative desktop、OS permission、実アカウントの挙動を確認済みとしません。

## 4. フロー監査の証跡

複数stepの体験を監査する場合は、対象surface、ユーザー目的、取得手段、開始・完了状態、順序付き重要step、各stepの操作・画面・stateを記録します。現在の監査実行で取得・保存・検査したscreenshotまたは取得不能の具体的blocker、navigation、focus、loading、validation、recovery、empty state、motionの観測をfindingへ接続します。

誤画面、blank、loading中、文脈を隠すcrop、別window、half-rendered画像は採用せず再取得します。screenshotだけでsemantic structure、accessible name、contrast、focus順序、keyboard完走、支援技術通知、時間変化を確認済みとはしません。重要stepを実行証跡で支えられない場合は、監査できた範囲だけを報告し、完全なフロー監査として完了扱いにしません。

## 5. 変更由来findingの証跡
<!-- agent-harness:uiux-finding-provenance:start -->

| Change status | 判定 |
|---|---|
| Introduced | head側の今回の変更が新しい問題を作った |
| Regression | base側で成立していた品質が今回の変更で弱くなった |
| Pre-existing | base側にもあり、今回の変更が作成・弱体化していない |

IntroducedとRegressionは今回のfindingとしてseverity、修正状態、証跡を記録します。Pre-existingは今回の変更起因件数・責任から分離し、必要なら別Issueまたはscope変更として追跡します。変更目的や安全性を阻害するP0 / P1は別Issue化だけでblockingを解除しません。同じroot causeは一件へ統合し、未確認consumerをreview済みと表現しません。
<!-- agent-harness:uiux-finding-provenance:end -->

## 6. GitHub共同作業面の証跡

Issue / PR template、repository Markdown、workflowの入力・説明では、変更した文言・項目・順序・必須性、Markdown / YAML / frontmatter / glob、link・command・移動先、公開安全性、preview要否、未実行検証とriskを確認します。GitHubが所有し、リポジトリが変更していないlayout、keyboard、focus、loading、permission stateへ、アプリ本体UIと同じstate matrixやnative screenshotを要求しません。

## 7. 完了ゲート

### 共通

- 依頼の成果と受け入れ条件を満たし、P0が残っていない。
- 対象面の証跡、実行済み検証と結果、未実行検証と理由、残るriskを示す。
- 未実施の確認を成功扱いせず、公開安全性を確認する。

### アプリ本体UI

- ユーザー価値、初見理解、主要state、accessibility、visual hierarchy、copy、efficiency、trust、counter-reviewを確認する。
- visual差分がある場合は必要なbefore / afterを確認する。runtimeを使った場合は実際に観察した環境と挙動を証跡へ結び付ける。
- time / sync / migration / platformへ影響する場合は該当Skillのmatrixを満たす。
- desktop runtime変更では [`docs/engineering/desktop-platform-and-release.md`](../engineering/desktop-platform-and-release.md) のlatest app handoffに従い、checksum、復旧可能なinstall、launch証跡を残す。

### UI変更差分

- target snapshot、base / head、意図、追加・削除、consumer展開、coverage、未確認範囲を記録する。
- Introduced / Regressionを今回の判定対象にし、Pre-existingの責任と件数を分離する。ただしblockingなP0 / P1は完了可否へ残す。

### GitHub共同作業面

- 文言、構造、必須性、link、公開安全性を変更範囲に比例して確認する。
- アプリ本体UI用のscreenshot、runtime、native evidenceを要求しない。

## 8. 製品検証と報告

アプリとdomainの検証範囲は [`docs/testing/index.md`](../testing/index.md) と該当 Skill を参照します。UI / UX または GitHub共同作業面の結果は、実行した確認、未確認範囲、残るriskを [`templates/completion-gate-report.md`](templates/completion-gate-report.md) または同等の記録へまとめます。
