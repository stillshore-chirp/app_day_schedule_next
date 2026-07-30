import type { DayTemplate } from "../../shared/contracts";
import {
  assignOverviewLevels,
  type MinuteInterval,
  type PositionedMinuteInterval,
} from "./overview-layout";

interface TemplateOverviewValue {
  block: TemplateBlock;
  continuesNextDay: boolean;
}

type TemplateBlock = DayTemplate["blocks"][number];

export interface TemplateOverviewLayoutItem extends PositionedMinuteInterval<TemplateOverviewValue> {
  block: TemplateBlock;
  continuesNextDay: boolean;
}

export function layoutTemplateBlocks(blocks: TemplateBlock[]): TemplateOverviewLayoutItem[] {
  const intervals = blocks.map((block): MinuteInterval<TemplateOverviewValue> => {
    const continuesNextDay = block.startMinute + block.durationMinutes > 1440;
    return {
      key: block.id,
      value: { block, continuesNextDay },
      startMinute: block.startMinute,
      endMinute: Math.min(block.startMinute + block.durationMinutes, 1440),
      stableOrder: block.sortOrder,
    };
  });

  return assignOverviewLevels(intervals, 5).map((item) => ({
    ...item,
    block: item.value.block,
    continuesNextDay: item.value.continuesNextDay,
  }));
}
