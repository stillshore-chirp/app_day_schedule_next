#!/usr/bin/env node
import fs from "node:fs";
import process from "node:process";

const read = (path) => fs.readFileSync(path, "utf8");
const errors = [];

function requireText(text, expected, file, reason) {
  if (!text.includes(expected)) errors.push(`${file}: ${reason}`);
}

function forbidText(text, forbidden, file, reason) {
  if (text.includes(forbidden)) errors.push(`${file}: ${reason}`);
}

const ciPath = ".github/workflows/ci.yml";
const auditPath = ".github/workflows/dependency-audit.yml";
const e2ePath = ".github/workflows/native-e2e.yml";
const dependabotPath = ".github/dependabot.yml";
const ci = read(ciPath);
const audit = read(auditPath);
const e2e = read(e2ePath);
const dependabot = read(dependabotPath);

requireText(
  ci,
  "\n  pull_request:\n",
  ciPath,
  "PR quality trigger is required",
);
requireText(
  ci,
  "\n  workflow_dispatch:\n",
  ciPath,
  "manual recovery trigger is required",
);
forbidText(ci, "\n  push:\n", ciPath, "push trigger duplicates an open PR run");
requireText(
  ci,
  "name: Quality gate",
  ciPath,
  "the always-on quality gate is required",
);
requireText(
  ci,
  "native_changed",
  ciPath,
  "native work must be scoped by changed files",
);
requireText(
  ci,
  "runs-on: macos-15",
  ciPath,
  "personal-use native smoke must target macOS arm64",
);
requireText(
  ci,
  "tauri build --debug --no-bundle",
  ciPath,
  "automatic CI must not build installers",
);
forbidText(
  ci,
  "macos-15-intel",
  ciPath,
  "macOS x64 belongs in manual release validation",
);
forbidText(
  ci,
  "windows-latest",
  ciPath,
  "Windows belongs in manual release validation",
);
forbidText(
  ci,
  "upload-artifact",
  ciPath,
  "automatic CI must not retain installer artifacts",
);

requireText(
  audit,
  "\n  pull_request:\n",
  auditPath,
  "dependency changes must be audited on PRs",
);
requireText(
  audit,
  "\n    paths:\n",
  auditPath,
  "dependency PR audit must be path-scoped",
);
requireText(
  audit,
  "41 17 1 * *",
  auditPath,
  "monthly advisory audit is required",
);
forbidText(
  audit,
  "\n  push:\n",
  auditPath,
  "push audit duplicates dependency PR checks",
);
forbidText(
  audit,
  "cargo install cargo-audit",
  auditPath,
  "cargo-deny is the single Rust audit path",
);
forbidText(
  audit,
  "checks: write",
  auditPath,
  "audit permissions must remain read-only",
);
forbidText(
  audit,
  "issues: write",
  auditPath,
  "audit permissions must remain read-only",
);

requireText(
  e2e,
  "\n  workflow_dispatch:\n",
  e2ePath,
  "native release validation must be manually selectable",
);
forbidText(
  e2e,
  "\n  pull_request:\n",
  e2ePath,
  "native E2E must not run on every PR",
);
forbidText(
  e2e,
  "\n  schedule:\n",
  e2ePath,
  "native E2E must not consume scheduled minutes",
);
forbidText(
  e2e,
  "\n  push:\n",
  e2ePath,
  "native E2E must not run on every push",
);
for (const platform of ["macos-15", "macos-15-intel", "windows-latest"]) {
  requireText(
    e2e,
    platform,
    e2ePath,
    `manual release matrix is missing ${platform}`,
  );
}
requireText(
  e2e,
  "build_installers",
  e2ePath,
  "installer generation must remain available manually",
);
requireText(
  e2e,
  "if: failure()",
  e2ePath,
  "diagnostic artifacts must be failure-only",
);
requireText(
  e2e,
  "retention-days: 7",
  e2ePath,
  "artifacts must use short retention",
);

const monthlyIntervals = dependabot.match(/interval: monthly/g)?.length ?? 0;
if (monthlyIntervals !== 3) {
  errors.push(
    `${dependabotPath}: all three ecosystems must use monthly grouped updates`,
  );
}
forbidText(
  dependabot,
  "interval: weekly",
  dependabotPath,
  "weekly version PRs consume unnecessary personal CI",
);

if (errors.length > 0) {
  console.error("Workflow policy verification failed:");
  for (const error of errors) console.error(`- ${error}`);
  process.exit(1);
}

console.log(
  "Workflow policy verification passed: PR quality is lean and release validation remains manual.",
);
