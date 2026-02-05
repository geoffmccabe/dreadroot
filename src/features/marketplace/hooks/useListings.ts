// useListings - CRUD operations for marketplace listings

import { useState, useCallback } from 'react';
import { supabase } from '@/integrations/supabase/client';
import type {
  CreateListingInput,
  CreateListingResult,
  CancelListingResult,
  MarketplaceListing
} from '../types';

interface UseListingsReturn {
  createListing: (input: CreateListingInput) => Promise<CreateListingResult>;
  cancelListing: (listingId: string) => Promise<CancelListingResult>;
  updateListing: (listingId: string, updates: Partial<Pick<MarketplaceListing, 'price_divi' | 'seller_description' | 'expires_at'>>) => Promise<{ success: boolean; error?: string }>;
  isCreating: boolean;
  isCanceling: boolean;
  isUpdating: boolean;
}

export function useListings(): UseListingsReturn {
  const [isCreating, setIsCreating] = useState(false);
  const [isCanceling, setIsCanceling] = useState(false);
  const [isUpdating, setIsUpdating] = useState(false);

  const createListing = useCallback(async (input: CreateListingInput): Promise<CreateListingResult> => {
    setIsCreating(true);

    try {
      const { data, error } = await supabase.rpc('marketplace_create_listing', {
        p_item_category: input.item_category,
        p_price_divi: input.price_divi,
        p_quantity: input.quantity,
        p_item_type: input.item_type ?? null,
        p_seed_definition_id: input.seed_definition_id ?? null,
        p_fruit_tier: input.fruit_tier ?? null,
        p_item_id: input.item_id ?? null,
        p_description: input.description ?? null,
        p_expires_at: input.expires_at ?? null,
      });

      if (error) {
        console.error('[useListings] Create error:', error);
        return { success: false, error: error.message };
      }

      return data as CreateListingResult;
    } catch (err) {
      console.error('[useListings] Create exception:', err);
      return { success: false, error: err instanceof Error ? err.message : 'Unknown error' };
    } finally {
      setIsCreating(false);
    }
  }, []);

  const cancelListing = useCallback(async (listingId: string): Promise<CancelListingResult> => {
    setIsCanceling(true);

    try {
      const { data, error } = await supabase.rpc('marketplace_cancel_listing', {
        p_listing_id: listingId,
      });

      if (error) {
        console.error('[useListings] Cancel error:', error);
        return { success: false, error: error.message };
      }

      return data as CancelListingResult;
    } catch (err) {
      console.error('[useListings] Cancel exception:', err);
      return { success: false, error: err instanceof Error ? err.message : 'Unknown error' };
    } finally {
      setIsCanceling(false);
    }
  }, []);

  const updateListing = useCallback(async (
    listingId: string,
    updates: Partial<Pick<MarketplaceListing, 'price_divi' | 'seller_description' | 'expires_at'>>
  ): Promise<{ success: boolean; error?: string }> => {
    setIsUpdating(true);

    try {
      const { error } = await supabase
        .from('marketplace_listings')
        .update(updates)
        .eq('id', listingId);

      if (error) {
        console.error('[useListings] Update error:', error);
        return { success: false, error: error.message };
      }

      return { success: true };
    } catch (err) {
      console.error('[useListings] Update exception:', err);
      return { success: false, error: err instanceof Error ? err.message : 'Unknown error' };
    } finally {
      setIsUpdating(false);
    }
  }, []);

  return {
    createListing,
    cancelListing,
    updateListing,
    isCreating,
    isCanceling,
    isUpdating,
  };
}
