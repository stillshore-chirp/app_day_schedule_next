# Issue #71 Markdown プレビュー UI/UX Review Report

## 1. Summary

- Issue: #71
- Branch: `codex/issue-71-markdown-preview`
- Affected screen: 予定編集インスペクター、チケット詳細ダイアログ、ユーザーマニュアル
- OS: macOS / Windows 共通 UI。native 証跡は macOS arm64 の実 WebView
- Decision: local implementation review Pass。PR / CI / Codex review は PR 作成後に確認する
- Findings: P0 0、P1 0、P2 2（Windows 実機、VoiceOver / NVDA）

## 2. User value

- Target: 長期間の ToDo や予定へ、手順、比較表、確認項目をまとめる個人利用者。
- Goal: Markdown 原文を別アプリへ移さず、対象の詳細画面で構造化された文書として素早く読む。
- Understand / decide / act / recover: 「説明」と「編集 / プレビュー」を同じ領域に置き、表示中の対象と保存操作を分離した。表示が意図と違う場合は常に原文へ戻れる。
- Alternative: 常時 split view は狭い予定インスペクターと長文の双方を圧迫するため採用しない。専用 Markdown 画面も対象と保存先を見失いやすいため採用しない。
- Success signal: 既存説明は開いた直後に見出し、表、チェックリストとして読め、編集後も原文を変換せず保存できる。

## 3. Novice simulation

- 3 秒: 「説明」の直下にある「編集 / プレビュー」で、入力と読み取りの切替だと判断できる。
- First action: 空の説明は編集から始まり、そのまま通常文または Markdown を入力できる。
- Prediction: プレビューを選ぶと同じ説明が整形される。切替だけでは保存されず、予定またはチケットの既存保存ボタンで確定する。
- Recovery: 空プレビューは「編集に戻る」を示す。書式違い、失敗、競合時も Markdown 原文を保持し、既存の再編集／再読込導線を使う。
- Confusion prevented: ヘルプとマニュアルで、外部画像を取得しないこと、予定の Google 同期は原文であること、チケット本文はローカルのみであることを明示した。

## 4. Accessibility

- Keyboard-only: Tab で表示切替へ到達し、Space / Enter で編集とプレビューを切り替えられる。編集へ戻ると textarea へフォーカスする。
- Semantics: 切替は`aria-pressed`、プレビューは説明名を含む named region、読み込みは status、チェック項目は読み上げ名付き disabled checkbox。
- Focus: チケット説明の入力中にタイトルへフォーカスが戻る既存依存関係を分離し、連続入力と保存を component test で固定した。
- Color: 選択状態は背景だけでなく pressed state と文字のコントラストで示す。
- 200%: ダイアログの縦スクロールとプレビュー内の横スクロールを維持する。
- Automated: Markdown 単体、予定、チケットの keyboard test と axe serious / critical 0。

## 5. Visual hierarchy / efficiency / trust

- ラベル、表示切替、本文、制約ヘルプの順にし、Markdown 機能がタイトルや保存操作より強くならない階層とした。
- 既存説明はプレビュー、空説明は編集を初期値にして、読み取りと新規入力の反復操作を各 1 手減らした。
- 表は内容幅を維持し、狭幅ではプレビュー領域だけを横スクロールする。コードブロックも同じ回復を持つ。
- raw HTML を描画せず、`http` / `https`リンク先は文字として併記してアプリからは開かず、外部画像は代替テキストの placeholder にして予期しない通信と任意 URL navigation を防ぐ。
- Markdown parser は遅延読込に分離した。production build の初期 JS 増分は基準 main 比で約 4.4 kB（gzip 約 1.4 kB）、Markdown chunk はプレビュー時だけ読み込む。
- 予定インスペクターを現在時刻マーカーより上へ配置し、表やチェック項目をマーカーが横切らないことを native 証跡で確認した。

## 6. Counter-review

- 原文破壊: textarea の文字列を唯一の編集値とし、プレビューは派生表示だけにした。edit / preview 往復 test で否定。
- 保存とプレビューの混同: 切替は form submit ではなく、既存保存ボタンだけが永続化する。マニュアルでも明示。
- XSS / tracking: `skipHtml`、URL scheme 制限、任意 URL を開く anchor と`img`の非生成を component test で固定。
- pointer-only: native button と textarea のため keyboard 等価があり、切替と入力を keyboard test で確認。
- 長い表の崩壊: `width: max-content`と preview 内 overflow でセルを潰さず、通常・720px 狭幅・200%文字を native 画像で確認。
- 同期破壊: IPC、SQLite schema、Outbox、Google DTO は変更せず、説明原文の既存保存／同期契約を維持。
- dependency risk: `react-markdown`と`remark-gfm`はいずれも MIT。production audit は既知脆弱性 0。初期 bundle 肥大は lazy chunk で抑制。

## 7. Evidence

- User evidence: 提供スクリーンショットで、長い GFM 表が textarea の原文のまま読みづらいことを確認。個人内容を含むためリポジトリへ保存しない。
- Before: [既存チケット詳細](../../evidence/issue-33/native-ticket-detail.png)（説明は textarea のみ）。予定側も同じ通常 textarea 契約だったことをコードと component test で確認。
- After: [チケット通常](../../evidence/issue-71/native-ticket-markdown-preview.png)、[チケット狭幅](../../evidence/issue-71/native-ticket-markdown-preview-narrow.png)、[チケット 200%文字](../../evidence/issue-71/native-ticket-markdown-preview-text-200.png)、[予定](../../evidence/issue-71/native-schedule-markdown-preview.png)。
- Native result: notification 1 / short schedule 2 / main smoke 18、合計 21 tests Pass（macOS arm64、embedded WebDriver）。
- Redaction: 合成タイトル、説明、タグだけを使用。account、calendar、event、token、端末 path を画像へ含めない。

## 8. Unexecuted validation

| Check                                   | Reason                            | Remaining risk                              | Next action                     |
| --------------------------------------- | --------------------------------- | ------------------------------------------- | ------------------------------- |
| Windows native build / install / launch | 現在の実行環境は macOS arm64      | WebView2 の表、checkbox、200% OS scaling 差 | Windows CI / 実機 release smoke |
| VoiceOver / NVDA                        | 自動 axe と keyboard smoke を優先 | region / disabled checkbox の実読み上げ順   | 対象 OS の支援技術 smoke        |
| Signed / notarized artifact             | 個人用 debug build                | Gatekeeper 配布警告                         | release 工程で署名・notarize    |
