---
name: ui-ux-review
description: "Day Schedule Nextのアプリ本体UIとrepository独自UIを、製品価値、状態、操作、アクセシビリティ、視覚階層、copy、信頼性の証跡付きでレビューする。"
---

# UI/UXレビュー Skill

## 1. 発動条件

次の変更で使います。

- Today / Week / Month / List / Ticket / Template / Focus / Alarm / Settings / Diagnostics
- timeline、Now Dock、Compact Window、Inspector、dialog、menu、notification
- 予定・Ticketの作成、drag、resize、直接入力、複製、削除、Undo / Redo
- Google接続、同期、競合、permission、backup / restore / import の利用者向け結果
- 表示文言、empty、loading、offline、error、disabled、accessibility、keyboard、visual regression
- backend変更で利用者に見える結果、待機、失敗、回復、通知が変わる場合

## 2. 必読の正本

- rootと変更対象に最も近い `AGENTS.md`
- [`docs/product-invariants.md`](../../../docs/product-invariants.md)
- [`docs/architecture-boundaries.md`](../../../docs/architecture-boundaries.md)
- [`docs/testing/index.md`](../../../docs/testing/index.md) のrisk laneとstate matrix
- 対象に応じた [`calendar-sync-review`](../calendar-sync-review/SKILL.md)、[`time-notification-review`](../time-notification-review/SKILL.md)、[`data-migration-review`](../data-migration-review/SKILL.md)、[`desktop-release-review`](../desktop-release-review/SKILL.md)
- 利用者向け操作を変える場合は `UserManual.md`、公開物を作る場合は [`SECURITY.md`](../../../SECURITY.md) と `docs/security-publication-checklist.md`

詳細なUI契約とdomain matrixは各canonical docを読み、本文書へ複製しません。

## 3. 手順

1. 対象画面、window、利用者、主目的、変更後の結果と、影響するproduct invariantを記録する。
2. initial comprehension、主操作、保存先、remote影響、待機・失敗・回復を確認する。
3. 影響する状態だけを選び、empty、loading、offline、conflict、permission、error、narrow、large data、text scaleを必要に応じて反証する。
4. pointer、keyboard、direct input、focus order、name / role / state、contrast、reduced motion、live regionを確認する。
5. Today、detail、Compactの階層、selection、current / next、copyが製品状態と一致することを確認する。
6. data / sync / time / migration / nativeの影響があれば、該当Skillの手順と検証を組み合わせる。

## 4. 証跡

- 変更対象、影響状態、Pass / Fail、P0 / P1 / P2を明記する。
- test、accessibility tree、native observationを主証跡にし、browser previewやmockをnative事実の代用にしない。
- visual / layout / copyの意味が変わる場合だけ、同じviewport・OS・synthetic fixtureのbefore / after screenshotを残す。
- 表示差分のないinteractionや内部状態変更では、focused test・accessibility・保存結果を使い、不要なscreenshotを作らない。
- 実行した検証、未実行理由、affected OS、残るriskを対象commitとともに記録する。

## 5. 停止条件

- 製品状態を誤表示する、データ保持・回復方法がない、keyboard等価操作がない、またはaccessibilityのP0が残る。
- local saveとremote sync、local deleteとremote delete、permissionとdelivery、trayとcomplete exitを混同する。
- 未実行のnative / OS / user observation / screenshotを確認済みと表現する。
- secret、token、個人予定、raw payload、絶対pathをUI、log、evidenceへ出す。

未確認事項は未確認のまま報告し、testやscreenshotを捏造しません。
