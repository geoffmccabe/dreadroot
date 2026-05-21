// usePurchase - Handle marketplace purchases

import { useState, useCallback } from 'react';
import { supabase } from '@/integrations/supabase/client';
import type { PurchaseResult } from '../types';
import { getSoundUrl } from '@/hooks/useGameSounds';
import { playSound } from '@/lib/spatialAudio';

interface UsePurchaseReturn {
  purchase: (listingId: string, quantity?: number) => Promise<PurchaseResult>;
  isPurchasing: boolean;
}

export function usePurchase(): UsePurchaseReturn {
  const [isPurchasing, setIsPurchasing] = useState(false);

  const purchase = useCallback(async (listingId: string, quantity = 1): Promise<PurchaseResult> => {
    setIsPurchasing(true);

    try {
      const { data, error } = await supabase.rpc('marketplace_purchase', {
        p_listing_id: listingId,
        p_quantity: quantity,
      });

      if (error) {
        console.error('[usePurchase] RPC error:', error);
        return { success: false, error: error.message };
      }

      const result = data as PurchaseResult;

      if (result.success) {
        // Play purchase sound
        playSound(getSoundUrl('coin_hit', '/coin_hit_sound.mp3'), 0.3);
      }

      return result;
    } catch (err) {
      console.error('[usePurchase] Exception:', err);
      return { success: false, error: err instanceof Error ? err.message : 'Unknown error' };
    } finally {
      setIsPurchasing(false);
    }
  }, []);

  return {
    purchase,
    isPurchasing,
  };
}
