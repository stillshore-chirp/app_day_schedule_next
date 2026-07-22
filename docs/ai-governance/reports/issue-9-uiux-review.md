# Issue #9 UI/UX Review Report

## 1. Summary

- Issue / PR: #9 / PR作成前
- Commit: 本PRの最新head
- Affected screen / window / state: 新規「タイマー」「ストップウォッチ」画面、左ナビゲーション、データimport/export件数
- OS: macOS / Windows共通実装。native証跡はmacOS arm64
- Decision: Pass for implementation; CI / review / Windows実機確認は完了ゲートに残す
- P0 / P1 / P2 counts: 0 / 1 / 0（P1はWindows native notification / scaleの実機未確認）

## 2. User value

- Target user: 一日の実行中に複数の残り時間、または単一の経過時間を予定とは独立して把握したい個人ユーザー。
- Context: 調理、休憩、ストレッチ等を同時に数える場面と、作業の経過だけを測る場面。
- Goal: 複数カウントダウンを個別操作して再利用し、ストップウォッチは別の目的として迷わず開く。
- Supported understand / decide / act / recover: ラベル・残り・状態を理解し、開始／停止対象を判断し、個別操作し、再起動・入力・version失敗から復旧する。
- Alternative / unnecessary UI: Focusは作業／休憩cycle、自由アラームは時刻指定で代替にならない。初稿で同居させたストップウォッチは、目的差についてのユーザー指摘を受けて独立ナビゲーションへ分離した。
- Hypothesis / success signal: 保存済みセットを使う反復では、複数タイマー再作成を「セットを追加」1操作へ短縮できる。

## 3. Novice simulation

- 3-second understanding: 「タイマー」見出し、ラベル、時分秒、「タイマーを追加」を識別できる。ストップウォッチは隣の独立ナビゲーションとして表示される。
- First meaningful action: 任意ラベルと時間を入力して追加、またはストップウォッチ画面で「計測を開始」。
- Predicted result: タイマーはカードとして追加され、開始後は状態・残り・進捗が変わる。ストップウォッチは経過が増える。
- Recovery: 無効時間は入力を保持、実行中の編集はリセット方法を表示、削除は対象とセットへの非影響を確認、失敗はデータ未変更と再試行を説明。
- Confusion: タイマーとストップウォッチの同居は役割を曖昧にするため解消済み。

## 4. State matrix

- Template: [`issue-9-state-matrix.md`](issue-9-state-matrix.md)
- States actually inspected: empty、multiple、paused、set saved、stopwatch paused、loading semantics、input error、disabled、500件、narrow、200% text、restart persistence。
- Missing states: Windows high DPI / native通知権限、実OS sleep中の完了。

## 5. Accessibility

- Keyboard-only flow: タイマー追加→開始、ストップウォッチ開始をEnter / Tabで検証。
- Drag equivalent: drag操作なし。全操作はnative button / input。
- Focus / restoration: `:focus-visible` 3px、narrow証跡で選択中ナビゲーションのfocusを確認。inline確認から取消可能。
- Name / role / state / value: timer `article`、named `output` / `progress`、native `button` / `input` / `fieldset`、status text。
- Structure: タイマーとストップウォッチは個別`main`とh1。セットはlist。
- Contrast / color: 状態は色だけでなく「待機中／計測中／一時停止／終了」を表示。
- Target size: 共通buttonの最小高さを使用し、危険操作は文字ラベル。
- 200% text / high DPI: 720×720 logical / macOS Retinaで見出し、入力、時間、状態がclipせず縦scroll可能。
- Status announcements: 操作結果とtimer completionだけをpolite通知し、毎秒値はliveにしない。
- Automated check: タイマーempty / populated、ストップウォッチでaxe serious / critical 0。
- Manual check: macOS native 1180×820、720×720、200% text。screen reader実機は未実行。

## 6. Visual hierarchy

- Primary action: タイマーは追加、各カードは現在状態に応じた開始／一時停止／再開。ストップウォッチは単一の現在操作。
- Current / next / selected: 各カード上部の状態、ラベル、大きいtabular timeで現在を示す。
- Overview / detail: 設定編集と実行情報を同じカード内で近接させるが、実行中は編集を無効化して競合を防ぐ。
- Density / many items: responsive card grid。500件の全カード到達をcomponent testで確認。
- Compact Window: 対象外。主ナビゲーションに専用画面を置く。
- Platform differences: 共通React / typed IPC。macOS nativeのみ観測、Windowsは残リスク。

## 7. Copy

- Terminology: 「タイマー」「ストップウォッチ」「タイマー構成セット」を役割別に使用。内部のrun ID、ledger、schemaを出さない。
- Local save / sync: 「この端末に保存」。Google同期対象とは表現しない。
- Error / recovery: 入力保持、再読込、リセット条件、version conflictを具体化。
- Permission / lifecycle: 完全終了中は通知不可、次回起動時に経過状態を復旧すると明示。
- Dangerous operation: timer削除は現在状態、set削除はsetだけで相互非影響を明示。
- Tone: user blame、根拠のない安全表現なし。

## 8. Expert efficiency

- Repetitive tasks: 複数timer作成を名前付きsetへ保存し、既存を失わず一括追加。
- Pointer / keyboard steps: 新規timerはラベル任意＋3数値＋追加。keyboard同等あり。
- Re-entry / persistence: timer / set / stopwatch stateをSQLiteで回復。setは実行状態を意図的に除外。
- Shortcuts / bulk / templates: 専用shortcutは追加せず、setを反復アクセラレータに限定。
- Novice help impact: 空時と生命周期の短い説明だけ。通常カードの主操作を遮らない。

## 9. Satisfaction / trust

- Waiting: loading対象を明示し、定期更新失敗で既存カードを消さない。
- Success: 追加、設定保存、状態更新、set適用件数をlive statusへ出す。
- Failure: 入力とローカル状態の保持、次の操作を説明。
- Data / sync / notification trust: SQLite正本、Google非対象、run単位の通知重複抑止、完全終了制約。
- Destructive scope: timer / setの対象差を確認内に記載。

## 10. Domain safety

- Time / DST / recurrence: timer / stopwatchはtimezone非依存のduration。process内monotonic、restart初回のみUTC wall recovery。DST / recurrenceはN/A。
- Sync / conflict / offline: Google非対象。optimistic version conflictのみ明示。
- Migration / backup / restore: schema 11、JSON v2、v1後方互換、single transaction、500件上限、実行状態をexportしない。
- OS permission / release: 既存通知adapterを再利用。macOS native済み、Windows実機未確認。

## 11. Counter-review

- Completion blockers searched: 同一タブによる目的混同、複数timer競合、wall clock逆行、restart重複通知、set適用による既存消失、500件、input保持、完全終了、JSON互換、narrow / 200%。
- Findings: 同居設計をユーザー指摘で別画面へ修正。Tauri E2E初回の誤ったcommand名を修正。機能側P0なし。
- Missing evidence: Windows native notification / high DPI、実OS sleep、screen reader。

## 12. Findings

| Severity | Location | Problem | Impact | Fix | Status |
|---|---|---|---|---|---|
| P1 | 初稿の情報設計 | TimerとStopwatchを同一画面に配置 | 目的と操作対象が混同される | 左navigationとh1を別画面へ分離、navigation test追加 | fixed |
| P1 | Windows実機 | notification / high DPI未観測 | OS差による通知・reflowリスク | Windows release smoke | open platform gate |

## 13. Evidence

- Before screenshots: 新規画面のため同一surfaceは存在しない。既存navigationは [`native-focus-history.png`](../../evidence/issue-4/native-focus-history.png)。
- After screenshots: [`native-timers.png`](../../evidence/issue-9/native-timers.png)、[`native-stopwatch.png`](../../evidence/issue-9/native-stopwatch.png)、[`native-timers-narrow.png`](../../evidence/issue-9/native-timers-narrow.png)、[`native-timers-text-200.png`](../../evidence/issue-9/native-timers-text-200.png)。
- Trace / video: native WebDriver interaction。videoなし。
- Tests: Rust 70、frontend unit、axe、native smoke 8 scenarios。
- Native manual checks: screenshotを目視し、別navigation、synthetic label、reflow、focus、clipなしを確認。
- Redaction check: synthetic `E2E紅茶` / `E2Eストレッチ`のみ。account、calendar / event ID、token、path、通知previewなし。

## 14. Executed validation

| Check | Result | Evidence |
|---|---|---|
| Rust all features | Pass 70/70 | domain / repository / service / notification / migration / v1-v2 transfer |
| TypeScript / lint | Pass | typed IPC and UI |
| Component | Pass | multi-timer、set、keyboard、invalid input、500件、separate navigation、stopwatch |
| axe | Pass | timer empty / populated、stopwatch |
| Native macOS | Pass 8/8 | real Tauri / IPC / SQLite、restart、narrow、200% screenshot |
| Security / docs harness | 最終検証で再実行 | completion reportへ記録 |

## 15. Unexecuted validation

| Check | Reason | Remaining risk | Next action |
|---|---|---|---|
| Windows native build / notification / high DPI | 現在のhostはmacOS arm64 | native notificationとscale差 | Windows release smoke |
| 実OS sleep / resume | deterministic fake clockのみ | OS monotonic / resume差 | macOS / Windows sleep manual |
| screen reader full flow | automated semantics / axeのみ | announcementの実機体験 | VoiceOver / Narrator smoke |
