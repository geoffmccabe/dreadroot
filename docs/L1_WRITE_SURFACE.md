# L1 Write Surface — Track 1A audit (frozen 2026-Jun-06)

Canonical inventory of every way the **client** writes to Supabase. This is the spec
for Track 1B (build validated RPCs) and 1D (RLS lockdown). A write missing from this
list is a future cheat hole — keep it current as code changes.

Method: all `src/**/*.ts(x)` importing `supabase`. Look-alike `.insert/.update/.delete/.set`
on JS Maps/Sets, IndexedDB (`blockDB`), Three.js, spatial grids, and web workers were
excluded. Stale files (`*old*`, `*orig*`) excluded.

Risk categories: **RESOURCE-FRAUD** (assets/currency/drops/kills), **WORLD-VANDALISM**
(blocks/trees/world state), **OWNERSHIP/TRADE** (marketplace/transfers), **PROGRESSION**
(combat stats/HP/points), **COSMETIC/CONFIG**, **ADMIN-CONTENT** (catalog authoring).

Counts: ~80 distinct mutating operations / ~95 call-sites. Direct table writes: 62 numbered
ops (~25 gameplay-triggerable). Already-RPC: ~40 functions. Storage: 8 buckets (2 gameplay).

---

## CONVERT-FIRST shortlist (Track 1B priority — gameplay direct-writes that fabricate assets or vandalize the shared world)

| Direct write to replace | Sites | Proposed RPC |
|---|---|---|
| user_combat_stats kill bumps (6 enemies + hook) | Fortress.tsx:2000–2247; useUserCombatStats.ts:257,269 | `record_kill(enemy_type, client_request_id)` — server validates + caps + dedups |
| world_eggs drop insert (kill + pet death) | Fortress.tsx:2133, 2172 | server rolls the drop inside a kill RPC; client never inserts eggs |
| user_token_balances update | useUserData.ts:582 | route only through `grant_currency`/`ensure_token_balance`; remove direct write |
| user_profiles HP/death/respawn | usePlayerHealth.ts:148,253,509,542,578,610 | `apply_damage` / `set_player_dead` / `respawn_player` (server-authoritative HP) |
| placed_blocks upsert (place) | usePlacedBlocksWithCache.ts:703 | `place_block(world_id,x,y,z,block_id,req_id)` — ownership + bounds + dup check |
| placed_blocks delete (mine ×2) | Fortress.tsx:1182; usePlacedBlocksWithCache.ts:815 | `mine_block(block_id, req_id)` — owns inventory grant + overlap enqueue |
| tree_fruits spawn/pickup + user_fruits grant | useFruitSpawning.ts:204; useFruitPickup.ts:165,191,237,241 | `spawn_tree_fruit` (server rolls) + `harvest_fruit(fruit_id, req_id)` |
| tree_blueprints insert + planted_trees/blueprint delete | useTreeData.ts:102; useLocalGrowth.ts:177,180 | move blueprint gen into `plant_seed_with_blueprint`; chop via existing `delete_tree_with_blocks` |
| world_ponds insert | pondGenerator.ts:160 | `generate_world_ponds(world_id)` server-side, owner-checked |

## ⚠ The deeper finding — existing grant_* RPCs are client-trusted "give me X" endpoints

The Phase-D inventory/currency RPCs (`grant_inventory_row`, `grant_currency`, `grant_points`,
`forge_items`, `spawn_world_drop`) are SECURITY DEFINER **with** `auth.uid()` + `client_request_id`
replay protection — they validate **identity and magnitude, but not legitimacy**. The client picks
the item_id/amount and calls "grant me this." Real fix: rewards must be a **server-side consequence
of a validated action** (kill/harvest/forge), so `grant_*` become INTERNAL-only (called by other
RPCs), not directly client-callable. Track 1B must close this, not just wrap more direct writes.

## Already-RPC functions to re-check for hardening in 1B
Confirmed hardened (auth + replay): grant_inventory_row, spawn_world_drop, pickup_world_drop,
grant_currency, grant_points; admin_grant_inventory_row is admin-role-gated.
**Verify replay + world_id bounds on:** tree-growth family (`trigger_tree_growth`, `process_tree_growth`,
`sync_missing_tree_blocks`, `sync_all_missing_tree_blocks`), `set_equipped_slot`/`clear_equipped_slot(s)`,
and the `vault_*` family.

---

## A. DIRECT TABLE WRITES (no RPC)

### Gameplay-triggerable (the cheat surface — convert in 1B)
- A1–A6 user_combat_stats kill bumps — Fortress.tsx:2000,2008,2040,2048,2080,2088,2110,2115,2205,2210,2239,2247 — PROGRESSION
- A14 user_combat_stats (hook) — useUserCombatStats.ts:257,269 — PROGRESSION
- A7 world_eggs insert (1% kill drop) — Fortress.tsx:2133 — RESOURCE-FRAUD
- A8 world_eggs insert (pet death) — Fortress.tsx:2172 — RESOURCE-FRAUD
- A15 user_token_balances update — useUserData.ts:582 — RESOURCE-FRAUD
- A16 user_profiles updates — useUserData.ts:185,247,614,644,1213,1226 — PROGRESSION/COSMETIC (column-dependent)
- A17 user_profiles HP/death/respawn — usePlayerHealth.ts:148,253,509,542,578,610 — PROGRESSION (HP cheat)
- A18 tree_fruits spawn insert — useFruitSpawning.ts:204 — RESOURCE-FRAUD
- A19 tree_fruits pickup delete — useFruitPickup.ts:165 — RESOURCE-FRAUD
- A20 tree_fruits re-insert/delete (diamond) — useFruitPickup.ts:237,241 — RESOURCE-FRAUD
- A21 user_fruits insert (harvest reward) — useFruitPickup.ts:191 — RESOURCE-FRAUD
- A10 placed_blocks delete — Fortress.tsx:1182 — WORLD-VANDALISM
- A11 placed_blocks upsert (place) — usePlacedBlocksWithCache.ts:703 — WORLD-VANDALISM
- A12 placed_blocks delete (mine) — usePlacedBlocksWithCache.ts:815 — WORLD-VANDALISM
- A13 overlap_check_queue enqueue — usePlacedBlocksWithCache.ts:841 — WORLD-VANDALISM (low)
- A22 tree_blueprints insert — useTreeData.ts:102 — WORLD-VANDALISM
- A23 tree_blueprints delete (chop) — useLocalGrowth.ts:177 — WORLD-VANDALISM
- A24 planted_trees delete (chop) — useLocalGrowth.ts:180 — WORLD-VANDALISM
- A25 world_ponds insert — pondGenerator.ts:160 — WORLD-VANDALISM (owner/system)
- A9 worlds view_settings save — Fortress.tsx:309 — COSMETIC (world owner)

### Owner-driven (keep client, ensure RLS owner = auth.uid())
- A26 marketplace_listings edit — useListings.ts:87 — OWNERSHIP (RLS seller_id)
- A27/A28 marketplace_stores create/update — useStore.ts:112,164 — OWNERSHIP
- A29 marketplace_watchlist add/remove — useWatchlist.ts:107,123 — OWNERSHIP (low)
- A30/A31/A32 worlds create/update/delete — useWorlds.ts:150,234,251,258,280 — CONFIG/owner
- A33 ambient_music_tracks add/remove — useWorlds.ts:313,331 — CONFIG/owner

### Admin-only content authoring (need solid 'admin' RLS; not a player-cheat surface)
- A34–A36 billboards (screen_urls/media_grid_items/billboard_walls) — useBillboardData.ts:94,108,140
- A37 game_sounds — useGameSounds.ts:163,189,212
- A38 pathfinding_configs — usePathfindingConfigs.ts:85,115,143
- A39 ktx2 backfill — KtxBackfillButton.tsx:114
- A40/A41 items — AllItemsPanel.tsx:345,473,496,541 ; A50 ItemsTab.tsx:591
- A42/A43 blocks — BlocksList.tsx:178,191,283,318,344 ; GifMigration.tsx:135,141
- A44 shpider_definitions — GifMigration.tsx:140
- A45/A46/A54 token_themes — SolanaPanel.tsx:169,213,240 ; WaterfallControls.tsx:274 ; CoinThemeContext.tsx:169
- A47 user_token_balances insert (waterfall) — WaterfallControls.tsx:316 — RESOURCE-FRAUD (admin-gated)
- A48 user_profiles (admin edit) — UsersList.tsx:82
- A49 user_roles grant/revoke — UsersList.tsx:111,118 — ⚠ PRIVILEGE ESCALATION; verify admin RLS
- A51 drop_tables/drop_table_entries/items — DropTablesPanel.tsx:284,304,327,344,352,397,419
- A52 bullet_definitions — BulletDefinitionsContext.tsx:154
- A53 app_settings — CoinThemeContext.tsx:131
- A55 flamethrower_tiers — FlamethrowerTiersContext.tsx:140
- A56 enemy_sound_settings — Shnake/Shombie/Shwarm/Walapa DesignPanels
- A57–A62 *_definitions (shnake/shombie/shtickman/shwarm/shpider/seed) — respective DesignPanels

## B. MUTATING RPCs (already validated; mostly in worldStore.ts)
Inventory/slot: grant_inventory_row, consume_inventory_target, delete_inventory_row, transfer_slot,
grant_slot, consume_slot, swap_slot, eject_slot_to_world, transfer_inv_to_qs, transfer_qs_to_inv,
transfer_qs_to_vault, transfer_vault_to_qs, transfer_inventory_to_vault, transfer_vault_to_inventory,
transfer_vault_to_vault, forge_items. Vault: vault_set_slot, vault_remove_from_slot, vault_replace_page,
vault_ensure_config. Equip: set_equipped_slot, clear_equipped_slot, clear_equipped_slots. Currency:
buy_block, grant_currency, grant_points, ensure_token_balance. Drops/eggs: spawn_world_drop,
pickup_world_drop, pickup_egg. Admin: admin_grant_inventory_row. Trees: plant_seed_with_blueprint,
delete_tree_with_blocks, trigger_tree_growth, process_tree_growth, sync_missing_tree_blocks,
sync_all_missing_tree_blocks. Fruits: forge_fruits. Marketplace: marketplace_purchase,
marketplace_create_listing, marketplace_cancel_listing. Textures: admin_set_item_texture,
update_fungal_tree_textures.
Read-only RPCs (ignore): get_leaderboard, get_kill_leaderboard, get_divi_balance, fetch_chunks_batch.

## C. STORAGE WRITES (.upload, upsert)
Buckets: block-textures (mostly admin; **UserPanel avatar + MyStoreTab image = GAMEPLAY** — need per-user
path/size RLS), coin-images (admin), world-textures (admin/owner), ambient-music (admin/owner),
billboard-media (admin), game-sounds (admin), ktx2-textures (system). No remove/move/copy.

---

## Track 1 next steps
- 1B: build the convert-first RPCs above; make `grant_*` internal-only.
- 1C: migrate client to call them via `worldStore` (never raw `supabase.from()`).
- 1D: RLS reject all direct authenticated writes once each op has an RPC equivalent.
- 1E: grep hardcoded world ids; verify multi-world.
- Anti-cheat (Track 6A/6B) folds into each RPC body: rate limit + invariant checks.
