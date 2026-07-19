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

## 4. Restore

1. acquire exclusive application restore lock。
2. create verified backup of current DB。
3. copy candidate to staging path。
4. integrity check。
5. schema compatibility / migration。
6. smoke query and essential counts。
7. close active connections。
8. atomic switch where platform allows。
9. reopen and bootstrap。
10. failure returns to original DB。

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
- sync side effect is represented in Outbox after Undo。
- redo chain invalidated after new edit。
- history retention and personal data impact are documented。

## 7. Diagnostics

- schema version、counts、integrity result、migration list、backup metadata only。
- event titles、descriptions、token、calendar IDs、absolute user paths are excluded or masked。
