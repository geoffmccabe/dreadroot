import { useState, useEffect, useCallback } from 'react';
import { supabase } from '@/integrations/supabase/client';
import { useActiveGame } from '@/config/activeGame';
import { gameDataKey } from '@/config/gameRegistry';
import { useAuth } from '@/contexts/AuthContext';

export interface CombatStat {
  id: string;
  user_id: string;
  enemy_type: string;
  kills: number;
}

export interface EnemyDefinition {
  id: string;
  tier: number;
  name: string;
  texture_url: string | null;
  rarity?: string;
  enemyType: 'shwarm' | 'shnake' | 'shombie' | 'shtickman' | 'shpider' | 'walapa' | 'shroomer' | 'vortax' | 'reddemon';
}

/**
 * Starblink red demon ladder — must stay in step with TIERS in
 * src/components/siege/StarblinkDemonSpawner.tsx (names, order and rarity).
 */
const RED_DEMON_DEFS: EnemyDefinition[] = [
  { id: 'reddemon_t1', tier: 1, name: 'Ash Demon',     texture_url: null, rarity: 'common',    enemyType: 'reddemon' },
  { id: 'reddemon_t2', tier: 2, name: 'Jade Demon',    texture_url: null, rarity: 'uncommon',  enemyType: 'reddemon' },
  { id: 'reddemon_t3', tier: 3, name: 'Azure Demon',   texture_url: null, rarity: 'rare',      enemyType: 'reddemon' },
  { id: 'reddemon_t4', tier: 4, name: 'Violet Demon',  texture_url: null, rarity: 'epic',      enemyType: 'reddemon' },
  { id: 'reddemon_t5', tier: 5, name: 'Crimson Demon', texture_url: null, rarity: 'legendary', enemyType: 'reddemon' },
];

// Rarity order for sorting (lowest to highest)
const RARITY_ORDER: Record<string, number> = {
  common: 0,
  uncommon: 1,
  rare: 2,
  epic: 3,
  legendary: 4,
};

// Derive rarity from tier (for shwarm - tiers 1-10)
function getShwarmRarityFromTier(tier: number): string {
  if (tier <= 2) return 'common';
  if (tier <= 4) return 'uncommon';
  if (tier <= 6) return 'rare';
  if (tier <= 8) return 'epic';
  return 'legendary';
}

// Derive rarity from tier (for shnake - tiers 1-30)
function getShnakeRarityFromTier(tier: number): string {
  if (tier <= 6) return 'common';
  if (tier <= 12) return 'uncommon';
  if (tier <= 18) return 'rare';
  if (tier <= 24) return 'epic';
  return 'legendary';
}

// Derive rarity from tier (for shombie - tiers 1-10)
function getShombieRarityFromTier(tier: number): string {
  if (tier <= 2) return 'common';
  if (tier <= 4) return 'uncommon';
  if (tier <= 6) return 'rare';
  if (tier <= 8) return 'epic';
  return 'legendary';
}

// Derive rarity from tier (for shtickman - tiers 1-10)
function getShtickmanRarityFromTier(tier: number): string {
  if (tier <= 2) return 'common';
  if (tier <= 4) return 'uncommon';
  if (tier <= 6) return 'rare';
  if (tier <= 8) return 'epic';
  return 'legendary';
}

// Shpider + walapa + shroomer + vortax share the standard 1-10 tier buckets.
const getShpiderRarityFromTier = getShtickmanRarityFromTier;
const getWalapaRarityFromTier = getShtickmanRarityFromTier;
const getShroomerRarityFromTier = getShtickmanRarityFromTier;
const getVortaxRarityFromTier = getShtickmanRarityFromTier;

export function useUserCombatStats() {
  const { user } = useAuth();
  const gameKey = gameDataKey(useActiveGame());
  const [stats, setStats] = useState<CombatStat[]>([]);
  const [definitions, setDefinitions] = useState<EnemyDefinition[]>([]);
  const [isLoading, setIsLoading] = useState(true);

  // Load combat stats and definitions (both shwarm and shnake)
  useEffect(() => {
    if (!user?.id) {
      setStats([]);
      setIsLoading(false);
      return;
    }

    const loadData = async () => {
      setIsLoading(true);
      
      const [
        statsResult,
        shwarmDefsResult,
        shnakeDefsResult,
        shombieDefsResult,
        shtickmanDefsResult,
        shpiderDefsResult,
        walapaDefsResult,
        shroomerDefsResult,
        vortaxDefsResult,
      ] = await Promise.all([
        supabase
          .from('user_combat_stats')
          .select('*')
          .eq('user_id', user.id)
          .eq('game', gameKey),
        supabase
          .from('shwarm_definitions')
          .select('id, tier, name, texture_url')
          .order('tier', { ascending: true }),
        supabase
          .from('shnake_definitions')
          .select('id, tier, name, head_texture_url')
          .order('tier', { ascending: true }),
        supabase
          .from('shombie_definitions')
          .select('id, tier, name, texture_url')
          .order('tier', { ascending: true }),
        supabase
          .from('shtickman_definitions')
          .select('id, tier, name, body_texture_url')
          .order('tier', { ascending: true }),
        supabase
          .from('shpider_definitions' as any)
          .select('id, tier, name, body_texture_url')
          .order('tier', { ascending: true }),
        // walapa_definitions is optional — some Supabase projects
        // don't have the table. Falls back to an empty list.
        supabase
          .from('walapa_definitions' as any)
          .select('id, tier, name, body_texture_url')
          .order('tier', { ascending: true }),
        supabase
          .from('shroomer_definitions' as any)
          .select('id, tier, name, texture_url')
          .order('tier', { ascending: true }),
        // vortax_definitions is optional until its migration is run.
        supabase
          .from('vortax_definitions' as any)
          .select('id, tier, name, texture_url')
          .order('tier', { ascending: true }),
      ]);

      if (!statsResult.error) {
        setStats(statsResult.data || []);
      }
      
      const allDefs: EnemyDefinition[] = [];
      
      // Starblink's tiered red demons. Defined in CODE, not in a *_definitions table: they are a
      // fixed five-tier ladder owned by StarblinkDemonSpawner, so a table would be a migration on
      // the shared database for five rows that never change. Kills join on `reddemon_t<tier>`.
      allDefs.push(...RED_DEMON_DEFS);

      // Add shwarm definitions
      if (!shwarmDefsResult.error) {
        const shwarmDefs = (shwarmDefsResult.data || []).map(d => ({
          id: d.id,
          tier: d.tier,
          name: d.name,
          texture_url: d.texture_url,
          rarity: getShwarmRarityFromTier(d.tier),
          enemyType: 'shwarm' as const,
        }));
        allDefs.push(...shwarmDefs);
      }
      
      // Add shnake definitions
      if (!shnakeDefsResult.error) {
        const shnakeDefs = (shnakeDefsResult.data || []).map(d => ({
          id: d.id,
          tier: d.tier,
          name: d.name,
          texture_url: d.head_texture_url, // Use head texture for display
          rarity: getShnakeRarityFromTier(d.tier),
          enemyType: 'shnake' as const,
        }));
        allDefs.push(...shnakeDefs);
      }
      
      // Add shombie definitions
      if (!shombieDefsResult.error) {
        const shombieDefs = (shombieDefsResult.data || []).map(d => ({
          id: d.id,
          tier: d.tier,
          name: d.name,
          texture_url: d.texture_url,
          rarity: getShombieRarityFromTier(d.tier),
          enemyType: 'shombie' as const,
        }));
        allDefs.push(...shombieDefs);
      }

      // Add shtickman definitions
      if (!shtickmanDefsResult.error) {
        const shtickmanDefs = (shtickmanDefsResult.data || []).map(d => ({
          id: d.id,
          tier: d.tier,
          name: d.name,
          texture_url: d.body_texture_url, // Use body texture for display
          rarity: getShtickmanRarityFromTier(d.tier),
          enemyType: 'shtickman' as const,
        }));
        allDefs.push(...shtickmanDefs);
      }

      // Shpider — body texture for thumbnail.
      if (!shpiderDefsResult.error && shpiderDefsResult.data) {
        const shpiderDefs = (shpiderDefsResult.data as any[]).map(d => ({
          id: d.id,
          tier: d.tier,
          name: d.name,
          texture_url: d.body_texture_url,
          rarity: getShpiderRarityFromTier(d.tier),
          enemyType: 'shpider' as const,
        }));
        allDefs.push(...shpiderDefs);
      }

      // Walapa — body texture for thumbnail. Tolerates the table not
      // existing (walapa_definitions is optional per useAtlasSync).
      if (!walapaDefsResult.error && walapaDefsResult.data) {
        const walapaDefs = (walapaDefsResult.data as any[]).map(d => ({
          id: d.id,
          tier: d.tier,
          name: d.name,
          texture_url: d.body_texture_url,
          rarity: getWalapaRarityFromTier(d.tier),
          enemyType: 'walapa' as const,
        }));
        allDefs.push(...walapaDefs);
      }

      // Shroomer — texture for thumbnail.
      if (!shroomerDefsResult.error && shroomerDefsResult.data) {
        const shroomerDefs = (shroomerDefsResult.data as any[]).map(d => ({
          id: d.id,
          tier: d.tier,
          name: d.name,
          texture_url: d.texture_url,
          rarity: getShroomerRarityFromTier(d.tier),
          enemyType: 'shroomer' as const,
        }));
        allDefs.push(...shroomerDefs);
      }

      // Vortax — tolerates the table not existing yet.
      if (!vortaxDefsResult.error && vortaxDefsResult.data) {
        const vortaxDefs = (vortaxDefsResult.data as any[]).map(d => ({
          id: d.id,
          tier: d.tier,
          name: d.name,
          texture_url: d.texture_url,
          rarity: getVortaxRarityFromTier(d.tier),
          enemyType: 'vortax' as const,
        }));
        allDefs.push(...vortaxDefs);
      }

      setDefinitions(allDefs);
      setIsLoading(false);
    };

    loadData();

    // Subscribe to real-time updates
    const channel = supabase
      .channel(`combat-stats-changes-${Math.random().toString(36).slice(2)}`)
      .on(
        'postgres_changes',
        {
          event: '*',
          schema: 'public',
          table: 'user_combat_stats',
          filter: `user_id=eq.${user.id}`,
        },
        (payload) => {
          if (payload.eventType === 'INSERT') {
            setStats(prev => [...prev, payload.new as CombatStat]);
          } else if (payload.eventType === 'UPDATE') {
            setStats(prev => prev.map(s => 
              s.id === (payload.new as CombatStat).id ? payload.new as CombatStat : s
            ));
          }
        }
      )
      .subscribe();

    return () => {
      supabase.removeChannel(channel);
    };
  }, [user?.id, gameKey]);

  // Increment kill count for an enemy type
  const incrementKill = useCallback(async (enemyType: string) => {
    if (!user?.id) return;

    const existing = stats.find(s => s.enemy_type === enemyType);
    
    if (existing) {
      // Update existing record
      const { error } = await supabase
        .from('user_combat_stats')
        .update({ kills: existing.kills + 1, updated_at: new Date().toISOString() })
        .eq('id', existing.id);
      
      if (!error) {
        setStats(prev => prev.map(s => 
          s.id === existing.id ? { ...s, kills: s.kills + 1 } : s
        ));
      }
    } else {
      // Insert new record
      const { data, error } = await supabase
        .from('user_combat_stats')
        .insert({
          user_id: user.id,
          enemy_type: enemyType,
          kills: 1
        })
        .select()
        .single();
      
      if (!error && data) {
        setStats(prev => [...prev, data]);
      }
    }
  }, [user?.id, stats]);

  // Get sorted stats with definitions (includes both shwarm and shnake)
  const sortedStatsWithDefs = useCallback(() => {
    // Create a map of enemy_type to kills
    const killsMap = new Map(stats.map(s => [s.enemy_type, s.kills]));
    
    // Sort definitions by: rarity → name (alphabetical) → tier
    const sorted = [...definitions].sort((a, b) => {
      // Rarity first
      const rarityDiff = RARITY_ORDER[a.rarity || 'common'] - RARITY_ORDER[b.rarity || 'common'];
      if (rarityDiff !== 0) return rarityDiff;
      
      // Then alphabetical by name
      const nameDiff = a.name.localeCompare(b.name);
      if (nameDiff !== 0) return nameDiff;
      
      // Then by tier
      return a.tier - b.tier;
    });

    return sorted.map(def => ({
      ...def,
      // Map kills based on enemy type prefix
      kills: killsMap.get(`${def.enemyType}_t${def.tier}`) || 0
    }));
  }, [stats, definitions]);

  return {
    stats,
    definitions,
    isLoading,
    incrementKill,
    sortedStatsWithDefs,
  };
}
