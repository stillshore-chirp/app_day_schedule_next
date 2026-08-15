# Issue #88 予定作成・編集 UI/UX Review

- 対象面: repository が制御する Tauri アプリ本体の予定 Inspector
- 対象ユーザー: タイトル、日時、説明だけで予定入力を終えることが多い利用者
- ユーザー提示の判断: 主要項目を先に置き、時刻は直接入力とプルダウンを両方用意する

## 価値と情報設計

作成時の読み順を「タイトル → 日付・開始/終了時刻 → 説明」とし、時刻の移動、所要時間、詳細設定はその後ろへ置きます。予定作成とキャンセルは Inspector 下部に固定し、主要入力や詳細設定をスクロールしても操作を失いません。

同日は日付を 1 度だけ表示します。終了時刻が開始以前になる選択は翌日の終了とし、「翌日」チップと終了日で明示します。複数日にまたがる既存予定でも終了日を直接確認できます。

## 時刻操作と予測可能性

- 時刻入力は 1 分単位の `time` 入力と、設定中のスナップ幅で並ぶ native `select` を併設します。
- 開始時刻と開始日の変更は所要時間を保ち、終了時刻と終了日の変更は所要時間を変えます。
- 「時刻を移動」は開始・終了を同時に前後させ、「所要時間」は終了だけを短縮・延長します。15 分・30 分・60 分の候補は `aria-pressed` で現在値を表します。
- `10:07` のようなスナップ外の入力を丸めず、候補内にも現在値として残します。
- civil local time の加減算を OS timezone に依存しない helper へ分離し、保存時は既存の IANA timezone resolver で DST gap / fold を確定します。存在しない時刻は入力を残して停止し、2 回現れる時刻は時刻変更後に UTC offset を選び直します。

## Accessibility / responsive

時刻の直接入力は可視 label、候補 select は「開始時刻の候補 / 終了時刻の候補」という accessible name を持ちます。移動・所要時間のボタンと候補 select は 44px 以上の操作領域です。詳細設定は native `details/summary` で、作成時は閉じ、編集時に設定済み項目があれば開いて値を隠しません。

200%文字の macOS WebView で Inspector 内に横スクロールがなく、作成・キャンセルが下部に残ることを geometry assertion と画像で確認しました。ただし、この時点の assertion は個々の native 時刻 control の可読幅と select の表示値を検査しておらず、merge 後に不足が判明しました。後続の修正と追加証跡は [Issue #90 review](issue-90-uiux-review.md) に記録します。axe の serious / critical は 0 件です。

## 状態・回復・信頼

詳細は [state matrix](issue-88-state-matrix.md) を正本とします。読み取り専用の Google 予定は時刻・詳細コントロールと保存を無効にし、既存の複製導線と説明原文の選択可能性を維持します。busy 中は保存と複製を無効にし、validation / DST 失敗では入力を保持します。SQLite、Outbox、Google sync、通知トリガー、schema は変更していません。

## 反証レビュと判定

- 当初案では時刻調整コントロールが説明より先にあり、主要入力の順序を分断しました。実機確認後に説明を時刻調整より前へ移し、「タイトル → 日時 → 説明」を連続させました。
- JavaScript `Date` で local datetime を加減算すると OS timezone が予定の IANA timezone と異なる場合に補正が混入するため、UTC getter だけを使う civil time helper と実時刻 resolver を分離しました。
- P0: なし。merge 後に、200%文字で時刻が欠け、select が現在値を表示しない P1 を確認しました。Issue #90 で修正と回帰テストを追加します。
- macOS arm64: native Tauri WebView の作成・保存・再読込、直接時刻、候補、移動、短縮、所要時間候補、日跨ぎ、200%文字を確認済み。
- Windows WebView2 実機、VoiceOver / NVDA 手動操作は未実施です。

## 合成証跡

- [主要入力と下部アクション](../../evidence/issue-88/native-schedule-editor-primary.png)
- [200%文字](../../evidence/issue-88/native-schedule-editor-text-200.png)
- [23:30 から翌日 00:30](../../evidence/issue-88/native-schedule-editor-cross-midnight.png)

証跡は隔離 DB と合成予定だけで生成し、実アカウント、個人予定、token、端末の絶対 path を含みません。
