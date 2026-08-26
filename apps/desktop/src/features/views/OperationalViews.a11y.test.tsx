import { act, cleanup, render, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import axe from "axe-core";
import { afterEach, describe, expect, it, vi } from "vitest";
import { MemoryAppClient } from "../../shared/ipc/memory-client";
import { SettingsView } from "./OperationalViews";

afterEach(cleanup);

describe("SettingsView accessibility", () => {
  it("announces save failure while retaining an accessible retry path", async () => {
    const client = new MemoryAppClient([]);
    const bootstrap = await client.bootstrap();
    vi.spyOn(client, "updateSettings").mockRejectedValueOnce(
      new Error("synthetic_settings_failure"),
    );
    const user = userEvent.setup();
    const { container } = render(
      <SettingsView client={client} bootstrap={bootstrap} onSettingsSaved={() => undefined} />,
    );

    await user.click(await screen.findByRole("button", { name: "設定を保存" }));
    const alertTitle = await screen.findByText("設定を保存できませんでした。");
    expect(alertTitle.closest('[role="alert"]')).not.toBeNull();
    expect(screen.getByRole("button", { name: "設定を保存" })).toBeEnabled();

    const result = await act(() =>
      axe.run(container, {
        runOnly: {
          type: "tag",
          values: ["wcag2a", "wcag2aa", "wcag21aa", "wcag22aa"],
        },
        rules: { "color-contrast": { enabled: false } },
      }),
    );
    expect(
      result.violations.filter((violation) =>
        ["serious", "critical"].includes(violation.impact ?? ""),
      ),
    ).toEqual([]);
  });
});
