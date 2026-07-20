import { $, browser, expect } from "@wdio/globals";
import "@wdio/tauri-service";

describe("Day Schedule Next notification history", () => {
  const setLogicalWindowSize = async (width: number, height: number) => {
    await browser.setWindowSize(width, height);
    const viewport = await browser.execute(() => ({
      height: window.innerHeight,
      width: window.innerWidth,
    }));
    if (viewport.width < width - 2 || viewport.height < height - 2) {
      await browser.setWindowSize(
        Math.ceil(width * (width / Math.max(1, viewport.width))),
        Math.ceil(height * (height / Math.max(1, viewport.height))),
      );
    }
  };

  it("explains a DST alarm skip without exposing an internal category", async () => {
    await setLogicalWindowSize(1180, 820);
    await $(".app-shell").waitForDisplayed();
    await $('//aside[@aria-label="主要画面"]//button[contains(., "今日")]').click();
    await expect($(".today-heading h1")).toHaveText("今日の予定");
    const start = new Date(Date.now() + 100);
    const end = new Date(start.getTime() + 60 * 60_000);
    const delivery = await browser.execute(
      async (input) => {
        const core = (
          window as unknown as {
            __TAURI__: {
              core: { invoke: <T>(command: string, args?: unknown) => Promise<T> };
            };
          }
        ).__TAURI__.core;
        await core.invoke("schedule_create", {
          draft: {
            title: "E2E通知履歴",
            description: "synthetic fixture",
            location: "",
            startUtc: input.startUtc,
            endUtc: input.endUtc,
            timezoneId: "UTC",
            allDay: false,
            allDayStartDate: null,
            allDayEndDateExclusive: null,
            status: "scheduled",
            project: "",
            category: "synthetic",
            tags: [],
            color: "#6F96F4",
            priority: "normal",
            recurrenceRule: null,
            recurrenceExdates: [],
            startNotificationMinutes: 0,
            endNotificationMinutes: null,
          },
        });
        await new Promise((resolve) => setTimeout(resolve, 200));
        const deliveries = await core.invoke<
          Array<{
            deliveryKey: string;
          }>
        >("notification_poll");
        const candidate = deliveries[0];
        if (!candidate) throw new Error("notification candidate was not claimed");
        await core.invoke("notification_result_record", {
          request: {
            deliveryKey: candidate.deliveryKey,
            result: "skipped",
            errorCategory: "dst_gap",
          },
        });
        const history = await core.invoke<
          Array<{
            errorCategory: string | null;
          }>
        >("notification_history_list");
        return { candidate, history };
      },
      { startUtc: start.toISOString(), endUtc: end.toISOString() },
    );
    expect(delivery.candidate.deliveryKey).toMatch(/^[0-9a-f]{64}$/);
    expect(delivery.history[0]?.errorCategory).toBe("dst_gap");

    await $('//aside[@aria-label="主要画面"]//button[contains(., "データと診断")]').click();
    await expect($("main h1")).toHaveText("データと診断");
    await browser.pause(500);
    const diagnosticsText = await $("main").getText();
    expect(diagnosticsText).toContain("DSTにより存在しない時刻のため見送り");
    const friendlyReason = $("//*[normalize-space(.)='DSTにより存在しない時刻のため見送り']");
    await friendlyReason.waitForExist();
    await friendlyReason.scrollIntoView({ block: "center" });
    await expect(friendlyReason).toBeDisplayed();

    await browser.execute(() => {
      const cell = Array.from(document.querySelectorAll("td")).find((candidate) =>
        candidate.textContent?.includes("DSTにより存在しない時刻のため見送り"),
      );
      if (!cell) throw new Error("notification category cell was not found");
      cell.textContent = "dst_gap";
      cell.scrollIntoView({ block: "center" });
      document.querySelectorAll(".app-content, .table-scroll").forEach((container) => {
        container.scrollLeft = 0;
      });
      document.scrollingElement?.scrollTo({ left: 0 });
    });
    await browser.pause(200);
    await browser.saveScreenshot("./test-results/native-notification-history-before.png");
    await browser.refresh();
    await $(".app-shell").waitForDisplayed();
    await $('//aside[@aria-label="主要画面"]//button[contains(., "データと診断")]').click();
    await friendlyReason.waitForExist();
    await friendlyReason.scrollIntoView({ block: "center" });
    await expect(friendlyReason).toBeDisplayed();
    await browser.execute(() => {
      const cell = Array.from(document.querySelectorAll("td")).find((candidate) =>
        candidate.textContent?.includes("DSTにより存在しない時刻のため見送り"),
      );
      if (!cell) throw new Error("notification category cell was not found");
      cell.scrollIntoView({ block: "center" });
      document.querySelectorAll(".app-content, .table-scroll").forEach((container) => {
        container.scrollLeft = 0;
      });
      document.scrollingElement?.scrollTo({ left: 0 });
    });
    await browser.pause(200);
    await browser.saveScreenshot("./test-results/native-notification-history-after.png");
  });
});
