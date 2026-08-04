# Issue #66 Todoカード State Matrix

| State                   | User sees                         | Move action                | Keyboard / a11y                 | Recovery                | Evidence           | Result |
| ----------------------- | --------------------------------- | -------------------------- | ------------------------------- | ----------------------- | ------------------ | ------ |
| Empty board / column    | 既存の empty copy と quick create | 対象 card なし             | column heading / labelled input | title 作成              | component          | Pass   |
| Normal                  | title + priority badge            | card 全面を drag           | 矢印キー、`aria-keyshortcuts`   | drop 後に保存通知       | component / native | Pass   |
| Dragging                | source card と drop 可能列を強調  | card 前または列末尾へ drop | polite 開始通知                 | `Esc` 取消              | native screenshot  | Pass   |
| Keyboard move           | focus ring のある card            | `← / → / ↑ / ↓`            | button focus、境界通知          | boundary では保存しない | component / native | Pass   |
| Filter / derived sort   | reorder 停止理由                  | drag 不可                  | shortcut を公開せず実行しない   | filter 解除             | component          | Pass   |
| Save failure / conflict | 既存 card と danger status        | 再移動を停止しない         | named reload action             | 最新状態を再読込        | existing contract  | Pass   |
| Narrow / 200% text      | title と priority、横 scroll      | card 全面 target           | button 群による clipping なし   | viewport scroll         | native screenshot  | Pass   |
| 500 tickets             | 簡略 card と列内 scroll           | visible card を drag       | list semantics                  | search / filter         | native screenshot  | Pass   |

## 非対象

- Ticket / Schedule / Focus の保存値、関連、集計、履歴。
- Google Tasks sync、列構成、複数選択、bulk move。
