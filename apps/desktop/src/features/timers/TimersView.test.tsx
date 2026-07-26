import { cleanup, render, screen, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { afterEach, describe, expect, it } from "vitest";
import { MemoryAppClient } from "../../shared/ipc/memory-client";
import { TimersView } from "./TimersView";

afterEach(cleanup);

describe("TimersView", () => {
  it("creates and independently controls multiple labeled timers", async () => {
    const user = userEvent.setup();
    render(<TimersView client={new MemoryAppClient([])} />);
    await screen.findByRole("heading", { name: "タイマー", level: 1 });

    const label = screen.getByPlaceholderText("例: 紅茶、ストレッチ");
    await user.type(label, "紅茶");
    await user.click(screen.getByRole("button", { name: "タイマーを追加" }));
    await screen.findByRole("heading", { name: "紅茶" });

    await user.type(label, "ストレッチ");
    await user.click(screen.getByRole("button", { name: "タイマーを追加" }));
    const stretchHeading = await screen.findByRole("heading", { name: "ストレッチ" });
    const stretchCard = stretchHeading.closest("article");
    expect(stretchCard).not.toBeNull();
    await user.click(within(stretchCard!).getByRole("button", { name: "開始" }));
    expect(await within(stretchCard!).findByRole("button", { name: "一時停止" })).toBeVisible();

    const teaCard = screen.getByRole("heading", { name: "紅茶" }).closest("article");
    expect(within(teaCard!).getByRole("button", { name: "開始" })).toBeVisible();
  });

  it("saves a configuration set and adds it without replacing current timers", async () => {
    const user = userEvent.setup();
    render(<TimersView client={new MemoryAppClient([])} />);
    await screen.findByRole("heading", { name: "タイマー", level: 1 });
    await user.type(screen.getByPlaceholderText("例: 紅茶、ストレッチ"), "休憩");
    await user.click(screen.getByRole("button", { name: "タイマーを追加" }));
    await screen.findByRole("heading", { name: "休憩" });

    await user.type(screen.getByPlaceholderText("例: 朝の準備"), "午後セット");
    await user.click(screen.getByRole("button", { name: "現在の構成を保存" }));
    expect(await screen.findByText("午後セット")).toBeVisible();
    await user.click(screen.getByRole("button", { name: "タイマーへ追加" }));
    expect(await screen.findByText("構成セットから1件のタイマーを追加しました。")).toBeVisible();
    expect(screen.getAllByRole("heading", { name: "休憩" })).toHaveLength(2);
  });

  it("supports the primary timer flow with the keyboard", async () => {
    const user = userEvent.setup();
    render(<TimersView client={new MemoryAppClient([])} />);
    await screen.findByRole("heading", { name: "タイマー", level: 1 });

    const label = screen.getByPlaceholderText("例: 紅茶、ストレッチ");
    label.focus();
    await user.keyboard("キーボード計測");
    await user.tab();
    await user.tab();
    await user.tab();
    await user.tab();
    expect(screen.getByRole("button", { name: "タイマーを追加" })).toHaveFocus();
    await user.keyboard("{Enter}");

    const card = (await screen.findByRole("heading", { name: "キーボード計測" })).closest(
      "article",
    );
    const start = within(card!).getByRole("button", { name: "開始" });
    start.focus();
    await user.keyboard("{Enter}");
    expect(await within(card!).findByRole("button", { name: "一時停止" })).toBeVisible();
  });

  it("keeps invalid input and explains the timer deletion scope", async () => {
    const user = userEvent.setup();
    render(<TimersView client={new MemoryAppClient([])} />);
    await screen.findByRole("heading", { name: "タイマー", level: 1 });
    const label = screen.getByPlaceholderText("例: 紅茶、ストレッチ");
    await user.type(label, "保持する入力");
    const durationInputs = screen.getAllByRole("spinbutton");
    await user.clear(durationInputs[1]!);
    await user.type(durationInputs[1]!, "0");
    await user.click(screen.getByRole("button", { name: "タイマーを追加" }));
    expect(screen.getByText("1秒以上7日以内で設定してください。")).toBeVisible();
    expect(label).toHaveValue("保持する入力");

    await user.clear(durationInputs[2]!);
    await user.type(durationInputs[2]!, "1");
    await user.click(screen.getByRole("button", { name: "タイマーを追加" }));
    const card = (await screen.findByRole("heading", { name: "保持する入力" })).closest("article");
    await user.click(within(card!).getByRole("button", { name: "削除…" }));
    expect(
      within(card!).getByText(
        "このタイマーの現在の計測状態を削除します。保存済みの構成セットには影響しません。",
      ),
    ).toBeVisible();
  });

  it("keeps all 500 supported timers reachable", async () => {
    const client = new MemoryAppClient([]);
    await Promise.all(
      Array.from({ length: 500 }, (_, index) =>
        client.createTimer({ label: `負荷タイマー ${index + 1}`, durationSeconds: 60 }),
      ),
    );

    render(<TimersView client={client} />);

    await screen.findByRole("heading", { name: "負荷タイマー 500" });
    expect(screen.getAllByRole("article")).toHaveLength(500);
  }, 15_000);
});
