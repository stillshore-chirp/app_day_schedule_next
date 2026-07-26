import path from "node:path";
import { mkdir, rm } from "node:fs/promises";
import { mkdtempSync } from "node:fs";
import { tmpdir } from "node:os";
import "@wdio/tauri-service";

const executable = process.platform === "win32" ? "day-schedule-next.exe" : "day-schedule-next";
const appBinaryPath = path.resolve("../../target/debug", executable);
const inheritedDataDirectory = process.env.DAY_SCHEDULE_TEST_DATA_DIR;
const ownsIsolatedDataDirectory = !inheritedDataDirectory;
const isolatedDataDirectory =
  inheritedDataDirectory ?? mkdtempSync(path.join(tmpdir(), "day-schedule-native-e2e-"));
process.env.DAY_SCHEDULE_TEST_DATA_DIR = isolatedDataDirectory;
if (ownsIsolatedDataDirectory) {
  process.once("beforeExit", () => {
    void rm(isolatedDataDirectory, { recursive: true, force: true }).catch((error: unknown) => {
      const code =
        typeof error === "object" && error !== null && "code" in error
          ? String(error.code)
          : "unknown";
      console.warn(`Isolated E2E data cleanup was deferred to the OS (${code}).`);
    });
  });
}

export const config: WebdriverIO.Config = {
  runner: "local",
  specs: ["./tests/e2e/**/*.e2e.ts"],
  maxInstances: 1,
  capabilities: [{ browserName: "tauri" }],
  services: [
    [
      "tauri",
      {
        appBinaryPath,
        driverProvider: "embedded",
        captureBackendLogs: true,
        captureFrontendLogs: true,
        logDir: path.resolve("./wdio-logs"),
        startTimeout: 60_000,
      },
    ],
  ],
  logLevel: "warn",
  bail: 0,
  waitforTimeout: 15_000,
  connectionRetryTimeout: 90_000,
  connectionRetryCount: 1,
  framework: "mocha",
  reporters: ["spec"],
  mochaOpts: { ui: "bdd", timeout: 180_000 },
  onPrepare: async () => {
    await mkdir(path.resolve("./test-results"), { recursive: true });
  },
};
