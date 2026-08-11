# Issue #80 Markdown外部リンク UI/UX Review Report

## 対象面

- アプリ本体UI: main windowの予定インスペクターとチケット詳細dialogにある共通Markdownプレビュー。
- GitHub共同作業面: UserManual、desktop platform契約、state matrix、本report。
- 利用者: 説明を読みながら外部の資料・手順・根拠を確認する個人ユーザー。

## 価値と初見理解

現行プレビューはHTTP(S) URLを読めても文字列の選択・コピーとブラウザへの貼り付けが必要だった。対応後は通常のリンクとして表示し、同じ説明の文脈からpointerまたはEnterで既定ブラウザへ移れる。

リンク本文に加えて正規化済みURLを引き続き併記するため、実行前に遷移先を確認できる。titleは外部ブラウザで開くことを伝え、WebView内で画面が置換される挙動は持たない。

## 状態・操作・回復

詳細は [state matrix](issue-80-state-matrix.md) を正本とする。

- normal: HTTP(S)だけをsemantic linkとして表示する。
- keyboard: native anchorのfocusとEnter activationを使う。
- failure: openerの例外内容を表示せず、既定ブラウザ確認と再試行を`role="alert"`で案内する。説明原文、未保存入力、プレビューモードは保持する。
- unsafe: `javascript:`等はanchorにせず、既存のblocked表示を維持する。
- privacy: remote画像、raw HTML、scriptは引き続き読み込まない。

## 最小権限と信頼

- opener capabilityはmain windowの`open_url`へ追加し、scopeは`https://*`と`http://*`だけにする。
- compact / analog-clockへ権限を追加しない。CSP、filesystem、shell、frontend HTTP権限も変更しない。
- opener pluginの自動anchor処理を無効にし、React側でschemeを検証した明示クリックだけを渡す。Tauri capabilityが同じschemeを再制限する。
- 外部ブラウザ起動はremote dataの保存、同期、予定変更を伴わない。

## Accessibility / visual hierarchy / efficiency

- link role、focus、Enter activationをbrowser-native semanticsで提供する。
- URLは既存のmonospace補助表示を維持し、リンク本文より視覚的に強くしない。
- URLは狭幅でも折り返し、既存のプレビュー内部scrollを維持する。
- コピーと貼付けの手順を減らし、失敗後も同じリンクから一操作で再試行できる。
- axe serious / critical、pointer / keyboard、unsafe scheme、error alertをcomponent testで確認する。

## 反証レビュー

- WebView navigation: clickを同期的に`preventDefault`し、openerの暗黙処理も無効化する。
- broad capability: main windowとHTTP(S) scopeだけに限定し、`opener:default`、path、reveal、mailto、telを付与しない。
- XSS / tracking: raw HTML、危険scheme、remote画像の遮断を既存testと同じcaseで確認する。
- silent failure: rejectionを握り潰さず、raw native errorを出さない回復案内へ変換する。
- data loss: previewはdescriptionの派生表示だけで、DB / IPC /同期契約を変更しない。
- double ownership: 過去のIssue #71 reportは当時の証跡として保持し、現在仕様はUserManual、desktop contract、本reportで更新する。

## 証跡

- Before: [Issue #71のMarkdownプレビュー](../../evidence/issue-71/native-schedule-markdown-preview.png) はHTTP(S) URLを非操作の文字として扱う仕様。
- After: [HTTP(S)リンクを表示した予定プレビュー](../../evidence/issue-80/native-schedule-markdown-external-link.png)。合成予定と予約済みexample domainだけを使用する。
- Automated: component、axe、format / lint / typecheck、Rust、native WebView、capability / CSP検査をPRへ記録する。
- Public safety: account、calendar、予定実データ、token、端末pathを証跡へ含めない。

## 判定と未実行

- P0: なし。
- P1: なし。
- P2: なし。
- macOS arm64は、合成予定のリンクを実Tauri WebViewでクリックし、一時local HTTP受信先へのrequestを既定ブラウザChromeから観測した。検証用URL以外のbrowser状態は使用していない。
- Windows WebView2 / 既定ブラウザ、VoiceOver / NVDA、既定ブラウザ未設定時のOS固有dialogは未実行としてPRへ残す。
