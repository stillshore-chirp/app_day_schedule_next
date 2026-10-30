import assert from "node:assert/strict";
import fs from "node:fs";
import path from "node:path";
import test from "node:test";
import { fileURLToPath } from "node:url";
import { supportsNodeRuntime, verifyNodeRuntime } from "./verify-node-runtime.mjs";

const REPOSITORY_ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");

function readRepositoryFile(relativePath) {
  return fs.readFileSync(path.join(REPOSITORY_ROOT, relativePath), "utf8");
}

function workflowJobs(relativePath) {
  const content = readRepositoryFile(relativePath);
  const jobsStart = content.indexOf("\njobs:\n");
  assert.notEqual(jobsStart, -1, `${relativePath} has a jobs section`);

  const jobs = new Map();
  let currentJob = null;
  for (const line of content.slice(jobsStart).split("\n")) {
    const match = line.match(/^  ([A-Za-z0-9_-]+):\s*$/u);
    if (match) {
      currentJob = match[1];
      jobs.set(currentJob, []);
    } else if (currentJob) {
      jobs.get(currentJob).push(line);
    }
  }

  return new Map([...jobs].map(([name, lines]) => [name, lines.join("\n")]));
}

test("accepts only stable Node 22 at or above the patched minimum", () => {
  for (const version of ["v22.23.4", "22.23.4", "v22.24.0", "v22.99.99"]) {
    assert.equal(supportsNodeRuntime(version), true, version);
  }

  for (const version of [
    "v22.23.3",
    "v22.22.2",
    "v21.7.3",
    "v23.0.0",
    "v24.22.1",
    "v22.23.4-rc.1",
    "v22.23.4-pre",
    "22.23",
    "v22.999999999999999999999.0",
    "not-a-version",
    null,
  ]) {
    assert.equal(supportsNodeRuntime(version), false, String(version));
  }
});

test("runtime guard reports pass/fail without disclosing environment details", () => {
  const output = {
    errors: [],
    logs: [],
    error(message) {
      this.errors.push(message);
    },
    log(message) {
      this.logs.push(message);
    },
  };

  assert.equal(verifyNodeRuntime("v22.23.4", { output }), true);
  assert.deepEqual(output.errors, []);
  assert.equal(output.logs.length, 1);

  assert.equal(verifyNodeRuntime("v22.23.3", { output }), false);
  assert.equal(output.errors.length, 1);
  assert.match(output.errors[0], /v22\.23\.3/u);
  assert.doesNotMatch(output.errors[0], /\/Users\/|\/home\//u);
});

test("Node version source, package engine, and strict install policy agree", () => {
  const nodeVersion = readRepositoryFile(".nvmrc").trim();
  const packageManifest = JSON.parse(readRepositoryFile("package.json"));
  const npmConfig = readRepositoryFile(".npmrc");
  const workspaceConfig = readRepositoryFile("pnpm-workspace.yaml");

  assert.equal(nodeVersion, "22.23.4");
  assert.equal(packageManifest.engines?.node, "^22.23.4");
  assert.match(npmConfig, /^engine-strict=true\s*$/mu);
  assert.match(workspaceConfig, /^engineStrict:\s*true\s*$/mu);
  assert.equal(supportsNodeRuntime(`v${nodeVersion}`), true);
  assert.match(packageManifest.scripts["verify:bootstrap"], /^npm run verify:node-runtime &&/u);
  const desktopManifest = JSON.parse(readRepositoryFile("apps/desktop/package.json"));
  assert.match(
    desktopManifest.scripts["test:e2e"],
    /^node \.\.\/\.\.\/scripts\/verify-node-runtime\.mjs &&/u,
  );
});

test("every workflow Node job uses .nvmrc and verifies before registry downloads", () => {
  const workflows = [
    ".github/workflows/ci.yml",
    ".github/workflows/dependency-audit.yml",
    ".github/workflows/native-e2e.yml",
  ];

  for (const workflow of workflows) {
    const jobs = workflowJobs(workflow);
    const lines = readRepositoryFile(workflow).split("\n");
    for (let index = 0; index < lines.length; index += 1) {
      if (!lines[index].includes("uses: actions/setup-node@")) continue;
      const setupBlock = lines.slice(index, index + 5).join("\n");
      assert.match(setupBlock, /node-version-file:\s*["']?\.nvmrc["']?/u, workflow);
      assert.doesNotMatch(setupBlock, /node-version:\s*["']?\d/u, workflow);
    }

    for (const [jobName, body] of jobs) {
      const executesNode = /\b(?:node|npm|pnpm)\b/u.test(body);
      if (!executesNode) continue;
      assert.match(body, /uses: actions\/setup-node@/u, `${workflow}:${jobName} pins Node`);
      assert.match(body, /node-version-file:\s*["']?\.nvmrc["']?/u, `${workflow}:${jobName} uses .nvmrc`);

      const downloads = ["corepack prepare", "pnpm install"]
        .map((command) => body.indexOf(command))
        .filter((index) => index >= 0);
      if (downloads.length > 0) {
        const guard = body.indexOf("node scripts/verify-node-runtime.mjs");
        assert.notEqual(guard, -1, `${workflow}:${jobName} verifies Node before downloads`);
        assert.ok(downloads.every((index) => guard < index), `${workflow}:${jobName} verifies before each download`);
      }
    }
  }
});
