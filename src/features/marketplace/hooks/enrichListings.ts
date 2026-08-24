/**
 * Attach the definition rows a listing needs in order to show a picture and a
 * name.
 *
 * A marketplace_listings row only records WHAT was listed (a block key, a seed
 * definition id, an item id) — never how to draw it. Each tab was solving that
 * separately, and the Watchlist was not solving it at all, so watched listings
 * rendered with no image and no name whatever the category. Items were missing
 * everywhere: nothing fetched their definition, so every weapon drew a plain
 * gradient labelled "Item".
 *
 * One helper, used by every tab, so a listing looks the same wherever it
 * appears.
 */
import { supabase } from '@/integrations/supabase/client';
import type { MarketplaceListing } from '../types';

export async function enrichListings(listings: MarketplaceListing[]): Promise<MarketplaceListing[]> {
  if (listings.length === 0) return listings;
  let out = listings;

  // Blocks: keyed by item_type, no foreign key to follow.
  const blockKeys = [...new Set(
    out.filter(l => l.item_category === 'block' && l.item_type && !l.block_definition)
       .map(l => l.item_type!),
  )];
  if (blockKeys.length > 0) {
    const { data } = await supabase
      .from('blocks').select('key, name, category, rarity, texture_url').in('key', blockKeys);
    if (data) {
      const m = new Map(data.map(b => [b.key, b]));
      out = out.map(l => (l.item_category === 'block' && l.item_type && m.has(l.item_type)
        ? { ...l, block_definition: m.get(l.item_type) } : l));
    }
  }

  // Seeds: only when the caller did not already join them.
  const seedIds = [...new Set(
    out.filter(l => l.item_category === 'seed' && l.seed_definition_id && !l.seed_definition)
       .map(l => l.seed_definition_id!),
  )];
  if (seedIds.length > 0) {
    const { data } = await supabase
      .from('seed_definitions').select('id, name, tier, rarity, trunk_texture_url').in('id', seedIds);
    if (data) {
      const m = new Map(data.map(x => [x.id, x]));
      out = out.map(l => (l.item_category === 'seed' && l.seed_definition_id && m.has(l.seed_definition_id)
        ? { ...l, seed_definition: m.get(l.seed_definition_id) } : l));
    }
  }

  // Items: item_number is what resolves the shared sprite library, and it is
  // the only image source for the ~250 of 283 items with no texture_url.
  const itemIds = [...new Set(
    out.filter(l => l.item_category === 'item' && l.item_id && !l.item_definition)
       .map(l => l.item_id!),
  )];
  if (itemIds.length > 0) {
    const { data } = await supabase
      .from('items').select('id, name, rarity, tier, item_number, texture_url').in('id', itemIds);
    if (data) {
      const m = new Map(data.map(x => [x.id, x]));
      out = out.map(l => (l.item_category === 'item' && l.item_id && m.has(l.item_id)
        ? { ...l, item_definition: m.get(l.item_id) } : l));
    }
  }

  return out;
}
