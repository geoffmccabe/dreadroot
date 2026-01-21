// Player Health System Hook
// Manages current health, max health, damage pipeline, status effects, and respawn

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
import {
  DamageEvent,
  DamageResult,
  DamageType,
  ModifierContext,
  ActiveStatusEffect,
  StatusEffectType,
  processDamageEvent,
  createDefaultModifierContext,
  createActiveEffect,
  isEffectActive,
  shouldEffectTick,
  createDamageEvent,
} from '@/lib/damage';

export interface PlayerHealthState {
  currentHealth: number;
  maxHealth: number;
  isDead: boolean;
}

/**
 * Calculate max health based on level
 * Base: 100 health at level 1
 * Each additional level adds 5 health
 */
export function calculateMaxHealthForLevel(level: number): number {
  return 100 + (level - 1) * 5;
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

// I-frame duration after taking damage (ms)
const INVULNERABILITY_DURATION_MS = 200;

// DoT tick check interval (ms)
const DOT_TICK_INTERVAL_MS = 100;

// Spawn point for respawn
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
  const playerLevelRef = useRef(1);
  
  // Regeneration modifiers ref
  const regenModifiersRef = useRef<RegenModifiers>({ ...DEFAULT_REGEN_MODIFIERS });
  
  // Track last damage time for regen delay
  const lastDamageTimeRef = useRef<number>(0);
  
  // Damage pipeline context
  const modifierContextRef = useRef<ModifierContext>(createDefaultModifierContext(1));
  
  // I-frames tracking
  const lastDamageEventIdRef = useRef<string | null>(null);
  const invulnerableUntilRef = useRef<number>(0);
  
  // Active status effects
  const activeEffectsRef = useRef<ActiveStatusEffect[]>([]);
  
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
        
        // Update player level ref and modifier context
        playerLevelRef.current = level;
        modifierContextRef.current.playerLevel = level;
        
        // Update max_health in DB if it changed (ONE-TIME on load only)
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

  // Real-time subscription for multiplayer sync (READ ONLY - no DB writes!)
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
              
              // Update level refs
              playerLevelRef.current = level;
              modifierContextRef.current.playerLevel = level;
              
              setHealthState(prev => {
                const newCurrentHealth = newData.current_health ?? prev.currentHealth;
                
                return {
                  currentHealth: Math.min(newCurrentHealth, calculatedMaxHealth),
                  maxHealth: calculatedMaxHealth,
                  isDead: newCurrentHealth <= 0,
                };
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
   * Internal damage application (bypasses pipeline, used for DoT)
   */
  const takeDamageInternal = useCallback((amount: number): { died: boolean } => {
    const current = healthRef.current;
    const userId = userIdRef.current;
    
    if (current.isDead || !userId) {
      return { died: false };
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
    
    return { died };
  }, [toast]);

  /**
   * Add a status effect to the player
   */
  const addStatusEffect = useCallback((
    type: StatusEffectType,
    overrides?: Partial<ActiveStatusEffect>
  ) => {
    const effect = createActiveEffect(type, overrides);
    
    // Check if same type already exists - refresh duration instead of stacking
    const existingIndex = activeEffectsRef.current.findIndex(e => e.type === type);
    if (existingIndex >= 0) {
      activeEffectsRef.current[existingIndex] = effect;
    } else {
      activeEffectsRef.current.push(effect);
    }
    
    return effect;
  }, []);

  /**
   * Remove a status effect by type
   */
  const removeStatusEffect = useCallback((type: StatusEffectType) => {
    activeEffectsRef.current = activeEffectsRef.current.filter(e => e.type !== type);
  }, []);

  /**
   * Check if player has a specific status effect
   */
  const hasStatusEffect = useCallback((type: StatusEffectType): boolean => {
    return activeEffectsRef.current.some(e => e.type === type && isEffectActive(e));
  }, []);

  /**
   * Universal damage application - processes through pipeline
   * This is the MAIN entry point for all damage to the player
   */
  const applyDamage = useCallback((event: DamageEvent): DamageResult => {
    const now = Date.now();
    const current = healthRef.current;
    
    // Can't damage dead players
    if (current.isDead) {
      return { blocked: true, reason: 'dead' };
    }
    
    // Check i-frames (but allow DoT to bypass)
    if (event.source.type !== 'dot' && now < invulnerableUntilRef.current) {
      return { blocked: true, reason: 'invulnerable' };
    }
    
    // Deduplicate (same event ID within 100ms)
    if (event.id === lastDamageEventIdRef.current) {
      return { blocked: true, reason: 'duplicate' };
    }
    lastDamageEventIdRef.current = event.id;
    
    // Clear old event ID after 100ms
    setTimeout(() => {
      if (lastDamageEventIdRef.current === event.id) {
        lastDamageEventIdRef.current = null;
      }
    }, 100);
    
    // Process through damage pipeline
    const processed = processDamageEvent(event, modifierContextRef.current);
    
    if (processed.blocked) {
      return { blocked: true, reason: 'modifier' };
    }
    
    // Apply final damage to health
    const result = takeDamageInternal(processed.finalDamage);
    
    // Apply knockback (deferred to avoid render loop issues)
    if (processed.knockback && processed.knockback.finalForce > 0) {
      setTimeout(() => {
        const applyKnockback = (window as any).__applyPlayerKnockback;
        if (applyKnockback && typeof applyKnockback === 'function') {
          applyKnockback(
            processed.knockback!.direction.clone(),
            processed.knockback!.finalForce
          );
        }
      }, 0);
    }
    
    // Apply status effects from the damage event
    if (processed.statusEffects) {
      for (const effectApp of processed.statusEffects) {
        addStatusEffect(effectApp.effectType as StatusEffectType, {
          duration: effectApp.duration,
          intensity: effectApp.intensity,
          sourceId: effectApp.sourceId,
        });
      }
    }
    
    // Grant i-frames after taking damage (unless fatal)
    if (!result.died && event.source.type !== 'dot') {
      invulnerableUntilRef.current = now + INVULNERABILITY_DURATION_MS;
    }
    
    return { 
      blocked: false, 
      died: result.died, 
      finalDamage: processed.finalDamage 
    };
  }, [takeDamageInternal, addStatusEffect]);

  /**
   * Convenience function for simple damage with knockback
   * Creates a DamageEvent and processes it
   */
  const applyDamageWithKnockback = useCallback((
    damage: number,
    knockbackDir: THREE.Vector3,
    knockbackForce: number,
    source: { type: 'enemy' | 'environment' | 'player'; entityId?: string; entityName?: string },
    damageType: DamageType = DamageType.PHYSICAL
  ): DamageResult => {
    const event = createDamageEvent({
      baseDamage: damage,
      damageType,
      source,
      knockback: {
        direction: knockbackDir,
        force: knockbackForce,
      },
    });
    
    return applyDamage(event);
  }, [applyDamage]);

  /**
   * Legacy takeDamage function for backwards compatibility
   * @deprecated Use applyDamage or applyDamageWithKnockback instead
   */
  const takeDamage = useCallback((
    amount: number,
    knockbackDir?: THREE.Vector3,
    knockbackDistance?: number
  ): { died: boolean; knockbackDir: THREE.Vector3 | null; knockbackDistance: number } => {
    const event = createDamageEvent({
      baseDamage: amount,
      damageType: DamageType.PHYSICAL,
      source: { type: 'environment' },
      knockback: knockbackDir ? {
        direction: knockbackDir,
        force: knockbackDistance ?? 0,
      } : undefined,
    });
    
    const result = applyDamage(event);
    
    return {
      died: result.died ?? false,
      knockbackDir: knockbackDir ?? null,
      knockbackDistance: knockbackDistance ?? 0,
    };
  }, [applyDamage]);

  /**
   * DoT tick loop - processes status effect damage
   */
  useEffect(() => {
    const tickInterval = setInterval(() => {
      const now = Date.now();
      const effects = activeEffectsRef.current;
      
      // Filter expired effects
      activeEffectsRef.current = effects.filter(e => isEffectActive(e));
      
      // Process DoT ticks
      for (const effect of activeEffectsRef.current) {
        if (!shouldEffectTick(effect)) continue;
        
        // Update last tick time
        effect.lastTickTime = now;
        
        // Apply DoT damage directly (bypasses i-frames, already processed)
        const dotDamage = effect.intensity ?? 1;
        takeDamageInternal(dotDamage);
      }
    }, DOT_TICK_INTERVAL_MS);
    
    return () => clearInterval(tickInterval);
  }, [takeDamageInternal]);

  /**
   * Passive health regeneration loop (Minecraft-style)
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
    
    const intervalId = setInterval(regenTick, interval);
    
    return () => clearInterval(intervalId);
  }, []);

  /**
   * Heal the player (instant heal, e.g., from items)
   */
  const heal = useCallback((amount: number) => {
    const current = healthRef.current;
    const userId = userIdRef.current;
    
    if (!userId) return;
    
    const newHealth = Math.min(current.maxHealth, current.currentHealth + amount);
    
    setHealthState(prev => ({
      ...prev,
      currentHealth: newHealth,
      isDead: false,
    }));
    
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
   */
  const respawn = useCallback((): THREE.Vector3 => {
    const current = healthRef.current;
    const userId = userIdRef.current;
    
    if (!userId) return SPAWN_POINT.clone();
    
    // Reset damage timer so regen kicks in immediately after respawn
    lastDamageTimeRef.current = 0;
    
    // Clear all status effects
    activeEffectsRef.current = [];
    
    // Reset i-frames
    invulnerableUntilRef.current = 0;
    
    // Reset to full health
    setHealthState(prev => ({
      ...prev,
      currentHealth: current.maxHealth,
      isDead: false,
    }));
    
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
   * Set max health (for upgrades)
   */
  const setMaxHealth = useCallback((newMax: number) => {
    const userId = userIdRef.current;
    
    if (!userId) return;
    
    setHealthState(prev => ({
      ...prev,
      maxHealth: newMax,
      currentHealth: prev.currentHealth >= prev.maxHealth ? newMax : Math.min(prev.currentHealth, newMax),
    }));
    
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
   * Update regeneration modifiers
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

  /**
   * Update player armor value
   */
  const setPlayerArmor = useCallback((armor: number) => {
    modifierContextRef.current.playerArmor = armor;
  }, []);

  /**
   * Update resistance for a damage type
   */
  const setResistance = useCallback((type: DamageType, percent: number) => {
    modifierContextRef.current.resistances[type] = Math.max(0, Math.min(1, percent));
  }, []);

  /**
   * Add additional STEADY value (beyond level-based)
   */
  const addSteady = useCallback((amount: number) => {
    modifierContextRef.current.steady += amount;
  }, []);

  /**
   * Set total additional STEADY value
   */
  const setSteady = useCallback((amount: number) => {
    modifierContextRef.current.steady = amount;
  }, []);

  return {
    // Health state
    currentHealth: healthState.currentHealth,
    maxHealth: healthState.maxHealth,
    isDead: healthState.isDead,
    healthPercent: (healthState.currentHealth / healthState.maxHealth) * 100,
    
    // Universal damage functions (preferred)
    applyDamage,
    applyDamageWithKnockback,
    
    // Legacy function (deprecated)
    takeDamage,
    
    // Healing and respawn
    heal,
    respawn,
    setMaxHealth,
    
    // Status effects
    addStatusEffect,
    removeStatusEffect,
    hasStatusEffect,
    activeEffectsRef,
    
    // Modifier context controls
    setPlayerArmor,
    setResistance,
    addSteady,
    setSteady,
    modifierContextRef,
    
    // Regen modifier controls
    setRegenModifiers,
    resetRegenModifiers,
    regenModifiersRef,
    
    // Refs for direct access in frame loops
    healthRef,
    playerLevelRef,
  };
}
