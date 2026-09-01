---
name: data-migration-review
description: "SQLite schema、migration、legacy import、backup、restore、history、soft deleteを原子性・互換性・復旧性でレビューする。"
---

# Data Migration / Recovery Review Skill

## 1. 発動条件

- SQLite table / index / constraint / pragma / migration
- entity serialization、schema version、settings storage
- legacy Python app DB import
- backup retention、integrity check、restore、export cancellation
- change history、Undo / Redo、soft delete、purge
- sync mapping / Outbox / conflict storageの変更

## 2. 必読の正本

- rootと変更対象に最も近い `AGENTS.md`
- [`docs/product-invariants.md`](../../../docs/product-invariants.md)
- [`docs/architecture-boundaries.md`](../../../docs/architecture-boundaries.md)
- [`docs/engineering/data-migrations-and-backup.md`](../../../docs/engineering/data-migrations-and-backup.md)
- time column変更なら [`time-notification-review`](../time-notification-review/SKILL.md)、sync table変更なら [`calendar-sync-review`](../calendar-sync-review/SKILL.md)
- 公開diagnostics / reportを作る場合は [`SECURITY.md`](../../../SECURITY.md) と `docs/security-publication-checklist.md`

schema / import / restoreの詳細matrixはdata engineering docを正本にし、ここへ複製しません。

## 3. 手順と必須境界

1. schema、migration、import、backup、restore、history、exportの影響面とsupported versionsを固定する。
2. foreign keys、WAL、busy timeout、schema version、constraint、index、version / soft-delete lifecycleを確認する。
3. fresh DBと全supported previous schemaのforward-only migration、transaction、failure rollback、downgrade拒否を確認する。
4. destructive transform前のverified backup、restore candidateのstaging integrity / migration / smoke、同一directory displacement、元DB復帰を確認する。
5. import sourceのread-only、allowlist、preview、mapping / warning、single transaction、cancel / crash / disk-fullを確認する。
6. history / Undo、Outbox / notification / mappingの副作用、`.part` cleanup、diagnostic redactionを確認する。
7. engineering docのrequired testsから、対象schema・volume・failureのfocused / integration evidenceを選ぶ。

## 4. 停止条件と証跡

- partial migration、unverified restore、source mutation、token storage、unrecoverable data lossはP0。
- row count、integrity、constraints / indexes、compatibility、rollback手順、実行結果、未実行範囲、残るriskを対象commitに結び付ける。
- active DBを検証前に上書きせず、candidate failureで元DBを変更しない。

実ユーザーDB、raw backup、絶対path、秘密値を証跡へ持ち込まず、synthetic fixtureだけを使います。
