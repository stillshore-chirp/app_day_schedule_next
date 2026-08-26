import { $, browser, expect } from "@wdio/globals";
import "@wdio/tauri-service";

describe("text scale process restart persistence", () => {
  it("selects and persists 250% before the first process exits", async () => {
    await $(".app-shell").waitForDisplayed();
    await $('//aside[@aria-label="主要画面"]//button[contains(., "設定")]').click();

    const scale = $('//label[contains(., "文字表示倍率")]/select');
    await browser.execute(() => {
      const select = Array.from(document.querySelectorAll<HTMLSelectElement>("select")).find(
        (candidate) => candidate.closest("label")?.textContent?.includes("文字表示倍率"),
      );
      if (!select) throw new Error("text scale select was not found");
      Object.getOwnPropertyDescriptor(HTMLSelectElement.prototype, "value")?.set?.call(
        select,
        "250",
      );
      select.dispatchEvent(new Event("change", { bubbles: true }));
    });
    await expect(scale).toHaveValue("250");
    await browser.waitUntil(
      async () => (await $("html").getAttribute("data-text-scale")) === "250",
      { timeoutMsg: "250% preview was not applied in the first process" },
    );

    await $('//button[normalize-space(.)="設定を保存"]').click();
    await browser.waitUntil(
      async () => {
        const bootstrap = (await browser.tauri.execute(({ core }) =>
          core.invoke("bootstrap_get"),
        )) as { settings: { textScalePercent: number } };
        return bootstrap.settings.textScalePercent === 250;
      },
      { timeoutMsg: "250% was not persisted before the first process exited" },
    );
  });
});
