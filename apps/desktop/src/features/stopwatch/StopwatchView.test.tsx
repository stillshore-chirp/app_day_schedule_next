import { cleanup, render, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { afterEach, describe, expect, it } from "vitest";
import { MemoryAppClient } from "../../shared/ipc/memory-client";
import { StopwatchView } from "./StopwatchView";

afterEach(cleanup);

describe("StopwatchView", () => {
  it("starts, pauses, resumes, and resets the stopwatch", async () => {
    const user = userEvent.setup();
    render(<StopwatchView client={new MemoryAppClient([])} />);
    await screen.findByRole("heading", { name: "ストップウォッチ", level: 1 });
    await user.click(screen.getByRole("button", { name: "計測を開始" }));
    await user.click(await screen.findByRole("button", { name: "一時停止" }));
    await user.click(await screen.findByRole("button", { name: "計測を再開" }));
    await user.click(await screen.findByRole("button", { name: "0に戻す" }));
    expect(screen.getByLabelText("ストップウォッチの経過時間")).toHaveTextContent("00:00:00");
  });

  it("supports the primary flow with the keyboard", async () => {
    const user = userEvent.setup();
    render(<StopwatchView client={new MemoryAppClient([])} />);
    await screen.findByRole("heading", { name: "ストップウォッチ", level: 1 });
    const start = screen.getByRole("button", { name: "計測を開始" });
    start.focus();

    await user.keyboard("{Enter}");

    expect(await screen.findByRole("button", { name: "一時停止" })).toBeVisible();
  });
});
