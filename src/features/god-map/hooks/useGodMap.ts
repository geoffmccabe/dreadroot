// God Map data layer. One hook owns every query the map needs:
//   - planted_trees (with owner usernames via user_profiles join)
//   - world_no_plant_chunks (the painted set)
//   - chunk density (placed_blocks counted by chunk_x, chunk_z)
//   - bounds (min/max chunk_x/chunk_z across all placed_blocks + planted_trees)
// Plus a realtime subscription on world_no_plant_chunks so paint
// updates appear live across open maps.

import { useCallback, useEffect, useRef, useState } from 'react';
import { supabase } from '@/integrations/supabase/client';

export interface MapTree {
  id: string;
  baseX: number;
  baseY: number;
  baseZ: number;
  tier: number;
  treeType: 'original' | 'fungal' | 'wide';
  blockCount: number;
  ownerUserId: string;
  ownerDisplayName: string | null;
}

export interface MapBounds {
  /** Inclusive chunk range — the painted map extent BEFORE the water border. */
  minChunkX: number;
  maxChunkX: number;
  minChunkZ: number;
  maxChunkZ: number;
}

interface UseGodMapOptions {
  worldId: string | null;
  enabled: boolean;
}

export interface UseGodMapResult {
  trees: MapTree[];
  noPlant: Set<string>; // key: "cx,cz"
  density: Map<string, number>; // key: "cx,cz" → count
  bounds: MapBounds | null;
  loading: boolean;
  /** Mutate the painted set locally for instant UI; the DB write is fire-and-forget. */
  paintChunks: (chunks: Array<{ cx: number; cz: number }>) => Promise<void>;
  eraseChunks: (chunks: Array<{ cx: number; cz: number }>) => Promise<void>;
}

const chunkKey = (cx: number, cz: number) => `${cx},${cz}`;

export function useGodMap({ worldId, enabled }: UseGodMapOptions): UseGodMapResult {
  const [trees, setTrees] = useState<MapTree[]>([]);
  const [noPlant, setNoPlant] = useState<Set<string>>(new Set());
  const [density, setDensity] = useState<Map<string, number>>(new Map());
  const [bounds, setBounds] = useState<MapBounds | null>(null);
  const [loading, setLoading] = useState(false);
  const noPlantRef = useRef<Set<string>>(new Set());
  useEffect(() => { noPlantRef.current = noPlant; }, [noPlant]);

  // Initial fetch — runs once when the panel opens.
  useEffect(() => {
    if (!enabled || !worldId) return;
    let cancelled = false;
    setLoading(true);

    (async () => {
      // Parallel fetches keep the panel snappy.
      const [treesRes, noPlantRes, blocksRes] = await Promise.all([
        // planted_trees + seed_definitions for tier/tree_type + user_profiles for owner name
        supabase
          .from('planted_trees')
          .select(`
            id, base_x, base_y, base_z, current_block_count, planted_by,
            seed_definitions ( tier, tree_type )
          `)
          .eq('world_id', worldId),
        supabase
          .from('world_no_plant_chunks' as any)
          .select('chunk_x, chunk_z')
          .eq('world_id', worldId),
        // Density: count placed_blocks per chunk. Bounded query — anything above
        // 200k blocks per world would be unusual; if we hit it we'll page.
        supabase
          .from('placed_blocks')
          .select('chunk_x, chunk_z')
          .eq('world_id', worldId)
          .limit(500000),
      ]);

      if (cancelled) return;

      // Trees: collect, then fetch missing display_names in one round-trip.
      const treeRows = treesRes.data ?? [];
      const ownerIds = Array.from(new Set(
        treeRows.map((r: any) => r.planted_by).filter(Boolean),
      ));
      let nameByUserId = new Map<string, string | null>();
      if (ownerIds.length > 0) {
        const { data: profiles } = await supabase
          .from('user_profiles')
          .select('user_id, display_name')
          .in('user_id', ownerIds);
        for (const p of (profiles ?? [])) {
          nameByUserId.set((p as any).user_id, (p as any).display_name);
        }
      }
      if (cancelled) return;

      const mappedTrees: MapTree[] = treeRows.map((r: any) => ({
        id: r.id,
        baseX: r.base_x,
        baseY: r.base_y,
        baseZ: r.base_z,
        tier: r.seed_definitions?.tier ?? 1,
        treeType: (r.seed_definitions?.tree_type ?? 'original') as MapTree['treeType'],
        blockCount: r.current_block_count ?? 0,
        ownerUserId: r.planted_by,
        ownerDisplayName: nameByUserId.get(r.planted_by) ?? null,
      }));
      setTrees(mappedTrees);

      const np = new Set<string>();
      for (const row of (noPlantRes.data ?? []) as any[]) {
        np.add(chunkKey(row.chunk_x, row.chunk_z));
      }
      setNoPlant(np);

      // Density: count rows per chunk.
      const dens = new Map<string, number>();
      let minCx = Infinity, maxCx = -Infinity, minCz = Infinity, maxCz = -Infinity;
      for (const row of (blocksRes.data ?? []) as any[]) {
        const k = chunkKey(row.chunk_x, row.chunk_z);
        dens.set(k, (dens.get(k) ?? 0) + 1);
        if (row.chunk_x < minCx) minCx = row.chunk_x;
        if (row.chunk_x > maxCx) maxCx = row.chunk_x;
        if (row.chunk_z < minCz) minCz = row.chunk_z;
        if (row.chunk_z > maxCz) maxCz = row.chunk_z;
      }
      // Also fold planted_trees and painted chunks into the bounds so a
      // tree planted in fresh territory still has a place on the map.
      for (const t of mappedTrees) {
        const cx = Math.floor(t.baseX / 16);
        const cz = Math.floor(t.baseZ / 16);
        if (cx < minCx) minCx = cx;
        if (cx > maxCx) maxCx = cx;
        if (cz < minCz) minCz = cz;
        if (cz > maxCz) maxCz = cz;
      }
      for (const row of (noPlantRes.data ?? []) as any[]) {
        if (row.chunk_x < minCx) minCx = row.chunk_x;
        if (row.chunk_x > maxCx) maxCx = row.chunk_x;
        if (row.chunk_z < minCz) minCz = row.chunk_z;
        if (row.chunk_z > maxCz) maxCz = row.chunk_z;
      }
      setDensity(dens);
      // Fallback bounds if the world is empty.
      if (!isFinite(minCx)) {
        setBounds({ minChunkX: -16, maxChunkX: 16, minChunkZ: -16, maxChunkZ: 16 });
      } else {
        setBounds({ minChunkX: minCx, maxChunkX: maxCx, minChunkZ: minCz, maxChunkZ: maxCz });
      }

      setLoading(false);
    })();

    return () => { cancelled = true; };
  }, [worldId, enabled]);

  // Realtime: paint events from other clients refresh the noPlant set.
  useEffect(() => {
    if (!enabled || !worldId) return;
    const channel = supabase
      .channel(`god_map_no_plant_${worldId}`)
      .on(
        'postgres_changes',
        { event: '*', schema: 'public', table: 'world_no_plant_chunks', filter: `world_id=eq.${worldId}` },
        (payload) => {
          if (payload.eventType === 'INSERT') {
            const r = payload.new as any;
            setNoPlant(prev => {
              const next = new Set(prev);
              next.add(chunkKey(r.chunk_x, r.chunk_z));
              return next;
            });
          } else if (payload.eventType === 'DELETE') {
            const r = payload.old as any;
            setNoPlant(prev => {
              const next = new Set(prev);
              next.delete(chunkKey(r.chunk_x, r.chunk_z));
              return next;
            });
          }
        },
      )
      .subscribe();
    return () => { supabase.removeChannel(channel); };
  }, [worldId, enabled]);

  const paintChunks = useCallback(async (chunks: Array<{ cx: number; cz: number }>) => {
    if (!worldId || chunks.length === 0) return;
    // Optimistic local update.
    setNoPlant(prev => {
      const next = new Set(prev);
      for (const c of chunks) next.add(chunkKey(c.cx, c.cz));
      return next;
    });
    const rows = chunks.map(c => ({
      world_id: worldId,
      chunk_x: c.cx,
      chunk_z: c.cz,
    }));
    // ON CONFLICT DO NOTHING handled via upsert with ignoreDuplicates.
    const { error } = await supabase
      .from('world_no_plant_chunks' as any)
      .upsert(rows as any, { onConflict: 'world_id,chunk_x,chunk_z', ignoreDuplicates: true });
    if (error) {
      console.warn('[GodMap] paint failed:', error.message);
    }
  }, [worldId]);

  const eraseChunks = useCallback(async (chunks: Array<{ cx: number; cz: number }>) => {
    if (!worldId || chunks.length === 0) return;
    setNoPlant(prev => {
      const next = new Set(prev);
      for (const c of chunks) next.delete(chunkKey(c.cx, c.cz));
      return next;
    });
    // Delete in one round-trip via composite filter.
    for (const c of chunks) {
      await supabase
        .from('world_no_plant_chunks' as any)
        .delete()
        .eq('world_id', worldId)
        .eq('chunk_x', c.cx)
        .eq('chunk_z', c.cz);
    }
  }, [worldId]);

  return { trees, noPlant, density, bounds, loading, paintChunks, eraseChunks };
}
