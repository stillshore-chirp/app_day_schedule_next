#!/usr/bin/env node
import assert from "node:assert/strict";
import fs from "node:fs";
import path from "node:path";
import { createRequire } from "node:module";
import { pathToFileURL } from "node:url";

const storeDirectory = path.join(process.cwd(), "node_modules", ".pnpm");
assert.ok(
  fs.existsSync(storeDirectory),
  "node_modules is missing; run pnpm install --frozen-lockfile first"
);

const minimatchDirectories = fs
  .readdirSync(storeDirectory)
  .filter((entry) => entry.startsWith("minimatch@"))
  .map((entry) => path.join(storeDirectory, entry, "node_modules", "minimatch"))
  .filter((directory) => fs.existsSync(path.join(directory, "package.json")));

assert.ok(
  minimatchDirectories.length > 0,
  "no installed minimatch packages were found"
);

const verifiedVersions = new Set();
for (const minimatchDirectory of minimatchDirectories) {
  const packageJsonPath = path.join(minimatchDirectory, "package.json");
  const manifest = JSON.parse(fs.readFileSync(packageJsonPath, "utf8"));
  const localRequire = createRequire(packageJsonPath);
  const commonJsModule = localRequire(minimatchDirectory);
  const commonJsMatch =
    typeof commonJsModule === "function"
      ? commonJsModule
      : commonJsModule.minimatch;

  assert.equal(
    typeof commonJsMatch,
    "function",
    `minimatch ${manifest.version} has no CommonJS matcher export`
  );
  assert.equal(
    commonJsMatch("reports/success.json", "reports/{success,error}.json"),
    true,
    `minimatch ${manifest.version} CommonJS brace matching failed`
  );
  assert.deepEqual(
    commonJsModule.braceExpand("reports/{success,error}.json"),
    ["reports/success.json", "reports/error.json"],
    `minimatch ${manifest.version} CommonJS brace expansion failed`
  );

  const braceManifestPath = localRequire.resolve(
    "brace-expansion/package.json"
  );
  const braceManifest = JSON.parse(fs.readFileSync(braceManifestPath, "utf8"));
  assert.equal(
    braceManifest.version,
    "5.0.9",
    `minimatch ${manifest.version} resolved vulnerable brace-expansion ${braceManifest.version}`
  );

  if (manifest.module) {
    const esmModule = await import(
      pathToFileURL(path.join(minimatchDirectory, manifest.module)).href
    );
    const esmMatch = esmModule.minimatch ?? esmModule.default;
    assert.equal(
      esmMatch("reports/error.json", "reports/{success,error}.json"),
      true,
      `minimatch ${manifest.version} ESM brace matching failed`
    );
  }

  verifiedVersions.add(manifest.version);
}

console.log(
  `Patched dependency compatibility verified for minimatch ${[
    ...verifiedVersions,
  ]
    .sort()
    .join(", ")}`
);
