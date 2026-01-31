/**
 * useDropTableCache - Fetches and caches drop table entries on mount.
 * Provides a rollDrop() function for weighted random item selection.
 */

import { useState, useEffect, useCallback, useRef } from 'react';
import { supabase } from '@/integrations/supabase/client';

interface DropTableEntry {
  item_number: number;
  item_name: string;
  weight: number;
}

interface DroppedItemInfo {
  itemNumber: number;
  itemName: string;
  itemId: string;
}

interface DropTableCache {
  /** Entries keyed by drop table code */
  tables: Map<string, DropTableEntry[]>;
  /** item_number → item UUID */
  itemMap: Map<number, string>;
}

export function useDropTableCache() {
  const [isLoaded, setIsLoaded] = useState(false);
  const cacheRef = useRef<DropTableCache>({ tables: new Map(), itemMap: new Map() });

  useEffect(() => {
    const load = async () => {
      // Fetch all drop tables
      const { data: tables } = await supabase
        .from('drop_tables')
        .select('id, code');

      if (!tables) return;

      const codeToId = new Map<string, string>();
      for (const t of tables) {
        codeToId.set(t.id, t.code);
      }

      // Fetch all entries
      const { data: entries } = await supabase
        .from('drop_table_entries')
        .select('drop_table_id, item_number, item_name, weight');

      if (!entries) return;

      // Group entries by table code
      const tableMap = new Map<string, DropTableEntry[]>();
      const itemNumbers = new Set<number>();

      for (const e of entries) {
        const code = codeToId.get(e.drop_table_id);
        if (!code) continue;

        if (!tableMap.has(code)) tableMap.set(code, []);
        tableMap.get(code)!.push({
          item_number: e.item_number,
          item_name: e.item_name,
          weight: Number(e.weight),
        });

        if (e.item_number >= 0) {
          itemNumbers.add(e.item_number);
        }
      }

      // Fetch item UUIDs for all referenced item_numbers
      const itemMap = new Map<number, string>();
      if (itemNumbers.size > 0) {
        const { data: items } = await supabase
          .from('items')
          .select('id, item_number')
          .in('item_number', Array.from(itemNumbers));

        if (items) {
          for (const item of items) {
            if (item.item_number != null) {
              itemMap.set(item.item_number, item.id);
            }
          }
        }
      }

      cacheRef.current = { tables: tableMap, itemMap };
      setIsLoaded(true);
      console.log(`[DropTableCache] Loaded ${tableMap.size} tables, ${itemMap.size} items`);
    };

    load();
  }, []);

  const rollDrop = useCallback((dropRate: number | null, dropTableCode: string | null): DroppedItemInfo | null => {
    if (!dropRate || !dropTableCode || dropRate <= 0) {
      console.log(`[Loot] rollDrop SKIP: dropRate=${dropRate}, dropTableCode=${dropTableCode}`);
      return null;
    }

    // First roll: does anything drop at all?
    const rateRoll = Math.random() * 100;
    if (rateRoll >= dropRate) {
      console.log(`[Loot] Rate roll MISS: rolled ${rateRoll.toFixed(1)} >= ${dropRate}%`);
      return null;
    }
    console.log(`[Loot] Rate roll HIT: rolled ${rateRoll.toFixed(1)} < ${dropRate}%`);

    const cache = cacheRef.current;
    const entries = cache.tables.get(dropTableCode);
    if (!entries || entries.length === 0) {
      console.log(`[Loot] No entries for table "${dropTableCode}" (cache has: ${Array.from(cache.tables.keys()).join(', ')})`);
      return null;
    }

    // Second roll: weighted random selection
    let totalWeight = 0;
    for (const e of entries) {
      totalWeight += e.weight;
    }

    if (totalWeight <= 0) {
      console.log(`[Loot] totalWeight is 0 for table "${dropTableCode}"`);
      return null;
    }

    let roll = Math.random() * totalWeight;
    let winner: DropTableEntry | null = null;

    for (const e of entries) {
      roll -= e.weight;
      if (roll <= 0) {
        winner = e;
        break;
      }
    }

    if (!winner) {
      console.log(`[Loot] Weighted roll found no winner (totalWeight=${totalWeight})`);
      return null;
    }

    // "Nothing" entry (item_number = -1) means no drop
    if (winner.item_number === -1) {
      console.log(`[Loot] Rolled "nothing" entry`);
      return null;
    }

    // Look up the item UUID
    const itemId = cache.itemMap.get(winner.item_number);
    if (!itemId) {
      console.log(`[Loot] No itemId for item_number ${winner.item_number} "${winner.item_name}" (itemMap has ${cache.itemMap.size} entries)`);
      return null;
    }

    console.log(`[Loot] DROP: ${winner.item_name} (#${winner.item_number}) uuid=${itemId}`);
    return {
      itemNumber: winner.item_number,
      itemName: winner.item_name,
      itemId,
    };
  }, []);

  return { rollDrop, isLoaded };
}
