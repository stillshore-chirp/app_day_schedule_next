import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { act, cleanup, render, screen, within } from "@testing-library/react";
import axe from "axe-core";
import { afterEach, describe, expect, it } from "vitest";
import type { DayTemplateDraft } from "../../shared/contracts";
import { MemoryAppClient } from "../../shared/ipc/memory-client";
import { TemplatesView } from "./LibraryViews";

afterEach(cleanup);

const templateDraft: DayTemplateDraft = {
  name: "アクセシビリティ用テンプレート",
  description: "synthetic fixture",
  color: "#6F96F4",
  weekdaysMask: 127,
  blocks: [
    {
      title: "集中作業",
      startMinute: 540,
      durationMinutes: 30,
      color: "#336699",
      project: "synthetic",
      category: "evidence",
    },
  ],
};

async function renderTemplateEditor() {
  const client = new MemoryAppClient([]);
  const saved = await client.saveTemplate({ draft: templateDraft });
  const bootstrap = await client.bootstrap();
  await client.updateSettings({ ...bootstrap.settings, lastTemplateId: saved.id });
  const selectedBootstrap = await client.bootstrap();
  const queryClient = new QueryClient({ defaultOptions: { queries: { retry: false } } });

  const rendered = render(
    <QueryClientProvider client={queryClient}>
      <TemplatesView
        client={client}
        timezoneId="Asia/Tokyo"
        settings={selectedBootstrap.settings}
      />
    </QueryClientProvider>,
  );

  const card = await screen.findByRole("group", { name: "ブロック 1：集中作業" });
  return { ...rendered, card };
}

describe("TemplatesView accessibility", () => {
  it("exposes uniquely named time controls with keyboard focus and no serious violations", async () => {
    const { card, container } = await renderTemplateEditor();
    const ranges = within(card).getAllByRole("slider");
    const directInputs = Array.from(card.querySelectorAll<HTMLInputElement>('input[type="time"]'));

    expect(ranges).toHaveLength(2);
    expect(directInputs).toHaveLength(2);
    expect(new Set(ranges.map((control) => control.getAttribute("aria-label"))).size).toBe(2);
    expect(new Set(directInputs.map((control) => control.getAttribute("aria-label"))).size).toBe(2);
    expect(ranges.every((control) => control.getAttribute("step") === "10")).toBe(true);
    expect(directInputs.every((control) => control.getAttribute("step") === "60")).toBe(true);

    for (const control of [...ranges, ...directInputs]) {
      control.focus();
      expect(document.activeElement).toBe(control);
    }

    const result = await act(() =>
      axe.run(container, {
        runOnly: {
          type: "tag",
          values: ["wcag2a", "wcag2aa", "wcag21aa", "wcag22aa"],
        },
        rules: { "color-contrast": { enabled: false } },
      }),
    );
    expect(
      result.violations.filter((violation) =>
        ["serious", "critical"].includes(violation.impact ?? ""),
      ),
    ).toEqual([]);
  });
});
