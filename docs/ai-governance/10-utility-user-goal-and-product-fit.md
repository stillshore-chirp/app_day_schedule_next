# Utility, User Goal and Product Fit

## 1. 基本質問

すべての UI / feature 変更で答えます。

1. 誰が使うか。
2. どの文脈か。
3. 何を達成したいか。
4. 予定の理解、判断、行動、回復、継続のどれを助けるか。
5. この UI がなければどこで困るか。
6. 既存導線で代替できないか。
7. 追加情報は意思決定に使われるか。
8. 削るべき操作 / information はないか。

## 2. Day Schedule Next の Job

- 今日の時間配分を短時間で作る。
- 現在と次を見失わず実行する。
- 計画変更を分単位で素早く反映する。
- recurring pattern を再利用する。
- Google 接続の有無に関わらず計画を保持する。
- failure から data を失わず回復する。

screen name を user goal として書きません。

弱い:

```text
ユーザーは設定画面を使う。
```

良い:

```text
ユーザーは通知の頻度と、アプリ終了中に通知できる条件を確認し、自分の作業を妨げず必要な通知だけを受け取りたい。
```

## 3. Job / Task / Decision / Feedback / Recovery

各画面は最低一つの Task、Decision、Feedback、Recovery を支援します。

例: conflict resolver

- Task: conflict item を確認。
- Decision: local / Google / field merge。
- Feedback: next sync state。
- Recovery: resolution retry / reopen。

## 4. P0

- target user / goal を説明できない。
- primary information が判断に使われない。
- technical architecture を user value として説明する。
- schedule planning を妨げる secondary feature を主役にする。
- Google connection を必須にして local-first value を壊す。

## 5. P1

- value はあるが context / scope が曖昧。
- similar screens が重複。
- main task より settings / diagnostics が強い。
- information の一部が decision に使われない。

## 6. 削る判断

候補:

- internal ID / debug status。
- 常時表示の長い onboarding。
- duplicate create actions。
- rare advanced setting の primary placement。
- decorative metrics that do not change action。

## 7. Success hypotheses

計測していないものは hypothesis と明示します。

- schedule create / move / resize completion steps。
- correction / Undo rate。
- conflict resolution success。
- search reset rate。
- notification permission recovery。
- help / shortcut usage。
- time to understand current / next。
