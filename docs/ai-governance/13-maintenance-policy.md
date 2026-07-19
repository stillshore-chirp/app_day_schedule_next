# Governance Maintenance Policy

## 1. 正本

- rule origin: `AGENTS.md`。
- detailed principles: `docs/ai-governance/`。
- execution workflow: `.agents/skills/`。
- product contract: `docs/product-invariants.md`。
- tool redirect: `CLAUDE.md` は `@AGENTS.md` のみ。
- scoped implementation rules: subdirectory `AGENTS.md`。

## 2. 重複禁止

同じ長文 rule を AGENTS、Skill、tool-specific file にコピーしません。

- AGENTS: 発動条件、blocker、completion gate。
- Governance docs: rationale / Pass-Fail detail。
- Skills: ordered execution steps / output。
- Scoped AGENTS: local boundary / command。

## 3. 更新時の確認

- user value、accessibility、state、efficiency、trust のバランス。
- calendar sync、time、data recovery、desktop platform の P0 を弱めていないか。
- Pass / Fail が実行可能か。
- evidence に結びつくか。
- AI simulation と real user / platform observation を混同しないか。
- rule conflict / dead link / stale command がないか。
- source repository 固有の Cloud / Python rule が残っていないか。

## 4. P0 格下げ

P0 を P1 / P2 に変える場合は、completion blocker でない理由、new evidence、replacement control を Issue / PR に記載します。都合による格下げは禁止します。

## 5. 研究・標準

優先順位:

1. official specification / platform docs。
2. stable HCI / accessibility standards。
3. cognitive accessibility guidance。
4. relevant current research。
5. single study / trend は hypothesis。

外部資料名だけで rule を追加せず、observation、Pass / Fail、evidence へ変換します。

## 6. 日本語

判断基準と作業指示は日本語を正本とします。file name、standard、code identifier、technical term は英語を許可し、必要に応じて `glossary.md` を更新します。

## 7. Verification

```bash
node scripts/verify-agent-harness.mjs
node scripts/verify-doc-links.mjs
node scripts/security-scan-text.mjs
```

検証できない場合は理由と残リスクを報告します。
