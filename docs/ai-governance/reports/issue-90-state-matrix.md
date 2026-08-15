# Issue #90 時刻入力 State Matrix

| State              | 表示・操作                                       | 保持する挙動                                   | Accessibility / evidence         |
| ------------------ | ------------------------------------------------ | ---------------------------------------------- | -------------------------------- |
| 通常文字           | 開始・終了を縦配置し、時刻は各入力へ一度だけ表示 | 開始変更は所要時間維持、終了変更は所要時間変更 | component + native screenshot    |
| 狭幅               | 入力と44px候補ボタンを同じ行に維持               | 直接入力と候補選択を維持                       | native geometry、横overflowなし  |
| 200%文字           | `HH:MM`を省略せず、候補ボタンは44px角            | 下部actionと縦scrollを維持                     | 入力の可読幅 + native screenshot |
| スナップ外         | 例 `10:07` を入力へ表示しselect値も同期          | 自動丸めなし、開始変更時は所要時間維持         | component                        |
| 移動・所要時間変更 | 更新後の時刻を入力へ一度だけ表示                 | 分単位のcivil local time計算を維持             | component + native               |
| 日跨ぎ             | 終了時刻と「翌日」・終了日を表示                 | entity identityと所要時間を維持                | component + native screenshot    |
| DST gap / fold     | 既存errorまたはoffset候補を表示                  | silent shiftなし、resolver変更なし             | existing component / Rust tests  |
| 読み取り専用       | 時刻controlをdisabledで表示                      | 説明原文の選択・複製導線を維持                 | existing component               |

SQLite、Outbox、Google同期、通知、timezone contract、Tauri capabilityは変更しません。
