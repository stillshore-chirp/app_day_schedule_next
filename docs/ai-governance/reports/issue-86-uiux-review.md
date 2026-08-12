# Issue #86 アナログ時計ピン操作・最小サイズ UI/UX Review

- 対象面: repository が制御する Tauri アプリ本体 UI
- 対象: アナログ時計専用ウィンドウの常に手前操作と最小 content size
- 対象ユーザー: 他の作業を続けながら、時計を小さく常設して現在時刻を確認する利用者
- ユーザー提示の判断: 設定を開かずに固定を切り替え、多少時計盤へ重なっても小さな表示面積を優先する

## 価値と初見理解

右上の設定ボタンと同じ 44px の円形ピンを左へ並べ、outline は「常に手前」OFF、primary 色と塗りは ON を表します。tooltip と accessible name は現在の状態に合わせて「常に手前に固定」「常に手前を解除」へ切り替わります。既存の設定 checkbox は同じ状態を操作する別導線として維持します。

最小 content size は 360px から 280px へ縮小します。340px 以下では左上の完全な日時を時刻だけへ切り替え、ピンと設定ボタンの操作領域を維持します。時計盤は短辺へ追従し、ユーザーが許容した範囲で右上操作と盤面が重なります。

## 状態・操作・回復

詳細は [state matrix](issue-86-state-matrix.md) を正本とします。

- 読込完了まではピンを無効化し、name と title で確認中または読込失敗を説明します。
- 操作時は押下状態を即時反映し、native 更新または保存に失敗した場合は直前の状態へ戻して再試行可能な案内を表示します。
- native 適用後に preference 保存が失敗した場合は、Rust command が native 状態も直前の値へ補償復元します。
- 設定 dialog の focus trap、Escape、focus restoration、内部 scroll は維持します。

## Accessibility / visual hierarchy / efficiency

- pin button に動的 name、title、`aria-pressed`、44px 四方の target を設けます。
- ON は色、塗り、`aria-pressed=true` の三つで識別でき、色だけへ依存しません。
- 設定ボタンとの間隔を 8px とし、Tab 順序はピン、設定、dialog 内 controls の順です。
- compact 表示でも時刻要素の accessible name は完全な日時を保持します。
- axe serious / critical、pointer、keyboard、失敗復元、設定との同期を component test と native E2E で確認します。

## 最小権限と信頼

既存の型付き `set_window_always_on_top` IPC と保存契約を再利用します。capability、CSP、plugin、filesystem、network、同期、予定データ、SQLite schema は変更しません。画面証跡は合成状態だけを使い、実アカウント、予定、token、端末固有 path を含めません。

## 反証レビュー

- 高速な二重操作は処理中 lock と disabled state で重複 command を防ぎます。
- bootstrap 失敗時に未確認値で OS 状態を変更しません。
- 280px で日時と二つの操作が互いに重ならず、縦横 overflow が出ないことを native viewport で確認します。
- window resize event が layout 更新前に届く場合を考慮し、次 animation frame と ResizeObserver の双方で時計盤を再計測します。
- macOS content aspect ratio と Windows `WM_SIZING` の実装差を分け、Windows DPI 100% / 150% の最小辺を Unit test で固定します。

## 証跡・判定

- After: [480px・ピン固定中](../../evidence/issue-86/native-analog-clock-pin.png)、[最小 280px](../../evidence/issue-86/native-analog-clock-minimum.png)
- Automated: React component、axe、Rust Unit、macOS native Tauri WebView、format / lint / typecheck / build を PR へ記録します。
- P0: なし。
- P1: なし。
- P2: なし。
- macOS arm64 ではピン操作、保存、設定 checkbox 同期、280px content viewport、正方形、overflow、200% text を native E2E で確認しました。
- Windows WebView2 の native CI、手動 drag、Snap、NVDA / VoiceOver は未実行項目として扱います。
