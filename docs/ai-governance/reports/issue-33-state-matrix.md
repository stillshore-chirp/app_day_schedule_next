# Issue #33 Kanban UI State Matrix

| State | User sees | User understands | Allowed next action | Recovery | A11y status / structure | Evidence | Result |
|---|---|---|---|---|---|---|---|
| Initial loading | 「チケットを読み込んでいます」 | ローカルDBを変更せず待機中 | 待つ | 失敗時はretryへ遷移 | `aria-busy` + status | component state | Pass |
| Background refreshing | boardを維持したまま確認中表示 | 既存カードは利用可能 | 閲覧・操作継続 | 自動完了 | polite status | component contract | Pass |
| Empty board | 6列、quick create、最初の行動 | Inboxから始められる | title作成 / detail作成 | 入力保持 | column region + labelled input | [native](../../evidence/issue-33/native-ticket-board-empty.png) | Pass |
| Empty column | 列内に0件理由 | データ消失ではない | その列へ作成 | quick create | headingでlabelled region | component test | Pass |
| Normal | Doneを含む6列、card属性、件数 | 優先度・期限・見積・進捗を比較 | open / move / filter | 保存状態を通知 | list / listitem / named controls | [native](../../evidence/issue-33/native-ticket-board.png) | Pass |
| Detail open | 編集項目、local-only、保存状態 | 対象と保存先 | edit / save / archive / delete | dirty close確認 | modal dialog、focus trap、Esc、return | [native](../../evidence/issue-33/native-ticket-detail.png) | Pass |
| Pointer drag | 列borderのpreview | drop対象、移動中 | card/columnへdrop、Esc | cancel announcement | keyboard equivalentあり | [native](../../evidence/issue-33/native-ticket-drag-preview.png) | Pass |
| Keyboard move | focus cardと方向controls | 安全な移動mode | left/right/up/down/finish | boundary/cancel announcement | pressed state + live region | [native](../../evidence/issue-33/native-ticket-keyboard-move.png) | Pass |
| Search / filter no result | 条件不一致と解除説明 | 保存済みcardは消えていない | 条件変更 / clear | one-click clear | heading + note | [native](../../evidence/issue-33/native-ticket-no-results.png) | Pass |
| Filtered / derived sort | 自由移動停止の理由 | hidden orderを保護中 | filter解除 | clear filters | role note | model + component tests | Pass |
| Save pending / saved | local保存中 / 保存済み | 確定境界 | 待つ / 続行 | retry可能 | polite status | native workflow | Pass |
| Save failure | 入力保持と再試行説明 | 保存されていない | retry / close確認 | input retained | danger status | component test | Pass |
| Stale conflict | 他変更が先行、入力保持 | 無言上書きしない | reloadして差分確認 | current input retained | danger status | [native](../../evidence/issue-33/native-ticket-conflict.png) | Pass |
| Completed / reopened | Done移動で完了、戻すと未完了 | ticketだけが変化 | move / inspect completedAt | previous non-Done列 | text status, not color-only | native IPC assertion | Pass |
| Archived | 通常boardから除外、専用表示 | deleteではない | restore / inspect | one action restore | state select + named action | native workflow | Pass |
| Delete confirmation / recovery | 対象、予定、Google、回復影響 | archiveとの違い | cancel / delete | same-content immediate recovery | alertdialog, safe initial focus | component test | Pass |
| Narrow width | 読める列幅と横scroll | 内容を縮めていない | horizontal scroll | viewport resize | controls remain labelled | [native](../../evidence/issue-33/native-ticket-board-narrow.png) | Pass |
| 200% text | 拡大文字と横・縦scroll | 全操作を継続可能 | scroll / keyboard | reset OS text size | no clipped mandatory action | [native](../../evidence/issue-33/native-ticket-board-text-200.png) | Pass |
| 500 tickets | 500 card、列内scroll | 大量データも到達可能 | search / scroll / open | filter | DOM list semantics retained | [native](../../evidence/issue-33/native-ticket-board-500.png) + model test | Pass |
| Google offline / disconnected | Kanbanをブロックしない | 現在はlocal-only | 全ローカル操作 | SQLite backup | local-only copy | architecture review | Pass |

## 非対象状態

- Scheduleリンク、Focus帰属、Google Tasks同期の状態slotは #34〜#36 で接続する。現在は未実装を同期済みと誤表示しない。
- 任意列編集、swimlane、sprint、assigneeは #33 の非対象。
