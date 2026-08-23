import type { MenuItemOptions, SubmenuOptions } from "@tauri-apps/api/menu";
import { beforeEach, describe, expect, it, vi } from "vitest";

const menuMocks = vi.hoisted(() => ({
  close: vi.fn(),
  create: vi.fn(),
  popup: vi.fn(),
}));

vi.mock("@tauri-apps/api/dpi", () => ({
  LogicalPosition: class LogicalPosition {
    constructor(
      public x: number,
      public y: number,
    ) {}
  },
}));

vi.mock("@tauri-apps/api/menu", () => ({
  Menu: {
    new: menuMocks.create,
  },
}));

import {
  showTicketMoveContextMenu,
  ticketMoveMenuItemId,
  ticketMoveMenuOptions,
  TICKET_MOVE_MENU_ID,
  TICKET_MOVE_SUBMENU_ID,
} from "./ticket-context-menu";

const columns = [
  { id: "inbox", name: "Inbox" },
  { id: "next", name: "Next" },
  { id: "done", name: "Done" },
  { id: "omit", name: "Omit" },
];

const labels = {
  move: "移動",
  currentColumn: (columnName: string) => `${columnName}（現在）`,
};

beforeEach(() => {
  menuMocks.close.mockReset().mockResolvedValue(undefined);
  menuMocks.create.mockReset().mockResolvedValue({
    close: menuMocks.close,
    popup: menuMocks.popup,
  });
  menuMocks.popup.mockReset().mockResolvedValue(undefined);
});

describe("ticketMoveMenuOptions", () => {
  it("builds one move submenu in board order and disables the current column", () => {
    const onMove = vi.fn();
    const options = ticketMoveMenuOptions({
      columns,
      currentColumnId: "inbox",
      enabled: true,
      labels,
      onMove,
    });

    const move = options.items?.[0] as SubmenuOptions;
    expect(options.id).toBe(TICKET_MOVE_MENU_ID);
    expect(options.items).toHaveLength(1);
    expect(move.id).toBe(TICKET_MOVE_SUBMENU_ID);
    expect(move.text).toBe("移動");
    expect(move.enabled).toBe(true);
    expect(move.items?.map((item) => (item as MenuItemOptions).text)).toEqual([
      "Inbox（現在）",
      "Next",
      "Done",
      "Omit",
    ]);
    expect((move.items?.[0] as MenuItemOptions).enabled).toBe(false);
    expect((move.items?.[3] as MenuItemOptions).enabled).toBe(true);
    expect(move.items?.map((item) => (item as MenuItemOptions).id)).toEqual(
      columns.map((column) => ticketMoveMenuItemId(column.id)),
    );

    (move.items?.[0] as MenuItemOptions).action?.("inbox");
    expect(onMove).not.toHaveBeenCalled();
    (move.items?.[3] as MenuItemOptions).action?.("omit");
    (move.items?.[2] as MenuItemOptions).action?.("done");
    expect(onMove).toHaveBeenCalledTimes(1);
    expect(onMove).toHaveBeenCalledWith(columns[3]);
  });

  it("disables the parent and every destination when board reordering is unavailable", () => {
    const options = ticketMoveMenuOptions({
      columns,
      currentColumnId: "inbox",
      enabled: false,
      labels,
      onMove: vi.fn(),
    });
    const move = options.items?.[0] as SubmenuOptions;

    expect(move.enabled).toBe(false);
    expect(move.items?.every((item) => !(item as MenuItemOptions).enabled)).toBe(true);
  });
});

describe("showTicketMoveContextMenu", () => {
  it("opens the native menu at a logical keyboard position and releases its resource", async () => {
    await showTicketMoveContextMenu({
      columns,
      currentColumnId: "inbox",
      enabled: true,
      labels,
      position: { x: 30, y: 40 },
      onMove: vi.fn(),
    });

    expect(menuMocks.create).toHaveBeenCalledOnce();
    expect(menuMocks.popup).toHaveBeenCalledWith(expect.objectContaining({ x: 30, y: 40 }));
    expect(menuMocks.close).toHaveBeenCalledOnce();
  });

  it("still releases the resource when the native popup fails", async () => {
    menuMocks.popup.mockRejectedValueOnce(new Error("synthetic popup failure"));

    await expect(
      showTicketMoveContextMenu({
        columns,
        currentColumnId: "inbox",
        enabled: true,
        labels,
        onMove: vi.fn(),
      }),
    ).rejects.toThrow("synthetic popup failure");
    expect(menuMocks.close).toHaveBeenCalledOnce();
  });

  it("does not report a completed selection as failed when only resource cleanup fails", async () => {
    menuMocks.close.mockRejectedValueOnce(new Error("synthetic close failure"));

    await expect(
      showTicketMoveContextMenu({
        columns,
        currentColumnId: "inbox",
        enabled: true,
        labels,
        onMove: vi.fn(),
      }),
    ).resolves.toBeUndefined();
    expect(menuMocks.popup).toHaveBeenCalledOnce();
    expect(menuMocks.close).toHaveBeenCalledOnce();
  });
});
