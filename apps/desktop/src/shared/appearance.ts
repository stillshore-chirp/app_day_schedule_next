import type { Settings } from "./contracts";

const typographyRatios = [
  0.375, 0.6, 0.61, 0.62, 0.65, 0.66, 0.68, 0.7, 0.72, 0.74, 0.75, 0.76, 0.78, 0.8, 0.8125, 0.82,
  0.88, 0.9, 0.95, 1, 1.05, 1.08, 1.1, 1.15, 1.2, 1.25, 1.3, 1.35, 1.4, 1.45, 1.5, 1.6, 1.65, 1.7,
  1.8, 2.2, 2.8, 3, 3.5, 6,
] as const;

function typographyVariable(ratio: number): string {
  return `--app-font-${String(ratio).replace(".", "-")}`;
}

export function applyAppAppearance(settings: Pick<Settings, "theme" | "textScalePercent">): void {
  const textScaleFactor = settings.textScalePercent / 100;
  const textScaleLevel =
    settings.textScalePercent >= 200
      ? "extra"
      : settings.textScalePercent >= 175
        ? "high"
        : "normal";
  document.documentElement.dataset.theme = settings.theme;
  document.documentElement.dataset.textScale = String(settings.textScalePercent);
  document.documentElement.dataset.textScaleLevel = textScaleLevel;
  document.documentElement.style.setProperty(
    "--app-font-scale-percent",
    `${settings.textScalePercent}%`,
  );
  document.documentElement.style.setProperty("--app-font-scale-factor", String(textScaleFactor));
  for (const ratio of typographyRatios) {
    document.documentElement.style.setProperty(
      typographyVariable(ratio),
      `${16 * ratio * textScaleFactor}px`,
    );
  }
  for (const viewportRatio of [1.7, 3, 5, 6, 9]) {
    document.documentElement.style.setProperty(
      `--app-font-fluid-${String(viewportRatio).replace(".", "-")}`,
      `${viewportRatio * textScaleFactor}vw`,
    );
  }
}
