# Issue #80 Markdown外部リンク State Matrix

| State | 表示・挙動 | 利用者の判断 | 主操作 | 失敗・回復 | Accessibility / Security | Evidence | 判定 |
|---|---|---|---|---|---|---|---|
| HTTPS link | リンク本文と正規化済みURLを表示 | 外部参照先だと分かる | pointerで実行 | opener失敗時は同じリンクから再試行 | semantic link、main windowのHTTPS scope | component test / native WebView | Pass |
| HTTP link | HTTPSと同じ外部リンク表示 | 暗号化されないURLであることはURL文字列から確認 | pointerで実行 | opener失敗時は入力を保持 | semantic link、main windowのHTTP scope | component test / capability review | Pass |
| Keyboard | focus可能なリンク | Enterで既定ブラウザを開ける | Tab / Enter | focusを失わず再試行 | native anchor semantics | component test | Pass |
| Opener failure | プレビュー内に既定ブラウザ確認を案内 | 説明本文は失われていない | 同じリンクを再実行 | 次の実行開始時に旧エラーを消す | `role="alert"`、raw error非表示 | component test / axe | Pass |
| Unsafe scheme | dotted underlineの本文だけを表示 | この形式は開けない | 編集へ戻る | HTTP(S)へ修正 | anchorなし、opener呼出しなし | security component test | Pass |
| Raw HTML | 実行・表示しない | Markdown本文だけが対象 | 編集へ戻る | 原文は保持 | `skipHtml`、scriptなし | security component test | Pass |
| External image | 代替テキストのplaceholder | remote画像を取得しない | 編集へ戻る | URLを本文リンクに直せる | `img`なし、通信なし | security component test | Pass |
| Schedule description | 予定インスペクターの共通プレビュー | 予定の参照資料を開ける | link実行 | 既存保存・競合導線を維持 | 説明原文とIPC契約不変 | native WebView / screenshot / local HTTP受信 | Pass |
| Ticket description | チケットdialogの共通プレビュー | チケットの参照資料を開ける | link実行 | 既存保存・競合導線を維持 | 説明原文とIPC契約不変 | native WebView | Pass |
| Narrow / 200% text | URLを折り返し、プレビュー内をscroll | link全体へ到達できる | keyboard / pointer | dialog / inspectorを閉じて回復 | existing responsive preview | native screenshot / existing regression | Pass |
| Compact / analog-clock | Markdownプレビューもopener権限も追加しない | main windowだけの機能 | mainへ戻る | N/A | window単位の最小capability | capability diff | Pass |
| Windows WebView2 | 共通ReactとTauri scopeを使用 | macOSと同じ操作を期待 | pointer / Enter | OS既定ブラウザ設定へ依存 | Windows実機未確認 | CI build、実機は未実行 | 未確認 |

## 非対象と保持した契約

- URL到達先の内容保証、`mailto:` / `tel:` / `file:` / 独自scheme、外部画像表示、WebView内navigationは対象外。
- SQLite、description IPC、Google Calendar / Tasks、Outbox、conflict、時刻、通知、CSPは変更しない。
- openerの暗黙anchor処理は無効化し、プレビューの明示クリックとmain windowのHTTP(S) scopeに限定する。
