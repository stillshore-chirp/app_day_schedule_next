import { $, browser, expect } from "@wdio/globals";
import "@wdio/tauri-service";
import { writeFile } from "node:fs/promises";

describe("Day Schedule Next native smoke", () => {
  const title = `E2E予定-${Date.now()}`;
  const textScaleValues = [100, 125, 150, 175, 200, 250] as const;
  type TextScalePercent = (typeof textScaleValues)[number];

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
        const viewport = await browser.execute(() => ({
          width: window.innerWidth,
        }));
        return viewport.width >= requiredViewportWidth - 2;
      },
      { timeoutMsg: `viewport width did not reach ${requiredViewportWidth}px` },
    );
  };

  const setExactLogicalViewportSize = async (width: number, height: number) => {
    await browser.setWindowSize(width, height);
    for (let attempt = 0; attempt < 4; attempt += 1) {
      const viewport = await browser.execute(() => ({
        devicePixelRatio: window.devicePixelRatio,
        height: window.innerHeight,
        width: window.innerWidth,
      }));
      if (Math.abs(viewport.width - width) <= 1 && Math.abs(viewport.height - height) <= 1) {
        return;
      }
      const outer = await browser.getWindowSize();
      await browser.setWindowSize(
        Math.max(
          280,
          Math.round(outer.width + (width - viewport.width) * viewport.devicePixelRatio),
        ),
        Math.max(
          280,
          Math.round(outer.height + (height - viewport.height) * viewport.devicePixelRatio),
        ),
      );
    }
    const viewport = await browser.execute(() => ({
      height: window.innerHeight,
      width: window.innerWidth,
    }));
    if (Math.abs(viewport.width - width) > 1 || Math.abs(viewport.height - height) > 1) {
      throw new Error(
        `viewport did not reach ${width}x${height}: ${viewport.width}x${viewport.height}`,
      );
    }
  };

  const scrollActiveViewToTop = async () => {
    await browser.execute(() => {
      const view = document.querySelector("main.secondary-view");
      if (view instanceof HTMLElement) view.scrollTop = 0;
    });
  };

  const saveAppShellAtLogicalSize = async (path: string, width: number, height: number) => {
    const shell = $(".app-shell");
    await shell.waitForDisplayed();
    const originalStyle = await browser.execute(
      ({ height, width }) => {
        const element = document.querySelector<HTMLElement>(".app-shell");
        if (!element) throw new Error("app shell was not found for visual capture");
        const original = { height: element.style.height, width: element.style.width };
        element.style.height = `${height}px`;
        element.style.width = `${width}px`;
        return original;
      },
      { height, width },
    );
    try {
      const bounds = await browser.execute(() => {
        const element = document.querySelector<HTMLElement>(".app-shell");
        if (!element) throw new Error("app shell was not found for visual capture");
        const rect = element.getBoundingClientRect();
        return { height: Math.round(rect.height), width: Math.round(rect.width) };
      });
      expect(bounds).toEqual({ height, width });
      await shell.saveScreenshot(path);
    } finally {
      await browser.execute((style) => {
        const element = document.querySelector<HTMLElement>(".app-shell");
        if (!element) throw new Error("app shell was not found after visual capture");
        element.style.height = style.height;
        element.style.width = style.width;
      }, originalStyle);
    }
  };

  const openTicketView = async () => {
    await browser.tauri.switchWindow("main");
    for (let attempt = 1; attempt <= 6; attempt += 1) {
      const heading = $('//main//h1[normalize-space(.)="チケット"]');
      if (await heading.isDisplayed().catch(() => false)) return;

      try {
        const button = $('//aside[@aria-label="主要画面"]//button[@aria-label="チケット"]');
        await button.waitForDisplayed({ timeout: 5_000 });
        await button.click();
        await heading.waitForDisplayed({ interval: 250, timeout: 5_000 });
        return;
      } catch (error) {
        if (attempt === 6) {
          const reason = error instanceof Error ? error.message : "unknown WebDriver error";
          throw new Error(
            `Ticket view did not become active after 6 WebDriver navigation attempts: ${reason}`,
          );
        }
      }
    }
  };

  const persistFixtureTheme = async (theme: "light" | "mild" | "dark") => {
    const applied = await browser.tauri.execute(async ({ core }, nextTheme) => {
      const bootstrap = (await core.invoke("bootstrap_get")) as {
        settings: Record<string, unknown>;
      };
      await core.invoke("settings_update", {
        settings: { ...bootstrap.settings, theme: nextTheme },
      });
      const persisted = (await core.invoke("bootstrap_get")) as {
        settings: { theme: string };
      };
      document.documentElement.dataset.theme = nextTheme;
      document.querySelector<HTMLElement>(".workspace-main")?.scrollTo(0, 0);
      return {
        documentTheme: document.documentElement.dataset.theme,
        persistedTheme: persisted.settings.theme,
      };
    }, theme);
    expect(applied).toEqual({ documentTheme: theme, persistedTheme: theme });
  };

  const persistTextScale = async (textScalePercent: TextScalePercent) => {
    await browser.tauri.execute(async ({ core }, nextScale) => {
      const bootstrap = (await core.invoke("bootstrap_get")) as {
        settings: Record<string, unknown>;
      };
      await core.invoke("settings_update", {
        settings: { ...bootstrap.settings, textScalePercent: nextScale },
      });
    }, textScalePercent);
    await browser.waitUntil(
      async () => {
        const appearance = await browser.execute(() => ({
          fontToken: Number.parseFloat(
            getComputedStyle(document.documentElement).getPropertyValue("--app-font-1"),
          ),
          textScale: document.documentElement.dataset.textScale,
        }));
        return (
          appearance.textScale === String(textScalePercent) &&
          Math.abs(appearance.fontToken - 16 * (textScalePercent / 100)) <= 0.5
        );
      },
      { timeoutMsg: `text scale ${textScalePercent}% was not applied to the active window` },
    );
  };

  const selectTextScale = async (textScalePercent: TextScalePercent) => {
    const scale = $('//label[contains(., "文字表示倍率")]/select');
    await scale.waitForDisplayed();
    // The embedded WKWebView driver can update a native select's displayed
    // option without dispatching the input/change pair React needs. Exercise
    // the real control through its platform setter and explicit DOM events.
    await browser.execute((value) => {
      const select = Array.from(document.querySelectorAll<HTMLSelectElement>("select")).find(
        (candidate) => candidate.closest("label")?.textContent?.includes("文字表示倍率"),
      );
      if (!select) throw new Error("text scale select was not found");
      Object.getOwnPropertyDescriptor(HTMLSelectElement.prototype, "value")?.set?.call(
        select,
        value,
      );
      select.dispatchEvent(new Event("change", { bubbles: true }));
    }, String(textScalePercent));
    await expect(scale).toHaveValue(String(textScalePercent));
    await browser.waitUntil(
      async () => {
        const appearance = await browser.execute(() => ({
          fontToken: Number.parseFloat(
            getComputedStyle(document.documentElement).getPropertyValue("--app-font-1"),
          ),
          textScale: document.documentElement.dataset.textScale,
        }));
        return (
          appearance.textScale === String(textScalePercent) &&
          Math.abs(appearance.fontToken - 16 * (textScalePercent / 100)) <= 0.5
        );
      },
      { timeoutMsg: `${textScalePercent}% text scale was not reflected from the settings select` },
    );
  };

  const chooseScheduleTime = async (label: string, value: string) => {
    await browser.execute(
      ({ label, value }) => {
        const select = Array.from(document.querySelectorAll<HTMLSelectElement>("select")).find(
          (candidate) => candidate.getAttribute("aria-label") === label,
        );
        if (!select) throw new Error(`schedule time select was not found: ${label}`);
        Object.getOwnPropertyDescriptor(HTMLSelectElement.prototype, "value")?.set?.call(
          select,
          value,
        );
        select.dispatchEvent(new Event("change", { bubbles: true }));
      },
      { label, value },
    );
  };

  it("boots the real Tauri application and reaches the native IPC boundary", async () => {
    await $(".app-shell").waitForDisplayed();
    await $('//aside[@aria-label="主要画面"]//button[contains(., "今日")]').click();
    const heading = $(".today-heading h1");
    await heading.waitForDisplayed();
    await expect(heading).toBeDisplayed();
    await expect(heading).toHaveText("今日の予定");
    const bootstrap = await browser.tauri.execute(({ core }) => core.invoke("bootstrap_get"));
    expect(bootstrap).toMatchObject({ schemaVersion: 18, databaseState: "ready" });
  });

  it("creates and persists a schedule through the native IPC and SQLite boundary", async () => {
    await persistFixtureTheme("light");
    // Earlier specs intentionally resize the shared native window. Restore the
    // deterministic Today baseline viewport before taking its screenshot.
    await setExactLogicalViewportSize(1024, 640);
    const addButton = $('//header//button[contains(normalize-space(.), "予定")]');
    await addButton.click();
    const titleInput = $('//aside//label[contains(., "タイトル")]/input');
    await titleInput.waitForDisplayed();
    await titleInput.setValue(title);
    const startTimeInput = $("#schedule-start-time");
    const endTimeInput = $("#schedule-end-time");
    await browser.execute(() => {
      const input = document.querySelector<HTMLInputElement>("#schedule-start-time");
      if (!input) throw new Error("schedule start time input was not found");
      Object.getOwnPropertyDescriptor(HTMLInputElement.prototype, "value")?.set?.call(
        input,
        "10:07",
      );
      input.dispatchEvent(new Event("input", { bubbles: true }));
      input.dispatchEvent(new Event("change", { bubbles: true }));
    });
    await expect(startTimeInput).toHaveValue("10:07");
    await expect(endTimeInput).toHaveValue("10:37");
    await chooseScheduleTime("開始時刻の候補", "10:10");
    await expect(startTimeInput).toHaveValue("10:10");
    await expect(endTimeInput).toHaveValue("10:40");
    await expect($('select[aria-label="開始時刻の候補"]')).toHaveValue("10:10");
    await expect($('select[aria-label="終了時刻の候補"]')).toHaveValue("10:40");
    await chooseScheduleTime("終了時刻の候補", "10:45");
    await $('//button[@aria-label="5分後へ移動"]').click();
    await expect(startTimeInput).toHaveValue("10:15");
    await expect(endTimeInput).toHaveValue("10:50");
    await $('//button[@aria-label="5分短くする"]').click();
    await expect(endTimeInput).toHaveValue("10:45");
    await $('//button[@aria-label="所要時間を15分にする"]').click();
    await expect(endTimeInput).toHaveValue("10:30");
    await $("#schedule-description").setValue("合成予定の入力証跡");

    const details = $(".schedule-details");
    await expect(details).not.toHaveAttribute("open");
    const primaryGeometry = await browser.execute(() => {
      const inspector = document.querySelector<HTMLElement>(".inspector");
      const actions = document.querySelector<HTMLElement>(".inspector__actions");
      const body = document.querySelector<HTMLElement>(".inspector__form-body");
      if (!inspector || !actions || !body) throw new Error("schedule editor layout was not found");
      const inspectorRect = inspector.getBoundingClientRect();
      const actionsRect = actions.getBoundingClientRect();
      return {
        actionsVisible:
          actionsRect.top >= inspectorRect.top && actionsRect.bottom <= inspectorRect.bottom + 1,
        horizontalOverflow: body.scrollWidth - body.clientWidth,
      };
    });
    expect(primaryGeometry.actionsVisible).toBe(true);
    expect(primaryGeometry.horizontalOverflow).toBeLessThanOrEqual(1);
    await setExactLogicalViewportSize(1180, 820);
    await browser.execute(() => {
      const body = document.querySelector<HTMLElement>(".inspector__form-body");
      if (!body) throw new Error("schedule editor body was not found");
      body.scrollTop = 0;
    });
    await browser.saveScreenshot("./test-results/native-schedule-editor-primary.png");

    await persistTextScale(200);
    const zoomGeometry = await browser.execute(() => {
      const inspector = document.querySelector<HTMLElement>(".inspector");
      const actions = document.querySelector<HTMLElement>(".inspector__actions");
      const body = document.querySelector<HTMLElement>(".inspector__form-body");
      const dock = document.querySelector<HTMLElement>(".now-dock");
      const startInput = document.querySelector<HTMLInputElement>("#schedule-start-time");
      const endInput = document.querySelector<HTMLInputElement>("#schedule-end-time");
      const startSelect = document.querySelector<HTMLSelectElement>(
        'select[aria-label="開始時刻の候補"]',
      );
      const endSelect = document.querySelector<HTMLSelectElement>(
        'select[aria-label="終了時刻の候補"]',
      );
      if (
        !inspector ||
        !actions ||
        !body ||
        !startInput ||
        !endInput ||
        !startSelect ||
        !endSelect
      ) {
        throw new Error("schedule editor layout was not found");
      }
      const inspectorRect = inspector.getBoundingClientRect();
      const actionsRect = actions.getBoundingClientRect();
      const dockRect = dock?.getBoundingClientRect();
      const baseFontToken = Number.parseFloat(
        getComputedStyle(document.documentElement).getPropertyValue("--app-font-1"),
      );
      const startTrigger = startSelect.parentElement;
      const endTrigger = endSelect.parentElement;
      if (!startTrigger || !endTrigger) {
        throw new Error("schedule time dropdown triggers were not found");
      }
      startSelect.focus();
      const startTriggerFocused = document.activeElement === startSelect;
      const startTriggerOutlineWidth = Number.parseFloat(
        getComputedStyle(startTrigger).outlineWidth,
      );
      startSelect.blur();
      return {
        actionsAboveDock: dockRect ? actionsRect.bottom <= dockRect.top + 1 : true,
        actionsHeight: actionsRect.height,
        actionsVisible:
          actionsRect.top >= inspectorRect.top && actionsRect.bottom <= inspectorRect.bottom + 1,
        inputWidths: [startInput, endInput].map((control) => control.getBoundingClientRect().width),
        endSelectValue: endSelect.value,
        horizontalOverflow: body.scrollWidth - body.clientWidth,
        minimumReadableWidth: baseFontToken * 5,
        selectOpacity: [startSelect, endSelect].map((control) => getComputedStyle(control).opacity),
        startSelectValue: startSelect.value,
        startTriggerFocused,
        startTriggerOutlineWidth,
        triggerSizes: [startTrigger, endTrigger].map((trigger) => {
          const rect = trigger.getBoundingClientRect();
          return { height: rect.height, width: rect.width };
        }),
      };
    });
    expect(zoomGeometry.actionsAboveDock).toBe(true);
    expect(zoomGeometry.actionsHeight).toBeGreaterThan(0);
    expect(zoomGeometry.actionsVisible).toBe(true);
    expect(zoomGeometry.horizontalOverflow).toBeLessThanOrEqual(1);
    expect(
      zoomGeometry.inputWidths.every((width) => width >= zoomGeometry.minimumReadableWidth),
    ).toBe(true);
    expect(zoomGeometry.selectOpacity).toEqual(["0", "0"]);
    expect(zoomGeometry.startTriggerFocused).toBe(true);
    expect(zoomGeometry.startTriggerOutlineWidth).toBeGreaterThanOrEqual(3);
    expect(
      zoomGeometry.triggerSizes.every(({ height, width }) => height >= 44 && width >= 44),
    ).toBe(true);
    expect(zoomGeometry.startSelectValue).toBe("10:15");
    expect(zoomGeometry.endSelectValue).toBe("10:30");
    await browser.saveScreenshot("./test-results/native-schedule-editor-text-200.png");
    await persistTextScale(100);
    await browser.waitUntil(
      async () =>
        browser.execute(
          () =>
            Number.parseFloat(getComputedStyle(document.querySelector(".inspector h2")!).fontSize) <
            30,
        ),
      { timeout: 2_000 },
    );

    await chooseScheduleTime("開始時刻の候補", "23:30");
    await chooseScheduleTime("終了時刻の候補", "00:30");
    await expect($('//span[normalize-space(.)="翌日"]')).toBeDisplayed();
    await $('//label[contains(., "終了日")]/input[@type="date"]').waitForDisplayed();
    await browser.saveScreenshot("./test-results/native-schedule-editor-cross-midnight.png");
    await $('//aside//button[normalize-space(.)="予定を作成"]').click();
    const created = $(`//*[normalize-space(.)="${title}"]`);
    await created.waitForDisplayed();
    await setExactLogicalViewportSize(1024, 640);
    await saveAppShellAtLogicalSize("./test-results/native-today.png", 1024, 640);

    await $(`//button[starts-with(@aria-label, "${title} ")]`).click();
    await $('//aside//*[@role="tab" and normalize-space(.)="編集"]').click();
    const description = $("#schedule-description");
    await description.waitForDisplayed();
    await description.setValue(
      "## 予定の手順\n\n| 時刻 | 作業 |\n| --- | --- |\n| 09:00 | 設計 |\n| 09:30 | 確認 |\n\n- [x] 準備\n- [ ] 実施\n\n[運用手順](https://example.invalid/runbook)",
    );
    await $('//aside//button[normalize-space(.)="変更を保存"]').click();
    await $('//aside//button[@aria-label="編集を閉じる"]').waitForExist({ reverse: true });
    await $(`//button[starts-with(@aria-label, "${title} ")]`).click();
    const plainPreview = $("#schedule-description-plain-panel");
    await plainPreview.waitForDisplayed();
    await expect(plainPreview).toHaveText(/## 予定の手順/);
    const plainExternalLink = plainPreview.$(
      './/a[normalize-space(.)="https://example.invalid/runbook"]',
    );
    await plainExternalLink.waitForDisplayed();
    await expect(plainExternalLink).toHaveAttribute("href", "https://example.invalid/runbook");
    await browser.execute(() => {
      const inspector = document.querySelector<HTMLElement>(".inspector__form-body");
      const region = document.querySelector<HTMLElement>("#schedule-description-plain-panel");
      if (!inspector || !region) throw new Error("schedule plain preview was not found");
      inspector.scrollTop = Math.max(0, region.offsetTop - 180);
    });
    await browser.saveScreenshot("./test-results/native-schedule-plain-preview.png");
    await $('//aside//*[@role="tab" and normalize-space(.)="Markdownプレビュー"]').click();
    const preview = $("#schedule-description-markdown-panel");
    await preview.waitForDisplayed();
    const externalLink = preview.$('.//a[contains(normalize-space(.), "運用手順")]');
    await externalLink.waitForDisplayed();
    await expect(externalLink).toHaveAttribute("href", "https://example.invalid/runbook");
    const inspectorScrollTop = await browser.execute(() => {
      const inspector = document.querySelector<HTMLElement>(".inspector__form-body");
      const region = document.querySelector<HTMLElement>("#schedule-description-markdown-panel");
      if (!inspector || !region) throw new Error("schedule Markdown preview was not found");
      inspector.scrollTop = Math.max(0, region.offsetTop - 180);
      return inspector.scrollTop;
    });
    expect(inspectorScrollTop).toBeGreaterThan(0);
    await browser.saveScreenshot("./test-results/native-schedule-markdown-preview.png");
    await $('//aside//button[@aria-label="編集を閉じる"]').click();

    await browser.refresh();
    await $(".today-heading h1").waitForDisplayed();
    await $('//aside[@aria-label="主要画面"]//button[contains(., "一覧")]').click();
    const listHeading = $("main h1");
    await listHeading.waitForDisplayed();
    await expect(listHeading).toHaveText("予定一覧");
    const search = $('input[placeholder="タイトル、タグ、プロジェクト…"]');
    await search.setValue(title);
    const persisted = $(`//table//*[normalize-space(.)="${title}"]`);
    await persisted.waitForDisplayed();
    await expect(persisted).toBeDisplayed();
    await browser.saveScreenshot("./test-results/native-list.png");
  });

  it("compares schedules with a read-only template across normal, empty, narrow, and 200% text states", async () => {
    await setLogicalWindowSize(1180, 820);
    const bootstrap = (await browser.tauri.execute(({ core }) => core.invoke("bootstrap_get"))) as {
      settings: Record<string, unknown>;
      today: string;
      timezoneId: string;
    };
    const template = (await browser.tauri.execute(
      ({ core }, draft) => core.invoke("template_save", { input: { draft } }),
      {
        name: "比較用テンプレート",
        description: "synthetic native evidence",
        color: "#6F96F4",
        weekdaysMask: 127,
        blocks: [
          {
            title: "朝の準備",
            startMinute: 420,
            durationMinutes: 45,
            color: "#F4B96F",
            project: "synthetic",
            category: "evidence",
          },
          {
            title: "集中作業",
            startMinute: 540,
            durationMinutes: 90,
            color: "#6F96F4",
            project: "synthetic",
            category: "evidence",
          },
          {
            title: "短い確認",
            startMinute: 625,
            durationMinutes: 10,
            color: "#68B984",
            project: "synthetic",
            category: "evidence",
          },
          {
            title: "翌日の準備",
            startMinute: 1439,
            durationMinutes: 60,
            color: "#B784E8",
            project: "synthetic",
            category: "evidence",
          },
        ],
      },
    )) as { id: string };
    await browser.tauri.execute(
      ({ core }, settings) => core.invoke("settings_update", { settings }),
      { ...bootstrap.settings, lastTemplateId: template.id },
    );
    await browser.tauri.execute(
      async ({ core }, input) => {
        const dayStart = new Date(`${input.today}T00:00:00`);
        const drafts = [
          { title: "午前の予定", startMinute: 540, durationMinutes: 60, color: "#6F96F4" },
          { title: "重なる予定", startMinute: 595, durationMinutes: 45, color: "#68B984" },
          { title: "日跨ぎ予定", startMinute: 1410, durationMinutes: 60, color: "#F4B96F" },
        ];
        for (const fixture of drafts) {
          const start = new Date(dayStart);
          start.setMinutes(fixture.startMinute);
          const end = new Date(start.getTime() + fixture.durationMinutes * 60_000);
          await core.invoke("schedule_create", {
            draft: {
              title: fixture.title,
              description: "synthetic native evidence",
              location: "",
              startUtc: start.toISOString(),
              endUtc: end.toISOString(),
              timezoneId: input.timezoneId,
              allDay: false,
              allDayStartDate: null,
              allDayEndDateExclusive: null,
              status: "scheduled",
              project: "synthetic",
              category: "evidence",
              tags: [],
              color: fixture.color,
              priority: "normal",
              recurrenceRule: null,
              recurrenceSupplementalLines: [],
              recurrenceExdates: [],
              startNotificationMinutes: null,
              endNotificationMinutes: null,
            },
          });
        }
      },
      { today: bootstrap.today, timezoneId: bootstrap.timezoneId },
    );

    await browser.refresh();
    await $(".app-shell").waitForDisplayed();
    await $('//aside[@aria-label="主要画面"]//button[contains(., "今日")]').click();
    await $('//h3[normalize-space(.)="比較用テンプレート"]').waitForDisplayed();
    await $(".overview-template-block").waitForDisplayed();
    const stripGeometry = await browser.execute(() => {
      const blocks = Array.from(
        document.querySelectorAll<HTMLElement>(".overview-event, .overview-template-block"),
      );
      const overviewTicks = Array.from(document.querySelectorAll<HTMLElement>(".overview-tick"));
      const trackDetails = Array.from(
        document.querySelectorAll<HTMLElement>(".overview-lane__track"),
      ).map((track) => {
        const trackBounds = track.getBoundingClientRect();
        const levelTops = Array.from(
          new Set(
            Array.from(
              track.querySelectorAll<HTMLElement>(".overview-event, .overview-template-block"),
            ).map((block) => Math.round(block.getBoundingClientRect().top - trackBounds.top)),
          ),
        ).sort((left, right) => left - right);
        return {
          height: trackBounds.height,
          blockHeights: Array.from(
            track.querySelectorAll<HTMLElement>(".overview-event, .overview-template-block"),
          ).map((block) => block.getBoundingClientRect().height),
          levelTops,
          levelGaps: levelTops
            .map((top, index) => {
              const previousLevelTop = levelTops
                .slice(0, index)
                .find((candidate) => top - candidate >= 50);
              return previousLevelTop === undefined ? null : top - previousLevelTop - 60;
            })
            .filter((gap): gap is number => gap !== null),
        };
      });
      return {
        blockHeights: blocks.map((block) => block.getBoundingClientRect().height),
        overviewTickCount: overviewTicks.length,
        overviewTickLabels: overviewTicks.map((tick) => tick.textContent),
        overviewHeight:
          document.querySelector<HTMLElement>(".overview")?.getBoundingClientRect().height ?? 0,
        trackHeights: trackDetails.map((track) => track.height),
        trackDetails,
        trackBackgrounds: trackDetails.map((_, index) => {
          const track = document.querySelectorAll<HTMLElement>(".overview-lane__track")[index];
          return track ? window.getComputedStyle(track).backgroundImage : "";
        }),
        visibleLabels: blocks.map((block) => ({
          index: block.dataset.overviewIndex,
          start: block.querySelector<HTMLElement>("[class$='__start']")?.textContent,
          title: block.querySelector<HTMLElement>("[class$='__title']")?.textContent,
        })),
      };
    });
    await writeFile(
      "./test-results/native-today-overview-geometry.json",
      `${JSON.stringify(stripGeometry, null, 2)}\n`,
      "utf8",
    );
    expect(stripGeometry.blockHeights.every((height) => Math.abs(height - 60) <= 1)).toBe(true);
    expect(stripGeometry.overviewTickCount).toBe(25);
    expect(stripGeometry.overviewTickLabels).toEqual(
      Array.from({ length: 25 }, (_, hour) => String(hour).padStart(2, "0")),
    );
    expect(
      stripGeometry.trackBackgrounds.every(
        (background) => (background.match(/repeating-linear-gradient/g) ?? []).length >= 2,
      ),
    ).toBe(true);
    expect(stripGeometry.trackHeights.every((height) => height >= 76)).toBe(true);
    expect(
      stripGeometry.visibleLabels.every(({ index, start, title }) => index && start && title),
    ).toBe(true);
    expect(
      stripGeometry.trackDetails
        .flatMap((track) => track.levelGaps)
        .every((gap) => gap >= 2 && gap < 6),
    ).toBe(true);
    const laneOverflows = await browser.execute(() =>
      Array.from(document.querySelectorAll<HTMLElement>(".overview-lane__track")).flatMap(
        (track, laneIndex) => {
          const trackHeight = Number.parseFloat(track.style.height);
          return Array.from(
            track.querySelectorAll<HTMLElement>(".overview-event, .overview-template-block"),
          )
            .filter((block) => {
              const blockTop = Number.parseFloat(block.style.top);
              const blockHeight = Number.parseFloat(block.style.height);
              return blockTop + blockHeight > trackHeight + 1;
            })
            .map((block) => {
              const blockTop = Number.parseFloat(block.style.top);
              const blockHeight = Number.parseFloat(block.style.height);
              return {
                laneIndex,
                label: block.getAttribute("aria-label"),
                trackHeight,
                trackInlineHeight: track.style.height,
                trackInlineMinHeight: track.style.minHeight,
                blockTop,
                blockHeight,
                overflowPixels: blockTop + blockHeight - trackHeight,
              };
            });
        },
      ),
    );
    expect(laneOverflows).toEqual([]);
    await browser.saveScreenshot("./test-results/native-today-dual-strip.png");

    const nextDay = $('//header//button[@aria-label="次の日"]');
    await nextDay.click();
    await nextDay.click();
    await $('//*[normalize-space(.)="今日の予定はありません"]').waitForDisplayed();
    await browser.saveScreenshot("./test-results/native-today-dual-strip-empty.png");
    await $('//header//button[normalize-space(.)="今日"]').click();
    await $(".overview-template-block").waitForDisplayed();

    await setLogicalWindowSize(720, 820);
    await browser.saveScreenshot("./test-results/native-today-dual-strip-narrow.png");

    await setLogicalWindowSize(1180, 820);
    await persistTextScale(200);
    const rootTextScale = await browser.execute(() =>
      Number.parseFloat(
        getComputedStyle(document.documentElement).getPropertyValue("--app-font-1"),
      ),
    );
    expect(rootTextScale).toBeGreaterThanOrEqual(32);
    await browser.pause(100);
    await browser.saveScreenshot("./test-results/native-today-dual-strip-text-200.png");
    await persistTextScale(100);
  });

  it("keeps primary navigation usable at the minimum supported window width", async () => {
    await setLogicalWindowSize(720, 720);
    await $('//aside[@aria-label="主要画面"]//button[contains(., "設定")]').click();
    const settingsHeading = $("main h1");
    await settingsHeading.waitForDisplayed();
    await expect(settingsHeading).toBeDisplayed();
    await expect(settingsHeading).toHaveText("設定");
    await browser.saveScreenshot("./test-results/native-narrow-settings.png");
  });

  it("offers the app-managed Google connection without requiring OAuth JSON", async () => {
    await setLogicalWindowSize(1180, 820);
    await $('//aside[@aria-label="主要画面"]//button[contains(., "設定")]').click();
    const googlePanel = $('section[aria-labelledby="google-panel-title"]');
    await googlePanel.waitForExist();
    await browser.execute(() => {
      document
        .querySelector('section[aria-labelledby="google-panel-title"]')
        ?.scrollIntoView({ block: "start" });
    });

    const connection = (await browser.tauri.execute(({ core }) =>
      core.invoke("google_connection_get"),
    )) as { configured: boolean; state: string; accountId: string | null };
    expect(connection).toMatchObject({
      configured: true,
      state: "configured",
      accountId: null,
    });

    const connect = $('//button[normalize-space(.)="Google カレンダーに接続"]');
    await connect.waitForDisplayed();
    await expect(connect).toBeEnabled();
    await expect($('//summary[normalize-space(.)="開発者向けOAuth設定"]')).toBeDisplayed();
    await expect(
      $('//button[contains(normalize-space(.), "独自のOAuth設定")]'),
    ).not.toBeDisplayed();
    await browser.saveScreenshot("./test-results/native-google-connect.png");

    await browser.execute(() => {
      const panel = document.querySelector('section[aria-labelledby="google-panel-title"]');
      if (!(panel instanceof HTMLElement)) throw new Error("Google panel was not found");
      const descendants: HTMLElement[] = Array.from(panel.querySelectorAll("*")).filter(
        (element): element is HTMLElement => element instanceof HTMLElement,
      );
      const elements: HTMLElement[] = [panel, ...descendants];
      const sizes: Array<{
        element: HTMLElement;
        fontSize: number;
        original: string;
      }> = elements.map((element) => ({
        element,
        fontSize: Number.parseFloat(window.getComputedStyle(element).fontSize),
        original: element.style.fontSize,
      }));
      sizes.forEach(({ element, fontSize, original }) => {
        element.dataset.e2eOriginalFontSize = original;
        if (Number.isFinite(fontSize)) {
          element.style.setProperty("font-size", `${fontSize * 2}px`, "important");
        }
      });
      panel.scrollIntoView({ block: "start" });
    });
    await expect(connect).toBeDisplayed();
    await browser.saveScreenshot("./test-results/native-google-connect-text-200.png");
    await browser.execute(() => {
      const panel = document.querySelector('section[aria-labelledby="google-panel-title"]');
      if (!(panel instanceof HTMLElement)) return;
      const descendants: HTMLElement[] = Array.from(panel.querySelectorAll("*")).filter(
        (element): element is HTMLElement => element instanceof HTMLElement,
      );
      [panel, ...descendants].forEach((element: HTMLElement) => {
        const original = element.dataset.e2eOriginalFontSize ?? "";
        if (original) element.style.fontSize = original;
        else element.style.removeProperty("font-size");
        delete element.dataset.e2eOriginalFontSize;
      });
    });
  });

  it("persists template, Quick Block, alarm, and Focus workflows through native IPC", async () => {
    await setLogicalWindowSize(1180, 820);
    const suffix = Date.now();
    const templateName = `E2Eテンプレート-${suffix}`;
    const quickName = `E2E Quick-${suffix}`;
    const alarmName = `E2Eアラーム-${suffix}`;

    await $('//aside[@aria-label="主要画面"]//button[contains(., "テンプレート")]').click();
    await $(
      '//section[@aria-labelledby="template-list-title"]//button[contains(., "新規")]',
    ).click();
    const templateNameInput = $(
      '//section[@aria-labelledby="template-editor-title"]//label[contains(., "名前")]/input',
    );
    await templateNameInput.setValue(templateName);
    await expect(templateNameInput).toHaveValue(templateName);
    await $(
      '//section[@aria-labelledby="template-editor-title"]//button[contains(., "ブロック")]',
    ).click();
    const blockTitleInput = $(
      '//div[contains(@class,"block-editor")]//label[contains(., "タイトル")]/input',
    );
    await blockTitleInput.waitForDisplayed();
    await blockTitleInput.setValue("E2Eブロック");
    await expect(blockTitleInput).toHaveValue("E2Eブロック");
    await $(
      '//section[@aria-labelledby="template-editor-title"]//button[contains(., "テンプレートを保存")]',
    ).click();
    await browser.waitUntil(
      async () => {
        const persisted = (await browser.tauri.execute(({ core }) =>
          core.invoke("template_list"),
        )) as Array<{ name: string }>;
        return persisted.some((template) => template.name === templateName);
      },
      { timeoutMsg: "template was not persisted through native IPC" },
    );
    const templateCard = $(
      `//section[@aria-labelledby="template-list-title"]//*[normalize-space(.)="${templateName}"]`,
    );
    await templateCard.waitForExist();
    await templateCard.scrollIntoView({ block: "center" });
    await expect(templateCard).toBeDisplayed();
    await browser.execute(() =>
      document.querySelector(".template-visual-editor")?.scrollIntoView({ block: "start" }),
    );
    await browser.saveScreenshot("./test-results/native-template-editor.png");
    await $(
      '//section[@aria-labelledby="quick-block-title"]//label[contains(., "タイトル")]/input',
    ).setValue(quickName);
    await $(
      '//section[@aria-labelledby="quick-block-title"]//button[normalize-space(.)="追加"]',
    ).click();
    await $(
      `//section[@aria-labelledby="quick-block-title"]//*[normalize-space(.)="${quickName}"]`,
    ).waitForDisplayed();
    await browser.saveScreenshot("./test-results/native-template-library.png");

    await $('//aside[@aria-label="主要画面"]//button[contains(., "アラーム")]').click();
    await $(
      '//section[contains(@class,"alarm-editor")]//label[contains(., "ラベル")]/input',
    ).setValue(alarmName);
    await $(
      '//section[contains(@class,"alarm-editor")]//button[contains(., "アラームを追加")]',
    ).click();
    await $(`//*[normalize-space(.)="${alarmName}"]`).waitForDisplayed();

    await $('//aside[@aria-label="主要画面"]//button[contains(., "フォーカス")]').click();
    await $('//button[normalize-space(.)="作業を開始"]').click();
    await $('//button[normalize-space(.)="Focusを終了"]').waitForDisplayed();
    await $('//button[normalize-space(.)="Focusを終了"]').click();
    const startFocus = $('//button[normalize-space(.)="作業を開始"]');
    await startFocus.waitForDisplayed();
    await startFocus.waitForEnabled();
    await browser.saveScreenshot("./test-results/native-focus-history.png");

    const persisted = await browser.tauri.execute(async ({ core }) => ({
      templates: await core.invoke("template_list"),
      quickBlocks: await core.invoke("quick_block_list"),
      alarms: await core.invoke("free_alarm_list"),
    }));
    expect(persisted.templates).toEqual(
      expect.arrayContaining([expect.objectContaining({ name: templateName })]),
    );
    expect(persisted.quickBlocks).toEqual(
      expect.arrayContaining([expect.objectContaining({ title: quickName })]),
    );
    expect(persisted.alarms).toEqual(
      expect.arrayContaining([expect.objectContaining({ label: alarmName })]),
    );
  });

  it("persists multiple timers, a timer set, and the stopwatch through native IPC", async () => {
    await setLogicalWindowSize(1180, 820);
    await $('//aside[@aria-label="主要画面"]//button[contains(., "タイマー")]').click();
    await $('//main//h1[normalize-space(.)="タイマー"]').waitForDisplayed();

    const newLabel = $('//input[@placeholder="例: 紅茶、ストレッチ"]');
    await newLabel.setValue("E2E紅茶");
    await $('//button[normalize-space(.)="タイマーを追加"]').click();
    await $('//article[.//h3[normalize-space(.)="E2E紅茶"]]').waitForDisplayed();
    await newLabel.setValue("E2Eストレッチ");
    await $('//button[normalize-space(.)="タイマーを追加"]').click();
    await $('//article[.//h3[normalize-space(.)="E2Eストレッチ"]]').waitForDisplayed();

    await $(
      '//article[.//h3[normalize-space(.)="E2E紅茶"]]//button[normalize-space(.)="開始"]',
    ).click();
    await $(
      '//article[.//h3[normalize-space(.)="E2E紅茶"]]//button[normalize-space(.)="一時停止"]',
    ).waitForDisplayed();
    await $(
      '//article[.//h3[normalize-space(.)="E2E紅茶"]]//button[normalize-space(.)="一時停止"]',
    ).click();

    await $('//input[@placeholder="例: 朝の準備"]').setValue("E2E休憩セット");
    await $('//button[normalize-space(.)="現在の構成を保存"]').click();
    await browser.waitUntil(
      async () => {
        const sets = (await browser.tauri.execute(({ core }) =>
          core.invoke("timer_set_list"),
        )) as Array<{ name: string }>;
        return sets.some((set) => set.name === "E2E休憩セット");
      },
      { timeoutMsg: "timer set was not persisted" },
    );
    await $('//*[normalize-space(.)="E2E休憩セット"]').waitForDisplayed();
    await scrollActiveViewToTop();
    await browser.saveScreenshot("./test-results/native-timers.png");

    await $('//aside[@aria-label="主要画面"]//button[contains(., "ストップウォッチ")]').click();
    await $('//main//h1[normalize-space(.)="ストップウォッチ"]').waitForDisplayed();
    await $('//button[normalize-space(.)="計測を開始"]').click();
    await $(
      '//section[@aria-labelledby="stopwatch-title"]//button[normalize-space(.)="一時停止"]',
    ).waitForDisplayed();
    await browser.pause(1_100);
    await $(
      '//section[@aria-labelledby="stopwatch-title"]//button[normalize-space(.)="一時停止"]',
    ).click();
    await browser.saveScreenshot("./test-results/native-stopwatch.png");

    await browser.refresh();
    await $(".app-shell").waitForDisplayed();
    await $('//aside[@aria-label="主要画面"]//button[contains(., "タイマー")]').click();
    await $('//article[.//h3[normalize-space(.)="E2E紅茶"]]').waitForDisplayed();
    const persisted = await browser.tauri.execute(async ({ core }) => ({
      timers: await core.invoke("timer_list"),
      sets: await core.invoke("timer_set_list"),
      stopwatch: await core.invoke("stopwatch_state_get"),
    }));
    expect(persisted.timers).toHaveLength(2);
    expect(persisted.timers).toEqual(
      expect.arrayContaining([expect.objectContaining({ label: "E2E紅茶", status: "paused" })]),
    );
    expect(persisted.sets).toEqual(
      expect.arrayContaining([expect.objectContaining({ name: "E2E休憩セット" })]),
    );
    expect(persisted.stopwatch).toMatchObject({ status: "paused" });

    await setLogicalWindowSize(720, 720);
    await scrollActiveViewToTop();
    await browser.saveScreenshot("./test-results/native-timers-narrow.png");
    await persistTextScale(200);
    await scrollActiveViewToTop();
    await $('//main//h1[normalize-space(.)="タイマー"]').waitForDisplayed();
    await browser.saveScreenshot("./test-results/native-timers-text-200.png");
    await persistTextScale(100);
  });

  it("persists and renders the mild theme across main window reloads", async () => {
    await setLogicalWindowSize(1180, 820);
    await $('//aside[@aria-label="主要画面"]//button[contains(., "設定")]').click();
    const theme = $('//label[contains(., "テーマ")]/select');
    await browser.execute(() => {
      const label = Array.from(document.querySelectorAll("label")).find((candidate) =>
        candidate.textContent?.includes("テーマ"),
      );
      const select = label?.querySelector("select");
      if (!select) throw new Error("theme select was not found");
      select.value = "mild";
      select.dispatchEvent(new Event("change", { bubbles: true }));
    });
    await expect(theme).toHaveValue("mild");
    await $('//button[normalize-space(.)="設定を保存"]').click();
    await $(
      '//*[self::div or self::section][contains(., "設定をこの端末に保存しました")]',
    ).waitForDisplayed();
    await browser.waitUntil(async () => (await $("html").getAttribute("data-theme")) === "mild", {
      timeoutMsg: "mild theme was not applied after saving settings",
    });
    await scrollActiveViewToTop();
    await browser.saveScreenshot("./test-results/native-mild-settings.png");
    const savedSettings = (await browser.tauri.execute(({ core }) =>
      core.invoke("bootstrap_get"),
    )) as { settings: { theme: string } };
    expect(savedSettings.settings.theme).toBe("mild");

    await browser.refresh();
    await $(".app-shell").waitForDisplayed();
    await browser.waitUntil(async () => (await $("html").getAttribute("data-theme")) === "mild", {
      timeoutMsg: "mild theme was not restored after reloading the application",
    });
    await $('//aside[@aria-label="主要画面"]//button[contains(., "今日")]').click();
    await browser.saveScreenshot("./test-results/native-mild-today.png");

    await $('//aside[@aria-label="主要画面"]//button[contains(., "設定")]').click();
    const restoredTheme = $('//label[contains(., "テーマ")]/select');
    await browser.execute(() => {
      const label = Array.from(document.querySelectorAll("label")).find((candidate) =>
        candidate.textContent?.includes("テーマ"),
      );
      const select = label?.querySelector("select");
      if (!select) throw new Error("theme select was not found");
      select.value = "light";
      select.dispatchEvent(new Event("change", { bubbles: true }));
    });
    await expect(restoredTheme).toHaveValue("light");
    await $('//button[normalize-space(.)="設定を保存"]').click();
    await browser.waitUntil(async () => (await $("html").getAttribute("data-theme")) === "light", {
      timeoutMsg: "light fixture theme was not restored after mild-theme evidence capture",
    });
  });

  it("previews and persists 250% text without hiding settings or Today actions", async () => {
    await setLogicalWindowSize(1180, 820);
    await $('//aside[@aria-label="主要画面"]//button[contains(., "設定")]').click();
    const scale = $('//label[contains(., "文字表示倍率")]/select');
    await selectTextScale(100);
    await scrollActiveViewToTop();
    await browser.saveScreenshot("./test-results/native-settings-text-100.png");
    for (const textScalePercent of textScaleValues.slice(1)) {
      await selectTextScale(textScalePercent);
    }
    await expect(scale).toHaveValue("250");
    const previewGeometry = await browser.execute(() => {
      const view = document.querySelector<HTMLElement>(".settings-view");
      const select = Array.from(document.querySelectorAll<HTMLSelectElement>("select")).find(
        (candidate) => candidate.closest("label")?.textContent?.includes("文字表示倍率"),
      );
      const save = Array.from(document.querySelectorAll<HTMLButtonElement>("button")).find(
        (candidate) => candidate.textContent?.trim() === "設定を保存",
      );
      if (!view || !select || !save) throw new Error("250% settings layout was incomplete");
      return {
        horizontalOverflow: view.scrollWidth - view.clientWidth,
        rootFontSize: Number.parseFloat(
          getComputedStyle(document.documentElement).getPropertyValue("--app-font-1"),
        ),
        saveHeight: save.getBoundingClientRect().height,
        selectHeight: select.getBoundingClientRect().height,
      };
    });
    expect(previewGeometry.horizontalOverflow).toBeLessThanOrEqual(1);
    expect(previewGeometry.rootFontSize).toBeGreaterThanOrEqual(40);
    expect(previewGeometry.saveHeight).toBeGreaterThan(0);
    expect(previewGeometry.selectHeight).toBeGreaterThan(0);

    const settingsBottomGeometry = await browser.execute(() => {
      const view = document.querySelector<HTMLElement>(".settings-view");
      const save = Array.from(document.querySelectorAll<HTMLButtonElement>("button")).find(
        (candidate) => candidate.textContent?.trim() === "設定を保存",
      );
      if (!view || !save) throw new Error("250% settings save target was not rendered");
      save.scrollIntoView({ block: "center" });
      const viewportWidth = document.documentElement.clientWidth;
      const viewportHeight = document.documentElement.clientHeight;
      const viewRect = view.getBoundingClientRect();
      const saveRect = save.getBoundingClientRect();
      const centerX = saveRect.left + saveRect.width / 2;
      const centerY = saveRect.top + saveRect.height / 2;
      const hit =
        centerX >= 0 && centerX < viewportWidth && centerY >= 0 && centerY < viewportHeight
          ? document.elementFromPoint(centerX, centerY)
          : null;
      return {
        saveReachable:
          saveRect.left >= 0 &&
          saveRect.right <= viewportWidth + 1 &&
          saveRect.top >= 0 &&
          saveRect.bottom <= viewportHeight + 1 &&
          saveRect.height > 0 &&
          (hit === save || (hit instanceof Node && save.contains(hit))),
        viewBottom: viewRect.bottom,
        viewTop: viewRect.top,
      };
    });
    expect(settingsBottomGeometry.saveReachable).toBe(true);
    await scrollActiveViewToTop();
    await browser.saveScreenshot("./test-results/native-settings-text-250.png");

    await browser.execute(() => {
      const save = Array.from(document.querySelectorAll<HTMLButtonElement>("button")).find(
        (candidate) => candidate.textContent?.trim() === "設定を保存",
      );
      save?.scrollIntoView({ block: "center" });
    });
    await $('//button[normalize-space(.)="設定を保存"]').click();
    await browser.waitUntil(
      async () => {
        const bootstrap = (await browser.tauri.execute(({ core }) =>
          core.invoke("bootstrap_get"),
        )) as { settings: { textScalePercent: number } };
        return bootstrap.settings.textScalePercent === 250;
      },
      { timeoutMsg: "250% text scale was not persisted" },
    );
    await browser.refresh();
    await $(".app-shell").waitForDisplayed();
    await browser.waitUntil(
      async () => (await $("html").getAttribute("data-text-scale")) === "250",
      {
        timeoutMsg: "250% text scale was not restored after reload",
      },
    );
    await $('//aside[@aria-label="主要画面"]//button[contains(., "今日")]').click();
    const todayGeometry = await browser.execute(() => {
      const shell = document.querySelector<HTMLElement>(".app-shell");
      const content = document.querySelector<HTMLElement>(".app-content");
      const dock = document.querySelector<HTMLElement>(".now-dock");
      const dateNavigation = document.querySelector<HTMLElement>(".date-navigation");
      if (!shell || !content || !dock || !dateNavigation) {
        throw new Error("250% Today layout was incomplete");
      }
      const viewportWidth = document.documentElement.clientWidth;
      const viewportHeight = document.documentElement.clientHeight;
      const isReachable = (control: HTMLElement) => {
        const rect = control.getBoundingClientRect();
        const centerX = rect.left + rect.width / 2;
        const centerY = rect.top + rect.height / 2;
        const hit =
          centerX >= 0 && centerX < viewportWidth && centerY >= 0 && centerY < viewportHeight
            ? document.elementFromPoint(centerX, centerY)
            : null;
        return (
          rect.left >= 0 &&
          rect.right <= viewportWidth + 1 &&
          rect.top >= 0 &&
          rect.bottom <= viewportHeight + 1 &&
          rect.width > 0 &&
          rect.height > 0 &&
          (hit === control || (hit instanceof Node && control.contains(hit)))
        );
      };
      const controls = Array.from(dateNavigation.querySelectorAll<HTMLElement>("button"));
      const primaryActions = [
        ...Array.from(document.querySelectorAll<HTMLElement>(".topbar__actions .button--primary")),
        ...Array.from(document.querySelectorAll<HTMLElement>(".history-actions button")),
      ];
      if (primaryActions.length === 0) throw new Error("250% Today actions were not rendered");
      const nextDockItems = [
        dock.querySelector<HTMLElement>(".now-dock__next"),
        dock.querySelector<HTMLElement>(".now-dock__focus"),
      ].filter((item): item is HTMLElement => item !== null);
      const alarmText = dock.querySelector<HTMLElement>(".now-dock__alarm");
      if (nextDockItems.length === 0 || !alarmText) {
        throw new Error("250% Today dock items were not rendered");
      }
      dock.scrollTop = dock.scrollHeight;
      const dockRect = dock.getBoundingClientRect();
      const maxDockScroll = Math.max(0, dock.scrollHeight - dock.clientHeight);
      const alarmRect = alarmText.getBoundingClientRect();
      const alarmRange = document.createRange();
      alarmRange.selectNodeContents(alarmText);
      const alarmTextRects = Array.from(alarmRange.getClientRects());
      if (alarmTextRects.length === 0) throw new Error("250% Today alarm text was empty");
      return {
        alarmContentInsideElement: alarmTextRects.every(
          (rect) =>
            rect.left >= alarmRect.left - 1 &&
            rect.right <= alarmRect.right + 1 &&
            rect.top >= alarmRect.top - 1 &&
            rect.bottom <= alarmRect.bottom + 1,
        ),
        alarmContentInsideDock: alarmTextRects.every(
          (rect) =>
            rect.left >= dockRect.left - 1 &&
            rect.right <= dockRect.right + 1 &&
            rect.top >= dockRect.top - 1 &&
            rect.bottom <= dockRect.bottom + 1,
        ),
        alarmInsideDock:
          alarmRect.left >= dockRect.left - 1 &&
          alarmRect.right <= dockRect.right + 1 &&
          alarmRect.top >= dockRect.top - 1 &&
          alarmRect.bottom <= dockRect.bottom + 1,
        alarmHorizontalOverflow: alarmText.scrollWidth - alarmText.clientWidth,
        alarmInsideViewport:
          alarmRect.top >= 0 && alarmRect.bottom <= viewportHeight + 1 && alarmRect.height > 0,
        alarmVerticalOverflow: alarmText.scrollHeight - alarmText.clientHeight,
        controlsReachable: controls.every(isReachable),
        dockAtBottom: Math.abs(dock.scrollTop - maxDockScroll) <= 1,
        dockEndItemsReachable: nextDockItems.every((item) => {
          const rect = item.getBoundingClientRect();
          return (
            rect.left >= dockRect.left &&
            rect.right <= dockRect.right + 1 &&
            rect.top >= dockRect.top &&
            rect.bottom <= dockRect.bottom + 1 &&
            rect.height > 0 &&
            isReachable(item)
          );
        }),
        dockScrollable: dock.scrollHeight > dock.clientHeight,
        primaryActionsReachable: primaryActions.every(isReachable),
        primaryActionLabels: primaryActions.map((action) => action.textContent?.trim() ?? ""),
        shellOverflow: shell.scrollWidth - shell.clientWidth,
        contentWidth: content.getBoundingClientRect().width,
      };
    });
    expect(todayGeometry.controlsReachable).toBe(true);
    expect(todayGeometry.primaryActionsReachable).toBe(true);
    expect(todayGeometry.alarmContentInsideElement).toBe(true);
    expect(todayGeometry.alarmContentInsideDock).toBe(true);
    expect(todayGeometry.alarmInsideDock).toBe(true);
    expect(todayGeometry.alarmInsideViewport).toBe(true);
    expect(todayGeometry.alarmHorizontalOverflow).toBeLessThanOrEqual(1);
    expect(todayGeometry.alarmVerticalOverflow).toBeLessThanOrEqual(1);
    expect(todayGeometry.dockScrollable ? todayGeometry.dockAtBottom : true).toBe(true);
    expect(todayGeometry.dockEndItemsReachable).toBe(true);
    expect(todayGeometry.shellOverflow).toBeLessThanOrEqual(1);
    expect(todayGeometry.contentWidth).toBeGreaterThan(0);
    await browser.saveScreenshot("./test-results/native-today-text-250.png");

    await setLogicalWindowSize(720, 720);
    const narrowTextGeometry = await browser.execute(() => {
      const shell = document.querySelector<HTMLElement>(".app-shell");
      const workspace = document.querySelector<HTMLElement>(".workspace-main");
      const history = document.querySelector<HTMLElement>(".history-actions");
      const dock = document.querySelector<HTMLElement>(".now-dock");
      const readableList = document.querySelector<HTMLElement>(".timeline-readable-list");
      const timelineCanvas = document.querySelector<HTMLElement>(".timeline-canvas");
      const alarmText = dock?.querySelector<HTMLElement>(".now-dock__alarm");
      const hourNine = Array.from(
        document.querySelectorAll<HTMLElement>(".timeline-hour span"),
      ).find((label) => label.textContent?.trim() === "09:00");
      if (
        !shell ||
        !workspace ||
        !history ||
        !dock ||
        !readableList ||
        !timelineCanvas ||
        !alarmText ||
        !hourNine
      ) {
        throw new Error("720px / 250% Today layout was incomplete");
      }
      const viewportWidth = document.documentElement.clientWidth;
      const viewportHeight = document.documentElement.clientHeight;
      const isInsideViewport = (element: HTMLElement) => {
        const rect = element.getBoundingClientRect();
        return (
          rect.left >= 0 &&
          rect.right <= viewportWidth + 1 &&
          rect.top >= 0 &&
          rect.bottom <= viewportHeight + 1 &&
          rect.width > 0 &&
          rect.height > 0
        );
      };
      workspace.scrollTop = workspace.scrollHeight;
      dock.scrollTop = dock.scrollHeight;
      const workspaceMaxScroll = Math.max(0, workspace.scrollHeight - workspace.clientHeight);
      const dockMaxScroll = Math.max(0, dock.scrollHeight - dock.clientHeight);
      const dockRect = dock.getBoundingClientRect();
      const alarmRect = alarmText.getBoundingClientRect();
      const alarmRange = document.createRange();
      alarmRange.selectNodeContents(alarmText);
      const alarmTextRects = Array.from(alarmRange.getClientRects());
      if (alarmTextRects.length === 0) throw new Error("720px / 250% Today alarm text was empty");
      const hourNineRect = hourNine.getBoundingClientRect();
      const hourNineRange = document.createRange();
      hourNineRange.selectNodeContents(hourNine);
      const hourNineTextRects = Array.from(hourNineRange.getClientRects());
      if (hourNineTextRects.length === 0) throw new Error("720px / 250% hour label was empty");
      const timelineCanvasRect = timelineCanvas.getBoundingClientRect();
      const readableButtons = Array.from(
        readableList.querySelectorAll<HTMLButtonElement>("button"),
      );
      const timelineTitles = Array.from(
        document.querySelectorAll<HTMLElement>(
          '.timeline-event[data-text-mode="summary"] > .timeline-event-title',
        ),
      );
      return {
        alarmContentInsideElement: alarmTextRects.every(
          (rect) =>
            rect.left >= alarmRect.left - 1 &&
            rect.right <= alarmRect.right + 1 &&
            rect.top >= alarmRect.top - 1 &&
            rect.bottom <= alarmRect.bottom + 1,
        ),
        alarmContentInsideDock: alarmTextRects.every(
          (rect) =>
            rect.left >= dockRect.left - 1 &&
            rect.right <= dockRect.right + 1 &&
            rect.top >= dockRect.top - 1 &&
            rect.bottom <= dockRect.bottom + 1,
        ),
        alarmHorizontalOverflow: alarmText.scrollWidth - alarmText.clientWidth,
        alarmVerticalOverflow: alarmText.scrollHeight - alarmText.clientHeight,
        hourLabelContentInsideElement: hourNineTextRects.every(
          (rect) =>
            rect.left >= hourNineRect.left - 1 &&
            rect.right <= hourNineRect.right + 1 &&
            rect.top >= hourNineRect.top - 1 &&
            rect.bottom <= hourNineRect.bottom + 1,
        ),
        hourLabelSeparatedFromTimeline: hourNineTextRects.every(
          (rect) => rect.right <= timelineCanvasRect.left - 1,
        ),
        hourLabelHorizontalOverflow: hourNine.scrollWidth - hourNine.clientWidth,
        dockAtBottom: Math.abs(dock.scrollTop - dockMaxScroll) <= 1,
        dockInsideViewport: isInsideViewport(dock),
        historyButtonsInsideViewport: Array.from(
          history.querySelectorAll<HTMLElement>("button"),
        ).every(isInsideViewport),
        shellOverflow: shell.scrollWidth - shell.clientWidth,
        readableItemCount: readableButtons.length,
        readableItemsOverflow: readableButtons.some(
          (button) => button.scrollWidth > button.clientWidth + 1,
        ),
        summaryTitlesVisible: timelineTitles.some(
          (title) => getComputedStyle(title).display !== "none",
        ),
        workspaceAtBottom: Math.abs(workspace.scrollTop - workspaceMaxScroll) <= 1,
        workspaceHeight: workspace.clientHeight,
      };
    });
    expect(narrowTextGeometry.shellOverflow).toBeLessThanOrEqual(1);
    expect(narrowTextGeometry.alarmContentInsideElement).toBe(true);
    expect(narrowTextGeometry.alarmContentInsideDock).toBe(true);
    expect(narrowTextGeometry.alarmHorizontalOverflow).toBeLessThanOrEqual(1);
    expect(narrowTextGeometry.alarmVerticalOverflow).toBeLessThanOrEqual(1);
    expect(narrowTextGeometry.hourLabelContentInsideElement).toBe(true);
    expect(narrowTextGeometry.hourLabelSeparatedFromTimeline).toBe(true);
    expect(narrowTextGeometry.hourLabelHorizontalOverflow).toBeLessThanOrEqual(1);
    expect(narrowTextGeometry.workspaceHeight).toBeGreaterThan(0);
    expect(narrowTextGeometry.workspaceAtBottom).toBe(true);
    expect(narrowTextGeometry.dockAtBottom).toBe(true);
    expect(narrowTextGeometry.historyButtonsInsideViewport).toBe(true);
    expect(narrowTextGeometry.dockInsideViewport).toBe(true);
    expect(narrowTextGeometry.readableItemCount).toBeGreaterThan(0);
    expect(narrowTextGeometry.readableItemsOverflow).toBe(false);
    expect(narrowTextGeometry.summaryTitlesVisible).toBe(false);
    await browser.saveScreenshot("./test-results/native-today-text-250-narrow.png");
    await $(".timeline-readable-list").saveScreenshot(
      "./test-results/native-today-readable-list-text-250.png",
    );
    await setLogicalWindowSize(1180, 820);

    const destinations = await browser.execute(() =>
      Array.from(document.querySelectorAll<HTMLButtonElement>("aside nav button"), (button) =>
        button.getAttribute("aria-label"),
      ).filter((label): label is string => Boolean(label)),
    );
    const overflowedDestinations: string[] = [];
    for (const destination of destinations) {
      await browser.execute((label) => {
        const button = Array.from(
          document.querySelectorAll<HTMLButtonElement>("aside nav button"),
        ).find((candidate) => candidate.getAttribute("aria-label") === label);
        if (!button) throw new Error(`navigation destination was not found: ${label}`);
        button.click();
      }, destination);
      await browser.waitUntil(
        () =>
          browser.execute(
            (label) =>
              document
                .querySelector(`aside nav button[aria-current="page"]`)
                ?.getAttribute("aria-label") === label,
            destination,
          ),
        { timeoutMsg: `250% navigation did not reach ${destination}` },
      );
      const geometry = await browser.execute(() => {
        const view = document.querySelector<HTMLElement>(".app-content > main");
        if (!view) throw new Error("active 250% view was not rendered");
        return {
          height: view.getBoundingClientRect().height,
          horizontalOverflow: view.scrollWidth - view.clientWidth,
        };
      });
      if (geometry.height <= 0 || geometry.horizontalOverflow > 1) {
        overflowedDestinations.push(destination);
      }
    }
    expect(overflowedDestinations).toEqual([]);

    await persistTextScale(100);
    await browser.refresh();
    await $(".app-shell").waitForDisplayed();
  });

  it("persists settings and exercises the native pointer-drag schedule path", async () => {
    await setLogicalWindowSize(1180, 820);
    await $('//aside[@aria-label="主要画面"]//button[contains(., "設定")]').click();
    const snap = $('//label[contains(., "タイムラインのスナップ幅")]/select');
    await browser.execute(() => {
      const label = Array.from(document.querySelectorAll("label")).find((candidate) =>
        candidate.textContent?.includes("タイムラインのスナップ幅"),
      );
      const select = label?.querySelector("select");
      if (!select) throw new Error("snap select was not found");
      select.value = "15";
      select.dispatchEvent(new Event("change", { bubbles: true }));
    });
    await expect(snap).toHaveValue("15");
    await $('//button[normalize-space(.)="設定を保存"]').click();
    await $(
      '//*[self::div or self::section][contains(., "設定をこの端末に保存しました")]',
    ).waitForDisplayed();
    await browser.waitUntil(
      async () => {
        const savedSettings = (await browser.tauri.execute(({ core }) =>
          core.invoke("bootstrap_get"),
        )) as { settings: { snapMinutes: number } };
        return savedSettings.settings.snapMinutes === 15;
      },
      { timeoutMsg: "snap setting was not persisted as 15 minutes" },
    );
    await browser.refresh();
    await $(".app-shell").waitForDisplayed();
    const persistedSettings = (await browser.tauri.execute(({ core }) =>
      core.invoke("bootstrap_get"),
    )) as { settings: { snapMinutes: number } };
    expect(persistedSettings.settings.snapMinutes).toBe(15);

    await $('//aside[@aria-label="主要画面"]//button[contains(., "今日")]').click();
    const canvas = $(".timeline-canvas");
    await canvas.waitForDisplayed();
    const dragPoint = await browser.execute(() => {
      const timelineViewport = document.querySelector(".timeline-viewport");
      const timelineCanvas = document.querySelector(".timeline-canvas");
      if (!(timelineViewport instanceof HTMLElement) || !(timelineCanvas instanceof HTMLElement)) {
        throw new Error("timeline surface was not found");
      }
      timelineViewport.scrollTop = timelineCanvas.clientHeight * (15 / 24);
      const viewportBounds = timelineViewport.getBoundingClientRect();
      return {
        x: Math.round(viewportBounds.left + Math.min(300, viewportBounds.width - 48)),
        y: Math.round(viewportBounds.top + 96),
      };
    });
    await browser.execute(({ x, y }) => {
      const timelineCanvas = document.querySelector(".timeline-canvas");
      if (!(timelineCanvas instanceof HTMLElement))
        throw new Error("timeline canvas was not found");
      // WebKit WebDriver does not associate script-created pointer events with an
      // active hardware pointer, so pointer capture is neutralized for this test.
      timelineCanvas.setPointerCapture = () => undefined;
      timelineCanvas.dispatchEvent(
        new PointerEvent("pointerdown", {
          bubbles: true,
          button: 0,
          buttons: 1,
          clientX: x,
          clientY: y,
          pointerId: 7,
          pointerType: "mouse",
        }),
      );
    }, dragPoint);
    await browser.pause(50);
    await browser.execute(({ x, y }) => {
      const timelineCanvas = document.querySelector(".timeline-canvas");
      if (!(timelineCanvas instanceof HTMLElement))
        throw new Error("timeline canvas was not found");
      timelineCanvas.dispatchEvent(
        new PointerEvent("pointermove", {
          bubbles: true,
          button: 0,
          buttons: 1,
          clientX: x,
          clientY: y + 72,
          pointerId: 7,
          pointerType: "mouse",
        }),
      );
    }, dragPoint);
    await browser.pause(50);
    await browser.execute(({ x, y }) => {
      const timelineCanvas = document.querySelector(".timeline-canvas");
      if (!(timelineCanvas instanceof HTMLElement))
        throw new Error("timeline canvas was not found");
      timelineCanvas.dispatchEvent(
        new PointerEvent("pointerup", {
          bubbles: true,
          button: 0,
          buttons: 0,
          clientX: x,
          clientY: y + 72,
          pointerId: 7,
          pointerType: "mouse",
        }),
      );
    }, dragPoint);
    await $('//aside//h2[normalize-space(.)="予定を作成"]').waitForDisplayed();
    const draggedTitle = `E2Eドラッグ-${Date.now()}`;
    await $('//aside//label[contains(., "タイトル")]/input').setValue(draggedTitle);
    await $('//aside//button[normalize-space(.)="予定を作成"]').click();
    await $(`//*[normalize-space(.)="${draggedTitle}"]`).waitForDisplayed();
    const moved = await browser.tauri.execute(async ({ core }, search) => {
      const page = (await core.invoke("schedule_list", {
        query: {
          startUtc: "2020-01-01T00:00:00.000Z",
          endUtc: "2035-01-01T00:00:00.000Z",
          search,
          limit: 10,
        },
      })) as { items: Array<{ title: string }> };
      return page.items[0];
    }, draggedTitle);
    expect(moved.title).toBe(draggedTitle);

    await $('//aside[@aria-label="主要画面"]//button[contains(., "一覧")]').click();
    const search = $('input[placeholder="タイトル、タグ、プロジェクト…"]');
    await search.setValue(draggedTitle);
    await $(`//input[@aria-label="${draggedTitle}を一括変更の対象にする"]`).click();
    await $('//label[contains(., "プロジェクトを変更")]/input[@type="checkbox"]').click();
    await $(
      '//div[contains(@class,"bulk-classification__field")][.//label[contains(., "プロジェクト")]]/input[not(@type)]',
    ).setValue("E2E一括分類");
    await $('//button[normalize-space(.)="1件へ一括適用"]').click();
    await $('//*[contains(., "1件の分類を一括変更しました")]').waitForDisplayed();
    const classified = await browser.tauri.execute(async ({ core }, search) => {
      const page = (await core.invoke("schedule_list", {
        query: {
          startUtc: "2020-01-01T00:00:00.000Z",
          endUtc: "2035-01-01T00:00:00.000Z",
          search,
          limit: 10,
        },
      })) as { items: Array<{ project: string }> };
      return page.items[0];
    }, draggedTitle);
    expect(classified.project).toBe("E2E一括分類");
  });

  it("captures the remaining main-window visual-regression surfaces", async () => {
    await setLogicalWindowSize(1180, 820);
    await $('//aside[@aria-label="主要画面"]//button[contains(., "週")]').click();
    await $("main h1").waitForDisplayed();
    await browser.saveScreenshot("./test-results/native-week.png");

    await $('//aside[@aria-label="主要画面"]//button[contains(., "データと診断")]').click();
    await $(".diagnostics-grid").waitForDisplayed();
    await browser.saveScreenshot("./test-results/native-conflict.png");
  });

  it("keeps 500-item scroll and drag work within the 60fps main-thread budget", async () => {
    await browser.setTimeout({ script: 120_000 });
    await setLogicalWindowSize(1180, 820);
    const bootstrap = (await browser.tauri.execute(({ core }) => core.invoke("bootstrap_get"))) as {
      today: string;
      timezoneId: string;
    };
    const performanceFixtures = (await browser.tauri.execute(async ({ core }, input) => {
      const dayStart = new Date(`${input.today}T00:00:00`);
      const created: Array<{ id: string; version: number }> = [];
      for (let index = 0; index < 500; index += 1) {
        const start = new Date(dayStart);
        start.setMinutes(Math.floor((index * 1440) / 500));
        const end = new Date(start.getTime() + 2 * 60_000);
        created.push(
          (await core.invoke("schedule_create", {
            draft: {
              title: `E2E性能予定-${String(index).padStart(3, "0")}`,
              description: "",
              location: "",
              startUtc: start.toISOString(),
              endUtc: end.toISOString(),
              timezoneId: input.timezoneId,
              allDay: false,
              allDayStartDate: null,
              allDayEndDateExclusive: null,
              status: "scheduled",
              project: "E2E性能",
              category: "synthetic",
              tags: [],
              color: "#6F96F4",
              priority: "normal",
              recurrenceRule: null,
              recurrenceSupplementalLines: [],
              recurrenceExdates: [],
              startNotificationMinutes: null,
              endNotificationMinutes: null,
            },
          })) as { id: string; version: number },
        );
      }
      return created;
    }, bootstrap)) as Array<{ id: string; version: number }>;
    await browser.refresh();
    await $(".app-shell").waitForDisplayed();
    await browser.tauri.execute(({ core }) => core.invoke("main_window_show"));
    await browser.pause(500);
    await $('//aside[@aria-label="主要画面"]//button[contains(., "今日")]').click();
    await $(".timeline-viewport").waitForDisplayed();

    const profile = (await browser.execute(() => {
      const viewport = document.querySelector(".timeline-viewport");
      const canvas = document.querySelector(".timeline-canvas");
      if (!(viewport instanceof HTMLElement) || !(canvas instanceof HTMLElement)) {
        return { error: "timeline_not_found" };
      }
      canvas.setPointerCapture = () => undefined;
      const percentile95 = (values: number[]) => {
        const ordered = [...values].sort((left, right) => left - right);
        return ordered[Math.ceil(ordered.length * 0.95) - 1] ?? 0;
      };
      const sample = (step: (run: number) => void) => {
        const warmupMs: number[] = [];
        for (let run = 0; run < 5; run += 1) {
          const started = performance.now();
          step(run);
          canvas.getBoundingClientRect();
          warmupMs.push(performance.now() - started);
        }
        const samples: number[] = [];
        for (let run = 0; run < 30; run += 1) {
          const started = performance.now();
          step(run + 5);
          canvas.getBoundingClientRect();
          samples.push(performance.now() - started);
        }
        return { p95Ms: percentile95(samples), samplesMs: samples, warmupMs };
      };
      const maxScroll = Math.max(1, viewport.scrollHeight - viewport.clientHeight);
      const scroll = sample((run) => {
        viewport.scrollTop = maxScroll * (((run * 7) % 30) / 29);
        viewport.dispatchEvent(new Event("scroll"));
      });
      const bounds = viewport.getBoundingClientRect();
      const origin = {
        x: Math.round(bounds.left + Math.min(300, bounds.width - 48)),
        y: Math.round(bounds.top + 100),
      };
      const drag = sample((run) => {
        canvas.dispatchEvent(
          new PointerEvent("pointerdown", {
            bubbles: true,
            button: 0,
            buttons: 1,
            clientX: origin.x,
            clientY: origin.y,
            pointerId: 100 + run,
            pointerType: "mouse",
          }),
        );
        canvas.dispatchEvent(
          new PointerEvent("pointermove", {
            bubbles: true,
            button: 0,
            buttons: 1,
            clientX: origin.x,
            clientY: origin.y + 52,
            pointerId: 100 + run,
            pointerType: "mouse",
          }),
        );
        canvas.dispatchEvent(
          new PointerEvent("pointercancel", {
            bubbles: true,
            pointerId: 100 + run,
            pointerType: "mouse",
          }),
        );
      });
      return {
        sampleRuns: 30,
        warmupRuns: 5,
        measurement: "synchronous event dispatch and forced current layout",
        scroll,
        drag,
        renderedScheduleNodes: document.querySelectorAll(".timeline-event").length,
      };
    })) as {
      error?: string;
      sampleRuns?: number;
      warmupRuns?: number;
      measurement?: string;
      scroll?: { p95Ms: number; samplesMs: number[]; warmupMs: number[] };
      drag?: { p95Ms: number; samplesMs: number[]; warmupMs: number[] };
      renderedScheduleNodes?: number;
    };
    await writeFile(
      "./test-results/native-performance.json",
      `${JSON.stringify(
        {
          schemaVersion: 2,
          measuredAtUtc: new Date().toISOString(),
          platform: process.platform,
          architecture: process.arch,
          itemCount: 500,
          thresholdColdInteractionMs: 100,
          thresholdMainThreadBudgetP95Ms: 16.7,
          ...profile,
        },
        null,
        2,
      )}\n`,
    );
    expect(profile.error).toBeUndefined();
    expect(profile.sampleRuns).toBe(30);
    expect(profile.warmupRuns).toBe(5);
    expect(profile.renderedScheduleNodes).toBeLessThan(180);
    expect(
      Math.max(...(profile.scroll?.warmupMs ?? [Number.POSITIVE_INFINITY])),
    ).toBeLessThanOrEqual(100);
    expect(Math.max(...(profile.drag?.warmupMs ?? [Number.POSITIVE_INFINITY]))).toBeLessThanOrEqual(
      100,
    );
    expect(profile.scroll?.p95Ms).toBeLessThanOrEqual(16.7);
    expect(profile.drag?.p95Ms).toBeLessThanOrEqual(16.7);
    const deletedFixtureCount = await browser.tauri.execute(
      ({ core }, fixtureIds) => core.invoke("e2e_schedule_fixtures_delete", { ids: fixtureIds }),
      performanceFixtures.map((fixture) => fixture.id),
    );
    expect(deletedFixtureCount).toBe(500);
  });

  it("shows a protected Google recurrence without implying that sync stopped", async () => {
    if (process.platform !== "darwin") return;
    const bootstrap = (await browser.tauri.execute(({ core }) => core.invoke("bootstrap_get"))) as {
      today: string;
      timezoneId: string;
    };
    const startUtc = new Date(`${bootstrap.today}T09:00:00`).toISOString();
    const endUtc = new Date(`${bootstrap.today}T10:00:00`).toISOString();
    const compactDate = bootstrap.today.replace(/-/g, "");
    await browser.tauri.execute(
      ({ core }, draft) => core.invoke("e2e_schedule_read_only_create", { draft }),
      {
        title: "複雑なGoogle繰り返し",
        description: "synthetic fixture",
        location: "",
        startUtc,
        endUtc,
        timezoneId: bootstrap.timezoneId,
        allDay: false,
        allDayStartDate: null,
        allDayEndDateExclusive: null,
        status: "scheduled",
        project: "",
        category: "synthetic",
        tags: [],
        color: "#6F96F4",
        priority: "normal",
        recurrenceRule: "FREQ=DAILY;COUNT=3",
        recurrenceExdates: [],
        recurrenceSupplementalLines: [`RDATE;TZID=${bootstrap.timezoneId}:${compactDate}T090000`],
        startNotificationMinutes: null,
        endNotificationMinutes: null,
      },
    );

    await browser.refresh();
    await $(".app-shell").waitForDisplayed();
    await setLogicalWindowSize(1180, 820);
    await $('//aside[@aria-label="主要画面"]//button[contains(., "今日")]').click();
    const schedule = $('//button[contains(@aria-label, "複雑なGoogle繰り返し")]');
    await schedule.waitForDisplayed();
    await schedule.click();
    const protectedTitle = $(
      '//*[normalize-space(.)="複雑な繰り返し予定はGoogle側で編集してください"]',
    );
    await protectedTitle.waitForDisplayed();
    await expect(
      $('//*[contains(normalize-space(.), "予定の表示と同期は継続します")]'),
    ).toBeDisplayed();
    await expect($('//aside//button[normalize-space(.)="変更を保存"]')).toBeDisabled();
    await browser.saveScreenshot("./test-results/native-google-complex-recurrence.png");

    await browser.execute(() => {
      const inspector = document.querySelector("aside.inspector");
      if (!(inspector instanceof HTMLElement)) throw new Error("Schedule inspector was not found");
      const descendants: HTMLElement[] = Array.from(inspector.querySelectorAll("*")).filter(
        (element): element is HTMLElement => element instanceof HTMLElement,
      );
      [inspector, ...descendants].forEach((element) => {
        const fontSize = Number.parseFloat(window.getComputedStyle(element).fontSize);
        element.dataset.e2eOriginalFontSize = element.style.fontSize;
        if (Number.isFinite(fontSize)) {
          element.style.setProperty("font-size", `${fontSize * 2}px`, "important");
        }
      });
      inspector.scrollTop = 0;
    });
    await expect(protectedTitle).toBeDisplayed();
    await browser.saveScreenshot("./test-results/native-google-complex-recurrence-text-200.png");
    await browser.execute(() => {
      const inspector = document.querySelector("aside.inspector");
      if (!(inspector instanceof HTMLElement)) return;
      const descendants: HTMLElement[] = Array.from(inspector.querySelectorAll("*")).filter(
        (element): element is HTMLElement => element instanceof HTMLElement,
      );
      [inspector, ...descendants].forEach((element) => {
        const original = element.dataset.e2eOriginalFontSize ?? "";
        if (original) element.style.fontSize = original;
        else element.style.removeProperty("font-size");
        delete element.dataset.e2eOriginalFontSize;
      });
    });
  });

  it("shows per-calendar recovery states with synthetic native data", async () => {
    if (process.platform !== "darwin") return;
    await browser.tauri.execute(({ core }) => core.invoke("e2e_google_calendar_recovery_seed"));
    await browser.refresh();
    await $(".app-shell").waitForDisplayed();
    await setLogicalWindowSize(1180, 820);
    await $('//aside[@aria-label="主要画面"]//button[contains(., "設定")]').click();
    await $('//*[normalize-space(.)="同期確認用カレンダー"]').waitForDisplayed();
    await expect(
      $('//*[normalize-space(.)="同期を停止しました。Google側の共有権限を確認してください。"]'),
    ).toBeDisplayed();
    const freeBusyCheckbox = $(
      '//article[.//*[normalize-space(.)="空き時間のみ"]]//input[@type="checkbox"]',
    );
    await expect(freeBusyCheckbox).toBeDisabled();
    await browser.execute(() => {
      document
        .querySelector('section[aria-labelledby="google-panel-title"]')
        ?.scrollIntoView({ block: "start" });
    });
    await browser.saveScreenshot("./test-results/native-google-calendar-recovery.png");

    const scaledHeading = await browser.execute(() => {
      const panel = document.querySelector('section[aria-labelledby="google-panel-title"]');
      if (!(panel instanceof HTMLElement)) throw new Error("Google panel was not found");
      const descendants = Array.from(panel.querySelectorAll<HTMLElement>("*"));
      const heading = panel.querySelector("h2");
      if (!(heading instanceof HTMLElement)) throw new Error("Google panel heading was not found");
      const baseline = Number.parseFloat(window.getComputedStyle(heading).fontSize);
      [panel, ...descendants].forEach((element) => {
        const fontSize = Number.parseFloat(window.getComputedStyle(element).fontSize);
        element.dataset.e2eOriginalFontSize = element.style.fontSize;
        element.style.setProperty("transition", "none", "important");
        if (Number.isFinite(fontSize)) {
          element.style.setProperty("font-size", `${fontSize * 2}px`, "important");
        }
      });
      panel.scrollIntoView({ block: "start" });
      return {
        baseline,
        inlineSize: Number.parseFloat(heading.style.fontSize),
        priority: heading.style.getPropertyPriority("font-size"),
      };
    });
    expect(scaledHeading.priority).toBe("important");
    expect(scaledHeading.inlineSize).toBeGreaterThanOrEqual(scaledHeading.baseline * 1.9);
    await browser.saveScreenshot("./test-results/native-google-calendar-recovery-text-200.png");
    await browser.execute(() => {
      const panel = document.querySelector('section[aria-labelledby="google-panel-title"]');
      if (!(panel instanceof HTMLElement)) return;
      const descendants = Array.from(panel.querySelectorAll<HTMLElement>("*"));
      [panel, ...descendants].forEach((element) => {
        const original = element.dataset.e2eOriginalFontSize ?? "";
        if (original) element.style.fontSize = original;
        else element.style.removeProperty("font-size");
        element.style.removeProperty("transition");
        delete element.dataset.e2eOriginalFontSize;
      });
    });
  });

  it("shows Google Tasks list, conflict, diagnostics, and Ticket sync boundary with synthetic native data", async () => {
    if (process.platform !== "darwin") return;
    await browser.tauri.execute(({ core }) => core.invoke("e2e_google_tasks_seed"));
    await browser.refresh();
    await $(".app-shell").waitForDisplayed();
    await setLogicalWindowSize(1280, 900);
    await $('//aside[@aria-label="主要画面"]//button[contains(., "設定")]').click();
    await $('//*[normalize-space(.)="同期確認用Task List"]').waitForDisplayed();
    await $('//button[normalize-space(.)="完全照合"]').waitForExist();
    await $(
      '//*[contains(., "priority・見積・tags・Schedule・Focus実績はLocal専用")]',
    ).waitForExist();
    const tasksConflictHeading = $('//h4[normalize-space(.)="Google Tasks競合"]');
    await tasksConflictHeading.waitForExist();
    await tasksConflictHeading.scrollIntoView({ block: "center" });
    await tasksConflictHeading.waitForDisplayed();
    await browser.execute(() => {
      const button = Array.from(document.querySelectorAll("button")).find(
        (element) => element.textContent?.trim() === "完全照合",
      );
      if (!(button instanceof HTMLButtonElement))
        throw new Error("full reconcile button not found");
      button.focus();
    });
    expect(await browser.execute(() => document.activeElement?.textContent?.trim())).toBe(
      "完全照合",
    );
    await browser.execute(() => {
      document.querySelector(".google-task-conflicts")?.scrollIntoView({ block: "start" });
    });
    await browser.saveScreenshot("./test-results/native-google-tasks-settings-conflict.png");

    const tasksTextScale = await browser.execute(() => {
      const panel = document.querySelector('section[aria-labelledby="google-tasks-title"]');
      if (!(panel instanceof HTMLElement)) throw new Error("Google Tasks panel was not found");
      const elements = [panel, ...Array.from(panel.querySelectorAll<HTMLElement>("*"))];
      const heading = panel.querySelector("h3");
      if (!(heading instanceof HTMLElement)) throw new Error("Google Tasks heading was not found");
      const baseline = Number.parseFloat(window.getComputedStyle(heading).fontSize);
      elements.forEach((element) => {
        const fontSize = Number.parseFloat(window.getComputedStyle(element).fontSize);
        element.dataset.e2eOriginalFontSize = element.style.fontSize;
        element.style.setProperty("transition", "none", "important");
        if (Number.isFinite(fontSize)) {
          element.style.setProperty("font-size", `${fontSize * 2}px`, "important");
        }
      });
      panel.scrollIntoView({ block: "start" });
      return {
        baseline,
        scaled: Number.parseFloat(window.getComputedStyle(heading).fontSize),
      };
    });
    expect(tasksTextScale.scaled).toBeGreaterThanOrEqual(tasksTextScale.baseline * 1.9);
    await browser.saveScreenshot("./test-results/native-google-tasks-settings-text-200.png");
    await browser.execute(() => {
      const panel = document.querySelector('section[aria-labelledby="google-tasks-title"]');
      if (!(panel instanceof HTMLElement)) return;
      const elements = [panel, ...Array.from(panel.querySelectorAll<HTMLElement>("*"))];
      elements.forEach((element) => {
        const original = element.dataset.e2eOriginalFontSize ?? "";
        if (original) element.style.fontSize = original;
        else element.style.removeProperty("font-size");
        element.style.removeProperty("transition");
        delete element.dataset.e2eOriginalFontSize;
      });
    });

    await openTicketView();
    await $('//button[@aria-label="Google Tasks同期確認の詳細を開く"]').click();
    await $('//h4[normalize-space(.)="Google Tasks"]').waitForDisplayed();
    await expect($('//*[contains(., "Google notesへ埋め込みません")]')).toBeDisplayed();
    await browser.execute(() => {
      document
        .querySelector('section[class~="ticket-google-task"]')
        ?.scrollIntoView({ block: "center" });
    });
    await browser.saveScreenshot("./test-results/native-google-tasks-ticket-detail.png");
  });

  it("shows a priority ticket in Today, then schedules, edits, unlinks, and relinks it", async () => {
    await persistFixtureTheme("light");
    await setLogicalWindowSize(1280, 820);
    const ticketTitle = `E2E優先-${"LongToken".repeat(8)}-${Date.now()}`;
    await openTicketView();
    await $(
      '//section[.//h2[normalize-space(.)="Next"]]//input[@placeholder="タイトルだけで追加"]',
    ).setValue(ticketTitle);
    await $(
      '//section[.//h2[normalize-space(.)="Next"]]//button[normalize-space(.)="追加"]',
    ).click();
    await $(`//button[@aria-label="${ticketTitle}の詳細を開く"]`).click();
    const prioritySelect = $('//div[@role="dialog"]//label[contains(., "優先度")]/select');
    await browser.execute(() => {
      const select = Array.from(
        document.querySelectorAll<HTMLLabelElement>('div[role="dialog"] label'),
      )
        .find((label) => label.textContent?.includes("優先度"))
        ?.querySelector<HTMLSelectElement>("select");
      if (!select) throw new Error("ticket priority select was not found");
      select.value = "high";
      select.dispatchEvent(new Event("change", { bubbles: true }));
    });
    await expect(prioritySelect).toHaveValue("high");
    await $('//div[@role="dialog"]//label[contains(., "見積時間")]/input').setValue("30");
    await $('//div[@role="dialog"]//button[normalize-space(.)="保存"]').click();
    await $(
      '//div[@role="dialog"]//*[@role="status" and contains(., "保存しました")]',
    ).waitForDisplayed();
    await $('//div[@role="dialog"]//button[@aria-label="詳細を閉じる"]').click();
    const savedPriorityTicket = (await browser.tauri.execute(
      ({ core }, expectedTitle) =>
        core.invoke("ticket_list", {
          query: { search: expectedTitle, limit: 10 },
        }),
      ticketTitle,
    )) as { items: Array<{ columnId: string; priority: string; title: string }> };
    expect(savedPriorityTicket.items).toHaveLength(1);
    expect(savedPriorityTicket.items[0]).toEqual(
      expect.objectContaining({ priority: "high", title: ticketTitle }),
    );

    await $('//aside[@aria-label="主要画面"]//button[contains(., "今日")]').click();
    await $(".today-heading h1").waitForDisplayed();
    const drawerToggle = $('//button[contains(., "優先チケット")]');
    await browser.waitUntil(
      async () => (await drawerToggle.getAttribute("aria-expanded")) === "true",
      {
        timeoutMsg: "priority ticket drawer was not open by default",
      },
    );
    await browser.waitUntil(
      async () =>
        !(await $(".priority-ticket-drawer__content").getText()).includes("読み込んでいます"),
      { timeoutMsg: "priority ticket drawer did not finish loading" },
    );
    expect(await $(".priority-ticket-drawer__content").getText()).not.toContain(
      "読み込めませんでした",
    );
    const drawerTicketSelector = `//section[contains(@class, "priority-ticket-drawer")]//article[.//strong[normalize-space(.)="${ticketTitle}"]]`;
    const drawerTicket = $(drawerTicketSelector);
    await drawerTicket.waitForDisplayed();
    await expect(drawerTicket).toHaveText(expect.stringContaining("優先度: 高"));
    const drawerControls = await browser.execute(() => {
      const drawer = document.querySelector<HTMLElement>(".priority-ticket-drawer");
      if (!drawer) throw new Error("priority ticket drawer was not found");
      return {
        selectCount: drawer.querySelectorAll("select").length,
        buttonLabels: Array.from(drawer.querySelectorAll("button")).map((button) =>
          button.textContent?.trim(),
        ),
        text: drawer.textContent ?? "",
      };
    });
    expect(drawerControls.selectCount).toBe(0);
    expect(drawerControls.buttonLabels).toHaveLength(1);
    expect(drawerControls.text).not.toContain("タイムラインへドラッグ");
    await browser.saveScreenshot("./test-results/native-priority-tickets-open.png");

    await drawerToggle.click();
    await browser.waitUntil(
      async () => (await drawerToggle.getAttribute("aria-expanded")) === "false",
      { timeoutMsg: "priority ticket drawer did not collapse" },
    );
    await drawerTicket.waitForDisplayed({ reverse: true });
    await drawerToggle.click();
    await $(drawerTicketSelector).waitForDisplayed();
    await browser.execute(() => {
      const workspace = document.querySelector<HTMLElement>(".workspace-main");
      if (!workspace) throw new Error("Today workspace was not found");
      workspace.scrollTop = 0;
    });
    await setLogicalWindowSize(720, 820);
    await browser.execute(() => {
      const workspace = document.querySelector<HTMLElement>(".workspace-main");
      const drawer = document.querySelector<HTMLElement>(".priority-ticket-drawer");
      if (!workspace || !drawer) throw new Error("priority ticket drawer was not found");
      workspace.scrollTop = drawer.offsetTop;
    });
    const narrowGeometry = await browser.execute(() => {
      const drawer = document.querySelector<HTMLElement>(".priority-ticket-drawer");
      const card = drawer?.querySelector<HTMLElement>(".priority-ticket-card");
      if (!drawer || !card) throw new Error("priority ticket card was not found");
      return {
        drawerClientWidth: drawer.clientWidth,
        drawerScrollWidth: drawer.scrollWidth,
        cardClientWidth: card.clientWidth,
        cardScrollWidth: card.scrollWidth,
      };
    });
    expect(narrowGeometry.drawerScrollWidth).toBeLessThanOrEqual(
      narrowGeometry.drawerClientWidth + 1,
    );
    expect(narrowGeometry.cardScrollWidth).toBeLessThanOrEqual(narrowGeometry.cardClientWidth + 1);
    await browser.saveScreenshot("./test-results/native-priority-tickets-narrow.png");
    await setLogicalWindowSize(1280, 820);
    await browser.execute(() => {
      const panel = document.querySelector<HTMLElement>(".priority-ticket-drawer");
      if (!panel) throw new Error("priority ticket drawer was not found for text scaling");
      panel.querySelectorAll<HTMLElement>("*").forEach((element) => {
        element.dataset.e2eOriginalFontSize = element.style.fontSize;
        const size = Number.parseFloat(window.getComputedStyle(element).fontSize);
        if (Number.isFinite(size)) element.style.fontSize = `${size * 2}px`;
      });
    });
    await browser.execute(() => {
      const workspace = document.querySelector<HTMLElement>(".workspace-main");
      const drawer = document.querySelector<HTMLElement>(".priority-ticket-drawer");
      if (!workspace || !drawer) throw new Error("priority ticket drawer was not found");
      workspace.scrollTop = drawer.offsetTop;
    });
    const scaledGeometry = await browser.execute(() => {
      const drawer = document.querySelector<HTMLElement>(".priority-ticket-drawer");
      const card = drawer?.querySelector<HTMLElement>(".priority-ticket-card");
      if (!drawer || !card) throw new Error("scaled priority ticket card was not found");
      return {
        drawerClientWidth: drawer.clientWidth,
        drawerScrollWidth: drawer.scrollWidth,
        cardClientWidth: card.clientWidth,
        cardScrollWidth: card.scrollWidth,
      };
    });
    expect(scaledGeometry.drawerScrollWidth).toBeLessThanOrEqual(
      scaledGeometry.drawerClientWidth + 1,
    );
    expect(scaledGeometry.cardScrollWidth).toBeLessThanOrEqual(scaledGeometry.cardClientWidth + 1);
    await browser.saveScreenshot("./test-results/native-priority-tickets-text-200.png");
    await browser.execute(() => {
      document
        .querySelectorAll<HTMLElement>(".priority-ticket-drawer [data-e2e-original-font-size]")
        .forEach((element) => {
          element.style.fontSize = element.dataset.e2eOriginalFontSize ?? "";
          delete element.dataset.e2eOriginalFontSize;
        });
    });

    await openTicketView();
    await $(`//button[@aria-label="${ticketTitle}の詳細を開く"]`).click();
    await $('//div[@role="dialog"]//button[normalize-space(.)="新しい予定を作成"]').click();
    await $(
      '//div[@role="dialog"]//*[@role="status" and contains(., "予定を作成")]',
    ).waitForDisplayed();
    await $('//div[@role="dialog"]//button[@aria-label="詳細を閉じる"]').click();
    await $('//aside[@aria-label="主要画面"]//button[contains(., "今日")]').click();
    await $(".today-heading h1").waitForDisplayed();
    await $(drawerTicketSelector).waitForDisplayed();
    await $(
      `//*[contains(@class, "timeline-event") and contains(., "${ticketTitle}")]`,
    ).waitForDisplayed();
    await browser.saveScreenshot("./test-results/native-ticket-scheduled-today.png");

    await $(`//*[contains(@class, "timeline-event") and contains(., "${ticketTitle}")]`).click();
    const titleInput = $('//aside//label[contains(., "タイトル")]/input');
    await titleInput.waitForDisplayed();
    await titleInput.setValue(`${ticketTitle}-編集済み`);
    await $('//aside//button[normalize-space(.)="変更を保存"]').click();
    const editedEvent = $(
      `//*[contains(@class, "timeline-event") and contains(., "${ticketTitle}-編集済み")]`,
    );
    await editedEvent.waitForDisplayed();
    await editedEvent.click();
    const linkSection = $('//section[@aria-labelledby="schedule-ticket-link-title"]');
    await linkSection.waitForDisplayed();
    await browser.saveScreenshot("./test-results/native-schedule-ticket-link.png");
    await linkSection.$('.//button[normalize-space(.)="関連を解除"]').click();
    await linkSection
      .$('.//p[normalize-space(.)="この予定に関連するチケットはありません。"]')
      .waitForDisplayed();
    await browser.execute((expectedTitle) => {
      const section = document.querySelector<HTMLElement>(
        'section[aria-labelledby="schedule-ticket-link-title"]',
      );
      const select = section?.querySelector<HTMLSelectElement>("select");
      const option = Array.from(select?.options ?? []).find(
        (candidate) => candidate.textContent?.trim() === expectedTitle,
      );
      if (!select || !option) throw new Error("ticket link option was not found");
      select.value = option.value;
      select.dispatchEvent(new Event("change", { bubbles: true }));
    }, ticketTitle);
    const relinkButton = linkSection.$('.//button[normalize-space(.)="関連付ける"]');
    await relinkButton.waitForEnabled();
    await relinkButton.click();
    await linkSection
      .$(`.//*[contains(., "関連中:") and contains(., "${ticketTitle}")]`)
      .waitForDisplayed();

    const linked = (await browser.tauri.execute(
      ({ core }, expectedTitle) =>
        core.invoke("ticket_list", { query: { search: expectedTitle, limit: 10 } }),
      ticketTitle,
    )) as { items: Array<{ id: string }> };
    const ticketId = linked.items[0]?.id;
    if (!ticketId) throw new Error("scheduled ticket was not found");
    const schedules = (await browser.tauri.execute(
      ({ core }, id) =>
        core.invoke("ticket_schedule_list", { ticketId: id, includeUnlinked: true }),
      ticketId,
    )) as Array<{ unlinkedAt: string | null; schedule: { title: string } }>;
    expect(schedules).toHaveLength(2);
    expect(schedules.filter((item) => item.unlinkedAt === null)).toHaveLength(1);
    expect(schedules.find((item) => item.unlinkedAt === null)?.schedule.title).toBe(
      `${ticketTitle}-編集済み`,
    );
  });

  it("persists the Kanban create, edit, pointer, keyboard, completion, and archive workflows", async () => {
    await persistFixtureTheme("light");
    await setLogicalWindowSize(1280, 820);
    const ticketTitle = "E2Eチケット-タグ表示";
    await openTicketView();
    expect(
      await browser.execute(() =>
        Array.from(document.querySelectorAll<HTMLElement>(".ticket-column h2")).map((heading) =>
          heading.textContent?.trim(),
        ),
      ),
    ).toEqual(["Inbox", "Backlog", "Next", "In Progress", "Waiting", "Done", "Omit"]);
    await browser.saveScreenshot("./test-results/native-ticket-board-empty.png");

    await $(
      '//section[.//h2[normalize-space(.)="Inbox"]]//input[@placeholder="タイトルだけで追加"]',
    ).setValue(ticketTitle);
    await $(
      '//section[.//h2[normalize-space(.)="Inbox"]]//button[normalize-space(.)="追加"]',
    ).click();
    const card = $(`//article[.//*[normalize-space(.)="${ticketTitle}"]]`);
    await card.waitForDisplayed();
    await browser.saveScreenshot("./test-results/native-ticket-board.png");

    await $(`//button[@aria-label="${ticketTitle}の詳細を開く"]`).click();
    const description = $("#ticket-description");
    await description.setValue(
      "# リリース計画\n\n| 項目 | 状態 | 担当 |\n| --- | --- | --- |\n| UI | 完了 | local |\n| native | 確認中 | local |\n\n- [x] component test\n- [ ] native smoke\n\n[確認資料](https://example.invalid/evidence)",
    );
    await browser.execute(() => {
      const select = Array.from(
        document.querySelectorAll<HTMLLabelElement>('div[role="dialog"] label'),
      )
        .find((label) => label.textContent?.includes("優先度"))
        ?.querySelector<HTMLSelectElement>("select");
      if (!select) throw new Error("ticket priority select was not found");
      select.value = "urgent";
      select.dispatchEvent(new Event("change", { bubbles: true }));
    });
    await $('//div[@role="dialog"]//label[contains(., "期限")]/input').setValue("2026-08-01");
    await $('//div[@role="dialog"]//label[contains(., "見積時間")]/input').setValue("45");
    await $('//div[@role="dialog"]//label[contains(., "タグ")]/input').setValue("native, evidence");
    await $('//div[@role="dialog"]//label[contains(., "チェックリスト")]/textarea').setValue(
      "[x] 作成\n[ ] 確認",
    );
    await browser.saveScreenshot("./test-results/native-ticket-detail.png");
    await $('//div[@role="dialog"]//button[normalize-space(.)="保存"]').click();
    await $(
      '//div[@role="dialog"]//section[contains(@class, "status-message--success") and @role="status" and contains(., "保存しました")]',
    ).waitForDisplayed();
    await browser.saveScreenshot("./test-results/native-ticket-save-success.png");
    await browser
      .action("pointer", { parameters: { pointerType: "mouse" } })
      .move({ origin: "viewport", x: 8, y: 8 })
      .down({ button: 0 })
      .up({ button: 0 })
      .perform();
    await browser.releaseActions();
    await $('//div[@role="dialog"]').waitForExist({
      reverse: true,
      timeoutMsg: "ticket detail did not close after clicking the backdrop",
    });
    await card
      .$('.//*[contains(@class, "ticket-card__tag") and normalize-space(.)="native"]')
      .waitForDisplayed();
    await card
      .$('.//*[contains(@class, "ticket-card__tag") and normalize-space(.)="evidence"]')
      .waitForDisplayed();
    await browser.saveScreenshot("./test-results/native-ticket-board-tags.png");
    await persistFixtureTheme("mild");
    await browser.refresh();
    await $(".app-shell").waitForDisplayed();
    await openTicketView();
    await $(`//button[@aria-label="${ticketTitle}の詳細を開く"]`).waitForDisplayed();
    await browser.saveScreenshot("./test-results/native-ticket-board-tags-mild.png");
    await persistFixtureTheme("dark");
    await browser.refresh();
    await $(".app-shell").waitForDisplayed();
    await openTicketView();
    await $(`//button[@aria-label="${ticketTitle}の詳細を開く"]`).waitForDisplayed();
    await browser.saveScreenshot("./test-results/native-ticket-board-tags-dark.png");
    await persistFixtureTheme("light");
    await browser.refresh();
    await $(".app-shell").waitForDisplayed();
    await openTicketView();
    await $(`//button[@aria-label="${ticketTitle}の詳細を開く"]`).waitForDisplayed();
    await persistTextScale(200);
    await setLogicalWindowSize(720, 820);
    await $(
      `//button[@aria-label="${ticketTitle}の詳細を開く"]//*[contains(@class, "ticket-card__tag") and normalize-space(.)="evidence"]`,
    ).scrollIntoView({ block: "center" });
    await browser.executeAsync((done: () => void) => {
      requestAnimationFrame(() => requestAnimationFrame(done));
    });
    await browser.saveScreenshot("./test-results/native-ticket-board-tags-text-200.png");
    await persistTextScale(100);
    await setLogicalWindowSize(1280, 820);
    await $(`//button[@aria-label="${ticketTitle}の詳細を開く"]`).click();
    const ticketPlainPreview = $("#ticket-description-plain-panel");
    await ticketPlainPreview.waitForDisplayed();
    const ticketPlainLink = ticketPlainPreview.$(
      './/a[normalize-space(.)="https://example.invalid/evidence"]',
    );
    await ticketPlainLink.waitForDisplayed();
    await expect(ticketPlainLink).toHaveAttribute("href", "https://example.invalid/evidence");
    await browser.saveScreenshot("./test-results/native-ticket-plain-preview.png");
    await $(
      '//div[@role="dialog"]//*[@role="tab" and normalize-space(.)="Markdownプレビュー"]',
    ).click();
    await $("#ticket-description-markdown-panel").waitForDisplayed();
    const ticketExternalLink = $(
      '//div[@role="dialog"]//a[contains(normalize-space(.), "確認資料")]',
    );
    await ticketExternalLink.waitForDisplayed();
    await expect(ticketExternalLink).toHaveAttribute("href", "https://example.invalid/evidence");
    await browser.saveScreenshot("./test-results/native-ticket-markdown-preview.png");
    await setLogicalWindowSize(720, 820);
    await browser.saveScreenshot("./test-results/native-ticket-markdown-preview-narrow.png");
    await setLogicalWindowSize(1280, 820);
    await persistTextScale(200);
    await browser.executeAsync((done: () => void) => {
      requestAnimationFrame(() => requestAnimationFrame(done));
    });
    await browser.saveScreenshot("./test-results/native-ticket-markdown-preview-text-200.png");
    await persistTextScale(100);
    await browser.executeAsync((done: () => void) => {
      requestAnimationFrame(() => requestAnimationFrame(done));
    });
    await $('//div[@role="dialog"]//button[@aria-label="詳細を閉じる"]').click();

    const pointerSource = $(`//button[@aria-label="${ticketTitle}の詳細を開く"]`);
    const pointerTarget = $(
      '//section[.//h2[normalize-space(.)="Backlog"]]//*[contains(@class, "ticket-column__cards")]',
    );
    await pointerSource.waitForDisplayed();
    await pointerTarget.waitForDisplayed();
    const pointerPoints = await browser.execute((titleText) => {
      const source = document.querySelector<HTMLElement>(
        `button[aria-label="${CSS.escape(titleText)}の詳細を開く"]`,
      );
      const target = Array.from(document.querySelectorAll<HTMLElement>(".ticket-column"))
        .find((column) => column.querySelector("h2")?.textContent?.trim() === "Backlog")
        ?.querySelector<HTMLElement>(".ticket-column__cards");
      if (!source || !target) throw new Error("ticket pointer source or target was not found");
      const sourceBounds = source.getBoundingClientRect();
      const targetBounds = target.getBoundingClientRect();
      return {
        source: {
          x: Math.round(sourceBounds.left + sourceBounds.width / 2),
          y: Math.round(sourceBounds.top + sourceBounds.height / 2),
        },
        target: {
          x: Math.round(targetBounds.left + targetBounds.width / 2),
          y: Math.round(targetBounds.top + Math.min(60, targetBounds.height / 2)),
        },
      };
    }, ticketTitle);
    await browser.execute(({ source }) => {
      const button = document.elementFromPoint(source.x, source.y);
      if (!(button instanceof HTMLElement)) throw new Error("ticket pointer source was not found");
      button.dispatchEvent(
        new MouseEvent("mousedown", {
          bubbles: true,
          button: 0,
          buttons: 1,
          clientX: source.x,
          clientY: source.y,
        }),
      );
      window.dispatchEvent(
        new MouseEvent("mousemove", {
          bubbles: true,
          buttons: 1,
          clientX: source.x + 40,
          clientY: source.y,
        }),
      );
    }, pointerPoints);
    await browser.waitUntil(
      async () => (await $(".ticket-board").getAttribute("data-dragging")) === "true",
      { timeoutMsg: "native mouse movement did not start the ticket drag preview" },
    );
    await browser.saveScreenshot("./test-results/native-ticket-drag-preview.png");
    expect(
      await browser.execute(
        ({ target }) =>
          document
            .elementFromPoint(target.x, target.y)
            ?.closest(".ticket-column")
            ?.querySelector("h2")
            ?.textContent?.trim(),
        pointerPoints,
      ),
    ).toBe("Backlog");
    await browser.execute(({ target }) => {
      window.dispatchEvent(
        new MouseEvent("mousemove", {
          bubbles: true,
          buttons: 1,
          clientX: target.x,
          clientY: target.y,
        }),
      );
      window.dispatchEvent(
        new MouseEvent("mouseup", {
          bubbles: true,
          button: 0,
          clientX: target.x,
          clientY: target.y,
        }),
      );
    }, pointerPoints);
    await $(
      `//section[.//h2[normalize-space(.)="Backlog"]]//button[@aria-label="${ticketTitle}の詳細を開く"]`,
    ).waitForDisplayed({ timeoutMsg: "pointer drag did not move the ticket to Backlog" });
    await browser.saveScreenshot("./test-results/native-ticket-pointer-move.png");

    await browser.execute((titleText) => {
      document
        .querySelector<HTMLElement>(`button[aria-label="${CSS.escape(titleText)}の詳細を開く"]`)
        ?.focus();
    }, ticketTitle);
    await browser.saveScreenshot("./test-results/native-ticket-keyboard-move.png");
    for (const columnName of ["Next", "In Progress", "Waiting", "Done"]) {
      await browser.execute((titleText) => {
        document
          .querySelector<HTMLElement>(`button[aria-label="${CSS.escape(titleText)}の詳細を開く"]`)
          ?.focus();
      }, ticketTitle);
      await browser.keys("ArrowRight");
      await $(
        `//section[.//h2[normalize-space(.)="${columnName}"]]//button[@aria-label="${ticketTitle}の詳細を開く"]`,
      ).waitForDisplayed();
    }
    await $(
      `//section[.//h2[normalize-space(.)="Done"]]//button[@aria-label="${ticketTitle}の詳細を開く"]`,
    ).waitForDisplayed();
    await browser.execute(() => {
      window.confirm = () => true;
    });
    await browser.execute((titleText) => {
      document
        .querySelector<HTMLElement>(`button[aria-label="${CSS.escape(titleText)}の詳細を開く"]`)
        ?.focus();
    }, ticketTitle);
    await browser.keys("ArrowRight");
    await $(
      `//section[.//h2[normalize-space(.)="Omit"]]//button[@aria-label="${ticketTitle}の詳細を開く"]`,
    ).waitForDisplayed();
    const omitted = (await browser.tauri.execute(
      ({ core }, expectedTitle) =>
        core.invoke("ticket_list", { query: { search: expectedTitle, limit: 10 } }),
      ticketTitle,
    )) as { items: Array<{ completedAt: string | null }> };
    expect(omitted.items[0]?.completedAt).toBeNull();
    await browser.saveScreenshot("./test-results/native-ticket-omit.png");
    await browser.execute((titleText) => {
      document
        .querySelector<HTMLElement>(`button[aria-label="${CSS.escape(titleText)}の詳細を開く"]`)
        ?.focus();
    }, ticketTitle);
    await browser.keys("ArrowLeft");
    await $(
      `//section[.//h2[normalize-space(.)="Done"]]//button[@aria-label="${ticketTitle}の詳細を開く"]`,
    ).waitForDisplayed();
    await browser.execute((titleText) => {
      document
        .querySelector<HTMLElement>(`button[aria-label="${CSS.escape(titleText)}の詳細を開く"]`)
        ?.focus();
    }, ticketTitle);
    await browser.keys("ArrowLeft");
    await $(
      `//section[.//h2[normalize-space(.)="Waiting"]]//button[@aria-label="${ticketTitle}の詳細を開く"]`,
    ).waitForDisplayed();

    await $(`//button[@aria-label="${ticketTitle}の詳細を開く"]`).click();
    await $('//div[@role="dialog"]//button[normalize-space(.)="アーカイブ"]').click();
    await $(
      `//p[@aria-live="polite" and normalize-space(.)="${ticketTitle}をアーカイブしました。"]`,
    ).waitForExist();
    await $(`//article[.//*[normalize-space(.)="${ticketTitle}"]]`).waitForExist({ reverse: true });
    const archived = (await browser.tauri.execute(
      ({ core }, expectedTitle) =>
        core.invoke("ticket_list", {
          query: { search: expectedTitle, includeArchived: true, limit: 10 },
        }),
      ticketTitle,
    )) as { items: Array<{ archivedAt: string | null }> };
    expect(typeof archived.items[0]?.archivedAt).toBe("string");
    await browser.refresh();
    await $(".app-shell").waitForDisplayed();
    await openTicketView();
    await browser.execute(() => {
      const select = Array.from(document.querySelectorAll("label"))
        .find((label) => label.textContent?.includes("表示"))
        ?.querySelector("select");
      if (!select) throw new Error("ticket state filter was not found");
      select.value = "archived";
      select.dispatchEvent(new Event("change", { bubbles: true }));
    });
    const archivedCard = $(`//button[@aria-label="${ticketTitle}の詳細を開く"]`);
    await archivedCard.waitForDisplayed();
    await archivedCard.click();
    await $('//div[@role="dialog"]//button[normalize-space(.)="ボードへ戻す"]').click();

    await browser.execute(() => {
      const select = Array.from(document.querySelectorAll("label"))
        .find((label) => label.textContent?.includes("表示"))
        ?.querySelector("select");
      if (!select) throw new Error("ticket state filter was not found");
      select.value = "active";
      select.dispatchEvent(new Event("change", { bubbles: true }));
    });
    const search = $('//label[span[normalize-space(.)="タイトル・説明を検索"]]/input');
    await search.setValue("no-result-synthetic");
    await $('//h2[normalize-space(.)="条件に合うチケットはありません"]').waitForDisplayed();
    await browser.saveScreenshot("./test-results/native-ticket-no-results.png");
    await search.setValue("");

    const current = (await browser.tauri.execute(
      ({ core }, expectedTitle) =>
        core.invoke("ticket_list", { query: { search: expectedTitle, limit: 10 } }),
      ticketTitle,
    )) as { items: Array<{ id: string; version: number; title: string }> };
    const currentTicket = current.items[0];
    if (!currentTicket) throw new Error("ticket conflict fixture was not found");
    await $(`button[aria-label="${ticketTitle}の詳細を開く"]`).click();
    await $('//div[@role="dialog"]//button[normalize-space(.)="編集"]').click();
    await $("#ticket-description").addValue(" locally edited");
    await browser.tauri.execute(
      ({ core }, ticket) =>
        core.invoke("ticket_update", {
          request: {
            operationId: crypto.randomUUID(),
            id: ticket.id,
            expectedVersion: ticket.version,
            patch: { priority: "high" },
          },
        }),
      currentTicket,
    );
    await $('//div[@role="dialog"]//button[normalize-space(.)="保存"]').click();
    await $('//*[normalize-space(.)="ほかの変更が先に保存されています"]').waitForDisplayed();
    await browser.saveScreenshot("./test-results/native-ticket-conflict.png");
    await browser.refresh();
    await $(".app-shell").waitForDisplayed();
    await openTicketView();

    // This scenario measures 500-card rendering. Product create/history/Outbox
    // integrity is covered by Rust; the e2e-only seed avoids hundreds of IPC
    // round trips and is unavailable in normal builds.
    const seededTotal = await browser.tauri.execute(
      ({ core }, targetTotal) => core.invoke("e2e_ticket_scale_seed", { targetTotal }),
      500,
    );
    expect(seededTotal).toBe(500);
    await browser.refresh();
    await $(".app-shell").waitForDisplayed();
    await openTicketView();
    await browser.waitUntil(async () => (await $$(".ticket-card").length) === 500, {
      timeoutMsg: "500 ticket cards were not rendered",
    });
    await browser.saveScreenshot("./test-results/native-ticket-board-500.png");

    await $('//label[span[normalize-space(.)="タイトル・説明を検索"]]/input').setValue(ticketTitle);
    await browser.waitUntil(async () => (await $$(".ticket-card").length) === 1, {
      timeoutMsg: "ticket board did not narrow to the selected evidence card",
    });
    await setLogicalWindowSize(720, 820);
    await browser.saveScreenshot("./test-results/native-ticket-board-narrow.png");
    await setLogicalWindowSize(1280, 820);
    await persistTextScale(200);
    await browser.saveScreenshot("./test-results/native-ticket-board-text-200.png");
    await persistTextScale(100);

    const persisted = (await browser.tauri.execute(
      ({ core }, expectedTitle) =>
        core.invoke("ticket_list", { query: { search: expectedTitle, limit: 10 } }),
      ticketTitle,
    )) as {
      items: Array<{ title: string; completedAt: string | null; archivedAt: string | null }>;
    };
    expect(persisted.items).toEqual(
      expect.arrayContaining([
        expect.objectContaining({ title: ticketTitle, completedAt: null, archivedAt: null }),
      ]),
    );
  });

  it("attributes Focus to the Ticket selected through an explicit related schedule", async () => {
    await persistFixtureTheme("light");
    await setLogicalWindowSize(1280, 820);
    const ticketTitle = `E2E-Focus帰属-${Date.now()}`;
    await openTicketView();
    await $('//label[span[normalize-space(.)="タイトル・説明を検索"]]/input').setValue("");
    await $(
      '//section[.//h2[normalize-space(.)="In Progress"]]//input[@placeholder="タイトルだけで追加"]',
    ).setValue(ticketTitle);
    await $(
      '//section[.//h2[normalize-space(.)="In Progress"]]//button[normalize-space(.)="追加"]',
    ).click();
    const detailButton = $(`//button[@aria-label="${ticketTitle}の詳細を開く"]`);
    await detailButton.waitForDisplayed();
    await detailButton.click();
    await $('//div[@role="dialog"]//label[contains(., "見積時間")]/input').setValue("25");
    await $('//div[@role="dialog"]//button[normalize-space(.)="保存"]').click();
    await $(
      '//div[@role="dialog"]//*[@role="status" and contains(., "保存しました")]',
    ).waitForDisplayed();
    await $('//div[@role="dialog"]//button[normalize-space(.)="新しい予定を作成"]').click();
    const startButton = $(
      '//div[@role="dialog"]//button[normalize-space(.)="この予定でFocus開始"]',
    );
    await startButton.waitForDisplayed();
    await startButton.click();
    await $(
      '//div[@role="dialog"]//*[@role="status" and contains(., "Focusを開始しました")]',
    ).waitForDisplayed();

    const ticketPage = (await browser.tauri.execute(
      ({ core }, expectedTitle) =>
        core.invoke("ticket_list", {
          query: { search: expectedTitle, limit: 10 },
        }),
      ticketTitle,
    )) as { items: Array<{ id: string }> };
    const ticketId = ticketPage.items[0]?.id;
    if (!ticketId) throw new Error("Focus attribution ticket was not found");
    const active = (await browser.tauri.execute(({ core }) => core.invoke("focus_state_get"))) as {
      linkedTicketId: string | null;
    };
    expect(active.linkedTicketId).toBe(ticketId);
    await browser.saveScreenshot("./test-results/native-ticket-focus-started.png");
    await setLogicalWindowSize(720, 820);
    await browser.saveScreenshot("./test-results/native-ticket-focus-narrow.png");
    await setLogicalWindowSize(1280, 820);
    const enlargedDialogText = await browser.execute(() => {
      const dialog = document.querySelector('div[role="dialog"]');
      if (!(dialog instanceof HTMLElement)) throw new Error("Ticket detail dialog was not found");
      const descendants: HTMLElement[] = Array.from(dialog.querySelectorAll("*")).filter(
        (element): element is HTMLElement => element instanceof HTMLElement,
      );
      const elements = [dialog, ...descendants];
      let checkedOriginal = 0;
      let checkedInline = "";
      elements.forEach((element) => {
        const original = Number.parseFloat(window.getComputedStyle(element).fontSize);
        element.dataset.e2eOriginalFontSize = element.style.fontSize;
        if (Number.isFinite(original)) {
          element.style.setProperty("font-size", `${original * 2}px`, "important");
          if (checkedOriginal === 0 && element.textContent?.trim()) {
            checkedOriginal = original;
            checkedInline = element.style.getPropertyValue("font-size");
          }
        }
      });
      return { checkedOriginal, checkedInline };
    });
    expect(enlargedDialogText.checkedInline).toBe(`${enlargedDialogText.checkedOriginal * 2}px`);
    await browser.saveScreenshot("./test-results/native-ticket-focus-text-200.png");
    await browser.execute(() => {
      const dialog = document.querySelector('div[role="dialog"]');
      if (!(dialog instanceof HTMLElement)) return;
      const descendants: HTMLElement[] = Array.from(dialog.querySelectorAll("*")).filter(
        (element): element is HTMLElement => element instanceof HTMLElement,
      );
      [dialog, ...descendants].forEach((element) => {
        const original = element.dataset.e2eOriginalFontSize ?? "";
        if (original) element.style.fontSize = original;
        else element.style.removeProperty("font-size");
        delete element.dataset.e2eOriginalFontSize;
      });
    });

    await $('//div[@role="dialog"]//button[@aria-label="詳細を閉じる"]').click();
    await $('//aside[@aria-label="主要画面"]//button[@aria-label="フォーカス"]').click();
    await $(
      `//*[contains(., "帰属先Ticket:") and contains(., "${ticketTitle}")]`,
    ).waitForDisplayed();
    await $('//button[normalize-space(.)="Focusを終了"]').click();
    await $('//*[contains(., "Ticketは自動完了していません")]').waitForDisplayed();

    const history = (await browser.tauri.execute(
      ({ core }, id) => core.invoke("ticket_focus_history_list", { ticketId: id, limit: 10 }),
      ticketId,
    )) as Array<{ sessionId: string; workSeconds: number }>;
    expect(history).toHaveLength(1);
    expect(history[0]?.workSeconds).toBeGreaterThanOrEqual(0);
    await browser.saveScreenshot("./test-results/native-ticket-focus-ended.png");
  });

  it("opens and captures the compact window after all main-window assertions", async () => {
    await persistFixtureTheme("light");
    await setLogicalWindowSize(1180, 820);
    await browser.tauri.execute(async ({ core }, expectedTitle) => {
      const page = (await core.invoke("schedule_list", {
        query: {
          startUtc: "2020-01-01T00:00:00.000Z",
          endUtc: "2035-01-01T00:00:00.000Z",
          search: expectedTitle,
          limit: 10,
        },
      })) as {
        items: Array<
          Record<string, unknown> & {
            id: string;
            title: string;
            version: number;
          }
        >;
      };
      const schedule = page.items.find((item) => item.title === expectedTitle);
      if (!schedule) throw new Error("compact fixture schedule was not found");
      const { id, version } = schedule;
      const draft: Record<string, unknown> = { ...schedule };
      delete draft.id;
      delete draft.version;
      delete draft.syncStatus;
      delete draft.deletedAt;
      const start = new Date(Date.now() + 5 * 60_000);
      start.setSeconds(0, 0);
      const end = new Date(start.getTime() + 30 * 60_000);
      await core.invoke("schedule_update", {
        update: {
          id,
          expectedVersion: version,
          draft: {
            ...draft,
            startUtc: start.toISOString(),
            endUtc: end.toISOString(),
          },
          recurrenceScope: "series",
        },
      });
    }, title);
    await $('//button[contains(., "コンパクト表示")]').click();
    await browser.waitUntil(async () => (await browser.getWindowHandles()).length > 1, {
      timeoutMsg: "compact window was not created",
    });
    await browser.tauri.switchWindow("compact");
    await setExactLogicalViewportSize(420, 640);
    await $(".compact-header h1").waitForDisplayed();
    const compactScheduleRendered = await browser.executeAsync(
      (expectedTitle: string, done: (rendered: boolean) => void) => {
        const startedAt = performance.now();
        const waitForSchedule = () => {
          if (document.body.innerText.includes(expectedTitle)) {
            done(true);
            return;
          }
          if (performance.now() - startedAt >= 15_000) {
            done(false);
            return;
          }
          requestAnimationFrame(waitForSchedule);
        };
        waitForSchedule();
      },
      title,
    );
    expect(compactScheduleRendered).toBe(true);
    await browser.saveScreenshot("./test-results/native-compact.png");
    await browser.tauri.switchWindow("main");
    await persistTextScale(250);
    await browser.tauri.switchWindow("compact");
    await browser.waitUntil(
      async () => (await $("html").getAttribute("data-text-scale")) === "250",
      { timeoutMsg: "250% text scale did not propagate to Compact" },
    );
    const compactTextGeometry = await browser.execute(() => {
      const shell = document.querySelector<HTMLElement>(".compact-shell");
      const agenda = document.querySelector<HTMLElement>(".compact-agenda");
      const actions = document.querySelector<HTMLElement>(".compact-actions");
      const titles = Array.from(
        document.querySelectorAll<HTMLElement>(".compact-current h2, .compact-next h2"),
      );
      if (!shell || !agenda || !actions || titles.length !== 2) {
        throw new Error("250% Compact layout was incomplete");
      }
      shell.scrollTop = shell.scrollHeight;
      const actionButtons = Array.from(actions.querySelectorAll<HTMLButtonElement>("button"));
      if (actionButtons.length === 0) throw new Error("250% Compact actions were not rendered");
      const viewportWidth = document.documentElement.clientWidth;
      const viewportHeight = document.documentElement.clientHeight;
      const shellRect = shell.getBoundingClientRect();
      const actionsRect = actions.getBoundingClientRect();
      const actionButtonsReachable = actionButtons.every((button) => {
        const rect = button.getBoundingClientRect();
        const centerX = rect.left + rect.width / 2;
        const centerY = rect.top + rect.height / 2;
        const hit =
          centerX >= 0 && centerX < viewportWidth && centerY >= 0 && centerY < viewportHeight
            ? document.elementFromPoint(centerX, centerY)
            : null;
        return (
          rect.left >= shellRect.left &&
          rect.right <= shellRect.right + 1 &&
          rect.top >= shellRect.top &&
          rect.bottom <= shellRect.bottom + 1 &&
          rect.width > 0 &&
          rect.height > 0 &&
          (hit === button || (hit instanceof Node && button.contains(hit)))
        );
      });
      const maxShellScroll = Math.max(0, shell.scrollHeight - shell.clientHeight);
      const titleContentFits = titles.every((title) => {
        const titleRect = title.getBoundingClientRect();
        const range = document.createRange();
        range.selectNodeContents(title);
        const textRects = Array.from(range.getClientRects());
        return (
          textRects.length > 0 &&
          textRects.every(
            (rect) =>
              rect.left >= titleRect.left - 1 &&
              rect.right <= titleRect.right + 1 &&
              rect.top >= titleRect.top - 1 &&
              rect.bottom <= titleRect.bottom + 1,
          )
        );
      });
      const overflowingElements = Array.from(shell.querySelectorAll<HTMLElement>("*"))
        .filter((element) => {
          const rect = element.getBoundingClientRect();
          return rect.left < shellRect.left - 1 || rect.right > shellRect.right + 1;
        })
        .map((element) => ({
          className: element.className,
          tagName: element.tagName,
          text: element.textContent?.trim().slice(0, 80) ?? "",
        }));
      return {
        actionsHeight: actionsRect.height,
        actionButtonsReachable,
        actionsReachable:
          actionsRect.top >= shellRect.top &&
          actionsRect.bottom <= shellRect.bottom + 1 &&
          actionsRect.height > 0,
        horizontalOverflow: shell.scrollWidth - shell.clientWidth,
        overflowingElements,
        rootFontSize: Number.parseFloat(
          getComputedStyle(document.documentElement).getPropertyValue("--app-font-1"),
        ),
        scrollbarWidth: Math.max(0, shell.offsetWidth - shell.clientWidth),
        shellAtBottom: Math.abs(shell.scrollTop - maxShellScroll) <= 1,
        shellScrollable: shell.scrollHeight > shell.clientHeight,
        titleContentFits,
        titleHorizontalOverflow: Math.max(
          ...titles.map((title) => title.scrollWidth - title.clientWidth),
        ),
      };
    });
    expect(compactTextGeometry.rootFontSize).toBeGreaterThanOrEqual(40);
    expect(compactTextGeometry.overflowingElements).toEqual([]);
    expect(compactTextGeometry.horizontalOverflow).toBeLessThanOrEqual(
      compactTextGeometry.scrollbarWidth + 1,
    );
    expect(compactTextGeometry.shellScrollable).toBe(true);
    expect(compactTextGeometry.shellAtBottom).toBe(true);
    expect(compactTextGeometry.titleContentFits).toBe(true);
    expect(compactTextGeometry.titleHorizontalOverflow).toBeLessThanOrEqual(1);
    expect(compactTextGeometry.actionsReachable).toBe(true);
    expect(compactTextGeometry.actionButtonsReachable).toBe(true);
    expect(compactTextGeometry.actionsHeight).toBeGreaterThan(0);
    await browser.saveScreenshot("./test-results/native-compact-text-250.png");
    await $(".compact-actions").saveScreenshot(
      "./test-results/native-compact-actions-text-250.png",
    );
    await browser.tauri.switchWindow("main");
    await persistTextScale(100);
  });

  it("opens one native analog clock window with moving hands and accessible controls", async () => {
    await browser.tauri.switchWindow("main");
    await persistFixtureTheme("light");
    await persistTextScale(100);
    await setLogicalWindowSize(1024, 640);
    await browser.execute(() => {
      localStorage.removeItem("day-schedule-next.analog-clock-theme");
      localStorage.removeItem("day-schedule-next.analog-clock-scale");
      localStorage.removeItem("day-schedule-next.analog-clock-volume");
    });
    const launcher = $('button[aria-label="アナログ時計を開く"]');
    await launcher.waitForDisplayed();

    const launcherHandsBefore = await browser.execute(() => ({
      hour: document
        .querySelector(".analog-clock-launcher .analog-clock-face__hand--hour")
        ?.getAttribute("transform"),
      minute: document
        .querySelector(".analog-clock-launcher .analog-clock-face__hand--minute")
        ?.getAttribute("transform"),
    }));
    await browser.waitUntil(
      async () => {
        const current = await browser.execute(() => ({
          hour: document
            .querySelector(".analog-clock-launcher .analog-clock-face__hand--hour")
            ?.getAttribute("transform"),
          minute: document
            .querySelector(".analog-clock-launcher .analog-clock-face__hand--minute")
            ?.getAttribute("transform"),
        }));
        return (
          current.hour !== launcherHandsBefore.hour && current.minute !== launcherHandsBefore.minute
        );
      },
      { timeout: 3_000, timeoutMsg: "header analog clock hands did not advance" },
    );
    await $(".topbar").saveScreenshot("./test-results/native-analog-clock-launcher.png");

    const handlesBeforeOpen = await browser.getWindowHandles();
    await launcher.click();
    await browser.waitUntil(
      async () => (await browser.getWindowHandles()).length === handlesBeforeOpen.length + 1,
      { timeout: 5_000, timeoutMsg: "analog clock window was not created" },
    );
    await browser.tauri.switchWindow("analog-clock");
    const settingsButton = $('button[aria-label="時計の設定を開く"]');
    await settingsButton.waitForDisplayed();
    const pinButton = $(".analog-clock-pin-trigger");
    await pinButton.waitForDisplayed();
    await browser.waitUntil(
      async () => (await $("html").getAttribute("data-text-scale")) === "100",
      { timeoutMsg: "analog clock did not start at the persisted 100% text scale" },
    );
    await browser.pause(100);

    // Keep the already-open analog window alive while the main window saves a new scale.
    // settings_update emits a cross-window event; no analog reload is used here.
    const handlesWithAnalog = await browser.getWindowHandles();
    await browser.tauri.switchWindow("main");
    await setLogicalWindowSize(1180, 820);
    await $('//aside[@aria-label="主要画面"]//button[contains(., "設定")]').click();
    await selectTextScale(250);
    const saveSettings = $('//button[normalize-space(.)="設定を保存"]');
    await saveSettings.waitForDisplayed();
    await browser.execute(() => {
      const view = document.querySelector<HTMLElement>(".settings-view");
      if (!view) throw new Error("settings view was not rendered for analog scale propagation");
      view.scrollTop = view.scrollHeight;
    });
    await saveSettings.click();
    await browser.waitUntil(
      async () => {
        const bootstrap = (await browser.tauri.execute(({ core }) =>
          core.invoke("bootstrap_get"),
        )) as { settings: { textScalePercent: number } };
        return bootstrap.settings.textScalePercent === 250;
      },
      { timeoutMsg: "250% text scale was not persisted before analog propagation" },
    );
    await browser.tauri.switchWindow("analog-clock");
    await browser.waitUntil(
      async () => (await $("html").getAttribute("data-text-scale")) === "250",
      { timeoutMsg: "250% text scale did not reach the already-open analog clock" },
    );
    expect(await browser.getWindowHandles()).toHaveLength(handlesWithAnalog.length);

    const cornerControls = await browser.execute(() => {
      const pin = document.querySelector<HTMLElement>(".analog-clock-pin-trigger");
      const settings = document.querySelector<HTMLElement>(".analog-clock-settings-trigger");
      if (!pin || !settings) throw new Error("analog clock corner controls were not rendered");
      const pinRect = pin.getBoundingClientRect();
      const settingsRect = settings.getBoundingClientRect();
      return {
        gap: settingsRect.left - pinRect.right,
        pinHeight: pinRect.height,
        pinWidth: pinRect.width,
        settingsHeight: settingsRect.height,
        settingsWidth: settingsRect.width,
      };
    });
    expect(cornerControls.pinWidth).toBe(44);
    expect(cornerControls.pinHeight).toBe(44);
    expect(cornerControls.settingsWidth).toBe(44);
    expect(cornerControls.settingsHeight).toBe(44);
    expect(cornerControls.gap).toBeGreaterThanOrEqual(7);

    if ((await pinButton.getAttribute("aria-pressed")) === "true") await pinButton.click();
    await browser.waitUntil(
      async () => (await pinButton.getAttribute("aria-pressed")) === "false",
      {
        timeout: 3_000,
        timeoutMsg: "analog clock pin did not reach the unpinned state",
      },
    );
    await browser.execute(() => {
      document.querySelector<HTMLElement>(".analog-clock-pin-trigger")?.focus();
    });
    await browser.waitUntil(
      async () => {
        return browser.execute(() => {
          const focused =
            document.activeElement?.classList.contains("analog-clock-pin-trigger") ?? false;
          return (
            focused && document.querySelector('[role="tooltip"]')?.textContent === "常に手前に固定"
          );
        });
      },
      { timeout: 3_000, timeoutMsg: "analog clock pin tooltip did not appear on focus" },
    );
    await pinButton.click();
    await browser.waitUntil(async () => (await pinButton.getAttribute("aria-pressed")) === "true", {
      timeout: 3_000,
      timeoutMsg: "analog clock pin did not enable always-on-top",
    });
    await browser.execute(() => {
      (document.activeElement as HTMLElement | null)?.blur();
      document.querySelector<HTMLElement>(".analog-clock-pin-trigger")?.focus();
    });
    await browser.waitUntil(
      async () =>
        browser.execute(
          () => document.querySelector('[role="tooltip"]')?.textContent === "常に手前を解除",
        ),
      {
        timeout: 3_000,
        timeoutMsg: "analog clock unpin tooltip did not update",
      },
    );
    const pinnedPreference = (await browser.tauri.execute(({ core }) =>
      core.invoke("bootstrap_get"),
    )) as { windowPreferences: { analogClockAlwaysOnTop: boolean } };
    expect(pinnedPreference.windowPreferences.analogClockAlwaysOnTop).toBe(true);

    const clockBefore = await browser.execute(() => ({
      hour: document.querySelector(".analog-clock-face__hand--hour")?.getAttribute("transform"),
      markCount: document.querySelectorAll(".analog-clock-face__marks line").length,
      minute: document.querySelector(".analog-clock-face__hand--minute")?.getAttribute("transform"),
      numberCount: document.querySelectorAll(".analog-clock-face__numbers text").length,
      second: document.querySelector(".analog-clock-face__hand--second")?.getAttribute("transform"),
    }));
    expect(clockBefore.markCount).toBe(60);
    expect(clockBefore.numberCount).toBe(12);
    await browser.waitUntil(
      async () => {
        const current = await browser.execute(() => ({
          hour: document.querySelector(".analog-clock-face__hand--hour")?.getAttribute("transform"),
          minute: document
            .querySelector(".analog-clock-face__hand--minute")
            ?.getAttribute("transform"),
          second: document
            .querySelector(".analog-clock-face__hand--second")
            ?.getAttribute("transform"),
        }));
        return (
          current.hour !== clockBefore.hour &&
          current.minute !== clockBefore.minute &&
          current.second !== clockBefore.second
        );
      },
      { timeout: 3_000, timeoutMsg: "analog clock hands did not advance" },
    );

    const dominantClockLayout = await browser.execute(() => {
      const dial = document.querySelector<SVGCircleElement>(".analog-clock-face__dial");
      if (!dial) throw new Error("analog clock dial was not rendered");
      const rect = dial.getBoundingClientRect();
      const stage = document.querySelector<HTMLElement>(".analog-clock-stage");
      if (!stage) throw new Error("analog clock stage was not rendered");
      const stageRect = stage.getBoundingClientRect();
      const stageEdge = Math.min(stageRect.width, stageRect.height);
      return {
        bottom: rect.bottom,
        clockRatio: rect.width / stageEdge,
        clientHeight: document.documentElement.clientHeight,
        clientWidth: document.documentElement.clientWidth,
        left: rect.left,
        right: rect.right,
        scrollWidth: document.documentElement.scrollWidth,
        settingsVisible: document.querySelector(".analog-clock-settings-panel") !== null,
        top: rect.top,
      };
    });
    expect(dominantClockLayout.clockRatio).toBeGreaterThanOrEqual(0.89);
    expect(dominantClockLayout.clockRatio).toBeLessThanOrEqual(0.96);
    expect(dominantClockLayout.left).toBeGreaterThanOrEqual(0);
    expect(dominantClockLayout.top).toBeGreaterThanOrEqual(0);
    expect(dominantClockLayout.right).toBeLessThanOrEqual(dominantClockLayout.clientWidth + 1);
    expect(dominantClockLayout.bottom).toBeLessThanOrEqual(dominantClockLayout.clientHeight + 1);
    expect(dominantClockLayout.scrollWidth).toBeLessThanOrEqual(
      dominantClockLayout.clientWidth + 1,
    );
    expect(dominantClockLayout.settingsVisible).toBe(false);
    await browser.saveScreenshot("./test-results/native-analog-clock.png");

    expect(await browser.execute(() => document.querySelectorAll("select").length)).toBe(0);
    await settingsButton.click();
    await $(".analog-clock-settings-panel").waitForDisplayed();
    const scaledClockLayout = await browser.execute(() => {
      const shell = document.querySelector<HTMLElement>(".analog-clock-shell");
      const panel = document.querySelector<HTMLElement>(".analog-clock-settings-panel");
      const digital = document.querySelector<HTMLElement>(".analog-clock-digital");
      const numbers = document.querySelector<SVGTextElement>(".analog-clock-face__numbers text");
      if (!shell || !panel || !digital || !numbers) {
        throw new Error("250% analog layout was incomplete");
      }
      const panelRect = panel.getBoundingClientRect();
      return {
        digitalOverflow: digital.scrollWidth - digital.clientWidth,
        numberFontSize: Number.parseFloat(getComputedStyle(numbers).fontSize),
        panelBottom: panelRect.bottom,
        panelLeft: panelRect.left,
        panelRight: panelRect.right,
        panelTop: panelRect.top,
        rootFontSize: Number.parseFloat(
          getComputedStyle(document.documentElement).getPropertyValue("--app-font-1"),
        ),
        viewportHeight: document.documentElement.clientHeight,
        viewportWidth: document.documentElement.clientWidth,
      };
    });
    expect(scaledClockLayout.rootFontSize).toBeGreaterThanOrEqual(40);
    expect(scaledClockLayout.numberFontSize).toBeGreaterThanOrEqual(15);
    expect(scaledClockLayout.digitalOverflow).toBeLessThanOrEqual(1);
    expect(scaledClockLayout.panelLeft).toBeGreaterThanOrEqual(0);
    expect(scaledClockLayout.panelTop).toBeGreaterThanOrEqual(0);
    expect(scaledClockLayout.panelRight).toBeLessThanOrEqual(scaledClockLayout.viewportWidth + 1);
    expect(scaledClockLayout.panelBottom).toBeLessThanOrEqual(scaledClockLayout.viewportHeight + 1);
    await browser.saveScreenshot("./test-results/native-analog-clock-text-250.png");
    await browser.keys("Escape");
    await $(".analog-clock-settings-panel").waitForExist({ reverse: true });

    await settingsButton.click();
    await $(".analog-clock-settings-panel").waitForDisplayed();
    const soundLabel = $('//label[contains(normalize-space(.), "秒針音")]');
    await soundLabel.waitForDisplayed();
    const soundToggle = soundLabel.$('input[type="checkbox"]');
    await soundLabel.click();
    await $('//*[contains(., "秒針音を有効にしました")]').waitForDisplayed();
    await soundLabel.click();
    await $('//*[contains(., "秒針音を無効にしました")]').waitForDisplayed();
    expect(await soundToggle.isExisting()).toBe(true);

    const topmostLabel = $('//label[normalize-space(.)="常に手前"]');
    await topmostLabel.waitForDisplayed();
    const topmost = topmostLabel.$('input[type="checkbox"]');
    expect(await topmost.isSelected()).toBe(true);
    await topmostLabel.click();
    await browser.waitUntil(async () => !(await topmost.isSelected()), {
      timeout: 3_000,
      timeoutMsg: "analog clock settings did not disable always-on-top",
    });
    expect(await pinButton.getAttribute("aria-pressed")).toBe("false");
    await topmostLabel.click();
    await browser.waitUntil(() => topmost.isSelected(), {
      timeout: 3_000,
      timeoutMsg: "analog clock always-on-top setting was not enabled",
    });
    const persistedTopmost = (await browser.tauri.execute(({ core }) =>
      core.invoke("bootstrap_get"),
    )) as { windowPreferences: { analogClockAlwaysOnTop: boolean } };
    expect(persistedTopmost.windowPreferences.analogClockAlwaysOnTop).toBe(true);

    const initialWindowSize = await browser.getWindowSize();
    await $('//button[starts-with(normalize-space(.), "サイズ変更")]').click();
    await $('//button[normalize-space(.)="サイズ変更（1.5×）"]').waitForDisplayed();
    await browser.waitUntil(
      async () => {
        const resizedWindow = await browser.getWindowSize();
        return (
          Math.abs(resizedWindow.width - initialWindowSize.width) > 1 ||
          Math.abs(resizedWindow.height - initialWindowSize.height) > 1
        );
      },
      {
        timeout: 3_000,
        timeoutMsg: "analog clock window did not resize",
      },
    );
    await $('button[aria-label="時計の設定を閉じる"]').click();
    await $(".analog-clock-settings-panel").waitForExist({ reverse: true });
    await browser.execute(() => (document.activeElement as HTMLElement | null)?.blur());

    const squareConstraintInstalled = await browser.tauri.execute(({ core }) =>
      core.invoke("e2e_analog_clock_square_constraint_get"),
    );
    expect(squareConstraintInstalled).toBe(true);
    await browser.saveScreenshot("./test-results/native-analog-clock-square.png");

    await setExactLogicalViewportSize(280, 280);
    await browser.waitUntil(
      async () =>
        browser.execute(() => {
          const dial = document.querySelector<SVGCircleElement>(".analog-clock-face__dial");
          const stage = document.querySelector<HTMLElement>(".analog-clock-stage");
          if (!dial || !stage) return false;
          const rect = dial.getBoundingClientRect();
          const stageRect = stage.getBoundingClientRect();
          const ratio = rect.width / Math.min(stageRect.width, stageRect.height);
          return (
            ratio >= 0.89 &&
            ratio <= 0.96 &&
            rect.top >= 0 &&
            rect.bottom <= document.documentElement.clientHeight + 1
          );
        }),
      {
        timeout: 5_000,
        timeoutMsg: "analog clock face did not follow the 280px native viewport",
      },
    );
    const minimumLayout = await browser.execute(() => {
      const digital = document.querySelector<HTMLElement>(".analog-clock-digital");
      const fullDate = document.querySelector<HTMLElement>(".analog-clock-digital__full");
      const compactTime = document.querySelector<HTMLElement>(".analog-clock-digital__compact");
      const dial = document.querySelector<SVGCircleElement>(".analog-clock-face__dial");
      const pin = document.querySelector<HTMLElement>(".analog-clock-pin-trigger");
      const settings = document.querySelector<HTMLElement>(".analog-clock-settings-trigger");
      const shell = document.querySelector<HTMLElement>(".analog-clock-shell");
      const stage = document.querySelector<HTMLElement>(".analog-clock-stage");
      const face = document.querySelector<SVGSVGElement>(".analog-clock-face--full");
      if (
        !digital ||
        !fullDate ||
        !compactTime ||
        !dial ||
        !pin ||
        !settings ||
        !shell ||
        !stage ||
        !face
      ) {
        throw new Error("compact analog clock layout was incomplete");
      }
      const digitalRect = digital.getBoundingClientRect();
      const dialRect = dial.getBoundingClientRect();
      const pinRect = pin.getBoundingClientRect();
      const settingsRect = settings.getBoundingClientRect();
      const faceRect = face.getBoundingClientRect();
      const shellRect = shell.getBoundingClientRect();
      const stageRect = stage.getBoundingClientRect();
      const overlaps = (first: DOMRect, second: DOMRect) =>
        first.left < second.right &&
        first.right > second.left &&
        first.top < second.bottom &&
        first.bottom > second.top;
      return {
        clockRatio: dialRect.width / Math.min(stageRect.width, stageRect.height),
        compactTimeDisplay: getComputedStyle(compactTime).display,
        dialBottom: dialRect.bottom,
        dialTop: dialRect.top,
        digitalOverlapsControls:
          overlaps(digitalRect, pinRect) || overlaps(digitalRect, settingsRect),
        digitalRight: digitalRect.right,
        digitalOverflow: digital.scrollWidth - digital.clientWidth,
        faceBottom: faceRect.bottom,
        faceOverlapsControls: overlaps(faceRect, pinRect) || overlaps(faceRect, settingsRect),
        faceTop: faceRect.top,
        fullDateDisplay: getComputedStyle(fullDate).display,
        pinHeight: pinRect.height,
        pinLeft: pinRect.left,
        pinWidth: pinRect.width,
        scrollHeight: document.documentElement.scrollHeight,
        scrollWidth: document.documentElement.scrollWidth,
        shellHeight: shellRect.height,
        shellTop: shellRect.top,
        stageBottom: stageRect.bottom,
        stageHeight: stageRect.height,
        stageTop: stageRect.top,
        settingsHeight: settingsRect.height,
        settingsWidth: settingsRect.width,
        viewportHeight: document.documentElement.clientHeight,
        viewportWidth: document.documentElement.clientWidth,
      };
    });
    expect(minimumLayout.clockRatio).toBeGreaterThanOrEqual(0.89);
    expect(minimumLayout.clockRatio).toBeLessThanOrEqual(0.96);
    expect(minimumLayout.viewportWidth).toBeGreaterThanOrEqual(279);
    expect(minimumLayout.viewportWidth).toBeLessThan(360);
    expect(minimumLayout.viewportHeight).toBeGreaterThanOrEqual(279);
    expect(minimumLayout.viewportHeight).toBeLessThan(360);
    expect(minimumLayout.shellHeight).toBeLessThanOrEqual(minimumLayout.viewportHeight + 1);
    expect(minimumLayout.shellTop).toBeLessThanOrEqual(1);
    expect(minimumLayout.stageHeight).toBeLessThanOrEqual(minimumLayout.viewportHeight + 1);
    expect(minimumLayout.stageTop).toBeGreaterThanOrEqual(55);
    expect(minimumLayout.stageTop).toBeLessThanOrEqual(57);
    expect(minimumLayout.stageBottom).toBeLessThanOrEqual(minimumLayout.viewportHeight + 1);
    expect(minimumLayout.faceTop).toBeGreaterThanOrEqual(0);
    expect(minimumLayout.faceBottom).toBeLessThanOrEqual(minimumLayout.viewportHeight + 1);
    expect(minimumLayout.faceOverlapsControls).toBe(false);
    expect(minimumLayout.dialTop).toBeGreaterThanOrEqual(0);
    expect(minimumLayout.dialBottom).toBeLessThanOrEqual(minimumLayout.viewportHeight + 1);
    expect(
      Math.abs(minimumLayout.viewportWidth - minimumLayout.viewportHeight),
    ).toBeLessThanOrEqual(1);
    expect(minimumLayout.fullDateDisplay).toBe("none");
    expect(minimumLayout.compactTimeDisplay).not.toBe("none");
    expect(minimumLayout.digitalOverlapsControls).toBe(false);
    expect(minimumLayout.digitalRight).toBeLessThanOrEqual(minimumLayout.viewportWidth + 1);
    expect(minimumLayout.pinWidth).toBe(44);
    expect(minimumLayout.pinHeight).toBe(44);
    expect(minimumLayout.settingsWidth).toBe(44);
    expect(minimumLayout.settingsHeight).toBe(44);
    expect(minimumLayout.digitalOverflow).toBeLessThanOrEqual(1);
    expect(minimumLayout.scrollWidth).toBeLessThanOrEqual(minimumLayout.viewportWidth + 1);
    expect(minimumLayout.scrollHeight).toBeLessThanOrEqual(minimumLayout.viewportHeight + 1);
    await browser.saveScreenshot("./test-results/native-analog-clock-minimum.png");

    await browser.tauri.switchWindow("main");
    await persistTextScale(200);
    await browser.tauri.switchWindow("analog-clock");
    await browser.waitUntil(
      async () => (await $("html").getAttribute("data-text-scale")) === "200",
      { timeoutMsg: "200% text scale did not reach the analog clock" },
    );
    await settingsButton.click();
    await $(".analog-clock-settings-panel").waitForDisplayed();
    const enlargedSettings = await browser.execute(() => {
      const panel = document.querySelector<HTMLElement>(".analog-clock-settings-panel");
      if (!panel) throw new Error("enlarged clock settings were not rendered");
      const rect = panel.getBoundingClientRect();
      return {
        clientWidth: document.documentElement.clientWidth,
        left: rect.left,
        panelClientWidth: panel.clientWidth,
        panelScrollWidth: panel.scrollWidth,
        right: rect.right,
      };
    });
    expect(enlargedSettings.left).toBeGreaterThanOrEqual(0);
    expect(enlargedSettings.right).toBeLessThanOrEqual(enlargedSettings.clientWidth + 1);
    expect(enlargedSettings.panelScrollWidth).toBeLessThanOrEqual(
      enlargedSettings.panelClientWidth + 1,
    );
    await browser.saveScreenshot("./test-results/native-analog-clock-text-200.png");
    await browser.keys("Escape");
    await $(".analog-clock-settings-panel").waitForExist({ reverse: true });

    await browser.tauri.switchWindow("main");
    const handlesBeforeReopen = await browser.getWindowHandles();
    await launcher.waitForDisplayed();
    await launcher.click();
    await browser.tauri.switchWindow("analog-clock");
    await $('button[aria-label="時計の設定を開く"]').waitForDisplayed();
    expect(await browser.getWindowHandles()).toHaveLength(handlesBeforeReopen.length);
    await browser.tauri.switchWindow("main");
    await persistTextScale(100);
  });
});
