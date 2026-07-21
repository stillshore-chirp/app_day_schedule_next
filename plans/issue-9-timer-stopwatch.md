# 実装計画

## メタデータ

- Issue: #9
- Branch: `codex/multi-timer-stopwatch`
- Owner: Codex
- Status: in-progress
- Updated: 2026-07-22

## 目標

- 複数の独立したカウントダウンをラベル付きで作成・操作し、よく使う構成を名前付きセットとして再利用できるようにする。
- ストップウォッチを開始・一時停止・再開・リセットでき、再起動や wall clock 変更でも実行中の経過が破綻しないようにする。
- 既存 Focus と役割を混同せず、タイマーとストップウォッチを別々のナビゲーション画面として短く到達できる UI を追加する。

## 非対象

- Google Calendar 同期、クラウド共有、複数ユーザー、モバイル対応。
- ラップ記録、区間分析、タイマーの再発スケジュール、自動スケジューリング。
- アプリが完全終了している間の OS 常駐処理。再起動時は永続状態から安全に回復する。

## 完了条件

- [x] 任意個数のタイマーを作成・削除し、ラベル・時間・開始・一時停止・再開・リセットを個別に操作できる。
- [x] 現在のタイマー構成を名前付きセットへ保存し、既存タイマーを失わず追加適用・削除できる。
- [x] 独立した「ストップウォッチ」画面で開始・一時停止・再開・リセットが永続化される。
- [x] タイマー完了通知が既存 delivery ledger を使い、同じ run を重複配信しない。
- [x] fake clock、migration、IPC、React、a11y のテストと UI/UX 証跡がある。
- [x] UserManual、時間・通知契約、migration 契約、UI/UX review report が更新される。

## 不変条件とリスク

- 関連する product invariant: monotonic elapsed time、restart recovery、notification delivery key、SQLite local source of truth、typed IPC、完全終了中の通知制約。
- データ損失リスク: セット適用は既存タイマーを置換せず、単一 transaction で idle timer を追加する。セット削除は timer 本体へ影響しない。
- 同期 / 時刻 / OS 差分: Google 同期対象外。プロセス内は monotonic clock、初回観測時のみ永続 wall time から復旧する。macOS と Windows の native notification 差分を残リスクとして確認する。
- 秘密・個人データ: ラベルはローカル SQLite のみ。ログ、診断、fixture、PR 証跡には synthetic label だけを使う。

## 実装 slice

| Priority | Slice | Expected result | Verification | Status |
|---:|---|---|---|---|
| P0 | domain / migration | timer、set、stopwatch、completion event を forward-only schema 11 へ追加 | Rust domain test、fresh migration、constraint test | complete |
| P0 | application / IPC | monotonic runtime、再起動復旧、個別 command、set transaction、typed command | fake clock test、Rust service test、TS contract test | complete |
| P0 | notification | completion event を既存 ledger へ一意 claim | repeated poll / restart / bounded replay test | complete |
| P0 | UI | タイマーとストップウォッチを別画面に分離し、複数 card、set、empty/error/confirm を提供 | component test、keyboard smoke、axe、native screenshot | complete |
| P1 | docs / evidence | UserManual、contracts、state matrix、counter-review、before/after | doc link / security scan / review report | complete |
| P1 | publish | 日本語 commit、push、非ドラフト PR、CI / review 確認 | latest head の GitHub 状態 | pending |

## 再開情報

- Current state: 実装・文書・ローカル検証・native UI 証跡まで完了し、公開ゲートを実行中。
- Last completed slice: docs / evidence と最終ローカル検証。
- Next smallest action: commit、push、非ドラフト PR 作成後に最新 head の CI / review 状態を確認する。
- Blocking fact: CI はユーザー申告どおり月額課金切れで失敗見込み。実装自体の blocker ではない。
- Resume command: `git status --short --branch && sed -n '1,240p' plans/issue-9-timer-stopwatch.md`

## 最小スモーク

```bash
node scripts/verify-agent-harness.mjs
```

## 検証記録

| Command / check | Result | Evidence |
|---|---|---|
| `node scripts/verify-agent-harness.mjs` | Pass | 80 required files、5 skills |
| `pnpm format:check && pnpm lint && pnpm typecheck` | Pass | formatting、ESLint、TypeScript |
| `pnpm test && pnpm test:a11y` | Pass | 35 unit / component tests、5 axe tests、statement coverage 92.13% |
| `cargo fmt --all -- --check && cargo clippy --workspace --all-targets --all-features -- -D warnings` | Pass | formatter / warnings gate |
| `cargo test --workspace --all-features` | Pass | sandbox 外で mock HTTP listener を許可し 71 tests passed |
| production frontend / Tauri debug build | Pass | Vite build 後、既存 non-TTY install prompt を避けるため Tauri beforeBuildCommand を空にして build |
| native E2E target spec | Pass | 8 tests、keyboard、別ナビ、狭幅、200% text、native screenshots |
| harness / docs / security / boundaries / i18n / workflow / diff check | Pass | 全ローカルゲート通過 |
| pre-change screenshot | Alternate evidence | browser の loopback navigation が blocked。既存 native `docs/evidence/issue-4/native-focus-history.png` を使用 |
| post-change screenshots | Pass | `docs/evidence/issue-9/` に通常、狭幅、200% text を保存 |

## 未実行と残リスク

- Windows native build / notification smoke は未実行。
- macOS native E2E は実行済みだが、実機での通知許可 / サウンド到達確認は未実行。
- CI 課金切れはユーザー既知の外部 blocker。最新 head の結果と失敗理由は PR で確認する。
