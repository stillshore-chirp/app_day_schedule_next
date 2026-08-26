import { config as baseConfig } from "./wdio.conf";

const phase = process.env.TEXT_SCALE_RESTART_PHASE;
if (phase !== "persist" && phase !== "restore") {
  throw new Error("TEXT_SCALE_RESTART_PHASE must be persist or restore");
}

export const config: WebdriverIO.Config = {
  ...baseConfig,
  specs: [`./tests/e2e/text-scale-restart.${phase}.e2e.ts`],
};
