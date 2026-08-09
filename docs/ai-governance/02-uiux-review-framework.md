# UI/UXレビュー・フレームワーク

この文書は、Day Schedule NextのUI/UXを評価する中心規約です。

## 1. 対象面と所有境界

証跡の範囲は、表示場所と、変更対象のUI・操作を誰が制御しているかで決めます。

| 対象面 | 例 | repositoryが制御するもの | 適用するreview |
|---|---|---|---|
| アプリ本体UI | Tauri WebView、window、notification、installer内UI | layout、操作、状態、focus、accessibility、copy | 本文書の全経路とnative証跡 |
| GitHub共同作業面 | Issue / PR template、repository Markdown、workflow説明 | 文言、項目、順序、必須性、Markdown、設定 | 内容・構造・link・公開安全性 |
| 混在 | app UIとtemplateを同時変更 | 両方 | 一方の証跡で他方を代用しない |
| N/A | UIや共同作業面を変更しない | なし | 理由を短く記録 |

GitHub共同作業面では、GitHubが提供しrepositoryが変更していないlayout、keyboard、focus、loadingまで検査対象を広げません。GitHub Pagesやrepository独自UIはアプリ本体UIとして扱います。

## 2. 品質の定義

対象ユーザーが、一日の予定を把握・設計・実行・回復でき、現在の状態を理解し、失敗から戻れ、慣れれば速く、安心して使えることを評価します。

評価軸:

1. Utility: 一日の把握・設計・実行・回復に役立つか。
2. Initial comprehension: 今日、現在、選択、主操作が分かるか。
3. Interaction: 分単位編集を安全・高速に行えるか。
4. State design: empty / offline / conflict / permission / errorが明確か。
5. Accessibility: keyboard、focus、drag equivalent、name / role / state。
6. Visual hierarchy: overview、detail、Now、Inspector、Compactの優先度。
7. Copy: local / remote / delete / permission / notificationの結果が正確か。
8. Efficiency: 予定作成・調整・再利用の反復手数。
9. Trust: データ、同期、backup、notificationの安心と回復。
10. Evidence: native state、test、screenshot、manual observation。

## 3. review pipeline

### 目的・価値

- 対象ユーザーと利用文脈を特定する。
- 支援する理解、判断、行動、回復を明確にする。
- 既存UIで目的を達成できる場合、追加UIの必要性を再評価する。

### 初見理解

短時間で次を判断できるか確認します。

- 何の画面か。
- 今日・現在・表示範囲・選択対象は何か。
- 最初の行動と主操作は何か。
- 操作結果と回復方法は何か。

### 状態

normalだけで判断せず、該当するstate matrixを作ります。

- empty、loading、partial、no result、error、validation、disabled
- offline、retry、conflict、auth expired
- permission unknown / denied / granted
- narrow、200% text、long content、500 items
- current none / one / multiple、cross-midnight、overlap

### 操作とaccessibility

- 主要導線をkeyboardだけで完了する。
- drag、resizeへkeyboardまたは直接入力の等価操作を用意する。
- focus order、visible focus、restoration、modal escapeを確認する。
- name / role / state、contrast、target size、reduced motion、live regionを確認する。
- 色だけでcategory、conflict、sync、priority、currentを表さない。

### 視覚階層とcopy

- Today、現在、次、主操作が先に見える。
- overview、detail、Now Dock、Compact、Inspectorが同じ状態を矛盾なく示す。
- internal termをUIへ出さない。
- errorは原因、影響、data retention、recoveryを示す。
- local save、remote sync、delete scope、notification deliveryを正確に表す。

### 効率と信頼

- 予定作成、複製、時間調整、翌日繰越、template、Focus、sync retryの手数を数える。
- 前回設定、calendar、filter、duration、viewを必要に応じて保持する。
- 危険でない操作へ確認dialogを乱発しない。
- pending、failure、conflict、restoreで入力と予定が消えたように見せない。

### 反証

- 500件、長い日本語、23:59、日跨ぎ、DSTで崩れないか。
- pointerだけで成立していないか。
- current-time line、overlap、Compactでfocusが隠れないか。
- offlineなのにsync済みに見えないか。
- local deleteとremote deleteが曖昧でないか。
- macOS固有の見た目やshortcutをWindows共通仕様としていないか。
- mock / browser previewだけをnative証跡としていないか。

## 4. P0

次は完了不可です。

- 対象ユーザー、user goal、supported actionを説明できない。
- Today、current date、primary action、selected targetが認識できない。
- drag-only interactionにkeyboard / direct input equivalentがない。
- empty、loading、offline、conflict、permission、errorを混同する。
- local savedとGoogle syncedを同じ表示にする。
- destructive / remote-impact actionに対象、影響、recoveryがない。
- keyboard trap、invisible focus、missing accessible name、color-only state、読めないcontrast。
- current-time line、overlap、Compactで操作対象が隠れる。
- userを責めるcopy、false reassurance。
- 対象面に必要なstate matrix、counter-review、evidence、未実行報告がない。
- data loss、silent overwrite、duplicate、token exposureへつながるUIを残す。

## 5. P1 / P2

### P1

原則として同じ変更内で修正します。

- label、terminology、shortcutが不統一。
- empty、success、errorのnext actionが弱い。
- timeline density、time label、overlap orderingが読みづらい。
- 反復操作に回避可能な余分な手順がある。
- previous settingやselectionが不必要に失われる。
- pending、retry、conflictのscopeが曖昧。
- macOS / Windowsのcopy、shortcut、menu差が不自然。

### P2

- spacing、animation、microcopyの改善。
- additional shortcut、bulk action、customization。
- onboardingの改善。
- measurementや実ユーザー調査が必要な仮説。

## 6. 画面固有の確認

- **Today**: date、view range、current time、create、current / next / remaining / free time、overlap、cross-midnight。
- **Inspector**: selection scope、time、timezone、calendar、recurrence、notification、validation、unsaved state。
- **Compact**: actionableなcurrent / next / remaining / Focus、topmost、keyboard access、screen bounds。
- **Sync / Conflict**: account / calendar scope、local / remote差分、retry、re-auth、merge結果。
- **Ticket / Kanban**: column scope、priority、archive、dragとkeyboard移動、Schedule linkage、hidden item ordering。
- **Backup / Restore / Import**: candidate、counts、warnings、overwrite impact、backup、cancel / rollback。

## 7. 証跡の強さ

1. affected OSのnative E2E / manual observation
2. deterministic integration / component test
3. screenshot / video / trace
4. static code inspection
5. reasoning only

低い層の証跡だけで、高い層のnative behaviorや実ユーザー観察を確認済みにしません。
