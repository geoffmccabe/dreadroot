// useDivi - Manages user's DIVI currency balance

import { useState, useEffect, useCallback } from 'react';
import { supabase } from '@/integrations/supabase/client';
import type { UserDiviBalance } from '../types';

interface UseDiviReturn {
  balance: number;
  diviData: UserDiviBalance | null;
  isLoading: boolean;
  error: string | null;
  refetch: () => Promise<void>;
}

export function useDivi(userId: string | null): UseDiviReturn {
  const [diviData, setDiviData] = useState<UserDiviBalance | null>(null);
  const [isLoading, setIsLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  const fetchBalance = useCallback(async () => {
    if (!userId) {
      setDiviData(null);
      setIsLoading(false);
      return;
    }

    setIsLoading(true);

    try {
      // Call RPC to get balance (creates record if needed)
      const { data: balance, error: rpcError } = await supabase.rpc('get_divi_balance');

      if (rpcError) {
        console.error('[useDivi] RPC error:', rpcError);
        setError(rpcError.message);
        // Still try to fetch existing record even if RPC failed
      }

      // Fetch full record
      const { data, error: fetchError } = await supabase
        .from('user_divi_balances')
        .select('*')
        .eq('user_id', userId)
        .single();

      if (fetchError && fetchError.code !== 'PGRST116') {
        console.error('[useDivi] Fetch error:', fetchError);
        // If no record exists yet, that's okay - use default balance of 0
        if (fetchError.code === 'PGRST116') {
          setDiviData(null);
          setError(null);
        } else {
          setError(fetchError.message);
        }
      } else {
        setDiviData(data);
        setError(null);
      }
    } catch (err) {
      console.error('[useDivi] Error:', err);
      setError(err instanceof Error ? err.message : 'Unknown error');
    } finally {
      setIsLoading(false);
    }
  }, [userId]);

  // Initial fetch
  useEffect(() => {
    fetchBalance();
  }, [fetchBalance]);

  // Subscribe to realtime updates
  useEffect(() => {
    if (!userId) return;

    const channel = supabase
      .channel(`divi_balance_${userId}-${Math.random().toString(36).slice(2)}`)
      .on(
        'postgres_changes',
        {
          event: '*',
          schema: 'public',
          table: 'user_divi_balances',
          filter: `user_id=eq.${userId}`,
        },
        (payload) => {
          if (payload.eventType === 'UPDATE' || payload.eventType === 'INSERT') {
            setDiviData(payload.new as UserDiviBalance);
          }
        }
      )
      .subscribe();

    return () => {
      supabase.removeChannel(channel);
    };
  }, [userId]);

  return {
    balance: diviData?.balance ?? 0,
    diviData,
    isLoading,
    error,
    refetch: fetchBalance,
  };
}
