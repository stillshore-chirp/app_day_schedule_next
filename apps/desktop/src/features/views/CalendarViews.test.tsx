import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { fireEvent, render, screen, waitFor, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { describe, expect, it } from "vitest";
import type { ScheduleDraft } from "../../shared/contracts";
import { MemoryAppClient } from "../../shared/ipc/memory-client";
import { ListView } from "./CalendarViews";

function scheduleDraft(title: string, startUtc: string, project: string): ScheduleDraft {
  return {
    title,
    description: "synthetic fixture",
    location: "",
    startUtc,
    endUtc: new Date(Date.parse(startUtc) + 60 * 60 * 1000).toISOString(),
    timezoneId: "Asia/Tokyo",
    allDay: false,
    allDayStartDate: null,
    allDayEndDateExclusive: null,
    status: "scheduled",
    project,
    category: "既存カテゴリ",
    tags: [`${title}-既存タグ`],
    color: "#336699",
    priority: "high",
    recurrenceRule: null,
    recurrenceSupplementalLines: [],
    recurrenceExdates: [],
    startNotificationMinutes: null,
    endNotificationMinutes: null,
  };
}

describe("ListView bulk classification", () => {
  it("updates only selected schedules and enabled fields", async () => {
    const client = new MemoryAppClient([]);
    const selectedBefore = await client.createSchedule(
      scheduleDraft("選択対象", "2026-08-03T09:00:00.000Z", "旧プロジェクト"),
    );
    const untouchedBefore = await client.createSchedule(
      scheduleDraft("未選択", "2026-08-03T11:00:00.000Z", "別プロジェクト"),
    );
    const user = userEvent.setup();
    const queryClient = new QueryClient({ defaultOptions: { queries: { retry: false } } });

    render(
      <QueryClientProvider client={queryClient}>
        <ListView client={client} />
      </QueryClientProvider>,
    );

    fireEvent.change(screen.getByLabelText(/開始日/), { target: { value: "2026-08-02" } });
    fireEvent.change(screen.getByLabelText(/終了日/), { target: { value: "2026-08-04" } });

    const selectedToggle = await screen.findByRole("checkbox", {
      name: "選択対象を一括変更の対象にする",
    });
    const untouchedToggle = screen.getByRole("checkbox", {
      name: "未選択を一括変更の対象にする",
    });
    const bulk = screen.getByRole("group", { name: "選択した予定の分類を一括変更" });

    await user.click(selectedToggle);
    expect(selectedToggle).toBeChecked();
    expect(untouchedToggle).not.toBeChecked();

    const projectToggle = within(bulk).getByRole("checkbox", { name: "プロジェクトを変更" });
    await user.click(projectToggle);
    const projectField = projectToggle.closest(".bulk-classification__field");
    expect(projectField).not.toBeNull();
    await user.type(within(projectField as HTMLElement).getByRole("textbox"), "  新プロジェクト  ");

    const tagsToggle = within(bulk).getByRole("checkbox", {
      name: "タグ（カンマ区切り）を変更",
    });
    await user.click(tagsToggle);
    const tagsField = tagsToggle.closest(".bulk-classification__field");
    expect(tagsField).not.toBeNull();
    await user.type(within(tagsField as HTMLElement).getByRole("textbox"), "alpha, , beta, alpha");

    await user.click(within(bulk).getByRole("button", { name: /一括適用/ }));
    expect(await screen.findByText(/1件の分類を一括変更しました/)).toBeVisible();
    await waitFor(() =>
      expect(
        screen.getByRole("checkbox", { name: "選択対象を一括変更の対象にする" }),
      ).not.toBeChecked(),
    );

    const after = await client.listSchedules({
      startUtc: "2026-08-01T00:00:00.000Z",
      endUtc: "2026-08-06T00:00:00.000Z",
    });
    const selectedAfter = after.items.find((schedule) => schedule.id === selectedBefore.id);
    const untouchedAfter = after.items.find((schedule) => schedule.id === untouchedBefore.id);

    expect(selectedAfter).toEqual({
      ...selectedBefore,
      project: "新プロジェクト",
      tags: ["alpha", "beta"],
      version: selectedBefore.version + 1,
    });
    expect(untouchedAfter).toEqual(untouchedBefore);
  });
});
