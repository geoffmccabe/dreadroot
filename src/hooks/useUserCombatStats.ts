import { useState, useEffect, useCallback } from 'react';
import { supabase } from '@/integrations/supabase/client';
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
  enemyType: 'shwarm' | 'shnake' | 'shombie' | 'shtickman'; // Distinguish between enemy types
}

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

export function useUserCombatStats() {
  const { user } = useAuth();
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
      
      const [statsResult, shwarmDefsResult, shnakeDefsResult, shombieDefsResult, shtickmanDefsResult] = await Promise.all([
        supabase
          .from('user_combat_stats')
          .select('*')
          .eq('user_id', user.id),
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
          .order('tier', { ascending: true })
      ]);

      if (!statsResult.error) {
        setStats(statsResult.data || []);
      }
      
      const allDefs: EnemyDefinition[] = [];
      
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
  }, [user?.id]);

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
