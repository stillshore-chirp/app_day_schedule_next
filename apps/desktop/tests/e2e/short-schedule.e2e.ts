import { $, browser, expect } from "@wdio/globals";
import "@wdio/tauri-service";

const setLogicalWindowSize = async (width: number, height: number) => {
  await browser.setWindowSize(width, height);
  const initialViewport = await browser.execute(() => ({
    height: window.innerHeight,
    width: window.innerWidth,
  }));
  if (initialViewport.width < width - 2 || initialViewport.height < height - 2) {
    const widthScale = width / Math.max(1, initialViewport.width);
    const heightScale = height / Math.max(1, initialViewport.height);
    await browser.setWindowSize(Math.ceil(width * widthScale), Math.ceil(height * heightScale));
  }
  const requiredViewportWidth = Math.min(width, 720);
  await browser.waitUntil(
    async () => {
      const viewport = await browser.execute(() => ({ width: window.innerWidth }));
      return viewport.width >= requiredViewportWidth - 2;
    },
    { timeoutMsg: `viewport width did not reach ${requiredViewportWidth}px` },
  );
};

describe("Day Schedule Next short schedule layout", () => {
  it("starts with an icon sidebar and keeps template editing in the sidebar destination", async () => {
    await setLogicalWindowSize(1180, 820);
    await $(".app-shell").waitForDisplayed();
    const bootstrap = (await browser.tauri.execute(({ core }) => core.invoke("bootstrap_get"))) as {
      settings: Record<string, unknown>;
    };
    await browser.tauri.execute(
      ({ core }, settings) => core.invoke("settings_update", { settings }),
      { ...bootstrap.settings, theme: "light" },
    );
    await browser.refresh();
    await $(".app-shell").waitForDisplayed();
    await browser.waitUntil(async () => (await $("html").getAttribute("data-theme")) === "light", {
      timeoutMsg: "fixture theme was not set to light",
    });
    await browser.execute(() => localStorage.removeItem("day-schedule-next.sidebar-expanded"));
    await browser.refresh();
    await $(".app-shell").waitForDisplayed();
    await $('aside[aria-label="主要画面"] button[aria-label="今日"]').click();
    await $(".overview").waitForDisplayed();
    await browser.execute(() => {
      const workspace = document.querySelector(".workspace-main");
      if (workspace instanceof HTMLElement) workspace.scrollTop = 0;
    });
    const expandSidebar = $('button[aria-label="サイドバーを展開"]');
    await expect($("button=テンプレートを編集")).not.toBeExisting();

    expect(
      await browser.execute(() =>
        document.querySelector(".app-shell")?.getAttribute("data-sidebar"),
      ),
    ).toBe("collapsed");
    await expect(expandSidebar).toHaveAttribute("aria-expanded", "false");
    const collapsedLayout = await browser.execute(() => {
      const sidebar = document.querySelector(".sidebar");
      const firstNavigationLabel = document.querySelector(".sidebar__label");
      const scheduleTrack = document.querySelector(".overview-lane__track");
      const templateTrack = document.querySelector(".overview-lane__track--template");
      if (!(sidebar instanceof HTMLElement)) throw new Error("sidebar was not found");
      if (!(firstNavigationLabel instanceof HTMLElement))
        throw new Error("sidebar label was not found");
      if (!(scheduleTrack instanceof HTMLElement)) throw new Error("schedule track was not found");
      if (!(templateTrack instanceof HTMLElement)) throw new Error("template track was not found");
      const labelGaps = Array.from(document.querySelectorAll(".overview-lane"), (lane) => {
        const heading = lane.querySelector(".overview-lane__heading");
        const track = lane.querySelector(".overview-lane__track");
        if (!(heading instanceof HTMLElement) || !(track instanceof HTMLElement)) {
          throw new Error("overview lane geometry was not found");
        }
        const headingTextRight = Math.max(
          ...Array.from(
            heading.querySelectorAll(".overview-lane__kind, h3"),
            (element) => element.getBoundingClientRect().right,
          ),
        );
        return track.getBoundingClientRect().left - headingTextRight;
      });
      return {
        sidebarWidth: sidebar.getBoundingClientRect().width,
        navigationLabelDisplay: getComputedStyle(firstNavigationLabel).display,
        labelWidths: Array.from(
          document.querySelectorAll(".overview-lane__heading"),
          (heading) => heading.getBoundingClientRect().width,
        ),
        labelsFit: Array.from(
          document.querySelectorAll(".overview-lane__kind, .overview-lane__heading h3"),
          (label) => label.scrollWidth <= label.clientWidth + 1,
        ),
        scheduleTrackWidth: scheduleTrack.getBoundingClientRect().width,
        templateTrackWidth: templateTrack.getBoundingClientRect().width,
        labelGaps,
      };
    });
    expect(collapsedLayout.sidebarWidth).toBeCloseTo(76, 0);
    expect(collapsedLayout.navigationLabelDisplay).toBe("none");
    expect(Math.max(...collapsedLayout.labelWidths)).toBeLessThanOrEqual(73);
    expect(collapsedLayout.labelsFit.every(Boolean)).toBe(true);
    expect(collapsedLayout.scheduleTrackWidth).toBeCloseTo(collapsedLayout.templateTrackWidth, 0);
    expect(collapsedLayout.labelGaps).toHaveLength(2);
    expect(Math.max(...collapsedLayout.labelGaps)).toBeLessThanOrEqual(9);
    await browser.saveScreenshot("./test-results/native-sidebar-collapsed-overview.png");

    await expandSidebar.click();
    expect(
      await browser.execute(() =>
        document.querySelector(".app-shell")?.getAttribute("data-sidebar"),
      ),
    ).toBe("expanded");
    await expect($('button[aria-label="サイドバーを格納"]')).toHaveAttribute(
      "aria-expanded",
      "true",
    );
    await $('button[aria-label="サイドバーを格納"]').click();
    expect(
      await browser.execute(() =>
        document.querySelector(".app-shell")?.getAttribute("data-sidebar"),
      ),
    ).toBe("collapsed");
    await browser.waitUntil(
      async () =>
        (await browser.execute(() => {
          const sidebar = document.querySelector(".sidebar");
          return sidebar instanceof HTMLElement ? sidebar.getBoundingClientRect().width : 0;
        })) < 100,
      { timeoutMsg: "sidebar did not finish collapsing" },
    );

    await setLogicalWindowSize(720, 720);
    const narrowLayout = await browser.execute(() => {
      const sidebar = document.querySelector(".sidebar");
      const scheduleTrack = document.querySelector(".overview-lane__track");
      const templateTrack = document.querySelector(".overview-lane__track--template");
      if (!(sidebar instanceof HTMLElement)) throw new Error("sidebar was not found");
      if (!(scheduleTrack instanceof HTMLElement)) throw new Error("schedule track was not found");
      if (!(templateTrack instanceof HTMLElement)) throw new Error("template track was not found");
      return {
        sidebarWidth: sidebar.getBoundingClientRect().width,
        labelWidths: Array.from(
          document.querySelectorAll(".overview-lane__heading"),
          (heading) => heading.getBoundingClientRect().width,
        ),
        labelsFit: Array.from(
          document.querySelectorAll(".overview-lane__kind, .overview-lane__heading h3"),
          (label) => label.scrollWidth <= label.clientWidth + 1,
        ),
        scheduleTrackWidth: scheduleTrack.getBoundingClientRect().width,
        templateTrackWidth: templateTrack.getBoundingClientRect().width,
      };
    });
    expect(narrowLayout.sidebarWidth).toBeCloseTo(76, 0);
    expect(Math.max(...narrowLayout.labelWidths)).toBeLessThanOrEqual(73);
    expect(narrowLayout.labelsFit.every(Boolean)).toBe(true);
    expect(narrowLayout.scheduleTrackWidth).toBeCloseTo(narrowLayout.templateTrackWidth, 0);
    await browser.saveScreenshot("./test-results/native-sidebar-collapsed-narrow.png");

    await setLogicalWindowSize(1180, 820);
    const rootFontSize = await browser.execute(() => {
      document.documentElement.style.setProperty("font-size", "32px", "important");
      return document.documentElement.style.fontSize;
    });
    expect(rootFontSize).toBe("32px");
    const scaledLabels = await browser.execute(() =>
      Array.from(document.querySelectorAll(".overview-lane"), (lane) => {
        const heading = lane.querySelector(".overview-lane__heading");
        const track = lane.querySelector(".overview-lane__track");
        if (!(heading instanceof HTMLElement) || !(track instanceof HTMLElement)) {
          throw new Error("scaled overview lane geometry was not found");
        }
        return {
          headingWidth: heading.getBoundingClientRect().width,
          fitsTrackHeight: heading.scrollHeight <= track.getBoundingClientRect().height + 1,
        };
      }),
    );
    expect(scaledLabels.every(({ fitsTrackHeight }) => fitsTrackHeight)).toBe(true);
    await expect(expandSidebar).toBeDisplayed();
    await expect($("button=テンプレートを編集")).not.toBeExisting();
    await browser.saveScreenshot("./test-results/native-sidebar-collapsed-text-200.png");
    await browser.execute(() => {
      document.documentElement.style.removeProperty("font-size");
    });

    await $('aside[aria-label="主要画面"] button[aria-label="テンプレート"]').click();
    await $("h2=テンプレートを編集").waitForDisplayed();
  });

  it("keeps a 30-minute schedule identifiable in overview and detail", async () => {
    await setLogicalWindowSize(1180, 820);
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
