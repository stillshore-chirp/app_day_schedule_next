import { act, cleanup, render, screen, waitFor } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { afterEach, describe, expect, it } from "vitest";
import type { GoogleCalendar, GoogleConnection } from "../../shared/contracts";
import { MemoryAppClient } from "../../shared/ipc/memory-client";
import { SettingsView } from "./OperationalViews";

afterEach(() => {
  cleanup();
});

function googleConnection(overrides: Partial<GoogleConnection> = {}): GoogleConnection {
  return {
    configured: true,
    state: "configured",
    accountId: null,
    displayLabel: null,
    calendars: [],
    lastError: null,
    mappedScheduleCount: 0,
    ...overrides,
  };
}

function googleCalendar(overrides: Partial<GoogleCalendar> = {}): GoogleCalendar {
  return {
    id: "bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb",
    displayName: "Synthetic calendar",
    color: "#6F96F4",
    timezoneId: "Asia/Tokyo",
    accessRole: "reader",
    selected: true,
    defaultWriteTarget: false,
    writable: false,
    eventReadable: true,
    syncState: "synced",
    lastErrorCategory: null,
    nextRetryAt: null,
    ...overrides,
  };
}

class GoogleStateClient extends MemoryAppClient {
  beginCount = 0;

  constructor(private connection: GoogleConnection) {
    super([]);
  }

  override googleConnection(): Promise<GoogleConnection> {
    return Promise.resolve(this.connection);
  }

  override beginGoogleOAuth() {
    this.beginCount += 1;
    return Promise.resolve({
      openedInSystemBrowser: true,
      expiresAt: new Date(Date.now() + 180_000).toISOString(),
    });
  }
}

async function renderSettings(client: GoogleStateClient) {
  const bootstrap = await client.bootstrap();
  await act(async () => {
    render(
      <SettingsView client={client} bootstrap={bootstrap} onSettingsSaved={() => undefined} />,
    );
    await Promise.resolve();
  });
}

describe("Google Calendar settings", () => {
  it("starts the app-managed OAuth flow without requiring a JSON import", async () => {
    const user = userEvent.setup();
    const client = new GoogleStateClient(googleConnection());
    await renderSettings(client);

    const connect = await screen.findByRole("button", {
      name: "Google カレンダーに接続",
    });
    expect(screen.queryByRole("button", { name: /OAuth JSON/ })).toBeNull();

    await user.click(connect);

    await waitFor(() => expect(client.beginCount).toBe(1));
    expect(
      screen.getByText("システムブラウザを開きました。3分以内にGoogleの同意を完了してください。"),
    ).toBeVisible();
  });

  it("explains how to recover when the build has no OAuth client", async () => {
    const client = new GoogleStateClient(
      googleConnection({ configured: false, state: "not_configured" }),
    );
    await renderSettings(client);

    expect(
      await screen.findByText("このビルドではGoogle カレンダーへ接続できません"),
    ).toBeVisible();
    expect(
      screen.getByText(
        "ローカル予定はそのまま利用できます。OAuth設定を含む個人用ビルドを利用してください。",
      ),
    ).toBeVisible();
    expect(screen.queryByRole("button", { name: "Google カレンダーに接続" })).toBeNull();
  });

  it("offers reauthentication without hiding retained local data", async () => {
    const client = new GoogleStateClient(
      googleConnection({
        state: "auth_required",
        accountId: "aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa",
      }),
    );
    await renderSettings(client);

    expect(await screen.findByText("Googleへの再接続が必要です")).toBeVisible();
    expect(
      screen.getByText("ローカル予定は保持されています。再接続後に同期を再開します。"),
    ).toBeVisible();
    expect(screen.getByRole("button", { name: "Googleへ再接続" })).toBeVisible();
  });

  it("shows a safe, actionable category when token exchange rejects the client", async () => {
    const client = new GoogleStateClient(
      googleConnection({ lastError: "oauth_token_invalid_client" }),
    );
    await renderSettings(client);

    expect(await screen.findByText("OAuthクライアント設定が一致しません")).toBeVisible();
    expect(
      screen.getByText(
        "Desktop appのクライアントIDとloopback接続設定を確認して、アプリを再ビルドしてください。",
      ),
    ).toBeVisible();
  });

  it("does not offer event sync for a free-busy-only calendar", async () => {
    const client = new GoogleStateClient(
      googleConnection({
        state: "connected",
        accountId: "aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa",
        calendars: [
          googleCalendar({
            accessRole: "freeBusyReader",
            selected: false,
            eventReadable: false,
            syncState: "never",
          }),
        ],
      }),
    );
    await renderSettings(client);

    expect(await screen.findByRole("checkbox", { name: "同期" })).toBeDisabled();
    expect(
      screen.getByText(
        "空き時間のみ参照できます。予定を同期するにはGoogle側で予定詳細の読み取り権限が必要です。",
      ),
    ).toBeVisible();
  });

  it("explains the recovery when one calendar loses read permission", async () => {
    const client = new GoogleStateClient(
      googleConnection({
        state: "connected",
        accountId: "aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa",
        calendars: [
          googleCalendar({
            syncState: "unavailable",
            lastErrorCategory: "permission",
          }),
        ],
      }),
    );
    await renderSettings(client);

    expect(
      await screen.findByText("同期を停止しました。Google側の共有権限を確認してください。"),
    ).toBeVisible();
    expect(screen.getByRole("checkbox", { name: "同期" })).toBeEnabled();
  });
});
