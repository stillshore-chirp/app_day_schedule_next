# Issue #9 State Matrix

対象は独立した「タイマー」「ストップウォッチ」画面と、タイマー構成セット、JSON移行、完了通知です。Google同期、予定、再発、Compact Windowはこの機能の状態を持たないため、影響なしとして明示します。

| State | User sees | User understands | Allowed next action | Recovery | A11y status / structure | Evidence | Pass / Fail |
|---|---|---|---|---|---|---|---|
| First use / empty | タイマー0件の理由、追加フォーム、構成セット0件 | ラベルは任意で、最初のタイマーを追加できる | 時分秒を入力して追加 | 入力エラーは欄の近くに表示 | `main`、見出し、native form、empty text | empty axe / component | Pass |
| Normal / multiple | 各カードのラベル、残り、進捗、状態、個別操作 | 複数タイマーが独立して進む | 開始、一時停止、再開、リセット、編集、削除 | version conflict時は入力保持と再読込を案内 | named `article`、`output`、`progress`、状態text | native-timers / component / Rust service | Pass |
| Stopwatch idle / running / paused | 独立画面に経過値、状態、許可操作 | タイマーとは別の単一経過計測 | 開始、一時停止、再開、0に戻す | 読込・操作失敗時は状態を変更せず再試行 | `main`、見出し、named `output`、native buttons | native-stopwatch / component / axe | Pass |
| Timer set saved / apply | セット名、件数、ラベルと設定時間、追加・削除 | 実行状態を保存せず、既存タイマーを残して追加する | セットを追加適用、セットだけ削除 | 500件超過と同名は全体を変更せず説明 | semantic list、削除はinline alert | native-timers / repository / component | Pass |
| Many items | 500件を同じカード構造でスクロール | 全件が削除・操作可能な上限内にある | 任意カードへ到達 | 501件目は既存を保持して拒否 | 500 named articles | 500-item component 0.9s前後 / repository limit | Pass |
| Loading | 「この端末の…を開いています」 | 対象データを読込中 | 待つ | 失敗時に再試行 | `role=status` | component source / typecheck | Pass |
| Partial / stale data | 既存カードを残し、定期更新失敗を空状態へ変換しない | 表示済みデータが消えていない | 個別操作または再読込 | 次のpollまたは操作後load | 毎秒値をlive regionにしない | implementation inspection | Pass |
| Input error | 1秒〜7日の制約を入力近くに表示 | 何を直すか、入力が保持されたこと | 時分秒を修正 | 再送信 | fieldset `aria-describedby` | component validation test | Pass |
| Disabled while active | 編集欄disabledと「先にリセット」 | ラベル・時間変更にはリセットが必要 | 一時停止／再開／リセット | リセット後に編集 | native disabled state + visible reason | native-timers | Pass |
| Timer completed | 終了状態、残り00:00、もう一度開始 | どのタイマーが完了したか | 再開始／リセット／削除 | run単位で再実行 | 状態text、完了時だけpolite announcement | service / notification tests | Pass |
| Permission unknown / denied | 画面内の完全終了制約、設定側の通知状態 | 通知可否は既存のOS通知設定に従う | 設定で許可、タイマー自体は継続利用 | 次回起動時に経過状態を復旧 | 音だけに依存せずvisual completion | notification tests; OS権限manual未実行 | Pass with remaining platform risk |
| Offline / Google disconnected / conflict | タイマー画面に同期表示を追加しない | この機能は端末ローカルでGoogle非対象 | 通常操作を継続 | SQLiteから復旧 | N/A | architecture / contracts | Pass |
| Import add / replace | previewにタイマー・セット件数 | 実行途中は移行せず構成だけを取り込む | add / replaceを確定 | fingerprint不一致・500件超過はtransaction全体を拒否 | definition list / existing import confirmation | v1/v2 roundtrip Rust tests | Pass |
| Fatal migration error | 既存boot error | DBを変更せず復旧が必要 | 再試行・backup確認 | startup gate | existing danger status | migration chain / existing shell | Pass |
| Compact Window | 表示追加なし | タイマー・ストップウォッチは各専用画面で操作 | メイン画面を開く | N/A | N/A | scoped out | Pass (N/A) |
| Narrow 720px | icon navigation、1列フォーム、カード | 主操作と選択中画面 | すべての主要操作 | vertical scroll | visible focus、reflow | native-timers-narrow | Pass |
| 200% text / high DPI | 1列配置で見出し、入力、残り、状態 | 同じ情報と操作を拡大表示 | keyboard / pointer操作 | vertical scroll | text and controls remain unclipped | native-timers-text-200 | Pass on macOS Retina |
