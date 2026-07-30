# Issue #18 UI/UX Review Report

## 1. Summary

- Issue / PR: Issue #18 / PR 作成前
- Commit: 本 PR の最新 head
- Affected screen / window / state: Today、Templates選択、通常、予定0件、テンプレート0件、blocks 0件、loading、error、ID不一致、重複、日跨ぎ、狭幅、200% text、500件
- OS: macOS / Windows 共通実装。native 証跡は macOS arm64
- Decision: Pass for implemented scope — macOS native E2EとUI反証レビューは完了。repository gateはCIとreview完了後に確定する
- P0 / P1 / P2 counts: 0 / 1 / 0（Windows native visual未確認）

## 2. User value

- Target user: 実際の予定と、自分が基準にしている一日の型を見比べながら一日を調整する個人ユーザー。
- Context: Todayを開き、予定作成前または実行中に時間配分のずれを判断する場面。
- Goal: Todayを離れず、同じ24時間軸で実予定と選択テンプレートの差を把握する。
- Supported understand / decide / act / recover: 実際と基準を理解し、予定作成・調整を判断し、予定を操作し、テンプレート取得失敗だけを再試行できる。
- Alternative / unnecessary UI: Templates画面だけで確認する代替は画面往復と時刻位置の記憶を要求する。Todayからの直接適用・block編集は操作対象を混ぜるため追加しない。
- Hypothesis / success signal: 初見で上下の意味を区別し、テンプレートblockを予定と誤認せず、明示buttonから編集へ移れる。

## 3. Novice simulation

- 3-second understanding: board見出し「予定と日次テンプレート」、上段「実際の一日 / 今日の予定」、下段「参照専用 / テンプレート名」で比較対象を認識する。
- First meaningful action: 上段の予定を選択、予定0件なら「予定を作成」、型を直すなら「テンプレートを編集」。
- Predicted result: 予定選択はInspector、テンプレート編集はTemplates画面の選択中editorへ移る。
- Recovery: template query失敗は下段の再試行だけで回復し、予定操作は失わない。設定保存失敗はTemplates画面で再選択を案内する。
- Confusion: 色だけでは上下を区別せず、テンプレートblockをbuttonやtab stopにしない。Todayからの適用buttonを置かない。

## 4. State matrix

- Template: [`issue-18-state-matrix.md`](issue-18-state-matrix.md)
- States actually inspected: component/pure testのnormal、schedule empty、template empty、blocks empty、loading、error、ID fallback、selection persistence failure、1分、5分境界、chain overlap、cross-midnight、500件。macOS nativeのnormal、schedule empty、720px narrow、200% text。
- Missing states: Windows WebView2 / Narrator native visual。

## 5. Accessibility

- Keyboard-only flow: 予定は既存button、作成とテンプレート編集はnative button。テンプレートblockはtab stopにせず、編集buttonを1つに集約。
- Drag equivalent: 下段はdrag機能を持たない。上段予定のdrag / direct input / keyboard契約は変更しない。
- Focus / restoration: Todayの編集buttonからTemplatesへ移動した時、`tabIndex=-1` の選択editor見出しへfocusを移す。
- Name / role / state / value: board `h2`、lane `section + h3`、予定buttonのtitle/time/pressed/sync、テンプレート`listitem`のtitle/time/continuation。
- Structure: 共通軸は `aria-hidden`、上下laneは別見出し、参照blockと操作buttonを分離。
- Contrast / color: lane種別、参照専用、同期、翌日継続をtextでも示す。既存schedule color / focus tokenを維持。
- Target size: 予定、作成、編集、再試行は既存button token。テンプレートblockは操作対象ではない。
- 200% text / high DPI: lane headingをwrap、基準時刻labelを2行へreflow。
- Status announcements: schedule / template loadingをlane内のstatusで分離し、現在時刻の毎分移動は読み上げない。
- Automated check: `pnpm test:a11y` 3 files / 7 tests、axe serious / critical 0。
- Manual check: macOS native keyboard、720px、200% textをembedded WebDriverで確認。VoiceOver / Narrator実機は未実行。

## 6. Visual hierarchy

- Primary action: Today上部の「＋予定」と詳細タイムラインを維持。overviewは比較情報として下位。
- Current / next / selected: 既存Now、予定selection、current-time lineを維持。下段へselectionやsync stateを流用しない。
- Overview / detail: overviewは分布比較、detailは予定編集。テンプレート詳細編集はTemplates画面へ分離。
- Density / many items: laneごとに8 visual levelsを上限とし、超過を「ほかN件」で示す。
- Compact Window: 変更なし。
- Platform differences: layout/CSSは共通。font renderingとscaleはWindows native残リスク。

## 7. Copy

- Terminology: 「実際の一日」「今日の予定」「参照専用」「日次テンプレート」で実装用語を出さない。
- Local save / sync: 下段表示を保存・適用・同期と表現しない。
- Error / recovery: 「日次テンプレートを読み込めませんでした」と「再試行」を下段へ限定。
- Permission / lifecycle: 変更なし。
- Dangerous operation: Todayからテンプレート適用・削除を追加しない。
- Tone: 空状態と失敗でユーザーを責めず、次の操作を1つ示す。

## 8. Expert efficiency

- Repetitive tasks: Todayを見たまま実予定と型を比較し、予定選択または1 clickでテンプレートeditorへ移動。
- Pointer / keyboard steps: テンプレート確認は0操作、編集は1 click / keyboard activation。予定編集手数は不変。
- Re-entry / persistence: `lastTemplateId`を既存settingsで保持し、再起動不要でbootstrapを更新。
- Shortcuts / bulk / templates: 既存予定shortcutとTemplates編集を維持。Todayへ新しい適用操作を増やさない。
- Novice help impact: 長い説明を常時表示せず、lane種別の短いlabelだけを追加。

## 9. Satisfaction / trust

- Waiting: 下段だけをloadingにし、予定が消えたように見せない。
- Success: 選択保存成功後にTodayのテンプレート名が再起動なしで変わる。
- Failure: 選択設定の保存失敗を握りつぶさず、表示反映と次回復元が一致しない可能性を明示。
- Data / sync / notification trust: template queryはread-only。表示・編集遷移だけで予定作成、適用、Google writeを呼ばない。
- Destructive scope: なし。

## 10. Domain safety

- Time / DST / recurrence: Scheduleは既存の選択日clamp、TemplateBlockはUTC変換せずMinuteOfDayを使用。24:00でclampしcontinuation metadataを保持。
- Sync / conflict / offline: DB、Outbox、Google commandを変更しない。上段の既存sync表現のみ保持。
- Migration / backup / restore: schema / Rust / IPC変更なし。
- OS permission / release: Tauri capability、CSP、window contract変更なし。frontend buildとnative E2Eを実施。
- N/A reasons: notification、Focus、OAuth、migration、installerの挙動は変更しない。

## 11. Counter-review

- Completion blockers searched: 予定0件でboard消失、template failureでToday停止、blockの暗黙Schedule変換、上下level干渉、無制限な高さ、5分境界、日跨ぎ折返し、色のみ、tab stop化、設定保存失敗の握りつぶし、検索scope混同。
- Findings: 既存の予定0件分岐がboardを完全に消すP0、template選択のsettings保存失敗を握りつぶすP0、重なりcomponentが全項目を別levelへ置くP1を検出。board常時表示、typed query state分離、失敗status、最小level再利用へ修正。
- Missing evidence: Windows native visual、VoiceOver / Narrator。

## 12. Findings

| Severity | Location            | Problem                                 | Impact                             | Fix                                     | Status             |
| -------- | ------------------- | --------------------------------------- | ---------------------------------- | --------------------------------------- | ------------------ |
| P0       | Today empty branch  | 予定0件で24時間boardが消える            | 型を参照して予定を作れない         | boardを常時表示し上段内に作成CTA        | fixed              |
| P0       | Templates selection | `updateSettings`失敗を握りつぶす        | 次回復元済みと誤認する             | error statusとbootstrap invalidation    | fixed              |
| P1       | overview layout     | transitive component全件を別levelへ置く | chain overlapと500件で高さが増える | deterministicな最小level再利用と8段上限 | fixed              |
| P1       | Windows native      | WebView2 / Narrator未観測               | font/reflowのplatform差            | Windows native release validation       | open platform gate |

## 13. Evidence

- Before screenshots: [`native-today-before.png`](../../evidence/issue-18/native-today-before.png)。
- After screenshots: [`normal`](../../evidence/issue-18/native-today-after.png)、[`schedule empty`](../../evidence/issue-18/native-today-empty-after.png)、[`720px narrow`](../../evidence/issue-18/native-today-narrow-after.png)、[`200% text`](../../evidence/issue-18/native-today-text-200-after.png)。
- Trace / video: macOS embedded WebDriverで16 testsを実行。videoなし。
- Tests: pure layout、component、query/navigation integration、axe、native E2E。
- Native manual checks: 共通軸、独立した上下track、現在時刻線の同一X座標、最大重なり高さ、日跨ぎlabel、空状態、720px、200% root font、編集後focusを確認。
- Redaction check: synthetic title / project / categoryだけを使用し、account、calendar/event ID、token、home pathを含めない。

## 14. Executed validation

| Check                                              | Result | Evidence                                                                                      |
| -------------------------------------------------- | ------ | --------------------------------------------------------------------------------------------- |
| Pure layout / component / navigation focused tests | Pass   | 5 files / 26 tests                                                                            |
| Frontend full suite / coverage                     | Pass   | 16 files / 91 tests、statements 92.41%、branches 85.13%                                       |
| Format / lint / TypeScript / production build      | Pass   | Prettier、ESLint 0 warnings、`tsc -b`、Vite 511 modules                                       |
| Accessibility                                      | Pass   | 3 files / 7 tests、axe serious / critical 0                                                   |
| Rust all-feature                                   | Pass   | fmt、clippy `-D warnings`、108 tests                                                          |
| Tauri debug build                                  | Pass   | macOS arm64 app / DMG                                                                         |
| macOS native E2E                                   | Pass   | 3 specs / 16 tests、real Tauri / IPC / SQLite                                                 |
| Today visual regression                            | Pass   | mismatch 0.000% / limit 4.000%                                                                |
| Harness / docs / security / boundaries             | Pass   | 81 files / 5 skills、113 links、227 text files、47 frontend / 29 Rust files、i18n / workflows |

## 15. Unexecuted validation

| Check                            | Reason            | Remaining risk                    | Next action                     |
| -------------------------------- | ----------------- | --------------------------------- | ------------------------------- |
| Windows native visual / Narrator | hostはmacOS arm64 | WebView2 font / scale /読み上げ差 | Native release validation `all` |
