// Player catalogue: maps a compact integer player_number ↔ the user's UUID.
//
// The chunk-fetch wire format carries a small player_number in the user slot instead of the
// 36-char user UUID (big per-block saving). The client loads the catalogue once and reverse-maps
// the number back to the UUID, so internally `block.user_id` stays a UUID and nothing downstream
// (ownership checks, inspector, etc.) has to change. The slot may also still be a UUID (legacy /
// uncatalogued users), in which case it passes through unchanged — so the client reads both forms.

import type { SupabaseClient } from '@supabase/supabase-js';
import type { Database } from '@/integrations/supabase/types';

type Sb = SupabaseClient<Database>;

const numberToUserId = new Map<number, string>();

export async function loadPlayerCatalogue(sb: Sb): Promise<void> {
  try {
    const { data } = await (sb.from('player_catalogue') as any).select('player_number, user_id');
    if (Array.isArray(data)) {
      numberToUserId.clear();
      for (const r of data) numberToUserId.set(r.player_number, r.user_id);
    }
  } catch { /* table not present yet — the user slot will simply pass through as a UUID */ }
}

// Resolve a wire user-slot value to a user_id UUID. Numbers are reverse-mapped via the catalogue;
// strings (UUIDs) pass through unchanged.
export function resolveUserId(v: any): string {
  if (typeof v === 'number') return numberToUserId.get(v) ?? '';
  return v ?? '';
}
