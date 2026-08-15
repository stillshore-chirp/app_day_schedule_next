# Issue #88 予定作成・編集 State Matrix

| State / surface          | 表示                                           | 操作・結果                                           | 回復・安全性                                  | Accessibility                              | Evidence                           |
| ------------------------ | ---------------------------------------------- | ---------------------------------------------------- | --------------------------------------------- | ------------------------------------------ | ---------------------------------- |
| 新規作成                 | タイトル → 日付・時刻 → 説明、詳細設定は閉じる | 主要項目だけで作成                                   | 保存・キャンセルは下部に固定                  | タイトルに初期 focus、DOM / Tab 順序を一致 | component / native primary         |
| 同日予定                 | 日付は 1 回、開始・終了時刻                    | 直接入力または各候補 select                          | 時刻変更で日付を消失させない                  | 各入力と select に固有名                   | component / native                 |
| 開始時刻・開始日変更     | 変更後の開始・終了                             | 所要時間を保って両端を移動                           | DST fold 選択をクリア                         | 現在値を入力と候補の両方で確認             | component                          |
| 終了時刻・終了日変更     | 変更後の終了と所要時間                         | 終了だけを変更                                       | 同日で開始以前の時刻は翌日と明示              | 終了日も可視 label                         | component / native cross-midnight  |
| 日跨ぎ                   | 「翌日」と終了日                               | 終了日を直接変更                                     | 元の所要時間を保った開始変更                  | チップと named date input                  | component / native screenshot      |
| 時刻の移動               | スナップ幅の前・後ボタン                       | 開始・終了を同時に移動                               | 1 分未満の所要時間にはしない                  | 44px、「5 分前へ移動」等の name            | component / native                 |
| 所要時間                 | 短縮・延長、15/30/60 分                        | 終了を調整または候補値へ変更                         | 現在値は pressed state、不正な短縮は disabled | 44px、`aria-pressed`                       | component / native                 |
| スナップ外の時刻         | 例: `10:07`                                    | 直接入力後も保持し、候補に現在値を追加               | 自動丸めなし                                  | input value / option の双方で参照          | helper / component                 |
| 詳細設定なし             | 閉じた「詳細設定」                             | summary で展開                                       | 主要入力と保存を妨げない                      | native details / summary                   | component                          |
| 詳細設定あり             | 「設定あり」、編集開始時は展開                 | 優先度、終日、再発、timezone、通知、分類、場所を編集 | 保存済みの非既定値を隠さない                  | summary 名と色以外のチップ                 | component / code review            |
| 終日                     | 日付・終了日、時刻操作は disabled              | 終日を解除して時刻操作へ復帰                         | exclusive end date の既存契約を維持           | disabled state を native controls で通知   | component / existing domain tests  |
| DST gap                  | 開始または終了のエラー                         | 別の時刻を入力                                       | 黙って別時刻へ補正せず、入力を保持            | `aria-invalid` / 参照先 error              | component / Rust domain            |
| DST fold                 | 2 候補の UTC instant                           | 保存する offset を選択                               | 日時・timezone 変更後は選び直す               | radio group、instant を名前で確認          | component / Rust domain            |
| validation / busy        | 項目エラー、保存中表示                         | 訂正後に再実行                                       | 入力を保持し、busy 中の二重保存を防止         | error association / disabled               | component / existing save path     |
| 読み取り専用 Google 予定 | 理由と Google 側での回復案内                   | 説明を選択・コピー、複製                             | 時刻・詳細・保存・削除を無効化                | read-only textarea、disabled controls      | component                          |
| 200%文字                 | 拡大した label、入力、候補、アクション         | Inspector 内縦スクロール                             | 横 overflow なし、下部アクションを維持        | 名前の省略なし                             | native geometry + screenshot / axe |

## 非対象と残る確認

SQLite schema、予定の UTC instant + IANA timezone 契約、Outbox、Google Calendar 同期、通知配信は変更しません。macOS arm64 の native WebView は上記主要経路を確認済みです。Windows WebView2 実機と VoiceOver / NVDA の手動操作は未実施です。
