# Cognitive Psychology and Cognitive Accessibility

## 1. 作業記憶を使わせない

- current date、selected item、target calendar、sync state を画面内に残す。
- previous screen の time / category / recurrence を覚えないと編集できない構造を避ける。
- `Quick Block` や `Template` は必要な初回説明と具体例を持つ。
- internal ID / schema / sync token を出さない。

## 2. 記憶より認識

-空き時間、drag handle、selected block、snap、current time を見える手がかりにする。
- previous values、recent categories、last calendar、saved filters を必要に応じて保持する。
- validation rule は入力後だけでなく入力中に示す。
- shortcut は help / menu から参照できる。

## 3. mental model

ユーザーの概念:

- 今日の予定。
- 一日の型。
- 一時的なブロック。
- 現在 / 次 / 残り。
- この端末に保存 / Google へ同期。

実装概念 `schedule_items`, `template_blocks`, `outbox`, `mapping`, `etag` を UI 構造に漏らしません。

## 4. 注意誘導

- main action は予定作成 / 調整。
- current / next は高い優先度だが、編集操作を覆わない。
- sync conflict / data corruption / restore impact は見逃せない強さにする。
- routine pending sync は過剰な赤 warning にしない。
- 同時に複数の強い badge / banner / animation を競合させない。

## 5. 選択肢

- basic create では title、time、duration、calendar 等の必要項目を優先する。
- recurrence、timezone、advanced notification は progressive disclosure。
- default は安全で、previous setting は user intent に合う範囲で再利用する。
- conflict resolution は field grouping と recommended action を示すが、silent auto-choice はしない。

## 6. 失敗と回復

- drag は preview、Esc、Undo。
- invalid time は input を保持。
- offline は local save を保持し retry 状態を示す。
- auth expiry は再接続しても local data を失わない。
- restore / import は preview、cancel、backup、rollback。

## 7. 初心者と熟練者

- first-run help は dismiss / reopen 可能。
- recurring explanation を毎回表示しない。
- expert は keyboard、duplicate、template、multi-select、saved filter を使える。
- safety confirmation は destructive / remote impact に絞る。

## 8. review conversion

```text
認知原則
-> timeline / dialog / status 上の観察点
-> Pass / Fail
-> evidence
-> concrete fix
```

理論名だけの指摘は禁止します。
