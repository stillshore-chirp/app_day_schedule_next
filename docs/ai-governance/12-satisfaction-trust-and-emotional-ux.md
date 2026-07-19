# Satisfaction, Trust and Emotional UX

## 1. Trust model

Day Schedule Next では、装飾より次が trust を作ります。

- 操作結果が分かる。
- local data が保持される。
- Google sync state が正直。
- failure から戻れる。
- notification / Focus が予測可能。
- destructive action の scope が明確。
- app が user を責めない。

## 2. Waiting

- どの処理が進行中か。
- schedule data が消えたように見えないか。
- local edit が続けられるか。
- full sync / backup / restore の stage と cancelability。
- retry / background continuation の見通し。

## 3. Success

- local save / Google sync / backup / restore の何が完了したか。
- affected item / count / calendar。
- Undo / details / next action。
- success notification が短すぎず、作業を遮りすぎない。

## 4. Failure

- cause category、impact、data retention、recovery。
- input / local change を保持する。
- re-auth / retry / restore / diagnostics の導線。
- raw technical error で user を放置しない。

## 5. Dangerous actions

- local delete、remote delete、both。
- recurrence series scope。
- template replace。
- restore / import。
- disconnect / revoke。
- history / backup purge。

対象、count、scope、irreversibility、backup / Undo を示します。

## 6. Notification / Focus

- sudden sound / modal で作業を破壊しない。
- sound only に依存しない。
- app exit / tray / permission の制約を正直にする。
- Focus auto transition の設定と current state を見えるようにする。

## 7. Tone

禁止:

- user blame。
- `簡単`, `当然`。
- data safety の根拠ない assurance。
- routine pending を危険障害のように見せる。
- conflict / restore risk を弱く見せる。

推奨:

- fact、impact、recovery。
- preserved work を明示。
- destructive scope を具体化。
- next action を一つ主にする。

## 8. P0

- success / failure が不明。
- user input / data が消えたか分からない。
- delete / restore / sync conflict の impact が不明。
- false reassurance / unnecessary fear / blame。
- notification が重複・暴発し、制御手段がない。
