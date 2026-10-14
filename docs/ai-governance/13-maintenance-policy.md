# ガバナンス保守方針

この文書は、Day Schedule Next の製品ルール、domain Skill、adapter、静的検査の保守範囲を定めます。Codex 共通の作業・配送規則はローカルの Codex `AGENTS.md` を正本とし、repository 内へ複製しません。

## 正本と責務

- 製品共通の hard gate と path bridge: root [`AGENTS.md`](../../AGENTS.md)
- path 固有契約: 対象に最も近い `AGENTS.md`
- 製品 domain の発動条件と専門確認: `.agents/skills/<name>/SKILL.md`
- 製品価値、不変条件、architecture: [`product-invariants.md`](../product-invariants.md)、[`architecture-boundaries.md`](../architecture-boundaries.md)、[`engineering/`](../engineering/)
- UI/UX と GitHub 共同作業面の品質基準: この `docs/ai-governance/` と [`14-issue-quality-gate.md`](14-issue-quality-gate.md)
- 公開安全性: [`security-publication-checklist.md`](../security-publication-checklist.md) と security-publication Skill
- Claude Code / Cursor: `.claude/`、`.cursor/` の tool-specific adapter
- file、参照、budget、workflow contract の静的検査: [`scripts/validate-governance.mjs`](../../scripts/validate-governance.mjs)

## 追加・変更・削除

変更前に対象 file、その直接 consumer、正本、公開範囲、置き換える既存契約を検索します。製品不変条件、同期・時刻・migration・desktop security の既存 hard gate は、Issue の明示 scope と根拠なしに弱めません。

同じ製品基準や詳細な手順を root、Skill、adapter、docs へ重ねて書きません。path routing は `AGENTS.md`、domain 手順は canonical Skill、理由と製品判定基準は docs、決定的な形式検査は既存 validator または workflow test に置きます。adapter は正本への接続に限り、adapter だけへ重要な製品判断を置きません。

削除時は consumer、link、既存検査、代替先を確認します。製品 UI の詳細な checklist と実利用上の証跡は、それぞれの canonical docs / Skill に残します。静的検査は rule discovery、Codex runtime、desktop 挙動の証拠として扱いません。

## 保守確認

rule、Skill、adapter、validator を変更した場合は、Codex root / nearest routing、Claude Code import / path / Skill 接続、Cursor の `alwaysApply: false` routing、link、budget、公開安全性を確認します。Issue template の必須項目は [`.github/AGENTS.md`](../../.github/AGENTS.md) を参照します。

repository の既存確認入口は次のとおりです。

```bash
node scripts/validate-governance.mjs
npm run verify:bootstrap
```

変更範囲に対応する既存検査を選び、実行できない検査と未確認範囲は結果と分けて記録します。workflow の変更は [`docs/testing/index.md`](../testing/index.md) と [`.github/AGENTS.md`](../../.github/AGENTS.md) の契約を維持します。
