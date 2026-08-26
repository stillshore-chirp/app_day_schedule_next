import { spawn } from "node:child_process";
import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";

const pnpmExecutable = process.platform === "win32" ? "pnpm.cmd" : "pnpm";

function runPhase(phase: "persist" | "restore", dataDirectory: string): Promise<void> {
  return new Promise((resolve, reject) => {
    const child = spawn(pnpmExecutable, ["exec", "wdio", "run", "wdio.restart.conf.ts"], {
      env: {
        ...process.env,
        DAY_SCHEDULE_TEST_DATA_DIR: dataDirectory,
        TEXT_SCALE_RESTART_PHASE: phase,
      },
      shell: process.platform === "win32",
      stdio: "inherit",
    });
    child.once("error", reject);
    child.once("exit", (code, signal) => {
      if (code === 0) {
        resolve();
        return;
      }
      reject(
        new Error(
          `Text scale restart ${phase} phase failed (${signal ? `signal ${signal}` : `exit ${code}`})`,
        ),
      );
    });
  });
}

async function main(): Promise<void> {
  const dataDirectory = await mkdtemp(path.join(tmpdir(), "day-schedule-text-scale-restart-"));
  try {
    await runPhase("persist", dataDirectory);
    await runPhase("restore", dataDirectory);
  } finally {
    await rm(dataDirectory, { recursive: true, force: true });
  }
}

void main();
