# React frontend rules

ルート [`AGENTS.md`](../../../AGENTS.md)、親 [`AGENTS.md`](../AGENTS.md)、製品契約 [`docs/product-invariants.md`](../../../docs/product-invariants.md)、境界 [`docs/architecture-boundaries.md`](../../../docs/architecture-boundaries.md) を継承します。

- feature 単位で `app / features / shared` を分ける。
- server / IPC state は TanStack Query、短命な interaction state は Zustand、form local state は component / form 層へ置く。
- domain rule を component に複製せず、Rust の validation 結果と共有 contract を使う。
- custom interaction は React Aria または native semantic element を優先し、pointer操作には keyboard / direct input の等価手段を持たせる。
- icon-only control は accessible name と tooltip を持つ。危険操作は text label を伴う。
- `data-testid` より role、label、visible text をテスト selector に使う。
- component 内に `invoke`、business branching、DOM imperative operation を集中させず、typed client / hook / view に分離する。
- SQL、Google API、OAuth token、keyring、general shell / filesystem / remote HTTP を直接扱わない。raw `invoke` は typed client に集約する。
- remote asset、CDN、inline executable HTML、`dangerouslySetInnerHTML` を導入しない。

画面・copy・状態が変わる場合は [`ui-ux-review`](../../../.agents/skills/ui-ux-review/SKILL.md) を使います。同期、時刻、migration、native権限の結果が変わる場合は、該当domain Skillも同時に使います。
