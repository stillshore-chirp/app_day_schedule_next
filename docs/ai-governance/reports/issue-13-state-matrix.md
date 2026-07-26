# Issue 13 Google OAuth State Matrix

| State | User sees | User understands | Allowed next action | Recovery | A11y status / structure | Evidence | Pass / Fail |
|---|---|---|---|---|---|---|---|
| First use / configured build | 「Google カレンダーに接続」と「接続前」 | JSONを用意せずGoogle同意へ進める | primary buttonで接続開始 | キャンセル後も同じ操作を再実行 | `section` + heading、native `button`、状態chip | `OperationalViews.google.test.tsx`、`native-google-connect-after.png` | Pass |
| Build config missing | 接続不可の理由、ローカル予定は利用可能、個人用buildが必要 | 予定消失ではなくbuild設定不足 | 開発者向け詳細、または設定済みbuildを利用 | client IDを設定して再build | warning status、接続buttonを出さない | `OperationalViews.google.test.tsx` | Pass |
| Loading | Google接続状態の読込中 | まだ操作結果が確定していない | 読込完了を待つ | 読込失敗時は理由と再試行方法を表示 | 状態chip、errorはtitle + recovery | component test、typed error handling | Pass |
| Connecting | ブラウザで接続待ち、3分以内の案内 | appへコード貼付は不要 | ブラウザで同意、または待つ | timeout後に再実行 | status message、2秒poll | Rust OAuth state + UI state | Pass |
| Browser cancelled / OAuth failure | 接続未完了、ローカル予定保持、再試行案内 | 同期だけ失敗し予定は失われない | 接続を再実行 | error categoryを次回開始時にclear | warning status | UI copy、Rust error-state update | Pass |
| Auth required | 「Googleへの再接続が必要」、ローカル予定保持 | 既存予定と紐付けを維持したまま認証だけ更新する | 「Googleへ再接続」 | browser consentを再実行 | warning action、native button | component test、Rust reauth regression test | Pass |
| Connected | account、calendar、読取／書込可否、同期対象、既定書込先 | どのcalendarを読む／書くか | checkbox / radioを変更、または接続解除 | 保存失敗時は選択を維持して再試行 | group、checkbox、radio、visible labels | 既存Google UI契約・a11y suite | Pass |
| Reconnect complete | 同じaccount IDでconnectedへ戻る | 既存calendar選択と同期差分を継続できる | 同期再開 | calendar一覧取得失敗時は後続syncで再取得 | UIはconnected / error warningを分離 | `reauthentication_updates_account_without_deleting_calendars` | Pass |
| Developer override | 折りたたまれた「開発者向けOAuth設定」 | 通常は変更不要 | detailsを開き、独自Desktop JSONを選択 | invalid JSONは理由と再選択方法を表示 | native `details` / `summary`、通常時はbutton非表示 | native E2E、component test | Pass |
| Narrow / 200% text / high DPI | Google panelは縦方向へ流れ、primary actionを保持 | 接続状態と操作対象を読める | keyboard / scrollで操作 | layoutは横scrollへ依存しない | native settings narrow smoke、Google panel 200% text | native E2E、style regression tests | Pass |
| Permission denied / OS browser failure | system browserを開けない理由と既定browserの回復案内 | Google側ではなくOS起動で停止した | 既定browser設定後に再試行 | local予定とcredentialは変更しない | danger status + recovery | command error contract、UI typed error handling | Pass |

予定件数、日跨ぎ、DST、検索結果なし、backup / restore、Compact WindowはGoogle接続panelの表示契約を変えないため、このIssueの差分対象外としました。同期本体の状態matrixは [`docs/engineering/calendar-sync.md`](../../engineering/calendar-sync.md) とIssue 4の完了証跡を継承します。
