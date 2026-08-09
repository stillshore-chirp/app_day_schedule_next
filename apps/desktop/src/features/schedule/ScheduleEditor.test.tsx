import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { render, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { describe, expect, it, vi } from "vitest";
import type { Schedule } from "../../shared/contracts";
import { MemoryAppClient } from "../../shared/ipc/memory-client";
import { ScheduleEditor } from "./ScheduleEditor";

const complexGoogleSchedule: Schedule = {
  id: "00000000-0000-4000-8000-000000000020",
  title: "複雑な繰り返し予定",
  description: "",
  location: "",
  startUtc: "2026-07-20T00:00:00.000Z",
  endUtc: "2026-07-20T01:00:00.000Z",
  timezoneId: "Asia/Tokyo",
  allDay: false,
  allDayStartDate: null,
  allDayEndDateExclusive: null,
  status: "scheduled",
  project: "",
  category: "",
  tags: [],
  color: "#336699",
  priority: "normal",
  recurrenceRule: "FREQ=DAILY;COUNT=3",
  recurrenceSupplementalLines: ["RDATE;TZID=Asia/Tokyo:20260723T090000"],
  recurrenceExdates: [],
  startNotificationMinutes: null,
  endNotificationMinutes: null,
  syncStatus: "read_only",
  version: 1,
  deletedAt: null,
};

describe("ScheduleEditor", () => {
  it("shows an existing schedule description as Markdown and returns to the source", async () => {
    const queryClient = new QueryClient({ defaultOptions: { queries: { retry: false } } });
    const user = userEvent.setup();
    const schedule: Schedule = {
      ...complexGoogleSchedule,
      id: "00000000-0000-4000-8000-000000000021",
      title: "Markdown予定",
      description: "## 手順\n\n| 時刻 | 作業 |\n| --- | --- |\n| 09:00 | 設計 |",
      recurrenceRule: null,
      recurrenceSupplementalLines: [],
      syncStatus: "local_only",
    };

    render(
      <QueryClientProvider client={queryClient}>
        <ScheduleEditor
          client={new MemoryAppClient([])}
          schedule={schedule}
          selectedDate={new Date("2026-07-20T00:00:00.000Z")}
          timezoneId="Asia/Tokyo"
          snapMinutes={5}
          mode="edit"
          busy={false}
          onSave={vi.fn().mockResolvedValue(undefined)}
          onDelete={vi.fn().mockResolvedValue(undefined)}
          onClose={vi.fn()}
        />
      </QueryClientProvider>,
    );

    expect(screen.getByRole("region", { name: "説明のMarkdownプレビュー" })).toBeVisible();
    expect(await screen.findByRole("heading", { name: "手順" })).toBeVisible();
    expect(screen.getByRole("table")).toBeVisible();
    await user.click(screen.getByRole("button", { name: "編集" }));
    expect(screen.getByRole("textbox", { name: "説明" })).toHaveValue(schedule.description);
  });

  it("explains why a complex Google recurrence is protected while sync continues", () => {
    const queryClient = new QueryClient({
      defaultOptions: { queries: { retry: false } },
    });

    render(
      <QueryClientProvider client={queryClient}>
        <ScheduleEditor
          client={new MemoryAppClient([])}
          schedule={complexGoogleSchedule}
          selectedDate={new Date("2026-07-20T00:00:00.000Z")}
          timezoneId="Asia/Tokyo"
          snapMinutes={5}
          mode="edit"
          busy={false}
          onSave={vi.fn().mockResolvedValue(undefined)}
          onDelete={vi.fn().mockResolvedValue(undefined)}
          onClose={vi.fn()}
        />
      </QueryClientProvider>,
    );

    expect(screen.getByText("複雑な繰り返し予定はGoogle側で編集してください")).toBeInTheDocument();
    expect(screen.getByText(/予定の表示と同期は継続します/)).toBeInTheDocument();
    expect(screen.getByRole("button", { name: "変更を保存" })).toBeDisabled();
    expect(screen.queryByRole("button", { name: "この端末から削除" })).not.toBeInTheDocument();
  });
});
