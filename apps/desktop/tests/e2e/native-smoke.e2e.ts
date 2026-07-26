import { $, browser, expect } from "@wdio/globals";
import "@wdio/tauri-service";
import { execFileSync } from "node:child_process";
import { writeFile } from "node:fs/promises";
import path from "node:path";

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

  const scrollActiveViewToTop = async () => {
    await browser.execute(() => {
      const view = document.querySelector("main.secondary-view");
      if (view instanceof HTMLElement) view.scrollTop = 0;
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
    expect(bootstrap).toMatchObject({ schemaVersion: 12, databaseState: "ready" });
  });

  it("creates and persists a schedule through the native IPC and SQLite boundary", async () => {
    const addButton = $('//header//button[contains(normalize-space(.), "予定")]');
    await addButton.click();
    const titleInput = $('//aside//label[contains(., "タイトル")]/input');
    await titleInput.waitForDisplayed();
    await titleInput.setValue(title);
    await $('//aside//button[normalize-space(.)="予定を作成"]').click();
    const created = $(`//*[normalize-space(.)="${title}"]`);
    await created.waitForDisplayed();
    await browser.saveScreenshot("./test-results/native-today.png");

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
      const sizes: Array<{ element: HTMLElement; fontSize: number; original: string }> =
        elements.map((element) => ({
          element,
          fontSize: Number.parseFloat(window.getComputedStyle(element).fontSize),
          original: element.style.fontSize,
        }));
      sizes.forEach(({ element, fontSize, original }) => {
        element.dataset.e2eOriginalFontSize = original;
        if (Number.isFinite(fontSize)) element.style.fontSize = `${fontSize * 2}px`;
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
    await $(
      '//section[@aria-labelledby="template-editor-title"]//label[contains(., "名前")]/input',
    ).setValue(templateName);
    await $(
      '//section[@aria-labelledby="template-editor-title"]//button[contains(., "ブロック")]',
    ).click();
    await $(
      '//div[contains(@class,"block-editor")]//label[contains(., "タイトル")]/input',
    ).setValue("E2Eブロック");
    await $(
      '//section[@aria-labelledby="template-editor-title"]//button[contains(., "テンプレートを保存")]',
    ).click();
    const templateCard = $(
      `//section[@aria-labelledby="template-list-title"]//*[normalize-space(.)="${templateName}"]`,
    );
    await templateCard.waitForDisplayed();
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

  it("persists and renders the mild theme across main and compact windows", async () => {
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

    const originalHandle = await browser.getWindowHandle();
    await $('//button[contains(., "コンパクト表示")]').click();
    await browser.waitUntil(async () => (await browser.getWindowHandles()).length > 1);
    const compactHandle = (await browser.getWindowHandles()).find(
      (handle) => handle !== originalHandle,
    );
    if (!compactHandle) throw new Error("compact window was not created");
    await browser.tauri.switchWindow("compact");
    await browser.switchToWindow(compactHandle);
    await $(".compact-shell").waitForDisplayed();
    await browser.waitUntil(async () => (await $("html").getAttribute("data-theme")) === "mild", {
      timeoutMsg: "mild theme was not applied to the compact window",
    });
    await browser.saveScreenshot("./test-results/native-mild-compact.png");
    await browser.tauri.switchWindow("main");
    await browser.switchToWindow(originalHandle);
    await $(".app-shell").waitForDisplayed();

    await $('//aside[@aria-label="主要画面"]//button[contains(., "設定")]').click();
    const restoredTheme = $('//label[contains(., "テーマ")]/select');
    await browser.execute(() => {
      const label = Array.from(document.querySelectorAll("label")).find((candidate) =>
        candidate.textContent?.includes("テーマ"),
      );
      const select = label?.querySelector("select");
      if (!select) throw new Error("theme select was not found");
      select.value = "system";
      select.dispatchEvent(new Event("change", { bubbles: true }));
    });
    await expect(restoredTheme).toHaveValue("system");
    await $('//button[normalize-space(.)="設定を保存"]').click();
    await browser.waitUntil(async () => (await $("html").getAttribute("data-theme")) === "system", {
      timeoutMsg: "system theme was not restored after mild-theme evidence capture",
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
    const savedSettings = (await browser.tauri.execute(({ core }) =>
      core.invoke("bootstrap_get"),
    )) as { settings: { snapMinutes: number } };
    expect(savedSettings.settings.snapMinutes).toBe(15);
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

  it("captures the remaining visual-regression review surfaces", async () => {
    await setLogicalWindowSize(1180, 820);
    await $('//aside[@aria-label="主要画面"]//button[contains(., "週")]').click();
    await $("main h1").waitForDisplayed();
    await browser.saveScreenshot("./test-results/native-week.png");

    await $('//aside[@aria-label="主要画面"]//button[contains(., "データと診断")]').click();
    await $("main h1").waitForDisplayed();
    await browser.saveScreenshot("./test-results/native-conflict.png");

    const originalHandle = await browser.getWindowHandle();
    await $('//button[contains(., "コンパクト表示")]').click();
    await browser.waitUntil(async () => (await browser.getWindowHandles()).length > 1);
    const compactHandle = (await browser.getWindowHandles()).find(
      (handle) => handle !== originalHandle,
    );
    if (!compactHandle) throw new Error("compact window was not created");
    await browser.switchToWindow(compactHandle);
    await $(".compact-shell").waitForDisplayed();
    await browser.saveScreenshot("./test-results/native-compact.png");
    await browser.closeWindow();
    await browser.switchToWindow(originalHandle);
    await $(".app-shell").waitForDisplayed();
  });

  it("keeps 500-item scroll and drag work within the 60fps main-thread budget", async () => {
    await browser.setTimeout({ script: 120_000 });
    await setLogicalWindowSize(1180, 820);
    const bootstrap = (await browser.tauri.execute(({ core }) => core.invoke("bootstrap_get"))) as {
      today: string;
      timezoneId: string;
    };
    await browser.tauri.execute(async ({ core }, input) => {
      const dayStart = new Date(`${input.today}T00:00:00`);
      for (let index = 0; index < 500; index += 1) {
        const start = new Date(dayStart);
        start.setMinutes(Math.floor((index * 1440) / 500));
        const end = new Date(start.getTime() + 2 * 60_000);
        await core.invoke("schedule_create", {
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
            recurrenceExdates: [],
            startNotificationMinutes: null,
            endNotificationMinutes: null,
          },
        });
      }
    }, bootstrap);
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
  });

  it("shows per-calendar recovery states with synthetic native data", async () => {
    if (process.platform !== "darwin") return;
    const dataDirectory = process.env.DAY_SCHEDULE_TEST_DATA_DIR;
    if (!dataDirectory) throw new Error("isolated native E2E data directory is missing");
    const databasePath = path.join(dataDirectory, "day-schedule-next.sqlite3");
    execFileSync("sqlite3", [
      databasePath,
      `
        INSERT INTO google_accounts(
          id, display_label, scopes_json, status, created_at_utc, updated_at_utc
        ) VALUES (
          'aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa',
          'Synthetic Google',
          '[]',
          'connected',
          '2026-07-26T00:00:00Z',
          '2026-07-26T00:00:00Z'
        );
        INSERT INTO google_calendars(
          id, account_id, remote_calendar_id, display_name, color, time_zone, access_role,
          selected, default_write_target, sync_state, last_error_category
        ) VALUES
        (
          'bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb',
          'aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa',
          'synthetic-permission-calendar',
          '同期確認用カレンダー',
          '#6F96F4',
          'Asia/Tokyo',
          'reader',
          1,
          0,
          'unavailable',
          'permission'
        ),
        (
          'cccccccc-cccc-4ccc-8ccc-cccccccccccc',
          'aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa',
          'synthetic-free-busy-calendar',
          '空き時間のみ',
          '#6F96F4',
          'Asia/Tokyo',
          'freeBusyReader',
          0,
          0,
          'never',
          NULL
        );
      `,
    ]);
    await browser.refresh();
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

    await browser.execute(() => {
      const panel = document.querySelector('section[aria-labelledby="google-panel-title"]');
      if (!(panel instanceof HTMLElement)) throw new Error("Google panel was not found");
      const descendants: HTMLElement[] = Array.from(panel.querySelectorAll("*")).filter(
        (element): element is HTMLElement => element instanceof HTMLElement,
      );
      [panel, ...descendants].forEach((element) => {
        const fontSize = Number.parseFloat(window.getComputedStyle(element).fontSize);
        element.dataset.e2eOriginalFontSize = element.style.fontSize;
        if (Number.isFinite(fontSize)) element.style.fontSize = `${fontSize * 2}px`;
      });
      panel.scrollIntoView({ block: "start" });
    });
    await expect(freeBusyCheckbox).toBeDisplayed();
    await browser.saveScreenshot("./test-results/native-google-calendar-recovery-text-200.png");
  });
});
