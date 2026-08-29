// What counts as a throwable, in one place.
//
// A throwable is something G throws: a grenade (explodes) or a shpider egg
// (hatches a friendly pet). It is NOT a weapon and never occupies a hand — it
// lives in the quick bar, where grenades stack, and the throw consumes one
// unit from that slot.
//
// Identification is CATEGORY-first (items.item_category = 'explosive') with a
// key-pattern fallback for the legacy `grenade` row, which is still filed
// under 'weapon'. Matching on category rather than on how a key is spelled is
// what makes a newly-added grenade work with no code change — the old
// `key = 'grenade' OR key LIKE 'grenade_t%'` filter silently ignored
// Tacticians Grenade, so it could never be thrown or equipped.
//
// The same rule is implemented server-side as is_throwable_item(uuid); the two
// must agree, because the DB uses it to decide what may stack in the quick bar.
import { useSyncExternalStore } from 'react';
import { supabase } from '@/integrations/supabase/client';
import { getItemSpriteUrl } from '@/lib/itemSprite';

export type ThrowableKind = 'grenade' | 'egg';

export interface ThrowableDef {
  itemId: string;
  kind: ThrowableKind;
  tier: number;
  name: string;
  spriteUrl: string | null;
}

type ThrowableMap = ReadonlyMap<string, ThrowableDef>;

/** One row as list_throwable_items() returns it. */
interface ThrowableRow {
  id: string;
  key: string | null;
  name: string;
  kind: string;
  tier: number | null;
  item_number: number | null;
  texture_url: string | null;
}

const EMPTY: ThrowableMap = new Map();
let defs: ThrowableMap = EMPTY;
let loading: Promise<void> | null = null;
const subs = new Set<() => void>();

function publish(next: ThrowableMap): void {
  defs = next;
  subs.forEach((f) => f());
}

/** Every known throwable, keyed by items.id. Empty until loadThrowables resolves. */
export function getThrowables(): ThrowableMap {
  return defs;
}

/** The throwable def for an item id, or null if it isn't one. */
export function getThrowable(itemId: string | null | undefined): ThrowableDef | null {
  return itemId ? defs.get(itemId) ?? null : null;
}

/** True if this item is thrown with G (and therefore can't be held in a hand). */
export function isThrowable(itemId: string | null | undefined): boolean {
  return !!itemId && defs.has(itemId);
}

/**
 * Fetch the throwable catalogue once. Safe to call from several places — the
 * in-flight promise is shared. Pass force to refetch after a forge creates a
 * new tier.
 */
export function loadThrowables(force = false): Promise<void> {
  if (loading && !force) return loading;
  loading = (async () => {
    const { data, error } = await (supabase as unknown as {
      rpc: (fn: string) => Promise<{ data: ThrowableRow[] | null; error: unknown }>;
    }).rpc('list_throwable_items');
    if (error || !data) {
      // Leave whatever we already had rather than blanking the catalogue — an
      // empty map would silently disable throwing until the next refetch.
      console.error('[throwables] load failed:', error);
      return;
    }
    const next = new Map<string, ThrowableDef>();
    for (const row of data) {
      next.set(row.id, {
        itemId: row.id,
        kind: row.kind === 'egg' ? 'egg' : 'grenade',
        tier: row.tier ?? 1,
        name: row.name,
        spriteUrl: getItemSpriteUrl({ item_number: row.item_number, texture_url: row.texture_url }),
      });
    }
    publish(next);
  })();
  return loading;
}

/** React view of the catalogue. Re-renders when it loads or is refetched. */
export function useThrowables(): ThrowableMap {
  return useSyncExternalStore(
    (cb) => { subs.add(cb); return () => { subs.delete(cb); }; },
    getThrowables,
    getThrowables,
  );
}
