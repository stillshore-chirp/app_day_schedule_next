# Issue #29 Sidebar / Today overview state matrix

対象は main window の主要画面サイドバーと Today overview のテンプレート編集導線です。予定・テンプレートの保存、同期、通知、時刻モデル、Compact Window の内容は変更していません。

| State | User sees | User understands | Allowed next action | Recovery | A11y status / structure | Evidence | Pass / Fail |
|---|---|---|---|---|---|---|---|
| First use / empty | 76px のアイコンレール、展開ボタン、空の予定／テンプレートレーン、その上の編集ボタン | ナビゲーションを格納したまま Today の表示領域を広く使える | アイコンで画面移動、サイドバー展開、予定作成、テンプレート編集 | 展開ボタンでラベルを表示 | icon-only button は `aria-label` と `title`、toggle は `aria-expanded` / `aria-controls` | unit / native normal | Pass |
| Normal | 既存の予定・テンプレートバーを同幅のトラックで表示し、編集ボタンはトラック外 | 編集操作はレーンの横幅を削らず、バー比較に使える幅が揃う | 予定選択、テンプレート編集、画面移動 | 既存 Inspector / Templates 導線 | 既存の予定 button、template listitem、見出し構造を維持 | component / native geometry | Pass |
| Expanded / restored | 220px のサイドバーにアイコンとラベル、格納ボタン | ラベルを確認しながら画面移動できる | 画面移動、再格納 | 展開選択は `localStorage` から再表示時に復元 | ラベル表示時も accessible name は同一 | unit / native toggle | Pass |
| Many schedules / overlap | 既存の level、overflow summary、共通時間軸 | ナビゲーションの幅を抑え、overview の比較領域を確保できる | 個別予定を選択 | 既存の選択・編集 | 既存 role / name / focus を変更しない | regression suite / CSS inspection | Pass |
| Cross-midnight | 24:00 端と翌日継続表示、同幅の2トラック | 日跨ぎとテンプレートを従来どおり比較できる | 予定選択、テンプレート編集 | 既存 direct edit | entity identity と accessible name を変更しない | existing component regression | Pass |
| Loading / error / disconnected / offline / conflict | 既存の画面状態とサイドバー、状態に応じた案内 | ナビゲーションの格納はデータ状態と独立している | 既存 retry / Settings / conflict 解決 | 既存回復導線 | nav name と状態表示を維持 | unit / a11y regression | Pass |
| Short viewport | サイドバー内部を縦スクロールできる | 下部の画面項目とCompact表示へ到達できる | keyboard / pointer scroll、画面移動 | ウィンドウ拡大または格納維持 | DOM順とfocus orderを維持 | CSS inspection / native narrow | Pass |
| Narrow / 200% text / high DPI | 76px レール、同幅のoverviewトラック、トラック外の編集ボタン | 文字拡大時も主要操作と比較領域を失わない | toggle、画面移動、編集 | ウィンドウ拡大、OS倍率調整 | icon-only name、可視focus、button targetを維持 | native narrow / 200% screenshot | Pass |
| Compact Window | main window のサイドバー変更はCompact内容へ影響しない | Compactを従来どおり別表示として使える | icon-only の「コンパクト表示」ボタン | main windowへ戻る | compact action に `aria-label` / `title` | unit / existing native regression | Pass |

## 未対象状態

検索結果なし、入力エラー、DST ambiguity、permission、backup / restore / import、fatal migration は今回のレイアウトと状態モデルを変更していないため既存回帰へ委譲します。Windows native、実スクリーンリーダー、OS scaling 200% はローカルmacOSでは未実行です。
