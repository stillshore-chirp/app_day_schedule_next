import assert from "node:assert/strict";
import fs from "node:fs";
import test from "node:test";
import { execFileSync } from "node:child_process";
import {
  changedPaths,
  classifyPath,
  classifyPaths,
  gitDiffArguments,
  normalizePath,
} from "./classify-verification-inputs.mjs";

test("docs and governance paths do not select product gates", () => {
  const plan = classifyPaths([
    "docs/README.md",
    ".agents/skills/example/SKILL.md",
    "./docs/README.md",
  ]);

  assert.equal(plan.classification_ok, true);
  assert.equal(plan.governance, true);
  assert.equal(plan.frontend, false);
  assert.equal(plan.native, false);
  assert.equal(plan.dependency, false);
  assert.equal(plan.changed_path_count, 2);
});

test("frontend UI selects frontend without native smoke", () => {
  const plan = classifyPaths(["apps/desktop/src/app/App.tsx"]);

  assert.equal(plan.classification_ok, true);
  assert.equal(plan.frontend, true);
  assert.equal(plan.native, false);
  assert.equal(plan.dependency, false);
  assert.equal(plan.governance, false);
});

test("Tauri runtime selects native without frontend tests", () => {
  const plan = classifyPaths(["apps/desktop/src-tauri/src/lib.rs"]);

  assert.equal(plan.classification_ok, true);
  assert.equal(plan.frontend, false);
  assert.equal(plan.native, true);
  assert.equal(plan.dependency, false);
  assert.equal(plan.governance, false);
});

test("native E2E and Rust paths remain native-only where possible", () => {
  const e2e = classifyPaths(["apps/desktop/tests/e2e/native-smoke.e2e.ts"]);
  const rust = classifyPaths(["apps/desktop/src-tauri/src/domain/time.rs"]);

  for (const plan of [e2e, rust]) {
    assert.equal(plan.classification_ok, true);
    assert.equal(plan.native, true);
    assert.equal(plan.frontend, false);
    assert.equal(plan.dependency, false);
  }
});

test("dependency and patch inputs select the dependency gate", () => {
  const plan = classifyPaths([
    "package.json",
    "pnpm-workspace.yaml",
    "pnpm-lock.yaml",
    "patches/brace-expansion@5.0.9.patch",
    ".github/dependabot.yml",
    "scripts/verify-patched-dependencies.mjs",
  ]);

  assert.equal(plan.classification_ok, true);
  assert.equal(plan.dependency, true);
  assert.equal(plan.frontend, true);
  assert.equal(plan.native, true);
  assert.equal(plan.governance, true);
});

test("workflow paths are governance-only", () => {
  const ci = classifyPath(".github/workflows/ci.yml");
  const manual = classifyPath(".github/workflows/native-e2e.yml");

  assert.ok(ci);
  assert.equal(ci.governance, true);
  assert.equal(ci.native, false);
  assert.ok(manual);
  assert.equal(manual.governance, true);
  assert.equal(manual.native, false);
});

test("unknown and non-canonical paths fail closed", () => {
  for (const value of [
    "new-root-file.txt",
    "tests/fixtures/new-input.json",
    "../README.md",
    "/absolute/path.md",
    "docs\\README.md",
    "docs//README.md",
    "././docs/README.md",
  ]) {
    assert.equal(classifyPath(value), null, value);
  }

  const plan = classifyPaths(["new-root-file.txt"]);
  assert.equal(plan.classification_ok, false);
  assert.equal(plan.unknown_path_count, 1);
  assert.deepEqual(plan.unknown_paths, ["new-root-file.txt"]);
  assert.equal(plan.governance, false);
  assert.equal(plan.frontend, false);
  assert.equal(plan.native, false);
  assert.equal(plan.dependency, false);
  assert.equal(normalizePath("./docs/README.md"), "docs/README.md");
});

test("full profile selects every gate for manual recovery", () => {
  assert.deepEqual(classifyPaths([], { profile: "full" }), {
    governance: true,
    frontend: true,
    native: true,
    dependency: true,
    classification_ok: true,
    changed_path_count: 0,
    unknown_path_count: 0,
    unknown_paths: [],
    fallback_reason: null,
  });
});

test("diff contract includes NUL output and both rename sides", () => {
  assert.deepEqual(gitDiffArguments("base", "head"), [
    "diff",
    "--name-only",
    "--no-renames",
    "-z",
    "base...head",
    "--",
  ]);

  const changed = changedPaths("HEAD~1", "HEAD");
  assert.ok(Array.isArray(changed));
  assert.ok(changed.every((value) => typeof value === "string" && value.length > 0));
});

test("every tracked base path has a conservative classification", () => {
  const tracked = execFileSync("git", ["ls-files", "-z"], { encoding: "buffer" })
    .toString("utf8")
    .split("\0")
    .filter(Boolean);
  const unknown = tracked.filter((value) => classifyPath(value) === null);

  assert.deepEqual(unknown, []);
});

test("workflow action references are immutable full lowercase SHAs", () => {
  for (const workflow of [
    ".github/workflows/ci.yml",
    ".github/workflows/dependency-audit.yml",
    ".github/workflows/native-e2e.yml",
  ]) {
    const text = fs.readFileSync(workflow, "utf8");
    for (const line of text.split("\n")) {
      if (!line.includes("uses:")) continue;
      const match = line.match(/uses:\s*([^\s#]+)/);
      if (!match || match[1].startsWith("./") || match[1].startsWith("docker://")) continue;
      assert.match(match[1], /@[0-9a-f]{40}$/u, `${workflow}: ${line}`);
      assert.match(line, /#\s*(?:v\d+(?:\.\d+){0,2}|stable)/u, `${workflow}: ${line}`);
    }
  }
});
