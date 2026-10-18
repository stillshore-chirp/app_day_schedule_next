import { describe, expect, it } from "vitest";
import type { QuickBlock } from "../../shared/contracts";
import { quickBlocksForInstantRange } from "./quick-block-schedules";

const timezoneEdgeBlock: QuickBlock = {
  id: "00000000-0000-4000-8000-000000000091",
  title: "Timezone boundary",
  startMinute: 0,
  durationMinutes: 60,
  timezoneId: "Pacific/Kiritimati",
  color: "#6F96F4",
  project: "",
  category: "",
  startNotificationMinutes: null,
  endNotificationMinutes: null,
  isActive: true,
  sortOrder: 0,
  version: 0,
};

describe("quickBlocksForInstantRange", () => {
  it("includes a timezone-ahead occurrence when its UTC instant overlaps the window", () => {
    const range = {
      startUtc: "2026-07-20T10:00:00.000Z",
      endUtc: "2026-07-20T12:00:00.000Z",
    };

    expect(
      quickBlocksForInstantRange([timezoneEdgeBlock], range).map((item) => [
        item.startUtc,
        item.endUtc,
      ]),
    ).toEqual([["2026-07-20T10:00:00.000Z", "2026-07-20T11:00:00.000Z"]]);
  });

  it("keeps a maximum-duration occurrence when only its tail overlaps the window", () => {
    const range = {
      startUtc: "2026-07-20T10:00:00.000Z",
      endUtc: "2026-07-20T12:00:00.000Z",
    };

    expect(
      quickBlocksForInstantRange([{ ...timezoneEdgeBlock, durationMinutes: 1440 }], range).map(
        (item) => [item.startUtc, item.endUtc],
      ),
    ).toEqual([["2026-07-20T10:00:00.000Z", "2026-07-21T10:00:00.000Z"]]);
  });
});
