# Operations / Diagnostics

Day Schedule Next は個人端末で動くローカルファーストアプリです。この文書は障害切り分け、データ保護、同期、通知、配布の運用正本です。

## 初動

1. 「データと診断」でアプリ／DB version、整合性、Outbox、競合、最終バックアップを確認します。
2. 「バージョン情報をコピー」または「マスク済み診断 JSON」を取得します。
3. 書き込みを伴う復旧前に「設定 > データ」でバックアップを作成します。
4. local-only、Google API、OS notification、credential store、WebView のどこで失敗したかを分離します。
5. 実機ログを見ていない判断は仮説として扱います。

公開 Issue / PR に DB path、端末名、account、calendar / event ID、予定本文、token、authorization code、raw HTTP body、raw stack trace を貼らないでください。

## 診断情報

診断画面は次を読み取り専用で表示します。

- app version、schema version、DB integrity
- 有効予定、削除待ち、Outbox、未解決競合
- 最終検証済みバックアップ
- 通知の発火予定・試行時刻・結果・エラー分類（本文なし）
- Google Tasksの選択List数、同期Ticket数、反映待ち、競合、最終成功、エラー分類、次回retry（remote IDと本文なし）

export は構造化イベントだけを最大500件含めます。予定／Ticket名、説明、場所、メール、remote ID、token、絶対パスは収集しません。

## データ復旧

- backup は SQLite online backup 後に integrity check と SHA-256 を検証し、履歴へ記録します。
- restore は現在 DB を rollback copy として保持し、候補を staging します。即時 overwrite はしません。
- 次回起動時に integrity check、migration、smoke query を通過した候補だけを切り替えます。
- JSON / legacy import は preview fingerprint を再検証し、ファイル変更や不正値があれば mutation 前に拒否します。
- replace import でも Google mapping を持つ予定を黙って削除しません。
- downgrade は未対応です。新しい schema の DB を古い build で開かないでください。

## Google 同期

接続準備は [`docs/guides/google-calendar-oauth.md`](docs/guides/google-calendar-oauth.md) を参照します。

| 分類 | 挙動と回復 |
|---|---|
| offline | ローカル確定済み。Outbox を保持し、接続回復後に再試行 |
| 401 / invalid grant | `auth_required`。token を出力せず、ユーザーが再接続 |
| 410 | calendar 単位の stale token を破棄し、安全な full sync。local-owned item は保持 |
| 412 | remote を再取得し、3-way merge または競合画面 |
| 429 | `Retry-After` を優先し、再試行時刻を保存 |
| 5xx | bounded backoff。手動連打で retry storm を作らない |
| 同一フィールド／削除競合 | silent last-write-wins を禁止し、解決結果を新しい base として同期 |
| Tasks作成結果不明 | 自動再作成を停止。Google側を確認後に同期解除し、必要な場合だけ再同期 |
| Tasks validation | remote値を切り詰めずshadowを保持。当該Listを停止して入力またはGoogle側を確認 |

同期キューは項目ごとの理由、試行回数、次回時刻を表示し、項目単位または全体で再試行できます。

## 通知と Focus

- `delivery_key = entity + phase + offset + occurrence` の hash で再起動後も重複を抑止します。
- poll は永続 `last_check` と grace window を使い、古い通知を無制限に再生しません。
- Quick Block は有効な項目だけを通知候補にします。
- DST gap / ambiguity は通知時刻を黙ってずらさず、その occurrence をスキップします。
- OS 通知権限がない場合もアプリ内音は独立して動作できます。
- 完全終了中は通知できません。トレイ格納との違いを設定と終了操作に表示します。
- Focus は phase、開始 instant、累積秒、cycle、履歴を永続化します。

sleep / resume、timezone change、clock jump の調査では、通知台帳、grace、最大 replay、Focus 履歴の順で確認します。

## ローカル検証

```bash
npm run verify:bootstrap
pnpm format:check
pnpm lint
pnpm typecheck
pnpm test
pnpm test:a11y
cargo fmt --all -- --check
cargo clippy --workspace --all-targets --all-features -- -D warnings
cargo test --workspace --all-features
pnpm audit --audit-level moderate
cargo deny --all-features check advisories licenses sources
pnpm build
pnpm tauri:build:debug
```

この一覧は横断変更、data / distribution、release判断、CI failure再現の一括候補です。通常変更は [`docs/testing/index.md`](docs/testing/index.md) のrisk laneでfocused local checksを選び、full suiteはlatest-head CIへ委ねます。ユーザー向け変更の個人利用handoffは`pnpm --dir apps/desktop tauri build --debug --bundles app`で `.app` を生成し、復旧可能なinstallとlaunch smokeを行います。

ネイティブ E2E は E2E 専用 build で実行します。失敗時の `apps/desktop/logs` はローカル診断用であり、public artifact へ raw のまま添付しません。

## リリース

- PR CI は重複するpush実行を作らず、harness / frontend と、native影響時のmacOS arm64 Rust test・通常Tauri no-bundle buildを行います。
- macOS x64 / Windows、Native E2E、unsigned debug installerは `Native release validation` workflowで対象を選択します。普段は実際に使うmacOS arm64だけ、release判断時は`all`と`build_installers=true`を指定します。
- Dependency auditは依存ファイル変更PR、月1回、手動実行に限定します。Dependabotのversion updateも3 ecosystemを月次groupにします。
- 個人利用でも、対象 OS で install、launch、quit、tray、window、notification、credential store、OAuth loopback、backup / restore を観測します。
- unsigned build の警告を隠しません。署名・公証・code signing を導入するまで第三者向け正式配布物と呼びません。
- signing secret、証明書、credential JSON は repository / artifact へ置きません。

## 公開報告

公開報告は「観測事実」「判断」「対応」「未確認」「残リスク」を分けます。CI、スクリーンショット、ログについて、実施していない確認を実施済みと記載しません。
