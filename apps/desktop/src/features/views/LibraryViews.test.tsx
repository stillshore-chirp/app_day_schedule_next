import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import {
  createEvent,
  fireEvent,
  render,
  screen,
  waitFor,
  within,
  cleanup,
} from "@testing-library/react";
import { afterEach, describe, expect, it } from "vitest";
import type { DayTemplateDraft } from "../../shared/contracts";
import { MemoryAppClient } from "../../shared/ipc/memory-client";
import { TemplatesView } from "./LibraryViews";

afterEach(cleanup);

const templateDraft: DayTemplateDraft = {
  name: "編集用テンプレート",
  description: "時刻編集のfixture",
  color: "#6F96F4",
  weekdaysMask: 127,
  blocks: [
    {
      title: "集中作業",
      startMinute: 540,
      durationMinutes: 30,
      color: "#336699",
      project: "Project A",
      category: "作業",
    },
  ],
};

async function renderTemplateEditor(draft: DayTemplateDraft = templateDraft) {
  const client = new MemoryAppClient([]);
  const saved = await client.saveTemplate({ draft });
  const bootstrap = await client.bootstrap();
  await client.updateSettings({ ...bootstrap.settings, lastTemplateId: saved.id });
  const selectedBootstrap = await client.bootstrap();
  const queryClient = new QueryClient({ defaultOptions: { queries: { retry: false } } });

  render(
    <QueryClientProvider client={queryClient}>
      <TemplatesView
        client={client}
        timezoneId="Asia/Tokyo"
        settings={selectedBootstrap.settings}
      />
    </QueryClientProvider>,
  );

  const card = await screen.findByRole("group", { name: /ブロック 1：/ });
  return { card, client };
}

function timeInput(card: HTMLElement, suffix: "start" | "end") {
  return card.querySelector(`input[id$="-${suffix}-time"]`) as HTMLInputElement;
}

function rangeInput(card: HTMLElement, suffix: "start" | "end") {
  return card.querySelector(`input[id$="-${suffix}-range"]`) as HTMLInputElement;
}

function expectLegalRangeValue(input: HTMLInputElement) {
  const value = Number(input.value);
  const min = Number(input.min);
  const max = Number(input.max);
  expect(value).toBeGreaterThanOrEqual(min);
  expect(value).toBeLessThanOrEqual(max);
  expect((value - min) % 10).toBe(0);
}

describe("TemplatesView block time editor", () => {
  it("keeps direct minute values, aligns range bounds, and updates duration from the end", async () => {
    const { card, client } = await renderTemplateEditor();
    const start = timeInput(card, "start");
    const end = timeInput(card, "end");
    const startRange = rangeInput(card, "start");
    const endRange = rangeInput(card, "end");

    expect(within(card).getByLabelText("タイトル")).toHaveValue("集中作業");
    expect(within(card).getByLabelText("色")).toHaveValue("#336699");
    expect(within(card).getByLabelText("プロジェクト")).toHaveValue("Project A");
    expect(within(card).getByLabelText("カテゴリ")).toHaveValue("作業");
    expect(within(card).getAllByRole("button")).toHaveLength(4);
    expect(start).toHaveAttribute("type", "time");
    expect(start).toHaveAttribute("step", "60");
    expect(end).toHaveAttribute("step", "60");
    expect(startRange).toHaveAttribute("step", "10");
    expect(endRange).toHaveAttribute("step", "10");
    expect(
      Array.from(
        card.querySelectorAll(".template-minute-control__controls")[0]!.querySelectorAll("input"),
      ).map((input) => input.type),
    ).toEqual(["range", "time"]);

    fireEvent.change(start, { target: { value: "10:07" } });
    expect(start).toHaveValue("10:07");
    expect(end).toHaveValue("10:37");

    const startRight = createEvent.keyDown(startRange, { key: "ArrowRight" });
    fireEvent(startRange, startRight);
    expect(startRight.defaultPrevented).toBe(true);
    expect(startRange).toHaveValue("617");
    expect(start).toHaveValue("10:17");
    expect(end).toHaveValue("10:47");
    const startLeft = createEvent.keyDown(startRange, { key: "ArrowLeft" });
    fireEvent(startRange, startLeft);
    expect(startLeft.defaultPrevented).toBe(true);
    expect(startRange).toHaveValue("607");
    expect(start).toHaveValue("10:07");
    expect(end).toHaveValue("10:37");

    fireEvent.change(start, { target: { value: "" } });
    expect(start).toHaveValue("10:07");
    fireEvent.change(start, { target: { value: "25:99" } });
    expect(start).toHaveValue("10:07");

    fireEvent.change(end, { target: { value: "10:45" } });
    expect(end).toHaveValue("10:45");
    expect(endRange).toHaveValue("645");
    expect(startRange).toHaveAttribute("min", "7");
    expect(startRange).toHaveAttribute("max", "1437");
    expect(endRange).toHaveAttribute("min", "615");
    expect(endRange).toHaveAttribute("max", "2045");
    expectLegalRangeValue(startRange);
    expectLegalRangeValue(endRange);
    const endRight = createEvent.keyDown(endRange, { key: "ArrowRight" });
    fireEvent(endRange, endRight);
    expect(endRight.defaultPrevented).toBe(true);
    expect(endRange).toHaveValue("655");
    expect(end).toHaveValue("10:55");
    const endLeft = createEvent.keyDown(endRange, { key: "ArrowLeft" });
    fireEvent(endRange, endLeft);
    expect(endLeft.defaultPrevented).toBe(true);
    expect(endRange).toHaveValue("645");
    expect(end).toHaveValue("10:45");
    fireEvent.click(screen.getByRole("button", { name: "テンプレートを保存" }));
    await waitFor(async () => {
      const templates = await client.listTemplates();
      expect(templates.find((item) => item.name === templateDraft.name)?.blocks[0]).toMatchObject({
        startMinute: 607,
        durationMinutes: 38,
      });
    });

    fireEvent.change(endRange, { target: { value: "655" } });
    expect(endRange).toHaveValue("655");
    expect(end).toHaveValue("10:55");
    expectLegalRangeValue(endRange);

    fireEvent.change(startRange, { target: { value: "617" } });
    expect(startRange).toHaveValue("617");
    expect(start).toHaveValue("10:17");
    expect(end).toHaveValue("11:05");
    expectLegalRangeValue(startRange);
    expect(endRange).toHaveAttribute("min", "625");
    expect(endRange).toHaveAttribute("max", "2055");
    expectLegalRangeValue(endRange);

    fireEvent.change(endRange, { target: { value: "675" } });
    expect(endRange).toHaveValue("675");
    expect(end).toHaveValue("11:15");
    expectLegalRangeValue(endRange);

    fireEvent.click(screen.getByRole("button", { name: "テンプレートを保存" }));
    await waitFor(async () => {
      const templates = await client.listTemplates();
      expect(templates.find((item) => item.name === templateDraft.name)?.blocks[0]).toMatchObject({
        startMinute: 617,
        durationMinutes: 58,
      });
    });
  });

  it("represents same-day, next-day, and 24-hour end values without rounding direct input", async () => {
    const { card, client } = await renderTemplateEditor({
      ...templateDraft,
      blocks: [{ ...templateDraft.blocks[0]!, startMinute: 1439, durationMinutes: 1 }],
    });
    const start = timeInput(card, "start");
    const end = timeInput(card, "end");
    const endRange = rangeInput(card, "end");

    expect(start).toHaveValue("23:59");
    expect(end).toHaveValue("00:00");
    expect(end).not.toHaveAttribute("aria-valuetext");
    expect(end).toHaveAttribute("aria-describedby", "template-block-0-time-help");
    expect(card.querySelector('output[for="template-block-0-end-time"]')).toHaveTextContent(
      "翌日 00:00",
    );
    expect(endRange).toHaveAttribute("aria-valuetext", "翌日 00:00");

    fireEvent.change(end, { target: { value: "23:59" } });
    expect(end).toHaveValue("23:59");
    expect(endRange).toHaveValue("2879");
    expect(endRange).toHaveAttribute("min", "1449");
    expect(endRange).toHaveAttribute("max", "2879");
    expectLegalRangeValue(endRange);
    expect(card.querySelector('output[for="template-block-0-end-time"]')).toHaveTextContent(
      "翌日 23:59",
    );
    fireEvent.click(screen.getByRole("button", { name: "テンプレートを保存" }));
    await waitFor(async () => {
      const templates = await client.listTemplates();
      expect(templates.find((item) => item.name === templateDraft.name)?.blocks[0]).toMatchObject({
        startMinute: 1439,
        durationMinutes: 1440,
      });
    });

    fireEvent.change(end, { target: { value: "00:00" } });
    expect(end).toHaveValue("00:00");
    expect(endRange).toHaveValue("1440");
    expect(card.querySelector('output[for="template-block-0-end-time"]')).toHaveTextContent(
      "翌日 00:00",
    );

    expect(screen.getByText(/開始 当日 23:59、終了 翌日 00:00。/)).toBeVisible();
    const directStart = within(card).getByLabelText("ブロック 1：集中作業の開始（直接入力）");
    directStart.focus();
    fireEvent.change(within(card).getByLabelText("タイトル"), {
      target: { value: "集中作業（更新）" },
    });
    expect(document.activeElement).toBe(directStart);
  });

  it("restores focus to the moved block action", async () => {
    await renderTemplateEditor({
      ...templateDraft,
      blocks: [
        { ...templateDraft.blocks[0]!, title: "朝", startMinute: 60 },
        { ...templateDraft.blocks[0]!, title: "昼", startMinute: 480 },
        { ...templateDraft.blocks[0]!, title: "夜", startMinute: 900 },
        { ...templateDraft.blocks[0]!, title: "深夜", startMinute: 1200 },
      ],
    });

    const night = screen.getByRole("group", { name: "ブロック 3：夜" });
    fireEvent.click(within(night).getByRole("button", { name: "夜を上へ移動" }));
    await waitFor(() =>
      expect(document.activeElement).toHaveAttribute("aria-label", "夜を上へ移動"),
    );

    const movedNight = screen.getByRole("group", { name: "ブロック 2：夜" });
    fireEvent.click(within(movedNight).getByRole("button", { name: "夜を下へ移動" }));
    await waitFor(() =>
      expect(document.activeElement).toHaveAttribute("aria-label", "夜を下へ移動"),
    );
  });

  it("gives duplicate-title blocks distinct time control labels", async () => {
    await renderTemplateEditor({
      ...templateDraft,
      blocks: [templateDraft.blocks[0]!, { ...templateDraft.blocks[0]!, startMinute: 600 }],
    });

    const cards = Array.from(document.querySelectorAll("fieldset.block-editor"));
    const directLabels = cards.flatMap((card) =>
      Array.from(card.querySelectorAll('input[type="time"]')).map((input) =>
        input.getAttribute("aria-label"),
      ),
    );
    const rangeLabels = cards.flatMap((card) =>
      Array.from(card.querySelectorAll('input[type="range"]')).map((input) =>
        input.getAttribute("aria-label"),
      ),
    );

    expect(cards).toHaveLength(2);
    expect(new Set(directLabels).size).toBe(4);
    expect(new Set(rangeLabels).size).toBe(4);
  });
});
