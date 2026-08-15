import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { fireEvent, render, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { describe, expect, it, vi } from "vitest";
import type { Schedule } from "../../shared/contracts";
import { MemoryAppClient } from "../../shared/ipc/memory-client";
import { ScheduleEditor } from "./ScheduleEditor";

const complexGoogleSchedule: Schedule = {
  id: "00000000-0000-4000-8000-000000000020",
  title: "複雑な繰り返し予定",
  description: "共有元の説明",
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
  it("keeps title, date and time, description, and save in the primary flow", () => {
    const queryClient = new QueryClient({ defaultOptions: { queries: { retry: false } } });

    render(
      <QueryClientProvider client={queryClient}>
        <ScheduleEditor
          client={new MemoryAppClient([])}
          schedule={null}
          selectedDate={new Date("2026-08-16T12:00:00.000Z")}
          timezoneId="Asia/Tokyo"
          snapMinutes={5}
          mode="create"
          busy={false}
          onSave={vi.fn().mockResolvedValue(undefined)}
          onClose={vi.fn()}
        />
      </QueryClientProvider>,
    );

    const title = screen.getByLabelText("タイトル");
    const date = screen.getByLabelText("日付");
    const description = screen.getByRole("textbox", { name: "説明" });
    const timeAdjustment = screen.getByRole("button", { name: "5分後へ移動" });
    const save = screen.getByRole("button", { name: "予定を作成" });
    expect(title.compareDocumentPosition(date) & Node.DOCUMENT_POSITION_FOLLOWING).toBeTruthy();
    expect(
      date.compareDocumentPosition(description) & Node.DOCUMENT_POSITION_FOLLOWING,
    ).toBeTruthy();
    expect(
      description.compareDocumentPosition(timeAdjustment) & Node.DOCUMENT_POSITION_FOLLOWING,
    ).toBeTruthy();
    expect(
      description.compareDocumentPosition(save) & Node.DOCUMENT_POSITION_FOLLOWING,
    ).toBeTruthy();
    expect(screen.getByText("詳細設定").closest("details")).not.toHaveAttribute("open");
  });

  it("supports direct, dropdown, move, and duration time changes while preserving precision", async () => {
    const queryClient = new QueryClient({ defaultOptions: { queries: { retry: false } } });
    const user = userEvent.setup();

    render(
      <QueryClientProvider client={queryClient}>
        <ScheduleEditor
          client={new MemoryAppClient([])}
          schedule={null}
          selectedDate={new Date("2026-08-16T12:00:00.000Z")}
          timezoneId="Asia/Tokyo"
          snapMinutes={5}
          mode="create"
          busy={false}
          onSave={vi.fn().mockResolvedValue(undefined)}
          onClose={vi.fn()}
        />
      </QueryClientProvider>,
    );

    const start = screen.getByLabelText("開始時刻");
    const end = screen.getByLabelText("終了時刻");
    const startChoice = screen.getByLabelText("開始時刻の候補");
    const endChoice = screen.getByLabelText("終了時刻の候補");
    fireEvent.change(start, { target: { value: "10:07" } });
    expect(start).toHaveValue("10:07");
    expect(end).toHaveValue("10:37");
    expect(startChoice).toHaveValue("10:07");
    expect(endChoice).toHaveValue("10:37");
    expect(screen.getByRole("option", { name: "10:07" })).toBeInTheDocument();

    await user.selectOptions(startChoice, "10:10");
    expect(start).toHaveValue("10:10");
    expect(end).toHaveValue("10:40");
    expect(startChoice).toHaveValue("10:10");
    expect(endChoice).toHaveValue("10:40");
    await user.selectOptions(endChoice, "10:45");
    expect(end).toHaveValue("10:45");
    expect(endChoice).toHaveValue("10:45");

    await user.click(screen.getByRole("button", { name: "5分後へ移動" }));
    expect(start).toHaveValue("10:15");
    expect(end).toHaveValue("10:50");
    await user.click(screen.getByRole("button", { name: "5分短くする" }));
    expect(end).toHaveValue("10:45");
    await user.click(screen.getByRole("button", { name: "所要時間を15分にする" }));
    expect(end).toHaveValue("10:30");
  });

  it("shows and preserves a cross-midnight end date", async () => {
    const queryClient = new QueryClient({ defaultOptions: { queries: { retry: false } } });
    const user = userEvent.setup();
    const schedule: Schedule = {
      ...complexGoogleSchedule,
      id: "00000000-0000-4000-8000-000000000022",
      title: "夜間メンテナンス",
      description: "",
      startUtc: "2026-08-16T14:30:00.000Z",
      endUtc: "2026-08-16T15:30:00.000Z",
      recurrenceRule: null,
      recurrenceSupplementalLines: [],
      syncStatus: "local_only",
    };

    render(
      <QueryClientProvider client={queryClient}>
        <ScheduleEditor
          client={new MemoryAppClient([])}
          schedule={schedule}
          selectedDate={new Date("2026-08-16T12:00:00.000Z")}
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

    expect(screen.getByText("翌日")).toBeVisible();
    expect(screen.getByLabelText("終了日")).toHaveValue("2026-08-17");
    await user.selectOptions(screen.getByLabelText("開始時刻の候補"), "23:45");
    expect(screen.getByLabelText("終了時刻")).toHaveValue("00:45");
    expect(screen.getByLabelText("終了日")).toHaveValue("2026-08-17");
  });

  it("keeps a DST gap visible and does not save a normalized replacement", async () => {
    class GapClient extends MemoryAppClient {
      override resolveLocalTime(local: string): Promise<{
        kind: "single" | "ambiguous" | "gap";
        candidates: string[];
      }> {
        return Promise.resolve(
          local === "2026-03-08T02:30"
            ? { kind: "gap", candidates: [] }
            : { kind: "single", candidates: ["2026-03-08T07:00:00.000Z"] },
        );
      }
    }

    const queryClient = new QueryClient({ defaultOptions: { queries: { retry: false } } });
    const user = userEvent.setup();
    const onSave = vi.fn().mockResolvedValue(undefined);
    render(
      <QueryClientProvider client={queryClient}>
        <ScheduleEditor
          client={new GapClient([])}
          schedule={null}
          selectedDate={new Date("2026-03-08T12:00:00.000Z")}
          timezoneId="America/New_York"
          snapMinutes={5}
          mode="create"
          busy={false}
          onSave={onSave}
          onClose={vi.fn()}
        />
      </QueryClientProvider>,
    );

    await user.type(screen.getByLabelText("タイトル"), "DST gap test");
    fireEvent.change(screen.getByLabelText("日付"), { target: { value: "2026-03-08" } });
    fireEvent.change(screen.getByLabelText("開始時刻"), { target: { value: "02:30" } });
    await user.click(screen.getByRole("button", { name: "予定を作成" }));

    expect(await screen.findByText(/DST移行で存在しません/)).toBeVisible();
    expect(screen.getByLabelText("開始時刻")).toHaveValue("02:30");
    expect(onSave).not.toHaveBeenCalled();
  });

  it("clears a selected DST fold whenever the time range changes", async () => {
    class FoldClient extends MemoryAppClient {
      override resolveLocalTime(local: string): Promise<{
        kind: "single" | "ambiguous" | "gap";
        candidates: string[];
      }> {
        if (local.startsWith("2026-11-01T01:")) {
          const minute = local.slice(-2);
          return Promise.resolve({
            kind: "ambiguous",
            candidates: [`2026-11-01T05:${minute}:00.000Z`, `2026-11-01T06:${minute}:00.000Z`],
          });
        }
        return Promise.resolve({ kind: "single", candidates: ["2026-11-01T07:00:00.000Z"] });
      }
    }

    const queryClient = new QueryClient({ defaultOptions: { queries: { retry: false } } });
    const user = userEvent.setup();
    const onSave = vi.fn().mockResolvedValue(undefined);
    render(
      <QueryClientProvider client={queryClient}>
        <ScheduleEditor
          client={new FoldClient([])}
          schedule={null}
          selectedDate={new Date("2026-11-01T12:00:00.000Z")}
          timezoneId="America/New_York"
          snapMinutes={5}
          mode="create"
          busy={false}
          onSave={onSave}
          onClose={vi.fn()}
        />
      </QueryClientProvider>,
    );

    await user.type(screen.getByLabelText("タイトル"), "DST fold test");
    fireEvent.change(screen.getByLabelText("日付"), { target: { value: "2026-11-01" } });
    fireEvent.change(screen.getByLabelText("開始時刻"), { target: { value: "01:30" } });
    await user.click(screen.getByRole("button", { name: "予定を作成" }));
    const foldChoices = await screen.findAllByRole("radio", { name: /UTC/ });
    await user.click(foldChoices[1]!);
    await user.click(screen.getByRole("button", { name: "予定を作成" }));
    expect(onSave).toHaveBeenCalledTimes(1);

    await user.click(screen.getByRole("button", { name: "5分後へ移動" }));
    await user.click(screen.getByRole("button", { name: "予定を作成" }));
    expect(
      screen.getByText("DSTで同じ時刻が2回あります。UTCオフセットを選んでください。"),
    ).toBeVisible();
    expect(onSave).toHaveBeenCalledTimes(1);
  });

  it("starts in the plain preview, renders Markdown on request, and returns to the source", async () => {
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

    expect(screen.getByRole("tabpanel", { name: "通常プレビュー" })).toHaveTextContent("## 手順");
    expect(screen.queryByRole("heading", { name: "手順" })).not.toBeInTheDocument();
    await user.click(screen.getByRole("tab", { name: "Markdownプレビュー" }));
    expect(await screen.findByRole("heading", { name: "手順" })).toBeVisible();
    expect(screen.getByRole("table")).toBeVisible();
    await user.click(screen.getByRole("tab", { name: "編集" }));
    expect(screen.getByRole("textbox", { name: "説明" })).toHaveValue(schedule.description);
  });

  it("keeps a protected Google description selectable while blocking saves", async () => {
    const queryClient = new QueryClient({
      defaultOptions: { queries: { retry: false } },
    });
    const user = userEvent.setup();

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
    await user.click(screen.getByRole("tab", { name: "編集" }));
    const description = screen.getByRole("textbox", { name: "説明" });
    expect(description).toHaveAttribute("readonly");
    expect(description).not.toBeDisabled();
    expect(description).toHaveValue(complexGoogleSchedule.description);
  });
});
