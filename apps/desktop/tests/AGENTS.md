# Native E2E rules

ルート [`AGENTS.md`](../../../AGENTS.md) と親 [`AGENTS.md`](../AGENTS.md) を継承します。検証の選択は [`docs/testing/index.md`](../../../docs/testing/index.md) の `DSN-RISK-BASED-DELIVERY`、製品契約は [`docs/product-invariants.md`](../../../docs/product-invariants.md) を正本とします。

- E2E は Today、予定 CRUD、drag 等価操作、Undo、template、Quick Block、Focus、Google connection state、backup / restore のcritical flowへ絞る。
- 実 Google account と個人予定を CI で使わない。OAuth / Calendar / Tasks は deterministic mock server と synthetic fixture を使う。
- sync、time / notification、migrationの変更では該当Skillのintegration matrixを先に確認し、E2Eで代替しない。
- macOS / Windows 差分を明示し、片方だけで成立する selector や shortcut を共通テストへ持ち込まない。
- test は fixed timezone / locale / clock / screen scale を設定する。
- screenshot、trace、video、DB artifact は個人情報を含まない fixture だけを使う。
- sleep、OS permission dialog、installerなど自動化困難な項目は、影響OSのmanual matrixと未実行理由を記録する。
- ユーザー向けdesktop変更は、exact HEADに対応するアプリchecksum、復旧可能なinstall、launch smokeをrelease contractに従って記録する。
