# Issue #35 UI/UX review

## 対象とユーザー価値

- 対象: Ticket card、Ticket詳細、Focus画面、Focus終了summary。
- Job: 見積・予定・実績・残りを同じTicket文脈で比較し、意図した予定からFocusを開始する。
- 価値判定: Pass。開始前の帰属先、開始後の固定先、終了後にTicketが自動完了しないことを画面上で確認できる。

## 初見シミュレーション

1. Cardの「実績 / 残り」で進捗を認識できる: Pass。
2. 詳細の4指標と説明から、休憩除外・開始時固定を判断できる: Pass。
3. 関連予定ごとのボタンから、どの予定で開始するか選べる: Pass。
4. Doneでは「完了のまま」「再開して」の2択が明示される: Pass。
5. Focus画面で未帰属 / 帰属先を開始前後に確認できる: Pass。
6. 終了後に自動Doneではないことと次の操作を判断できる: Pass。

## State matrix

| State | 表示 / 操作 | Result |
|---|---|---|
| estimateなし | 残り・差は「未設定」 | Pass |
| 関連予定なし | Ticket詳細に開始ボタンなし、Focus側は未帰属説明 | Pass |
| 関連予定あり | 予定行ごとに開始 | Pass |
| Done | 完了維持 / 明示再開 | Pass |
| 別Focus継続中 | 先に現sessionを終了する回復手順 | Pass |
| working / paused / break / waiting | 帰属snapshotを維持し、waitingで予定を差し替えない | Pass |
| unlink / relink / archive / delete | 過去実績を開始時Ticketへ保持 | Pass (Rust) |
| schedule delete | 過去実績を保持 | Pass (Rust) |
| 500 Ticket / 50,000履歴 | 一括query、N+1なし | Pass (0.31s local) |
| narrow / 200% text | metricsは2列へ縮退、dialog scrollを維持 | Pass (native screenshot) |

## Accessibility / hierarchy / copy

- 指標は`dl/dt/dd`で意味構造を保持し、色だけに依存しない。
- 開始・関連解除・Done選択はtext label付きbuttonでkeyboard操作可能。
- 読み込み・成功・失敗はstatus/error copyを持ち、現在Focusの二重開始を防ぐ。
- 見積→実績→残り→差、予定→開始、履歴の順で詳細内の優先度を固定した。
- 「自動変更しない」「未帰属」「開始時点で固定」を明記し、暗黙処理への不信を避けた。

## 熟練者効率 / trust

- Cardで詳細を開かず進捗を確認できる。
- Ticket詳細から関連予定を作り、その行から1 clickでFocusを開始できる。
- Doneだけは不可逆な誤解を避けるため1段階の明示選択を残す。
- 過去の未帰属実績の手動割当はMVP非対象としてUIとManualへ明記した。

## 反証レビュー

- Focus終了がTicketを自動Doneにしない: 確認済み。
- pause / breakが実績へ混入しない: 1,200秒 + 600秒のみを1,800秒として確認。
- relink後に実績が新Ticketへ移らない: 確認済み。
- duplicate stopが二重加算しない: 確認済み。
- Ticket保存後に予定所要時間が古いままになる問題をnative E2Eで検出し、prop同期を修正した。
- Focus進行中の別Ticket開始は先に終了を要求し、Done再開だけが部分適用される経路を閉じた。

## Evidence

- Before: `apps/desktop/test-results/native-ticket-detail.png` (#34 UI、Focus比較なし)。
- After: `apps/desktop/test-results/native-ticket-focus-started.png`（4指標、明示開始、固定説明）。
- After: `apps/desktop/test-results/native-ticket-focus-ended.png`（終了summary、自動Doneなし）。
- After: `apps/desktop/test-results/native-ticket-focus-narrow.png` / `native-ticket-focus-text-200.png`。
- Native E2E: `attributes Focus to the Ticket selected through an explicit related schedule` pass。
- Component: 21 files / 118 tests pass、a11y 3 files / 7 tests pass。

## 未実行 / 残リスク

- Windows native UI、OS scaling、screen reader実機は未実行。
- 実ユーザー検証は未実施。
