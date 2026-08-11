# Issue #78 アナログ時計正方形ウィンドウ State Matrix

| State                | 表示                                       | 目的                       | 操作                         | 回復                    | Accessibility                      | Evidence                    | 判定            |
| -------------------- | ------------------------------------------ | -------------------------- | ---------------------------- | ----------------------- | ---------------------------------- | --------------------------- | --------------- |
| 初期表示 480px       | 正方形の内容領域と時計盤、日時、設定ボタン | 現在時刻を大きく読む       | 設定 / window resize / close | header 時計から再表示   | 時計盤の heading、設定 button name | native E2E + screenshot     | macOS 済        |
| 辺の drag            | drag 中も内容領域 1:1                      | 余白を作らず時計を拡大縮小 | 左 / 右 / 上 / 下            | 反対方向へ drag         | OS 標準 resize                     | AppKit query / Windows unit | Windows CI 待ち |
| 角の drag            | drag 中も内容領域 1:1                      | 自然な対角 resize          | 4 隅                         | 反対方向へ drag         | OS 標準 resize                     | AppKit query / Rust 8 方向  | Windows CI 待ち |
| 最小 360px           | 切れない約 93%時計盤                       | 小さくても時刻を読む       | 設定 / resize                | window 拡大             | 44px setting target                | React + Rust unit           | 済              |
| 1 / 1.5 / 2 / 2.5 倍 | 正方形の段階 resize                        | 素早く既定サイズへ変更     | サイズ変更 button            | 次 size / manual resize | button status                      | native E2E                  | macOS 済        |
| 最大化               | 最大化操作を無効化                         | 非正方形化を防ぐ           | OS window control            | 通常 resize             | disabled native control            | Rust build / Windows CI     | Windows CI 待ち |
| 設定 overlay         | theme、size、秒針音、音量、常に手前        | 時計を調整                 | keyboard / pointer / Escape  | close / backdrop        | dialog、focus restoration          | native E2E                  | macOS 済        |
| 200% text            | 拡大した設定と内部 scroll                  | 全設定へ到達               | Tab / scroll / close         | Escape                  | horizontal overflow なし           | native E2E                  | macOS 済        |

予定件数、同期、offline、conflict、通知、Focus は時計ウィンドウの比率制約に状態依存がなく、既存導線も変更しないため対象外です。light / dark / mild theme、秒針音、常に手前は既存回帰 test で確認します。

macOS の合格画像: [`native-analog-clock-square.png`](../../evidence/issue-78/native-analog-clock-square.png)
