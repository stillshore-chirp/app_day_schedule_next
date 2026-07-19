---
name: ui-ux-review
description: "Day Schedule Next の画面、タイムライン、予定操作、コピー、状態、アクセシビリティ、熟練者効率、信頼感を証跡付きでレビューする。ユーザーに見える変更では必ず使う。"
---

# UI/UXレビュー Skill

この Skill は、Day Schedule Next のユーザーに見える変更を、感想ではなく Pass / Fail と証跡で評価する手順です。

## 1. 発動条件

次を含む作業では必ず実行します。

- Today / Week / Month / List / Template / Focus / Alarm / Settings / Diagnostics。
- 24時間ストリップ、詳細タイムライン、Now Dock、Compact Window、Inspector。
- 予定の作成、drag、resize、直接時刻入力、複製、削除、Undo / Redo。
- Google 接続、同期状態、競合解決、calendar 選択、オフライン表示。
- notification / Focus / Pomodoro / permission / backup / restore / legacy import の UI。
- コピー、ラベル、エラー、空、loading、disabled、permission-denied、partial-data。
- accessibility、keyboard、shortcut、focus、contrast、target size、visual regression。

バックエンド変更でも、ユーザーに見える結果・待機・失敗・通知が変わる場合は対象です。

## 2. 必須で読む文書

1. `AGENTS.md`
2. `docs/product-invariants.md`
3. `docs/ai-governance/00-index.md`
4. `docs/ai-governance/02-uiux-review-framework.md`
5. `docs/ai-governance/03-evidence-and-completion-gates.md`
6. 変更内容に応じた `04`〜`12` の詳細文書
7. `docs/engineering/time-and-recurrence.md` または `calendar-sync.md` など関連契約

## 3. スコープ棚卸し

次を特定します。

- 変更画面、component、window、modal、menu、notification。
- 対象ユーザーと利用文脈。
- ユーザーが達成したい結果。
- 最初の有意味な行動。
- 選択中の日、予定、calendar、template、対象範囲。
- 影響する input method: mouse、trackpad、keyboard、screen reader。
- 影響する OS: macOS、Windows。
- 影響する状態: normal、empty、loading、offline、conflict、permission、error、large data。

## 4. ユーザー価値評価

次に答えます。

1. この変更は、予定の把握・設計・実行・回復のどれを助けるか。
2. ユーザーは何を理解、判断、実行しやすくなるか。
3. 画面上の情報は意思決定に使われるか。
4. 既存 UI で代替できるか。
5. 削れる説明、badge、button、panel はないか。

説明できない主要 UI は P0 です。

## 5. 初見シミュレーション

アプリを初めて起動したユーザーとして確認します。

- 今日の日付、現在時刻、現在表示範囲が分かるか。
- 最初の予定をどう作るか分かるか。
- drag 可能な領域と resize handle が分かるか。
- Quick Block、template、calendar、sync の意味が内部用語なしで分かるか。
- 現在予定、次の予定、残り、空き時間の関係が分かるか。
- Google 未接続でもローカル利用できることが分かるか。
- 失敗時に入力を失わず戻れるか。

## 6. state matrix

`docs/ai-governance/templates/state-matrix.md` を埋めます。最低限、次を確認します。

- 初回で予定 0 件。
- 予定あり、重複あり、日跨ぎあり、終日あり。
- 現在進行中 0 / 1 / 複数。
- loading、部分データ、500 件以上、検索結果なし。
- Google 未接続、接続中、同期中、offline、retry wait、conflict、auth expired。
- notification permission 未確認 / 拒否 / 許可。
- Focus idle / working / paused / break / waiting-next。
- backup なし / 作成中 / 失敗 / restore preview。
- 狭い window、Compact Window、200% text、OS scale、高 contrast。

## 7. interaction review

### 7.1 Timeline

- 保存精度 1 分と表示 snap を混同していないか。
- drag 開始閾値が誤操作を抑え、preview が開始・終了・所要時間を示すか。
- `Esc` で取消、drop 後に Undo できるか。
- resize と move の affordance が区別できるか。
- 重複予定が隠れず、選択・編集できるか。
- 現在時刻線が予定 text や focus ring を隠さないか。
- 日跨ぎ予定が両日で同一予定として理解できるか。

### 7.2 Keyboard equivalent

- 予定作成、選択、移動、resize、日移動、編集、削除、Undo / Redo を keyboard で実行できるか。
- drag 必須の機能がないか。WCAG 2.2 の dragging movements を意識する。
- shortcut は menu / help から確認でき、OS 予約 shortcut と衝突しないか。

### 7.3 Inspector / dialogs

- 選択対象と保存先 calendar が明確か。
- 時刻・timezone・recurrence・notification の依存関係が分かるか。
- validation は入力欄近くに出て、入力が保持されるか。
- destructive action の対象、件数、remote 影響、Undo 可否が明確か。

## 8. アクセシビリティ確認

- 主要導線を keyboard だけで完了する。
- focus order、visible focus、focus restoration、modal escape を確認する。
- timeline / schedule block の role、name、time range、selected / conflict / sync state を支援技術へ伝える。
- icon-only button に accessible name を付ける。危険操作は text label を伴う。
- 色だけで category、conflict、sync、priority、current を表さない。
- 4.5:1 text、3:1 non-text、24x24 CSS px 以上を最低目安にする。
- status update は必要に応じて live region を使い、毎秒の時計を過剰に読み上げない。
- animation、current-time movement、Focus transition は reduced motion に従う。

## 9. 視覚階層と密度

- 3秒で Today、現在、次、主操作を把握できるか。
- 24時間 overview と詳細 timeline の役割が競合していないか。
- Now Dock と Compact Window が同じ情報を一貫して示すか。
- 予定件数が多い時にも主操作・選択中・同期警告が埋もれないか。
- 空き時間の表現が予定と競合せず、装飾過多になっていないか。
- macOS / Windows の font rendering と scale で数値・時刻が読めるか。

## 10. コピー

- `sync token`、`etag`、`outbox`、`schema` など内部用語を UI に出さない。
- エラーは何が起きたか、影響、データ保持、回復手段を示す。
- `同期済み` は local save と remote反映を区別する。
- Google から削除、ローカルだけ削除、両方から削除を明確にする。
- notification の完全終了時制約を曖昧に安心させない。
- user を責めず、操作結果を具体的な動詞で示す。

## 11. 熟練者効率

主要反復タスクの手数を数えます。

- 予定作成、複製、時間調整、翌日繰越。
- template 適用、Quick Block toggle。
- Focus start / pause / resume。
- sync retry、conflict resolution。

確認項目:

- 前回 calendar、category、duration、snap、view、filter が必要に応じて保持されるか。
- shortcut、multi-select、bulk move、duplicate、template があるか。
- 初回説明が毎回 timeline を占有しないか。
- 危険でない操作に確認 dialog を乱発していないか。

## 12. 満足感・信頼感

- local save と remote sync の進行が正直に分かるか。
- pending 中も入力と予定が消えたように見えないか。
- conflict / auth expiry / restore で user が何を選ぶか理解できるか。
- success、failure、Undo、recovery が明確か。
- notification / Focus の音・動きが突然すぎず、設定できるか。

## 13. 反証レビュー

実装を落とすつもりで確認します。

- happy path 以外の screenshot がない。
- pointer だけで成立している。
- current-time / overlap / Compact で focus が隠れる。
- offline なのに同期済みに見える。
- local delete と remote delete が曖昧。
- 500 件、長い日本語、23:59、日跨ぎ、DST で崩れる。
- macOS だけの見た目・shortcut を Windows 共通仕様としている。
- 証跡が mock / browser preview だけで native WebView を確認していない。

## 14. 出力

`docs/ai-governance/templates/uiux-review-report.md` を使い、次を残します。

- Pass / Fail と P0 / P1 / P2。
- user value、novice simulation、state matrix。
- accessibility、visual hierarchy、copy、efficiency、trust。
- screenshot / trace / test / manual evidence。
- 未実行検証と残リスク。

P0 または必須証跡不足がある場合は完了不可です。
