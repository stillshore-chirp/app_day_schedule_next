---
paths:
  - "AGENTS.md"
  - "CLAUDE.md"
  - ".agents/**/*"
  - ".claude/**/*"
  - ".cursor/**/*"
  - "docs/agent-harness.md"
  - "docs/agent-principles.md"
  - "docs/ai-governance/**/*"
  - "scripts/validate-governance.mjs"
  - ".github/ISSUE_TEMPLATE/**/*"
  - ".github/pull_request_template.md"
---

エージェントルール、Skill、adapter、検証scriptを変更する前に、`docs/agent-harness.md` と `docs/ai-governance/13-maintenance-policy.md` を読み、Codex・Claude Code・Cursorの到達性、instruction budget、正本とadapterの分離を確認します。形式・参照・budgetの検証には `scripts/validate-governance.mjs` を使います。
