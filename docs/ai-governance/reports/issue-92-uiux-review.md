# Issue #92 Omit列・優先チケット UI/UX Review

- 対象面: repositoryが制御するTauriアプリ本体のTicket boardとToday
- user goal: 今は対応しないTicketを削除せずに退避し、現在優先すべきTicketをTodayで忘れずに確認する
- 発見状態: macOS WKWebView。利用者データは使用せず、合成Ticketと予定だけをnative証跡へ保存する

## 情報設計と修正

Ticket boardの完了済みを表す`Done`の右へ、未完了のまま参照用に保持する`Omit`を追加します。Omitへの移動は履歴へ残し、archive・削除・Google Tasksの完了操作にはしません。`Done`との境界を越えた場合だけ、Google Tasksの完了・再開を従来の同期経路へ渡します。

Todayの「未配置チケット」は「優先チケット」へ置き換えます。対象は優先度が「高」または「最優先」で、列が`Done`と`Omit`以外のTicketです。予定化済みでも表示を続けるため、時間へ置けたかではなく、現在抱えている優先事項を確認する面になります。初期状態は展開し、見出しの直後へ件数と参照用カードを置きます。drag説明、日時入力、未配置filterは削除します。

## Accessibility / state / counter-review

- 展開buttonは`aria-expanded`と`aria-controls`を持ち、Enter / Spaceで折りたたみと再展開ができる。矢印は装飾としてaccessible nameから除外する。
- loading、errorと再試行、0件、通常表示を領域内で区別し、Todayの予定取得失敗時にも優先チケット一覧を残す。
- 長い分割不能なTicket名はカード内で折り返し、狭幅と200%文字で横overflowを発生させない。
- TodayからTicketを直接編集・予定化できるcontrolは置かない。参照面という依頼範囲を保ち、変更操作は既存のTicket画面へ集約する。
- Omitを完了扱いにすると「対応しないが参考に残す」とGoogle Tasksの完了状態が混ざるため、完了判定は`Done`だけに限定する。
- P0: なし。P1: migration rollback、Google Tasks完了境界、予定取得失敗時の一覧消失を自動testへ固定。P2: なし。

## 証跡と残る確認

- component: 高・最優先だけを表示し、Done / Omitを除外。予定化済みを残し、loading / error / empty、keyboard、1,001件pagination、axeを確認する。
- Rust: schema 17→18の成功と外部キー不整合時rollback、Omitの未完了判定、Outbox非生成、Done境界の完了・再開を確認する。
- macOS native: Omitへのpointer / keyboard移動と永続化、Todayの初期展開・折りたたみ、予定化後も残る優先Ticket、通常幅・狭幅・200%文字・横overflowを確認する。
- 合成 screenshot: [変更前の未配置チケット](../../evidence/issue-92/native-today-before.png)、[優先チケット](../../evidence/issue-92/native-priority-tickets-open.png)、[狭幅](../../evidence/issue-92/native-priority-tickets-narrow.png)、[200%文字](../../evidence/issue-92/native-priority-tickets-text-200.png)、[Omit列](../../evidence/issue-92/native-ticket-omit.png)。
- Windows WebView2、VoiceOver、NVDAの手動確認は未実施。macOSのnative証跡を他環境の確認済み証跡としては扱わない。
