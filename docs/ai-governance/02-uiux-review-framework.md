# UI/UX Review Framework

## 1. 評価軸

Day Schedule Next の UI/UX は次の軸で評価します。

1. Utility: 一日の把握・設計・実行・回復に役立つか。
2. Initial comprehension: 今日、現在、選択、主操作が分かるか。
3. Interaction: 分単位編集を安全・高速に行えるか。
4. State design: empty / offline / conflict / permission / error が明確か。
5. Accessibility: keyboard、focus、drag equivalent、name / role / state。
6. Visual hierarchy: overview、detail、Now、Inspector、Compact の優先度。
7. Copy: local / remote / delete / permission / notification の結果が正確か。
8. Efficiency: 予定作成・調整・再利用の反復手数。
9. Trust: データ、同期、backup、notification の安心と回復。
10. Evidence: native state、test、screenshot、manual observation。

## 2. P0

以下は完了不可です。

- 対象ユーザー / user goal / supported action を説明できない。
- 3秒で Today、current date、primary action を認識できない。
- selected schedule / target date / target calendar / operation scope が分からない。
- drag-only interaction で keyboard / direct input equivalent がない。
- empty、loading、offline、conflict、permission、error を混同する。
- local saved と Google synced を同じ表示にする。
- destructive / remote-impact action に対象・影響・recovery がない。
- keyboard trap、invisible focus、missing accessible name、color-only state、unreadable contrast。
- current-time line、overlap、Compact layout で操作対象が隠れる。
- user を責める copy、過剰警告、false reassurance。
- state matrix、counter-review、evidence、unexecuted check の報告がない。

## 3. P1

原則同じ変更内で修正します。

- label / terminology / shortcut が不統一。
- empty / success / error の next action が弱い。
- timeline density、time label、overlap ordering が読みづらい。
- 反復操作が1〜2 step 多い。
- previous setting / filter / calendar selection が不必要に失われる。
- pending / retry / conflict status の scope が少し曖昧。
- macOS / Windows の copy / shortcut / menu 差分が不自然。

## 4. P2

Issue 化可能な改善です。

- spacing、animation、microcopy の微改善。
- additional shortcut / bulk action。
- optional customization / onboarding enhancement。
- measurement / user study が必要な hypothesis。

## 5. Screen-specific review

### Today

- current date、view range、current time、primary create action。
- overview と detail の整合。
- current / next / remaining / free time。
- empty / many / overlap / cross-midnight。

### Inspector

- selection scope、time、timezone、calendar、recurrence、notification。
- validation、unsaved state、local / remote impact。

### Compact Window

- minimal but actionable current / next / remaining / Focus。
- always-on-top state、keyboard access、screen bounds。
- main window と status が矛盾しない。

### Sync / Conflict

- account / calendar scope。
- local / remote / field-level differences。
- retry、re-auth、keep local、keep Google、merge の result。
- secret / personal data overexposure を避ける。

### Backup / Restore / Import

- candidate、counts、warnings、overwrite impact、current backup、cancel / rollback。

## 6. Evidence hierarchy

強い順:

1. affected OS の native E2E / manual observation。
2. deterministic integration / component test。
3. screenshot / video / trace。
4. static code inspection。
5. reasoning only。

low-level evidence だけで high-level behavior を確認済みにしません。
