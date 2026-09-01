import assert from "node:assert/strict";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import test from "node:test";

import {
  actionPinViolations,
  collectSkillIdentities,
  DEFAULT_ROOT,
  parseFrontmatter,
  parseWorkflowYaml,
  renderedMarkdownLinks,
  taskPathsOverlap,
  validateTaskStateDocument,
  validateWorkflowInventory,
  validateWorkflowActions,
  WORKFLOW_PATHS,
} from "./validate-governance.mjs";

function fails(callback, pattern) {
  assert.throws(callback, (error) => {
    assert.match(String(error?.message ?? error), pattern);
    return true;
  });
}

function makeTaskState(overrides = {}) {
  return {
    schema: "task-state/v1",
    status: "complete",
    goal: "validate governance",
    acceptance: ["central gate passes"],
    snapshot: { base: "base-sha", head: "head-sha", phase: "verification" },
    lane: { id: "governance", owner: "agent", owned_paths: ["scripts/"] },
    completed_evidence: [
      {
        gate: "governance",
        summary: "focused tests pass",
        result: "pass",
        artifact_reference: "test-output.txt",
      },
    ],
    input_closure: {
      paths: ["scripts/validate-governance.mjs"],
      config: ["package.json"],
      artifacts: ["test-output.txt"],
      conditions: ["node >= 22"],
    },
    invalidated_gates: [],
    remaining_work: [],
    risks_blockers: { risks: [], blockers: [] },
    ...overrides,
  };
}

test("frontmatter rejects duplicate keys and preserves YAML scalar types", () => {
  fails(
    () => parseFrontmatter("---\nname: one\nname: two\n---\n", "fixture"),
    /duplicate frontmatter key name/,
  );
  const data = parseFrontmatter(
    "---\npaths:\n  - one.md\nalwaysApply: false\n---\n",
    "fixture",
  );
  assert.deepEqual(data.paths, ["one.md"]);
  assert.equal(data.alwaysApply, false);
});

test("Skill identity is unique and matches its parent directory", () => {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), "day-schedule-governance-"));
  try {
    const canonical = path.join(root, ".agents/skills/one/SKILL.md");
    const adapter = path.join(root, ".claude/skills/one/SKILL.md");
    fs.mkdirSync(path.dirname(canonical), { recursive: true });
    fs.mkdirSync(path.dirname(adapter), { recursive: true });
    const frontmatter = '---\nname: one\ndescription: "fixture"\n---\n';
    fs.writeFileSync(canonical, frontmatter);
    fs.writeFileSync(adapter, `${frontmatter}[canonical](../../../.agents/skills/one/SKILL.md)\n`);
    const identities = collectSkillIdentities([canonical], root, "canonical Skill");
    assert.equal(identities.get("one"), canonical);
    fs.writeFileSync(adapter, '---\nname: two\ndescription: "fixture"\n---\n');
    fails(
      () => collectSkillIdentities([adapter], root, "Claude adapter"),
      /must match its parent directory/,
    );
  } finally {
    fs.rmSync(root, { recursive: true, force: true });
  }
});

test("rendered Markdown links omit images, code, fences, indented code, and comments", () => {
  const source = [
    "[visible](ok.md)",
    "![image](missing.png)",
    "`[inline](missing-inline.md)`",
    "`[multiline",
    "link](missing-multiline.md)`",
    "    [indented](missing-indented.md)",
    "```md",
    "[fenced](missing-fenced.md)",
    "```",
    "<!-- [comment](missing-comment.md) -->",
    "[reference][ref]",
    "[ref]: referenced.md",
  ].join("\n");
  const links = renderedMarkdownLinks(source, { includeImages: false });
  assert.deepEqual(new Set(links.map((link) => link.target)), new Set(["ok.md", "referenced.md"]));
  assert.equal(links.some((link) => link.image), false);
  assert.equal(renderedMarkdownLinks(source, { includeImages: true }).some((link) => link.image), true);
});

test("task-state/v1 enforces closure and terminal state contracts", () => {
  validateTaskStateDocument(makeTaskState());
  validateTaskStateDocument({
    ...makeTaskState(),
    status: "blocked",
    remaining_work: ["wait for review"],
    risks_blockers: { risks: [], blockers: ["review pending"] },
  });
  fails(
    () => validateTaskStateDocument({ ...makeTaskState(), remaining_work: ["unfinished"] }),
    /complete state must have no remaining/,
  );
  fails(
    () => validateTaskStateDocument({ ...makeTaskState(), input_closure: { ...makeTaskState().input_closure, artifacts: [] } }),
    /outside input closure/,
  );
  fails(
    () => validateTaskStateDocument({ ...makeTaskState(), status: "blocked", risks_blockers: { risks: [], blockers: [] } }),
    /blocked state requires a blocker/,
  );
  fails(
    () => validateTaskStateDocument({
      ...makeTaskState(),
      publication: { gate: "publication", annotation_paths: ["reports/"] },
      measurement: { gate: "measurement", input_paths: ["reports/result.json"] },
    }),
    /paths overlap/,
  );
  assert.equal(taskPathsOverlap("reports/result.json", "reports/*.json"), true);
  assert.equal(taskPathsOverlap("reports/result.json", "artifacts/result.json"), false);
  assert.equal(taskPathsOverlap("../outside", "artifacts/result.json"), true);
});

test("workflow Actions require lowercase full SHA pins and version comments", () => {
  const sha = "a".repeat(40);
  const valid = `jobs:\n  build:\n    steps:\n      - uses: actions/checkout@${sha} # v4.2.2\n      - name: local\n        uses: ./actions/local\n      - name: docker\n        uses: docker://alpine:3\n      - name: nested\n        uses: actions/setup-node@${sha} # v4.4.0\n        with:\n          uses: actions/not-an-action@v1\n  reusable:\n    uses: example/reusable/.github/workflows/release.yml@v1\n`;
  validateWorkflowActions(valid, "fixture.yml");
  assert.equal(actionPinViolations(valid, "fixture.yml").length, 0);
  validateWorkflowActions(`${valid}\n      - name: script\n        run: |\n          uses: actions/ignored@v1\n`, "fixture.yml");
  fails(
    () => validateWorkflowActions(valid.replace(`actions/checkout@${sha}`, "actions/checkout@V4"), "fixture.yml"),
    /lowercase 40-character commit SHA/,
  );
  fails(
    () => validateWorkflowActions(valid.replace("# v4.2.2", ""), "fixture.yml"),
    /inline version comment/,
  );
  fails(
    () => validateWorkflowActions(valid.replace("actions/checkout@" + sha, "actions/checkout@actions-ref"), "fixture.yml"),
    /lowercase 40-character commit SHA/,
  );
});

test("workflow inventory is exactly the allowlisted set", () => {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), "day-schedule-workflows-"));
  try {
    const workflowDirectory = path.join(root, ".github/workflows");
    fs.mkdirSync(workflowDirectory, { recursive: true });
    for (const workflow of WORKFLOW_PATHS) {
      const file = path.join(root, workflow);
      fs.writeFileSync(file, "name: fixture\n");
    }
    fs.writeFileSync(path.join(workflowDirectory, "unexpected.yml"), "name: unexpected\n");
    fails(() => validateWorkflowInventory(root), /workflow inventory mismatch/);
  } finally {
    fs.rmSync(root, { recursive: true, force: true });
  }
  assert.deepEqual(validateWorkflowInventory(DEFAULT_ROOT), [...WORKFLOW_PATHS].sort());
});

test("workflow YAML parser rejects an invalidly indented sequence fixture", () => {
  const invalidFixture = [
    "jobs:",
    "  build:",
    "    steps:",
    "      - name: first",
    "        run: echo first",
    "       - name: second",
  ].join("\n");
  fails(() => parseWorkflowYaml(invalidFixture, "invalid-workflow.yml"), /indentation|sequence/);
});

for (const [name, value] of [
  ["duplicate flow mapping keys", "{a:1,a:2}"],
  ["empty flow sequence item", "[a,,b]"],
  ["nested empty flow sequence item", "[a,[,],b]"],
]) {
  test(`workflow YAML parser rejects ${name}`, () => {
    fails(
      () => parseWorkflowYaml(`value: ${value}\n`, `${name}.yml`),
      /YAML flow mapping\/sequence syntax is unsupported/,
    );
  });
}
