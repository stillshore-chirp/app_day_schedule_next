# Issue #33 UI/UX Review Report

## 1. Summary

- Issue: #33 / Parent #31
- Branch: `codex/issue-33-kanban-ui`
- Affected screen: primary navigation、Ticket Kanban、detail / delete dialog
- OS: macOS / Windows共通UI。native証跡はmacOS arm64
- Decision: local implementation review Pass。PR / CI / Codex reviewはPR作成後に確認
- Findings: P0 0、P1 0、P2 1（Windows実機証跡）

## 2. User value

- Target: 個人で一日の予定と、まだ時刻未定の仕事を同じアプリで管理する利用者。
- Goal: 仕事をInboxからDoneまで進め、次に取り組む対象を判断する。
- Understand / decide / act / recover: card密度を判断情報へ絞り、detailへ長文属性を分離。filter中のorder破損を防ぎ、archive / delete / conflictの回復を明示。
- Alternative: Scheduleだけでは未配置仕事を時刻へ無理に割り当てるため代替しない。常設side panelはTodayを狭めるため採用しない。
- Success signal: title-only作成、1-action move、保存状態と回復が迷わず成立する。

## 3. Novice simulation

- 3秒: 見出し「チケット」、6列、主操作「チケットを作成」で目的と最初の行動を判断できる。
- First action: Inboxのtitle-only追加、または共通作成。
- Prediction: cardが対象列に現れ、live regionで保存完了を通知。
- Recovery: save failureは入力保持、conflictはreload要求、archiveは専用表示からrestore、deleteは直後の同内容回復。
- Confusion prevented: Google未実装を同期済みと表示せず、delete影響に「現在は未実装」を明記。

## 4. Accessibility

- Keyboard-only: navigation → quick create / detail → move mode → direction controls → finishまで成立。
- Drag equivalent: cardごとの明示move mode。
- Focus: detail初期focusはtitle、Tab trap、Esc、opener return。deleteはcancelへsafe initial focus。
- Semantics: board label、column region、card list/listitem、named actions、pressed move state、polite live region。
- Color: priority / overdueはtext labelを併記。
- Target: direction control 34px、主要input/button 42px以上。
- 200%: readable column widthを保持してhorizontal scroll。
- Automated: axe WCAG 2 A/AA、2.1 AA、2.2 AAのserious/critical 0。

## 5. Visual hierarchy / efficiency / trust

- Headerは目的と共通作成、toolbarは比較判断、boardは実行対象、detailは編集へ役割分離。
- 1280pxで概ね3列、狭幅は約82vw列で文字を潰さない。
- 反復作成はtitle + Enter、移動はmove + direction。危険でないmove/archiveに確認を乱発しない。
- local save、未保存、失敗、conflict、Google未実装を正直に区別。

## 6. Counter-review

- pointer-only: explicit keyboard moveで否定。
- filter order corruption: derived/filter stateでmoveを停止し、pure model testで固定。
- stale overwrite: expectedVersion conflictを別stateで保持。
- 500件: search pure modelとnative 500-card evidence。反証確認でcard圧縮を検出し、内容高の行と列内scrollへ修正。
- Today regression: Ticketは独立view。無効な予定検索をTicket表示中だけ隠し、予定の検索対象との混同を防止。
- Remaining P2: Windows WebView / 200% OS scaling / screen readerは未実行。

## 7. Evidence

- Before regression: [既存Today](../../evidence/issue-29/native-sidebar-collapsed-overview.png)、既存navigation native smoke。
- After: [empty](../../evidence/issue-33/native-ticket-board-empty.png)、[normal](../../evidence/issue-33/native-ticket-board.png)、[detail](../../evidence/issue-33/native-ticket-detail.png)、[drag preview](../../evidence/issue-33/native-ticket-drag-preview.png)、[keyboard move](../../evidence/issue-33/native-ticket-keyboard-move.png)、[no results](../../evidence/issue-33/native-ticket-no-results.png)、[conflict](../../evidence/issue-33/native-ticket-conflict.png)、[narrow](../../evidence/issue-33/native-ticket-board-narrow.png)、[200% text](../../evidence/issue-33/native-ticket-board-text-200.png)、[500 tickets](../../evidence/issue-33/native-ticket-board-500.png)。
- Tests: model 0/1/500、filter/sort、pointer drop、keyboard move、failure/conflict、archive/restore/delete/recovery、axe。
- Redaction: synthetic title / description / tags only。account、calendar、event、token、pathを画面へ含めない。
- Native result: notification 1 / short schedule 2 / main smoke 15、合計18 tests Pass（macOS arm64、embedded WebDriver）。

## 8. Unexecuted validation

| Check | Reason | Remaining risk | Next action |
|---|---|---|---|
| Windows native build / install / launch | 現在の実行環境はmacOS arm64 | font rendering、native drag、200% OS scaling | Windows CI / 実機release smoke |
| VoiceOver / NVDA | 自動axeとkeyboard smokeを優先 | live announcementの実読み上げ順 | 対象OSの支援技術smoke |
| Signed / notarized artifact | 個人用debug build | Gatekeeper配布警告 | release工程で署名・notarize |
