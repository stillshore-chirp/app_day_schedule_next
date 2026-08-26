import { afterEach, describe, expect, it } from "vitest";
import { applyAppAppearance } from "./appearance";

afterEach(() => {
  delete document.documentElement.dataset.theme;
  delete document.documentElement.dataset.textScale;
  delete document.documentElement.dataset.textScaleLevel;
  document.documentElement.style.cssText = "";
});

describe("applyAppAppearance", () => {
  it.each([
    [100, "normal"],
    [125, "normal"],
    [150, "normal"],
    [175, "high"],
    [200, "extra"],
    [250, "extra"],
  ] as const)("maps %d%% to the %s layout level", (textScalePercent, expectedLevel) => {
    applyAppAppearance({ theme: "mild", textScalePercent });

    expect(document.documentElement.dataset.textScale).toBe(String(textScalePercent));
    expect(document.documentElement.dataset.textScaleLevel).toBe(expectedLevel);
    expect(document.documentElement.style.getPropertyValue("--app-font-scale-factor")).toBe(
      String(textScalePercent / 100),
    );
    expect(document.documentElement.style.getPropertyValue("--app-font-1")).toBe(
      `${textScalePercent * 0.16}px`,
    );
  });
});
