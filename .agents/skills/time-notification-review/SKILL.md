---
name: time-notification-review
description: "時刻、timezone、DST、日跨ぎ、再発、現在進行、通知、Focus、sleep/resume、clock jumpをdeterministicにレビューする。"
---

# Time / Notification Review Skill

## 1. 発動条件

- date / time / duration / timezone / all-day / recurrence
- timeline position、overlap、current / next / remaining / free time
- notification rule / delivery / permission / sound
- Focus / Pomodoro、timer / stopwatch state machine
- sleep、resume、system clock / timezone change、app lifecycle

## 2. 必読の正本

- rootと変更対象に最も近い `AGENTS.md`
- [`docs/product-invariants.md`](../../../docs/product-invariants.md)
- [`docs/architecture-boundaries.md`](../../../docs/architecture-boundaries.md)
- [`docs/engineering/time-and-recurrence.md`](../../../docs/engineering/time-and-recurrence.md)
- [`docs/engineering/notifications-and-focus.md`](../../../docs/engineering/notifications-and-focus.md)
- schema変更なら [`data-migration-review`](../data-migration-review/SKILL.md)、sync変更なら [`calendar-sync-review`](../calendar-sync-review/SKILL.md)、表示変更なら [`ui-ux-review`](../ui-ux-review/SKILL.md)

boundary / transition matrixはengineering docsを正本にし、ここへ複製しません。

## 3. 手順と必須境界

1. concrete schedule、template / Quick Block / free alarm、recurrence、timeline、notification、Focusの影響面を分類する。
2. injected Clock、UTC instant + IANA timezone、wall-clock intent、monotonic elapsed、`[start,end)`を確認する。
3. DST gapを黙って移動せず、overlapのoffset選択を保持し、all-dayをdate rangeとして扱うことを確認する。
4. current / next / overlap / cross-midnight / recurrence scopeを同一clock snapshotから再現する。
5. ruleとdelivery ledger、occurrence/phase単位のkey、restart/resume/callback dedup、grace / bounded replay、permission failureを確認する。
6. Focusの許可transition、persisted timestamp、working集計、restart recoveryを確認し、engineering docの必要matrixを実行する。

## 4. 停止条件と証跡

- naive datetime、silent DST correction、duplicate delivery、unbounded replay、clock jumpでelapsedが逆行する実装はP0。
- permission denied、OS muted、native failureを通知成功として表示しない。
- boundary case、fixed-clock / property test、state transition、必要なnative observation、未実行範囲、残るriskを対象commitに記録する。

実機notification、sleep/resume、OS permissionを実行していない場合は、そのまま未確認と報告します。
