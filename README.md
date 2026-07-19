# Day Schedule Next

Day Schedule Next は、分単位で一日の予定を設計し、実行中・次の予定・残り時間を把握できる、個人利用向けの macOS / Windows デスクトップアプリです。Tauri 2、React、TypeScript、Rust、SQLite を基盤とし、ローカルファーストで Google Calendar と安全に同期します。

このリポジトリは実装開始前の品質ハーネスを先に確立しています。AI エージェントと人間の開発者は、実装前に [`AGENTS.md`](AGENTS.md) と [`docs/product-invariants.md`](docs/product-invariants.md) を読み、変更領域に対応する Skill と完了ゲートを適用してください。

## 現在の状態

- エージェント実行規約、UI/UX ガバナンス、同期・時刻・移行・配布の専用レビュー手順を整備済み
- GitHub Issue / PR テンプレートと CI 品質ゲートを整備済み
- アプリ本体のスキャフォールドと実装は後続 Issue で行う

## 主要な設計前提

- Desktop: Tauri 2
- Frontend: React + TypeScript + Vite
- Native / domain: Rust
- Persistence: SQLite（Rust 側のみが直接アクセス）
- Calendar: Google Calendar API（Desktop OAuth + PKCE、差分同期）
- Secrets: macOS Keychain / Windows Credential Manager
- Platforms: macOS を先行し、同一コードベースで Windows へ展開
- Distribution: 個人利用、非販売。公開可能なコード品質と秘密情報管理を維持

## 最短の確認

```bash
node scripts/verify-agent-harness.mjs
node scripts/verify-doc-links.mjs
node scripts/security-scan-text.mjs
node scripts/check-repository-boundaries.mjs
```

アプリ本体が追加された後は、ルート `package.json` の `verify` と、macOS / Windows のネイティブビルドを完了条件に含めます。

## 文書案内

- エージェント実行規約: [`AGENTS.md`](AGENTS.md)
- 製品不変条件: [`docs/product-invariants.md`](docs/product-invariants.md)
- アーキテクチャ境界: [`docs/architecture-boundaries.md`](docs/architecture-boundaries.md)
- 品質・設計原則: [`docs/agent-principles.md`](docs/agent-principles.md)
- UI/UX ガバナンス: [`docs/ai-governance/00-index.md`](docs/ai-governance/00-index.md)
- テスト戦略: [`docs/testing/index.md`](docs/testing/index.md)
- リリースゲート: [`docs/release-quality-gates.md`](docs/release-quality-gates.md)
- ユーザー操作説明: [`UserManual.md`](UserManual.md)
- 障害・復旧・診断: [`OPERATIONS.md`](OPERATIONS.md)
- コントリビューション: [`CONTRIBUTING.md`](CONTRIBUTING.md)

## ライセンス

MIT License。第三者依存のライセンスは実装時に別途収集・確認します。
