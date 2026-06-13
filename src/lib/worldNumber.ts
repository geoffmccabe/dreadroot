// world_number migration helper (Phase 1B).
//
// placed_blocks is moving its world reference off the 36-char `world_id` UUID onto a compact
// integer `world_number` (saves ~31 chars/row over the wire + matching RAM). Every direct
// placed_blocks SELECT that used `.eq('world_id', worldId)` must filter on `world_number`
// instead so it stays correct after `world_id` is eventually dropped.
//
// worldId→world_number is 1:1 and tiny (a handful of worlds ever), so we resolve it once per
// world and cache it process-wide — no per-fetch lookup cost. Returns null only if the column
// or row isn't populated yet (e.g. mid-migration), in which case callers fall back to the
// still-present `world_id` filter, so this is safe to deploy before the column is dropped.

import type { SupabaseClient } from '@supabase/supabase-js';
import type { Database } from '@/integrations/supabase/types';

type Sb = SupabaseClient<Database>;

const cache = new Map<string, number>();

export async function resolveWorldNumber(_sb: Sb, _worldId: string): Promise<number | null> {
  // REVERTED: always return null so every caller falls back to the original `world_id` filter.
  // The world_number migration is being rolled back to the known-good world_id system.
  return null;
}
