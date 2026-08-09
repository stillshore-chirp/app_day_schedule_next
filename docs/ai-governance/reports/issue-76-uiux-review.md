# Issue #76 アナログ時計 UI/UX Review Report

## 1. Summary

- Issue: #76
- Branch: `codex/issue-76-analog-clock`
- Affected screen: Today ヘッダー、アナログ時計専用ウィンドウ、時計設定オーバーレイ
- OS: macOS / Windows 共通 UI。native 証跡は macOS arm64 の実 WebView
- Decision: local implementation review Pass。PR / CI / review は最新 head の push 後に確認する
- Findings: P0 0、P1 0、P2 2（Windows 実機、VoiceOver / NVDA）

## 2. User value

- Target: 予定を見ながら、別アプリへ切り替えず現在時刻をアナログで常時確認したい個人利用者。
- Goal: Today ヘッダーから1操作で大きな時計を開き、時計盤を主役にしたまま必要な設定だけを呼び出す。
- Understand / decide / act / recover: 3針と数字を最優先にし、デジタル日時は小さな補助表示、設定は右上の独立ボタンへ分離した。設定は閉じるボタン、背景、Escapeで閉じられる。
- Alternative: 見出し、デジタル日時、大きな常設設定カードを縦積みする案は、時計盤を短辺の約36%まで縮小して参照アプリの主従を反転させたため撤回した。
- Success signal: 通常 / 最小ウィンドウの実 WebViewで時計盤外周が短辺の89%から96%に収まり、設定を閉じた状態で常設カードがない。

## 3. Novice simulation

- 3秒: 大きな12数字、60目盛り、3針から時計専用ウィンドウだと判断できる。
- First action: 時刻を見るだけなら操作不要。設定が必要な場合だけ右上のスライダー形ボタンを選ぶ。
- Prediction: 設定ボタンは時計盤の大きさを変えず、その上に設定面を表示する。
- Recovery: 閉じるボタン、背景、Escapeで時計へ戻る。Web Audio開始失敗、always-on-top読込 / 保存失敗は時計を消さず、設定面に回復文を表示する。
- Confusion prevented: 音声出力デバイス選択を置かず、OS既定出力を使うことを設定内とマニュアルで明示した。

## 4. Accessibility

- Keyboard-only: ヘッダー時計と設定ボタンはnative button。Enter / Spaceで起動し、設定内はTab移動、Escapeで閉じる。
- Focus: 設定を開くと閉じるボタンへ移動し、Tab / Shift+Tabを設定内で循環させ、閉じると起点の設定ボタンへ戻す。
- Semantics: 時計盤は現在時刻を含むnamed image、設定はnamed modal dialog、テーマはradio group、sound / always-on-topはcheckbox、音量はnamed range。
- Color: 針、数字、目盛り、設定面はlight / dark tokenを使い、秒針は色だけでなく細い針の形でも区別する。
- Target: ヘッダー時計と設定ボタンは44px。閉じるボタンも44px。
- 200%: 設定面は現在の親領域内で縦scrollし、横overflowを発生させない。
- Automated: component keyboard testとaxe WCAG 2.2 AA serious / critical 0。
- Manual: macOS実WebViewでpointer起動、設定開閉、sound、always-on-top、resize、一窓再利用を確認した。

## 5. Visual hierarchy / efficiency / trust

- 参照アプリは400x400の時計ウィジェット内に直径380pxの外周を描く。移行先も時計盤外周をウィンドウ短辺の約93%とし、通常面から設定カードを除いた。
- デジタル日時と設定ボタンは時計盤上の小さな補助オーバーレイで、時計盤のlayout領域を消費しない。
- 初期ウィンドウと4段階resizeを正方形にし、手動で縦長 / 横長にしても短辺基準で円形を維持する。
- `vh` / `vmin`はmacOS WKWebViewでnative resize後に旧値が残ったため使用せず、更新される親領域の割合だけで再計算する。
- soundは初期OFFで、視覚時刻を置き換えない。常に手前は時計ウィンドウだけへ保存し、失敗時はoptimistic stateを戻す。

## 6. Counter-review

- 時計が再び小さくなる: native E2Eで実際のSVG外周 / viewport短辺を89%から96%に固定し、上下左右がviewport内であることを確認。
- native resize後のはみ出し: 360x360へ縮小した実 WebViewで、古いviewport単位の1.47倍overflowを検出して親割合へ修正した。
- 設定が時計を押し縮める: 設定DOMは閉状態で存在せず、開状態だけfixed overlayとして表示する。
- pointer-only: header launcher、settings、close、各controlはkeyboard等価を持つ。Escapeとfocus restorationをcomponent testで固定。
- 音声デバイス機能の再混入: `select`不在をnative E2Eで確認し、capabilityにもaudio device / shell / filesystem permissionを追加しない。
- clock jump / sleep: 経過加算でなく各更新時にwall clockを再取得する既存実装とunit testを維持。

## 7. Findings

| Severity | Location | Problem | Impact | Fix | Status |
| --- | --- | --- | --- | --- | --- |
| P1 | 専用ウィンドウ | 常設ヘッダーと設定カードにより時計盤が短辺の約36%だった | 時計が主目的に見えず参照アプリ相当でない | 時計盤約93%、設定overlay、正方形windowへ変更 | fixed |
| P1 | 360px native resize | WKWebViewが古い`vh` / `vmin`を保持し時計盤が1.47倍へoverflow | 数字と針が切れる | 親領域のpercentageだけでlayout | fixed |
| P2 | Windows | WebView2 / OS scalingのnative実機未確認 | DPI時の細部差 | Windows CIと実機release smoke | deferred |
| P2 | Screen reader | axeとkeyboardのみでVoiceOver / NVDA未確認 | dialog読上げ順の差 | 対象OSの支援技術smoke | deferred |

## 8. Evidence

- User evidence: 提供スクリーンショットで、時計盤より見出し / 設定カードが面積を使う誤った主従を確認。ユーザー提供画像はrepositoryへ保存しない。
- Reference evidence: `app_analog_clock_2.py`の公開実装で400x400時計ウィジェット、半径190、デジタル日時とalways-on-topの時計上overlayを確認。
- After: [ヘッダー時計](../../evidence/issue-76/native-analog-clock-launcher.png)、[通常時計](../../evidence/issue-76/native-analog-clock.png)、[360px](../../evidence/issue-76/native-analog-clock-narrow.png)、[200%設定](../../evidence/issue-76/native-analog-clock-text-200.png)。
- Native result: 時計固有native E2E 1 test Pass。全native試行では時計testを含む17 Pass、今回と無関係な既存シナリオ2 Fail。
- Redaction: 合成予定だけを使い、account、calendar、event、token、端末pathを画像へ含めない。

## 9. Unexecuted validation

| Check | Reason | Remaining risk | Next action |
| --- | --- | --- | --- |
| Windows native build / install / launch | 現在の実行環境はmacOS arm64 | WebView2のresize / 200% / sound差 | Windows CI / 実機release smoke |
| VoiceOver / NVDA | axeとkeyboard smokeを優先 | modalの実読み上げ順 | 対象OSの支援技術smoke |
| Signed / notarized artifact | 個人用debug build | Gatekeeper配布警告 | release工程で署名 / notarize |
