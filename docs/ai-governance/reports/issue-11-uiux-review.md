# Issue #11 UI/UX Review Report

## 1. Summary

- Issue / PR: #11 / PR 作成前
- Commit: 本 PR の最新 head
- Affected screen / window / state: 設定のテーマ選択、全画面の semantic color、コンパクトウィンドウ
- OS: macOS / Windows 共通実装。native 証跡は macOS arm64
- Decision: Pass for implementation; CI / review / Windows 実機確認は完了ゲートに残す
- P0 / P1 / P2 counts: 0 / 1 / 0（P1 は Windows の native WebView 表示未確認）

## 2. User value

- Target user: ライトの眩しさとダークの高い暗部コントラストの中間で、長時間予定を確認したい個人ユーザー。
- Context: 一日の計画・実行中にデスクトップへ表示し続ける場面。
- Goal: 低彩度で中間明度の配色を選び、視認性を保ったまま刺激を抑える。
- Supported understand / decide / act / recover: 「マイルド」という名称で目的を理解し、4 テーマから判断し、保存し、いつでもライト／ダーク／システムへ戻せる。
- Alternative / unnecessary UI: 明るさ slider や個別色 editor は判断負荷と検証範囲を増やすため追加しない。単一 preset とする。
- Hypothesis / success signal: ライトまたはダークを我慢せず、設定から 1 回の選択と保存で継続利用できる。

## 3. Novice simulation

- 3-second understanding: 設定の「テーマ」select に「システム／ライト／マイルド／ダーク」が並び、マイルドが独立した選択肢だと分かる。
- First meaningful action: 「マイルド」を選び「設定を保存」。
- Predicted result: 全画面が灰緑を基調とした中間明度へ変わり、成功表示が出る。
- Recovery: 同じ select から別テーマを選択、または「既定値へ戻す」で system を読み込み、保存する。
- Confusion: 「マイルド」を自動明度調整や OS 追従と誤解しないよう、独立 preset としてのみ表示する。

## 4. State matrix

- Template: [`issue-11-state-matrix.md`](issue-11-state-matrix.md)
- States actually inspected: selected / saved / reload、Settings normal / success / permission、Today empty、Compact empty、system 復帰。
- Missing states: Windows native WebView、実機 VoiceOver / Narrator、全 500 件状態のマイルド screenshot。

## 5. Accessibility

- Keyboard-only flow: native `select` と button のため Tab、矢印、Enter の標準操作契約を維持。pointer 専用操作は追加していない。
- Drag equivalent: テーマ変更に drag はない。
- Focus / restoration: 既存 3px focus ring を `--focus: #245b73` とし、canvas との 3:1 以上を自動検証。
- Name / role / state / value: label「テーマ」、native combobox、visible option「マイルド」、保存 status。
- Structure: 既存 Settings の h1 / h2 と section 構造を維持。
- Contrast / color: 本文 4.5:1、非テキスト 3:1 を基準に 23 組の token pair を自動検証。状態は色だけでなく text / border / label を保持。
- Target size: 既存 native select と共通 button の target size を変更しない。
- 200% text / high DPI: layout や font size を変更せず、macOS Retina の 1180×820 logical viewport で clip がないことを目視。
- Status announcements: 既存保存 status を維持し、テーマ変更による追加 live announcement は増やさない。
- Automated check: unit 62、theme contrast 24 cases、axe suite を最終検証で実行。
- Manual check: macOS native Settings / Today / Compact を目視。screen reader 実機は未実行。

## 6. Visual hierarchy

- Primary action: 設定画面の主操作は従来どおり「設定を保存」。テーマ preset はその入力の一つ。
- Current / next / selected: selected option と保存成功表示で現在値と保存結果を区別。
- Overview / detail: canvas、surface、raised surface、border の段階を低彩度の明度差で維持。
- Density / many items: spacing / layout / virtualization は変更しない。
- Compact Window: 独立 React root でも保存テーマを適用し、現在／次／この後の階層を維持。
- Platform differences: CSS と typed settings contract は共通。macOS WebKit で動的切替を確認、Windows WebView2 は未観測。

## 7. Copy

- Terminology: option 名は短い「マイルド」。内部 token 名や色コードを表示しない。
- Local save / sync: 既存「設定をこの端末に保存しました」を維持し、Google 同期したとは表現しない。
- Error / recovery: 保存 workflow は既存のまま。既定値復元の成功／失敗表示を維持。
- Permission / lifecycle: 通知権限、完全終了、tray の説明を変更しない。
- Dangerous operation: 該当なし。テーマ変更は可逆でデータを変更しない。
- Tone: 「目に優しい」は設計意図として扱い、医療的効果は主張しない。

## 8. Expert efficiency

- Repetitive tasks: 一度保存すれば再起動とコンパクトウィンドウへ自動適用。
- Pointer / keyboard steps: select 1 回、保存 1 回。native keyboard 等価あり。
- Re-entry / persistence: SQLite の既存 Settings 保存を使い、別 storage や毎画面再選択を追加しない。
- Shortcuts / bulk / templates: テーマ専用 shortcut は不要。
- Novice help impact: option を 1 件追加するだけで既存設定の反復操作を妨げない。

## 9. Satisfaction / trust

- Waiting: 保存中は既存 busy 制御、完了時は明示 status。
- Success: 選択直後ではなく保存完了後に全 root を更新し、保存済み値と表示を一致させる。
- Failure: 保存失敗時は bootstrap を更新せず、永続値と表示の不一致を作らない。
- Data / sync / notification trust: テーマは端末ローカル設定。予定本文、Google、通知 delivery へ影響しない。
- Destructive scope: なし。system へ復帰可能。

## 10. Domain safety

- Time / DST / recurrence: 色設定のみで time contract は N/A。
- Sync / conflict / offline: Google sync / Outbox / conflict は N/A。
- Migration / backup / restore: 既存 enum JSON に `mild` を追加し、schema migration は不要。serde / TypeScript contract test で固定。
- OS permission / release: Tauri capability と CSP は変更なし。
- N/A reasons: domain data、IPC 境界、OS 権限を拡張していない。

## 11. Counter-review

- Completion blockers searched: 保存されない、reload で戻る、compact が system のまま、低コントラスト、状態色の意味消失、light / dark regression、pointer 専用化。
- Findings: 初回 native screenshot で WebKit の動的テーマ切替後に継承文字色が白のまま残る P0 を検出。見出し、日付、status、permission を semantic text 色へ明示し、再撮影で修正を確認。compact の独立 root 適用漏れも実装時に修正。
- Missing evidence: Windows native WebView、VoiceOver / Narrator、医療的な眼精疲労評価（製品主張の対象外）。

## 12. Findings

| Severity | Location | Problem | Impact | Fix | Status |
|---|---|---|---|---|---|
| P0 | macOS native dynamic theme | 継承のみの見出し・status が初期 dark 色の白を保持 | マイルド surface 上で読めない | semantic text 色を明示し CSS regression test 追加 | fixed |
| P1 | Compact window | 独立 document root が保存テーマを適用していなかった | main と compact の配色不一致 | CompactApp でも bootstrap theme を適用 | fixed |
| P1 | Windows native | WebView2 の実画面未観測 | platform 固有 rendering risk | Windows release smoke | open platform gate |

## 13. Evidence

- Before screenshots: [`native-settings-light-before.png`](../../evidence/issue-11/native-settings-light-before.png)。同じ設定 surface の既存 light 証跡。
- After screenshots: [`native-mild-settings.png`](../../evidence/issue-11/native-mild-settings.png)、[`native-mild-today.png`](../../evidence/issue-11/native-mild-today.png)、[`native-mild-compact.png`](../../evidence/issue-11/native-mild-compact.png)。
- Trace / video: macOS native embedded WebDriver。video なし。
- Tests: Rust serde、TypeScript contracts、save / apply、compact root、CSS contrast、native save / reload / compact。
- Native manual checks: 3 枚を目視し、選択値、保存 status、空状態、dock、compact heading、clip なしを確認。
- Redaction check: 空の synthetic test DB のみ。account、calendar / event ID、token、個人予定、home path を含まない。

## 14. Executed validation

| Check | Result | Evidence |
|---|---|---|
| Theme contract / persistence | Pass | Rust serde、TypeScript schema、MemoryClient / App interaction |
| Contrast | Pass | text 4.5:1 / non-text 3:1、23 token pairs |
| Native macOS | Pass 1/1 | save、SQLite bootstrap、reload、Today、Compact、system 復帰 |
| Visual inspection | Pass | Settings / Today / Compact after screenshots |
| Full repository gates | 最終検証で再実行 | PR completion report に記録 |

## 15. Unexecuted validation

| Check | Reason | Remaining risk | Next action |
|---|---|---|---|
| Windows native build / WebView2 visual | 現在の host は macOS arm64 | platform 固有の色・native control 差 | Windows release smoke |
| VoiceOver / Narrator full flow | automated semantics と native controls の確認のみ | 読み上げ順・発音差 | 各 OS の screen reader smoke |
| 実ユーザーの長時間評価 | 本変更は preset 実装で医療評価ではない | 個人差のある快適性 | 利用後 feedback で token 調整 |
