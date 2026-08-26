# Issue #98 文字表示倍率 UI/UX Review

- 対象面: main window、Compact、analog clockと、repositoryが描画する設定、dialog、menu、tooltip
- user goal: 高解像度displayでも、予定把握と編集操作を維持したまま全UI文字を読み取る
- input: mouse / trackpad、keyboard、screen reader

## 情報設計と操作

設定画面の「文字表示倍率」で `100% / 125% / 150% / 175% / 200% / 250%` を選びます。選択中はmain windowへpreviewし、「設定を保存」の成功後にSQLiteへ保存して、開いている各windowへeventで即時反映します。初期値と旧データの補完値は100%です。

倍率は`--app-font-*` / `--app-font-fluid-*`のroot typography変数を正本にし、CSSの`rem`はfallbackとして使います。WebView全体のzoomは使用しません。文字階層は同じ比率で保ちます。余白、icon、横方向の時間座標は原則として従来密度を維持し、必要な箇所だけwrap、可変高、scroll、読み取り用一覧へ切り替えます。

## Accessibility / platform / counter-review

- native `select`はlabelと6個の明示optionを持ち、keyboardで選択できる。
- 保存前preview、保存成功、保存失敗、既定値読込を区別し、失敗時も選択値と再試行操作を保持する。
- 175%以上のDay Overviewは短い時間barと完全な予定名の読み取り用一覧を分け、同一予定をaccessibility treeへ重複させない。
- Timelineは文字倍率に合わせて縦方向の時間座標とevent高を広げ、現在時刻線、drag preview、長い予定名も同じscaleで扱う。
- Compactはwindow全体を縦scroll可能にし、現在、次、残り、Focus操作へ到達できる。analog clockは文字とdigital表示をscaleし、時計盤と針のgeometryを維持する。
- app内DOM tooltipはroot倍率へ従う。Tauri native tray / Ticket右クリックmenu、HTMLの`title`属性による標準補足表示などOS/WebView描画部分は、OS/WebViewの表示・accessibility倍率へ委ねる。
- 反証対象は100%、全6倍率、720px幅、250%、長い日本語、重複予定、各main destination、別window即時反映、process再起動、旧exportです。

macOS arm64では、製品実装commit `c9521c2` / `07ee62d` / `d561be2` / `1b30233`に対するreal Tauri / WKWebViewのnative E2Eを2026-08-26に実行しました。6倍率のpreview、250%保存後の同一process reload、同じ一時SQLite data directoryを使う別process restart、開いているCompact / analog clockへのevent反映、720 × 720のToday、client area 280 × 280のanalog clock、各main destinationの横overflowとscroll到達性がPassしています。Now Dockの次アラーム文字列は、通常幅と720px幅で文字矩形が要素・Dock内に収まり、縦横overflowがないことも実測しています。E2E harnessと公開証跡は後続のtest / release commitへ収録します。

P0 / P1の残存判定は、native release validationと関連artifactの実在・内容・source commit対応が揃うまで未確定です。Windows x64とmacOS x64のCI native実行、実Windows high DPI / WebView2、VoiceOver / NVDA、installer install / launchは本レポートでは未確認です。OS実機未確認の状態を確認済みとは扱いません。

公開安全性の反証で見つかったraw failure artifact経路は修正済みです。`Native release validation` は、synthetic native flowが生成したPNGとvisual diff PNGだけをallowlistで7日間保存し、raw log、JSON、DB、環境診断をuploadしません。本レポートの画像もsynthetic data、表示内容、metadataを確認したものだけを登録しています。

## 証跡

- component: 設定optionとpreview、保存・失敗・再試行、root appearance、Main / Compact / analog event反映、Day Overview / Timeline geometry、axeを検証する対象とする。
- persistence: Rust serdeの旧設定100%補完、許可倍率validation、SQLite close / reopen、`textScalePercent`のない旧v1 export Replace importを検証する対象とする。実行結果は対象commitと併記する。
- native: macOS arm64のreal Tauri / WKWebViewで、native smoke 20、notification history 1、short schedule 2の3 spec / 23 testsと、別process restartのpersist / restore各1 testがPassした。Windows x64、macOS x64、assistive technology、installerは未実行である。
- screenshot: E2E専用identifierとsynthetic dataだけを使い、公開安全性を確認した画像を[`docs/evidence/issue-98/`](../../evidence/issue-98/README.md)へ登録した。

主要な視覚証跡:

- [Settings 100%](../../evidence/issue-98/native-settings-text-100.png) / [Settings 250%](../../evidence/issue-98/native-settings-text-250.png)
- [Today 250%](../../evidence/issue-98/native-today-text-250.png) / [Today 720 × 720・250%](../../evidence/issue-98/native-today-text-250-narrow.png) / [高倍率用予定一覧](../../evidence/issue-98/native-today-readable-list-text-250.png)
- [Compact 250%](../../evidence/issue-98/native-compact-text-250.png) / [Compact末尾操作](../../evidence/issue-98/native-compact-actions-text-250.png)
- [Analog clock設定 250%](../../evidence/issue-98/native-analog-clock-text-250.png) / [Analog clock 280 × 280・250%](../../evidence/issue-98/native-analog-clock-minimum.png)
