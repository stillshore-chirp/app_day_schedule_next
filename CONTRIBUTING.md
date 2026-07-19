# Contributing

Day Schedule Next は個人利用を主目的とするプロジェクトですが、公開可能な保守品質を維持します。

## 作業手順

1. [`AGENTS.md`](AGENTS.md) と対象領域の `AGENTS.md` / Skill を読む。
2. 既存 Issue を検索し、必要なら Issue を作成する。
3. 最新 `main` から `codex/<purpose>` または説明的な作業ブランチを作る。
4. 小さな垂直 slice で実装し、関連テストと文書を同時に更新する。
5. PR テンプレートを埋め、非ドラフト PR を作る。
6. CI、レビュー、未解決 thread を確認する。

## コミット

- 日本語の具体的なコミットメッセージを使います。
- 生成物、secret、token、個人予定、ローカル DB、診断 ZIP を commit しません。
- clean-room 原則に従い、参照アプリのコード・画像・音源・文言をコピーしません。

## 品質

変更領域に応じて `pnpm verify`、Rust checks、native E2E、macOS / Windows build を実行します。未実行項目は理由と残リスクを PR に記載してください。
