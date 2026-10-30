#!/usr/bin/env node
import process from "node:process";
import path from "node:path";
import { fileURLToPath } from "node:url";

const MINIMUM = Object.freeze({ major: 22, minor: 23, patch: 4 });
const NODE_VERSION_PATTERN = /^v?(0|[1-9]\d*)\.(0|[1-9]\d*)\.(0|[1-9]\d*)$/u;

export function supportsNodeRuntime(version) {
  if (typeof version !== "string") return false;
  const match = NODE_VERSION_PATTERN.exec(version);
  if (!match) return false;

  const [, majorText, minorText, patchText] = match;
  const major = Number(majorText);
  const minor = Number(minorText);
  const patch = Number(patchText);
  if (![major, minor, patch].every(Number.isSafeInteger)) return false;

  return (
    major === MINIMUM.major &&
    (minor > MINIMUM.minor || (minor === MINIMUM.minor && patch >= MINIMUM.patch))
  );
}

export function verifyNodeRuntime(version = process.version, { output = console } = {}) {
  if (!supportsNodeRuntime(version)) {
    output.error(
      `Unsupported Node.js runtime ${String(version)}. Use stable Node.js 22.23.4 or later within major 22.`,
    );
    return false;
  }

  output.log(`Node.js ${version} satisfies the supported runtime policy.`);
  return true;
}

const invokedPath = process.argv[1] ? path.resolve(process.argv[1]) : null;
if (invokedPath === fileURLToPath(import.meta.url) && !verifyNodeRuntime()) {
  process.exitCode = 1;
}
