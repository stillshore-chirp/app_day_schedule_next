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
});
