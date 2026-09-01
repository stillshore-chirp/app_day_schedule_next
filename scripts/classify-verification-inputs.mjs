#!/usr/bin/env node
import fs from "node:fs";
import path from "node:path";
import process from "node:process";
import { execFileSync } from "node:child_process";

const OUTPUT_FIELDS = [
  "governance",
  "frontend",
  "native",
  "dependency",
  "classification_ok",
];

const GOVERNANCE_EXACT = new Set([
  ".editorconfig",
  ".env.example",
  ".gitattributes",
  ".gitignore",
  "AGENTS.md",
  "CLAUDE.md",
  "CONTRIBUTING.md",
  "LICENSE",
  "OPERATIONS.md",
  "README.md",
  "SECURITY.md",
  "UserManual.md",
  ".github/AGENTS.md",
  ".github/dependabot.yml",
  ".github/pull_request_template.md",
  "apps/desktop/AGENTS.md",
  "apps/desktop/src/AGENTS.md",
  "apps/desktop/src-tauri/AGENTS.md",
  "apps/desktop/tests/AGENTS.md",
  "scripts/check-repository-boundaries.mjs",
  "scripts/security-scan-text.mjs",
  "scripts/validate-governance.mjs",
  "scripts/validate-governance.test.mjs",
  "scripts/verify-doc-links.mjs",
  "scripts/verify-i18n-keys.mjs",
  "scripts/classify-verification-inputs.mjs",
  "scripts/classify-verification-inputs.test.mjs",
  "package.json",
]);

const FRONTEND_EXACT = new Set([
  "apps/desktop/.prettierignore",
  "apps/desktop/.prettierrc.json",
  "apps/desktop/eslint.config.js",
  "apps/desktop/index.html",
  "apps/desktop/package.json",
  "apps/desktop/tsconfig.app.json",
  "apps/desktop/tsconfig.json",
  "apps/desktop/tsconfig.node.json",
  "apps/desktop/vite.config.ts",
  "apps/desktop/vitest.a11y.config.ts",
  "apps/desktop/vitest.config.ts",
  "apps/desktop/test/setup.ts",
]);

const NATIVE_EXACT = new Set([
  "apps/desktop/wdio.conf.ts",
  "apps/desktop/wdio.restart.conf.ts",
  "apps/desktop/vitest.e2e.config.ts",
  "apps/desktop/scripts/verify-text-scale-restart.ts",
  "scripts/build-personal-google-oauth.mjs",
  "scripts/compare-visual-snapshots.swift",
  "scripts/measure-startup-performance.mjs",
  "scripts/provision-google-oauth-local.mjs",
  "Cargo.toml",
  "Cargo.lock",
  "rust-toolchain.toml",
  "deny.toml",
  "pnpm-workspace.yaml",
  "pnpm-lock.yaml",
]);

const DEPENDENCY_EXACT = new Set([
  "apps/desktop/package.json",
  "pnpm-workspace.yaml",
  "pnpm-lock.yaml",
  "Cargo.toml",
  "Cargo.lock",
  "apps/desktop/src-tauri/Cargo.toml",
  "rust-toolchain.toml",
  "deny.toml",
  "scripts/verify-patched-dependencies.mjs",
]);

const SPECIAL_GOVERNANCE_PREFIXES = [
  ".agents/",
  ".claude/",
  ".cursor/",
  ".github/ISSUE_TEMPLATE/",
  "docs/",
  "plans/",
];

const WORKFLOW_PREFIX = ".github/workflows/";
const PATCH_PREFIX = "patches/";
const TAURI_PREFIX = "apps/desktop/src-tauri/";
const FRONTEND_PREFIX = "apps/desktop/src/";
const E2E_PREFIX = "apps/desktop/tests/e2e/";
const VISUAL_BASELINE_PREFIX = "apps/desktop/tests/visual-baselines/";

function hasPrefix(value, prefixes) {
  const candidates = Array.isArray(prefixes) ? prefixes : [prefixes];
  return candidates.some((prefix) => value.startsWith(prefix));
}

/**
 * Accept only repository-relative canonical POSIX paths.
 * Git supplies canonical paths, but rejecting alternate spellings prevents a
 * caller or fixture from bypassing the conservative fallback rules.
 */
export function normalizePath(value) {
  if (typeof value !== "string" || value.length === 0) return null;
  const candidate = value.startsWith("./") ? value.slice(2) : value;
  if (
    candidate.length === 0 ||
    candidate.startsWith("/") ||
    candidate.includes("\\") ||
    candidate.split("/").some((part) => part === "" || part === "." || part === "..")
  ) {
    return null;
  }
  return candidate;
}

function emptyClassification(pathValue, rule = "unknown_path") {
  return {
    path: pathValue,
    rule,
    governance: false,
    frontend: false,
    native: false,
    dependency: false,
  };
}

/**
 * Classify one path. Runtime roots are explicit so a new product surface
 * cannot silently select the wrong gate; unknown paths fail closed.
 */
export function classifyPath(value) {
  const normalized = normalizePath(value);
  if (normalized === null) return null;

  const classification = emptyClassification(normalized, "registered");
  let matched = false;

  if (GOVERNANCE_EXACT.has(normalized)) {
    classification.governance = true;
    matched = true;
  }
  if (hasPrefix(normalized, SPECIAL_GOVERNANCE_PREFIXES)) {
    classification.governance = true;
    matched = true;
  }
  if (hasPrefix(normalized, WORKFLOW_PREFIX)) {
    classification.governance = true;
    matched = true;
  }

  if (
    FRONTEND_EXACT.has(normalized) ||
    (normalized.startsWith(FRONTEND_PREFIX) && !normalized.endsWith("/AGENTS.md"))
  ) {
    classification.frontend = true;
    matched = true;
  }

  if (
    NATIVE_EXACT.has(normalized) ||
    (normalized.startsWith(TAURI_PREFIX) && !normalized.endsWith("/AGENTS.md")) ||
    normalized.startsWith(E2E_PREFIX) ||
    normalized.startsWith(VISUAL_BASELINE_PREFIX)
  ) {
    classification.native = true;
    matched = true;
  }

  if (DEPENDENCY_EXACT.has(normalized)) {
    classification.dependency = true;
    matched = true;
  }
  if (normalized.startsWith(PATCH_PREFIX)) {
    classification.dependency = true;
    classification.frontend = true;
    classification.native = true;
    matched = true;
  }

  // A dependency verifier is governance code plus a dependency-safety input.
  if (normalized === "scripts/verify-patched-dependencies.mjs") {
    classification.governance = true;
  }

  // Workspace and lockfiles affect every install and native build. The root
  // package only changes verification/control-plane scripts in this product;
  // product dependency declarations live in the desktop package.
  if (
    normalized === "pnpm-workspace.yaml" ||
    normalized === "pnpm-lock.yaml"
  ) {
    classification.frontend = true;
    classification.native = true;
  }

  // Native-only scripts have no frontend gate, while every other script is a
  // governance input because it is part of the verification/control plane.
  if (normalized.startsWith("scripts/")) {
    classification.governance ||= true;
    matched = true;
  }

  return matched ? classification : null;
}

function basePlan(changedPaths, unknownPaths, fallbackReason = null) {
  const plan = {
    governance: false,
    frontend: false,
    native: false,
    dependency: false,
    classification_ok: unknownPaths.length === 0 && fallbackReason === null,
    changed_path_count: changedPaths.length,
    unknown_path_count: unknownPaths.length,
    unknown_paths: unknownPaths.slice(0, 20),
    fallback_reason: fallbackReason,
  };
  return plan;
}

/**
 * Build a change-scoped plan. Duplicate paths are removed while preserving
 * the first-seen order, which also makes targeted diagnostics deterministic.
 */
export function classifyPaths(paths, { profile = "pr", fallbackReason = null } = {}) {
  if (profile === "full") {
    return {
      governance: true,
      frontend: true,
      native: true,
      dependency: true,
      classification_ok: true,
      changed_path_count: 0,
      unknown_path_count: 0,
      unknown_paths: [],
      fallback_reason: null,
    };
  }
  if (profile !== "pr") throw new Error(`unsupported classifier profile: ${profile}`);

  const changed = [];
  const seen = new Set();
  for (const value of paths ?? []) {
    if (!value) continue;
    const normalized = normalizePath(value);
    const key = normalized ?? value;
    if (seen.has(key)) continue;
    seen.add(key);
    changed.push(normalized ?? value);
  }
  const unknown = [];
  const plan = basePlan(changed, unknown, fallbackReason);
  for (const value of changed) {
    const classification = classifyPath(value);
    if (!classification) {
      unknown.push(value);
      continue;
    }
    for (const field of OUTPUT_FIELDS.slice(0, -1)) {
      plan[field] ||= classification[field];
    }
  }
  if (unknown.length > 0 && plan.fallback_reason === null) {
    plan.fallback_reason = "unclassified path requires an explicit category rule";
  }
  plan.unknown_paths = unknown.slice(0, 20);
  plan.unknown_path_count = unknown.length;
  plan.classification_ok = unknown.length === 0 && plan.fallback_reason === null;
  return plan;
}

export function gitDiffArguments(base, head) {
  return ["diff", "--name-only", "--no-renames", "-z", `${base}...${head}`, "--"];
}

/** Return both old and new names for renames and deleted paths. */
export function changedPaths(base, head) {
  const output = execFileSync("git", gitDiffArguments(base, head), {
    encoding: "buffer",
    stdio: ["ignore", "pipe", "pipe"],
  });
  return output
    .toString("utf8")
    .split("\0")
    .filter((value) => value.length > 0);
}

export function writeGithubOutputs(outputPath, plan) {
  const lines = OUTPUT_FIELDS.map((field) => `${field}=${String(Boolean(plan[field]))}`);
  lines.push(`changed_path_count=${plan.changed_path_count}`);
  lines.push(`unknown_path_count=${plan.unknown_path_count}`);
  lines.push(`unknown_paths=${JSON.stringify(plan.unknown_paths)}`);
  fs.appendFileSync(outputPath, `${lines.join("\n")}\n`, "utf8");
}

function parseArgs(argv) {
  const args = { full: false, base: null, head: null, githubOutput: null };
  for (let index = 0; index < argv.length; index += 1) {
    const argument = argv[index];
    if (argument === "--full") {
      args.full = true;
    } else if (argument === "--base" || argument === "--head" || argument === "--github-output") {
      const value = argv[index + 1];
      if (!value) throw new Error(`${argument} requires a value`);
      index += 1;
      if (argument === "--base") args.base = value;
      if (argument === "--head") args.head = value;
      if (argument === "--github-output") args.githubOutput = value;
    } else {
      throw new Error(`unknown argument: ${argument}`);
    }
  }
  return args;
}

export function main(argv = process.argv.slice(2)) {
  const args = parseArgs(argv);
  let plan;
  if (args.full) {
    plan = classifyPaths([], { profile: "full" });
  } else {
    if (!args.base || !args.head) {
      throw new Error("--base and --head are required for the PR profile");
    }
    try {
      plan = classifyPaths(changedPaths(args.base, args.head));
    } catch (error) {
      const reason = error instanceof Error ? error.message : String(error);
      plan = classifyPaths([], { fallbackReason: `git diff failed: ${reason}` });
    }
  }

  if (args.githubOutput) writeGithubOutputs(args.githubOutput, plan);
  console.log(JSON.stringify(plan, null, 2));
  return plan.classification_ok ? 0 : 1;
}

if (import.meta.url === `file://${process.argv[1]}`) {
  try {
    process.exitCode = main();
  } catch (error) {
    console.error(error instanceof Error ? error.message : String(error));
    process.exitCode = 1;
  }
}
