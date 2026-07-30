import { describe, expect, it } from "vitest";
import type { DayTemplate } from "../../shared/contracts";
import { layoutTemplateBlocks } from "./template-overview-layout";

type TemplateBlock = DayTemplate["blocks"][number];

function block(
  id: string,
  startMinute: number,
  durationMinutes: number,
  sortOrder = 0,
): TemplateBlock {
  return {
    id,
    title: id,
    startMinute,
    durationMinutes,
    color: "#6F96F4",
    project: "",
    category: "",
    sortOrder,
  };
}

describe("layoutTemplateBlocks", () => {
  it("uses minute-of-day values directly and preserves a one-minute interval", () => {
    const result = layoutTemplateBlocks([block("00000000-0000-4000-8000-000000000001", 720, 1)]);
    expect(result[0]).toMatchObject({
      startMinute: 720,
      endMinute: 721,
      continuesNextDay: false,
    });
  });

  it("clamps at 24:00 and marks continuation without wrapping", () => {
    const result = layoutTemplateBlocks([block("00000000-0000-4000-8000-000000000001", 1439, 60)]);
    expect(result).toHaveLength(1);
    expect(result[0]).toMatchObject({
      startMinute: 1439,
      endMinute: 1440,
      continuesNextDay: true,
    });
  });

  it("keeps template overlap assignment deterministic and independent", () => {
    const result = layoutTemplateBlocks([
      block("00000000-0000-4000-8000-000000000003", 600, 60, 2),
      block("00000000-0000-4000-8000-000000000002", 595, 30, 1),
      block("00000000-0000-4000-8000-000000000001", 540, 60, 0),
    ]);
    expect(result.map((item) => [item.block.sortOrder, item.level, item.levelCount])).toEqual([
      [0, 0, 2],
      [1, 1, 2],
      [2, 0, 2],
    ]);
  });

  it("retains all 500 blocks while exposing the overlap depth for summarization", () => {
    const result = layoutTemplateBlocks(
      Array.from({ length: 500 }, (_, index) =>
        block(`00000000-0000-4000-8000-${String(index).padStart(12, "0")}`, 600, 60, index),
      ),
    );
    expect(result).toHaveLength(500);
    expect(result.every((item) => item.levelCount === 500)).toBe(true);
    expect(result.at(-1)?.level).toBe(499);
  });
});
