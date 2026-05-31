// Canonical sprite-URL resolver. Use this everywhere instead of
// inlining the resolution logic — that way an updated sprite (e.g.
// the artist drops a new 189.webp) propagates with a single APP_VERSION
// bump, defeating browser + Cloudflare cache without manual reloads.
//
// Resolution priority:
//   1. items.texture_url — custom uploaded sprite (always wins; this
//      is itself a hashed/signed URL from Supabase storage and is
//      already cache-stable).
//   2. items.item_number → /item-sprites/<n>.webp — the canonical
//      cross-game sprite library. Cache-busted with ?v=APP_VERSION.
//   3. null → caller renders a placeholder.

import { APP_VERSION } from '@/version';

const SPRITE_CACHE_BUST = `?v=${APP_VERSION}`;

export interface SpriteDef {
  texture_url?: string | null;
  textureUrl?: string | null;
  item_number?: number | null;
  itemNumber?: number | null;
}

export function getItemSpriteUrl(def: SpriteDef | undefined | null): string | null {
  if (!def) return null;
  const tex = def.texture_url ?? def.textureUrl ?? null;
  if (tex) return tex;
  const n = def.item_number ?? def.itemNumber ?? null;
  if (n != null && n >= 0 && n <= 228) {
    return `/item-sprites/${n}.webp${SPRITE_CACHE_BUST}`;
  }
  return null;
}
