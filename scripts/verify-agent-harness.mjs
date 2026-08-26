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

function requireContractBlock(file, contractId, expected) {
  if (!exists(file)) return;
  const text = read(file);
  const occurrences = text.split(contractId).length - 1;
  if (occurrences !== 1) {
    fail(
      `${file}: contract ${contractId} must appear exactly once, found ${occurrences}`,
    );
    return;
  }
  const marker = text.indexOf(contractId);
  const nextHeading = text.indexOf("\n## ", marker);
  const block = text.slice(marker, nextHeading < 0 ? text.length : nextHeading);
  for (const value of expected) {
    if (!block.includes(value)) {
      fail(
        `${file}: contract ${contractId} must contain ${JSON.stringify(value)}`,
      );
    }
  }
}

function requireHeadingBlock(file, heading, expected, ordered = false) {
  if (!exists(file)) return;
  const text = read(file);
  const marker = text.indexOf(heading);
  if (marker < 0) {
    fail(`${file}: heading ${JSON.stringify(heading)} is missing`);
    return;
  }
  if (text.indexOf(heading, marker + heading.length) >= 0) {
    fail(
      `${file}: heading ${JSON.stringify(heading)} must appear exactly once`,
    );
    return;
  }
  const nextHeading = text.indexOf("\n## ", marker + heading.length);
  const block = text.slice(marker, nextHeading < 0 ? text.length : nextHeading);
  let previous = -1;
  for (const value of expected) {
    const position = block.indexOf(value);
    if (position < 0) {
      fail(
        `${file}: section ${JSON.stringify(heading)} must contain ${JSON.stringify(value)}`,
      );
    } else if (ordered && position <= previous) {
      fail(
        `${file}: section ${JSON.stringify(heading)} has out-of-order ${JSON.stringify(value)}`,
      );
    }
    previous = position;
  }
}

function requirePackageScripts(expected) {
  if (!exists("package.json")) return;
  let packageJson;
  try {
    packageJson = JSON.parse(read("package.json"));
  } catch (error) {
    fail(
      `package.json: invalid JSON (${error instanceof Error ? error.message : String(error)})`,
    );
    return;
  }
  for (const [name, fragments] of Object.entries(expected)) {
    const command = packageJson.scripts?.[name];
    if (typeof command !== "string") {
      fail(`package.json: scripts.${name} must be a string`);
      continue;
    }
    for (const fragment of fragments) {
      if (!command.includes(fragment)) {
        fail(
          `package.json: scripts.${name} must contain ${JSON.stringify(fragment)}`,
        );
      }
    }
  }
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
requireHeadingBlock("AGENTS.md", "## 1. 作業開始", [
  "包括レビュー",
  "同一verified snapshotと同一risk lane集合",
  "初回と、必要な修正後の再レビューまでで原則収束",
  "docs/agent-harness.md",
]);
requireText("docs/agent-harness.md", "同一HEAD・同一risk laneの独立監査は原則1回");
requireText("docs/agent-harness.md", "全履歴の共有を既定にせず");
requireText("docs/agent-harness.md", "risk lane台帳");
requireText("docs/ai-governance/13-maintenance-policy.md", "サブエージェント運用");
requireText("docs/agent-principles.md", "重複回数だけで抽象化を強制しない");
requireText("docs/ai-governance/13-maintenance-policy.md", ".cursor");
requireText("docs/ai-governance/13-maintenance-policy.md", "GitHub共同作業面");
requireText("docs/ai-governance/14-issue-quality-gate.md", "現在と対応後のユーザー体験");
requireText("docs/ai-governance/15-agent-harness-compatibility.md", "alwaysApply: false");

requireContractBlock(
  "docs/agent-harness.md",
  "DSN-COMPREHENSIVE-REVIEW-ROUNDS",
  [
    "同一のverified snapshotと同一のrisk lane集合",
    "review機能、実行環境が異なっても",
    "latest meaningful changeを含む配送候補HEAD",
    "初回包括レビューを1回",
    "修正後の再レビューを1回",
    "3回目以降の包括レビューは原則実行しない",
    "未解決のP0またはP1",
    "セキュリティ、秘密情報、データ整合性、破壊的操作",
    "新しい変更pathまたはrisk lane",
    "対象漏れ、証拠不足、一次証拠との矛盾",
    "受け入れ条件またはhard gateを満たさない新しい証拠",
    "失効した証拠、対象risk lane、変更path、確認する具体的な問い",
    "P2以下の指摘だけが残る場合",
    "verifierの正しさ",
    "non-blockingと判断した根拠",
    "review threadへの回答",
    "回帰testは包括レビューラウンドへ数えません",
    "回数制限を迂回しません",
    "review収束後に配送対象の最終HEADを確定",
    "最終HEADで必要なfull gateを原則1回",
    "生成物変更、環境変更、証拠期限切れ",
  ],
);
requireHeadingBlock(
  "docs/agent-harness.md",
  "## 10. 包括レビュー収束",
  [
    "実装中は変更pathに対応するfocused testを実行する",
    "配送候補HEADで初回包括レビューを実行する",
    "指摘修正後は変更pathのfocused testを実行する",
    "必要な場合だけ2回目の包括レビューを実行する",
    "review収束後に配送対象の最終HEADを確定する",
    "最終HEADで必要なfull gateを原則1回実行する",
  ],
  true,
);
requireHeadingBlock("docs/agent-harness.md", "## 13. Subagent orchestration", [
  "| review round |",
  "ラウンド外のfocused確認はnot counted",
  "| verified snapshot |",
  "| reviewed risk lanes |",
  "前回snapshotから追加・変更されたpath",
  "| status |",
  "| invalidation condition |",
  "| additional review justification |",
]);
requireContractBlock(
  "docs/ai-governance/13-maintenance-policy.md",
  "DSN-REVIEW-ROUND-CANONICAL-PLACEMENT",
  [
    "tool非依存の唯一の詳細正本",
    "root `AGENTS.md`には全agentが到達する短い入口だけ",
    "nested `AGENTS.md`、adapter、Skillへ契約本文や数え方を複製しません",
    "固有の起動方法は共有正本とmachine verifierへ追加しません",
    "正本への薄い参照",
  ],
);
for (const file of [
  ...nestedRules,
  ...canonicalSkills,
  ...claudeRules,
  ...claudeSkills,
  ...cursorRules,
]) {
  rejectText(file, "DSN-COMPREHENSIVE-REVIEW-ROUNDS");
  rejectText(file, "DSN-REVIEW-ROUND-CANONICAL-PLACEMENT");
}
requireContractBlock("docs/testing/index.md", "DSN-RISK-BASED-DELIVERY", [
  "| G: governance / docs |",
  "| U: UI / application |",
  "| N: native interaction / capability |",
  "| S: data safety |",
  "| R: distribution / release |",
  "複数選び",
  "focused local checks",
  "latest-head CI",
  "同じfull suiteをlocalとCIで理由なく直列重複させません",
  "latest app handoff",
  "復旧可能なinstall",
  "lane R",
]);
requireContractBlock(
  "docs/engineering/desktop-platform-and-release.md",
  "DSN-LATEST-APP-HANDOFF",
  [
    "exact HEAD",
    "checksum",
    "backup",
    "install",
    "installed binary",
    "launch smoke",
    "headが変わった場合",
    "pnpm --dir apps/desktop tauri build --debug --bundles app",
    "governance / docsだけの変更",
  ],
);
requireContractBlock(
  "docs/ai-governance/13-maintenance-policy.md",
  "DSN-WORDPACK-OVERLAY",
  [
    "WordPack for English",
    "対象revision",
    "file単位の全置換",
    "DSN-RISK-BASED-DELIVERY",
    "DSN-LATEST-APP-HANDOFF",
    "明示的な再評価なし",
    "削除・弱化・重厚化",
  ],
);

requireText("AGENTS.md", "docs/testing/index.md");
requireText("AGENTS.md", "docs/engineering/desktop-platform-and-release.md");
requireText("AGENTS.md", "checksum、復旧可能なinstall、launch smokeを必須");
requireText(
  ".agents/skills/ui-ux-review/SKILL.md",
  "表示差分を持たないnative interaction",
);
requireText(
  ".agents/skills/ui-ux-review/SKILL.md",
  "意味のないscreenshotを要求しません",
);
requireText(
  ".agents/skills/desktop-release-review/SKILL.md",
  "DMG / installerの生成・mount",
);
requireText("docs/ai-governance/14-issue-quality-gate.md", "必須なのは情報");
requireText(
  "scripts/build-personal-google-oauth.mjs",
  '["pnpm", "--dir", "apps/desktop", "tauri", "build", "--debug", "--bundles", "app"]',
);

for (const file of [
  ".github/ISSUE_TEMPLATE/feature.md",
  ".github/ISSUE_TEMPLATE/bug.md",
  ".github/ISSUE_TEMPLATE/investigation.md",
  ".github/ISSUE_TEMPLATE/operations.md",
]) {
  requireText(file, "boundedな内部改善・ガバナンス");
}

for (const [file, retired] of [
  [".agents/skills/ui-ux-review/SKILL.md", "本文書の全手順を適用する"],
  [
    ".agents/skills/desktop-release-review/SKILL.md",
    "one-platform-only validation for shared change",
  ],
  [
    "docs/testing/index.md",
    "UI PR は対象状態ごとの変更前／変更後 screenshot を添付します",
  ],
]) {
  rejectText(file, retired);
}

requirePackageScripts({
  "verify:harness": ["node scripts/verify-agent-harness.mjs"],
  "verify:bootstrap": ["verify:harness", "verify:workflows"],
});

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
