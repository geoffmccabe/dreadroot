// VaultBridgeContext — lets the HUD inventory and hotbar drop
// handlers reach into the vault's setSlot / removeFromSlot without
// having to re-fetch vault data or lift useVaultData up to a common
// ancestor. VaultPanel registers itself on mount; HUD reads when it
// processes a drop event whose payload says { type: 'vault', ... }.

import React, { createContext, useContext, useState, useCallback } from 'react';

export interface VaultBridge {
  /** Removes `quantity` from a vault slot. Returns how many were
   *  actually removed (0 if slot empty / call failed). */
  removeFromSlot: (page: number, slot: number, quantity: number) => Promise<number>;
  /** Idempotent stack-or-fill into a vault slot. Returns true on
   *  success, false on failure. */
  setSlot: (page: number, slot: number, itemId: string, quantity: number) => Promise<unknown>;
  /** Currently-open vault page (for "put it in the open page" defaults). */
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
