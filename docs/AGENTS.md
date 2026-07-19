# Documentation rules

ルート [`AGENTS.md`](../AGENTS.md) を継承します。

- README は入口、UserManual はユーザー操作、`docs/engineering/` は技術契約、`docs/ai-governance/` はレビュー規約に分ける。
- 現在有効な仕様だけを書く。作業メモ、将来対応の連絡、秘密値、実ユーザーデータを残さない。
- 同じ長文を複数文書へコピーせず、正本へリンクする。
- 外部仕様を根拠にする場合は公式一次資料を優先し、確認日または version 固定の要否を判断する。
- Markdown link と code command を変更したら `node scripts/verify-doc-links.mjs` を実行する。
