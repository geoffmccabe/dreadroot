// VaultBridgeContext — lets the HUD inventory and hotbar drop
// handlers reach into the vault's setSlot / removeFromSlot without
// having to re-fetch vault data or lift useVaultData up to a common
// ancestor. VaultPanel registers itself on mount; HUD reads when it
// processes a drop event whose payload says { type: 'vault', ... }.

import React, { createContext, useContext, useState, useCallback } from 'react';

export interface VaultBridge {
  /** Removes `quantity` from a vault slot. Returns how many were
   *  actually removed (0 if slot empty / call failed). Legacy 2-step
   *  path — prefer transferToInventory for vault→inv moves. */
  removeFromSlot: (page: number, slot: number, quantity: number) => Promise<number>;
  /** Idempotent stack-or-fill into a vault slot. Legacy 2-step path —
   *  prefer transferFromInventory for inv→vault moves. */
  setSlot: (page: number, slot: number, itemId: string, quantity: number) => Promise<unknown>;
  /** Atomic single-transaction inv→vault. */
  transferFromInventory: (
    inventoryRowIds: string[], page: number, slot: number,
  ) => Promise<boolean>;
  /** Atomic single-transaction vault→inv. */
  transferToInventory: (page: number, slot: number, quantity: number) => Promise<boolean>;
  /** Atomic single-transaction vault→vault (used by cursor-stack drops
   *  between vault slots). */
  transferWithinVault: (
    srcPage: number, srcSlot: number, dstPage: number, dstSlot: number, quantity: number,
  ) => Promise<boolean>;
  /** Find the first unoccupied vault slot. Preferred page first; falls
   *  back to scanning all pages. Used by shift-click inv→vault. */
  findFirstEmptySlot: (preferPage?: number) => { page: number; slot: number } | null;
  /** Currently-open vault page. */
  activePage: number;
}

interface VaultBridgeContextType {
  bridge: VaultBridge | null;
  registerBridge: (b: VaultBridge | null) => void;
}

const Ctx = createContext<VaultBridgeContextType | undefined>(undefined);

export function VaultBridgeProvider({ children }: { children: React.ReactNode }) {
  const [bridge, setBridge] = useState<VaultBridge | null>(null);
  const registerBridge = useCallback((b: VaultBridge | null) => setBridge(b), []);
  return (
    <Ctx.Provider value={{ bridge, registerBridge }}>{children}</Ctx.Provider>
  );
}

export function useVaultBridge(): VaultBridge | null {
  const ctx = useContext(Ctx);
  return ctx?.bridge ?? null;
}

export function useRegisterVaultBridge(): (b: VaultBridge | null) => void {
  const ctx = useContext(Ctx);
  if (!ctx) {
    // No provider — return a no-op so the app doesn't crash in
    // contexts where we don't want the bridge (e.g. menus).
    return () => {};
  }
  return ctx.registerBridge;
}
