# Rust / Tauri rules

ルート [`AGENTS.md`](../../../AGENTS.md)、親 [`AGENTS.md`](../AGENTS.md)、製品契約 [`docs/product-invariants.md`](../../../docs/product-invariants.md)、境界 [`docs/architecture-boundaries.md`](../../../docs/architecture-boundaries.md) を継承します。

## 配置と安全境界

- `domain` は pure Rust とし、`tauri`, `sqlx`, `reqwest`, `keyring`, OS API に依存させない。
- `application` は use case、transaction boundary、Outbox、履歴、retry、cancelを調整する。
- `infrastructure` は DB、Google、keyring、notification、filesystem、clock adapterを実装する。
- `commands` は thin typed adapter とし、SQL / HTTP / merge / recurrence expansionを置かない。
- public function は `Result` を返し、error contextを失わない。秘密値をerror chainやdiagnosticへ含めない。
- `unwrap`、`expect`、到達可能な `panic!` は production path で禁止する。
- wall / monotonic clock、UUID、random、port、filesystem は test 可能な interface を通す。
- DB write と history / Outbox enqueue は同一 transaction。migration は forward-only、番号順、再現可能、failure時rollbackを検証する。
- Tauri capability / command expose は allowlist とし、window ごとに最小化する。

## 必要なroute

sync は [`calendar-sync-review`](../../../.agents/skills/calendar-sync-review/SKILL.md)、time / notification は [`time-notification-review`](../../../.agents/skills/time-notification-review/SKILL.md)、schema / recovery は [`data-migration-review`](../../../.agents/skills/data-migration-review/SKILL.md)、Tauri / OS / release は [`desktop-release-review`](../../../.agents/skills/desktop-release-review/SKILL.md) を使います。利用者に見える結果が変わる場合は [`ui-ux-review`](../../../.agents/skills/ui-ux-review/SKILL.md) も使います。
