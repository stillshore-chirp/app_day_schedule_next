#!/usr/bin/env node
import fs from 'node:fs';
import path from 'node:path';
import process from 'node:process';

const root = process.cwd();
const requiredFiles = [
  'AGENTS.md',
  'CLAUDE.md',
  'README.md',
  'UserManual.md',
  'OPERATIONS.md',
  'SECURITY.md',
  'CONTRIBUTING.md',
  'plans/TEMPLATE.md',
  'apps/desktop/AGENTS.md',
  'apps/desktop/src/AGENTS.md',
  'apps/desktop/src-tauri/AGENTS.md',
  'apps/desktop/tests/AGENTS.md',
  'docs/AGENTS.md',
  '.github/AGENTS.md',
  '.agents/skills/ui-ux-review/SKILL.md',
  '.agents/skills/calendar-sync-review/SKILL.md',
  '.agents/skills/time-notification-review/SKILL.md',
  '.agents/skills/data-migration-review/SKILL.md',
  '.agents/skills/desktop-release-review/SKILL.md',
  'docs/agent-principles.md',
  'docs/documentation-structure.md',
  'docs/security-publication-checklist.md',
  'docs/product-invariants.md',
  'docs/architecture-boundaries.md',
  'docs/release-quality-gates.md',
  'docs/testing/index.md',
  'docs/engineering/calendar-sync.md',
  'docs/engineering/time-and-recurrence.md',
  'docs/engineering/notifications-and-focus.md',
  'docs/engineering/data-migrations-and-backup.md',
  'docs/engineering/desktop-platform-and-release.md',
  'docs/ai-governance/00-index.md',
  'docs/ai-governance/01-agent-operating-contract.md',
  'docs/ai-governance/02-uiux-review-framework.md',
  'docs/ai-governance/03-evidence-and-completion-gates.md',
  'docs/ai-governance/04-cognitive-psychology-principles.md',
  'docs/ai-governance/05-accessibility-and-inclusive-design.md',
  'docs/ai-governance/06-visual-hierarchy-and-information-architecture.md',
  'docs/ai-governance/07-ui-copy-and-microcopy.md',
  'docs/ai-governance/08-state-design-and-error-recovery.md',
  'docs/ai-governance/09-ai-agent-review-protocol.md',
  'docs/ai-governance/10-utility-user-goal-and-product-fit.md',
  'docs/ai-governance/11-efficiency-and-expert-use.md',
  'docs/ai-governance/12-satisfaction-trust-and-emotional-ux.md',
  'docs/ai-governance/13-maintenance-policy.md',
  'docs/ai-governance/glossary.md',
  'docs/ai-governance/references/canonical-sources.md',
  'docs/ai-governance/reports/README.md',
  'docs/ai-governance/templates/agent-task-prompt.md',
  'docs/ai-governance/templates/completion-gate-report.md',
  'docs/ai-governance/templates/counter-review.md',
  'docs/ai-governance/templates/efficiency-review.md',
  'docs/ai-governance/templates/novice-simulation.md',
  'docs/ai-governance/templates/state-matrix.md',
  'docs/ai-governance/templates/trust-satisfaction-review.md',
  'docs/ai-governance/templates/uiux-review-report.md',
  'docs/ai-governance/templates/user-goal-assessment.md',
  'docs/ai-governance/checklists/p0-p1-p2.md',
  'docs/ai-governance/checklists/accessibility.md',
  'docs/ai-governance/checklists/cognitive-walkthrough.md',
  'docs/ai-governance/checklists/content-stress.md',
  'docs/ai-governance/checklists/efficiency.md',
  'docs/ai-governance/checklists/satisfaction-trust.md',
  'docs/ai-governance/checklists/utility-user-goal.md',
  'docs/ai-governance/checklists/visual-hierarchy.md',
  '.github/pull_request_template.md',
  '.github/ISSUE_TEMPLATE/config.yml',
  '.github/ISSUE_TEMPLATE/bug.md',
  '.github/ISSUE_TEMPLATE/feature.md',
  '.github/ISSUE_TEMPLATE/investigation.md',
  '.github/ISSUE_TEMPLATE/operations.md',
  '.github/workflows/ci.yml',
  '.github/workflows/native-e2e.yml',
  '.github/dependabot.yml',
  'scripts/verify-agent-harness.mjs',
  'scripts/verify-doc-links.mjs',
  'scripts/security-scan-text.mjs',
  'scripts/check-repository-boundaries.mjs',
];

const errors = [];
for (const relative of requiredFiles) {
  const absolute = path.join(root, relative);
  if (!fs.existsSync(absolute) || !fs.statSync(absolute).isFile()) {
    errors.push(`missing required file: ${relative}`);
  }
}

const read = (relative) => fs.readFileSync(path.join(root, relative), 'utf8');
if (fs.existsSync(path.join(root, 'CLAUDE.md')) && read('CLAUDE.md').trim() !== '@AGENTS.md') {
  errors.push('CLAUDE.md must contain exactly @AGENTS.md');
}
if (fs.existsSync(path.join(root, '.cursor'))) {
  errors.push('.cursor is not allowed; AGENTS.md is the rule origin');
}

if (fs.existsSync(path.join(root, 'AGENTS.md'))) {
  const agents = read('AGENTS.md');
  const requiredPhrases = [
    'ユーザー価値',
    '熟練者効率',
    '満足感・信頼感',
    '反証レビュー',
    'Issue-first',
    'Google Calendar',
    'nextSyncToken',
    'SQLite',
    'DST',
    'スリープ',
    'CI',
    'review thread',
    'Remaining risks',
  ];
  for (const phrase of requiredPhrases) {
    if (!agents.includes(phrase)) errors.push(`AGENTS.md missing required contract phrase: ${phrase}`);
  }
}

const skillPaths = requiredFiles.filter((file) => file.startsWith('.agents/skills/') && file.endsWith('/SKILL.md'));
const seenSkillNames = new Set();
for (const relative of skillPaths) {
  if (!fs.existsSync(path.join(root, relative))) continue;
  const text = read(relative);
  const frontmatter = text.match(/^---\n([\s\S]*?)\n---\n/);
  if (!frontmatter) {
    errors.push(`${relative} is missing YAML frontmatter`);
    continue;
  }
  const name = frontmatter[1].match(/^name:\s*([^\n]+)$/m)?.[1]?.trim();
  const description = frontmatter[1].match(/^description:\s*([^\n]+)$/m)?.[1]?.trim();
  if (!name) errors.push(`${relative} is missing frontmatter name`);
  if (!description) errors.push(`${relative} is missing frontmatter description`);
  if (name && seenSkillNames.has(name)) errors.push(`duplicate skill name: ${name}`);
  if (name) seenSkillNames.add(name);
  if (!/^#\s+/m.test(text.replace(frontmatter[0], ''))) errors.push(`${relative} is missing a Markdown title`);
}

const scopedAgents = [
  'apps/desktop/AGENTS.md',
  'apps/desktop/src/AGENTS.md',
  'apps/desktop/src-tauri/AGENTS.md',
  'apps/desktop/tests/AGENTS.md',
  'docs/AGENTS.md',
  '.github/AGENTS.md',
];
for (const relative of scopedAgents) {
  if (!fs.existsSync(path.join(root, relative))) continue;
  const text = read(relative);
  if (!text.includes('AGENTS.md')) errors.push(`${relative} must link to or explicitly inherit the root AGENTS.md`);
}

const stalePatterns = [
  /wordpack-for-english/i,
  /Firestore/,
  /Cloud Run/,
  /apps\/frontend/,
  /apps\/backend/,
];
for (const relative of ['AGENTS.md', ...skillPaths]) {
  if (!fs.existsSync(path.join(root, relative))) continue;
  const text = read(relative);
  for (const pattern of stalePatterns) {
    if (pattern.test(text)) errors.push(`${relative} contains source-project-specific residue: ${pattern}`);
  }
}

if (errors.length > 0) {
  console.error('Agent harness verification failed:');
  for (const error of errors) console.error(`- ${error}`);
  process.exit(1);
}

console.log(`Agent harness verification passed: ${requiredFiles.length} required files, ${skillPaths.length} skills.`);
