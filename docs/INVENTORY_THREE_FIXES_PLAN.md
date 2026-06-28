# Three inventory fixes (Geoff, finalized 2026-Jun-28)

## Fix 1 — Vault stacks same-tier items (incl. weapons)
The server already stacks any same-item in the vault (transfer_slot: "vault stacks if same item");
the CLIENT blocks it for non-stackables. The vault's purpose is to stack everything.
- **1a:** slotClick — drop same-item onto an occupied VAULT slot → MERGE (stack) even when the
  item is non-stackable elsewhere. Remove the `!cursor.nonStackable` gate for vault destinations.
  Inv/QA stay 1-per-slot (DB trigger enforces).
- **1b:** Drag-out quantity — a normal drag of a vault stack moves **1 unit** (to INV/QA/Equip).
  Hold **Shift** to carry the **whole stack**, which can only be dropped into another vault slot.

## Fix 2 — Drag a one-hander/grenade onto a hand with a rifle → SWAP the rifle out (no reject)
handlePointerUp: replace the "Rifle uses both hands" rejection with a swap — the new one-handed
item (pistol/grenade/glove) goes into the targeted hand; the rifle is evicted to the item's
source slot. (Left-hand target = a clean equip_transfer swap; right-hand target = place item in
slot 5 then move the orphaned rifle slot 1 → source.)

## Fix 3 — Triple-click/# assigns by type + swaps the rifle out
resolveAndEquip: recognize grenades (not just guns/gloves), then by type:
- **Grenade → LEFT hand (slot 1)**
- **One-handed gun (pistol) → RIGHT hand (slot 5)**
- **Flame glove → first FREE hand, else RIGHT (swap)**
- Rifle (two-handed) → slot 1 centered (unchanged)
Whatever is in the target hand (incl. a centered rifle) is swapped out to the item's slot —
same shared helper as Fix 2.

## Reverse case (decided) — Equip a RIFLE while hands are full → AUTO-SWAP the hand items out
No more "Free both hands for a rifle." Equipping a rifle unequips BOTH hand items (back to
inventory) and takes both hands.

## Shared helper
One "equip into a hand, evicting whatever's there (including a centered rifle, to the item's
origin or first empty inventory)" routine used by BOTH the drag path and the triple-click path,
so they finally behave identically.

## Slices (build + commit each)
A. Fix 1a (vault merge for non-stackables). B. Fix 1b (drag-out qty + shift). C. shared
equip-into-hand-with-evict helper. D. Fix 2 (drag uses it). E. Fix 3 (triple-click uses it +
type→hand + grenade recognition). F. Rifle-equip auto-swaps hands out.
