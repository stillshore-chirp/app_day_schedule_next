# Desktop application rules

この領域は React frontend と Tauri native shell を含みます。ルート [`AGENTS.md`](../../AGENTS.md) と、製品契約 [`docs/product-invariants.md`](../../docs/product-invariants.md)、境界 [`docs/architecture-boundaries.md`](../../docs/architecture-boundaries.md) を継承します。

## 境界

- `src/` と `src-tauri/` の責務を混在させない。
- frontend から Google API、SQLite、keyring、general filesystem を直接呼ばない。
- IPC contract を変更したら TypeScript / Rust の型、validation、contract test、関連する engineering doc を同じ変更で更新する。
- user-visible error に raw Rust error、SQL、HTTP body、token、絶対 path を出さない。

## route

- UI、copy、操作、状態、accessibility は [`ui-ux-review`](../../.agents/skills/ui-ux-review/SKILL.md) を使う。
- Google OAuth / Calendar / Tasks、Outbox、conflict は [`calendar-sync-review`](../../.agents/skills/calendar-sync-review/SKILL.md) を使う。
- time、timezone、DST、recurrence、notification、Focus は [`time-notification-review`](../../.agents/skills/time-notification-review/SKILL.md) を使う。
- SQLite、migration、import、backup、restore、history は [`data-migration-review`](../../.agents/skills/data-migration-review/SKILL.md) を使う。
- Tauri capability、CSP、window、OS integration、build、installer、release は [`desktop-release-review`](../../.agents/skills/desktop-release-review/SKILL.md) を使う。

複数領域に触れる変更は該当Skillを組み合わせます。ユーザー向けdesktop runtimeでは、最新検証commitからのchecksum・復旧可能なinstall・launch smokeを [`desktop-platform-and-release.md`](../../docs/engineering/desktop-platform-and-release.md) に従って確認します。
