# Issue #23 UI/UX review

## 1. Summary

- Issue: [#23](https://github.com/stillshore-chirp/app_day_schedule_next/issues/23)
- PR: [#24](https://github.com/stillshore-chirp/app_day_schedule_next/pull/24) (non-Draft)
- Commit: `f5b8b40f4175ac848f558d81dbbbc875ef690663`
- Affected screen / window / state: Today overview、実予定レーン、テンプレートレーン、normal / overlap / cross-midnight / empty / narrow / 200% text / forced colors
- OS: macOS native evidence、Windows は CI/native workflowで確認
- Decision: Pass; required CI succeeded and no review threads remain
- P0 / P1 / P2 counts: 0 / 0 / 0

## 2. User value

- Target user: 一日の予定を24時間軸で素早く判別したい個人ユーザー
- Context: Today画面で実予定と日次テンプレートを同じ時間軸で比較する場面
- Goal: バーを詳細画面へ移動せず、番号・開始時刻・タイトルを対応付ける
- Supported understand / decide / act / recover: 内容と順序を理解し、重複を区別し、予定を選択/編集し、完全なaccessible nameと既存Inspectorで回復する
- Alternative / unnecessary UI: 外部ラベルレールを追加せず、既存の二つのバー内部へ情報を配置
- Hypothesis / success signal: 30〜60分バーが番号だけにならず、native DOM/visual evidenceで3情報と60px高、縮小gapを確認できる

## 3. Novice simulation

- 3-second understanding: Today、00〜24時軸、上段の予定、下段の型が既存見出しで分かり、バー内の番号・時刻・タイトルが対応する
- First meaningful action: 番号とタイトルを見て予定バーを選択、または空状態の「予定を作成」を押す
- Predicted result: 実予定は選択状態とInspector、テンプレートは参照専用のまま編集導線が表示される
- Recovery: 誤選択は別バーを選択でき、完全な時刻範囲はtitle/accessible nameと編集パネルに残る
- Confusion: 極端に狭い幅では文字が途中でclipされるが、省略記号や番号だけの表示にはしない

## 4. State matrix

- Template: [`issue-23-state-matrix.md`](issue-23-state-matrix.md)
- States actually inspected: normal、30〜60分、overlap、cross-midnight、empty/loading/error、720px、200% text、forced colors、pending、selected/focus
- Missing states: Google/offline/conflict/permission/Focus/backupは表示状態を変更していないため、既存回帰へ委譲

## 5. Accessibility

- Keyboard-only flow: 実予定バーはbuttonとしてtab/focus/Enterで選択。テンプレートは参照専用listitemを維持。
- Drag equivalent: この変更はdrag操作を変更しない。既存の詳細タイムラインのdirect input/keyboard equivalentを保持。
- Focus / restoration: selected `aria-pressed` と既存focus outlineを保持。
- Name / role / state / value: 実予定はタイトル・開始・終了を含むaria-label/title、templateは完全な時刻範囲と翌日継続を含むaria-label/title。視覚番号は重複読み上げを避けaria-hidden。
- Structure: 実予定はbutton、templateはlistitem。両方とも視覚順は番号→開始時刻→タイトル。
- Contrast / color: 既存のバー境界、pending点線、選択outline、forced-colorsを保持。
- Target size: バー高60pxと既存button操作対象を保持。
- 200% text / high DPI: native 200% evidenceでlane overflowと情報順序を確認。
- Status announcements: loading status、既存empty/error statusを変更しない。
- Automated check: `pnpm test:a11y` と native DOM assertions
- Manual check: macOS native screenshots、focus/selection、forced-colors static review

## 6. Visual hierarchy

- Primary action: Today既存の予定作成/選択を維持
- Current / next / selected: 現在時刻線、selected outline、既存Now表示を維持
- Overview / detail: overviewは番号/開始/タイトルの高速判別、detailは分単位編集という役割を維持
- Density / many items: 単一levelは76pxレーン、複数levelは3px gap、バーは60px、最大8levelと超過件数を維持
- Compact Window: 非対象。既存compact markup/styleを変更していない
- Platform differences: CSS container queryと標準button/listitem構造のみを使い、OS固有の配置を追加していない

## 7. Copy

- Terminology: 既存の「今日の予定」「日次テンプレート」「翌日へ継続」を維持
- Local save / sync: `data-sync="pending"` と既存表示を変更していない
- Error / recovery: loading/error/empty/retryの既存文言を維持
- Permission / lifecycle: 非対象、既存表示を維持
- Dangerous operation: 非対象
- Tone: 新規文言なし。UserManualにバーの読み方を追記

## 8. Expert efficiency

- Repetitive tasks: バー内情報だけで対象を判別でき、詳細を開く前の往復を減らす
- Pointer / keyboard steps: 実予定のbutton選択と既存keyboard flowは変更なし
- Re-entry / persistence: DB/同期の保存経路は変更なし
- Shortcuts / bulk / templates: テンプレートレーンの独立採番と参照専用を維持
- Novice help impact: 番号→時刻→タイトルの固定順が反復利用でも視線移動を抑える

## 9. Satisfaction / trust

- Waiting: loadingは下段だけに残り、上段の予定が消えない
- Success: 選択・focus・現在時刻線は既存の視覚反応を保つ
- Failure: template error/empty/retryは既存表示を保つ
- Data / sync / notification trust: UI表示のみで、local/remote truthや通知モデルを変更しない
- Destructive scope: なし

## 10. Domain safety

- Time / DST / recurrence: 表示開始は当日segmentのminute、accessible nameは既存のfull schedule range。時刻モデルは変更しない
- Sync / conflict / offline: 非対象。既存のpending/状態UIを保持
- Migration / backup / restore: 非対象
- OS permission / release: macOS native evidence、Windows workflowを確認対象とする
- N/A reasons: React/CSSとテスト/証跡のみの変更

## 11. Counter-review

- Completion blockers searched: duration-based micro hiding、ellipsis、gap 6px、single-level 115px、overlap boundary、selection/focus/pending/current line、accessible name、720px、200% text
- Findings: implementation initially had micro hiding and ellipsis; both removed. gap reduced to3px, single-level lane to76px while block remains60px
- Remaining platform risk: Windows native screenshot/evidence was not available on the macOS host; the implementation uses standard CSS container queries and semantic HTML without OS-specific branches

## 12. Findings

| Severity | Location | Problem | Impact | Fix | Status |
|---|---|---|---|---|---|
| P0/P1/P2 | pre-#23 `.overview-event` / `.overview-template-block` | duration-based micro state hid all text and ellipsis shortened title | short bars were not self-identifying | width-based content layout and clip | fixed |

## 13. Evidence

- Before screenshots: [`issue-21/native-today-after.png`](../../evidence/issue-21/native-today-after.png)、[`issue-21/native-today-narrow-after.png`](../../evidence/issue-21/native-today-narrow-after.png)、[`issue-21/native-today-text-200-after.png`](../../evidence/issue-21/native-today-text-200-after.png) at pre-#23 `origin/main`
- After screenshots: [`native-today-after.png`](../../evidence/issue-23/native-today-after.png)、[`native-today-empty-after.png`](../../evidence/issue-23/native-today-empty-after.png)、[`native-today-narrow-after.png`](../../evidence/issue-23/native-today-narrow-after.png)、[`native-today-text-200-after.png`](../../evidence/issue-23/native-today-text-200-after.png)、[`native-short-schedule-after.png`](../../evidence/issue-23/native-short-schedule-after.png) after native run
- Trace / video: native geometry JSON and WebdriverIO assertions
- Tests: DayOverview component, styles, a11y, short schedule E2E, native smoke, visual snapshot comparison
- Native manual checks: macOS arm64 native WebView via Tauri E2E; Windows delegated to CI matrix
- Redaction check: synthetic titles only; no account, calendar ID, event ID, path, token, or personal data

## 14. Executed validation

| Check | Result | Evidence |
|---|---|---|
| Repository harness, links, security, boundaries | pass | required repository checks passed |
| Formatting, lint, TypeScript build | pass | direct local equivalents passed |
| Full component/unit suite | pass | 16 files / 94 tests passed |
| Accessibility suite | pass | 3 files / 7 tests; axe serious/critical 0 |
| Rust workspace fmt / tests | pass | `cargo fmt --all -- --check`; 107 + 1 Rust tests passed |
| Short-schedule native E2E | pass | 1 test passed; 30-minute bar retained index/start/title DOM content |
| Native smoke E2E | pass | 14 tests passed; 60px bars, 3px level gap, no lane overflow |
| Visual baseline comparison | pass | `native-today.png` mismatch 0.000% against updated baseline |

## 15. Unexecuted validation

| Check | Reason | Remaining risk | Next action |
|---|---|---|---|
| `pnpm install --frozen-lockfile` wrapper command | local `pnpm` is fallback 11.9.0 while package metadata requires 11.17.0; it also attempted registry access | package-manager-specific local reproduction remains unverified | use the repository-pinned pnpm in CI or a matching local Corepack runtime |
| Windows native evidence | local host is macOS | platform font/container query difference | confirm required native workflow CI |
| CI and post-CI review threads | pass | required checks succeeded; GraphQL reviewThreads and PR comments are empty | no follow-up required |
