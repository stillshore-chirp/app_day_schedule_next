# GitHub automation rules

ルート [`AGENTS.md`](../AGENTS.md) を継承します。

- workflow permissions は `contents: read` を既定とし、write 権限は job 単位で必要最小限にする。
- action は保守された major tag または commit SHA を使い、Dependabot で更新する。
- secret 値を echo、artifact、PR comment、cache key に出さない。
- CI は harness を常時実行し、アプリ scaffold 後は frontend、Rust、macOS / Windows build を自動検出して有効化する。
- required check を意図的に skip する変更は P0。条件式と branch policy の contract test または目視根拠を残す。
- Issue / PR template の必須項目を弱める変更は、ガバナンス Issue と反証レビューを必要とする。
