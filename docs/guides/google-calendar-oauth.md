# Google Calendar 接続ガイド

Day Schedule Next は Google の Desktop app OAuth client、既定ブラウザ、Authorization Code + PKCE、`127.0.0.1` の一時 loopback callback を使います。Web client、埋め込みブラウザ、固定 callback port は使いません。Google は Desktop app の loopback IP flow を引き続きサポートしています。

公式資料:

- [OAuth 2.0 for iOS & Desktop apps](https://developers.google.com/identity/protocols/oauth2/native-app)
- [Loopback IP address flow](https://developers.google.com/identity/protocols/oauth2/resources/loopback-migration)
- [Google Calendar API scopes](https://developers.google.com/workspace/calendar/api/auth)
- [Authentication troubleshooting](https://developers.google.com/workspace/calendar/api/troubleshoot-authentication-authorization)

## 1. Google Cloud 側を準備する

1. 個人利用用の Google Cloud project を作成または選択します。
2. Google Calendar API を有効にします。
3. Google Auth Platform の Branding / Audience / Data Access を構成します。
4. External の Testing で使う場合は、自分の Google account を test user に追加します。
5. OAuth client を作成し、application type は必ず `Desktop app` を選びます。
6. client JSON を端末へダウンロードします。

Day Schedule Next が要求する scope は次の2つです。

- `https://www.googleapis.com/auth/calendar.events`: 選択した calendar の event を読取・作成・更新・削除
- `https://www.googleapis.com/auth/calendar.calendarlist.readonly`: calendar 一覧、色、timezone、access role の読取

個人利用の Testing app では未確認アプリの警告や test-user 制限が表示されることがあります。警告の意味を確認し、自分で作成した project / client だけを許可してください。第三者へ配布する場合は、Google の公開・verification 要件を別途満たす必要があります。

## 2. アプリへ読み込む

1. Day Schedule Next の「設定」を開きます。
2. Google Calendar セクションで「Desktop OAuth JSONを読み込む」を選びます。
3. ダウンロードした JSON を選びます。
4. 画面に表示される client ID の末尾と scope を確認します。
5. 「Googleへ接続」を選びます。
6. 既定ブラウザでアカウントと権限を確認し、許可します。
7. 成功画面を閉じ、アプリへ戻ります。
8. 読み込む calendar と、書き込み可能な既定 calendar を選びます。

JSON は `installed` 形式、Google 公式 auth / token endpoint、loopback redirect を満たす場合だけ受け付けます。client secret は SQLite に保存せず、macOS Keychain / Windows Credential Manager へ保存します。access / refresh token も同じ秘密ストアに置きます。

## 3. 同期の挙動

- ローカル操作は SQLite へ先に原子的に保存し、Outbox から Google へ反映します。
- calendar ごとに `nextSyncToken` を保持し、通常は差分同期します。
- token 無効化（410）では、その calendar だけを安全に full sync します。
- precondition failure（412）は remote を再取得し、base / local / remote の3-way mergeへ進みます。
- 429 / 5xx / offline は再試行時刻を保存します。
- 同一フィールドの変更と削除競合は、競合画面でユーザーが解決します。

## 4. 切断する

設定の「Google接続を解除」で次を選びます。

- ローカル予定を保持: token と接続だけを削除し、予定は端末に残す
- Google由来のローカル予定も削除: 対象件数と回復方法を確認してから実行

OS 側の Google account 権限も完全に revoke したい場合は、Google Account の接続済みアプリから対象 client を削除します。再接続時は新しい consent と token が必要です。

## 5. トラブルシューティング

| 状態 | 確認と回復 |
|---|---|
| JSONを読み込めない | Desktop app の `installed` JSON、1 MB 以下、公式 endpoint であることを確認 |
| ブラウザが開かない | OS の既定ブラウザ設定を確認し、設定画面から再試行 |
| callback が失敗 | firewall が `127.0.0.1` の一時 port を遮断していないか確認。3分後に再試行 |
| `access_denied` | Google 画面でキャンセルされた。必要なら再度接続 |
| 未確認アプリ | 自分の project / test user を確認。未知の client なら許可しない |
| 再接続が必要 | token が revoke / expire した。設定から明示的に再接続 |
| 同期待ち | オフライン、429、5xx。データと診断で次回時刻と試行回数を確認 |
| 競合 | データと診断の競合一覧から、フィールドごとに local / Google を選択 |

token、authorization code、PKCE verifier、client JSON、calendar / event ID、Google account のメールを Issue、PR、診断添付へ貼らないでください。診断にはマスク済み JSON だけを使用します。
