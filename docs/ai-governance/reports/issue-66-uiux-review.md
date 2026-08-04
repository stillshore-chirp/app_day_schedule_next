# Issue #66 Todoカード UI/UX Review Report

## 1. Summary

- Issue: #66
- Branch: `codex/issue-66-real-pointer-drag-fix`
- Affected screen: チケット Kanban のカード、列内・列間移動
- OS: macOS / Windows 共通 UI。native 証跡は macOS arm64 で取得する
- Decision: WebViewへ届かない合成HTML dragではなく、実マウスの down / move / up をカード直接 drag として扱う
- Findings: P0 0、P1 0、P2 2（Windows 実機、screen reader 実機）

## 2. User value / novice simulation

- Target: Todo を列で進め、次に着手する一件を短時間で判断する個人利用者。
- Value: 予定・実績などの補助情報と移動 button 群をカードから外し、title と priority の比較へ視線を集中できる。
- First action: card 本体を掴み、目的の列または card の手前へ drop する。
- Prediction: drag 中は元 card と drop 可能列が強調され、drop 後は保存完了が通知される。
- Recovery: drag 中の `Esc` で取消。競合・保存失敗は既存の回復表示を維持する。
- Detail access: 期限、見積、tag、checklist、予定、Focus 実績は card 詳細で確認できる。

## 3. State / interaction / accessibility

- Normal: card は title と priority badge だけを表示する。
- Pointer / trackpad: card 全面が drag source。6pxの移動閾値を超えた後、card への drop はその card の手前、列余白への drop は列末尾へ移動する。
- Keyboard equivalent: 詳細 button へ focus し、`← / →` で列移動、`↑ / ↓` で列内移動する。`aria-keyshortcuts` と説明を関連付ける。
- Filter / derived sort: drag と keyboard reorder を無効化し、非表示 card の永続順序を保護する。
- Name / role / state: list / listitem、詳細 button の accessible name、drag 説明、polite live region を維持する。
- Focus / contrast / target: 既存の visible focus と card 全面 target を維持し、priority は色だけでなく text label を示す。
- Narrow / 200% / 500 cards: button 群の撤去で必須操作の clipping を減らし、既存の列 scroll 契約を維持する。

## 4. Visual hierarchy / copy / efficiency / trust

- Hierarchy: title > priority。詳細属性は card 上で同格の pill にしない。
- Copy: tooltip と支援技術向け説明で「drag」と矢印キーを案内する。
- Efficiency: pointer は「移動 button → 方向 button」の 2 action から直接 drag の 1 gesture になる。
- Trust: drop 後にだけ保存し、成功・境界・取消・失敗・競合の announcement を維持する。

## 5. Counter-review

- Drag-only: 矢印キーの keyboard equivalent と component / native test で否定する。
- Hidden-order corruption: filter / sort 中の `draggable=false` と keyboard guard を維持する。
- Card detail loss: 表示だけを簡略化し、保存済み属性と詳細 panel は変更しない。
- Accidental open vs drag: 6px未満はclickとして詳細を開き、閾値を超えた操作だけをdragとして扱う。drag後のclickは抑止する。
- False-positive native test: `DragEvent` の直接発火を廃止し、WebDriverの実マウス `down → move → up` で列移動と保存結果を確認する。`down → move → Esc` で取消も確認する。
- Schedule / Focus regression: planning summary query は archive / delete / detail の影響説明用に維持する。

## 6. Evidence

- Before: [Issue #33 の通常 card](../../evidence/issue-33/native-ticket-board.png)、ユーザー提供 screenshot（個人 title を含むため repository へ保存しない）
- After: [通常](../../evidence/issue-66/native-ticket-board.png)、[実マウスdrag中](../../evidence/issue-66/native-ticket-drag-preview.png)、[隣レーンdrop後](../../evidence/issue-66/native-ticket-pointer-move.png)、[keyboard focus](../../evidence/issue-66/native-ticket-keyboard-move.png)、[狭幅](../../evidence/issue-66/native-ticket-board-narrow.png)、[200% text](../../evidence/issue-66/native-ticket-board-text-200.png)、[500 cards](../../evidence/issue-66/native-ticket-board-500.png)
- Automated: `KanbanView.test.tsx` で priority badge 1 件、move button 不在、`aria-keyshortcuts`、keyboard / mouse move、filter guard、axe を検証する。native E2Eでは実マウスの開始、Esc取消、隣レーンdrop、保存後DOMを検証する。
- Redaction: repository evidence は synthetic title / description / tag のみを使用する。

## 7. Unexecuted validation / remaining risks

| Check                                   | Reason                                    | Remaining risk            | Next action                  |
| --------------------------------------- | ----------------------------------------- | ------------------------- | ---------------------------- |
| Windows native build / install / launch | 現在の実行環境は macOS arm64              | WebView2 drag、OS scaling | Windows CI / 実機 smoke      |
| VoiceOver / NVDA                        | automated axe と keyboard contract を優先 | shortcut 説明の読み上げ順 | 対象 OS の支援技術 smoke     |
| signed / notarized artifact             | 個人用 build                              | Gatekeeper の配布警告     | release 工程で署名・notarize |
