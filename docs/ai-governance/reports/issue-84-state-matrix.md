# Issue #84 説明プレビュー3モード state matrix

## 対象面と利用価値

- 対象面: アプリ本体UI（チケット詳細、予定Inspector）と、その操作を説明するUserManual。
- 対象ユーザー: Markdownを意図した説明と、記号を含む通常文を同じローカル説明欄で扱う利用者。
- 支援する結果: 原文の見え方を既定の通常プレビューで確認し、必要な場合だけMarkdown書式へ切り替え、HTTP(S) URLはどちらの表示からも安全に開ける。
- 保持する挙動: raw本文が唯一の保存元であり、表示切替だけでは保存・同期・本文変更を行わない。チケット詳細の背景クリック、閉じる、取消、Escapeは共通の未保存確認を通る。

## State matrix

| State / surface | 表示する情報 | 主操作 | 回復・安全性 | accessibility | 証跡 | 判定 |
|---|---|---|---|---|---|---|
| 非空の通常文 / チケット | Markdown記号、改行、空白、HTTP(S) URLを原文の形で表示 | URLをpointer / keyboardで開く、表示切替 | HTMLを実行せず、本文を変更しない | `tablist` / `tab` / named `tabpanel` | [native](../../evidence/issue-84/native-ticket-plain-preview.png)、component test | Pass |
| 非空の通常文 / 予定 | 右Inspector内で通常プレビューと3タブを表示 | URL、Markdown、編集 | Inspector幅内へ3タブを収める | 同上 | [native](../../evidence/issue-84/native-schedule-plain-preview.png) | Pass |
| Markdownプレビュー / チケット | 見出し、表、task list、リンク先を構造化表示 | 通常表示または編集へ切替 | raw HTML、外部画像、危険なschemeを実行しない | panel名、focus、GFM checkbox名 | [native](../../evidence/issue-84/native-ticket-markdown-preview.png)、component / axe test | Pass |
| Markdownプレビュー / 予定 | 既存のGFM表示と安全境界 | 通常表示または編集へ切替 | rendererを遅延loadし、一覧表示を阻害しない | 同上 | [native](../../evidence/issue-84/native-schedule-markdown-preview.png) | Pass |
| 編集 | 保存対象のraw本文 | textareaへ入力、保存 | 3モード往復後も入力を保持 | 編集tab選択時はtextareaへfocus | component / schedule / ticket test | Pass |
| 空本文 | 編集から開始し、両プレビューは空状態を説明 | 「編集に戻る」 | 入力導線を失わない | named empty panel、focus復帰 | component test | Pass |
| URL末尾境界 | 日本語句読点、外側括弧、対応するURL内括弧を区別 | HTTP(S) URLを開く | `new URL`とprotocol再検証、危険schemeは通常文字 | link名は表示URL | component test | Pass |
| opener失敗 | 既定ブラウザを確認して再試行する案内 | 同じリンクを再実行 | 本文とリンクを保持 | `role=alert` | component test | Pass |
| 未保存の背景クリック | 保存していない変更を破棄する確認 | 拒否 / 承認 | 拒否時は入力と詳細を保持、承認時は起点へfocus復帰 | dialog focusを維持 | `KanbanView.test.tsx`、既存native背景クリック経路 | Pass |
| 狭幅 720px | 3タブ、Markdown表、URL、後続項目へscroll可能 | pointer / keyboard | dialogを閉じて回復 | focus ringと名前を維持 | [native](../../evidence/issue-84/native-ticket-markdown-preview-narrow.png) | Pass |
| 200% text | 拡大した3タブ、本文、help、後続項目 | scroll / keyboard | screenshot前後に倍率反映と復元を待機 | labelを省略しない | [native](../../evidence/issue-84/native-ticket-markdown-preview-text-200.png) | Pass |
| 500 tickets | プレビューは詳細を開いた項目だけで描画 | 検索、選択、詳細表示 | board全件へparserを適用しない | 既存card semantics | 既存native 500件経路、lazy production build | Pass |

## UI/UX反証レビュー

- 初期表示を通常プレビューへ変え、Markdownを意図しない本文の記号を勝手に書式化しない。
- Markdownを意図する既存本文も1操作で構造化表示でき、raw本文や保存先は変わらない。
- 予定Inspectorでは最初のnative確認で編集tabが右端へはみ出した。説明ラベルを上段、3タブを下段へ置き、各ラベル長に応じた幅へ調整して同じnativeシナリオを再実行した。
- 200% textの初回証跡は倍率反映待ちがなく通常倍率と同一になり得た。32px以上への反映と2 frameを待ち、復元後も2 frame待つE2Eへ修正した。
- 独立差分レビューで、Google側の読み取り専用予定は編集tabを選べても無効なtextareaから原文をコピーできない問題を検出した。保存不能は維持し、focus・選択・コピーができるread-only textareaへ修正してcomponent / schedule testへ固定した。
- P0: なし。P1: Inspectorのtab overflow、200%証跡の偽陽性、読み取り専用原文の参照不能を同じ変更内で修正。P2: なし。

## Security / platform

- main windowの既存opener scope `http://*` / `https://*`を再利用し、capability、CSP、Rust commandを変更していない。
- 通常プレビューはReact text nodeだけで描画し、`dangerouslySetInnerHTML`、remote image、WebView内遷移を追加していない。
- 証跡はE2Eで生成した合成予定・チケットだけを使用し、実アカウント、個人予定、token、端末pathを含めていない。
- macOS arm64 native WebViewでは予定とチケットのfocused E2EがPass。チケット全体シナリオは一度既存pointer-dragで揺れたが、倍率復元後のlayout待機を追加した単独再実行でPassした。
- Windows実機は未実行。共有React / CSS変更を意図し、release時のplatform matrixに残す。

## 変更前後の証跡

- 変更前: 非空本文はMarkdown表示が既定。[Issue #71 native ticket](../../evidence/issue-71/native-ticket-markdown-preview.png)
- 変更後: 非空本文は通常プレビューが既定。[Issue #84 native ticket](../../evidence/issue-84/native-ticket-plain-preview.png)
- 明示切替後: Markdown表示は既存のGFMと安全境界を維持。[Issue #84 native Markdown](../../evidence/issue-84/native-ticket-markdown-preview.png)
