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

  it("keeps a daily cross-midnight block on both sides of the 00:00 window", () => {
    const result = layoutTemplateBlocks([block("00000000-0000-4000-8000-000000000001", 1439, 60)]);
    expect(result).toHaveLength(2);
    expect(result[0]).toMatchObject({
      startMinute: 0,
      endMinute: 59,
      continuesNextDay: false,
    });
    expect(result[1]).toMatchObject({
      startMinute: 1439,
      endMinute: 1440,
      continuesNextDay: true,
    });
  });

  it("rotates a daily block across both edges of a 07:00 window", () => {
    const result = layoutTemplateBlocks(
      [block("00000000-0000-4000-8000-000000000001", 6 * 60 + 30, 90)],
      7 * 60,
    );
    expect(
      result.map(
        ({
          startMinute,
          endMinute,
          continuesNextDay,
          startsBeforeWindow,
          continuesAfterWindow,
        }) => [startMinute, endMinute, continuesNextDay, startsBeforeWindow, continuesAfterWindow],
      ),
    ).toEqual([
      [0, 60, false, true, false],
      [1410, 1440, false, false, true],
    ]);
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
