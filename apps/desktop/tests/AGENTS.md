# Native E2E rules

ルート [`AGENTS.md`](../../../AGENTS.md) と親 [`AGENTS.md`](../AGENTS.md) を継承します。

- E2E は Today、予定 CRUD、drag 等価操作、Undo、template、Quick Block、Focus、Google connection state、backup / restore のクリティカル導線へ絞る。
- 実 Google account と個人予定を CI で使わない。OAuth / Calendar は deterministic mock server を使う。
- macOS / Windows 差分を明示し、片方だけで成立する selector や shortcut を共通テストへ持ち込まない。
- test は fixed timezone / locale / clock / screen scale を設定する。
- screenshot、trace、video、DB artifact は個人情報を含まない fixture だけを使う。
- sleep、OS permission dialog、installer など自動化困難な項目は manual matrix と結果を PR に残す。
