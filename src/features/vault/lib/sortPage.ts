// Alphabetical sort with tier as tiebreaker, used by the ORG button.

import type { VaultSlotDef } from '../types';

export function sortVaultPage(slots: VaultSlotDef[]): VaultSlotDef[] {
  // Sort by name asc, then tier desc within name. Stable secondary on
  // itemKey to keep order deterministic across runs.
  return [...slots].sort((a, b) => {
    const nameCmp = a.name.localeCompare(b.name);
    if (nameCmp !== 0) return nameCmp;
    const at = a.tier ?? 0;
    const bt = b.tier ?? 0;
    if (bt !== at) return bt - at;
    return a.itemKey.localeCompare(b.itemKey);
  });
}
