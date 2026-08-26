# Issue #98 文字表示倍率 State Matrix

| State                        | 表示・操作                               | 保持する挙動                             | Evidence                             |
| ---------------------------- | ---------------------------------------- | ---------------------------------------- | ------------------------------------ |
| 初期値 / 旧設定              | 100%で従来表示                           | field欠落を100%へ補完                    | TS / Rust contract                   |
| 6倍率                        | 100 / 125 / 150 / 175 / 200 / 250%を選択 | 同じ文字階層で即時preview                | component + native                   |
| 保存成功                     | 全windowへ即時反映                       | SQLiteへ保存し次回起動で復元             | component + native IPC               |
| 保存失敗                     | errorと再試行を表示                      | 選択値を保持し、過去の成功表示を消す     | component                            |
| process再起動                | 保存倍率でroot appearanceを初期化        | 同じdata directoryの新processでDBを読む  | two-process native E2E               |
| 旧export Replace             | 欠落倍率を100%として反映                 | import transactionと全window eventを維持 | Rust + command                       |
| 100%                         | 従来の密度と表示                         | 読み取り用一覧を追加表示しない           | component + existing visual baseline |
| 175–250% Today               | 見出し、予定名、Now Dock、履歴操作へ到達 | 横時間座標を維持し縦高を拡張             | component + native                   |
| 250% Settings                | 全項目と保存へscroll到達                 | 横overflowを発生させない                 | native geometry                      |
| 250% Compact                 | 現在、次、残り、Focusへscroll到達        | 小window幅とalways-on-topを維持          | native geometry                      |
| 250% analog                  | digital文字を拡大                        | 正方形時計盤と針geometryを維持           | native geometry                      |
| app内dialog / menu / tooltip | DOM文字をroot倍率で表示                  | focus、name、roleを維持                  | component / axe                      |
| OS native menu / 標準補足    | OS倍率で表示                             | native semanticsと画面端処理をOSへ委ねる | manual boundary                      |
| 720px / 250%                 | wrap / scrollで操作へ到達                | hidden controlと横overflowを残さない     | native geometry                      |
| Windows high DPI             | WebView2とOS表示倍率を併用               | app文字倍率はroot typographyだけに適用   | Windows native / manual              |

Evidence欄は証跡種別を示します。2026-08-26のmacOS arm64 native E2Eでは、6倍率、250%保存、別process restart、720px、Compact、analog clockまでPassしました。Google接続、notification permission、Focus phase、backup内容のdomain stateは変更しません。Windows high DPI、macOS x64、VoiceOver / NVDA、installerは未確認です。
