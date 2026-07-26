import { spawnSync } from "node:child_process";

const result = spawnSync(
  "cargo",
  [
    "run",
    "--manifest-path",
    "apps/desktop/src-tauri/Cargo.toml",
    "--bin",
    "provision-google-oauth",
  ],
  {
    cwd: process.cwd(),
    env: process.env,
    stdio: "inherit",
  },
);

if (result.error || result.status !== 0) {
  process.exit(result.status ?? 1);
}
