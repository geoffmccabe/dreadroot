# Coin Drops — change log (for the DreadRoot port)

A modular, per-monster floating-coin drop system. The DB is shared between Pinkland and
DreadRoot, so **migrations apply once** (both games immediately have the schema). The
**code** lives in one module (`src/features/coinDrops/`) plus a few one-line hooks — copy
those to DreadRoot to port it. Every change is logged here.

## Design (locked)
- Drop config is a JSONB **list** per monster tier: `coin_drops: [{ coin, chance, min, max, source }]`.
  A monster can have many entries → multiple coin types at once, each rolled independently.
  `coin` = a `token_themes.id` (any registered coin type: crypto or points). `source` =
  `game_pool` for now (minted on pickup); per-user wallet later.
- On kill → `roll_monster_coin_drop` rolls each entry, inserts `world_coin_drops` rows
  (floating instances). **No credit yet.**
- Client spawns glowing floating sprites (reuses the waterfall coin look, per-coin image).
  Sprites bob/glow, then **auto-magnet** to the eligible player and collect on contact →
  `pickup_coin_drop` credits the full amount to `user_token_balances`.
- **Float count (unit normalization):** `clamp(round(amount / max * 10), 1, 10)`. Each
  sprite represents `amount / count` coins; the credited total is always `amount`.
- **Ownership window:** killer-only for 60s, public after (enforced in `pickup_coin_drop`).

## Migrations (shared DB — run once; already apply to BOTH games)
- `supabase/migrations/20260610120000_coin_drops.sql`
  - adds `coin_drops jsonb` to every `<enemy>_definitions` table (now superseded/unused — see below)
  - creates `world_coin_drops`
  - `roll_monster_coin_drop(...)` + `pickup_coin_drop(p_drop_id)` (credits on pickup, 60s window)
- `supabase/migrations/20260610140000_game_scope_coin_drops.sql`
  - **`monster_coin_drops(game, enemy_base, tier, coin_drops)`** — the GAME-SCOPED config (monster
    def tables are shared, so config can't live on them). Admin-write RLS via `has_role`.
  - migrates the Pinkland Shombie config off the shared def table
  - re-points `roll_monster_coin_drop` to read `monster_coin_drops WHERE game=p_game` (no more
    dynamic def-table EXECUTE). The old `<enemy>_definitions.coin_drops` column is now dead.

## New code files (copy these to DreadRoot)
- `src/features/coinDrops/types.ts` — config + instance types
- `src/features/coinDrops/config.ts` — default behavior knobs + normalization helper
- (later) the floating-coin renderer/manager, pickup hook, admin editor

## Edits / hooks (apply the same in DreadRoot)
- `src/services/worldStore.ts` — `rollMonsterCoinDrop` + `pickupCoinDrop` facade methods
- (later) one line in each enemy kill handler in `src/components/fortress/Fortress.tsx`
- (later) a `<CoinDropsEditor>` section in each enemy design panel

## Slice status
- [x] Slice 1 — DB plumbing + module scaffolding + worldStore facade
- [ ] Slice 2 — admin config UI (Coin Drops table in the enemy editor)
- [ ] Slice 3 — floating coin module (spawn + glow + bob + magnet + auto-collect) + kill hooks
- [ ] Slice 4 — ownership window + persistence + multiplayer visibility
- [ ] Slice 5 — polish + expose behavior knobs
