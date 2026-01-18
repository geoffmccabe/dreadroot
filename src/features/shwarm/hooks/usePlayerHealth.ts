// Player Health System Hook
// Manages current health, max health, damage, healing, respawn

import { useState, useEffect, useCallback, useRef } from 'react';
import { supabase } from '@/integrations/supabase/client';
import { useAuth } from '@/contexts/AuthContext';
import { useToast } from '@/hooks/use-toast';
import * as THREE from 'three';

export interface PlayerHealthState {
  currentHealth: number;
  maxHealth: number;
  isDead: boolean;
}

// Spawn point for respawn
const SPAWN_POINT = new THREE.Vector3(-8, 1.8, 22);

export function usePlayerHealth() {
  const { user } = useAuth();
  const { toast } = useToast();
  
  const [healthState, setHealthState] = useState<PlayerHealthState>({
    currentHealth: 100,
    maxHealth: 100,
    isDead: false,
  });
  
  // Refs for instant access in callbacks (avoid stale closures)
  const healthRef = useRef(healthState);
  const userIdRef = useRef(user?.id);
  
  // Sync refs with state
  useEffect(() => {
    healthRef.current = healthState;
  }, [healthState]);
  
  useEffect(() => {
    userIdRef.current = user?.id;
  }, [user?.id]);

  // Load health from user_profiles on mount
  useEffect(() => {
    if (!user?.id) return;
    
    const loadHealth = async () => {
      const { data, error } = await supabase
        .from('user_profiles')
        .select('current_health, max_health')
        .eq('user_id', user.id)
        .maybeSingle();
      
      if (error) {
        console.error('[usePlayerHealth] Failed to load health:', error);
        return;
      }
      
      if (data) {
        setHealthState({
          currentHealth: data.current_health ?? 100,
          maxHealth: data.max_health ?? 100,
          isDead: (data.current_health ?? 100) <= 0,
        });
      }
    };
    
    loadHealth();
  }, [user?.id]);

  // Real-time subscription for multiplayer sync
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
            const newData = payload.new as { current_health?: number; max_health?: number };
            if (newData.current_health !== undefined || newData.max_health !== undefined) {
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
   * Heal the player
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

  return {
    currentHealth: healthState.currentHealth,
    maxHealth: healthState.maxHealth,
    isDead: healthState.isDead,
    healthPercent: (healthState.currentHealth / healthState.maxHealth) * 100,
    takeDamage,
    heal,
    respawn,
    setMaxHealth,
    // Ref for direct access in frame loops
    healthRef,
  };
}
