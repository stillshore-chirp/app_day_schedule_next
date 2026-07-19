---
name: time-notification-review
description: "時刻、timezone、DST、日跨ぎ、再発、現在進行、通知、Focus/Pomodoro、sleep/resume、clock jump を deterministic にレビューする。"
---

# Time / Notification Review Skill

## 1. 発動条件

- date / time / duration / timezone / all-day / recurrence。
- timeline position、overlap、current / next / remaining / free time。
- notification rule / delivery / permission / sound。
- Focus / Pomodoro state machine。
- sleep、resume、system clock / timezone change、app lifecycle。

## 2. 必読

- `AGENTS.md`
- `docs/product-invariants.md`
- `docs/engineering/time-and-recurrence.md`
- `docs/engineering/notifications-and-focus.md`
- UI 変更なら UI/UX Skill
- schema 変更なら data-migration Skill

## 3. clock model

- domain logic は injected `Clock` を使う。
- wall clock と monotonic elapsed time を区別する。
- concrete schedule は UTC instant + IANA timezone。
- template / Quick Block / free alarm は wall-clock intent と timezone policy を保持する。
- interval は `[start, end)`。接する予定を overlap と数えない。
- duration 0、負、1440 分超、同時刻 start/end の意味を明示する。

## 4. timezone / DST

- DST gap: 存在しない local time を黙って次時刻へ移さない。
- DST overlap: どちらの offset かを明示・保持する。
- timezone change: instant を維持するか wall-clock intent を維持するか entity type ごとに定義する。
- calendar timezone と system timezone の差を表示・変換する。
- all-day は date range として扱い、UTC midnight へ単純変換しない。

## 5. recurrence

- RFC 5545 rule、exception、exdate、moved occurrence、cancelled occurrence を区別する。
- 月末、うるう日、週開始、count / until、timezone change を test する。
- template repeat と calendar recurrence を混同しない。
- occurrence edit の対象が単体 / future / series のどれかを UI で明示する。

## 6. timeline calculations

- overview と detail の overlap algorithm を別契約として test する。
- cross-midnight を day segment に分割しても同一 entity identity を保持する。
- current、elapsed、remaining、next は同じ clock snapshot から計算する。
- 複数 current item、hidden Quick Block、cancelled / completed item の扱いを定義する。
- current-time line と countdown は必要以上の再render / screen reader announcement を発生させない。

## 7. notification delivery

- rule と delivery ledger を分離する。
- delivery key は event / rule / occurrence / phase を一意にする。
- 同一 delivery を restart、resume、multiple timer callback で重複送信しない。
- late delivery grace window と最大遡及件数を定義する。
- sleep が長い場合に通知を一斉発火しない。
- permission denied、OS muted、native API failure を「通知済み」と誤表示しない。
- schedule start / end、free alarm、Focus phase を識別可能な通知とする。
- complete exit と tray residency の能力差を UserManual に記載する。

## 8. Focus state machine

最低状態:

- `Idle`
- `Working`
- `Paused`
- `Break`
- `WaitingNext`

各 transition で guard、timestamp、accumulated duration、notification、persistence、restart recovery を定義する。二重 start、pause 中の timer advance、break skip、stop、crash recovery を test する。

## 9. 必須テスト

- 23:59→00:00、cross-midnight、24h duration。
- DST spring gap / fall overlap、system timezone change。
- leap day、month end、year end、locale / week start。
- adjacent vs positive overlap、5分互換 threshold、multiple overlap。
- system sleep 30秒 / 10分 / 8時間、resume、clock backward / forward。
- duplicate callback、app restart、permission denied、native failure。
- Focus all transitions、pause / resume repeated、restart in each state。
- fake clock / property test で nondeterminism がないこと。

## 10. evidence and output

- state transition table。
- boundary case table。
- fake clock test results。
- native notification manual results on affected OS。
- UI state / copy / permission evidence。
- P0 / P1 / P2、未実行、残リスク。

naive datetime、silent DST correction、unbounded missed-notification replay、duplicate delivery が残る場合は P0 です。
