# Issue #23 実装計画

## メタデータ

- Issue: https://github.com/stillshore-chirp/app_day_schedule_next/issues/23
- Branch: `codex/issue-23-overview-bar-density`
- Owner: Codex
- Status: complete; PR/CI/review gate passed
- Updated: 2026-08-02

## 目標

Today overview の実予定レーンとテンプレートレーンの各バーだけを見て、番号・開始時刻・タイトルを対応付けられるようにする。短時間バーでもタイトルを番号だけに隠さず、幅に応じて情報を段階的に詰め、バー間の余白を縮小する。

## 非対象

- 詳細タイムライン、外部ラベルレール、時間軸のズーム。
- DB、同期、通知、時刻モデル、予定操作ロジック。

## 完了条件

- [x] 実予定・テンプレートバーに番号、開始時刻、タイトルをこの順で表示する。
- [x] タイトルに ellipsis を使わず、幅まで clip する。30〜60分、重複、日跨ぎ、720px、200% text で意味と操作を保つ。
- [x] バー高60px、選択/focus/pending/現在時刻線/日跨ぎ/最大8 levelを維持し、gapとレーン余白を縮小する。
- [x] component、a11y、native E2E、visual evidence、UserManual、state matrix、UI/UX reviewを更新する。

## 不変条件とリスク

- 関連する product invariant: overview/detail は同じ entity を異なる密度で表し、current-time line・selection・sync state を色だけで表さない。
- データ損失リスク: UI/CSSのみ。なし。
- 同期 / 時刻 / OS 差分: 表示開始時刻は日セグメントの `startMinute` を使い、既存の full accessible time range を保持する。macOS native evidenceを取得する。
- 秘密・個人データ: synthetic fixtureのみを使う。

## 実装 slice

| Priority | Slice | Expected result | Verification | Status |
|---:|---|---|---|---|
| P0 | React markup | 両レーンに安定番号・開始時刻・タイトルを表示 | DayOverview component test | complete |
| P0 | CSS density | 幅基準の3段階表示、ellipsis除去、gap縮小 | styles/static checks、native geometry | complete |
| P1 | Evidence/docs | native screenshot、geometry、state matrix、review、manual更新 | native E2E、文書リンク | complete |

## 再開情報

- Current state: Issue #23 acceptance criteria と現行の Issue #21 実装を確認済み。
- Last completed slice: React/CSS、component/a11y/native E2E、visual baseline、証跡文書を更新し、PR #24を作成。
- Next smallest action: なし。Windows native evidenceのみ残るプラットフォームリスクとして報告する。
- Blocking fact: なし。
- Resume command: `git status --short --branch && pnpm --dir apps/desktop test -- DayOverview`

## 最小スモーク

```bash
node scripts/validate-governance.mjs
```

## 検証記録

| Command / check | Result | Evidence |
|---|---|---|
| `git fetch origin` / `git merge --ff-only origin/main` | pass | `origin/main` at `f79e3e9` |
| Issue / repository / UIUX governance read | pass | Issue #23 and tracked governance docs |

## 未実行と残リスク

- Windows native verificationはmacOSホスト外のため未実行。CSS/HTMLにOS固有分岐はなく、残るプラットフォームリスクとして報告する。
- PR #24のQuality gate、Native smoke、post-CI reviewThreads確認は完了。
- `pnpm install --frozen-lockfile` はローカルのpnpmバージョン不一致とregistry制約のため未実行。CIのpinned runtimeを正とする。
