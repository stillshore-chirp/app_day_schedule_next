# Testing Strategy

## 1. 原則

- deterministic、local / CI 一致、個人データ不使用。
- Unit を厚く、Integration を契約境界へ、E2E を critical flow へ置く。
- macOS / Windows native behavior は browser preview だけで確認しない。
- 未実行検証を成功扱いしない。

## 2. Bootstrap checks

アプリ本体が未 scaffold の現在も必須です。

```bash
node scripts/verify-agent-harness.mjs
node scripts/verify-doc-links.mjs
node scripts/security-scan-text.mjs
node scripts/check-repository-boundaries.mjs
git diff --check
```

## 3. Frontend

予定する root commands:

```bash
pnpm format:check
pnpm lint
pnpm typecheck
pnpm test
pnpm test:a11y
```

対象:

- view / component behavior。
- keyboard、focus、accessible name、live region。
- timeline input / selection / drag preview / direct edit。
- state matrix: empty / loading / offline / conflict / error / permission。
- Zod DTO validation と error mapping。

selector は role、label、visible text を優先します。

## 4. Rust domain

```bash
cargo fmt --all -- --check
cargo clippy --workspace --all-targets --all-features -- -D warnings
cargo test --workspace --all-features
```

Unit / property targets:

- value objects、interval、overlap、lane determinism。
- timezone / DST resolution request、recurrence expansion。
- 3-way merge、conflict classification。
- notification delivery key、late policy。
- Focus transition。
- retry / backoff calculation。

## 5. Integration

- SQLite fresh / migration chain / rollback / constraints / concurrency。
- local write + history + Outbox atomicity。
- mock OAuth / Calendar server。
- initial / incremental / pagination / 410 / 412 / 429 / 5xx。
- backup / restore / corrupt DB / legacy import。
- IPC TypeScript / Rust contract fixtures。
- keyring / notification adapter contract with fake implementation。

実 Google account、個人 calendar、recorded personal payload は使いません。

## 6. Native E2E

- app launch / single instance。
- first schedule creation、keyboard edit、drag / resize、Undo。
- overlap / cross-midnight / template / Quick Block。
- Now Dock / Compact / topmost。
- Focus start / pause / break / stop。
- Google connection state with mock server、offline / conflict UI。
- backup / restore preview。
- permission denied / error recovery where automation permits。

失敗時は screenshot、trace、video、mask 済み logs を artifact にします。

## 7. Visual regression

最低状態:

- Today empty / populated / overlap / cross-midnight。
- current + next + free alarm。
- sync pending / offline / conflict。
- Focus working / break。
- Compact Window。
- light / dark、macOS / Windows、100% / 200% text。

visual diff は accessibility / usability の代替ではありません。

## 8. Manual platform matrix

| Check | macOS | Windows |
|---|---|---|
| clean install / launch / quit | required | required |
| Keychain / Credential Manager | required | required |
| notification permission / delivery | required | required |
| OAuth browser / loopback | required | required |
| window restore / topmost / Compact | required | required |
| sleep / resume | required | required |
| multi-monitor / high DPI | release risk based | release risk based |
| upgrade / uninstall | before distributed release | before distributed release |

## 9. Time fixtures

固定する timezone 例:

- `Asia/Tokyo`: DST なし。
- `America/New_York`: DST gap / overlap。
- `Europe/Berlin`: 別 rule の DST。
- `Pacific/Apia` または historical transition は必要時のみ。

固定日付に leap day、month end、year end、DST transition を含めます。

## 10. Evidence

PR には command、result、artifact、manual step、未実行理由、残リスクを記載します。UI 変更は前後 screenshot、native state、keyboard evidence を含めます。
