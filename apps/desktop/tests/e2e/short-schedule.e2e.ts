import { $, browser, expect } from "@wdio/globals";
import "@wdio/tauri-service";

describe("Day Schedule Next short schedule layout", () => {
  it("keeps a 30-minute schedule identifiable in overview and detail", async () => {
    await browser.setWindowSize(1180, 820);
    await $(".app-shell").waitForDisplayed();

    const bootstrap = (await browser.tauri.execute(({ core }) => core.invoke("bootstrap_get"))) as {
      today: string;
      timezoneId: string;
    };
    const start = new Date(`${bootstrap.today}T02:15:00`);
    const end = new Date(`${bootstrap.today}T02:45:00`);
    await browser.tauri.execute(
      async ({ core }, input) => {
        await core.invoke("schedule_create", {
          draft: {
            title: "E2E短時間予定",
            description: "synthetic fixture",
            location: "",
            startUtc: input.startUtc,
            endUtc: input.endUtc,
            timezoneId: input.timezoneId,
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
            startNotificationMinutes: null,
            endNotificationMinutes: null,
          },
        });
      },
      {
        startUtc: start.toISOString(),
        endUtc: end.toISOString(),
        timezoneId: bootstrap.timezoneId,
      },
    );

    await browser.refresh();
    await $(".app-shell").waitForDisplayed();
    await $('//aside[@aria-label="主要画面"]//button[contains(., "今日")]').click();
    await $(".timeline-viewport").waitForDisplayed();
    await browser.execute(() => {
      const viewport = document.querySelector(".timeline-viewport");
      if (!(viewport instanceof HTMLElement)) throw new Error("timeline viewport was not found");
      viewport.scrollTop = 72;
      viewport.dispatchEvent(new Event("scroll"));
    });

    const overview = $('.overview-event[aria-label*="E2E短時間予定"]');
    await expect(overview).toHaveAttribute("data-overview-index", "1");
    const detail = $('.timeline-event[aria-label*="E2E短時間予定"]');
    await detail.waitForDisplayed();
    await expect(detail).toHaveAttribute("data-density", "compact");
    await expect(detail).toHaveAttribute("aria-label", expect.stringContaining("02:15から02:45"));
    const layout = await browser.execute(() => {
      const overviewBlock = document.querySelector('.overview-event[aria-label*="E2E短時間予定"]');
      const overviewContent = overviewBlock?.querySelector(".overview-event__content");
      const overviewTitle = overviewBlock?.querySelector(".overview-event__title");
      const overviewStart = overviewBlock?.querySelector(".overview-event__start");
      const event = document.querySelector('.timeline-event[aria-label*="E2E短時間予定"]');
      const title = event?.querySelector(".timeline-event-title");
      const time = event?.querySelector(".timeline-event-time");
      if (!(overviewBlock instanceof HTMLElement)) throw new Error("overview block was not found");
      if (!(overviewContent instanceof HTMLElement))
        throw new Error("overview content was not found");
      if (!(overviewTitle instanceof HTMLElement)) throw new Error("overview title was not found");
      if (!(overviewStart instanceof HTMLElement)) throw new Error("overview start was not found");
      if (!(event instanceof HTMLElement) || !(title instanceof HTMLElement)) {
        throw new Error("timeline event title was not found");
      }
      if (!(time instanceof HTMLElement)) throw new Error("timeline event time was not found");
      const overviewBlockBounds = overviewBlock.getBoundingClientRect();
      const overviewContentBounds = overviewContent.getBoundingClientRect();
      const overviewTitleBounds = overviewTitle.getBoundingClientRect();
      const overviewStartBounds = overviewStart.getBoundingClientRect();
      const eventBounds = event.getBoundingClientRect();
      const titleBounds = title.getBoundingClientRect();
      const timeBounds = time.getBoundingClientRect();
      return {
        overviewContentDisplay: getComputedStyle(overviewContent).display,
        overviewText: overviewBlock.textContent,
        overviewTitleWidth: overviewTitleBounds.width,
        overviewStartWidth: overviewStartBounds.width,
        overviewBlockHeight: overviewBlockBounds.height,
        overviewBlockWidth: overviewBlockBounds.width,
        overviewContentWidth: overviewContentBounds.width,
        eventTop: eventBounds.top,
        eventBottom: eventBounds.bottom,
        titleTop: titleBounds.top,
        titleBottom: titleBounds.bottom,
        titleRight: titleBounds.right,
        timeTop: timeBounds.top,
        timeBottom: timeBounds.bottom,
        timeLeft: timeBounds.left,
      };
    });
    expect(layout.overviewContentDisplay).toBe("grid");
    expect(layout.overviewText).toContain("1");
    expect(layout.overviewText).toContain("02:15");
    expect(layout.overviewText).toContain("E2E短時間予定");
    expect(layout.overviewTitleWidth).toBeGreaterThan(0);
    expect(layout.overviewStartWidth).toBeGreaterThan(0);
    expect(layout.overviewBlockHeight).toBeCloseTo(60, 0);
    expect(layout.titleTop).toBeGreaterThanOrEqual(layout.eventTop);
    expect(layout.titleBottom).toBeLessThanOrEqual(layout.eventBottom);
    expect(layout.timeTop).toBeGreaterThanOrEqual(layout.eventTop);
    expect(layout.timeBottom).toBeLessThanOrEqual(layout.eventBottom);
    expect(layout.titleRight).toBeLessThanOrEqual(layout.timeLeft);
    await browser.saveScreenshot("./test-results/native-short-schedule-overview.png");
    await detail.click();
    await $('//aside//h2[normalize-space(.)="予定を編集"]').waitForDisplayed();

    await browser.saveScreenshot("./test-results/native-short-schedule.png");
  });
});
