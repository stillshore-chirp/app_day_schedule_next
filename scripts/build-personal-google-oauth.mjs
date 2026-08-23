import { spawnSync } from "node:child_process";

const result = spawnSync("corepack", ["pnpm", "tauri:build:app:debug"], {
  cwd: process.cwd(),
  env: { ...process.env, CI: "true" },
  stdio: "inherit",
});

if (result.error || result.status !== 0) {
  process.exit(result.status ?? 1);
}
