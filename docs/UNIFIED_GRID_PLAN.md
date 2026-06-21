# Unified Inventory Grid — agreed model (Geoff, 2026-Jun-21)

## The model (one grid, rules for moving between coordinates)

ALL item storage is ONE grid. Every cell has a `(row, col)` address. Internally each cell
knows its DB home (`region` + `slot`). A MOVE = pick up cell A, drop on cell B; ONE function
computes the DB change, ONE rule-check per destination decides if B accepts it. Equip is NOT
a special component with its own move path — it is just row 1 of the same grid.

### Row bands

| Rows   | Region      | Size        | Cols / notes                                              |
|--------|-------------|-------------|-----------------------------------------------------------|
| 1      | Equip       | 5           | col1=Left hand, col2=Right hand, col3=Armor, col4=Boots, col5=Special |
| 2      | QA          | 6           | cols 1–6                                                  |
| 3–5    | Inventory   | 18 (3×6)    | cols 1–6                                                  |
| 6+     | Vault       | flat/scroll | ONE flat sequence of slots. Pages are UI-ONLY (Geoff). |

Equip DB slot numbers stay 1=L, 5=R, 2=Armor, 3=Boots, 4=Special (that's the DB; the grid
maps visual columns → those slot numbers).

### Vault is flat (pages are UI only)

Per Geoff: vault is ONE flat list of slots; P1/P2/P3 are just a display window, NOT data
storage. Storage nuance: today each vault row also carries a `page` column, but that page is
exactly `floor(globalSlot / pageSize)` — pure derivation. So we treat vault as a single flat
index `0..N`; `page = idx / pageSize`, `withinPageSlot = idx % pageSize` is an exact, lossless
conversion used only for the RPC / optional page display. **No data migration required.** The
UI may keep page tabs OR switch to scroll — that's a display choice, independent of the model.

## Move rules (the ONLY special logic)

- Drop into a **hand** cell (row1 col1/col2): item must be a weapon / grenade / glove. A
  **rifle** (two-handed) fills BOTH hand cells; needs both hands free.
- Drop into **Armor / Boots / Special** (row1 col3/4/5): item category must match.
- Drop into **QA / Inventory / Vault**: anything.
- Any other move: free move (dest empty) or swap (dest occupied).
- A plain CLICK never moves anything (drag-only). QA single-click = use the slot.
  Triple-click an inventory item / triple-tap a QA# = quick-equip to the right hand cell.

## Game-state effects (unchanged, just read the cells)

Left-hand cell → active weapon + rifle/pistol kind. Right-hand cell → second weapon. A glove
in either hand → flame glove (prefer right). These are EFFECTS of what sits in row 1; they do
not depend on how the item got there.

## Build stages (deliver working increments; commit each)

1. **Coordinate map** — one pure module: `(row,col) ↔ {region, slot}`. No behavior change.
2. **One move path** — equip drops route through the SAME reducer as INV/QA/Vault; the equip
   rules above become ONE rule-check function. Delete EquipSlots' parallel
   `resolveDrop`/`handlePointerUp`/`startEquipDrag`. THIS kills the bug class
   (drag-out, triple-click, stuck cursor, "is not a function").
3. **Grenades** — a grenade in a hand is a NORMAL item in that cell; G arms/throws whatever
   grenade is actually in a hand. Retire the `handGrenade` side store (armed = a tiny per-hand
   flag, not a parallel item store).
4. **Vault as flat band** — treat vault as one flat index in the grid (page derived for the
   RPC). Optionally swap page tabs → scroll. UI-only + lossless derivation → no data
   migration; do LAST.

## Risk notes

- Shared Supabase: `equip_transfer` / `transfer_slot` RPCs are server-side and shared with
  Pinkland. Stages 1–3 are CLIENT-only (no RPC change) — safe. Stage 4 (vault) may touch the
  vault data layer; gate carefully.
- Co-build: keep edits in `EquipSlots.tsx` + `features/inventory-system/*`; commit every stage.
</content>
