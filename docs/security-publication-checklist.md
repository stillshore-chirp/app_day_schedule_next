# Public Repository Security Checklist

この文書は、git に入る Markdown、source、config、fixture、test artifact、Issue / PR 本文、スクリーンショットを公開可能な状態に保つ基準です。現在の repository visibility に関係なく適用します。

## 1. commit / push 前の禁止情報

| 種別 | 禁止する実値 | 公開用の表現 |
|---|---|---|
| OAuth | client secret、access / refresh token、authorization code、PKCE verifier、state | `<redacted>`、`OS keyring` |
| Google account | email、subject ID、calendar ID、event ID、attendees | `test account`、`calendar-A` |
| 予定内容 | title、description、location、meeting URL、private notes | synthetic fixture |
| DB / backup | raw SQLite、backup、schema dump に個人データ、absolute path | schema / counts / masked sample |
| native secret | signing key、certificate、keychain export、credential blob | GitHub secret 名だけ |
| HTTP / logs | Authorization header、Cookie、raw request / response、stack trace 全文 | status / category / redacted summary |
| environment | home path、device name、username、IP、random OAuth port | `<user-home>`、`loopback port` |
| identifiers | request / trace / job / installation ID の実値 | `diagnostic-id-redacted` |

## 2. サンプルの規則

- `example`, `test`, `placeholder`, `<redacted>` と分かる値を使う。
- 実在し得る email や event title を避け、`user@example.invalid` を使う。
- OAuth JSON を commit しない。必要なら key 名だけの `.env.example` を使う。
- fixture は synthetic で、実予定の匿名化コピーを使わない。
- screenshot は account、calendar、event、system menu、path、notification preview を確認して mask する。

## 3. 文書・PR

- raw log を貼らず、観測事実、判断、対応、未確認、残リスクへ要約する。
- exact timestamp / port / path / ID が再現に不要なら丸める。
- security scan の出力自体に secret を再表示しない。
- public source URL は公式文書か公開 repository のみを記載する。

## 4. 最低確認

```bash
node scripts/security-scan-text.mjs
node scripts/verify-doc-links.mjs
git diff --check
```

さらに差分を次の語で確認します。

```text
token secret password Authorization Bearer client_secret private_key
calendar_id event_id refresh_token access_token authorization_code
```

語の存在だけで漏洩とは限りません。assignment、JSON value、log output、fixture data を重点確認します。

## 5. 漏洩発見時

1. secret / token を revoke または rotate。
2. current branch から削除。
3. artifact、cache、PR comment、release、Git history の対応要否を判断。
4. access / impact を調査。
5. scanner / test / process を更新。

公開済みだから残してよい、という判断は禁止します。
