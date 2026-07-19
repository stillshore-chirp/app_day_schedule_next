# Testing Strategy

## 1. 原則

- deterministic、local / CI 一致、synthetic fixture のみ。
- Unit を厚く、Integration を SQLite / IPC / Google / OS adapter 契約へ、E2E を critical flow へ置く。
- macOS / Windows native behavior を browser preview だけで確認しない。
- retry で flaky test を隠さず、clock、race、wait condition を固定する。
- 未実行検証を成功扱いしない。

## 2. 一括検証

初回だけ依存を固定 lockfile から導入します。

```bash
corepack enable
pnpm install --frozen-lockfile
npm run verify:bootstrap
pnpm format:check
pnpm lint
pnpm typecheck
pnpm test
pnpm test:a11y
cargo fmt --all -- --check
cargo clippy --workspace --all-targets --all-features -- -D warnings
cargo test --workspace --all-features
pnpm build
pnpm tauri:build:debug
git diff --check
```

`npm run verify:bootstrap` は agent harness、doc links、公開テキスト、repository boundary を検証します。

## 3. Frontend unit / accessibility

```bash
pnpm test
pnpm test:a11y
```

現行 suite は Zod contract、時刻 formatting、timeline lane / overlap / keyboard、500件 timeline virtualization、memory IPC の CRUD / history / template / Focus / data transfer、axe を使った app shell / empty state を検証します。selector は role、label、visible text を優先し、CSS class や内部関数へ依存しません。

Coverage は補助指標です。重要な異常系、a11y、native IPC を coverage 数値で代替しません。

## 4. Rust domain / integration

```bash
cargo test --workspace --all-features
```

主な対象:

- UTC instant、IANA timezone、半開区間、終日 local date
- DST gap / overlap、月末、曜日／count 再発、単一／これ以降／series 編集
- SQLite migration、optimistic concurrency、history、Outbox atomicity、50,000件検索
- template preview / apply / one-action Undo、built-in constraint、library reorder
- notification delivery key、grace、Quick Block active linkage、Focus transition / history / 予定別実績集計
- 予定分類の最大500件原子的変更、1 action Undo、read-only拒否
- JSON import fingerprint、legacy preview / transaction、backup / staged restore
- Google Desktop OAuth validation、PKCE、initial / incremental / pagination / delete / 410 / 401 / 412 / 429 / 5xx / offline、3-way merge
- structured diagnostic export の redaction

Google integration test は local TCP mock server を bind します。制限 sandbox で `Operation not permitted` になる場合は、通常の開発環境または CI で同じ command を実行します。実 Google account や録画済み個人 payload は使いません。

## 5. Native E2E

通常 build に WebDriver plugin を含めないため、E2E 専用 identifier / capability / feature で build します。

```bash
VITE_WDIO=true pnpm --dir apps/desktop tauri build --debug --no-bundle --features e2e --config src-tauri/tauri.e2e.conf.json
pnpm test:e2e
```

現行 smoke:

- real Tauri app 起動と real IPC bootstrap
- UI 作成 → Rust command → SQLite 永続化 → 再起動／検索
- 設定保存 → 再起動、pointer drag作成、分類の一括変更 → SQLite再検索
- 720 × 720 の最小幅ナビゲーション
- テンプレート、24時間／詳細編集、Quick Block、自由アラーム、Focus 履歴
- Today、List、Week、Template、Focus、Compact、Data / Conflict の synthetic native screenshot

CI は `macos-15`、`macos-15-intel`、`windows-latest` で同じ suite を実行します。失敗時は screenshot とマスク対象を確認した log を artifact にします。

## 6. Dependency / source security

```bash
pnpm audit --audit-level moderate
cargo deny --all-features check advisories licenses sources
```

Dependency audit workflow は上記に加えて RustSec audit を定期実行します。`deny.toml` の advisory ignore は、Tauri の transitive dependency に安全な upgrade がない例外だけを理由付きで限定します。Tauri 更新時に必ず再評価します。

## 7. Visual / state matrix

最低確認状態:

| Surface | States |
|---|---|
| Today | empty、populated、overlap、cross-midnight、current / next、search none |
| Timeline | create preview、move、resize、Esc cancel、keyboard、保存中／失敗 |
| Sync | disconnected、connecting、syncing、offline、retry、auth required、conflict |
| Library | built-in、new、duplicate、reorder、day-crossing、preview add / replace |
| Notification | unknown、granted、denied、sound-only、ledger result |
| Focus | idle、working、paused、break、waiting next、history |
| Data | export、preview、changed file、backup、restore stage、delete confirmation |
| Layout | 720px、200% text、light / dark、500 items |

UI PR は対象状態ごとの変更前／変更後 screenshot を添付します。新規 scaffold では変更前画面が存在しないため、その事実と初回 native screenshot を証跡にします。

## 8. Platform release matrix

| Check | macOS arm64 | macOS x64 | Windows x64 |
|---|---:|---:|---:|
| compile / Rust test | CI required | CI required | CI required |
| native IPC E2E | CI required | CI required | CI required |
| unsigned installer artifact | CI required | CI required | CI required |
| clean install / launch / quit | release manual | release manual | release manual |
| Keychain / Credential Manager | release manual | release manual | release manual |
| notification permission / delivery | release manual | release manual | release manual |
| OAuth browser / loopback | release manual | release manual | release manual |
| tray / Compact / topmost / window restore | release manual | risk-based | release manual |
| sleep / resume / clock jump | release manual | risk-based | release manual |
| high DPI / multi-monitor / uninstall | risk-based | risk-based | risk-based |

Build successだけでは実機権限と OS lifecycle を検証したことになりません。release 判定では CI URL、artifact、実機観測者、日付を記録します。

## 9. Evidence

Issue #4 の現行 verification と UI/UX 反証レビューは [`docs/ai-governance/reports/issue-4-completion.md`](../ai-governance/reports/issue-4-completion.md) にまとめます。PR には command、result、artifact、manual step、未実行理由、残リスクを記載します。
