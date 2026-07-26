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
pnpm verify:patched-dependencies
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

`npm run verify:bootstrap` は agent harness、doc links、公開テキスト、repository boundary、i18n key audit、CI cost / platform routing policy を検証します。i18n audit は production UI の日本語 literal を禁止し、`shared/i18n/messages.ts` の型付き catalog へ集約します。workflow policy はPRのpush二重実行、常時3 platform matrix、常時artifact保存への後戻りを防ぎます。`pnpm verify:patched-dependencies` は、脆弱な `brace-expansion` 1.x / 2.x を修正版 5.0.8 へ統一するpatchが、利用中の全 `minimatch` majorでCommonJS / ESMのbrace展開互換性を保つことを確認します。

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
- Google Desktop OAuth build設定validation、client secret不要契約、PKCE、再接続時のcalendar / sync token保持、initial / incremental / pagination / delete / 410 / 401 / 412 / 429 / 5xx / offline、3-way merge
- structured diagnostic export の redaction
- operation ID ごとの cancel isolation、同期 token / local event 保持、export `.part` cleanup、backup file / history 非生成

Google integration test は local TCP mock server を bind します。制限 sandbox で `Operation not permitted` になる場合は、通常の開発環境または CI で同じ command を実行します。実 Google account や録画済み個人 payload は使いません。

## 5. Native E2E

通常 build に WebDriver plugin を含めないため、E2E 専用 identifier / capability / feature で build します。

```bash
DAY_SCHEDULE_GOOGLE_OAUTH_CLIENT_ID=synthetic-native-e2e-client.apps.googleusercontent.com VITE_WDIO=true pnpm --dir apps/desktop tauri build --debug --no-bundle --features e2e --config src-tauri/tauri.e2e.conf.json
pnpm test:e2e
```

現行 smoke:

- real Tauri app 起動と real IPC bootstrap
- compile-timeのsynthetic Desktop client IDによるOAuth JSON不要の接続状態
- UI 作成 → Rust command → SQLite 永続化 → 再起動／検索
- 設定保存 → 再起動、pointer drag作成、分類の一括変更 → SQLite再検索
- 720 × 720 の最小幅ナビゲーション
- テンプレート、24時間／詳細編集、Quick Block、自由アラーム、Focus 履歴
- Today、List、Week、Template、Focus、Compact、Data / Conflict の synthetic native screenshot
- 30分予定のoverview marker、detail 1行density、完全なaccessible name、title / timeのcard内geometry
- 専用一時DBへ500予定を実IPCで投入し、仮想化DOM上限とscroll / dragのmain-thread 16.7ms budgetを各30回測定

`VITE_WDIO=true` のE2E buildでは、通知履歴specとアプリの5秒foreground pollが同じdeliveryを競合してclaimしないよう、Reactの自動notification runtimeだけを停止します。通知履歴specが単独で実IPC pollを行い、delivery key・結果記録・再読込後の表示を確認します。Rustの候補抽出、重複抑止、DST、grace / replayは固定clockのintegration test、OS permission / deliveryはrelease manual matrixを正本とします。

Native E2E はPRごとには起動しません。`Native release validation` workflowで`macos-arm64`、`macos-x64`、`windows-x64`、`all`から対象を選びます。通常の個人利用確認はmacOS arm64、release判断は`all`です。失敗時だけscreenshotとマスク対象を確認したlogを7日間artifactにします。macOS arm64では続けて`scripts/compare-visual-snapshots.swift`を実行し、Today、Week、Template、Compact、Conflictをchannel差32・不一致pixel 4%の許容差で比較します。超過時は赤い差分PNGを確認し、意図した変更だけbaseline更新としてレビューします。

`build_installers=true`を指定した場合だけ、E2E成功後にWebDriver pluginを含まない通常identifierのunsigned debug installerを作り、7日間保持します。

## 6. Dependency / source security

```bash
pnpm audit --audit-level moderate
cargo deny --all-features check advisories licenses sources
```

Dependency audit workflow は依存ファイル変更PR、月1回、手動実行で上記を確認します。Rust advisoryは`cargo-deny`へ一本化し、毎回の`cargo install cargo-audit`と重複判定を削除します。`deny.toml`のadvisory ignoreは、Tauriのtransitive dependencyに安全なupgradeがない例外だけを理由付きで限定し、Tauri更新時に必ず再評価します。

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
| Layout | 720px、200% text、light / mild / dark、500 items |

UI PR は対象状態ごとの変更前／変更後 screenshot を添付します。新規 scaffold では変更前画面が存在しないため、その事実と初回 native screenshot を証跡にします。

visual baseline は `apps/desktop/tests/visual-baselines/macos-arm64/` に置きます。synthetic fixture だけを使用し、日時・一意suffix等の小さな動的領域は全画面pixel比の許容差へ含めます。寸法変更は許容せず即時失敗します。

## 8. Release performance measurement

macOS arm64 の release 最適化E2E buildで起動性能を測る場合:

```bash
VITE_WDIO=true pnpm --dir apps/desktop tauri build --no-bundle --features e2e --config src-tauri/tauri.e2e.conf.json
node scripts/measure-startup-performance.mjs target/release/day-schedule-next <output-json>
```

warm profile は未計測の1回で事前起動後に同じsynthetic profileを30回、cold profileは毎回fresh synthetic app-data directoryを使って30回測ります。ready点はprocess entryからbootstrap成功後の画面がrenderされ、最初のReact effectが実行された時点です。E2E featureだけが `DAY_SCHEDULE_TEST_DATA_DIR` を受け付け、通常buildの保存先は変更できません。

`apps/desktop/test-results/native-performance.json` の500件測定は、非前面WebDriverがmacOSでtimer / rAFを1000msへ抑制するため、同期event dispatchと現在layoutのmain-thread budgetを測ります。実compositorのframe interval、high DPI、multi-monitorは前面実機release smokeで別に観測し、補助測定と混同しません。

## 9. Platform release matrix

| Check | macOS arm64 | macOS x64 | Windows x64 |
|---|---:|---:|---:|
| compile / Rust test | native変更PRで自動 | release時に手動 | release時に手動 |
| native IPC E2E | release時に手動 | release時に手動 | release時に手動 |
| unsigned installer artifact | 必要時に手動 | 必要時に手動 | 必要時に手動 |
| clean install / launch / quit | release manual | release manual | release manual |
| Keychain / Credential Manager | release manual | release manual | release manual |
| notification permission / delivery | release manual | release manual | release manual |
| OAuth browser / loopback / keyring / calendar list | release manual | release manual | release manual |
| tray / Compact / topmost / window restore | release manual | risk-based | release manual |
| sleep / resume / clock jump | release manual | risk-based | release manual |
| high DPI / multi-monitor / uninstall | risk-based | risk-based | risk-based |

全PRでharness / frontend quality gateは自動実行します。private repositoryの個人利用ではbranch protectionを利用できない場合があるため、merge前にPRの`Quality gate`と、native変更時の`Native smoke (macOS arm64)`を人が確認します。Build successだけでは実機権限とOS lifecycleを検証したことになりません。release判定では手動workflow URL、artifact、実機観測者、日付を記録します。

## 10. Evidence

Issue #4 の現行 verification と UI/UX 反証レビューは [`docs/ai-governance/reports/issue-4-completion.md`](../ai-governance/reports/issue-4-completion.md) にまとめます。PR には command、result、artifact、manual step、未実行理由、残リスクを記載します。
