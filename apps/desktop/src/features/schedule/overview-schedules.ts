import type { Schedule, ScheduleQuery } from "../../shared/contracts";
import type { AppClient } from "../../shared/ipc/client";

const overviewSchedulePageSize = 500;

export async function fetchCenteredOverviewSchedules(
  client: Pick<AppClient, "listSchedules">,
  query: ScheduleQuery,
): Promise<{ items: Schedule[]; total: number }> {
  const firstPage = await client.listSchedules({
    ...query,
    limit: overviewSchedulePageSize,
    offset: 0,
  });
  const { total } = firstPage;
  if (firstPage.items.length === 0 || firstPage.items.length >= total) return firstPage;

  const items = [...firstPage.items];
  const seenOccurrences = new Set(items.map((schedule) => `${schedule.id}-${schedule.startUtc}`));
  let offset = firstPage.items.length;

  while (offset < total) {
    const page = await client.listSchedules({
      ...query,
      limit: overviewSchedulePageSize,
      offset,
    });
    if (page.items.length === 0) break;

    for (const schedule of page.items) {
      const occurrenceKey = `${schedule.id}-${schedule.startUtc}`;
      if (seenOccurrences.has(occurrenceKey)) continue;
      seenOccurrences.add(occurrenceKey);
      items.push(schedule);
    }
    offset += page.items.length;
  }

  return { items, total };
}
