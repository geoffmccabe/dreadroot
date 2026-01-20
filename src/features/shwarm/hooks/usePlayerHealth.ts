// Player Health System Hook
// Manages current health, max health, damage, healing, respawn, and passive regeneration

import { useState, useEffect, useCallback, useRef } from 'react';
import { supabase } from '@/integrations/supabase/client';
import { useAuth } from '@/contexts/AuthContext';
import { useToast } from '@/hooks/use-toast';
import * as THREE from 'three';
import { 
  PLAYER_SPAWN_POINT, 
  HEALTH_REGEN_INTERVAL_MS, 
  HEALTH_REGEN_AMOUNT,
  HEALTH_REGEN_DELAY_AFTER_DAMAGE_MS 
} from '../constants';
import { getLevelForPoints } from '@/lib/levelSystem';

export interface PlayerHealthState {
  currentHealth: number;
  maxHealth: number;
  isDead: boolean;
}

/**
 * Calculate max health based on level
 * Base: 10 health at level 1
 * Each additional level adds 0.5 health (half a heart)
 */
export function calculateMaxHealthForLevel(level: number): number {
  return 10 + (level - 1) * 0.5;
}

/**
 * Regeneration modifiers that can be adjusted by items, buffs, etc.
 * All values are multipliers (1.0 = normal rate)
 */
export interface RegenModifiers {
  /** Multiplier for heal amount (e.g., 1.5 = 50% more healing) */
  amountMultiplier: number;
  /** Multiplier for regen interval (e.g., 0.5 = heals twice as fast) */
  intervalMultiplier: number;
  /** Multiplier for delay after damage (e.g., 0.5 = half the delay) */
  delayMultiplier: number;
}

const DEFAULT_REGEN_MODIFIERS: RegenModifiers = {
  amountMultiplier: 1.0,
  intervalMultiplier: 1.0,
  delayMultiplier: 1.0,
};

// Spawn point for respawn (from constants for single source of truth)
const SPAWN_POINT = new THREE.Vector3(
  PLAYER_SPAWN_POINT.x,
  PLAYER_SPAWN_POINT.y,
  PLAYER_SPAWN_POINT.z
);

export function usePlayerHealth() {
  const { user } = useAuth();
  const { toast } = useToast();
  
  const [healthState, setHealthState] = useState<PlayerHealthState>({
    currentHealth: 10,
    maxHealth: 10,
    isDead: false,
  });
  
  // Refs for instant access in callbacks (avoid stale closures)
  const healthRef = useRef(healthState);
  const userIdRef = useRef(user?.id);
  
  // Regeneration modifiers ref - can be modified by items/buffs
  const regenModifiersRef = useRef<RegenModifiers>({ ...DEFAULT_REGEN_MODIFIERS });
  
  // Track last damage time for regen delay
  const lastDamageTimeRef = useRef<number>(0);
  
  // Sync refs with state
  useEffect(() => {
    healthRef.current = healthState;
  }, [healthState]);
  
  useEffect(() => {
    userIdRef.current = user?.id;
  }, [user?.id]);

  // Load health from user_profiles on mount and calculate max health from level
  useEffect(() => {
    if (!user?.id) return;
    
    const loadHealth = async () => {
      const { data, error } = await supabase
        .from('user_profiles')
        .select('current_health, max_health, total_points, current_level')
        .eq('user_id', user.id)
        .maybeSingle();
      
      if (error) {
        console.error('[usePlayerHealth] Failed to load health:', error);
        return;
      }
      
      if (data) {
        // Calculate max health based on level (level derived from points for accuracy)
        const level = getLevelForPoints(data.total_points || 0);
        const calculatedMaxHealth = calculateMaxHealthForLevel(level);
        
        // Update max_health in DB if it changed
        if (data.max_health !== calculatedMaxHealth) {
          supabase
            .from('user_profiles')
            .update({ max_health: calculatedMaxHealth })
            .eq('user_id', user.id)
            .then(({ error }) => {
              if (error) console.error('[usePlayerHealth] Failed to update max health:', error);
            });
        }
        
        // Ensure current health doesn't exceed max
        const currentHealth = Math.min(data.current_health ?? calculatedMaxHealth, calculatedMaxHealth);
        
        setHealthState({
          currentHealth,
          maxHealth: calculatedMaxHealth,
          isDead: currentHealth <= 0,
        });
      }
    };
    
    loadHealth();
  }, [user?.id]);

  // Real-time subscription for multiplayer sync and level-up max health updates
  useEffect(() => {
    if (!user?.id) return;
    
    const channel = supabase
      .channel('player-health-changes')
      .on(
        'postgres_changes',
        {
          event: 'UPDATE',
          schema: 'public',
          table: 'user_profiles',
          filter: `user_id=eq.${user.id}`,
        },
        (payload) => {
          if (payload.new && typeof payload.new === 'object') {
            const newData = payload.new as { 
              current_health?: number; 
              max_health?: number;
              total_points?: number;
            };
            
            // Recalculate max health from points if they changed
            if (newData.total_points !== undefined) {
              const level = getLevelForPoints(newData.total_points);
              const calculatedMaxHealth = calculateMaxHealthForLevel(level);
              
              setHealthState(prev => {
                const newMaxHealth = calculatedMaxHealth;
                const newCurrentHealth = newData.current_health ?? prev.currentHealth;
                
                return {
                  currentHealth: Math.min(newCurrentHealth, newMaxHealth),
                  maxHealth: newMaxHealth,
                  isDead: newCurrentHealth <= 0,
                };
              });
              
              // Sync new max health to DB
              supabase
                .from('user_profiles')
                .update({ max_health: calculatedMaxHealth })
                .eq('user_id', user.id)
                .then(({ error }) => {
                  if (error) console.error('[usePlayerHealth] Failed to sync max health:', error);
                });
            } else if (newData.current_health !== undefined || newData.max_health !== undefined) {
              setHealthState(prev => ({
                currentHealth: newData.current_health ?? prev.currentHealth,
                maxHealth: newData.max_health ?? prev.maxHealth,
                isDead: (newData.current_health ?? prev.currentHealth) <= 0,
              }));
            }
          }
        }
      )
      .subscribe();
    
    return () => {
      supabase.removeChannel(channel);
    };
  }, [user?.id]);

  /**
   * Passive health regeneration loop (Minecraft-style)
   * Heals player over time when not dead and not at max health
   */
  useEffect(() => {
    const modifiers = regenModifiersRef.current;
    const interval = HEALTH_REGEN_INTERVAL_MS * modifiers.intervalMultiplier;
    
    const regenTick = () => {
      const current = healthRef.current;
      const userId = userIdRef.current;
      const mods = regenModifiersRef.current;
      
      // Don't regenerate if dead, not logged in, or already at max health
      if (current.isDead || !userId || current.currentHealth >= current.maxHealth) {
        return;
      }
      
      // Check if enough time has passed since last damage
      const now = Date.now();
      const delay = HEALTH_REGEN_DELAY_AFTER_DAMAGE_MS * mods.delayMultiplier;
      if (now - lastDamageTimeRef.current < delay) {
        return;
      }
      
      // Calculate heal amount with modifiers
      const healAmount = Math.round(HEALTH_REGEN_AMOUNT * mods.amountMultiplier);
      const newHealth = Math.min(current.maxHealth, current.currentHealth + healAmount);
      
      // Only update if health actually changed
      if (newHealth === current.currentHealth) return;
      
      // Optimistic update
      setHealthState(prev => ({
        ...prev,
        currentHealth: newHealth,
      }));
      
      // Sync to database (non-blocking)
      supabase
        .from('user_profiles')
        .update({ current_health: newHealth })
        .eq('user_id', userId)
        .then(({ error }) => {
          if (error) {
            console.error('[usePlayerHealth] Failed to sync regen:', error);
          }
        });
    };
    
    // Start regen interval
    const intervalId = setInterval(regenTick, interval);
    
    return () => clearInterval(intervalId);
  }, []);

  /**
   * Take damage and apply knockback
   * Returns knockback info for FirstPersonControls to apply
   */
  const takeDamage = useCallback((
    amount: number,
    knockbackDir?: THREE.Vector3,
    knockbackDistance?: number
  ): { died: boolean; knockbackDir: THREE.Vector3 | null; knockbackDistance: number } => {
    const current = healthRef.current;
    const userId = userIdRef.current;
    
    if (current.isDead || !userId) {
      return { died: false, knockbackDir: null, knockbackDistance: 0 };
    }
    
    // Record damage time for regen delay
    lastDamageTimeRef.current = Date.now();
    
    const newHealth = Math.max(0, current.currentHealth - amount);
    const died = newHealth <= 0;
    
    // Optimistic update
    setHealthState(prev => ({
      ...prev,
      currentHealth: newHealth,
      isDead: died,
    }));
    
    // Sync to database (non-blocking)
    supabase
      .from('user_profiles')
      .update({ current_health: newHealth })
      .eq('user_id', userId)
      .then(({ error }) => {
        if (error) {
          console.error('[usePlayerHealth] Failed to sync damage:', error);
        }
      });
    
    if (died) {
      toast({
        title: "You died!",
        description: "Respawning in 3 seconds...",
        variant: "destructive",
      });
    }
    
    return {
      died,
      knockbackDir: knockbackDir || null,
      knockbackDistance: knockbackDistance || 0,
    };
  }, [toast]);

  /**
   * Heal the player (instant heal, e.g., from items)
   */
  const heal = useCallback((amount: number) => {
    const current = healthRef.current;
    const userId = userIdRef.current;
    
    if (!userId) return;
    
    const newHealth = Math.min(current.maxHealth, current.currentHealth + amount);
    
    // Optimistic update
    setHealthState(prev => ({
      ...prev,
      currentHealth: newHealth,
      isDead: false,
    }));
    
    // Sync to database
    supabase
      .from('user_profiles')
      .update({ current_health: newHealth })
      .eq('user_id', userId)
      .then(({ error }) => {
        if (error) {
          console.error('[usePlayerHealth] Failed to sync heal:', error);
        }
      });
  }, []);

  /**
   * Respawn the player at spawn point with full health
   * Returns the spawn position for FirstPersonControls
   */
  const respawn = useCallback((): THREE.Vector3 => {
    const current = healthRef.current;
    const userId = userIdRef.current;
    
    if (!userId) return SPAWN_POINT.clone();
    
    // Reset damage timer so regen kicks in immediately after respawn
    lastDamageTimeRef.current = 0;
    
    // Reset to full health
    setHealthState(prev => ({
      ...prev,
      currentHealth: current.maxHealth,
      isDead: false,
    }));
    
    // Sync to database
    supabase
      .from('user_profiles')
      .update({ current_health: current.maxHealth })
      .eq('user_id', userId)
      .then(({ error }) => {
        if (error) {
          console.error('[usePlayerHealth] Failed to sync respawn:', error);
        }
      });
    
    toast({
      title: "Respawned",
      description: "You have been respawned with full health",
    });
    
    return SPAWN_POINT.clone();
  }, [toast]);

  /**
   * Set max health (for future upgrades)
   */
  const setMaxHealth = useCallback((newMax: number) => {
    const userId = userIdRef.current;
    
    if (!userId) return;
    
    setHealthState(prev => ({
      ...prev,
      maxHealth: newMax,
      // Also heal to new max if current exceeds it or if at full health
      currentHealth: prev.currentHealth >= prev.maxHealth ? newMax : Math.min(prev.currentHealth, newMax),
    }));
    
    // Sync to database
    supabase
      .from('user_profiles')
      .update({ max_health: newMax })
      .eq('user_id', userId)
      .then(({ error }) => {
        if (error) {
          console.error('[usePlayerHealth] Failed to sync max health:', error);
        }
      });
  }, []);

  /**
   * Update regeneration modifiers (for items, buffs, etc.)
   * Pass partial modifiers to update only specific values
   */
  const setRegenModifiers = useCallback((modifiers: Partial<RegenModifiers>) => {
    regenModifiersRef.current = {
      ...regenModifiersRef.current,
      ...modifiers,
    };
  }, []);

  /**
   * Reset regeneration modifiers to defaults
   */
  const resetRegenModifiers = useCallback(() => {
    regenModifiersRef.current = { ...DEFAULT_REGEN_MODIFIERS };
  }, []);

  return {
    currentHealth: healthState.currentHealth,
    maxHealth: healthState.maxHealth,
    isDead: healthState.isDead,
    healthPercent: (healthState.currentHealth / healthState.maxHealth) * 100,
    takeDamage,
    heal,
    respawn,
    setMaxHealth,
    // Regen modifier controls for items/buffs
    setRegenModifiers,
    resetRegenModifiers,
    regenModifiersRef,
    // Ref for direct access in frame loops
    healthRef,
  };
}
