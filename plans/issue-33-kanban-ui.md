# Issue 33 Kanban UI 実装計画

## メタデータ

- Issue: #33
- Parent: #31
- Depends on: #32（PR #37 / merge commit `151228b754ef26ad3581033a3537324ba7d4480e`）
- Branch: `codex/issue-33-kanban-ui`
- Status: local-verification-complete
- Updated: 2026-08-03

## 目標

- チケットを6列の独立したKanban画面で把握・作成・編集・移動・完了・復帰・archive・deleteできるようにする。
- pointer dragとkeyboard移動を等価にし、filter中の並べ替えで非表示cardの永続順序を壊さない。
- empty / loading / no-results / pending / failure / stale conflict / archived / narrow / 200% / 500件を区別する。

## 非対象

- Scheduleリンク、Focus帰属、Google Tasks同期、自由列編集、swimlane、sprint、assignee、comment、attachment。

## 実装 slice

| Priority | Slice | Expected result | Verification | Status |
|---:|---|---|---|---|
| P0 | navigation / board read model | 独立画面と6列、検索・filter・sort、0/1/500件 | component / model tests | complete |
| P0 | create / detail / destructive actions | 保存状態、dirty close、archive/restore/delete recovery | interaction tests | complete |
| P0 | pointer / keyboard movement | preview、取消、live announcement、filter中制限 | drag / keyboard tests | complete |
| P0 | accessibility / responsive | dialog focus、roles/names、狭幅・200% | axe / native smoke | complete |
| P1 | docs / state matrix / screenshots | UIUX reportと必須状態の視覚証跡 | public-safety review | complete |

## 再開情報

- Current state: local実装・component / axe / native E2E・安全なsynthetic screenshots完了。
- Next smallest action: commit / push後、PRでCI・Codex review・review threadsを確認する。
- Blocking fact: なし。
- Resume command: `git status --short --branch && pnpm test:e2e`

## 反証対象

- filter中のdropでhidden card順序が変わる。
- stale versionを一般エラーとして扱い、入力を失う。
- Done移動とreopenが非対称になる。
- deleteがarchiveに見える、または予定・Googleへの未実装影響を断定する。
- dialogのEsc / focus return / dirty確認が成立しない。
- 500件で全cardの高コスト計算や自動focusが発生する。
