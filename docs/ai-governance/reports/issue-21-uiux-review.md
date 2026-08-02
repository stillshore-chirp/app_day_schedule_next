# Issue #21 UI/UX Review Report

## 1. Summary

- Issue / PR: Issue #21 / PR作成前
- Commit: 本PRの最新head
- Affected screen / window / state: Today overview、empty、normal、overlap、cross-midnight、720px、200% text
- OS: macOS / Windows共通CSS。native証跡はmacOS arm64
- Decision: Pass for implemented scope — repository gateはCI/review完了後に確定する
- P0 / P1 / P2 counts: 0 / 1 / 0（Windows native visual未確認）

## 2. User value

- Target user: 一日の時間配分を短時間で把握し、予定を選択・調整する個人ユーザー。
- Context: Todayの全体像から実予定と一日の型を比較する場面。
- Goal: 主役のスケジュールを細い線として探すのではなく、十分な高さの面として認識する。
- Supported understand / decide / act / recover: 予定名・時刻・重なりを理解し、選択またはテンプレート編集を判断・実行する。
- Alternative / unnecessary UI: カード全体の増高は詳細タイムラインを押し下げるため採用せず、余っている横方向へ見出しを移す。
- Hypothesis / success signal: ストリップ46px→115px、block24px→60pxで予定領域の視認優先度が上がる。

## 3. Novice simulation

- 3-second understanding: 上部の共通見出し、左の「実際の一日 / 今日の予定」「参照専用 / テンプレート名」、右の24時間分布を順に認識する。
- First meaningful action: 実予定を選ぶ。空なら予定作成、型を直すならテンプレート編集。
- Predicted result: 既存InspectorまたはTemplatesへ移る。
- Recovery: loading/error/emptyの既存CTAを維持する。
- Confusion: 左見出しと右trackをgridで同一sectionに保ち、上下の操作対象を混ぜない。

## 4. State matrix

- Template: [`issue-21-state-matrix.md`](issue-21-state-matrix.md)
- States actually inspected: componentのnormal、empty、overlap、cross-midnight、loading、error。macOS nativeのnormal、empty、overlap、720px、200% text。
- Missing states: Windows WebView2 / Narrator。

## 5. Accessibility

- Keyboard-only flow: DOMとbuttonを変更せず、見出しは視覚的に左へ移すだけ。
- Drag equivalent: 操作仕様を変更しない。template blockは引き続き参照専用。
- Focus / restoration: schedule buttonのfocus outlineとTemplates遷移後focusを維持。
- Name / role / state / value: schedule buttonとtemplate listitemのtitle/timeを維持。
- Structure: lane section内をheading→trackのDOM順で保持。
- Contrast / color: forced colorsでschedule/template双方へ境界を付ける。
- Target size: schedule blockを60pxへ拡大。templateは操作対象ではない。
- 200% text / high DPI: 左レール内を折返し、grid rowは内容に応じて伸長可能。
- Status announcements: 既存lane statusを維持。
- Automated check: axe 3 files / 7 tests、serious / critical 0。
- Manual check: macOS native 14 testsでkeyboard導線、720px、200% text、block/track実寸を確認。

## 6. Visual hierarchy

- Primary action: 予定の時間面積を拡大し、見出しは左レールへ退避。
- Current / next / selected: 現在時刻線、selected outlineを維持。
- Overview / detail: overviewカード高を増やさず、下の詳細timelineを押し下げない。
- Density / many items: 60px block + 6px gap、8 level上限を維持。
- Compact Window: 変更なし。
- Platform differences: CSS共通。macOS WebKitを確認し、Windows font/reflowは未確認。

## 7. Copy

- Terminology: 既存コピーを維持し、内部用語を追加しない。
- Local save / sync: 変更なし。
- Error / recovery: 変更なし。
- Permission / lifecycle: N/A。
- Dangerous operation: N/A。
- Tone: N/A。

## 8. Expert efficiency

- Repetitive tasks: 予定を見つけて選択する視認時間を短縮する仮説。
- Pointer / keyboard steps: 不変。
- Re-entry / persistence: 不変。
- Shortcuts / bulk / templates: 不変。
- Novice help impact: 説明を増やさず、見出し位置だけを再配分。

## 9. Satisfaction / trust

- Waiting / Success / Failure: 既存状態を広いtrack内で維持。
- Data / sync / notification trust: 表示専用変更でcommand、DB、同期状態を変更しない。
- Destructive scope: なし。

## 10. Domain safety

- Time / DST / recurrence: X座標・clamp・accessible timeを変更しない。
- Sync / conflict / offline: 既存schedule sync表現を維持。
- Migration / backup / restore: N/A。
- OS permission / release: capability / CSP変更なし。
- N/A reasons: 表示密度だけの変更。

## 11. Counter-review

- Completion blockers searched: カード増高、見出しと軸のずれ、重複block overflow、短時間予定の時刻誤認、720px/200% clipping、focus隠れ。
- Findings: 横方向に余裕があるのに見出しが縦方向を消費していた。左レールへ移し、trackとblockを2.5倍にする余地へ再配分。
- Missing evidence: Windows native visual / Narrator。

## 12. Findings

| Severity | Location        | Problem                                 | Impact                     | Fix                       | Status             |
| -------- | --------------- | --------------------------------------- | -------------------------- | ------------------------- | ------------------ |
| P0       | overview strips | 46px track / 24px blockが主役として細い | 時間配分と予定を探しづらい | 115px track / 60px block  | fixed              |
| P1       | WebKit grid     | `min-height`だけでは重複時に115pxへ縮む | 2段目が20px overflow       | 計算済み`height`も明示    | fixed              |
| P1       | Windows native  | WebView2 / Narrator未観測               | font/reflowのplatform差    | Windows native validation | open platform gate |

## 13. Evidence

- Before screenshots: [`Issue #18 current-state native`](../../evidence/issue-18/native-today-after.png)、ユーザー提供画像（追跡外）。
- After screenshots: [`normal / overlap`](../../evidence/issue-21/native-today-after.png)、[`schedule empty`](../../evidence/issue-21/native-today-empty-after.png)、[`720px narrow`](../../evidence/issue-21/native-today-narrow-after.png)、[`200% text`](../../evidence/issue-21/native-today-text-200-after.png)。
- Tests: DayOverview component 9 tests、frontend 92 tests、axe 7 tests、macOS native 14 tests。
- Native manual checks: 60px block、115px single-level strip、346px overview card、重複overflow 0、左見出しと時間軸の整列、keyboard/focus、720px、200% text。
- Redaction check: native fixtureはsynthetic dataだけを使用する。

## 14. Executed validation

| Check                                  | Result | Evidence                                                                    |
| -------------------------------------- | ------ | --------------------------------------------------------------------------- |
| Agent harness                          | Pass   | 81 required files / 5 skills                                                |
| DayOverview component                  | Pass   | 9 tests                                                                     |
| TypeScript / targeted ESLint           | Pass   | 0 errors / 0 warnings                                                       |
| Frontend full / coverage               | Pass   | 16 files / 92 tests、statements 92.41%、branches 85.13%                     |
| Accessibility                          | Pass   | 3 files / 7 tests、axe serious / critical 0                                 |
| macOS native E2E                       | Pass   | 14 tests、60px / 115px / overview 346px、overflow 0                         |
| Today visual regression                | Pass   | intentional baseline更新、mismatch 0.000%                                   |
| Harness / docs / security / boundaries | Pass   | 81 files / 5 skills、119 links、230 text files、47 frontend / 29 Rust files |
| Rust all-feature                       | Pass   | fmt、clippy `-D warnings`、108 tests                                        |
| macOS debug app / DMG                  | Pass   | arm64 appとunsigned debug DMGをbuild                                        |

## 15. Unexecuted validation

| Check                            | Reason            | Remaining risk                    | Next action                     |
| -------------------------------- | ----------------- | --------------------------------- | ------------------------------- |
| Windows native visual / Narrator | hostはmacOS arm64 | WebView2 font / scale /読み上げ差 | Native release validation `all` |
| CI / review                      | push前            | 統合環境・review指摘              | PR作成後に確認                  |
