# 実装計画

## メタデータ

- Issue: #21
- Branch: `codex/issue-21-taller-schedule-bars`
- Owner: Codex
- Status: completed
- Updated: 2026-08-02

## 目標

- Today の実予定・日次テンプレートのストリップを現行46pxから115pxへ、内部ブロックを24pxから60pxへ拡大する。
- 見出しを左レールへ移して横方向の余白を活用し、通常1段表示の外側カード高を増やさない。

## 非対象

- 予定操作、テンプレート適用、時刻モデル、DB、Google同期、通知の変更。

## 完了条件

- [x] 上下トラック115px、内部ブロック60pxをcomponent/native testで固定する。
- [x] 通常・空・重複・720px・200% textで意味と操作が失われない。
- [x] UI/UX証跡、非ドラフトPR、CI、review確認を完了する。

## 不変条件とリスク

- 関連する product invariant: overview / detail は同一entityを異なる密度で表し、選択と時刻位置を一致させる。
- データ損失リスク: 表示専用変更であり、保存・同期commandは変更しない。
- 同期 / 時刻 / OS 差分: 分からX座標への変換と同期状態を維持する。Windows WebView2のfont差はnative証跡で確認する。
- 秘密・個人データ: screenshotはsynthetic fixtureだけを使用する。

## 実装 slice

| Priority | Slice              | Expected result                          | Verification                  | Status    |
| -------: | ------------------ | ---------------------------------------- | ----------------------------- | --------- |
|       P0 | 高さ契約のtest追加 | 115px / 60pxと重複時overflowなしを固定   | component / native E2E        | completed |
|       P0 | 2レーン再配置      | 見出しを左レールに置きカード高を再配分   | native screenshot / geometry  | completed |
|       P1 | 文書・証跡         | 利用方法とstate/counter reviewが追跡可能 | docs / security scan          | completed |
|       P1 | PR・CI・review     | 最新headが統合可能                       | GitHub checks / reviewThreads | completed |

## 再開情報

- Current state: 実装、frontend/Rust/native gate、macOS screenshot、非ドラフトPR、CI、review確認を完了。
- Last completed slice: 最新headのCI成功とreview submission 0件・未解決review thread 0件の確認。
- Next smallest action: PR #22 のマージ判断。
- Blocking fact: なし。
- Resume command: `pnpm --dir apps/desktop test -- DayOverview.test.tsx`

## 最小スモーク

```bash
node scripts/verify-agent-harness.mjs
```

## 検証記録

| Command / check                                  | Result | Evidence                                          |
| ------------------------------------------------ | ------ | ------------------------------------------------- |
| `node scripts/verify-agent-harness.mjs`          | Pass   | 81 required files / 5 skills                      |
| direct Vitest `DayOverview.test.tsx` before edit | Pass   | 8 tests                                           |
| direct Vitest `DayOverview.test.tsx` after edit  | Pass   | 9 tests                                           |
| frontend full / axe                              | Pass   | 16 files 92 tests / 3 files 7 tests               |
| macOS native E2E                                 | Pass   | 14 tests、60px block、115px strip、overview 346px |
| Today visual regression                          | Pass   | mismatch 0.000%                                   |
| Rust all-feature                                 | Pass   | fmt / clippy / 108 tests                          |
| macOS debug app / DMG                            | Pass   | arm64 bundle                                      |

## 未実行と残リスク

- Windows native visual / NarratorはmacOS hostでは未実行。release validationの残リスクとして維持する。
