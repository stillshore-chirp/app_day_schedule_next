# Issue #11 State Matrix

対象は「設定」で選択・保存するテーマと、メインウィンドウ／コンパクトウィンドウでの配色です。予定、同期、通知、DB の状態遷移は変更せず、既存の状態表現をマイルド配色でも区別できることを確認します。

| State | User sees | User understands | Allowed next action | Recovery | A11y status / structure | Evidence | Pass / Fail |
|---|---|---|---|---|---|---|---|
| First use / system | 従来どおり OS に追従する「システム」 | 初期値は OS の外観に従う | ライト、マイルド、ダークを選ぶ | 既定値へ戻す | native `select` と label | contracts / component | Pass |
| Mild selected, unsaved | テーマ欄に「マイルド」 | まだ保存前の選択である | 「設定を保存」 | 別テーマを選び直す | native option、色だけに依存しない名称 | component interaction | Pass |
| Mild saved | 低彩度の灰緑を基調にした中間明度、保存成功表示 | この端末への保存が完了した | 通常操作を続ける | 同じ select から即時変更 | success text、focus ring、見出しを明示色へ固定 | native-mild-settings | Pass |
| Restart / reload | 再読込後もマイルド配色 | 保存済み設定が復元された | 通常操作 | 設定で変更 | `html[data-theme=mild]` を復元 | native E2E / SQLite IPC | Pass |
| Today empty | マイルド配色の空状態、予定作成 CTA、現在／次 dock | 予定がない理由と最初の行動 | 予定を作成 | 日付移動または設定変更 | heading、説明、button、dock text | native-mild-today | Pass |
| Today populated / overlap / many | 既存の semantic token を通じて予定・警告・状態色を表示 | データ状態はテーマ変更前と同じ | 既存操作 | 既存の error / conflict recovery | 文字だけでなく label / border / state text を維持 | existing components + token contrast | Pass |
| Loading / stale / failure | 既存メッセージをマイルド surface 上に表示 | 状態の意味は配色だけで変わらない | 待つ、再試行 | 既存 recovery | status heading と本文を semantic text 色へ固定 | CSS test / component suite | Pass |
| Permission unknown / denied | 既存の通知権限文と warning | OS 権限の状態 | 許可または設定確認 | 既存設定導線 | permission text を semantic text 色へ固定 | native-mild-settings / CSS test | Pass |
| Google disconnected / sync / conflict | 既存の chip、success、warning、danger 色を低彩度で表示 | 同期状態はテーマと独立 | 接続、再試行、競合解決 | 既存 workflow | 状態名と border を併用、chip contrast 検証 | 23 contrast pairs / existing semantics | Pass |
| Compact Window | 同じマイルド配色で現在、次、この後を表示 | 別ウィンドウも保存テーマへ追従 | Quick Add / Focus | メイン画面へ戻る | h1 / h2 を semantic text 色へ固定 | native-mild-compact | Pass |
| Narrow / 200% / high DPI | 配色だけが変わり既存 reflow を維持 | 同じ情報と操作 | scroll / keyboard | 通常の viewport recovery | layout token は未変更、macOS Retina で撮影 | native screenshots / existing responsive tests | Pass with Windows risk |
| Light / dark regression | 従来と同じ既存色 | 既存テーマの意味は変わらない | テーマ切替 | システムへ戻す | base token 値を保持 | CSS diff / full component tests | Pass |
| Offline / DB error / import / restore | テーマ変更による状態遷移なし | ローカルデータ操作とは独立 | 既存 recovery | 既存 backup / restore | N/A for behavior change | architecture inspection | Pass (N/A) |
