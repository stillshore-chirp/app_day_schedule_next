# Documentation rules

ルート [`AGENTS.md`](../AGENTS.md) を継承します。製品・データ・同期・時間・通知の不変条件は [`product-invariants.md`](product-invariants.md)、依存方向は [`architecture-boundaries.md`](architecture-boundaries.md)、技術契約は [`engineering/`](engineering/) を正本とします。

- README は入口、UserManual はユーザー操作、`docs/engineering/` は技術契約、OPERATIONS は復旧・運用、SECURITY はsecurity policyに分ける。
- 現在有効な仕様だけを書く。作業メモ、未確定の将来予定、秘密値、実ユーザーデータを残さない。
- 製品挙動の変更は該当するproduct / architecture / engineering docと実装・testを同じ変更で更新する。
- 同じ長文を複数文書へコピーせず、正本への短い要約とlinkにする。agentの発動条件や実行手順を製品契約へ混ぜない。
- UI、sync、time / notification、migration、Tauri / releaseの判断は、それぞれのcanonical Skillを使い、詳細matrixを複製しない。
- 外部仕様を根拠にする場合は公式一次資料を優先し、確認日または version 固定の要否を判断する。
- Markdown link と code command を変更したら `node scripts/verify-doc-links.mjs` を実行する。
