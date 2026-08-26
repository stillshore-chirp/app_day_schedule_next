import { $, browser, expect } from "@wdio/globals";
import "@wdio/tauri-service";

describe("text scale process restart persistence", () => {
  it("restores 250% in a newly launched application process", async () => {
    await $(".app-shell").waitForDisplayed();
    await browser.waitUntil(
      async () => (await $("html").getAttribute("data-text-scale")) === "250",
      { timeoutMsg: "250% was not restored in the second application process" },
    );
    const appFontSize = await browser.execute(() =>
      Number.parseFloat(
        getComputedStyle(document.documentElement).getPropertyValue("--app-font-1"),
      ),
    );
    expect(appFontSize).toBeGreaterThanOrEqual(40);

    await $('//aside[@aria-label="主要画面"]//button[contains(., "設定")]').click();
    await expect($('//label[contains(., "文字表示倍率")]/select')).toHaveValue("250");
  });
});
