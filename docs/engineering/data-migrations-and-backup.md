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
