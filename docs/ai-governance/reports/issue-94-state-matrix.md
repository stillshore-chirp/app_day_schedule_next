# Issue #94 Ticket右クリック移動 State Matrix

| State                       | 表示・操作                                            | 保持する挙動                                             | Accessibility / evidence                        |
| --------------------------- | ----------------------------------------------------- | -------------------------------------------------------- | ----------------------------------------------- |
| 通常ボード                  | カードの右クリックでnative「移動」menuを開く          | WebViewの既定menuをカード上だけ抑止                      | component event + macOS native                  |
| 親menu                      | 「移動」だけを表示                                    | 将来のTicket操作を同じ階層へ追加できる                   | native menu semantics                           |
| 列submenu                   | hover / 右矢印で全列をboard順に表示                   | 列名・順序は`board.columns`を正本にする                  | menu options test + native                      |
| 現在列                      | 「列名（現在）」を無効表示                            | 同じ列末尾への不要なversion / order変更を行わない        | options test                                    |
| 画面外列                    | 選択後に列末尾へ保存し、移動先cardへ表示・focusを移す | 既存のoptimistic version、履歴、Done境界を使用           | component + native IPC                          |
| Done / Omit                 | どちらも移動先へ表示                                  | Doneだけ完了。Omitは未完了でGoogle Tasks完了を変更しない | 既存Rust contract + component                   |
| Shift+F10 / Menu key        | focus中のcard近傍へ同じnative menuを開く              | pointer dragと矢印移動を保持                             | component + native manual                       |
| 検索・絞り込み・独自sort    | 親「移動」を無効表示                                  | hidden-cardの永続順序を変更しない                        | component                                       |
| menu生成 / popup失敗        | danger messageと矢印キーの回復案内を表示              | Ticketを変更しない                                       | component                                       |
| version conflict / 保存失敗 | 既存の再読込案内を表示                                | 古いversionで上書きしない                                | context-menu component / application tests      |
| 720px / 200%文字            | boardとcard操作を横scroll内で保持                     | 既存のcard幅と直接入力を変更しない                       | macOS native E2E screenshot                      |
| native menu / 画面端        | OSがmenuとsubmenuを可視領域内へ配置                   | WebView独自のposition補正を持たない                      | macOS通常倍率manual / Windows・OS 200%未実行     |

Empty boardでは右クリック対象がありません。offline専用状態、permission、time、notificationは今回の操作に非該当です。native menuはDOM外にあるため、axe結果だけでmenu accessibilityを確認済みとしません。
