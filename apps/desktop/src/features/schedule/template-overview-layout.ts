import type { DayTemplate } from "../../shared/contracts";
import {
  assignOverviewLevels,
  type MinuteInterval,
  type PositionedMinuteInterval,
} from "./overview-layout";

interface TemplateOverviewValue {
  block: TemplateBlock;
  continuesNextDay: boolean;
  startsBeforeWindow: boolean;
  continuesAfterWindow: boolean;
}

type TemplateBlock = DayTemplate["blocks"][number];

export interface TemplateOverviewLayoutItem extends PositionedMinuteInterval<TemplateOverviewValue> {
  block: TemplateBlock;
  continuesNextDay: boolean;
  startsBeforeWindow: boolean;
  continuesAfterWindow: boolean;
}

export function layoutTemplateBlocks(
  blocks: TemplateBlock[],
  visibleStartMinute = 0,
): TemplateOverviewLayoutItem[] {
  const windowEndMinute = visibleStartMinute + 1440;
  const intervals: MinuteInterval<TemplateOverviewValue>[] = [];
  for (const block of blocks) {
    for (const occurrenceDay of [-1, 0, 1]) {
      const occurrenceStart = block.startMinute + occurrenceDay * 1440;
      const occurrenceEnd = occurrenceStart + block.durationMinutes;
      const continuesNextDay =
        occurrenceDay >= 0 && block.startMinute + block.durationMinutes > 1440;
      const clippedStart = Math.max(occurrenceStart, visibleStartMinute);
      const clippedEnd = Math.min(occurrenceEnd, windowEndMinute);
      if (clippedStart >= clippedEnd) continue;
      intervals.push({
        key: `${block.id}-${occurrenceDay}`,
        value: {
          block,
          continuesNextDay,
          startsBeforeWindow: clippedStart > occurrenceStart,
          continuesAfterWindow: clippedEnd < occurrenceEnd,
        },
        startMinute: clippedStart - visibleStartMinute,
        endMinute: clippedEnd - visibleStartMinute,
        stableOrder: block.sortOrder * 3 + occurrenceDay + 1,
      });
    }
  }

  return assignOverviewLevels(intervals, 5).map((item) => ({
    ...item,
    block: item.value.block,
    continuesNextDay: item.value.continuesNextDay,
    startsBeforeWindow: item.value.startsBeforeWindow,
    continuesAfterWindow: item.value.continuesAfterWindow,
  }));
}
