// Vault types — shared between the data hook and the UI.

export interface VaultRow {
  id: string;
  user_id: string;
  page: number;
  slot: number;
  item_id: string;
  quantity: number;
}

export interface VaultConfig {
  page_count: number;
  cols: number;
  rows: number;
}

/** Resolved item def, joined from items table for rendering. */
export interface VaultSlotDef {
  rowId: string;       // user_vault.id (stable key for React + drag)
  page: number;
  slot: number;        // 0..cols*rows-1
  itemId: string;      // items.id
  itemKey: string;     // items.key (e.g., 'grenade', 'health_potion')
  name: string;
  tier: number | null;
  itemNumber: number | null; // canonical cross-game id (1..228) → sprite
  textureUrl: string | null;
  quantity: number;
}

/** When the user is holding a stack on the cursor mid-drag. */
export interface CursorStack {
  itemId: string;
  itemKey: string;
  name: string;
  tier: number | null;
  itemNumber: number | null;
  textureUrl: string | null;
  quantity: number;
  /** Where it came from, so Esc can put it back. */
  origin: { kind: 'vault'; page: number; slot: number }
        | { kind: 'inventory'; rowId: string }
        | { kind: 'hotbar'; slot: number };
}
