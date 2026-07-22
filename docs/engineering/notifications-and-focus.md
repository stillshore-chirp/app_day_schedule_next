# Notifications and Focus Contract

## 1. Notification model

- `notification_rules`: いつ、何を通知するか。
- `notification_deliveries`: occurrence ごとの delivery attempt / result。
- `delivery_key`: entity + occurrence + rule + phase の一意値。
- rule edit と既送信 delivery を混同しない。

## 2. Scheduling

- next due notifications を DB から再構築できる。
- app start / schedule edit / permission change / resume / timezone change で再計算する。
- one in-memory timer に依存せず、persistent ledger と reconciliation を使う。
- callback は idempotent。
- 自由アラームの wall-clock 時刻が DST gap / ambiguity に当たる場合は黙って補正も配信もせず、安定した delivery key で `skipped` と理由を台帳へ1回だけ記録する。
- timer は各 start で新しい run ID を発行し、完了を永続 event として確定してから `entity_type=timer` / `phase=complete` の delivery を生成する。同じ run ID の再観測では追加生成しない。

## 3. Sleep / resume / clock jump

- resume 時に last observed wall time と current time を比較する。
- grace window 内の missed item だけを候補にする。
- max replay count を設け、上限を超えた occurrence も消去せず `skipped` / `replay_limit` として台帳へ1回だけ記録する。
- long sleep 後は summary または skip policy を適用し、一斉発火しない。
- clock backward で同一 delivery を再送しない。

## 4. Permissions and lifecycle

- permission request は user が notification を有効にする文脈で行う。
- denied / unavailable / OS muted / native failure を区別する。
- complete exit、tray resident、window hidden の違いを説明する。
- autostart は明示 consent と feature Issue がある場合だけ導入する。

## 5. Focus state machine

| State | Allowed transitions |
|---|---|
| Idle | Working |
| Working | Paused, Break, Idle |
| Paused | Working, Idle |
| Break | Working, WaitingNext, Idle |
| WaitingNext | Working, Idle |

transition は persisted timestamps、accumulated elapsed、cycle count、linked schedule、notification outcome を更新します。

## 6. Time source

- elapsed work / break は monotonic clock を基本にする。
- persisted recovery では wall-clock timestamp と state を使い、clock jump を検出する。
- UI countdown と state transition は同じ snapshot を使う。

## 7. UX

- Focus start / pause / resume / stop の現在状態を常時確認できる。
- break auto-start / next work auto-start は設定と説明を持つ。
- notification sound / system notification を個別に設定できる設計を検討する。
- screen reader に毎秒 countdown を読み上げない。
- 複数 timer のラベル、残り時間、状態、操作対象をカードごとに明示する。timer set の適用が既存 timer を保持して追加することを操作前に説明する。

## 8. Tests

- duplicate callback、restart、resume、permission denied。
- 自由アラームの DST gap / ambiguity が配信されず、理由付きで重複なく記録されること。
- pause / resume repeated、stop from each state、break skip。
- wall clock forward / backward、timezone change。
- long sleep、grace boundary、max replay。
- linked schedule delete / move during Focus。
- 複数 timer の同時完了、同一 run の repeated poll / restart、timer 削除、通知拒否、bounded replay。
- stopwatch と timer の monotonic 経過、process restart、wall clock forward / backward。
