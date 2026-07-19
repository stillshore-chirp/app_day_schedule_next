# Rust / Tauri rules

ルート [`AGENTS.md`](../../../AGENTS.md) と親 [`AGENTS.md`](../AGENTS.md) を継承します。

- `domain` は pure Rust とし、`tauri`, `sqlx`, `reqwest`, `keyring`, OS API に依存させない。
- `application` は use case と transaction boundary を定義する。
- `infrastructure` は DB、Google、keyring、notification、filesystem、clock adapter を実装する。
- `commands` は thin adapter とし、SQL / HTTP / merge logic を置かない。
- public function は `Result` を返し、error context を失わない。秘密値を error chain に含めない。
- `unwrap`, `expect`, 到達可能な `panic!` は production path で禁止する。
- wall clock、monotonic clock、UUID、random、port、filesystem は test 可能な interface を通す。
- DB write と Outbox enqueue は同一 transaction で行う。
- migration は forward-only、番号順、再現可能、rollback-on-failure を検証する。
- Tauri capability / command expose は allowlist とし、window ごとに最小化する。
