# Issue #94 Ticket右クリック移動 UI/UX Review

- 対象面: repositoryが制御するTauri main windowのTicket Kanbanと、UserManual / capability文書
- user goal: 横scroll外にある列を含め、表示中のTicketを任意列へ短い操作で移動して結果を確認する
- input: mouse / trackpad右クリック、Shift+F10、Context Menu key。既存pointer drag / arrow keyも保持する

## 情報設計と操作

カード上の右クリックを、OS標準のnative context menuへ接続します。最初の階層は「移動」だけとし、hoverまたはkeyboardで開くsubmenuへ`board.columns`の全列を並べます。現在列は「（現在）」を付けて無効にし、同一列末尾への意図しない並べ替えを防ぎます。

移動先の選択は既存のTicket move application contractへ`beforeTicketId: null`で渡します。これにより列末尾への保存、optimistic version、履歴、Done完了・再開、Google Tasks Outbox境界を新しいUIへ複製しません。保存後は移動先cardを横scrollの表示範囲へ入れてfocusし、Ticket名と移動先列をlive regionで通知します。

検索・絞り込み・独自sort中は、見えていないcardの順序保護を優先して親「移動」を無効にします。既定のWebView menuはTicket card上だけで抑止し、入力欄やMarkdown本文のcopy / paste context menuには影響させません。

## Accessibility / platform / counter-review

- native Menu / Submenuへhover、矢印、Enter、Escape、outside dismissal、画面端反転、OS accessibility semanticsを委ねる。DOM製の疑似menuを追加しない。
- cardの読み上げ説明へ右クリックとShift+F10を追加し、`aria-keyshortcuts`へShift+F10を公開する。
- menu生成またはpopupが失敗した場合は、Ticket未変更と矢印キーの回復手段をdanger messageで示す。
- main windowへ許可するTauri機能はmenuの生成、popup、resource解放だけとし、app menu / window menu設定、append / remove、任意shell / filesystemは許可しない。
- native menuはWebView DOM外なので、component axeやWebDriver selectorでOS menuの見た目・読み上げを代替しない。
- 反証: 現在列の再選択、連続action、画面外のDone / Omit、720px、200%文字、検索中、popup失敗、version conflictを確認対象にする。

P0 / P1は実装、component検証、macOS native観測後に残っていません。P2として大量のcustom列・極端に長い列名は現行board上限内でOS menuに委ねます。Windows WebView2、VoiceOver、NVDA、OS表示倍率200%の手動確認は未実行であり、macOS通常倍率のnative証跡から推定しません。

## 証跡

- 変更前: [Omit追加後のTicket board](../../evidence/issue-92/native-ticket-omit.png)。カード上の右クリックはアプリ操作へ未接続だったため、公開対象外のsystem menu screenshotは保存しない。
- 変更後: [画面外のOmit列へ移動し、カードへfocusしたboard](../../evidence/issue-94/native-ticket-context-move.jpg) と [720px幅・200%文字のboard](../../evidence/issue-94/native-ticket-board-text-200.png)。いずれもE2E専用identifierと合成Ticketだけを使用した。
- component: menu options、固定menu ID、現在列disabled、全列順序、既定contextmenu抑止、Control-click、Shift+F10、無効状態、menu / cleanup failure、move conflict / 保存失敗、scroll / focus、live announcement、axeを確認した。
- native: macOS WKWebView上の右クリックで親「移動」と全7列のsubmenuをAX treeで確認し、現在列disabled、画面外Omit選択、保存、横scroll、移動後focusを確認した。Shift+F10でも同じmenuが開き、Omitが現在列としてdisabledになり、EscapeでTicketを変更せずcard focusへ戻った。
- native menu表示中はComputer Useのscreenshot APIが画像を返さなかったため、menu自体を画像証跡として保存していない。WebDriverからOS menuへ送る選択キーも届かないため、native menu操作はmacOS manual observation、前後状態と狭幅・200%は自動screenshotへ分離した。
