import { cleanup, render, screen, waitFor } from "@testing-library/react";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { afterEach, describe, expect, it } from "vitest";
import { MemoryAppClient } from "../shared/ipc/memory-client";
import { CompactApp } from "./CompactApp";

afterEach(() => {
  cleanup();
  delete document.documentElement.dataset.theme;
  delete document.documentElement.dataset.textScale;
  delete document.documentElement.dataset.textScaleLevel;
  delete document.documentElement.dataset.windowKind;
  delete document.documentElement.dataset.window;
  document.documentElement.style.removeProperty("--app-font-scale-percent");
  document.documentElement.style.removeProperty("--app-font-scale-factor");
  document.documentElement.style.removeProperty("font-size");
});

describe("CompactApp theme", () => {
  it("applies the persisted mild theme in its own window", async () => {
    const client = new MemoryAppClient();
    const bootstrap = await client.bootstrap();
    await client.updateSettings({ ...bootstrap.settings, theme: "mild" });
    const queryClient = new QueryClient({ defaultOptions: { queries: { retry: false } } });

    render(
      <QueryClientProvider client={queryClient}>
        <CompactApp client={client} />
      </QueryClientProvider>,
    );

    await screen.findByRole("heading", { name: "Day Schedule Next" });
    await waitFor(() => expect(document.documentElement.dataset.theme).toBe("mild"));
  });

  it("applies the persisted text display scale in its own window", async () => {
    const client = new MemoryAppClient([]);
    const bootstrap = await client.bootstrap();
    await client.updateSettings({ ...bootstrap.settings, textScalePercent: 250 });
    const queryClient = new QueryClient({ defaultOptions: { queries: { retry: false } } });

    render(
      <QueryClientProvider client={queryClient}>
        <CompactApp client={client} />
      </QueryClientProvider>,
    );

    await waitFor(() => expect(document.documentElement.dataset.textScale).toBe("250"));
    expect(document.documentElement.dataset.textScaleLevel).toBe("extra");
    expect(document.documentElement.style.getPropertyValue("--app-font-scale-percent")).toBe(
      "250%",
    );
  });
});
