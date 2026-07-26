# Google Calendar 接続ガイド

Day Schedule Next は Google の Desktop app OAuth client、既定ブラウザ、Authorization Code + PKCE、`127.0.0.1` の一時 loopback callback を使います。通常の利用者はOAuth JSONを扱わず、「Google カレンダーに接続」から同意するだけです。Web client、埋め込みブラウザ、固定 callback port は使いません。Google は Desktop app の loopback IP flow を引き続きサポートしています。

公式資料:

- [OAuth 2.0 for iOS & Desktop apps](https://developers.google.com/identity/protocols/oauth2/native-app)
- [Loopback IP address flow](https://developers.google.com/identity/protocols/oauth2/resources/loopback-migration)
- [Google Calendar API scopes](https://developers.google.com/workspace/calendar/api/auth)
- [Authentication troubleshooting](https://developers.google.com/workspace/calendar/api/troubleshoot-authentication-authorization)

## 1. 個人用ビルドのGoogle Cloud設定

この作業は個人用ビルドを作る人が一度だけ行います。通常のアプリ利用者には不要です。

1. 個人利用用の Google Cloud project を作成または選択します。
2. Google Calendar API を有効にします。
3. Google Auth Platform の Branding / Audience / Data Access を構成します。
4. External の Testing で使う場合は、自分の Google account を test user に追加します。
5. OAuth client を作成し、application type は必ず `Desktop app` を選びます。
6. client IDとclient secretを安全なローカル設定へ控えます。client JSONや実値をgit、Issue、PR、ログへ保存しません。

Day Schedule Next が要求する scope は次の2つです。

- `https://www.googleapis.com/auth/calendar.events`: 選択した calendar の event を読取・作成・更新・削除
- `https://www.googleapis.com/auth/calendar.calendarlist.readonly`: calendar 一覧、色、timezone、access role の読取

個人利用の Testing app では未確認アプリの警告やtest-user制限が表示され、同意から7日後に認証が失効します。継続利用する個人用appをIn productionへ切り替える場合も、未確認appの警告や未確認app向け上限が残ることがあります。警告に表示されたapp名が自分で作成したprojectと一致する場合だけ許可してください。第三者へ配布する場合は、Googleの公開・verification要件を別途満たす必要があります。

## 2. client IDをビルドへ渡し、client secretをOS秘密ストアへ登録する

repository rootで`.env.example`を`.env.local`へコピーし、同じDesktop appのclient IDとclient secretを設定します。`.env.local`はgitignore対象です。

```bash
cp .env.example .env.local
node --env-file=.env.local scripts/provision-google-oauth-local.mjs
node --env-file=.env.local scripts/build-personal-google-oauth.mjs
```

client IDはcompile-time設定です。値を変更した場合はRust側を再ビルドしてください。client secretは実行バイナリへ埋め込まず、provisionerがmacOS Keychain / Windows Credential Managerへ登録します。Googleのtoken endpointは対象Desktop clientでclient secretを要求するため、接続時とtoken更新時にRust adapterだけがOS秘密ストアから読み取ります。frontend、SQLite、設定export、ログ、build artifactには渡しません。

環境変数がない、Desktop client ID形式でない、またはOS秘密ストアの資格情報がビルドと一致しない場合、Google接続は利用できません。設定画面ではローカル予定がそのまま使えることと、安全な再設定方法を表示します。client secretをコマンド引数へ直接書かないでください。

## 3. Google カレンダーへ接続する

1. Day Schedule Next の「設定」を開きます。
2. Google カレンダーで「Google カレンダーに接続」を選びます。
3. 既定ブラウザでアカウント、app名、要求権限を確認し、許可します。
4. 成功画面を閉じ、アプリへ戻ります。
5. 読み込むcalendarと、書き込み可能な既定calendarを選びます。

認証tokenはmacOS Keychain / Windows Credential Managerへ保存し、SQLiteには保存しません。再接続では同じaccount recordと秘密ストア参照を更新し、既存calendar、同期mapping、`nextSyncToken`を維持します。

## 4. 独自のOAuth設定を上書きする

設定画面の「開発者向け詳細」では、従来のDesktop OAuth client JSONを読み込めます。別のGoogle Cloud projectで検証する場合や、既存の個人設定を継続する場合だけ使用してください。読み込んだ設定は標準のbuild設定より優先されます。

JSONは`installed`形式、Google公式auth / token endpoint、loopback redirectを満たす場合だけ受け付けます。client secretが含まれる場合もSQLiteへ保存せず、OS秘密ストアへ保存します。通常接続へ戻すには、接続とローカルapp dataを安全に退避した上で、追跡外の設定DBを再作成する必要があります。設定切替を安易に行わないでください。

## 5. 同期の挙動

- ローカル操作は SQLite へ先に原子的に保存し、Outbox から Google へ反映します。
- calendar ごとに `nextSyncToken` を保持し、通常は差分同期します。
- token 無効化（410）では、その calendar だけを安全に full sync します。
- precondition failure（412）は remote を再取得し、base / local / remote の3-way mergeへ進みます。
- 429 / 5xx / offline は再試行時刻を保存します。
- 同一フィールドの変更と削除競合は、競合画面でユーザーが解決します。

## 6. 切断する

設定の「Google接続を解除」で次を選びます。

- ローカル予定を保持: token と接続だけを削除し、予定は端末に残す
- Google由来のローカル予定も削除: 対象件数と回復方法を確認してから実行

OS 側の Google account 権限も完全に revoke したい場合は、Google Account の接続済みアプリから対象 client を削除します。再接続時は新しい consent と token が必要です。

## 7. トラブルシューティング

| 状態 | 確認と回復 |
|---|---|
| 接続ボタンが表示されない | Google接続設定を含む個人用buildか確認し、client IDを渡して再ビルド |
| OAuth資格情報が未設定 | `.env.local`の同じDesktop appのclient ID / client secretを確認し、provisionerを再実行 |
| OAuthクライアント設定が不一致 | client IDとOS秘密ストアへ登録したclient secretが同じDesktop appの組であることを確認 |
| JSONを読み込めない | 開発者向け詳細で、Desktop app の `installed` JSON、1 MB 以下、公式 endpoint であることを確認 |
| ブラウザが開かない | OS の既定ブラウザ設定を確認し、設定画面から再試行 |
| callback が失敗 | firewall が `127.0.0.1` の一時 port を遮断していないか確認。3分後に再試行 |
| `access_denied` | Google 画面でキャンセルされた。必要なら再度接続 |
| 未確認アプリ | 自分の project / test user を確認。未知の client なら許可しない |
| 再接続が必要 | token が revoke / expire した。設定から明示的に再接続 |
| 同期待ち | オフライン、429、5xx。データと診断で次回時刻と試行回数を確認 |
| 競合 | データと診断の競合一覧から、フィールドごとに local / Google を選択 |

token、authorization code、PKCE verifier、client JSON、calendar / event ID、Google account のメールを Issue、PR、診断添付へ貼らないでください。診断にはマスク済み JSON だけを使用します。
