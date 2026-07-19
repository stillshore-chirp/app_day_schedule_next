# Security Policy

## 対象

- OAuth、Google Calendar、OS keyring、SQLite、backup、diagnostics、Tauri capabilities / CSP。
- 公開 Issue、PR、ログ、スクリーンショット、fixture に含まれる秘密・個人データ。

## 報告

公開 Issue に秘密値や個人予定を貼らないでください。公開済みの値でも再掲載しません。実値を含む可能性がある場合は、リポジトリ所有者へ非公開経路で連絡し、公開 Issue には影響と再現条件を抽象化して記載します。

## 実装原則

- refresh token は OS keyring のみへ保存する。
- SQLite と log に token / authorization code / PKCE verifier を保存しない。
- Tauri capabilities と CSP は window / command 単位の最小権限とする。
- remote script、CDN、任意 shell、general filesystem、frontend direct SQL / HTTP を禁止する。
- export / diagnostics / crash report は allowlist と redaction を使う。
- dependency と installer の provenance を確認し、lockfile を commit する。

## 漏洩時

1. 値を revoke / rotate する。
2. 影響範囲とアクセス可能性を確認する。
3. 現行 branch から削除する。
4. Git 履歴・artifact・cache の対応要否を判断する。
5. 再発防止テストまたは scanner を追加する。
