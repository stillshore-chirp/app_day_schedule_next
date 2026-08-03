# Issue #36 UI evidence

すべて synthetic fixture と隔離 SQLite DB を使った macOS arm64 native E2E の証跡です。Google account、Task、List、token の実値は含みません。

- `before-settings-calendar-only.png`: Issue #14 の Calendar-only 設定画面を再利用した変更前基準。
- `before-ticket-detail.png`: Issue #35 の Ticket 詳細を再利用した変更前基準。
- `after-settings-conflict.png`: Google Tasks の競合理由、3 値比較、明示的な解決手段。
- `after-settings-text-200.png`: Google Tasks 設定領域の 200% text smoke。
- `after-ticket-detail.png`: 同期先 List、Local 専用項目、同期解除と Google 側削除の分離。

キーボード smoke では「完全照合」へフォーカスを移動し、native E2E で active element の accessible text を確認しています。狭幅は既存の設定画面・Ticket 詳細の 720px native smoke と、Tasks UI のレスポンシブ 2 列 state matrix を組み合わせて確認しています。
