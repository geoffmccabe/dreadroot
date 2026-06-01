// Shared types for the cursor-stack inventory system.
//
// A "slot" is a positional cell in any of the three regions. Each
// region has its own location encoding (vault has page+slot, inventory
// uses a gridSlot index, hotbar has a slot number) but they all flow
// through the same slotClick reducer.

export type Region = 'inventory' | 'hotbar' | 'vault';

/** Location identifier for one slot, by region. */
export type SlotLocation =
  | { region: 'inventory'; gridSlot: number }
  | { region: 'hotbar'; slot: number }
  | { region: 'vault'; page: number; slot: number };

/** What occupies a slot right now (or null if empty). */
export interface SlotOccupant {
  itemId: string;
  itemKey: string;
  quantity: number;
  name: string;
  tier: number | null;
  spriteUrl: string | null;
  nonStackable: boolean;
  /** For inventory: the user_inventory row id (each stack is one row).
   *  For hotbar: the user_equipped row id (or the underlying inv row id
   *    that's currently equipped, depending on implementation).
   *  For vault: the user_vault row id.
   *  Used by transfer RPCs that take row ids instead of (page,slot). */
  rowId: string;
}

/** Input to the slotClick reducer. Built from a pointer event + the
 *  slot's current SlotOccupant. */
export interface SlotClickInput {
  location: SlotLocation;
  occupant: SlotOccupant | null;
  button: 'left' | 'right';
  shift: boolean;
  doubleClick: boolean;
}

/** Handler bag the reducer needs to actually mutate state. v4.11.0
 *  unified — every cross-region move is one transferSlot call;
 *  within-region inv→inv is a positional swap. */
export interface SlotClickHandlers {
  /** Move any item between any two slots in any regions. One RPC for
   *  every transfer combo (inv↔qs, inv↔vault, qs↔vault, vault↔vault). */
  transferSlot: (
    from: { region: 'inventory' | 'quick_select' | 'vault'; page: number; slot: number },
    to:   { region: 'inventory' | 'quick_select' | 'vault'; page: number; slot: number },
    quantity: number,
  ) => Promise<boolean>;

  /** Swap the contents of two slots (or move if dest empty). Used
   *  when the cursor drops onto an occupied tile of a different item. */
  swapSlot: (
    from: { region: 'inventory' | 'quick_select' | 'vault'; page: number; slot: number },
    to:   { region: 'inventory' | 'quick_select' | 'vault'; page: number; slot: number },
  ) => Promise<boolean>;

  /** Eject the slot's item into the world at a position. Used when the
   *  cursor releases outside any panel — the item lands in the game. */
  ejectSlotToWorld: (
    from: { region: 'inventory' | 'quick_select' | 'vault'; page: number; slot: number },
  ) => Promise<boolean>;

  // ── Within-region positional move (no RPC) ──────────────────────
  /** Swap two inventory gridSlots — purely local positional state. */
  swapInventorySlots: (slotA: number, slotB: number) => void;

  // ── First-empty-slot resolvers (for shift-click) ────────────────
  findFirstEmptyInventorySlot: () => number | null;
  findFirstEmptyHotbarSlot: () => number | null;
  findFirstEmptyVaultSlot: (preferPage?: number) => { page: number; slot: number } | null;

  // ── Currently-active vault page ─────────────────────────────────
  activeVaultPage: number;
}
