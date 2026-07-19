# UI Copy and Microcopy

## 1. 原則

- ユーザーの言葉を使う。
- action label は結果を示す。
- local state と remote state を正確に区別する。
- error は原因、影響、data retention、recovery を示す。
- permission / delete / restore / conflict で false reassurance をしない。

## 2. 用語

推奨:

- `予定`、`一日のテンプレート`、`クイックブロック`、`Google カレンダー`。
- `この端末に保存済み`、`Google への同期待ち`、`同期済み`。
- `同期の競合`、`再接続が必要`、`通知が許可されていません`。

UI へ出さない:

- outbox、etag、nextSyncToken、mapping、schema、migration id、raw HTTP status。

technical details は diagnostics / support detail に限定します。

## 3. Action labels

弱い: `OK`, `実行`, `保存`, `削除`。

具体例:

- `予定を作成`
- `変更を保存`
- `Google と同期を再試行`
- `この端末から削除`
- `この端末と Google から削除`
- `バックアップを作成して復元`
- `選択した12件を翌日に移動`

## 4. Save / sync

- local transaction 完了時: `この端末に保存しました。Google への同期を待っています。`
- remote complete: `Google カレンダーと同期しました。`
- offline: `この端末には保存済みです。接続が戻ると同期します。`
- retry: next attempt / manual action を示す。

「保存しました」を remote complete の意味で誤用しません。

## 5. Error format

最低要素:

1. 何が起きたか。
2. 何に影響するか。
3. 入力 / local data が保持されているか。
4. 次にできること。

例:

```text
Google へ反映できませんでした。この端末の変更は保存されています。接続を確認して「同期を再試行」を選んでください。
```

## 6. Conflict

- conflict した field と remote / local の更新時刻を必要な粒度で示す。
- `端末の変更を使う`、`Google の変更を使う`、`項目ごとに選ぶ`。
- recurrence / delete の series scope を明示する。
- `おすすめ` を出す場合も、理由と影響を示す。

## 7. Permission / lifecycle

- notification permission の用途と request timing を説明する。
- denied 時は OS settings への具体導線。
- complete exit 中の notification 制約を曖昧にしない。
- tray / background を導入する場合は、終了との違いを明示する。

## 8. Empty / disabled

- initial empty: 予定作成 / template apply の次 action。
- search no result: query / filter reset。
- permission / error を empty に見せない。
- disabled は理由と有効化条件を keyboard / touch でも確認可能にする。

## 9. Tone

禁止:

- user を責める。
- `簡単です`, `当然です`。
- data risk を曖昧に安心させる。
- technical detail で user に責任転嫁する。

推奨:

- 事実、影響、回復を短く示す。
- user work が保持される場合は明示する。
- destructive impact を具体化する。
