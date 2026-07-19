import { $, browser, expect } from "@wdio/globals";
import "@wdio/tauri-service";

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
    await browser.waitUntil(async () => {
      const viewport = await browser.execute(() => ({
        height: window.innerHeight,
        width: window.innerWidth,
      }));
      return viewport.width >= width - 2 && viewport.height >= height - 2;
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
    expect(bootstrap).toMatchObject({ schemaVersion: 10, databaseState: "ready" });
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
    await browser.switchToWindow(originalHandle);
    await $(".app-shell").waitForDisplayed();
  });
});
