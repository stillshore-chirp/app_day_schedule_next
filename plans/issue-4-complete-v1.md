# 仕様書 v1.0 実装計画

## メタデータ

- Issue: #4
- Branch: `codex/complete-v1-spec`
- Owner: Codex
- Status: in-progress
- Updated: 2026-07-20

## 目標

- 仕様書 v1.0 の 200 要件を、Tauri 2 + React + TypeScript + Rust + SQLite の接続済みデスクトップアプリとして実装する。
- Must 要件とリリースゲート RG-01〜RG-10 を満たし、macOS / Windows で出荷判定できる証跡を残す。

## 非対象

- チーム共有、複数ユーザー、独自クラウド、課金、広告、テレメトリ。
- Web / mobile、Outlook / iCloud / CalDAV、AI 自動スケジューリング。
- 参照アプリのコード、素材、文言、画面配置の転記。

## 完了条件

- [ ] 仕様書の Must 要件が実装され、未接続 UI、dummy、到達可能 TODO / panic、握りつぶし例外がない。
- [ ] RF-01〜RF-20 と RG-01〜RG-10 の検証記録がある。
- [ ] UI/UX、時刻・通知、同期、DB、desktop release の各 Skill レポートに P0 がない。
- [ ] macOS / Windows の CI build と native evidence が揃う。
- [ ] commit / push 済みの非ドラフト PR で、最新 CI と review thread を確認済み。

## 不変条件とリスク

- 関連する product invariant: UTC instant + IANA timezone、`[start,end)`、MinuteOfDay、local-first、Outbox、3-way merge、delivery key、verified restore。
- データ損失リスク: migration、legacy import、template replace、restore、sync delete を単一 transaction / preview / rollback で保護する。
- 同期 / 時刻 / OS 差分: 410 / 412 / 429、DST gap / overlap、sleep / resume、Keychain / Credential Manager、WebView 差を検証する。
- 秘密・個人データ: synthetic fixture のみを使用し、token、account、calendar、event、local path を公開成果物へ残さない。

## 実装 slice

| Priority | Slice | Expected result | Verification | Status |
|---:|---|---|---|---|
| P0 | Scaffold と contract | Tauri / React / Rust / SQLite、typed IPC、strict CSP、最小 capability が build 可能 | harness、format、lint、typecheck、Rust test、build | completed |
| P0 | 時刻・予定・履歴 | UTC / timezone / interval / schedule CRUD / overlap / Now / Undo が接続される | domain property、DB integration、UI component | completed |
| P0 | Today / Compact / navigation | 主要画面、Today timeline、Inspector、Now、Compact、keyboard equivalent | a11y、native E2E、state matrix | completed（pixel baselineはrelease残件） |
| P0 | Template / Quick Block / Focus / notification | wall-clock model、apply preview、delivery ledger、Focus state machine / 予定別実績が接続される | fake clock、restart、sleep、permission matrix | completed（実機sleepはrelease残件） |
| P0 | Google OAuth / sync / conflict | PKCE、keyring、Outbox、差分同期、3-way merge、retry、競合 UI が接続される | mock HTTP matrix、redaction、E2E | completed（実アカウントはrelease残件） |
| P0 | migration / import / backup / restore / diagnostics | 原子的移行、read-only preview、verified restore、safe diagnostics | failure injection、integrity、roundtrip | completed |
| P1 | release / performance / docs | macOS / Windows build、installer、性能証跡、利用・運用文書 | CI matrix、manual matrix、benchmarks、doc checks | in-progress |
| P0 | 反証レビュー / publish | P0 なし、非ドラフト PR、CI / Codex review 完了 | 全 gate、GitHub checks / threads | in-progress |

## 再開情報

- Current state: 接続済みv0.1実装、49 Rust test、23 frontend test、2 axe、6 native E2E。Must acceptance と実機release gateの残件を反証レポートへ列挙済み。
- Last completed slice: 一括分類、Focus予定別実績、500件timeline virtualization、dark / compact / high-DPI evidence修正。
- Next smallest action: 全検証、commit / push / 非draft PR、最新head CI / review thread確認。
- Blocking fact: FR-SH-009、NFR-PF-001 / 003 / 006、NFR-TS-006 と対象OS実機matrixが未完了のため即出荷判定不可。
- Resume command: `git status --short --branch && npm run verify:bootstrap && pnpm test && cargo test --workspace --all-features`

## 最小スモーク

```bash
node scripts/verify-agent-harness.mjs
node scripts/verify-doc-links.mjs
node scripts/security-scan-text.mjs
node scripts/check-repository-boundaries.mjs
```

## 検証記録

| Command / check | Result | Evidence |
|---|---|---|
| 添付仕様 4 件と assets 全件 | Pass | 200 requirements、10 release gates、PNG / DOT を確認 |
| Rust database targeted | Pass | 14 tests、bulk atomicity / Focus schedule aggregationを含む |
| Frontend unit | Pass | 23 tests、500 item virtualizationを含む |
| Native macOS E2E | Pass | 6 scenarios、real IPC / SQLite / screenshot |

## 未実行と残リスク

- 全UI翻訳key移行、30回起動p95、500件frame pacing、長処理cancel、pixel visual baselineは未完了。
- Windows実機、macOS x64、通知権限、Keychain / Credential Manager、OAuth実アカウント、sleep / resume、installer upgradeは後続のplatform matrixで扱う。
