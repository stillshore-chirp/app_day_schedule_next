# Issue #86 アナログ時計ピン操作・最小サイズ State Matrix

| State                  | 表示                                                           | 操作・結果                                                                    | Accessibility                                                 | Evidence                   |
| ---------------------- | -------------------------------------------------------------- | ----------------------------------------------------------------------------- | ------------------------------------------------------------- | -------------------------- |
| 常に手前 OFF           | 設定ボタン左に outline のピン                                  | ピン 1 操作で ON、設定内 checkbox も同期                                      | 44px button、`常に手前に固定`、`aria-pressed=false`、tooltip  | React unit / a11y / native |
| 常に手前 ON            | primary 色の塗りピン                                           | ピンまたは設定内 checkbox で OFF、次回起動へ保存                              | `常に手前を解除`、`aria-pressed=true`、色以外の pressed state | React unit / native IPC    |
| 状態読込中 / 失敗      | ピンを無効化                                                   | tooltip と accessible name で待機・読込失敗を説明、設定画面から回復情報へ到達 | disabled reason を name/title へ反映                          | React unit / code review   |
| native 更新 / 保存失敗 | 直前の pressed state へ戻し、回復文を表示                      | 再試行できる。native 適用後の保存失敗は native 状態を補償復元                 | `role=alert`、設定内では既存 status                           | React unit / Rust review   |
| 通常 480px             | 約 96%の正方形時計盤、完全な日時、2 つの右上操作               | pointer / Tab / Enter / Space、設定 / resize / close                          | named 時計画像、2 named buttons                               | native E2E + screenshot    |
| 最小 280px             | 約 96%の正方形時計盤、時刻中心のデジタル表示、2 つの 44px 操作 | 正方形のまま拡大へ回復可能                                                    | target size 維持、横 overflow なし                            | native E2E + screenshot    |
| 200% text              | 設定 overlay を内部 scroll                                     | 全設定、ピン、close へ到達                                                    | focus trap / Escape / horizontal overflow なし                | native E2E / a11y          |
| light / dark           | theme token に従う時計盤と controls                            | pressed state を塗りと ARIA の両方で識別                                      | 既存 focus ring と `aria-pressed` を維持                      | native screenshot          |

予定件数、Google 接続、offline、conflict、notification、Focus、SQLite schema は時計 window の直接操作と最小 size に状態依存がなく、既存導線も変更しないため対象外です。Windows の live resize は同じ Rust 定数を DPI scale して適用し、macOS は Tauri の最小 content size と AppKit の 1:1 制約を組み合わせます。

macOS の合格画像: [480px・ピン固定中](../../evidence/issue-86/native-analog-clock-pin.png)、[最小 280px](../../evidence/issue-86/native-analog-clock-minimum.png)

macOS arm64 の native E2E では、ピンと設定 checkbox の同期、保存値、44px の操作領域、280px content viewport、1:1 比率、デジタル時刻への切替、overflow がないことを確認しました。Windows は同じ最小辺定数を使う native build と DPI 別 Unit test を CI 対象とし、実機での手動 drag と Snap は未実施です。
