# Issue #18 実装計画

## メタデータ

- Issue: https://github.com/stillshore-chirp/app_day_schedule_next/issues/18
- Branch: `codex/today-template-dual-strip`
- Owner: Codex
- Status: validation
- Updated: 2026-07-30

## 目標

- Today の共通24時間軸に「今日の予定」と参照専用の「日次テンプレート」を独立レーンとして表示する。
- 実予定の編集・Quick Block 遷移・基準時刻・詳細タイムラインを維持しつつ、選択中テンプレートとの比較を Today だけで完結させる。
- 空、読込中、取得失敗、ID不一致、重複、日跨ぎ、短時間、500件、狭幅、200% text を安全に扱う。

## 非対象

- Today からの日次テンプレート直接編集または適用。
- DB schema、Rust domain、IPC contract、Google同期、Outbox、通知の変更。
- 曜日によるテンプレート自動切替。

## 完了条件

- [x] Issue #18 の受入条件と必須テストを満たす。
- [x] UI/UX レビュー、state matrix、変更前後の native 証跡、UserManual を更新する。
- [ ] ローカル検証、非ドラフト PR、最新 head CI、CI 後のレビュー thread 確認を完了する。

## 不変条件とリスク

- 関連する product invariant: `Schedule` は UTC instant、`TemplateBlock` は `MinuteOfDay` と duration、区間は `[start, end)`、overview の重なり閾値は実重なり5分以上。
- データ損失リスク: テンプレート表示は read-only とし、表示・編集導線だけで予定作成やテンプレート適用を呼ばない。
- 同期 / 時刻 / OS 差分: 同期契約は変更しない。テンプレートは UTC 変換せず 24:00 で clamp。macOS native 証跡を取得し、Windows 実画面未確認は残リスクとして扱う。
- 秘密・個人データ: synthetic fixture だけを使用し、スクリーンショットと PR に実予定・アカウント情報を含めない。

## 実装 slice

| Priority | Slice                        | Expected result                                                      | Verification                                | Status    |
| -------: | ---------------------------- | -------------------------------------------------------------------- | ------------------------------------------- | --------- |
|       P0 | 変更前証跡と既存契約の固定   | 現行 Today と既存挙動を再現できる                                    | native screenshot、既存 unit/component test | completed |
|       P0 | 純粋レイアウト規則           | schedule/template adapter と deterministic な独立 level 計算         | unit test（境界、重なり、日跨ぎ、500件）    | completed |
|       P0 | Today 2レーン UI             | 共通軸、予定レーン、参照専用テンプレートレーン、個別状態             | component/a11y test、keyboard smoke         | completed |
|       P0 | Templates 状態整合           | 選択保存後の bootstrap、保存/削除/並び替え後の templates 更新        | component/query integration test            | completed |
|       P1 | 狭幅・200% text・native 証跡 | 主要状態で重なりや操作消失がない                                     | native E2E、visual snapshot                 | completed |
|       P1 | 文書・反証レビュー           | UserManual、UI/UX report、state matrix、completion gate が実装と一致 | doc/link/security checks                    | completed |
|       P0 | 公開尾                       | commit/push、非ドラフト PR、CI、Codex review/thread 対応             | GitHub latest head evidence                 | pending   |

## 再開情報

- Current state: 実装、unit/component/a11y、macOS native E2E、変更前後証跡を完了。全repository検証と公開尾を実施中。
- Last completed slice: 狭幅・200% textを含むmacOS native 16 testsとToday visual regression。
- Next smallest action: 変更範囲に応じたfrontend / Rust / governance検証を実行し、commit / push / PRへ進む。
- Blocking fact: なし。
- Resume command: `git status --short --branch`

## 最小スモーク

```bash
node scripts/validate-governance.mjs
```

## 検証記録

| Command / check                         | Result | Evidence                                                  |
| --------------------------------------- | ------ | --------------------------------------------------------- |
| 旧harness検証（履歴）                  | Pass   | 実行時点の旧構成: 81 required files / 5 skills            |
| 旧bootstrap検証（履歴）                | Pass   | 実行時点のharness / docs / security / boundaries / i18n / workflows |
| focused frontend tests                  | Pass   | 5 files / 26 tests                                        |
| frontend full suite                     | Pass   | 16 files / 91 tests、statements 92.41%、branches 85.13%   |
| format / lint / typecheck / build       | Pass   | Prettier、ESLint 0 warnings、`tsc -b`、Vite 511 modules   |
| `pnpm test:a11y`                        | Pass   | 3 files / 7 tests、axe serious / critical 0               |
| Rust all-feature                        | Pass   | fmt、clippy `-D warnings`、108 tests                      |
| Tauri debug build                       | Pass   | macOS arm64 app / DMG                                     |
| macOS native E2E                        | Pass   | 3 specs / 16 tests                                        |
| Today visual regression                 | Pass   | mismatch 0.000% / limit 4.000%                            |
| final repository scripts（実行時点）    | Pass   | 113 links、227 text files、boundaries、i18n、workflows    |

## 未実行と残リスク

- Windows native WebView、Narrator、Windows 200% scale は現環境では未実行予定。Windows build と CI の範囲を確認し、実画面差分を残リスクへ記録する。
- VoiceOver / Narrator実機確認は未実行。native keyboard flowはmacOS embedded WebDriverで確認済み。
