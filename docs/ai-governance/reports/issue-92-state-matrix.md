# Issue #92 Omit列・優先チケット State Matrix

| State | 表示・操作 | 保持する挙動 | Accessibility / evidence |
| --- | --- | --- | --- |
| 通常文字 | Ticketの右端に`Omit`列を表示 | Omitは未完了として保持し、削除・archiveしない | component + native screenshot |
| 高 / 最優先 | Todayの「優先チケット」へ表示 | 予定への配置有無に依存しない | component + native IPC |
| 通常優先度 | 優先チケットへ表示しない | Ticket画面には従来どおり表示 | component |
| Done / Omit | 高・最優先でも優先チケットへ表示しない | Doneだけを完了、Omitは未完了として扱う | component + Rust + native |
| 初期表示 | 優先チケットを展開して件数とカードを表示 | 折りたたみ・再展開が可能 | component keyboard + native |
| 0件 | 見出し、`0件`、空状態を表示 | 読み込み済み状態を明示 | component + visual baseline |
| loading / error | 読み込み中または再試行可能なerrorを領域内に表示 | Todayの予定取得失敗とは分離 | component + axe |
| 予定取得失敗 | Today上部に予定errorを表示し、優先チケットは表示を継続 | 一方の失敗で他方を隠さない | application component |
| 1,001件以上 | 1,000件単位で全pageを取得 | Done / Omit除外と優先度順を全件へ適用 | component |
| 狭幅 | 見出し、件数、カードを縦方向へ収める | 横overflowなし、カード本文を折り返す | native geometry + screenshot |
| 200%文字 | タイトルを省略せず折り返す | 展開操作とToday timelineを維持 | native geometry + screenshot |
| schema 17→18 | 既存6列とticket参照を保ったままOmit列を追加 | migration中の外部キー不整合はtransaction全体をrollback | Rust migration tests |
| Google Tasks連携 | 非Done列からOmitへの移動では同期完了状態を変えない | Doneへの移動は完了、DoneからOmitは再開として同期 | Rust service / Outbox tests |

Todayの優先チケットは参照専用です。Timelineへのdrag、日時入力、絞り込みcontrolは持たせず、予定化は既存のTicket詳細から行います。
