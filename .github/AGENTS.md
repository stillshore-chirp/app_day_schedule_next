# GitHub automation rules

ルート [`AGENTS.md`](../AGENTS.md) を継承します。

- workflow permissions は `contents: read` を既定とし、write 権限は job 単位で必要最小限にする。
- action は保守された major tag または commit SHA を使い、Dependabot で更新する。
- secret 値を echo、artifact、PR comment、cache key に出さない。
- PR CI は変更pathをclassifierで分類し、該当する governance / frontend / native / dependency Quality gate だけを選択して実行する。security text scan と集約 Quality gate は全PRで維持し、native影響時は個人利用の主対象である macOS arm64 の Rust test と通常 Tauri no-bundle build を追加する。
- macOS x64 / Windows、native E2E、installer は削除せず、出荷判断時に手動 release validation workflow で選択する。自動実行へ戻す場合は費用と必要性を Issue / PR に残す。
- required check を意図的に skip する変更は P0。skip 条件、自動／手動 gate、artifact retention は `scripts/validate-governance.mjs` とworkflow contract testで固定する。
- Issue / PR template の必須項目を弱める変更は、ガバナンス Issue と反証レビューを必要とする。
