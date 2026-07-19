# Desktop application rules

この領域は React frontend と Tauri native shell を含みます。ルート [`AGENTS.md`](../../AGENTS.md) の完了ゲートを継承します。

- `src/` と `src-tauri/` の責務を混在させない。
- frontend から Google API、SQLite、keyring、general filesystem を直接呼ばない。
- IPC contract を変更したら TypeScript / Rust の型、validation、contract test、関連文書を同時更新する。
- UI 変更は `.agents/skills/ui-ux-review/SKILL.md` を使い、native WebView 上で確認する。
- Tauri plugin / capability を追加したら `.agents/skills/desktop-release-review/SKILL.md` を使う。
- macOS と Windows の window、menu、shortcut、notification、keyring、WebView 差分を判断する。
- user-visible error に raw Rust error、SQL、HTTP body、token、path を出さない。
