import "@testing-library/jest-dom/vitest";

if (!("setPointerCapture" in HTMLElement.prototype)) {
  Object.defineProperty(HTMLElement.prototype, "setPointerCapture", {
    configurable: true,
    value: () => undefined,
  });
}

if (!("scrollBy" in HTMLElement.prototype)) {
  Object.defineProperty(HTMLElement.prototype, "scrollBy", {
    configurable: true,
    value(this: HTMLElement, options: ScrollToOptions) {
      this.scrollTop += options.top ?? 0;
    },
  });
}
