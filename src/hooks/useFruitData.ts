// Hook for fetching and subscribing to user's harvested fruits

import { useState, useEffect, useCallback } from 'react';
import { supabase } from '@/integrations/supabase/client';
import type { UserFruit } from '@/features/trees/types';

interface UseFruitDataResult {
  userFruits: UserFruit[];
  isLoading: boolean;
  refetch: () => Promise<void>;
}

export function useFruitData(userId: string | null): UseFruitDataResult {
  const [userFruits, setUserFruits] = useState<UserFruit[]>([]);
  const [isLoading, setIsLoading] = useState(true);

  const fetchFruits = useCallback(async () => {
    if (!userId) {
      setUserFruits([]);
      setIsLoading(false);
      return;
    }

    try {
      setIsLoading(true);
      const { data, error } = await supabase
        .from('user_fruits' as any)
        .select('*')
        .eq('user_id', userId)
        .order('tier', { ascending: true });

      if (error) {
        console.error('[useFruitData] Fetch error:', error);
        return;
      }

      setUserFruits((data || []) as unknown as UserFruit[]);
    } catch (err) {
      console.error('[useFruitData] Error:', err);
    } finally {
      setIsLoading(false);
    }
  }, [userId]);

  // Initial fetch
  useEffect(() => {
    fetchFruits();
  }, [fetchFruits]);

  // Optimistic insert: immediately add harvested fruit to local state
  useEffect(() => {
    const handleHarvest = (e: Event) => {
      const fruit = (e as CustomEvent).detail as UserFruit;
      if (fruit) {
        setUserFruits(prev => [...prev, fruit].sort((a, b) => a.tier - b.tier));
      }
    };
    // Replace optimistic fruit with real DB fruit (correct ID for forge)
    const handleConfirm = (e: Event) => {
      const { optimisticId, real } = (e as CustomEvent).detail;
      if (optimisticId && real) {
        setUserFruits(prev =>
          prev.map(f => f.id === optimisticId ? real as unknown as UserFruit : f)
        );
      }
    };
    window.addEventListener('fruitHarvested', handleHarvest);
    window.addEventListener('fruitHarvestConfirmed', handleConfirm);
    return () => {
      window.removeEventListener('fruitHarvested', handleHarvest);
      window.removeEventListener('fruitHarvestConfirmed', handleConfirm);
    };
  }, []);

  // Realtime subscription
  useEffect(() => {
    if (!userId) return;

    const channel = supabase
      .channel(`user_fruits_${userId}-${Math.random().toString(36).slice(2)}`)
      .on(
        'postgres_changes',
        {
          event: '*',
          schema: 'public',
          table: 'user_fruits',
          filter: `user_id=eq.${userId}`,
        },
        (payload) => {
          if (payload.eventType === 'INSERT') {
            setUserFruits(prev => [...prev, payload.new as unknown as UserFruit].sort((a, b) => a.tier - b.tier));
          } else if (payload.eventType === 'DELETE') {
            setUserFruits(prev => prev.filter(f => f.id !== payload.old.id));
          } else if (payload.eventType === 'UPDATE') {
            setUserFruits(prev =>
              prev.map(f => f.id === payload.new.id ? payload.new as unknown as UserFruit : f).sort((a, b) => a.tier - b.tier)
            );
          }
        }
      )
      .subscribe();

    return () => {
      supabase.removeChannel(channel);
    };
  }, [userId]);

  return {
    userFruits,
    isLoading,
    refetch: fetchFruits,
  };
}
