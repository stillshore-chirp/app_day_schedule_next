# React frontend rules

ルート [`AGENTS.md`](../../../AGENTS.md) と親 [`AGENTS.md`](../AGENTS.md) を継承します。

- feature 単位で `app / features / shared` を分ける。
- server / IPC state は TanStack Query、短命な interaction state は Zustand、form local state は component / form 層へ置く。
- domain rule を component に複製せず、Rust の validation 結果と共有 contract を使う。
- custom interaction は React Aria または native semantic element を優先する。
- timeline block は pointer、keyboard、direct time edit のすべてで操作可能にする。
- icon-only control は accessible name と tooltip を持つ。危険操作は text label を伴う。
- `data-testid` より role、label、visible text をテスト selector に使う。
- component 内に `invoke`、business branching、DOM imperative operation を集中させず、typed client / hook / view に分離する。
- remote asset、CDN、inline executable HTML、`dangerouslySetInnerHTML` を導入しない。
