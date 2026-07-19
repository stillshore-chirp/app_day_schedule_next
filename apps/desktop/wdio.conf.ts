import path from "node:path";
import { mkdir } from "node:fs/promises";
import "@wdio/tauri-service";

const executable = process.platform === "win32" ? "day-schedule-next.exe" : "day-schedule-next";
const appBinaryPath = path.resolve("../../target/debug", executable);

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
  mochaOpts: { ui: "bdd", timeout: 90_000 },
  onPrepare: async () => {
    await mkdir(path.resolve("./test-results"), { recursive: true });
  },
};
