# Issue #29 UI/UX review

## 1. Summary

- Issue: [#29](https://github.com/stillshore-chirp/app_day_schedule_next/issues/29)
- PR: 作成後に更新
- Commit: PR head（UI/UXレビュー対象）
- Affected screen / window / state: main window sidebar、Today overview、collapsed / expanded / restored / empty / normal / narrow / 200% text
- OS: macOS native WebView evidence; Windows は未実行
- Decision: Pass（ローカル変更範囲）
- P0 / P1 / P2 counts: 0 / 0 / 0

## 2. User value

- Target user: Todayを主画面として一日の予定と日次テンプレートを比較する個人ユーザー
- Context: ナビゲーションを常時表示しつつ、24時間overviewの横幅を最大限使いたい場面
- Goal: 初期表示を小さなアイコンレールにし、テンプレート編集操作が2レーンの横幅を狭めないようにする
- Supported understand / decide / act / recover: アイコンで画面移動し、必要時だけラベルを展開できる。予定とテンプレートを同幅で比較し、独立した編集ボタンからTemplatesへ移動できる
- Alternative / unnecessary UI: ナビゲーションを隠し切らず、主要画面への到達性を残した。編集ボタンは別menuへ隠さずoverview上に維持した
- Hypothesis / success signal: 初期sidebar幅76px、両track幅一致、編集buttonがlane heading外、toggle選択の復元を自動テストで固定する

## 3. Novice simulation

- 3-second understanding: 左端の選択済みアイコン、上部の展開chevron、Today見出し、24時間の2レーン、独立した「テンプレートを編集」が見える
- First meaningful action: Todayの予定確認／作成。アイコンの意味を確認したい場合はサイドバーを展開する
- Predicted result: 展開すると各アイコンのラベルが現れ、格納すると広いToday領域へ戻る。編集ボタンはTemplates画面へ移動する
- Recovery: 誤って展開・格納しても同じtoggleで即時に戻せる。選択した展開状態は再表示後も保持される
- Confusion: icon-only状態は記号だけでは意味が曖昧になり得るため、各buttonにaccessible nameとhover titleを付けた

## 4. State matrix

- Matrix: [`issue-29-state-matrix.md`](issue-29-state-matrix.md)
- States actually inspected: collapsed、expanded、restored、empty、normal、short viewport、narrow、200% text、loading / errorの既存回帰
- Missing states: Windows native、実スクリーンリーダー、Windows OS scaling 200%

## 5. Accessibility

- Keyboard-only flow: sidebar toggleと全navigationはnative buttonでTab / Enter / Space操作可能。DOM順をtoggle → navigation → Compactとして維持
- Drag equivalent: 非対象。timelineの既存keyboard/direct input equivalentを変更していない
- Focus / restoration: buttonの既存focus outlineと画面遷移後の既存focus管理を維持
- Name / role / state / value: icon-only navigationとCompact actionに`aria-label`、toggleに`aria-expanded` / `aria-controls`、active itemに`aria-current="page"`
- Structure: `aside` / `nav` / `button`を維持し、表示ラベルだけをcollapsed時に隠す
- Contrast / color: active stateは背景色だけでなく`aria-current`を持ち、既存theme / forced-colors指定を変更しない
- Target size: sidebar buttonの既存min-heightと76px rail内のpaddingを維持
- 200% text / high DPI: native screenshotでtoggleと編集buttonの表示を確認
- Status announcements: navigationの格納状態はtoggle自身のnameとexpanded stateで伝える。live regionは不要
- Automated check: App navigation unit、DayOverview component、axe suite、native E2E
- Manual check: macOS native WebView screenshotのnormal / narrow / 200% textを視認

## 6. Visual hierarchy

- Primary action: Todayの「予定」作成を最上位に維持し、sidebar toggleはsubordinateなicon button
- Current / next / selected: Now Dock、current line、selected navigationを変更しない
- Overview / detail: overviewは24時間比較、detailは分単位編集という役割を維持。テンプレート編集buttonをtrack外へ出して比較幅を揃えた
- Density / many items: 初期sidebarを220pxから76pxに減らし、overviewとdetailへ144pxを戻す
- Compact Window: 内容は未変更。main windowからのicon-only actionにnameを保持
- Platform differences: OS固有CSSやshortcutは追加していない

## 7. Copy

- Terminology: 「サイドバーを展開」「サイドバーを格納」を状態に応じて明示
- Local save / sync: 非対象。表示状態だけを端末内`localStorage`へ保存し、予定・同期状態を変更しない
- Error / recovery: toggleは同期不要で即時反映し、同じ操作で回復できる
- Permission / lifecycle: OS権限は不要
- Dangerous operation: なし
- Tone: 操作結果を短い動詞で示し、内部用語を追加していない

## 8. Expert efficiency

- Repetitive tasks: Today確認時は毎回の格納操作が不要。ラベルが必要なユーザーは展開選択を保持できる
- Pointer / keyboard steps: 初期状態0手で広い表示、展開／格納は1操作
- Re-entry / persistence: explicitな展開選択だけを再表示後に復元
- Shortcuts / bulk / templates: 既存のvisible template edit actionを維持し、menu内へ隠していない
- Novice help impact: ラベルは1操作で復元でき、hover titleとaccessible nameも利用できる

## 9. Satisfaction / trust

- Waiting: network / backend待機なしで即時反映
- Success: sidebar幅とラベル表示がその場で変わる
- Failure: `localStorage`書き込み失敗時の特別UIはないが、現在sessionのstateは維持される
- Data / sync / notification trust: schedule、template、Google、notificationの保存契約は変更しない
- Destructive scope: なし

## 10. Domain safety

- Time / DST / recurrence: DOM配置とCSSのみで時間計算を変更しない
- Sync / conflict / offline: navigation表示状態は同期状態と独立
- Migration / backup / restore: schema / IPC / filesystem変更なし
- OS permission / release: capability / CSP / command expose変更なし。macOS DMGを検証・更新し、WindowsはCI build結果を確認する
- N/A reasons: OAuth、DB、通知、時刻Skillの対象契約を変更していない

## 11. Counter-review

- Completion blockers searched: defaultが本当にcollapsedか、labelが支援技術から失われないか、短いwindowで下部navigationへ到達できるか、expanded選択を復元するか、edit buttonがtrack幅を狭めないか、narrow / 200%で操作が消えないか
- Findings: sidebarへ`overflow-y: auto`を追加。icon-only buttonへname/titleを付与。expanded stateの再表示後復元とtrack幅一致をtestで固定
- Missing evidence: Windows native / screen reader実機

## 12. Findings

| Severity | Location | Problem | Impact | Fix | Status |
|---|---|---|---|---|---|
| P1 | Sidebar | 初期220px固定でTodayの横幅を恒常的に消費 | 24時間bar比較が詰まる | 76px icon railを既定にし、明示展開を保持 | fixed |
| P1 | Today overview | template edit buttonがlane heading列を広げる | schedule / template trackの有効幅が減る | buttonをoverview header直下の独立行へ移動 | fixed |
| P1 | Short viewport | navigationがwindow高を超える可能性 | 下部項目へ到達できない | sidebar内部scrollを追加 | fixed |

## 13. Evidence

- Before screenshot: [`Issue #27 empty Today`](../../evidence/issue-27/native-today-empty-after.png)（220px sidebar、編集buttonがtemplate lane heading内）
- After screenshots: [`normal`](../../evidence/issue-29/native-sidebar-collapsed-overview.png)、[`narrow`](../../evidence/issue-29/native-sidebar-collapsed-narrow.png)、[`200% text`](../../evidence/issue-29/native-sidebar-collapsed-text-200.png)
- Tests: App navigation unit、DayOverview component、axe、native short-schedule E2E
- Native manual checks: macOS WebViewのsidebar幅、button位置、track幅、toggle状態を確認
- Redaction check: synthetic / empty dataのみ。account、calendar ID、event本文、token、個人pathを含まない

## 14. Executed validation

| Check | Result | Evidence |
|---|---|---|
| Format / lint / TypeScript | pass | repository frontend gates |
| Frontend unit | pass | App restore / DayOverview placement assertionsを含む |
| Accessibility | pass | axe suite |
| Vite build | pass | production frontend build |
| Native E2E | pass | macOS WebView; normal / narrow / 200% text |
| Repository harness / docs / security / boundaries | pass | standard scripts and `git diff --check` |

## 15. Unexecuted validation

| Check | Reason | Remaining risk | Next action |
|---|---|---|---|
| Windows native install / launch / OS scaling | local host is macOS | Windows font / WebView / installer差分 | Windows CI buildを確認し、実機確認は後続platform matrixで行う |
| Screen reader実機 | 自動axeとDOM inspectionのみ | VoiceOver / Narrator読み上げ順の実機差 | macOS VoiceOver / Windows Narratorで確認する |
