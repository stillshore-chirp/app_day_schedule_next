import type { DayTemplate } from "../../shared/contracts";
import { dateInputValue } from "../../shared/time";
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

export function layoutTemplateBlocksForInstantRange(
  blocks: TemplateBlock[],
  range: { startUtc: string; endUtc: string },
): TemplateOverviewLayoutItem[] {
  const windowStart = Date.parse(range.startUtc);
  const windowEnd = Date.parse(range.endUtc);
  const windowMinutes = (windowEnd - windowStart) / 60_000;
  if (!Number.isFinite(windowMinutes) || windowMinutes <= 0) return [];

  const firstDay = new Date(windowStart);
  firstDay.setHours(0, 0, 0, 0);
  firstDay.setDate(firstDay.getDate() - 1);
  const lastDay = new Date(windowEnd);
  lastDay.setHours(0, 0, 0, 0);
  const intervals: MinuteInterval<TemplateOverviewValue>[] = [];

  for (
    const occurrenceDay = new Date(firstDay);
    occurrenceDay <= lastDay;
    occurrenceDay.setDate(occurrenceDay.getDate() + 1)
  ) {
    const occurrenceDate = dateInputValue(occurrenceDay);
    for (const block of blocks) {
      const occurrenceStart = new Date(occurrenceDay);
      occurrenceStart.setHours(Math.floor(block.startMinute / 60), block.startMinute % 60, 0, 0);
      const occurrenceEnd = new Date(occurrenceStart.getTime() + block.durationMinutes * 60_000);
      const clippedStart = Math.max(occurrenceStart.getTime(), windowStart);
      const clippedEnd = Math.min(occurrenceEnd.getTime(), windowEnd);
      if (clippedStart >= clippedEnd) continue;
      const lastIncludedInstant = new Date(occurrenceEnd.getTime() - 1);
      intervals.push({
        key: `${block.id}-${occurrenceDate}`,
        value: {
          block,
          continuesNextDay: dateInputValue(lastIncludedInstant) !== occurrenceDate,
          startsBeforeWindow: clippedStart > occurrenceStart.getTime(),
          continuesAfterWindow: clippedEnd < occurrenceEnd.getTime(),
        },
        startMinute: (clippedStart - windowStart) / 60_000,
        endMinute: (clippedEnd - windowStart) / 60_000,
        stableOrder: `${String(block.sortOrder).padStart(6, "0")}-${occurrenceDate}`,
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
