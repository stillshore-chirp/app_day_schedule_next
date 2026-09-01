# AIエージェント向けUI/UX作業プロンプト

この作業はアプリ本体UI、またはリポジトリが制御する独自UIの変更を含みます。

1. ルート `AGENTS.md` と変更対象に最も近い `AGENTS.md` を読んでください。
2. `.agents/skills/ui-ux-review/SKILL.md` を発動してください。
3. Skillの対象面分類に従い、`02-uiux-review-framework.md`、`03-evidence-and-completion-gates.md`、変更内容に直接関係する詳細正本だけを読んでください。
4. 実装、検証、証跡作成、反証レビューまで完遂してください。

P0が残る場合、必要な前後screenshotを取得できない場合、実施していない検証しか根拠がない場合は、UI/UX作業を完了扱いにしないでください。

## Day Schedule Nextでの対象確認

- [ ] [docs/product-invariants.md](../../product-invariants.md) と [docs/architecture-boundaries.md](../../architecture-boundaries.md) の該当契約を確認した。
- [ ] Today / timeline / Inspector / Compact / Ticket / Template / Focus / Sync / Dataのうち、変更に影響するsurfaceと状態を特定した。
- [ ] 保存精度1分、表示snap、local-first、Google同期、通知、時間・回復の境界をUI copyと証跡で確認する範囲を定めた。
- [ ] GitHub共同作業面だけの変更では、GitHubが所有する未変更のlayout・focus・loadingへ証跡を広げていない。
