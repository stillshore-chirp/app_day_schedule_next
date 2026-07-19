# Operations / Diagnostics

Day Schedule Next は個人端末で動くローカルファーストアプリです。この文書は、障害切り分け、データ保護、Google 同期、通知、OS 配布の運用正本です。

## 基本方針

- ユーザーの SQLite とバックアップを最優先で保護する。
- 破損・migration 失敗・sync conflict を自動上書きで隠さない。
- 診断情報は明示操作で export し、秘密・個人予定・token を redaction する。
- 実機ログを見ていない場合は、コード上の仮説として報告する。

## 初動

1. アプリ version、OS、architecture、発生操作、発生期間を確認する。
2. DB path や account identifier の実値を公開 Issue に貼らない。
3. 書き込みを伴う復旧前にバックアップを作成する。
4. `diagnostics_snapshot` と mask 済みログの取得可否を確認する。
5. local-only 問題、Google API 問題、OS notification / keyring / WebView 問題を分離する。

## データ復旧

- restore は現 DB の退避後に実施する。
- `PRAGMA integrity_check`、schema version、migration、smoke query を通過しない DB へ切り替えない。
- legacy import は preview の件数・変換・警告を確認してから commit する。
- sync mapping を消す操作は full resync と duplicate risk を説明する。

## 同期

- 401 / `invalid_grant`: 再認証。token や HTTP body をログへ出さない。
- 410: 対象 calendar の sync state を安全に再構築する。local-owned item を消さない。
- 412: remote を再取得して 3-way merge を再実行する。
- 429 / 5xx: backoff + jitter。手動連打で retry storm を作らない。
- conflict: base / local / remote と解決結果を保持する。

## 通知・Focus

- sleep / resume、timezone change、system clock jump を確認する。
- delivery ledger の重複 key と grace window を確認する。
- 完全終了時と tray 常駐時を区別する。
- Focus timer は wall clock だけに依存せず、pause / resume の累積を検証する。

## リリース

- macOS と Windows の installer、起動、権限、keyring、notification、window state、Google OAuth loopback を実機で確認する。
- 署名・公証・配布を導入した後は、鍵や証明書をリポジトリへ置かない。
- unsigned 個人ビルドの警告や制約を README / UserManual に明示する。

## 公開報告

公開 Issue / PR には、観測事実、判断、対応、未確認、残リスクだけを記載します。raw DB、backup、token、calendar ID、event content、home path、端末名、正確な log identifier は記載しません。
