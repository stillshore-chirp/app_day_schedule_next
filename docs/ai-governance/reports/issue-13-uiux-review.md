# Issue 13 UI/UX Review Report

## 1. Summary

- Issue / PR: Issue #13 / PR pending
- Commit: pending
- Affected screen / window / state: Settings > Google カレンダー、未設定、接続前、接続中、認証失効、接続失敗、接続済み
- OS: macOS / Windows
- Decision: Pending — 実Google consentとWindows native validationを完了するまでPassにしない
- P0 / P1 / P2 counts: 0 / 0 / 0（実装済み範囲）

## 2. User value

- Target user: 自分のGoogle Calendarを個人用desktop appへ接続する利用者
- Context: 初回接続または認証失効後の再接続
- Goal: OAuth JSONやclient secretを扱わず、1つの接続操作からGoogle同意を完了する
- Supported understand / decide / act / recover: 接続しなくてもローカル予定を使えること、要求権限、接続状態、失敗後の回復、再接続時のデータ保持を同じsectionで説明
- Alternative / unnecessary UI: JSON importを通常導線から除外し、互換用overrideだけをdeveloper detailsへ移動
- Hypothesis / success signal: 初見利用者が「Google カレンダーに接続」を最初の行動として選び、JSONを探さずsystem browserへ進める

## 3. Novice simulation

- 3-second understanding: 「この端末の予定をGoogle カレンダーと同期」「接続しなくてもローカル予定は利用可能」
- First meaningful action: 「Google カレンダーに接続」
- Predicted result: system browserが開き、Google accountと権限を確認する
- Recovery: build設定不足、browser起動失敗、consent cancel、auth失効ごとにローカル予定保持と次の操作を表示
- Confusion: OAuth / PKCE / JSONは通常surfaceから除外。詳細を知りたい利用者だけ折りたたみを開く

## 4. State matrix

- Template: [`issue-13-state-matrix.md`](issue-13-state-matrix.md)
- States actually inspected: configured、not configured、connecting、auth required、OAuth failure、developer override collapsed、native narrow settings
- Missing states: 実Google consent成功後のcalendar一覧、Windows WebView2 / Credential Manager

## 5. Accessibility

- Keyboard-only flow: primary actionはnative button。developer overrideはnative details / summary。component testはrole / visible nameで操作
- Drag equivalent: N/A
- Focus / restoration: 接続開始はsystem browserへ移るため、app復帰後は状態pollで結果を表示。dialogやfocus trapは追加しない
- Name / role / state / value: heading、section、button、details、status、checkbox、radioをsemantic elementで提供
- Structure: Google panel headingを「Google カレンダー」に統一
- Contrast / color: 状態chipだけへ意味を依存せずtext labelを併記
- Target size: 既存button tokenを利用
- 200% text / high DPI: macOS native WebViewでGoogle panelを200% textにし、primary actionとdetailsの縦flowを確認
- Status announcements: `StatusMessage`でtitleとrecoveryを同じ状態に表示
- Automated check: axe WCAG 2 A / AA / 2.1 AA / 2.2 AAでserious / critical 0
- Manual check: macOS WKWebViewのnative screenshotでprimary actionとdetailsを確認

## 6. Visual hierarchy

- Primary action: blue primary buttonをGoogle panel冒頭へ1つだけ配置
- Current / next / selected: panel右上のstate chip、接続後はaccountとcalendar controls
- Overview / detail: value propositionとprimary actionを先、権限・developer設定をdetailsへ分離
- Density / many items: calendar一覧は既存縦listを維持
- Compact Window: N/A
- Platform differences: system browser、loopback、keyringはOS別manual validation対象

## 7. Copy

- Terminology: UIは「Google カレンダー」に統一。技術語はdeveloper / safety detailsだけ
- Local save / sync: 「接続しなくてもローカル予定は利用できます」
- Error / recovery: 原因と次の操作を分離し、typed backend errorのuser-safe message / recoveryを優先
- Permission / lifecycle: 2 scope、Testing token失効、認証情報のOS秘密ストア管理をdetailsへ表示
- Dangerous operation: disconnectの対象件数・local保持／削除契約は既存UIを維持
- Tone: 失敗をデータ消失と誤認させず、回復可能性を明示

## 8. Expert efficiency

- Repetitive tasks: 通常接続は1 app click + Google consent。JSON file選択を毎回行わない
- Pointer / keyboard steps: primary native buttonはpointer / keyboard等価
- Re-entry / persistence: compile-time client IDを再利用。auth失効時は同じaccount / credential keyへ再接続
- Shortcuts / bulk / templates: N/A
- Novice help impact: 補足はdetailsへ置き、通常の反復操作を妨げない

## 9. Satisfaction / trust

- Waiting: 接続待ちと3分timeoutを表示
- Success: browserを開いたことと、接続後のaccount / calendarを表示
- Failure: local予定保持と具体的な再試行を表示
- Data / sync / notification trust: reauthでaccount、calendar、mapping、`nextSyncToken`を削除しない回帰テストを追加
- Destructive scope: disconnect契約は変更せず、再接続をdisconnectとして実装しない

## 10. Domain safety

- Time / DST / recurrence: 変更なし
- Sync / conflict / offline: OAuth credential設定だけを変更。local-first、Outbox、3-way conflict契約を維持
- Migration / backup / restore: schema変更なし。保存済みOAuth JSON設定をbuild設定より優先し互換維持
- OS permission / release: system browser、loopback、Keychain / Credential Managerのmanual matrixを維持
- N/A reasons: notification、Focus、installer権限は変更なし

## 11. Counter-review

- Completion blockers searched: JSON依存の残存、client secret bundle、frontend Google HTTP、過剰Tauri capability、再接続時cascade、OAuth failure後のin-progress flag、secret / personal data証跡
- Findings: 既存reauthがaccount delete / insertを行いcalendar / mappingをcascade deleteするP0を検出。same account updateへ変更し回帰テストを追加。OAuth準備失敗やsystem browser起動失敗でin-progress flagや古いcallbackが残る経路も、attempt generationの無効化で修正
- Missing evidence: 実Google token exchange / Keychain / calendar list、Windows WebView2 / Credential Manager

## 12. Findings

| Severity | Location | Problem | Impact | Fix | Status |
|---|---|---|---|---|---|
| P0 | Rust OAuth completion | reauthが既存accountをdeleteしcalendar / mapping / sync tokenをcascade delete | 同期紐付け消失、remote重複・再取得リスク | account ID / credential keyを再利用するtransactional updateへ変更 | fixed |
| P1 | Google settings | JSON importがprimary action | 初見利用者がGoogle Cloud file準備を要求される | app-managed client IDと単一connect button、developer detailsへ移動 | fixed |
| P1 | OAuth start | prepare / system browser errorでglobal in-progress stateや古いcallbackが残り得る | 3分間再試行不能、古いflowの完了競合 | error pathでflagをclearしattempt generationを無効化 | fixed |

## 13. Evidence

- Before screenshots: [`native-google-json-before.png`](../../evidence/issue-13/native-google-json-before.png)
- After screenshots: [`native-google-connect-after.png`](../../evidence/issue-13/native-google-connect-after.png)、[`native-google-connect-text-200.png`](../../evidence/issue-13/native-google-connect-text-200.png)
- Trace / video: native WebDriver run、synthetic isolated profile
- Tests: Google state component 3、a11y Google settings、Rust build config 2、reauth preservation 1、full Rust integration
- Native manual checks: macOS WKWebViewでconfigured state、primary button、developer action collapsed、real IPC stateを確認
- Redaction check: synthetic client IDのみ。account、calendar ID、event本文、token、local DBを追跡しない

## 14. Executed validation

| Check | Result | Evidence |
|---|---|---|
| UI configured / missing / auth required | Pass | 3 component tests |
| Automated accessibility | Pass | axe 6 tests total、serious / critical 0 |
| Frontend regression | Pass | 65 tests |
| Rust regression | Pass | 75 tests（local TCP mockは通常環境で実行） |
| clippy all targets / features | Pass | warnings denied |
| macOS debug app / DMG | Pass | synthetic client ID build |
| macOS native E2E | Pass | 3 specs、12 tests、Google real IPC stateを含む |
| Security text / boundaries / docs | Pass | repository scripts |

## 15. Unexecuted validation

| Check | Reason | Remaining risk | Next action |
|---|---|---|---|
| 実Google consent / token exchange / calendar list | Google Cloud Consoleのclient作成を利用者へ依頼中 | 実clientでredirect / consent / Keychain保存が未確認 | local `.env.local`設定後に個人buildで実行 |
| Windows native build / E2E / Credential Manager | ローカル環境はmacOS | platform固有のbrowser / secret store差分 | Native release validationを`platform=all`で実行 |
