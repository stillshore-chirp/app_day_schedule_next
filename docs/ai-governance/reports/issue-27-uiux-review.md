# Issue #27 UI/UX review

## 1. Summary

- Issue: [#27](https://github.com/stillshore-chirp/app_day_schedule_next/issues/27)
- PR: 未作成（この作業ではローカル実装と検証まで）
- Commit: 未作成
- Affected screen / window / state: Today overview、実予定レーン、テンプレートレーン、normal / empty / overlap / cross-midnight / narrow / 200% text
- OS: macOS native WebView evidence; Windows は未実行
- Decision: Pass（ローカル変更範囲）
- P0 / P1 / P2 counts: 0 / 0 / 0

## 2. User value

- Target user: 一日の予定と基本テンプレートを同じ24時間軸で比較する個人ユーザー
- Context: Today overviewで、バーの位置と空き時間を素早く読む場面
- Goal: 3時間単位より細かい時間位置を読み取り、実予定とテンプレートの両方で同じ視覚手がかりを得る
- Supported understand / decide / act / recover: 時間位置、実績/型の違い、予定選択、テンプレート編集導線を理解する。既存の選択・編集・再試行で回復する
- Alternative / unnecessary UI: 新しい操作や状態を追加せず、既存の共通軸とレーン背景を揃えた

## 3. Novice simulation

- 3-second understanding: 「今日の予定」と「参照専用」の上下関係、00〜24時軸、1時間ごとの区切りが分かる
- First meaningful action: 実予定を選択、予定がなければ「予定を作成」、型を直すなら「テンプレートを編集」
- Predicted result: 予定は既存Inspector、テンプレートは既存Templates画面へ移動する
- Recovery: 誤選択は別の予定を選べ、空・loading・errorは既存の状態と導線で戻れる
- Confusion: 狭幅・200% textではラベル密度が上がるため、native screenshotで既存の折り返しと操作導線を確認した

## 4. State matrix

- Template: [`issue-27-state-matrix.md`](issue-27-state-matrix.md)
- States actually inspected: normal、empty、overlap、cross-midnight、narrow、200% text、loading/error/empty component states
- Missing states: Windows native、screen reader実機、Google/offline/conflict/permission/Focus/backupは未変更のため既存回帰へ委譲

## 5. Accessibility

- Keyboard-only flow: この変更は操作対象を追加・削除せず、予定button、テンプレートlistitem、既存の編集buttonを維持
- Drag equivalent: 非対象。詳細タイムラインの既存keyboard/direct input equivalentを変更していない
- Focus / restoration: 既存の予定選択outline、TodayからTemplatesへのfocus復帰を維持
- Name / role / state / value: DOM/ARIA構造、予定の完全なaccessible name、テンプレートの時刻範囲を変更していない
- Contrast / color: グリッドは色だけで操作状態を示さず、forced-colorsの既存指定を維持
- Target size: 既存の予定作成・編集buttonと60pxバーを維持
- 200% text / high DPI: native screenshotと既存のgeometry assertionsで確認
- Automated check: component tests 10件、a11y suite 7件
- Manual check: macOS native WebViewのnormal / empty / narrow / 200% text screenshot

## 6. Visual hierarchy

- Primary action: Todayの予定作成と予定選択を維持
- Current / next / selected: 現在時刻線、Now Dock、選択状態を維持
- Overview / detail: overviewは分布比較、detail timelineは分単位編集という役割を維持
- Density / many items: 1時間グリッドは時間位置を補助し、既存のバー、level、overflow summaryを隠さない
- Platform differences: OS固有CSSや色を追加していない

## 7. Copy / efficiency / trust

- Copy: UserManualに1時間目盛りと両レーンの背景手がかりを追記。新しい状態・内部用語・警告は追加していない
- Expert efficiency: 縦線が増えることで、バーの開始時刻を目視で照合する往復を減らす。操作手数と保存経路は不変
- Satisfaction / trust: 表示上の比較手がかりだけを増やし、local save、Google sync、template read-only semanticsを変更していない

## 8. Counter-review

- Searched: 25 tick count、両レーンのcomputed background、overlap geometry、empty/narrow/200% screenshot、template read-only semantics
- Finding fixed: `background` shorthandと`color-mix()`を共有変数化した際、WebViewでテンプレートレーンのbackground-imageが無効化されたため、`background-image`と`background-color`を分離した
- Finding fixed: native geometryの非同期読み込みraceで、overlap heightがsettleする前に測定していたため、証跡テストにwait conditionを追加した
- Remaining risk: Windows native screenshotとscreen reader実機は未実行

## 9. Evidence

- Before: [`native-today-before.png`](../../evidence/issue-27/native-today-before.png)（既存Issue #23の3時間目盛り・テンプレート無地）
- After: [`native-today-after.png`](../../evidence/issue-27/native-today-after.png)、[`native-today-empty-after.png`](../../evidence/issue-27/native-today-empty-after.png)、[`native-today-narrow-after.png`](../../evidence/issue-27/native-today-narrow-after.png)、[`native-today-text-200-after.png`](../../evidence/issue-27/native-today-text-200-after.png)
- Trace / geometry: [`native-today-overview-geometry.json`](../../evidence/issue-27/native-today-overview-geometry.json)
- Redaction: synthetic fixture only; account、calendar ID、event本文、token、個人パスは含めていない

## 10. Executed validation

| Check | Result | Evidence |
|---|---|---|
| DayOverview component test | pass | 10 tests; 25 labels `00`〜`24` |
| Frontend unit suite | pass | 16 files / 94 tests |
| Accessibility suite | pass | 3 files / 7 tests |
| Prettier / ESLint / TypeScript | pass | direct local binaries |
| Vite build | pass | `VITE_WDIO=true` production build |
| Tauri E2E build | pass | `target/debug/day-schedule-next` |
| Native overview E2E | pass | related 3 tests; macOS WebView; normal/empty/narrow/200% |
| Grid/background assertions | pass | 25 ticks; both tracks have two repeating gradients |

## 11. Unexecuted validation

| Check | Reason | Remaining risk | Next action |
|---|---|---|---|
| `pnpm install --frozen-lockfile` / wrapper scripts | local pnpm 11.9.0 tried to fetch required 11.17.0 and registry access failed | package-manager-specific local reproduction remains unverified | run with repository-pinned pnpm in CI |
| Full native smoke | unrelated later Google recurrence scenario timed out after the target overview scenario had passed | broader native regression remains partly unverified | rerun full suite in clean CI/native environment |
| Windows native / screen reader | local host is macOS | platform font, scaling, and AT differences | confirm Windows CI/manual matrix |
| Commit / PR / CI / post-CI review | no explicit publish request in this turn | branch is not yet externally reviewed | publish only after authorization |
