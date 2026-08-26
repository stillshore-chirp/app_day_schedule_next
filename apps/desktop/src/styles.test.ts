import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import { describe, expect, it } from "vitest";

const stylesheet = readFileSync(resolve(process.cwd(), "src/styles.css"), "utf8");

function declarations(selector: string): Map<string, string> {
  const escapedSelector = selector.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
  const match = stylesheet.match(new RegExp(`${escapedSelector}\\s*\\{([\\s\\S]*?)\\n\\}`));
  if (!match?.[1]) throw new Error(`${selector} declarations were not found`);
  const entries: Array<[string, string]> = [];
  for (const entry of match[1].matchAll(/(--[a-z-]+):\s*(#[0-9a-f]{6})\s*;/gi)) {
    if (entry[1] && entry[2]) entries.push([entry[1], entry[2]]);
  }
  return new Map(entries);
}

const base = declarations(":root");
const mild = new Map([...base, ...declarations(':root[data-theme="mild"]')]);

function luminance(color: string): number {
  const channels = color
    .slice(1)
    .match(/../g)
    ?.map((channel) => Number.parseInt(channel, 16));
  if (!channels || channels.length !== 3) throw new Error(`invalid color: ${color}`);
  const linearChannels = channels.map((channel) => {
    const value = channel / 255;
    return value <= 0.04045 ? value / 12.92 : ((value + 0.055) / 1.055) ** 2.4;
  });
  const red = linearChannels[0] ?? 0;
  const green = linearChannels[1] ?? 0;
  const blue = linearChannels[2] ?? 0;
  return 0.2126 * red + 0.7152 * green + 0.0722 * blue;
}

function contrast(foreground: string, background: string): number {
  const values = [luminance(foreground), luminance(background)].sort((left, right) => right - left);
  return ((values[0] ?? 0) + 0.05) / ((values[1] ?? 0) + 0.05);
}

function token(name: string): string {
  const value = mild.get(name);
  if (!value) throw new Error(`${name} is missing from the mild theme`);
  return value;
}

describe("mild theme contrast", () => {
  it.each([
    ["--text", "--surface"],
    ["--text", "--surface-raised"],
    ["--text", "--surface-soft"],
    ["--text-muted", "--surface"],
    ["--text-muted", "--surface-soft"],
    ["--text-muted", "--success-soft"],
    ["--text-muted", "--warning-soft"],
    ["--text-muted", "--danger-soft"],
    ["--primary", "--primary-soft"],
    ["--on-accent", "--primary-action"],
    ["--on-accent", "--danger-action"],
    ["--state-chip-text", "--state-chip-background"],
    ["--state-chip-inverse-text", "--state-chip-inverse-background"],
    ["--dock-text", "--dock-surface"],
    ["--dock-muted", "--dock-surface"],
  ])("keeps %s readable on %s", (foreground, background) => {
    expect(contrast(token(foreground), token(background))).toBeGreaterThanOrEqual(4.5);
  });

  it.each([
    ["--border-strong", "--surface"],
    ["--border-strong", "--surface-soft"],
    ["--focus", "--canvas"],
    ["--success", "--success-soft"],
    ["--warning", "--warning-soft"],
    ["--danger", "--danger-soft"],
    ["--state-chip-border", "--state-chip-background"],
    ["--state-chip-inverse-border", "--state-chip-inverse-background"],
  ])("keeps %s distinguishable from %s", (foreground, background) => {
    expect(contrast(token(foreground), token(background))).toBeGreaterThanOrEqual(3);
  });

  it("pins native WebView headings and the date control to the semantic text color", () => {
    expect(stylesheet).toMatch(/h1,\s*h2,\s*h3,\s*h4,\s*legend\s*{\s*color: var\(--text\);/);
    expect(stylesheet).toMatch(/\.date-navigation__date\s*{[^}]*color: var\(--text\);/s);
    expect(stylesheet).toMatch(/\.settings-view summary\s*{\s*color: var\(--text\);/);
    expect(stylesheet).toMatch(
      /\.status-message strong,\s*\.permission-state\s*{\s*color: var\(--text\);/,
    );
    expect(stylesheet).toMatch(
      /\.compact-header h1,\s*\.compact-current h2,\s*\.compact-next h2,\s*\.compact-agenda h2\s*{[^}]*color: var\(--text\);/s,
    );
  });

  it("clips overview titles without hiding them or adding an ellipsis", () => {
    const overviewStyles = stylesheet.slice(
      stylesheet.indexOf(".overview-event,"),
      stylesheet.indexOf(".overview-event[data-sync"),
    );
    expect(overviewStyles).toContain("text-overflow: clip;");
    expect(overviewStyles).not.toContain("text-overflow: ellipsis;");
    expect(overviewStyles).not.toContain("display: none;");
    expect(overviewStyles).toContain("@container (max-width: 140px)");
  });

  it("wraps high-scale overview lane headings inside their label column", () => {
    const highScaleOverviewStyles = stylesheet.slice(
      stylesheet.indexOf(':root[data-text-scale-level="high"] .overview'),
      stylesheet.indexOf(':root[data-text-scale-level="high"] .overview-tick'),
    );

    expect(highScaleOverviewStyles).toContain("--overview-lane-label-width: min(220px, 30vw);");
    expect(highScaleOverviewStyles).toContain("height: 1.5rem;");
    expect(highScaleOverviewStyles).toContain("margin-bottom: 0.5rem;");
    expect(highScaleOverviewStyles).toContain(".overview-lane__heading h3");
    expect(highScaleOverviewStyles).toContain("white-space: normal;");
  });

  it("keeps high-scale analog digital time below the corner controls without truncation", () => {
    const highScaleAnalogDigitalStyles = stylesheet.match(
      /:root\[data-text-scale-level="high"\][\s\S]*?\.analog-clock-digital\s*,[\s\S]*?\.analog-clock-digital\s*\{([\s\S]*?)\n\}/,
    )?.[1];

    expect(highScaleAnalogDigitalStyles).toBeDefined();
    expect(highScaleAnalogDigitalStyles).toContain("position: static;");
    expect(highScaleAnalogDigitalStyles).toContain("grid-row: 3;");
    expect(highScaleAnalogDigitalStyles).toContain("margin: 0 12px 12px;");
    expect(highScaleAnalogDigitalStyles).toContain("max-width: none;");
    expect(highScaleAnalogDigitalStyles).toContain("overflow: visible;");
    expect(highScaleAnalogDigitalStyles).toContain("text-overflow: clip;");
    expect(highScaleAnalogDigitalStyles).toContain("white-space: nowrap;");
  });

  it("lets the analog clock grid and face shrink to the secondary viewport", () => {
    expect(stylesheet).toContain("html,\nbody,\n#root {\n  min-width: 0;\n  min-height: 0;");
    expect(stylesheet).toContain(
      ':root[data-window-kind="main"] body,\n:root[data-window-kind="main"] #root {\n  min-width: 720px;\n  min-height: 600px;',
    );
    const shellStyles = stylesheet.match(/\.analog-clock-shell\s*\{([\s\S]*?)\n\}/)?.[1];
    const stageStyles = stylesheet.match(/\.analog-clock-stage\s*\{([\s\S]*?)\n\}/)?.[1];
    const faceStyles = stylesheet.match(/\.analog-clock-face--full\s*\{([\s\S]*?)\n\}/)?.[1];

    expect(shellStyles).toBeDefined();
    expect(shellStyles).toContain("width: 100%;");
    expect(shellStyles).toContain("min-width: 0;");
    expect(shellStyles).toContain("min-height: 0;");
    expect(stageStyles).toBeDefined();
    expect(stageStyles).toContain("width: 100%;");
    expect(stageStyles).toContain("height: 100%;");
    expect(stageStyles).toContain("min-width: 0;");
    expect(stageStyles).toContain("min-height: 0;");
    expect(faceStyles).toBeDefined();
    expect(faceStyles).toContain("max-width: 100%;");
    expect(faceStyles).toContain("max-height: 100%;");
    expect(stylesheet).toContain(
      ".analog-clock-face__numbers,\n.analog-clock-face__numbers text {",
    );
  });

  it("keeps app tooltips in a scale-aware body layer", () => {
    const tooltipStyles = stylesheet.slice(
      stylesheet.indexOf(".app-tooltip {"),
      stylesheet.indexOf(".app-shell {"),
    );
    expect(tooltipStyles).toContain("position: fixed;");
    expect(tooltipStyles).toContain("max-width: min(24rem, calc(100vw - 1rem));");
    expect(tooltipStyles).toContain("font-size: var(--app-font-0-8125, 0.8125rem);");
    expect(tooltipStyles).toContain("overflow-wrap: anywhere;");
    expect(tooltipStyles).toContain("pointer-events: none;");
  });

  it("routes readable font sizes through the shared typography tokens", () => {
    expect(stylesheet).toContain(
      ".app-shell,\n.compact-shell,\n.analog-clock-shell,\n.boot-screen {\n  font-size: var(--app-font-1, 1rem);",
    );
    expect(stylesheet).not.toMatch(/font-size:\s*[0-9.]+rem\s*;/);
  });

  it("lets high-scale compact content shrink and wrap inside the narrow window", () => {
    expect(stylesheet).toContain(
      ':root[data-text-scale-level="high"] .compact-shell > *,\n:root[data-text-scale-level="extra"] .compact-shell > * {\n  min-width: 0;',
    );
    expect(stylesheet).toContain(
      ':root[data-text-scale-level="extra"] .compact-actions .button {\n  max-width: 100%;',
    );
  });

  it("keeps selectors compatible with Safari 13", () => {
    expect(stylesheet).not.toContain(`:${"is"}(`);
    expect(stylesheet).toContain(':root[data-text-scale-level="high"]');
    expect(stylesheet).toContain(':root[data-text-scale-level="extra"]');
    expect(stylesheet).toContain(':root[data-window-kind="main"]');
  });
});
