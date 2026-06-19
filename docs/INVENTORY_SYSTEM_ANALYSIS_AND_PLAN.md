# Inventory System — Analysis, Locked Design, and Rebuild Plan

Status: ANALYSIS + PLAN. The four item areas (Inventory, QA/Quick-Access, Vault, Equip) are one
DB table but a fragmented client. This doc is the reference for unifying + fixing it.

---

## 1. Architecture as-found

**Database (unified):** one table `user_slots` with `region ∈ {inventory, quick_select, vault, equip}`,
plus `page`, `slot`, `item_id`, `quantity`. `quantity=1` enforced for inventory/quick_select/equip;
vault may stack. Moves go through SECURITY DEFINER RPCs (`transfer_slot`, `swap_slot`,
`eject_slot_to_world`, and a separate `equip_transfer`). So the "one grid, coordinate allocations
per region" intent EXISTS at the data layer.

**Client (fragmented):** three independent owners that don't coordinate:
- `useUserData` owns Inventory (region=inventory) + QA (region=quick_select). One fetch + one realtime.
- `useVaultData` owns Vault. Separate fetch + realtime.
- `EquipSlots.tsx` owns Equip — its OWN query, its OWN realtime subscription, its OWN move RPC
  (`equip_transfer`), its OWN category validation. It is NOT in the client slot-address type
  (`SlotLocation` only has inventory/hotbar/vault), NOT in the shared move-reducer (`slotClick`),
  and renders with zero props (self-contained).

**Two active "weapon/tool" truths that disagree:** the QA-selected slot (drives the flame-glove
trigger + the highlighted selection) vs. Equip slot 1 / E1 (drives the actual fire SOUND + damage via
`setActiveWeapon`). A third "selected definition" is used for some checks.

---

## 2. Root causes of the reported bugs (verified)

1. **Invisible eggs** — FIXED (v4.65.1). Items with no uploaded sprite drew nothing; the shared
   `ItemTileVisual` now falls back to the item NAME.

2. **Weapons can't go into E1** — `EquipSlots.handlePointerUp` silently `return`s if the dropped
   item's `items.item_category` isn't exactly `"weapon"` (E1's accepted cats = `['weapon']`). But
   guns are classified by `weapon_stats.is_gun`, NOT by `item_category`. Two definitions of "weapon"
   disagree → valid guns are refused, with NO feedback.

3. **Item ends up in BOTH Equip and Inventory/QA** — `equip_transfer` is atomic in the DB (deletes
   source, inserts dest) and relies on the source-row DELETE *realtime event* to clear the old view.
   But `useUserData`'s realtime DELETE handler gates on `row.region`, and a default-replica-identity
   DELETE payload carries only the primary key (no `region`) — so the delete branch never runs and
   the item lingers in its old slot. Same root class as the phantom-egg bug.
   ROOT FIX: `ALTER TABLE public.user_slots REPLICA IDENTITY FULL;` (deletes then carry the full row).

4. **Flame glove plays the AK-47 sound / "only works in E1"** — fire sound + damage read ONLY E1
   (`EquipSlots.tsx` → `setActiveWeapon` ← `equip[1]`), while the flame trigger reads the QA
   selection (`isFlameGloveSelected` ← selected QA item). So "flame glove in QA + AK in E1" =
   flame visuals + AK sound. Three sources of truth, openly disagreeing.

---

## 3. LOCKED design decision (from the owner)

- **Equip is the ONLY place a weapon is active.** A weapon fires only from its Equip slot (E1 =
  weapon). Its sound, damage, and special behavior (e.g. flame glove) all come from the equipped
  weapon — never from a QA selection.
- **QA and Inventory can only USE consumables** (potions, eggs, etc.). Selecting a weapon in QA must
  NOT fire it or trigger weapon/flame behavior.
- **To use a weapon, move it to its correct Equip slot.** Three input methods, all doing the same
  "swap with the correct equip slot" action:
  1. Triple-click the QA slot number (3 fast clicks within ~1 second).
  2. Press ESC, then triple-click the item.
  3. Drag-and-drop the item onto Equip.

Implication: the "active weapon" resolver is SINGLE = the equipped weapon slot. The
`isFlameGloveSelected`-from-QA path is a bug to remove; flame behavior must key off the equipped
weapon. QA "use" is restricted to consumables.

---

## 4. The two structural defects to fix first

A. **Client fragmentation** — Equip is a bolted-on outlier (own query/realtime/RPC, not in the slot
   types or the move-reducer). Moves between Equip and the rest don't invalidate each other.
B. **No single "active item"** — three disagreeing resolvers for what's active.

Plus a cross-cutting reliability bug: realtime DELETE events on `user_slots` don't carry the row's
region/slot (default replica identity) → stale views / duplication.

---

## 5. Build order (do the base first, then behavior)

**Phase 0 — Realtime reliability (DB one-liner, ROOT fix for duplication/drift):**
- `ALTER TABLE public.user_slots REPLICA IDENTITY FULL;`
- Ends the "both places" duplication for every region (inventory/QA/equip), since deletes now
  carry region+slot so the client clears the source view.

**Phase 1 — Unify Equip in the client (base architecture):**
- `useUserData` becomes the SINGLE owner of Equip state too: fetch region='equip' rows + handle them
  in the same realtime handler → expose `equippedGear`. Remove `EquipSlots`' private query +
  subscription; it renders from the shared state (threaded `useUserData → Fortress → FortressHUD →
  EquipSlots`).
- Add `equip` to the client slot-address type (`SlotLocation`/`CursorOrigin`) and the
  region/slot/page converters.
- Route Equip moves through the shared `slotClick` reducer (optimistic cursor + one shared refetch),
  using `equip_transfer` (or fold equip into `transfer_slot`) under the hood. One refresh path
  updates all four regions.

**Phase 2 — Single active-weapon model + interactions (once base is right):**
- One resolver: active weapon = the equipped weapon slot. Sound, damage, and flame all read it.
- Remove the QA-selection weapon/flame path; QA "use" = consumables only.
- E1 acceptance by `weapon_stats.is_gun` (not the `item_category` string), WITH a "can't put that
  there" message instead of a silent reject.
- Implement the three move-to-equip interactions: triple-click QA slot#, ESC + triple-click, drag.

**Phase 3 — Polish:** upload real egg/weapon sprites; remove the egg pickup cooldown if undesired;
verify Vault parity through the unified path.

---

## 6. Key files

- `src/hooks/useUserData.ts` — inventory/QA fetch + realtime (add equip here).
- `src/components/fortress/EquipSlots.tsx` — the fragmented Equip owner (move to shared state).
- `src/components/fortress/FortressHUD.tsx` — slot rendering, hotbar, `inventoryItemsMap`, slot clicks.
- `src/components/fortress/Fortress.tsx` — calls `useUserData`, threads props to FortressHUD.
- `src/features/inventory-system/` — `SlotGrid`, `ItemTileVisual`, `useCursorStack`, `slotClick`,
  `types.ts` (add `equip` region here).
- `src/config/activeWeapon.ts` — `setActiveWeapon` / `getActiveWeapon` (the single resolver target).
- DB: `supabase/migrations/20260601180000_user_slots_unified.sql` (transfer_slot),
  `20260617000000_equip_region.sql` (equip_transfer).
