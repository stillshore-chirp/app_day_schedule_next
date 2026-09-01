# state matrix

| 状態 | ユーザーが見るもの | ユーザーが理解できること | 次にできる行動 | 回復手段 | a11y通知/構造 | 証跡 | 判定 |
|---|---|---|---|---|---|---|---|
| 通常 |  |  |  |  |  |  | Pass/Fail |
| 読み込み中 |  |  |  |  |  |  | Pass/Fail |
| 空 |  |  |  |  |  |  | Pass/Fail |
| 検索結果なし |  |  |  |  |  |  | Pass/Fail |
| 部分データ |  |  |  |  |  |  | Pass/Fail |
| エラー |  |  |  |  |  |  | Pass/Fail |
| 入力エラー |  |  |  |  |  |  | Pass/Fail |
| 無効 |  |  |  |  |  |  | Pass/Fail |
| 権限不足 |  |  |  |  |  |  | Pass/Fail |
| オフライン/利用不可 |  |  |  |  |  |  | Pass/Fail |
| 狭幅 |  |  |  |  |  |  | Pass/Fail |
| 文字拡大 |  |  |  |  |  |  | Pass/Fail |
| 長文・大量データ |  |  |  |  |  |  | Pass/Fail |

## Day Schedule Nextの代表状態（必要な範囲だけ採用）

| Surface | 状態 | ユーザーが判断する対象 | 次の行動・回復 |
|---|---|---|---|
| Today / timeline | 予定0件 / 通常 / overlap / 日跨ぎ / current複数 | 日付、範囲、選択、作成、free time | 作成、直接編集、keyboard、Undo |
| Sync / Conflict | offline / retry / auth expired / conflict | local保存、remote未反映、対象calendar / field | 再接続、再試行、明示解決 |
| Template / Quick Block | preview / replace / cancel | 適用先、件数、既存予定への影響 | cancel、one-action Undo |
| Notification / Focus | permission / delivery / Working / Paused / Break | 用途、phase、結果 | OS設定、再確認、resume |
| Data / Ticket | restore / import / Done / Omit / link | candidate、scope、完了境界 | backup、rollback、列移動・再試行 |
