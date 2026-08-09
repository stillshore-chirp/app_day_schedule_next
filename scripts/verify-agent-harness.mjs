#!/usr/bin/env node
import fs from "node:fs";
import path from "node:path";
import process from "node:process";

const root = process.cwd();
const errors = [];

const relative = (value) => value.replaceAll(path.sep, "/");
const exists = (file) => fs.existsSync(path.join(root, file));
const read = (file) => fs.readFileSync(path.join(root, file), "utf8");
const byteLength = (text) => Buffer.byteLength(text, "utf8");
const lineCount = (text) => text.replace(/\r\n/g, "\n").split("\n").length;

function fail(message) {
  errors.push(message);
}

function requireFile(file) {
  if (!exists(file)) fail(`required file missing: ${file}`);
}

function requireText(file, expected) {
  if (!exists(file)) return;
  if (!read(file).includes(expected)) fail(`${file}: must contain ${JSON.stringify(expected)}`);
}

function rejectText(file, forbidden) {
  if (!exists(file)) return;
  if (read(file).includes(forbidden)) fail(`${file}: contains retired instruction ${JSON.stringify(forbidden)}`);
}

function maxSize(file, maxLines, maxBytes) {
  if (!exists(file)) return;
  const text = read(file);
  const lines = lineCount(text);
  const bytes = byteLength(text);
  if (lines > maxLines) fail(`${file}: ${lines} lines exceeds ${maxLines}`);
  if (bytes > maxBytes) fail(`${file}: ${bytes} bytes exceeds ${maxBytes}`);
}

function frontmatter(file) {
  if (!exists(file)) return null;
  const lines = read(file).replace(/\r\n/g, "\n").split("\n");
  if (lines[0]?.trim() !== "---") {
    fail(`${file}: frontmatter must start on the first line`);
    return null;
  }
  const end = lines.findIndex((line, index) => index > 0 && line.trim() === "---");
  if (end < 0) {
    fail(`${file}: frontmatter closing delimiter is missing`);
    return null;
  }
  const raw = lines.slice(1, end);
  const keys = [];
  for (const line of raw) {
    const match = /^([A-Za-z][A-Za-z0-9_-]*):/.exec(line);
    if (match) keys.push(match[1]);
  }
  for (const key of new Set(keys)) {
    if (keys.filter((candidate) => candidate === key).length > 1) {
      fail(`${file}: duplicate frontmatter key ${key}`);
    }
  }
  return { lines: raw, text: raw.join("\n") };
}

function scalarValue(data, key) {
  const line = data?.lines.find((candidate) => candidate.startsWith(`${key}:`));
  if (!line) return null;
  return line.slice(key.length + 1).trim().replace(/^["']|["']$/g, "");
}

function validateSkill(file) {
  const data = frontmatter(file);
  if (!data) return;
  const name = scalarValue(data, "name");
  const description = scalarValue(data, "description");
  if (!name || !/^[a-z0-9]+(?:-[a-z0-9]+)*$/.test(name)) {
    fail(`${file}: name must be non-empty lowercase kebab-case`);
  }
  if (!description) fail(`${file}: description must be a non-empty string`);
}

function validateClaudeRule(file) {
  const data = frontmatter(file);
  if (!data) return;
  const pathsIndex = data.lines.findIndex((line) => line.trim() === "paths:");
  if (pathsIndex < 0) {
    fail(`${file}: paths list is required`);
    return;
  }
  let count = 0;
  for (let index = pathsIndex + 1; index < data.lines.length; index += 1) {
    const line = data.lines[index];
    if (/^[A-Za-z][A-Za-z0-9_-]*:/.test(line)) break;
    if (/^\s+-\s+["']?.+/.test(line)) count += 1;
  }
  if (count === 0) fail(`${file}: paths must contain at least one item`);
}

function validateCursorRule(file) {
  const data = frontmatter(file);
  if (!data) return;
  if (!scalarValue(data, "description")) fail(`${file}: description is required`);
  if (!scalarValue(data, "globs")) fail(`${file}: globs is required`);
  if (scalarValue(data, "alwaysApply") !== "false") {
    fail(`${file}: alwaysApply must be the YAML boolean false`);
  }
}

const nestedRules = [
  "apps/desktop/AGENTS.md",
  "apps/desktop/src/AGENTS.md",
  "apps/desktop/src-tauri/AGENTS.md",
  "apps/desktop/tests/AGENTS.md",
  "docs/AGENTS.md",
  ".github/AGENTS.md",
];

const canonicalSkills = [
  ".agents/skills/ui-ux-review/SKILL.md",
  ".agents/skills/calendar-sync-review/SKILL.md",
  ".agents/skills/time-notification-review/SKILL.md",
  ".agents/skills/data-migration-review/SKILL.md",
  ".agents/skills/desktop-release-review/SKILL.md",
  ".agents/skills/github-delivery/SKILL.md",
  ".agents/skills/security-publication/SKILL.md",
];

const claudeRules = [
  ".claude/rules/agent-harness.md",
  ".claude/rules/desktop.md",
  ".claude/rules/documentation.md",
  ".claude/rules/github.md",
];

const claudeSkills = canonicalSkills.map((file) =>
  file.replace(".agents/skills/", ".claude/skills/"),
);

const cursorRules = [
  ".cursor/rules/agent-harness.mdc",
  ".cursor/rules/desktop.mdc",
  ".cursor/rules/documentation.mdc",
  ".cursor/rules/github.mdc",
];

const requiredFiles = [
  "AGENTS.md",
  "CLAUDE.md",
  ...nestedRules,
  ...canonicalSkills,
  ...claudeRules,
  ...claudeSkills,
  ...cursorRules,
  "README.md",
  "UserManual.md",
  "OPERATIONS.md",
  "SECURITY.md",
  "LICENSE",
  "docs/agent-harness.md",
  "docs/agent-principles.md",
  "docs/product-invariants.md",
  "docs/architecture-boundaries.md",
  "docs/technical-contracts.md",
  "docs/documentation-structure.md",
  "docs/security-publication-checklist.md",
  "docs/release-quality-gates.md",
  "docs/engineering/time-and-recurrence.md",
  "docs/engineering/calendar-sync.md",
  "docs/engineering/notifications-and-focus.md",
  "docs/engineering/data-migrations-and-backup.md",
  "docs/engineering/desktop-platform-and-release.md",
  "docs/testing/index.md",
  "docs/ai-governance/00-index.md",
  "docs/ai-governance/glossary.md",
  "docs/ai-governance/01-agent-operating-contract.md",
  "docs/ai-governance/02-uiux-review-framework.md",
  "docs/ai-governance/03-evidence-and-completion-gates.md",
  "docs/ai-governance/04-cognitive-psychology-principles.md",
  "docs/ai-governance/05-accessibility-and-inclusive-design.md",
  "docs/ai-governance/06-visual-hierarchy-and-information-architecture.md",
  "docs/ai-governance/07-ui-copy-and-microcopy.md",
  "docs/ai-governance/08-state-design-and-error-recovery.md",
  "docs/ai-governance/09-ai-agent-review-protocol.md",
  "docs/ai-governance/10-utility-user-goal-and-product-fit.md",
  "docs/ai-governance/11-efficiency-and-expert-use.md",
  "docs/ai-governance/12-satisfaction-trust-and-emotional-ux.md",
  "docs/ai-governance/13-maintenance-policy.md",
  "docs/ai-governance/14-issue-quality-gate.md",
  "docs/ai-governance/15-agent-harness-compatibility.md",
  "docs/ai-governance/references/canonical-sources.md",
  "docs/ai-governance/checklists/accessibility.md",
  "docs/ai-governance/checklists/cognitive-walkthrough.md",
  "docs/ai-governance/checklists/content-stress.md",
  "docs/ai-governance/checklists/efficiency.md",
  "docs/ai-governance/checklists/p0-p1-p2.md",
  "docs/ai-governance/checklists/satisfaction-trust.md",
  "docs/ai-governance/checklists/utility-user-goal.md",
  "docs/ai-governance/checklists/visual-hierarchy.md",
  "docs/ai-governance/templates/agent-task-prompt.md",
  "docs/ai-governance/templates/completion-gate-report.md",
  "docs/ai-governance/templates/counter-review.md",
  "docs/ai-governance/templates/efficiency-review.md",
  "docs/ai-governance/templates/novice-simulation.md",
  "docs/ai-governance/templates/state-matrix.md",
  "docs/ai-governance/templates/trust-satisfaction-review.md",
  "docs/ai-governance/templates/uiux-review-report.md",
  "docs/ai-governance/templates/user-goal-assessment.md",
  ".github/ISSUE_TEMPLATE/bug.md",
  ".github/ISSUE_TEMPLATE/feature.md",
  ".github/ISSUE_TEMPLATE/investigation.md",
  ".github/ISSUE_TEMPLATE/operations.md",
  ".github/ISSUE_TEMPLATE/config.yml",
  ".github/pull_request_template.md",
  ".github/dependabot.yml",
  ".github/workflows/ci.yml",
  ".github/workflows/dependency-audit.yml",
  ".github/workflows/native-e2e.yml",
  "plans/TEMPLATE.md",
  "scripts/verify-agent-harness.mjs",
  "scripts/verify-doc-links.mjs",
  "scripts/security-scan-text.mjs",
  "scripts/check-repository-boundaries.mjs",
  "scripts/verify-i18n-keys.mjs",
  "scripts/verify-workflow-policy.mjs",
  ".editorconfig",
  ".gitattributes",
  ".gitignore",
];

for (const file of requiredFiles) requireFile(file);

maxSize("AGENTS.md", 180, 16 * 1024);
for (const file of nestedRules) {
  maxSize(file, 100, 8 * 1024);
  if (exists("AGENTS.md") && exists(file)) {
    const combined = byteLength(read("AGENTS.md")) + byteLength(read(file));
    if (combined > 24 * 1024) fail(`AGENTS.md + ${file}: ${combined} bytes exceeds 24576`);
  }
}
for (const file of canonicalSkills) maxSize(file, 180, 16 * 1024);
for (const file of [...claudeRules, ...claudeSkills, ...cursorRules]) {
  maxSize(file, 30, 4 * 1024);
}

for (const file of [...canonicalSkills, ...claudeSkills]) validateSkill(file);
for (const file of claudeRules) validateClaudeRule(file);
for (const file of cursorRules) validateCursorRule(file);

if (exists("CLAUDE.md")) {
  const claudeImport = read("CLAUDE.md").replace(/\r/g, "").split("\n").filter((line) => line.trim()).join("\n");
  if (claudeImport !== "@AGENTS.md") fail("CLAUDE.md: must contain only @AGENTS.md");
}

for (const file of claudeRules) {
  requireText(file, "AGENTS.md");
}
for (const file of claudeSkills) {
  requireText(file, ".agents/skills/");
  requireText(file, "唯一の手順正本");
}
for (const file of cursorRules) {
  requireText(file, "AGENTS.md");
}

for (const product of ["Codex", "Claude Code", "Cursor"]) {
  requireText("AGENTS.md", product);
  requireText("docs/agent-harness.md", product);
  requireText("docs/ai-governance/13-maintenance-policy.md", product);
  requireText("docs/ai-governance/15-agent-harness-compatibility.md", product);
}

const rootBridges = [
  "apps/desktop/AGENTS.md",
  "apps/desktop/src/AGENTS.md",
  "apps/desktop/src-tauri/AGENTS.md",
  "apps/desktop/tests/AGENTS.md",
  "docs/AGENTS.md",
  ".github/AGENTS.md",
  "docs/product-invariants.md",
  "docs/architecture-boundaries.md",
  ...canonicalSkills,
];
for (const bridge of rootBridges) requireText("AGENTS.md", bridge);

for (const file of [
  "AGENTS.md",
  "docs/agent-harness.md",
  "docs/ai-governance/13-maintenance-policy.md",
  "docs/ai-governance/15-agent-harness-compatibility.md",
  ".github/pull_request_template.md",
  "docs/ai-governance/templates/completion-gate-report.md",
]) {
  rejectText(file, "codex/<目的>");
  rejectText(file, "Codex 自動コードレビュー");
  rejectText(file, "CI 後の Codex review");
  rejectText(file, "CI後のCodex review");
}

for (const file of ["AGENTS.md", ...claudeRules, ...cursorRules]) {
  for (const sourceResidue of ["apps/frontend", "apps/backend", "Cloud Run", "Firestore"]) {
    rejectText(file, sourceResidue);
  }
}

requireText("docs/agent-harness.md", "Hard gateとheuristic");
requireText("docs/agent-harness.md", "Instruction budget");
requireText("docs/agent-harness.md", "clean review");
requireText("docs/agent-harness.md", "Windows");
requireText("docs/agent-principles.md", "重複回数だけで抽象化を強制しない");
requireText("docs/ai-governance/13-maintenance-policy.md", ".cursor");
requireText("docs/ai-governance/13-maintenance-policy.md", "GitHub共同作業面");
requireText("docs/ai-governance/14-issue-quality-gate.md", "現在と対応後のユーザー体験");
requireText("docs/ai-governance/15-agent-harness-compatibility.md", "alwaysApply: false");

for (const template of [
  ".github/ISSUE_TEMPLATE/feature.md",
  ".github/ISSUE_TEMPLATE/bug.md",
  ".github/ISSUE_TEMPLATE/investigation.md",
  ".github/ISSUE_TEMPLATE/operations.md",
]) {
  requireText(template, "## 現在のユーザー体験");
  requireText(template, "## 対応後に目指すユーザー体験");
  requireText(
    template,
    "根拠区分（該当するものを残す）: ユーザー申告 / 実ユーザー観察 / 観測事実からの推定 / 未確認の仮説",
  );
}

requireText(".agents/skills/github-delivery/SKILL.md", "14-issue-quality-gate.md");
requireText(".agents/skills/ui-ux-review/SKILL.md", "アプリ本体UI");
requireText(".agents/skills/ui-ux-review/SKILL.md", "GitHub共同作業面");
requireText(".agents/skills/ui-ux-review/SKILL.md", "state matrix");
requireText("docs/ai-governance/03-evidence-and-completion-gates.md", "latest meaningful change");
requireText(".github/pull_request_template.md", "対象面:");
requireText(".github/pull_request_template.md", "利用可能な自動・手動review:");

if (errors.length > 0) {
  console.error("Agent harness verification failed:");
  for (const error of errors) console.error(`- ${relative(error)}`);
  process.exit(1);
}

console.log(
  `Agent harness verification passed: ${requiredFiles.length} required files, ` +
    `${canonicalSkills.length} canonical skills, ${claudeRules.length + claudeSkills.length + cursorRules.length} adapters.`,
);
