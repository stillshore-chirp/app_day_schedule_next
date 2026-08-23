import { LogicalPosition } from "@tauri-apps/api/dpi";
import { Menu, type MenuOptions } from "@tauri-apps/api/menu";

export interface TicketMoveMenuColumn {
  id: string;
  name: string;
}

export interface TicketMoveMenuLabels {
  move: string;
  currentColumn: (columnName: string) => string;
}

export interface TicketMoveMenuRequest {
  columns: TicketMoveMenuColumn[];
  currentColumnId: string;
  enabled: boolean;
  labels: TicketMoveMenuLabels;
  position?: { x: number; y: number };
  onMove: (column: TicketMoveMenuColumn) => void;
}

export const TICKET_MOVE_MENU_ID = "ticket-context-move-menu";
export const TICKET_MOVE_SUBMENU_ID = "ticket-context-move-submenu";

export function ticketMoveMenuItemId(columnId: string): string {
  return `ticket-context-move-column-${encodeURIComponent(columnId)}`;
}

export function ticketMoveMenuOptions({
  columns,
  currentColumnId,
  enabled,
  labels,
  onMove,
}: TicketMoveMenuRequest): MenuOptions {
  let selected = false;
  return {
    id: TICKET_MOVE_MENU_ID,
    items: [
      {
        id: TICKET_MOVE_SUBMENU_ID,
        text: labels.move,
        enabled,
        items: columns.map((column) => ({
          id: ticketMoveMenuItemId(column.id),
          text: column.id === currentColumnId ? labels.currentColumn(column.name) : column.name,
          enabled: enabled && column.id !== currentColumnId,
          action: () => {
            if (!enabled || column.id === currentColumnId || selected) return;
            selected = true;
            onMove(column);
          },
        })),
      },
    ],
  };
}

export async function showTicketMoveContextMenu(request: TicketMoveMenuRequest): Promise<void> {
  const menu = await Menu.new(ticketMoveMenuOptions(request));
  try {
    await menu.popup(
      request.position ? new LogicalPosition(request.position.x, request.position.y) : undefined,
    );
  } finally {
    // Resource cleanup must not turn a completed menu selection into a false
    // "ticket was not changed" error. Creation and popup failures still
    // propagate to the recoverable UI message above the board.
    await menu.close().catch(() => undefined);
  }
}
