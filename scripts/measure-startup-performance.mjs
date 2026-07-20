import { spawn } from "node:child_process";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";

const [binaryArgument, outputArgument] = process.argv.slice(2);
if (!binaryArgument || !outputArgument) {
  console.error(
    "usage: node scripts/measure-startup-performance.mjs <e2e-release-binary> <output-json>",
  );
  process.exit(2);
}

const binary = path.resolve(binaryArgument);
const output = path.resolve(outputArgument);
const runs = 30;
const timeoutMs = 15_000;
const temporaryRoot = fs.mkdtempSync(path.join(os.tmpdir(), "day-schedule-startup-"));

function percentile95(values) {
  const ordered = [...values].sort((left, right) => left - right);
  return ordered[Math.ceil(ordered.length * 0.95) - 1];
}

async function launch(dataDirectory) {
  fs.mkdirSync(dataDirectory, { recursive: true });
  return new Promise((resolve, reject) => {
    const child = spawn(binary, [], {
      env: {
        ...process.env,
        DAY_SCHEDULE_PERF_LOG: "1",
        DAY_SCHEDULE_TEST_DATA_DIR: dataDirectory,
      },
      stdio: ["ignore", "pipe", "pipe"],
    });
    let settled = false;
    let outputBuffer = "";
    const finish = (error, value) => {
      if (settled) return;
      settled = true;
      clearTimeout(timer);
      if (!child.killed) child.kill("SIGTERM");
      if (error) reject(error);
      else resolve(value);
    };
    const inspect = (chunk) => {
      outputBuffer += chunk.toString();
      const match = outputBuffer.match(/DAY_SCHEDULE_UI_READY_MS=(\d+)/);
      if (match) finish(null, Number(match[1]));
    };
    child.stdout.on("data", inspect);
    child.stderr.on("data", inspect);
    child.on("error", (error) => finish(error));
    child.on("exit", (code) => {
      if (!settled) finish(new Error(`application exited before ready marker: ${code}`));
    });
    const timer = setTimeout(
      () => finish(new Error(`UI ready marker timed out after ${timeoutMs}ms`)),
      timeoutMs,
    );
  });
}

async function measuredLaunch(dataDirectory) {
  const elapsed = await launch(dataDirectory);
  await new Promise((resolve) => setTimeout(resolve, 250));
  return elapsed;
}

async function measure() {
  if (!fs.statSync(binary).isFile()) throw new Error("measurement binary is not a file");
  const warmDirectory = path.join(temporaryRoot, "warm-profile");
  await measuredLaunch(warmDirectory);
  const warm = [];
  for (let index = 0; index < runs; index += 1) {
    warm.push(await measuredLaunch(warmDirectory));
  }
  const cold = [];
  for (let index = 0; index < runs; index += 1) {
    cold.push(await measuredLaunch(path.join(temporaryRoot, `fresh-profile-${index}`)));
  }
  const result = {
    schemaVersion: 1,
    measuredAtUtc: new Date().toISOString(),
    platform: process.platform,
    architecture: process.arch,
    cpuModel: os.cpus()[0]?.model ?? "unknown",
    sampleCount: runs,
    definition: {
      ready: "process entry to the first React effect after successful bootstrap is rendered",
      warm: "same synthetic profile after one uncounted warm-up launch",
      cold: "fresh synthetic application-data directory for every launch",
    },
    thresholdsMs: { warmP95: 1500, coldP95: 2500 },
    warm: { samplesMs: warm, p95Ms: percentile95(warm) },
    cold: { samplesMs: cold, p95Ms: percentile95(cold) },
  };
  fs.mkdirSync(path.dirname(output), { recursive: true });
  fs.writeFileSync(output, `${JSON.stringify(result, null, 2)}\n`);
  console.log(JSON.stringify(result, null, 2));
  if (result.warm.p95Ms > result.thresholdsMs.warmP95) process.exitCode = 1;
  if (result.cold.p95Ms > result.thresholdsMs.coldP95) process.exitCode = 1;
}

try {
  await measure();
} finally {
  fs.rmSync(temporaryRoot, { recursive: true, force: true });
}
