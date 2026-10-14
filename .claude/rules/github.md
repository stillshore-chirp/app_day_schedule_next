---
paths:
  - ".github/**/*"
  - "scripts/validate-governance.mjs"
  - "scripts/security-scan-text.mjs"
---

GitHub workflow / settings は root `AGENTS.md` と `.github/AGENTS.md` を読みます。Issue / PR本文では [GitHub共同作業面 Skill](../../.agents/skills/github-delivery/SKILL.md)、公開内容では [公開安全性 Skill](../../.agents/skills/security-publication/SKILL.md) を参照します。このruleは正本へ案内するpath routerです。
