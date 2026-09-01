#!/usr/bin/env node
import fs from "node:fs";
import path from "node:path";
import process from "node:process";
import { fileURLToPath } from "node:url";

const SCRIPT_DIR = path.dirname(fileURLToPath(import.meta.url));
export const DEFAULT_ROOT = path.resolve(SCRIPT_DIR, "..");

export const LIMITS = Object.freeze({
  root: Object.freeze({ lines: 180, bytes: 16 * 1024 }),
  nested: Object.freeze({ lines: 100, bytes: 8 * 1024 }),
  skill: Object.freeze({ lines: 180, bytes: 16 * 1024 }),
  adapter: Object.freeze({ lines: 30, bytes: 4 * 1024 }),
});
export const COMBINED_ROUTER_BYTES = 24 * 1024;

export const WORKFLOW_PATHS = Object.freeze([
  ".github/workflows/ci.yml",
  ".github/workflows/dependency-audit.yml",
  ".github/workflows/native-e2e.yml",
]);

export const NESTED_RULES = Object.freeze([
  "apps/desktop/AGENTS.md",
  "apps/desktop/src/AGENTS.md",
  "apps/desktop/src-tauri/AGENTS.md",
  "apps/desktop/tests/AGENTS.md",
  "docs/AGENTS.md",
  ".github/AGENTS.md",
]);

export const CANONICAL_SKILLS = Object.freeze([
  ".agents/skills/ui-ux-review/SKILL.md",
  ".agents/skills/calendar-sync-review/SKILL.md",
  ".agents/skills/time-notification-review/SKILL.md",
  ".agents/skills/data-migration-review/SKILL.md",
  ".agents/skills/desktop-release-review/SKILL.md",
  ".agents/skills/github-delivery/SKILL.md",
  ".agents/skills/security-publication/SKILL.md",
]);

export const CLAUDE_RULES = Object.freeze([
  ".claude/rules/agent-harness.md",
  ".claude/rules/desktop.md",
  ".claude/rules/documentation.md",
  ".claude/rules/github.md",
]);

export const CLAUDE_SKILLS = Object.freeze(
  CANONICAL_SKILLS.map((file) => file.replace(".agents/skills/", ".claude/skills/")),
);

export const CURSOR_RULES = Object.freeze([
  ".cursor/rules/agent-harness.mdc",
  ".cursor/rules/desktop.mdc",
  ".cursor/rules/documentation.mdc",
  ".cursor/rules/github.mdc",
]);

export const TASK_STATE_TEMPLATE = "docs/ai-governance/templates/task-state.json";
export const TASK_STATE_SCHEMA = "task-state/v1";
export const TASK_STATE_STATUSES = Object.freeze(
  new Set(["planned", "running", "partial", "blocked", "complete"]),
);
export const TASK_STATE_RESULTS = Object.freeze(
  new Set(["pass", "fail", "partial", "unverified"]),
);
export const TASK_STATE_LIMITS = Object.freeze({
  bytes: 16 * 1024,
  items: 50,
  string: 1000,
  summary: 500,
});

const REQUIRED_FILES = Object.freeze([
  "AGENTS.md",
  "CLAUDE.md",
  ...NESTED_RULES,
  ...CANONICAL_SKILLS,
  ...CLAUDE_RULES,
  ...CLAUDE_SKILLS,
  ...CURSOR_RULES,
  "README.md",
  "UserManual.md",
  "OPERATIONS.md",
  "SECURITY.md",
  "LICENSE",
  "docs/agent-harness.md",
  "docs/agent-principles.md",
  "docs/product-invariants.md",
  "docs/architecture-boundaries.md",
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
  TASK_STATE_TEMPLATE,
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
  ...WORKFLOW_PATHS,
  ".editorconfig",
  ".gitattributes",
  ".gitignore",
  "package.json",
  "scripts/validate-governance.mjs",
  "scripts/validate-governance.test.mjs",
  "scripts/verify-doc-links.mjs",
  "scripts/security-scan-text.mjs",
  "scripts/check-repository-boundaries.mjs",
  "scripts/verify-i18n-keys.mjs",
  "scripts/verify-patched-dependencies.mjs",
  "scripts/classify-verification-inputs.mjs",
  "scripts/classify-verification-inputs.test.mjs",
]);

const SKILL_NAME = /^[a-z0-9]+(?:-[a-z0-9]+)*$/;
const MARKER_CONTRACTS = Object.freeze([
  ["docs/agent-harness.md", "DSN-COMPREHENSIVE-REVIEW-ROUNDS"],
  ["docs/ai-governance/13-maintenance-policy.md", "DSN-WORDPACK-OVERLAY"],
  ["docs/testing/index.md", "DSN-RISK-BASED-DELIVERY"],
  ["docs/engineering/desktop-platform-and-release.md", "DSN-LATEST-APP-HANDOFF"],
]);

export class GovernanceError extends Error {
  constructor(message) {
    super(message);
    this.name = "GovernanceError";
  }
}

function fail(message) {
  throw new GovernanceError(message);
}

function normalize(value) {
  return value.replace(/\r\n?/g, "\n");
}

function rel(file, root) {
  return path.relative(root, file).split(path.sep).join("/") || ".";
}

function resolveInside(root, value) {
  const resolvedRoot = path.resolve(root);
  const candidate = path.resolve(resolvedRoot, value);
  const relativeCandidate = path.relative(resolvedRoot, candidate);
  if (relativeCandidate === ".." || relativeCandidate.startsWith(`..${path.sep}`) || path.isAbsolute(relativeCandidate)) {
    fail(`path escapes repository: ${value}`);
  }
  return candidate;
}

function readText(file) {
  try {
    return fs.readFileSync(file, "utf8");
  } catch (error) {
    fail(`cannot read ${file}: ${error instanceof Error ? error.message : String(error)}`);
  }
}

function isFile(file) {
  try {
    return fs.statSync(file).isFile();
  } catch {
    return false;
  }
}

function isDirectory(directory) {
  try {
    return fs.statSync(directory).isDirectory();
  } catch {
    return false;
  }
}

function walkFiles(directory, { extensions = null, skip = new Set() } = {}) {
  if (!isDirectory(directory)) return [];
  const result = [];
  const visit = (current) => {
    let entries;
    try {
      entries = fs.readdirSync(current, { withFileTypes: true });
    } catch (error) {
      fail(`cannot list ${current}: ${error instanceof Error ? error.message : String(error)}`);
    }
    for (const entry of entries) {
      if (skip.has(entry.name)) continue;
      const candidate = path.join(current, entry.name);
      if (entry.isDirectory()) {
        visit(candidate);
      } else if (entry.isFile() && (!extensions || extensions.has(path.extname(entry.name).toLowerCase()))) {
        result.push(candidate);
      }
    }
  };
  visit(directory);
  return result.sort();
}

function lineCount(text) {
  return normalize(text).split("\n").length;
}

function checkBudget(file, kind, root) {
  if (!isFile(file)) return;
  const raw = fs.readFileSync(file);
  const text = raw.toString("utf8");
  const limit = LIMITS[kind];
  if (lineCount(text) > limit.lines) {
    fail(`${rel(file, root)} exceeds ${limit.lines} lines`);
  }
  if (raw.byteLength > limit.bytes) {
    fail(`${rel(file, root)} exceeds ${limit.bytes} bytes`);
  }
}

function parseQuotedString(value, label) {
  if (value.startsWith('"')) {
    if (!value.endsWith('"')) fail(`${label}: unterminated double-quoted scalar`);
    try {
      const parsed = JSON.parse(value);
      if (typeof parsed !== "string") fail(`${label}: expected a string scalar`);
      return parsed;
    } catch (error) {
      fail(`${label}: invalid double-quoted scalar (${error instanceof Error ? error.message : String(error)})`);
    }
  }
  if (value.startsWith("'")) {
    if (!value.endsWith("'")) fail(`${label}: unterminated single-quoted scalar`);
    return value.slice(1, -1).replaceAll("''", "'");
  }
  return null;
}

function splitInlineSequence(value) {
  const items = [];
  let start = 1;
  let quote = null;
  let depth = 0;
  for (let index = 1; index < value.length - 1; index += 1) {
    const character = value[index];
    if (quote) {
      if (character === quote && value[index - 1] !== "\\") quote = null;
      continue;
    }
    if (character === '"' || character === "'") {
      quote = character;
    } else if (character === "[" || character === "{") {
      depth += 1;
    } else if (character === "]" || character === "}") {
      depth -= 1;
    } else if (character === "," && depth === 0) {
      items.push(value.slice(start, index).trim());
      start = index + 1;
    }
  }
  const tail = value.slice(start, -1).trim();
  if (tail || items.length > 0) items.push(tail);
  return items;
}

function parseScalar(raw, label) {
  const value = raw.trim();
  if (!value) return null;
  const quoted = parseQuotedString(value, label);
  if (quoted !== null) return quoted;
  if (value === "true") return true;
  if (value === "false") return false;
  if (value === "null" || value === "~") return null;
  if (/^[+-]?(?:0|[1-9]\d*)(?:\.\d+)?$/.test(value)) return Number(value);
  if (value.startsWith("[") && value.endsWith("]")) {
    return splitInlineSequence(value).map((item, index) => parseScalar(item, `${label}[${index}]`));
  }
  if (value.startsWith("{") && value.endsWith("}")) return {};
  return value;
}

function indentation(line) {
  const match = /^( *)/.exec(line);
  return match ? match[1].length : 0;
}

function parseBlockValue(lines, start, parentIndent, label) {
  const children = [];
  let index = start;
  while (index < lines.length) {
    const line = lines[index];
    if (!line.trim()) {
      children.push(line);
      index += 1;
      continue;
    }
    if (indentation(line) <= parentIndent) break;
    children.push(line);
    index += 1;
  }
  const meaningful = children.filter((line) => line.trim());
  if (meaningful.length === 0) return { value: null, next: index };
  if (meaningful.every((line) => /^\s*-\s+/.test(line))) {
    return {
      value: meaningful.map((line, itemIndex) =>
        parseScalar(/^\s*-\s+(.*)$/.exec(line)[1], `${label}[${itemIndex}]`),
      ),
      next: index,
    };
  }
  const object = {};
  for (const line of meaningful) {
    const match = /^\s*([A-Za-z][A-Za-z0-9_-]*):(?:[ \t]*(.*))?$/.exec(line);
    if (!match) fail(`${label}: unsupported nested frontmatter value`);
    if (Object.hasOwn(object, match[1])) fail(`${label}: duplicate frontmatter key ${match[1]}`);
    object[match[1]] = parseScalar(match[2] ?? "", `${label}.${match[1]}`);
  }
  return { value: object, next: index };
}

/** Parse the small, YAML-compatible frontmatter subset used by the adapters. */
export function parseFrontmatter(source, label = "frontmatter") {
  const lines = normalize(source).split("\n");
  if (lines[0]?.trim() !== "---") fail(`${label}: frontmatter must start on the first line`);
  const end = lines.findIndex((line, index) => index > 0 && ["---", "..."].includes(line.trim()));
  if (end < 0) fail(`${label}: frontmatter closing delimiter is missing`);
  const data = {};
  for (let index = 1; index < end; index += 1) {
    const line = lines[index];
    if (!line.trim() || line.trim().startsWith("#")) continue;
    if (line.includes("\t")) fail(`${label}: tabs are not valid frontmatter indentation`);
    const match = /^([A-Za-z][A-Za-z0-9_-]*):(?:[ \t]*(.*))?$/.exec(line);
    if (!match) fail(`${label}: invalid frontmatter mapping at line ${index + 1}`);
    const key = match[1];
    if (Object.hasOwn(data, key)) fail(`${label}: duplicate frontmatter key ${key}`);
    const rawValue = match[2] ?? "";
    if (rawValue === "|" || rawValue === ">") {
      const block = parseBlockValue(lines, index + 1, 0, `${label}.${key}`);
      const content = block.value === null ? "" : block.value;
      if (typeof content !== "string") fail(`${label}.${key}: block scalar must be a string`);
      data[key] = content;
      index = block.next - 1;
    } else if (!rawValue.trim()) {
      const block = parseBlockValue(lines, index + 1, 0, `${label}.${key}`);
      data[key] = block.value;
      index = block.next - 1;
    } else {
      data[key] = parseScalar(rawValue, `${label}.${key}`);
    }
  }
  return data;
}

function nonEmptyString(value, label, max = TASK_STATE_LIMITS.string) {
  if (typeof value !== "string" || !value.trim()) fail(`${label} must be a non-empty string`);
  if (value.length > max) fail(`${label} exceeds ${max} characters`);
}

function stringList(value, label, { required = false } = {}) {
  if (!Array.isArray(value) || (required && value.length === 0)) {
    fail(`${label} must be a${required ? " non-empty" : ""} string list`);
  }
  if (value.length > TASK_STATE_LIMITS.items) fail(`${label} exceeds ${TASK_STATE_LIMITS.items} items`);
  value.forEach((item, index) => nonEmptyString(item, `${label}[${index}]`));
}

function exactObject(value, keys, label) {
  if (!value || typeof value !== "object" || Array.isArray(value)) fail(`${label} must be an object`);
  const actual = Object.keys(value);
  const expected = new Set(keys);
  const missing = keys.filter((key) => !Object.hasOwn(value, key));
  const unknown = actual.filter((key) => !expected.has(key));
  if (missing.length || unknown.length) {
    fail(`${label} keys invalid: missing=${missing.join(",")} unknown=${unknown.join(",")}`);
  }
}

function canonicalTaskPath(value) {
  if (typeof value !== "string" || value !== value.trim() || value.startsWith("/") || value.includes("\\")) return null;
  const parts = value.split("/");
  if (!value || parts.some((part) => !part || part === "." || part === "..")) return null;
  return value;
}

function globToRegExp(pattern) {
  let expression = "^";
  for (let index = 0; index < pattern.length; index += 1) {
    const character = pattern[index];
    if (character === "*") {
      expression += pattern[index + 1] === "*" ? ".*" : "[^/]*";
      if (pattern[index + 1] === "*") index += 1;
    } else if (character === "?") {
      expression += "[^/]";
    } else if (character === "[") {
      const end = pattern.indexOf("]", index + 1);
      if (end < 0) expression += "\\[";
      else {
        const content = pattern.slice(index + 1, end);
        expression += `[${content.replaceAll("\\", "\\\\")}]`;
        index = end;
      }
    } else {
      expression += character.replace(/[\\^$+{}()|.]/g, "\\$&");
    }
  }
  return new RegExp(`${expression}$`);
}

export function taskPathsOverlap(left, right) {
  const leftPath = canonicalTaskPath(left);
  const rightPath = canonicalTaskPath(right);
  if (!leftPath || !rightPath) return true;
  const magic = /[*?[]/;
  const leftGlob = magic.test(leftPath);
  const rightGlob = magic.test(rightPath);
  if (leftGlob && rightGlob) return true;
  if (!leftGlob && !rightGlob) return leftPath === rightPath;
  return leftGlob ? globToRegExp(leftPath).test(rightPath) : globToRegExp(rightPath).test(leftPath);
}

function validateTaskStateShape(state, label) {
  exactObject(
    state,
    [
      "schema",
      "status",
      "goal",
      "acceptance",
      "snapshot",
      "lane",
      "completed_evidence",
      "input_closure",
      "invalidated_gates",
      "remaining_work",
      "risks_blockers",
      "measurement",
      "publication",
    ].filter((key) => Object.hasOwn(state, key) || !["measurement", "publication"].includes(key)),
    label,
  );
  nonEmptyString(state.schema, `${label}.schema`);
  nonEmptyString(state.status, `${label}.status`);
  nonEmptyString(state.goal, `${label}.goal`);
  stringList(state.acceptance, `${label}.acceptance`, { required: true });

  exactObject(state.snapshot, ["base", "head", "phase"], `${label}.snapshot`);
  for (const key of ["base", "head", "phase"]) nonEmptyString(state.snapshot[key], `${label}.snapshot.${key}`);
  exactObject(state.lane, ["id", "owner", "owned_paths"], `${label}.lane`);
  nonEmptyString(state.lane.id, `${label}.lane.id`);
  nonEmptyString(state.lane.owner, `${label}.lane.owner`);
  stringList(state.lane.owned_paths, `${label}.lane.owned_paths`);

  if (!Array.isArray(state.completed_evidence)) fail(`${label}.completed_evidence must be a list`);
  if (state.completed_evidence.length > TASK_STATE_LIMITS.items) fail(`${label}.completed_evidence exceeds item bound`);
  state.completed_evidence.forEach((entry, index) => {
    const entryLabel = `${label}.completed_evidence[${index}]`;
    exactObject(entry, ["gate", "summary", "result", "artifact_reference"], entryLabel);
    nonEmptyString(entry.gate, `${entryLabel}.gate`);
    nonEmptyString(entry.summary, `${entryLabel}.summary`, TASK_STATE_LIMITS.summary);
    nonEmptyString(entry.result, `${entryLabel}.result`);
    if (entry.artifact_reference !== null) nonEmptyString(entry.artifact_reference, `${entryLabel}.artifact_reference`);
  });

  exactObject(state.input_closure, ["paths", "config", "artifacts", "conditions"], `${label}.input_closure`);
  for (const key of ["paths", "config", "artifacts", "conditions"]) stringList(state.input_closure[key], `${label}.input_closure.${key}`);

  if (!Array.isArray(state.invalidated_gates)) fail(`${label}.invalidated_gates must be a list`);
  if (state.invalidated_gates.length > TASK_STATE_LIMITS.items) fail(`${label}.invalidated_gates exceeds item bound`);
  state.invalidated_gates.forEach((entry, index) => {
    const entryLabel = `${label}.invalidated_gates[${index}]`;
    exactObject(entry, ["gate", "reason", "reacquire_scope"], entryLabel);
    nonEmptyString(entry.gate, `${entryLabel}.gate`);
    nonEmptyString(entry.reason, `${entryLabel}.reason`);
    stringList(entry.reacquire_scope, `${entryLabel}.reacquire_scope`, { required: true });
  });
  stringList(state.remaining_work, `${label}.remaining_work`);
  exactObject(state.risks_blockers, ["risks", "blockers"], `${label}.risks_blockers`);
  stringList(state.risks_blockers.risks, `${label}.risks_blockers.risks`);
  stringList(state.risks_blockers.blockers, `${label}.risks_blockers.blockers`);

  for (const [key, childKeys, listKey] of [
    ["measurement", ["gate", "input_paths"], "input_paths"],
    ["publication", ["gate", "annotation_paths"], "annotation_paths"],
  ]) {
    if (!Object.hasOwn(state, key)) continue;
    exactObject(state[key], childKeys, `${label}.${key}`);
    nonEmptyString(state[key].gate, `${label}.${key}.gate`);
    stringList(state[key][listKey], `${label}.${key}.${listKey}`, { required: true });
  }
}

export function validateTaskStateDocument(state, label = "task-state") {
  if (!state || typeof state !== "object" || Array.isArray(state)) fail(`${label} must be an object`);
  validateTaskStateShape(state, label);
  if (state.schema !== TASK_STATE_SCHEMA) fail(`${label}.schema must be ${TASK_STATE_SCHEMA}`);
  if (!TASK_STATE_STATUSES.has(state.status)) fail(`${label}.status is unknown`);
  for (const entry of state.completed_evidence) {
    if (!TASK_STATE_RESULTS.has(entry.result)) fail(`${label}: unknown evidence result ${entry.result}`);
  }
  if (state.measurement && state.publication) {
    for (const measurementPath of state.measurement.input_paths) {
      for (const annotationPath of state.publication.annotation_paths) {
        if (taskPathsOverlap(measurementPath, annotationPath)) {
          fail(`${label}: measurement/publication paths overlap (${measurementPath}, ${annotationPath})`);
        }
      }
    }
  }
  if (state.completed_evidence.length > 0) {
    if (state.input_closure.paths.length === 0 || state.input_closure.conditions.length === 0) {
      fail(`${label}: completed evidence requires input closure paths and conditions`);
    }
    for (const entry of state.completed_evidence) {
      if (entry.artifact_reference !== null && !state.input_closure.artifacts.includes(entry.artifact_reference)) {
        fail(`${label}: evidence artifact is outside input closure (${entry.artifact_reference})`);
      }
    }
  }
  const completed = new Set(state.completed_evidence.map((entry) => entry.gate));
  for (const entry of state.invalidated_gates) {
    if (completed.has(entry.gate)) fail(`${label}: a gate cannot be both completed and invalidated (${entry.gate})`);
  }
  if (["planned", "running", "partial"].includes(state.status) && state.remaining_work.length === 0) {
    fail(`${label}: active state requires remaining_work`);
  }
  if (state.status === "complete") {
    if (state.remaining_work.length || state.invalidated_gates.length || state.risks_blockers.blockers.length) {
      fail(`${label}: complete state must have no remaining work, invalidations, or blockers`);
    }
    if (state.completed_evidence.length === 0 || state.completed_evidence.some((entry) => entry.result !== "pass")) {
      fail(`${label}: complete state requires passing evidence`);
    }
  }
  if (state.status === "blocked" && state.risks_blockers.blockers.length === 0) {
    fail(`${label}: blocked state requires a blocker`);
  }
  return state;
}

export function validateTaskStateFile(file, root = path.dirname(file)) {
  const raw = fs.readFileSync(file);
  if (raw.byteLength > TASK_STATE_LIMITS.bytes) fail(`${rel(file, root)} task-state exceeds ${TASK_STATE_LIMITS.bytes} bytes`);
  let state;
  try {
    state = JSON.parse(raw.toString("utf8"));
  } catch (error) {
    fail(`${rel(file, root)} task-state is not valid JSON: ${error instanceof Error ? error.message : String(error)}`);
  }
  return validateTaskStateDocument(state, rel(file, root));
}

function validateSkillFrontmatter(file, root) {
  const data = parseFrontmatter(readText(file), rel(file, root));
  nonEmptyString(data.name, `${rel(file, root)}.name`);
  nonEmptyString(data.description, `${rel(file, root)}.description`);
  if (!SKILL_NAME.test(data.name)) fail(`${rel(file, root)}.name must be lowercase kebab-case`);
  if (data.name !== path.basename(path.dirname(file))) {
    fail(`${rel(file, root)}.name must match its parent directory`);
  }
  return data;
}

function validateClaudeRuleFrontmatter(file, root) {
  const data = parseFrontmatter(readText(file), rel(file, root));
  stringList(data.paths, `${rel(file, root)}.paths`, { required: true });
  return data;
}

function validateCursorRuleFrontmatter(file, root) {
  const data = parseFrontmatter(readText(file), rel(file, root));
  nonEmptyString(data.description, `${rel(file, root)}.description`);
  if (typeof data.globs === "string") nonEmptyString(data.globs, `${rel(file, root)}.globs`);
  else stringList(data.globs, `${rel(file, root)}.globs`, { required: true });
  if (data.alwaysApply !== false) fail(`${rel(file, root)}.alwaysApply must be boolean false`);
  return data;
}

function directSkillFiles(root, directory) {
  const base = path.join(root, directory);
  if (!isDirectory(base)) return [];
  return fs.readdirSync(base, { withFileTypes: true })
    .filter((entry) => entry.isDirectory())
    .map((entry) => path.join(base, entry.name, "SKILL.md"))
    .filter(isFile)
    .sort();
}

export function collectSkillIdentities(files, root, kind = "Skill") {
  const identities = new Map();
  for (const file of files) {
    const data = validateSkillFrontmatter(file, root);
    if (identities.has(data.name)) {
      fail(`duplicate ${kind} identity: ${data.name}`);
    }
    identities.set(data.name, file);
  }
  return identities;
}

function decodeMarkdownTarget(target, label) {
  try {
    return decodeURIComponent(target);
  } catch (error) {
    fail(`${label}: invalid URL encoding (${target})`);
  }
}

function maskHtmlComments(source) {
  let output = "";
  let index = 0;
  let inComment = false;
  while (index < source.length) {
    if (!inComment && source.startsWith("<!--", index)) {
      inComment = true;
      output += "    ";
      index += 4;
    } else if (inComment && source.startsWith("-->", index)) {
      inComment = false;
      output += "   ";
      index += 3;
    } else if (inComment) {
      output += source[index] === "\n" ? "\n" : " ";
      index += 1;
    } else {
      output += source[index];
      index += 1;
    }
  }
  return output;
}

function maskCodeSpans(source) {
  const output = source.split("");
  for (let index = 0; index < source.length; index += 1) {
    if (source[index] !== "`") continue;
    let length = 1;
    while (source[index + length] === "`") length += 1;
    const marker = "`".repeat(length);
    const end = source.indexOf(marker, index + length);
    if (end < 0) {
      index += length - 1;
      continue;
    }
    for (let position = index; position < end + length; position += 1) output[position] = " ";
    index = end + length - 1;
  }
  return output.join("");
}

function renderedSource(source) {
  const lines = maskHtmlComments(normalize(source)).split("\n");
  const result = [];
  let fence = null;
  for (const line of lines) {
    const fenceMatch = /^ {0,3}(`{3,}|~{3,})/.exec(line);
    if (fence) {
      if (fenceMatch && fenceMatch[1][0] === fence.character && fenceMatch[1].length >= fence.length) fence = null;
      result.push("");
      continue;
    }
    if (fenceMatch) {
      fence = { character: fenceMatch[1][0], length: fenceMatch[1].length };
      result.push("");
      continue;
    }
    if (/^(?: {4}|\t)/.test(line)) {
      result.push("");
      continue;
    }
    result.push(line);
  }
  return maskCodeSpans(result.join("\n"));
}

function findClosingBracket(source, start) {
  let depth = 0;
  for (let index = start; index < source.length; index += 1) {
    if (source[index] === "\\") {
      index += 1;
      continue;
    }
    if (source[index] === "[") depth += 1;
    if (source[index] === "]") {
      if (depth === 0) return index;
      depth -= 1;
    }
  }
  return -1;
}

function findClosingParenthesis(source, start) {
  let depth = 0;
  for (let index = start; index < source.length; index += 1) {
    if (source[index] === "\\") {
      index += 1;
      continue;
    }
    if (source[index] === "(") depth += 1;
    if (source[index] === ")") {
      if (depth === 0) return index;
      depth -= 1;
    }
  }
  return -1;
}

function markdownDestination(body) {
  const value = body.trim();
  if (!value) return null;
  if (value.startsWith("<")) {
    const end = value.indexOf(">");
    return end < 0 ? null : value.slice(1, end);
  }
  let depth = 0;
  for (let index = 0; index < value.length; index += 1) {
    if (value[index] === "\\") {
      index += 1;
      continue;
    }
    if (value[index] === "(") depth += 1;
    else if (value[index] === ")" && depth > 0) depth -= 1;
    else if (/\s/.test(value[index]) && depth === 0) return value.slice(0, index);
  }
  return value;
}

function referenceDefinitions(source) {
  const definitions = new Map();
  for (const line of source.split("\n")) {
    const match = /^ {0,3}\[([^\]]+)\]:\s*(?:<([^>]+)>|(\S+))/.exec(line);
    if (match) definitions.set(match[1].trim().toLowerCase(), match[2] ?? match[3]);
  }
  return definitions;
}

/** Return links emitted by Markdown rendering; images can be excluded. */
export function renderedMarkdownLinks(source, { includeImages = false } = {}) {
  const visible = renderedSource(source);
  const definitions = referenceDefinitions(visible);
  const links = [];
  for (let index = 0; index < visible.length; index += 1) {
    const image = visible[index] === "!" && visible[index + 1] === "[";
    if (visible[index] !== "[" && !image) continue;
    const bracketStart = image ? index + 1 : index;
    const bracketEnd = findClosingBracket(visible, bracketStart + 1);
    if (bracketEnd < 0) continue;
    let target = null;
    let end = bracketEnd;
    if (visible[bracketEnd + 1] === "(") {
      const parenthesisEnd = findClosingParenthesis(visible, bracketEnd + 2);
      if (parenthesisEnd < 0) continue;
      target = markdownDestination(visible.slice(bracketEnd + 2, parenthesisEnd));
      end = parenthesisEnd;
    } else if (visible[bracketEnd + 1] === "[") {
      const referenceEnd = findClosingBracket(visible, bracketEnd + 2);
      if (referenceEnd < 0) continue;
      const reference = visible.slice(bracketEnd + 2, referenceEnd) || visible.slice(bracketStart + 1, bracketEnd);
      target = definitions.get(reference.trim().toLowerCase()) ?? null;
      end = referenceEnd;
    } else if (!image) {
      target = definitions.get(visible.slice(bracketStart + 1, bracketEnd).trim().toLowerCase()) ?? null;
    }
    if (target && (!image || includeImages)) links.push({ target, image });
    index = end;
  }
  return links;
}

export const extractMarkdownLinks = renderedMarkdownLinks;

function localMarkdownTarget(file, target, root) {
  const value = decodeMarkdownTarget(target.trim(), rel(file, root));
  if (!value || value.startsWith("#")) return null;
  if (/^(?:[a-z][a-z0-9+.-]*:|\/\/)/i.test(value)) return null;
  const pathPart = value.split(/[?#]/, 1)[0];
  if (!pathPart) return null;
  const candidate = pathPart.startsWith("/")
    ? resolveInside(root, pathPart.slice(1))
    : resolveInside(root, path.join(path.dirname(file), pathPart));
  return candidate;
}

function validateLocalLinks(files, root) {
  const pending = [...files];
  const visited = new Set();
  while (pending.length) {
    const file = pending.pop();
    if (visited.has(file) || !isFile(file)) continue;
    visited.add(file);
    const links = renderedMarkdownLinks(readText(file), { includeImages: true });
    for (const link of links) {
      const target = localMarkdownTarget(file, link.target, root);
      if (!target) continue;
      if (!fs.existsSync(target)) fail(`${rel(file, root)} has a broken local link: ${rel(target, root)}`);
      if (isFile(target) && /\.(?:md|mdc|markdown)$/i.test(target)) pending.push(target);
    }
  }
}

function validateAdapterLinks(canonical, adapters, root) {
  const canonicalByName = new Map(canonical);
  for (const [name, adapter] of adapters) {
    const expected = canonicalByName.get(name);
    if (!expected) continue;
    const links = renderedMarkdownLinks(readText(adapter), { includeImages: false });
    const matched = links.some((link) => {
      const target = localMarkdownTarget(adapter, link.target, root);
      return target && path.resolve(target) === path.resolve(expected);
    });
    if (!matched) fail(`${rel(adapter, root)} must render a link to ${rel(expected, root)}`);
  }
}

function validateRouterLinks(canonical, routers, root) {
  const targets = new Set();
  for (const router of routers) {
    for (const link of renderedMarkdownLinks(readText(router), { includeImages: false })) {
      const target = localMarkdownTarget(router, link.target, root);
      if (target) targets.add(path.resolve(target));
    }
  }
  for (const [, skill] of canonical) {
    if (!targets.has(path.resolve(skill))) fail(`an AGENTS.md must render a link to ${rel(skill, root)}`);
  }
}

function workflowLines(source) {
  return normalize(source).split("\n");
}

function topLevelSection(source, key) {
  const lines = workflowLines(source);
  const start = lines.findIndex((line) => new RegExp(`^${key}:\\s*(?:#.*)?$`).test(line));
  if (start < 0) return [];
  const result = [lines[start]];
  for (let index = start + 1; index < lines.length; index += 1) {
    if (/^[^ \t#][^:]*:\s*/.test(lines[index])) break;
    result.push(lines[index]);
  }
  return result;
}

function sectionHasKey(lines, key, indent = null) {
  const expression = indent === null
    ? new RegExp(`^\\s*${key}:\\s*`)
    : new RegExp(`^ {${indent}}${key}:\\s*`);
  return lines.some((line) => expression.test(line));
}

function sectionValue(lines, key, indent = null) {
  const expression = indent === null
    ? new RegExp(`^\\s*${key}:\\s*(.*)$`)
    : new RegExp(`^ {${indent}}${key}:\\s*(.*)$`);
  const line = lines.find((candidate) => expression.test(candidate));
  return line ? expression.exec(line)[1].trim().replace(/^['"]|['"]$/g, "") : null;
}

function triggerKeys(source) {
  const section = topLevelSection(source, "on");
  return new Set(section
    .map((line) => /^ {2}([A-Za-z_][A-Za-z0-9_-]*):/.exec(line)?.[1])
    .filter(Boolean));
}

function jobSection(source, job) {
  const lines = workflowLines(source);
  const start = lines.findIndex((line) => new RegExp(`^ {2}${job}:\\s*$`).test(line));
  if (start < 0) return [];
  const result = [lines[start]];
  for (let index = start + 1; index < lines.length; index += 1) {
    if (/^ {2}[A-Za-z0-9_-]+:\s*$/.test(lines[index])) break;
    result.push(lines[index]);
  }
  return result;
}

function commandPresent(lines, command) {
  return lines.some((line) => line.includes(command));
}

function requireCondition(condition, message) {
  if (!condition) fail(message);
}

function validateCiWorkflow(source, file) {
  const triggers = triggerKeys(source);
  requireCondition(triggers.has("pull_request"), `${file}: pull_request trigger is required`);
  requireCondition(triggers.has("workflow_dispatch"), `${file}: workflow_dispatch trigger is required`);
  requireCondition(!triggers.has("push"), `${file}: push trigger is not allowed`);
  const classifier = jobSection(source, "verification_scope");
  const security = jobSection(source, "security_text_scan");
  const governance = jobSection(source, "governance");
  const frontend = jobSection(source, "frontend");
  const native = jobSection(source, "native_smoke");
  const dependency = jobSection(source, "dependency_audit");
  const quality = jobSection(source, "quality_gate");
  for (const [name, section] of [
    ["verification_scope", classifier],
    ["security_text_scan", security],
    ["governance", governance],
    ["frontend", frontend],
    ["native_smoke", native],
    ["dependency_audit", dependency],
    ["quality_gate", quality],
  ]) requireCondition(section.length > 0, `${file}: ${name} job is required`);
  for (const output of ["governance", "frontend", "native", "dependency", "classification_ok"]) {
    requireCondition(sectionHasKey(classifier, output, 6), `${file}: classifier must expose ${output}`);
  }
  requireCondition(commandPresent(classifier, "classify-verification-inputs.mjs"), `${file}: classifier command is required`);
  requireCondition(commandPresent(classifier, "--base") && commandPresent(classifier, "--head"), `${file}: pull request classification must use base and head`);
  requireCondition(commandPresent(classifier, "--full"), `${file}: manual classification must support full scope`);
  requireCondition(commandPresent(classifier, "classification_ok"), `${file}: classifier result must be exposed`);
  requireCondition(commandPresent(security, "security-scan-text.mjs"), `${file}: security scan job is required`);
  requireCondition(commandPresent(governance, "npm run verify:bootstrap"), `${file}: governance job must run bootstrap`);
  requireCondition(commandPresent(frontend, "pnpm test") && commandPresent(frontend, "pnpm test:a11y"), `${file}: frontend tests are required`);
  requireCondition(sectionValue(native, "runs-on", 4) === "macos-15", `${file}: native_smoke must run on macos-15`);
  requireCondition(native.some((line) => line.includes("outputs.native")), `${file}: native_smoke must use classifier output`);
  requireCondition(commandPresent(native, "tauri build --debug --no-bundle"), `${file}: native_smoke must use the no-bundle build`);
  requireCondition(dependency.some((line) => /uses:\s+\.\/\.github\/workflows\/dependency-audit\.yml/.test(line)), `${file}: dependency audit must use the reusable workflow`);
  requireCondition(quality.some((line) => /always\(\)/.test(line)), `${file}: quality_gate must always collect selected outcomes`);
  requireCondition(quality.some((line) => line.includes("verification_scope")) && quality.some((line) => line.includes("security_text_scan")), `${file}: quality_gate must include classifier and security outcomes`);
  requireCondition(commandPresent(quality, "check_selected"), `${file}: quality_gate must check selected outcomes`);
  requireCondition(!source.includes("macos-15-intel"), `${file}: automatic CI must not target macos-15-intel`);
  requireCondition(!source.includes("windows-latest"), `${file}: automatic CI must not target windows-latest`);
  requireCondition(!source.includes("upload-artifact"), `${file}: automatic CI must not upload artifacts`);
}

function validateDependencyWorkflow(source, file) {
  const triggers = triggerKeys(source);
  requireCondition(triggers.has("workflow_call"), `${file}: workflow_call trigger is required`);
  requireCondition(triggers.has("workflow_dispatch"), `${file}: workflow_dispatch trigger is required`);
  requireCondition(triggers.has("schedule"), `${file}: monthly schedule is required`);
  requireCondition(!triggers.has("push"), `${file}: push trigger is not allowed`);
  requireCondition(/cron:\s*["']?\S+\s+\S+\s+1\s+\*\s+\*["']?/.test(source), `${file}: schedule must be monthly`);
  requireCondition(/^permissions:\s*$/m.test(source), `${file}: top-level permissions are required`);
  const permissions = topLevelSection(source, "permissions");
  requireCondition(permissions.some((line) => /^ {2}contents:\s*read\s*$/.test(line)), `${file}: contents permission must be read`);
  requireCondition(!permissions.some((line) => /:\s*(?:write|付与)/.test(line)), `${file}: permissions must remain read-only`);
  requireCondition(source.includes("cargo-deny-action"), `${file}: cargo-deny action is required`);
  requireCondition(!source.includes("cargo install cargo-audit"), `${file}: cargo-audit install is not allowed`);
}

function validateNativeWorkflow(source, file) {
  const triggers = triggerKeys(source);
  requireCondition(triggers.has("workflow_dispatch"), `${file}: workflow_dispatch trigger is required`);
  for (const trigger of ["pull_request", "schedule", "push"]) {
    requireCondition(!triggers.has(trigger), `${file}: ${trigger} trigger is not allowed`);
  }
  for (const platform of ["macos-15", "macos-15-intel", "windows-latest"]) {
    requireCondition(source.includes(platform), `${file}: manual matrix is missing ${platform}`);
  }
  requireCondition(/^ {6}build_installers:[ \t]*$/m.test(source), `${file}: build_installers input is required`);
  requireCondition(source.includes("pnpm verify:patched-dependencies"), `${file}: patched dependency verification is required`);
  requireCondition(/if:\s*failure\(\)/.test(source), `${file}: failure-only diagnostic artifact is required`);
  requireCondition(source.includes("apps/desktop/test-results/native-settings-text-100.png"), `${file}: synthetic failure artifact is required`);
  requireCondition(!source.includes("apps/desktop/test-results/*.png"), `${file}: broad screenshot artifact glob is not allowed`);
  requireCondition(!source.includes("apps/desktop/logs/"), `${file}: raw application logs are not allowed`);
  requireCondition(!source.includes("apps/desktop/wdio-logs/"), `${file}: raw WebDriver logs are not allowed`);
  requireCondition(/retention-days:\s*7\b/.test(source), `${file}: artifact retention must be seven days`);
}

function stepContexts(lines) {
  const stack = [];
  const records = [];
  let blockScalarIndent = null;
  for (let index = 0; index < lines.length; index += 1) {
    const line = lines[index];
    if (!line.trim() || line.trim().startsWith("#")) continue;
    const indent = indentation(line);
    if (blockScalarIndent !== null) {
      if (indent > blockScalarIndent) continue;
      blockScalarIndent = null;
    }
    while (stack.length && stack[stack.length - 1].indent >= indent) stack.pop();
    const inline = /^\s*-\s+uses:\s*(\S.*?)(?:\s+#(.*))?\s*$/.exec(line);
    const mapping = /^\s*uses:\s*(\S.*?)(?:\s+#(.*))?\s*$/.exec(line);
    const parentKeys = stack.map((entry) => entry.key);
    if (inline && parentKeys.includes("steps")) {
      records.push({ index, value: inline[1].trim(), comment: inline[2] ?? "", line, step: true });
    } else if (mapping && parentKeys.includes("steps") && !parentKeys.includes("with") && stack.some((entry) => entry.listItem)) {
      records.push({ index, value: mapping[1].trim(), comment: mapping[2] ?? "", line, step: true });
    }
    const listItem = /^\s*-\s+/.test(line);
    if (listItem) stack.push({ indent, key: null, listItem: true });
    const keyMatch = /^\s*(?:-\s+)?([A-Za-z_][A-Za-z0-9_-]*):(?:\s*(.*))?$/.exec(line);
    if (keyMatch) stack.push({ indent, key: keyMatch[1], listItem: false });
    if (/^\s*(?:-\s+)?(?:run|env|if|with):\s*[|>][-+]?\s*$/.test(line)) {
      blockScalarIndent = indent;
    }
  }
  return records;
}

function actionReference(value) {
  const unquoted = value.replace(/^['"]|['"]$/g, "");
  if (unquoted.startsWith("./") || unquoted.startsWith("docker://")) return { local: true };
  const match = /^([^@\s]+)@([^\s]+)$/.exec(unquoted);
  if (!match || !match[1].includes("/")) return { unknown: true, value: unquoted };
  return { ownerRepo: match[1], ref: match[2], local: false };
}

export function actionPinViolations(source, file = "workflow") {
  const violations = [];
  for (const record of stepContexts(workflowLines(source))) {
    const action = actionReference(record.value);
    if (action.local) continue;
    if (action.unknown) {
      violations.push(`${file}: unknown step action reference ${record.value}`);
      continue;
    }
    if (!/^[0-9a-f]{40}$/.test(action.ref)) {
      violations.push(`${file}: action ${action.ownerRepo} must use a lowercase 40-character commit SHA`);
    }
    if (!/\bv?\d+(?:\.\d+){0,3}\b/i.test(record.comment)) {
      violations.push(`${file}: action ${action.ownerRepo} must include an inline version comment`);
    }
  }
  return violations;
}

export function validateWorkflowActions(source, file = "workflow") {
  const violations = actionPinViolations(source, file);
  if (violations.length) fail(violations.join("\n"));
}

function validateWorkflowFile(source, file) {
  if (file.endsWith("/ci.yml")) validateCiWorkflow(source, file);
  else if (file.endsWith("/dependency-audit.yml")) validateDependencyWorkflow(source, file);
  else if (file.endsWith("/native-e2e.yml")) validateNativeWorkflow(source, file);
  validateWorkflowActions(source, file);
}

export function validateWorkflowSemantics(root, workflowPaths = WORKFLOW_PATHS) {
  for (const workflowPath of workflowPaths) {
    const file = path.isAbsolute(workflowPath) ? workflowPath : path.join(root, workflowPath);
    if (!isFile(file)) fail(`required workflow missing: ${rel(file, root)}`);
    validateWorkflowFile(readText(file), rel(file, root));
  }
  const classifier = path.join(root, "scripts/classify-verification-inputs.mjs");
  const classifierText = readText(classifier);
  requireCondition(classifierText.includes("scripts/validate-governance.mjs"), `${rel(classifier, root)} must include the central governance validator in its input closure`);
  requireCondition(classifierText.includes("scripts/validate-governance.test.mjs"), `${rel(classifier, root)} must include the governance self-test in its input closure`);
  requireCondition(!classifierText.includes("scripts/verify-agent-harness.mjs"), `${rel(classifier, root)} must not retain the retired harness path`);
  requireCondition(!classifierText.includes("scripts/verify-workflow-policy.mjs"), `${rel(classifier, root)} must not retain the retired workflow policy path`);
  const dependabot = path.join(root, ".github/dependabot.yml");
  const dependabotText = readText(dependabot);
  const monthlyCount = (dependabotText.match(/interval:\s*["']?monthly\b/g) ?? []).length;
  if (monthlyCount !== 3) fail(`${rel(dependabot, root)} must contain three monthly intervals`);
  if (/interval:\s*["']?weekly\b/.test(dependabotText)) fail(`${rel(dependabot, root)} must not use weekly intervals`);
}

function validatePackageScripts(root) {
  const file = path.join(root, "package.json");
  let packageJson;
  try {
    packageJson = JSON.parse(readText(file));
  } catch (error) {
    fail(`package.json is not valid JSON: ${error instanceof Error ? error.message : String(error)}`);
  }
  const scripts = packageJson.scripts ?? {};
  if (typeof scripts["verify:governance"] !== "string") fail("package.json must define verify:governance");
  if (Object.hasOwn(scripts, "verify:harness") || Object.hasOwn(scripts, "verify:workflows")) {
    fail("package.json must not retain retired governance script names");
  }
  if (!String(scripts["verify:governance"]).includes("validate-governance.mjs")) fail("verify:governance must run the central validator");
  if (!String(scripts["verify:governance"]).includes("validate-governance.test.mjs")) fail("verify:governance must run focused Node tests");
  if (!String(scripts["verify:bootstrap"]).includes("verify:governance")) fail("verify:bootstrap must include governance");
  if (String(scripts["verify:bootstrap"]).includes("verify:harness") || String(scripts["verify:bootstrap"]).includes("verify:workflows")) fail("verify:bootstrap must use the central governance script");
}

function validateRequiredFiles(root) {
  for (const relativePath of REQUIRED_FILES) {
    const file = resolveInside(root, relativePath);
    if (!isFile(file)) fail(`required file missing: ${relativePath}`);
  }
}

function validateFrontmatterFiles(root) {
  const canonicalFiles = directSkillFiles(root, ".agents/skills");
  const adapterFiles = directSkillFiles(root, ".claude/skills");
  if (canonicalFiles.length === 0) fail("no canonical Skills found");
  const canonical = collectSkillIdentities(canonicalFiles, root, "canonical Skill");
  const adapters = collectSkillIdentities(adapterFiles, root, "Claude adapter");
  const missing = [...canonical.keys()].filter((name) => !adapters.has(name));
  const orphan = [...adapters.keys()].filter((name) => !canonical.has(name));
  if (missing.length || orphan.length) {
    fail(`canonical and Claude Skill identities differ: missing=${missing.join(",")} orphan=${orphan.join(",")}`);
  }
  for (const file of CLAUDE_RULES) validateClaudeRuleFrontmatter(path.join(root, file), root);
  for (const file of CURSOR_RULES) validateCursorRuleFrontmatter(path.join(root, file), root);
  for (const file of CLAUDE_SKILLS) {
    if (isFile(path.join(root, file))) validateSkillFrontmatter(path.join(root, file), root);
  }
  return { canonical, adapters };
}

function validateTopology(root, canonical, adapters) {
  const routers = walkFiles(root, { extensions: new Set([".md"]), skip: new Set([".git", "node_modules", ".venv", ".external"]) })
    .filter((file) => path.basename(file) === "AGENTS.md");
  if (!routers.some((file) => path.resolve(file) === path.resolve(path.join(root, "AGENTS.md")))) fail("root AGENTS.md is required as a router");
  validateAdapterLinks(canonical, adapters, root);
  validateRouterLinks(canonical, routers, root);
  return routers;
}

function validateBudgets(root, routers) {
  checkBudget(path.join(root, "AGENTS.md"), "root", root);
  const rootBytes = fs.statSync(path.join(root, "AGENTS.md")).size;
  for (const router of routers) {
    if (path.resolve(router) === path.resolve(path.join(root, "AGENTS.md"))) continue;
    checkBudget(router, "nested", root);
    if (rootBytes + fs.statSync(router).size > COMBINED_ROUTER_BYTES) fail(`${rel(router, root)} with AGENTS.md exceeds ${COMBINED_ROUTER_BYTES} bytes`);
  }
  for (const file of directSkillFiles(root, ".agents/skills")) checkBudget(file, "skill", root);
  for (const file of [...CLAUDE_RULES, ...CLAUDE_SKILLS, ...CURSOR_RULES]) checkBudget(path.join(root, file), "adapter", root);
}

function validateMarkers(root) {
  for (const [file, marker] of MARKER_CONTRACTS) {
    const text = readText(path.join(root, file));
    const count = text.split(marker).length - 1;
    if (count !== 1) fail(`${file}: marker ${marker} must occur exactly once`);
  }
}

function optionalTaskStateFiles(root) {
  const template = path.join(root, TASK_STATE_TEMPLATE);
  const files = isFile(template) ? [template] : [];
  const governance = path.join(root, "docs/ai-governance");
  for (const file of walkFiles(governance, { extensions: new Set([".json"]) })) {
    if (/task-state(?:[-.]|$)/i.test(path.basename(file)) && !files.includes(file)) files.push(file);
  }
  return files;
}

export function validateRepository(root = DEFAULT_ROOT) {
  const resolvedRoot = path.resolve(root);
  const errors = [];
  const collect = (callback) => {
    try {
      callback();
    } catch (error) {
      errors.push(error instanceof Error ? error.message : String(error));
    }
  };

  collect(() => validateRequiredFiles(resolvedRoot));
  collect(() => validatePackageScripts(resolvedRoot));
  const routers = walkFiles(resolvedRoot, { extensions: new Set([".md"]), skip: new Set([".git", "node_modules", ".venv", ".external"]) })
    .filter((file) => path.basename(file) === "AGENTS.md");
  collect(() => validateBudgets(resolvedRoot, routers));
  let identities = null;
  collect(() => {
    identities = validateFrontmatterFiles(resolvedRoot);
  });
  if (identities) collect(() => validateTopology(resolvedRoot, identities.canonical, identities.adapters));
  collect(() => {
    const claude = readText(path.join(resolvedRoot, "CLAUDE.md")).replace(/\r/g, "").trim();
    if (claude !== "@AGENTS.md") fail("CLAUDE.md must contain only @AGENTS.md");
  });
  collect(() => validateMarkers(resolvedRoot));
  collect(() => {
    const markdownFiles = walkFiles(resolvedRoot, {
      extensions: new Set([".md", ".mdc", ".markdown"]),
      skip: new Set([".git", "node_modules", ".venv", ".external"]),
    });
    validateLocalLinks(markdownFiles, resolvedRoot);
  });
  for (const file of optionalTaskStateFiles(resolvedRoot)) collect(() => validateTaskStateFile(file, resolvedRoot));
  collect(() => validateWorkflowSemantics(resolvedRoot));

  if (errors.length) throw new GovernanceError(errors.join("\n"));
  return {
    canonicalSkills: identities?.canonical.size ?? 0,
    adapters: identities?.adapters.size ?? 0,
    routers: routers.length,
    workflows: WORKFLOW_PATHS.length,
  };
}

function cliRoot(argv) {
  const rootIndex = argv.indexOf("--root");
  return rootIndex >= 0 && argv[rootIndex + 1] ? path.resolve(argv[rootIndex + 1]) : DEFAULT_ROOT;
}

function main() {
  try {
    const counts = validateRepository(cliRoot(process.argv.slice(2)));
    console.log(`Governance verification passed: ${counts.canonicalSkills} Skills, ${counts.adapters} adapters, ${counts.routers} routers, ${counts.workflows} workflows.`);
    return 0;
  } catch (error) {
    console.error("Governance verification failed:");
    for (const message of String(error instanceof Error ? error.message : error).split("\n")) console.error(`- ${message}`);
    return 1;
  }
}

if (process.argv[1] && path.resolve(process.argv[1]) === path.resolve(fileURLToPath(import.meta.url))) {
  process.exitCode = main();
}
