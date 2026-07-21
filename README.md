# Day Schedule Next

Day Schedule Next は、一日の予定を分単位で設計・実行し、現在・次・残り・空き時間を把握する個人利用向け macOS / Windows デスクトップアプリです。Tauri 2、React、TypeScript、Rust、SQLite を使い、ローカルを一次データとして Google Calendar と双方向同期します。

## 実装済み機能

- Today / 週 / 月 / 一覧、24時間ストリップ、重なり表示、詳細タイムライン、日跨ぎ・終日予定
- 予定の作成・編集・複製・削除、ドラッグ・リサイズ、キーボード等価操作、分類の原子的な一括変更、Undo / Redo
- 日次テンプレート、適用前プレビュー、追加／安全な置換、Quick Block、自由アラーム
- Focus の開始・一時停止・再開・休憩・終了、予定への紐付け、予定別実績集計、当日履歴
- 永続通知台帳、重複抑止、復帰時の猶予・上限、OS 通知とアプリ内音の独立設定
- Desktop OAuth + Authorization Code + PKCE + loopback、Outbox、差分同期、競合解決
- SQLite migration、バックアップ、復元 staging、JSON export / import、旧 DB の read-only preview
- Compact Window、トレイ常駐、single instance、構造化・マスク済み診断 export

詳細な操作は [`UserManual.md`](UserManual.md)、障害対応は [`OPERATIONS.md`](OPERATIONS.md)、Google 接続準備は [`docs/guides/google-calendar-oauth.md`](docs/guides/google-calendar-oauth.md) を参照してください。

## 開発環境

- Node.js 22 以上
- pnpm 10.13.1（Corepack）
- Rust 1.89.0
- macOS: Xcode Command Line Tools
- Windows: Microsoft C++ Build Tools と WebView2 Runtime

```bash
corepack enable
pnpm install --frozen-lockfile
pnpm --dir apps/desktop tauri dev
```

## 検証

```bash
npm run verify:bootstrap
pnpm format:check
pnpm lint
pnpm typecheck
pnpm test
pnpm test:a11y
cargo fmt --all -- --check
cargo clippy --workspace --all-targets --all-features -- -D warnings
cargo test --workspace --all-features
pnpm build
pnpm tauri:build:debug
```

ネイティブ E2E は、E2E 専用 identifier と capability で build してから実行します。通常 build に WebDriver plugin は含まれません。

```bash
VITE_WDIO=true pnpm --dir apps/desktop tauri build --debug --no-bundle --features e2e --config src-tauri/tauri.e2e.conf.json
pnpm test:e2e
```

個人利用向けに、PR CI は harness / frontend と、native 影響時の macOS arm64 Rust test・通常 Tauri no-bundle build に絞っています。詳細は [`docs/testing/index.md`](docs/testing/index.md) にあります。

## データとセキュリティ

- React から SQLite、Google API、OS credential store を直接呼びません。
- OAuth token は OS の秘密ストアへ保存し、SQLite や設定 export へ含めません。
- CSP は self / IPC と同梱 asset に限定し、remote script、CDN、general shell / fs / SQL 権限を使いません。
- 公開用診断には予定本文、メール、calendar / event ID、token、絶対パスを含めません。

アプリデータや OAuth credential を Issue、PR、fixture、スクリーンショットへ掲載しないでください。

## 文書案内

- 実行規約: [`AGENTS.md`](AGENTS.md)
- 製品不変条件: [`docs/product-invariants.md`](docs/product-invariants.md)
- アーキテクチャ: [`docs/architecture-boundaries.md`](docs/architecture-boundaries.md)
- UI/UX ガバナンス: [`docs/ai-governance/00-index.md`](docs/ai-governance/00-index.md)
- テスト: [`docs/testing/index.md`](docs/testing/index.md)

## ライセンス

MIT License。依存ライセンスと既知 advisory は `deny.toml` と、依存変更PR・月次・手動で動く Dependency audit workflow で継続監査します。
