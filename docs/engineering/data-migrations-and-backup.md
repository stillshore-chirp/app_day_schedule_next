# Data Migrations, Import, Backup and Restore

## 1. SQLite settings

- foreign keys on。
- WAL mode。
- explicit busy timeout。
- schema version in migration table / metadata。
- application opens unsupported newer schema read-only or fails clearly; silent downgrade is prohibited。

## 2. Migration

- ordered SQLx migrations。
- transaction whenever SQLite operation permits。
- fresh DB and every supported previous version test。
- table rebuild verifies row count、constraints、indexes、foreign keys。
- migration before app service / sync worker starts。
- migration failure leaves original usable and reports recovery path。

## 3. Backup

- manual、pre-migration、scheduled daily policy。
- safe SQLite backup mechanism。
- metadata: app version、schema、created time、hash、size、verification。
- default retention is finite and never deletes the only verified backup。
- backup directory is app data, not repository or source tree。
- manual backup は operation ID で取り消せる。`VACUUM INTO` 自体の実行中は SQLite を強制中断せず、戻り後に取消を検査して未検証候補を削除し、履歴へ記録しない。

## 4. Restore

1. acquire exclusive application restore lock。
2. create verified backup of current DB。
3. copy candidate to staging path。
4. integrity check。
5. schema compatibility / migration。
6. smoke query and essential counts。
7. close active connections。
8. move the active DB to a same-directory displacement path before renaming the staged candidate into place; do not depend on destination-overwriting rename semantics。
9. reopen and bootstrap。
10. failure returns to original DB。If interruption leaves only the displacement file, the next startup restores it before applying another staged candidate。

候補の migration、integrity check、smoke query は staging path 上で完了させ、active DB の displacement / rename より前に失敗を確定する。候補検証の失敗では active DB を変更しない。

## 5. Legacy Python app import

Source expected tables may include `profiles`, `schedules`, `instant_schedules`, `free_alarms`。

Mapping:

- profiles -> templates。
- schedules -> template_blocks。
- instant_schedules -> quick_blocks。
- free_alarms -> free_alarms。

Rules:

- source read-only。
- preview first。
- malformed / orphan / duplicate / invalid time / cross-midnight classifications。
- no source modification。
- one transaction commit。
- imported IDs are new stable UUIDs with source reference only in migration report。

## 6. History / Undo

- before / after or reversible command payload。
- bulk template apply is one user action with atomic Undo。
- sync side effect is represented in Outbox after Undo。Incomplete operations for the old version are superseded before the restored version's compensating operation is enqueued。
- redo chain invalidated after new edit。
- history retention and personal data impact are documented。

## 7. Diagnostics

- schema version、counts、integrity result、migration list、backup metadata only。
- event titles、descriptions、token、calendar IDs、absolute user paths are excluded or masked。

## 8. Export cancellation

- JSON export は target と同じ directory の `.part` へ書き、cancel token を collection 間、encode 後、publish 前に検査する。
- 取消または write / rename failure では `.part` を削除する。
- target rename 完了後は成功として扱い、完成済み export を暗黙削除しない。

## 9. Timer data compatibility

- schema version 11 は `timers`、`timer_sets`、`timer_set_items`、singleton `stopwatch_state`、run 単位の `timer_run_completions` を追加する。
- JSON export format version 2 は timer のラベル・設定時間と timer set を含める。実行状態、残り時間、stopwatch state、completion / notification ledger は含めない。
- version 1 JSON は timer field がないものとして引き続き取り込む。version 2 import は timer を停止状態で追加し、replace 時は timer / set / stopwatch state も同一 transaction で置換・初期化する。
- 同名 timer set の追加 import は100文字制約内の連番名へ解決する。既存 timer と合わせて500件を超える import は transaction 全体を拒否する。

## 10. Google calendar sync state compatibility

- schema version 12 は`google_calendars`へcalendar単位の`sync_state`、試行／完了時刻、次回再試行時刻、allowlist error categoryを追加する。
- v11以前からのmigrationでは、既存`sync_token`があるcalendarを`synced`、ないcalendarを`never`へbackfillする。token、mapping、選択、既定書込先は変更しない。
- error categoryには予定本文、calendar / event ID、HTTP body、tokenを保存しない。
- fresh DBのdefault / constraint testと、v11→v12でtoken・完了時刻を保持するmigration testを必須とする。

## 11. Recurrence set compatibility

- schema version 13 は`schedule_items.recurrence_supplemental_lines_json`を追加し、primary RRULE / EXDATEでは表せない追加RRULE、RDATE、legacy EXRULEをJSON arrayで保持する。
- v12以前からのmigrationは既存`recurrence_rule`、`recurrence_exdates_json`、schedule、mapping、tokenを変更せず、補助lineを空arrayでbackfillする。
- forward-only migrationとし、v13 DBを古いbinaryで開いて補助lineを捨てるdowngradeを許可しない。
- fresh DB、v12 upgrade、JSON array constraint、既存recurrence保持、50,000 schedule rowsのmigration budget testを必須とする。

## 12. Ticket foundation compatibility

- schema version 14は`ticket_boards`、`ticket_columns`、`tickets`、`ticket_tags`、`ticket_tag_links`、`ticket_checklist_items`、`ticket_change_history`を追加する。
- v13以前のSchedule、Template、Focus、Google Calendar、Outbox、履歴を変更せず、既定boardと6列をidempotentにseedする。
- parentは同じboardの未削除Ticketだけを参照し、application層のrecursive検証で自己参照・多段循環を拒否する。
- Ticket本体、tag link、checklist、履歴は同一transactionで更新し、履歴のoperation IDで再送を重複適用しない。
- SQLite backup / restoreはTicket関連表、parent、列順、Done復帰列、tag、checklist、履歴をDB全体としてround-tripする。
- JSON format version 1 / 2の互換性を維持するため、Ticketは現行JSON export / importへ含めない。Ticketを含む移行には検証済みSQLite backupを使用し、previewとUserManualで非対応を明示する。
- downgradeは非対応とし、v14 DBを古いbinaryで開いてTicket表を無視する運用を許可しない。

## 13. Ticket―Schedule link compatibility

- schema version 15は`ticket_schedule_links`と`ticket_schedule_link_history`を追加する。既存TicketとScheduleは変更せず、初期関連は空とする。
- partial unique indexにより、1 Scheduleの有効なTicket関連を最大1件にする。1 Ticketから複数Scheduleへの関連は許可する。
- 新規Schedule割り当てではSchedule、Schedule履歴、Ticket関連、関連履歴、必要なOutboxを単一transactionで確定する。同じoperation IDの再送は同じ関連を返す。
- 解除と付け替えは過去の関連行を消さず、`unlinked_at_utc`とversionを更新して専用履歴を残す。
- SQLite backup / restoreは関連と専用履歴をDB全体としてround-tripする。JSON format version 1 / 2にはTicketと関連を追加せず、previewとUserManualでSQLite backupが必要なことを明示する。
- downgradeは非対応とし、v15 DBを古いbinaryで開かない。

## 14. Ticket―Focus attribution compatibility

- schema version 16は`ticket_focus_attributions`を追加する。既存Focus履歴は推測で帰属せず未帰属のまま保持する。
- Focus session作成、開始履歴、開始時点の有効なTicket―Schedule関連snapshotを単一transactionで確定する。帰属行はsessionごとに最大1件とする。
- 作業秒は`focus_history`を正本とし、帰属表へdurationを複製しない。pause、break、重複終了で実績を二重加算しない。
- SQLite backup / restoreは帰属snapshotとFocus履歴をDB全体としてround-tripする。JSON format version 1 / 2はTicket、関連、帰属を対象外とし、移行には検証済みSQLite backupを使う。
- downgradeは非対応とし、v16 DBを古いbinaryで開かない。
