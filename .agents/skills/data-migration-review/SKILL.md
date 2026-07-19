---
name: data-migration-review
description: "SQLite schema、migration、legacy import、backup、restore、history、soft delete を原子性・互換性・復旧性でレビューする。"
---

# Data Migration / Recovery Review Skill

## 1. 発動条件

- SQLite table / index / constraint / pragma / migration。
- entity serialization、schema version、settings storage。
- old Python app DB import。
- backup retention、integrity check、restore。
- change history、Undo / Redo、soft delete、purge。
- sync mapping / Outbox / conflict storage の変更。

## 2. 必読

- `AGENTS.md`
- `docs/product-invariants.md`
- `docs/engineering/data-migrations-and-backup.md`
- `docs/architecture-boundaries.md`
- sync table 変更なら Calendar Sync Skill
- time column 変更なら Time / Notification Skill

## 3. schema gate

- primary key、foreign key、unique、check、not-null、default、index の意図を明示する。
- `PRAGMA foreign_keys=ON`、WAL、busy timeout の契約を test する。
- secrets と OAuth token を schema に追加しない。
- UTC instant、timezone、MinuteOfDay、duration の型を曖昧な text にしない。
- local entity version、soft delete、created / updated timestamp の更新規則を定義する。
- mapping / Outbox / conflict の referential lifecycle を定義する。

## 4. migration gate

- migration は番号順、forward-only、transactional、再現可能にする。
- fresh DB と全 supported previous schema から test する。
- migration failure で schema / data が部分適用されない。
- destructive transform 前に backup policy を適用する。
- column rename / type transform / table rebuild は row counts、constraints、indexes を比較する。
- large DB で lock duration、disk free space、copy amplification を検討する。
- app downgrade の扱いを明示する。unsupported downgrade を silent open しない。

## 5. legacy import

- source DB は read-only で開く。
- source schema / table / column を allowlist 検証する。
- preview で source counts、convert counts、skip / warning / error、time interpretation を示す。
- `profiles→templates`、`schedules→template_blocks`、`instant_schedules→quick_blocks`、`free_alarms→free_alarms` の mapping を fixture で固定する。
- cross-midnight、same start/end、invalid color、duplicate name、orphan profile、malformed time を扱う。
- commit は 1 transaction、cancel / crash / disk full で partial import を残さない。
- source DB を変更・削除しない。

## 6. backup / restore

- backup は SQLite online backup API または安全な checkpoint/copy 手順を使う。
- hash、schema version、created time、app version、verification result を記録する。
- retention は newest valid backup を誤削除しない。
- restore 前に現在 DB を退避する。
- restore candidate を別 path で integrity check、migration、smoke query してから atomic switch する。
- switch failure 時に元 DB へ戻れる。
- backup path、home path、DB content を public log / diagnostics に出さない。

## 7. history / undo

- user action と sync action の履歴範囲を区別する。
- Undo が remote event、Outbox、notification、mapping に与える影響を transaction で扱う。
- redo chain の invalidation、multi-entity template apply、bulk move を test する。
- purge 後に復旧不能になる操作は UI で明示する。

## 8. required tests

- fresh DB bootstrap。
- each migration one-by-one / full chain / repeated open。
- constraint failure / disk full simulation / interrupted migration。
- 0 / 1 / 50,000 rows、long text、Unicode、cross-midnight、DST metadata。
- legacy valid / malformed / missing table / duplicate / orphan / cancel。
- backup create / verify / retention / corrupt / incompatible / restore rollback。
- history create / update / delete / bulk / sync interaction。
- concurrent read / write、busy timeout、app restart。

## 9. output

- schema diff and data transform。
- rollback / recovery procedure。
- row count / integrity evidence。
- performance evidence for realistic volume。
- public safety review。
- P0 / P1 / P2、未実行、残リスク。

partial migration、restore without verification、source mutation、token storage、unrecoverable silent data loss は P0 です。
