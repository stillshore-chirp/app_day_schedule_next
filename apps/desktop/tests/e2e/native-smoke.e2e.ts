import { $, browser, expect } from "@wdio/globals";
import "@wdio/tauri-service";
import { writeFile } from "node:fs/promises";

describe("Day Schedule Next native smoke", () => {
  const title = `E2E予定-${Date.now()}`;

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
          320,
          Math.round(outer.width + (width - viewport.width) * viewport.devicePixelRatio),
        ),
        Math.max(
          320,
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
    const bootstrap = (await browser.tauri.execute(({ core }) => core.invoke("bootstrap_get"))) as {
      settings: Record<string, unknown>;
    };
    await browser.tauri.execute(
      ({ core }, settings) => core.invoke("settings_update", { settings }),
      { ...bootstrap.settings, theme },
    );
    await browser.refresh();
    await $(".app-shell").waitForDisplayed();
    await browser.waitUntil(async () => (await $("html").getAttribute("data-theme")) === theme, {
      timeoutMsg: `fixture theme was not set to ${theme}`,
    });
  };

  it("boots the real Tauri application and reaches the native IPC boundary", async () => {
    await $(".app-shell").waitForDisplayed();
    await $('//aside[@aria-label="主要画面"]//button[contains(., "今日")]').click();
    const heading = $(".today-heading h1");
    await heading.waitForDisplayed();
    await expect(heading).toBeDisplayed();
    await expect(heading).toHaveText("今日の予定");
    const bootstrap = await browser.tauri.execute(({ core }) => core.invoke("bootstrap_get"));
    expect(bootstrap).toMatchObject({ schemaVersion: 17, databaseState: "ready" });
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
    await $('//aside//button[normalize-space(.)="予定を作成"]').click();
    const created = $(`//*[normalize-space(.)="${title}"]`);
    await created.waitForDisplayed();
    await $(".app-shell").saveScreenshot("./test-results/native-today.png");

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
                title: block.getAttribute("title"),
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
    const rootTextScale = await browser.execute(() => {
      document.documentElement.style.fontSize = "200%";
      return document.documentElement.style.fontSize;
    });
    expect(rootTextScale).toBe("200%");
    await browser.pause(100);
    await browser.saveScreenshot("./test-results/native-today-dual-strip-text-200.png");
    await browser.execute(() => {
      document.documentElement.style.fontSize = "";
    });

    await $('//button[normalize-space(.)="テンプレートを編集"]').click();
    await $("#template-editor-title").waitForDisplayed();
    await browser.waitUntil(
      async () => browser.execute(() => document.activeElement?.id === "template-editor-title"),
      { timeoutMsg: "template editor heading did not receive focus from Today" },
    );
    await $('//aside[@aria-label="主要画面"]//button[contains(., "今日")]').click();
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
    await browser.execute(() => {
      document.documentElement.style.fontSize = "200%";
    });
    await scrollActiveViewToTop();
    await $('//main//h1[normalize-space(.)="タイマー"]').waitForDisplayed();
    await browser.saveScreenshot("./test-results/native-timers-text-200.png");
    await browser.execute(() => {
      document.documentElement.style.removeProperty("font-size");
    });
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
        const samples: number[] = [];
        for (let run = 0; run < 30; run += 1) {
          const started = performance.now();
          step(run);
          canvas.getBoundingClientRect();
          samples.push(performance.now() - started);
        }
        return { p95Ms: percentile95(samples), samplesMs: samples };
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
        measurement: "synchronous event dispatch and forced current layout",
        scroll,
        drag,
        renderedScheduleNodes: document.querySelectorAll(".timeline-event").length,
      };
    })) as {
      error?: string;
      sampleRuns?: number;
      measurement?: string;
      scroll?: { p95Ms: number; samplesMs: number[] };
      drag?: { p95Ms: number; samplesMs: number[] };
      renderedScheduleNodes?: number;
    };
    await writeFile(
      "./test-results/native-performance.json",
      `${JSON.stringify(
        {
          schemaVersion: 1,
          measuredAtUtc: new Date().toISOString(),
          platform: process.platform,
          architecture: process.arch,
          itemCount: 500,
          thresholdMainThreadBudgetP95Ms: 16.7,
          ...profile,
        },
        null,
        2,
      )}\n`,
    );
    expect(profile.error).toBeUndefined();
    expect(profile.sampleRuns).toBe(30);
    expect(profile.renderedScheduleNodes).toBeLessThan(200);
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

  it("assigns a ticket from Today, edits its schedule, then unlinks and relinks it", async () => {
    await persistFixtureTheme("light");
    await setLogicalWindowSize(1280, 820);
    const ticketTitle = `E2E予定化-${Date.now()}`;
    await openTicketView();
    await $(
      '//section[.//h2[normalize-space(.)="Next"]]//input[@placeholder="タイトルだけで追加"]',
    ).setValue(ticketTitle);
    await $(
      '//section[.//h2[normalize-space(.)="Next"]]//button[normalize-space(.)="追加"]',
    ).click();
    await $(`//button[@aria-label="${ticketTitle}の詳細を開く"]`).click();
    await $('//div[@role="dialog"]//label[contains(., "見積時間")]/input').setValue("30");
    await $('//div[@role="dialog"]//button[normalize-space(.)="保存"]').click();
    await $(
      '//div[@role="dialog"]//*[@role="status" and contains(., "保存しました")]',
    ).waitForDisplayed();
    await $('//div[@role="dialog"]//button[@aria-label="詳細を閉じる"]').click();

    await $('//aside[@aria-label="主要画面"]//button[contains(., "今日")]').click();
    await $(".today-heading h1").waitForDisplayed();
    const drawerToggle = $('//button[contains(., "未配置チケット")]');
    await drawerToggle.click();
    const drawerTicket = $(
      `//section[contains(@class, "unplaced-ticket-drawer")]//button[contains(., "${ticketTitle}")]`,
    );
    await drawerTicket.waitForDisplayed();
    await browser.saveScreenshot("./test-results/native-ticket-schedule-drawer-open.png");
    await browser.execute((expectedTitle) => {
      const ticket = Array.from(
        document.querySelectorAll<HTMLButtonElement>(".unplaced-ticket-list button"),
      ).find((button) => button.textContent?.includes(expectedTitle));
      if (!ticket) throw new Error("ticket drag fixture was not found");
      const dataTransfer = new DataTransfer();
      ticket.dispatchEvent(new DragEvent("dragstart", { bubbles: true, dataTransfer }));
    }, ticketTitle);
    await browser.waitUntil(
      async () => (await $(".timeline-canvas").getAttribute("data-ticket-drop-target")) === "true",
      { timeoutMsg: "timeline did not become a ticket drop target" },
    );
    await browser.execute(() => {
      const canvas = document.querySelector<HTMLElement>(".timeline-canvas");
      if (!canvas) throw new Error("ticket drop canvas was not found");
      const dataTransfer = new DataTransfer();
      dataTransfer.setData("text/plain", "synthetic-ticket");
      const bounds = canvas.getBoundingClientRect();
      canvas.dispatchEvent(
        new DragEvent("drop", {
          bubbles: true,
          cancelable: true,
          clientY: bounds.top + bounds.height / 3,
          dataTransfer,
        }),
      );
    });
    const preview = $(
      `//section[contains(@class, "status-message")][.//strong[contains(., "${ticketTitle}") and contains(., "仮配置")]]`,
    );
    await preview.waitForDisplayed();
    await browser.execute(() => {
      const workspace = document.querySelector<HTMLElement>(".workspace-main");
      if (!workspace) throw new Error("Today workspace was not found");
      workspace.scrollTop = 0;
    });
    await browser.saveScreenshot("./test-results/native-ticket-timeline-drag-preview.png");
    await preview.$('.//button[normalize-space(.)="取消"]').click();
    await setLogicalWindowSize(720, 820);
    await browser.execute(() => {
      const workspace = document.querySelector<HTMLElement>(".workspace-main");
      const drawer = document.querySelector<HTMLElement>(".unplaced-ticket-drawer");
      if (!workspace || !drawer) throw new Error("ticket drawer was not found");
      workspace.scrollTop = drawer.offsetTop;
    });
    await browser.saveScreenshot("./test-results/native-ticket-schedule-drawer-narrow.png");
    await setLogicalWindowSize(1280, 820);
    await browser.execute(() => {
      const panel = document.querySelector<HTMLElement>(".unplaced-ticket-drawer");
      if (!panel) throw new Error("ticket drawer was not found for text scaling");
      panel.querySelectorAll<HTMLElement>("*").forEach((element) => {
        element.dataset.e2eOriginalFontSize = element.style.fontSize;
        const size = Number.parseFloat(window.getComputedStyle(element).fontSize);
        if (Number.isFinite(size)) element.style.fontSize = `${size * 2}px`;
      });
    });
    await browser.execute(() => {
      const workspace = document.querySelector<HTMLElement>(".workspace-main");
      const drawer = document.querySelector<HTMLElement>(".unplaced-ticket-drawer");
      if (!workspace || !drawer) throw new Error("ticket drawer was not found");
      workspace.scrollTop = drawer.offsetTop;
    });
    await browser.saveScreenshot("./test-results/native-ticket-schedule-drawer-text-200.png");
    await browser.execute(() => {
      document
        .querySelectorAll<HTMLElement>(".unplaced-ticket-drawer [data-e2e-original-font-size]")
        .forEach((element) => {
          element.style.fontSize = element.dataset.e2eOriginalFontSize ?? "";
          delete element.dataset.e2eOriginalFontSize;
        });
    });
    await drawerTicket.click();
    await $(
      '//div[contains(@class, "unplaced-ticket-form")]//button[normalize-space(.)="予定を作成"]',
    ).click();
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
    const ticketTitle = `E2Eチケット-${Date.now()}`;
    await openTicketView();
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
    const description = $('//div[@role="dialog"]//label[contains(., "説明")]/textarea');
    await description.setValue("synthetic native Kanban evidence");
    await $('//div[@role="dialog"]//label[contains(., "優先度")]/select').selectByAttribute(
      "value",
      "urgent",
    );
    await $('//div[@role="dialog"]//label[contains(., "期限")]/input').setValue("2026-08-01");
    await $('//div[@role="dialog"]//label[contains(., "見積時間")]/input').setValue("45");
    await $('//div[@role="dialog"]//label[contains(., "タグ")]/input').setValue("native, evidence");
    await $('//div[@role="dialog"]//label[contains(., "チェックリスト")]/textarea').setValue(
      "[x] 作成\n[ ] 確認",
    );
    await browser.saveScreenshot("./test-results/native-ticket-detail.png");
    await $('//div[@role="dialog"]//button[normalize-space(.)="保存"]').click();
    await $(
      '//div[@role="dialog"]//*[@role="status" and contains(., "保存しました")]',
    ).waitForDisplayed();
    await $('//div[@role="dialog"]//button[@aria-label="詳細を閉じる"]').click();

    await browser.execute((titleText) => {
      const target = document
        .querySelector<HTMLElement>(`button[aria-label="${CSS.escape(titleText)}の詳細を開く"]`)
        ?.closest("article");
      if (!target) throw new Error("ticket card was not found");
      target.dispatchEvent(
        new DragEvent("dragstart", {
          bubbles: true,
          cancelable: true,
          dataTransfer: new DataTransfer(),
        }),
      );
    }, ticketTitle);
    await browser.waitUntil(
      async () => (await $(".ticket-board").getAttribute("data-dragging")) === "true",
      { timeoutMsg: "ticket drag preview did not appear" },
    );
    await browser.saveScreenshot("./test-results/native-ticket-drag-preview.png");
    await browser.keys(["Escape"]);

    await $(
      `//article[.//*[normalize-space(.)="${ticketTitle}"]]//button[normalize-space(.)="移動"]`,
    ).click();
    await browser.saveScreenshot("./test-results/native-ticket-keyboard-move.png");
    for (const columnName of ["Backlog", "Next", "In Progress", "Waiting", "Done"]) {
      await $(
        `//article[.//*[normalize-space(.)="${ticketTitle}"]]//button[@aria-label="右の列へ移動"]`,
      ).click();
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
    await $(
      `//article[.//*[normalize-space(.)="${ticketTitle}"]]//button[@aria-label="左の列へ移動"]`,
    ).click();
    await $(
      `//section[.//h2[normalize-space(.)="Waiting"]]//button[@aria-label="${ticketTitle}の詳細を開く"]`,
    ).waitForDisplayed();

    await $(`//button[@aria-label="${ticketTitle}の詳細を開く"]`).click();
    await $('//div[@role="dialog"]//button[normalize-space(.)="アーカイブ"]').click();
    await browser.waitUntil(
      async () => {
        const result = (await browser.tauri.execute(
          ({ core }, expectedTitle) =>
            core.invoke("ticket_list", {
              query: { search: expectedTitle, includeArchived: true, limit: 10 },
            }),
          ticketTitle,
        )) as { items: Array<{ archivedAt: string | null }> };
        return typeof result.items[0]?.archivedAt === "string";
      },
      { timeoutMsg: "ticket archive was not persisted" },
    );
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
    await $('//div[@role="dialog"]//label[contains(., "説明")]/textarea').addValue(
      " locally edited",
    );
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
    await browser.execute(() => {
      document.documentElement.style.fontSize = "200%";
    });
    await browser.saveScreenshot("./test-results/native-ticket-board-text-200.png");
    await browser.execute(() => {
      document.documentElement.style.removeProperty("font-size");
    });

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
    await $(
      '//section[.//h2[normalize-space(.)="In Progress"]]//input[@placeholder="タイトルだけで追加"]',
    ).setValue(ticketTitle);
    await $(
      '//section[.//h2[normalize-space(.)="In Progress"]]//button[normalize-space(.)="追加"]',
    ).click();
    await $(`//button[@aria-label="${ticketTitle}の詳細を開く"]`).click();
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
  });
});
