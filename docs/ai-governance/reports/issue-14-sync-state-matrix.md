# Issue 14 Google Calendar Sync State Matrix

| State | User sees | Data / token contract | Allowed action | Recovery | Evidence | Status |
|---|---|---|---|---|---|---|
| Initial / never | 「まだ同期していません」 | tokenなし、local data保持 | 手動同期 | final pageまで完了後にsynced | request / pagination fixture | Pass |
| Syncing | 「予定を同期しています」 | previous tokenとlocal data保持 | 取消 | safe boundaryでprevious stable stateへ戻る | cancellation fixture | Pass |
| Synced | 「同期済みです」 | final pageのeventとtokenを同一transactionで確定 | 通常利用、再同期 | incremental tokenを継続 | initial / incremental fixture | Pass |
| Retry scheduled | 自動再試行とデータ保持 | previous tokenとlocal data保持 | 手動同期も可能 | timeout / 429 / 5xxから再試行 | 429 / 503 / offline fixture | Pass |
| Calendar unavailable / permission | Google共有権限の確認案内 | 該当calendarのprevious tokenとlocal data保持 | 権限修正、同期対象解除 | 他calendarは同期継続 | 403 partial-success fixture、component test | Pass |
| Calendar unavailable / missing | Google側の削除確認案内 | 該当calendarのprevious tokenとlocal data保持 | calendar一覧更新 | 他calendarは同期継続 | 404 classification fixture | Pass |
| Complex recurrence | 予定を通常表示。編集panelで「表示と同期は継続」とGoogle側編集を案内 | primary / supplemental recurrence line / EXDATEとnew tokenを同一transactionで確定 | Google側で系列編集 | 次回差分同期で反映 | recurrence set / round-trip fixture、editor component test、[通常](../../evidence/issue-14/native-google-complex-recurrence.png)、[200%](../../evidence/issue-14/native-google-complex-recurrence-text-200.png) | Pass |
| Calendar unavailable / validation | 壊れた形式または表現不能な期間型と既存予定保持 | page適用とnew tokenをcommitしない | Google側系列確認 | 修正後に同じtokenから再試行 | invalid recurrence fixture | Pass |
| Auth required | Google再接続案内 | 全calendarのtoken、mapping、local data保持 | 再接続 | credentialだけ更新して同期再開 | 401 fixture、reauth regression | Pass |
| Free-busy-only | 予定詳細の読取権限が必要 | event pull対象外 | Google側権限変更 | reader以上で選択可能 | role fixture、disabled checkbox test | Pass |
| Conflict | ローカル／Google競合 | tokenを成功扱いせずlocal edit保持 | 競合解決 | field-by-field確認後に再同期 | delete-vs-edit / series pending fixture | Pass |
| 410 | 画面上はsyncingを継続 | stale tokenを保存せず対象calendarだけfull sync | 取消可能 | final page transactionでfresh token | 410 fixture | Pass |
| Recurrence moved | 通常の予定として系列内に表示 | master EXDATE + linked exception | 通常編集 | master / exception identityを保持 | moved exception fixture | Pass |
| Recurrence cancelled | 元のoccurrenceを表示しない | master EXDATE、既存exceptionはsoft delete | 通常利用 | full sync resetでEXDATE解除 | cancelled / reset fixture | Pass |
| Series deleted | masterとlinked exceptionを表示しない | pending local exceptionがなければ同時soft delete | 競合時は確認 | local pendingならtokenを更新しない | series deletion fixture | Pass |
| Narrow / 200% text | calendar名、権限、sync状態、controlsが縦方向に到達可能 | 変更なし | keyboard / scroll | 横scrollへ依存しない | native E2E、[通常](../../evidence/issue-14/native-google-calendar-recovery.png)、[200%](../../evidence/issue-14/native-google-calendar-recovery-text-200.png) | Pass |

実アカウントの予定本文、calendar / event ID、token、HTTP bodyは証跡へ保存しません。実機確認は件数、状態category、画面表示だけを個人領域で確認します。
