// useStore - Manage user's marketplace store

import { useState, useEffect, useCallback } from 'react';
import { supabase } from '@/integrations/supabase/client';
import type { MarketplaceStore } from '../types';
import { STORE_NAME_MAX_LENGTH, STORE_DESCRIPTION_MAX_LENGTH } from '../constants';

interface UseStoreReturn {
  store: MarketplaceStore | null;
  isLoading: boolean;
  error: string | null;
  createStore: (name: string, description?: string, bannerUrl?: string) => Promise<{ success: boolean; error?: string }>;
  updateStore: (updates: Partial<Pick<MarketplaceStore, 'store_name' | 'description' | 'banner_url' | 'is_active'>>) => Promise<{ success: boolean; error?: string }>;
  isSaving: boolean;
}

export function useStore(userId: string | null): UseStoreReturn {
  const [store, setStore] = useState<MarketplaceStore | null>(null);
  const [isLoading, setIsLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [isSaving, setIsSaving] = useState(false);

  const fetchStore = useCallback(async () => {
    if (!userId) {
      setStore(null);
      setIsLoading(false);
      return;
    }

    try {
      const { data, error: fetchError } = await supabase
        .from('marketplace_stores')
        .select('*')
        .eq('user_id', userId)
        .maybeSingle();

      if (fetchError) {
        console.error('[useStore] Fetch error:', fetchError);
        setError(fetchError.message);
        return;
      }

      setStore(data);
      setError(null);
    } catch (err) {
      console.error('[useStore] Error:', err);
      setError(err instanceof Error ? err.message : 'Unknown error');
    } finally {
      setIsLoading(false);
    }
  }, [userId]);

  // Initial fetch
  useEffect(() => {
    fetchStore();
  }, [fetchStore]);

  // Subscribe to realtime updates
  useEffect(() => {
    if (!userId) return;

    const channel = supabase
      .channel(`store_${userId}`)
      .on(
        'postgres_changes',
        {
          event: '*',
          schema: 'public',
          table: 'marketplace_stores',
          filter: `user_id=eq.${userId}`,
        },
        (payload) => {
          if (payload.eventType === 'INSERT' || payload.eventType === 'UPDATE') {
            setStore(payload.new as MarketplaceStore);
          } else if (payload.eventType === 'DELETE') {
            setStore(null);
          }
        }
      )
      .subscribe();

    return () => {
      supabase.removeChannel(channel);
    };
  }, [userId]);

  const createStore = useCallback(async (
    name: string,
    description?: string,
    bannerUrl?: string
  ): Promise<{ success: boolean; error?: string }> => {
    if (!userId) {
      return { success: false, error: 'Not authenticated' };
    }

    // Validate
    if (!name.trim()) {
      return { success: false, error: 'Store name is required' };
    }
    if (name.length > STORE_NAME_MAX_LENGTH) {
      return { success: false, error: `Store name must be ${STORE_NAME_MAX_LENGTH} characters or less` };
    }
    if (description && description.length > STORE_DESCRIPTION_MAX_LENGTH) {
      return { success: false, error: `Description must be ${STORE_DESCRIPTION_MAX_LENGTH} characters or less` };
    }

    setIsSaving(true);

    try {
      const { data, error: insertError } = await supabase
        .from('marketplace_stores')
        .insert({
          user_id: userId,
          store_name: name.trim(),
          description: description?.trim() || null,
          banner_url: bannerUrl?.trim() || null,
        })
        .select()
        .single();

      if (insertError) {
        console.error('[useStore] Create error:', insertError);
        if (insertError.code === '23505') {
          return { success: false, error: 'You already have a store' };
        }
        return { success: false, error: insertError.message };
      }

      setStore(data);
      return { success: true };
    } catch (err) {
      console.error('[useStore] Create exception:', err);
      return { success: false, error: err instanceof Error ? err.message : 'Unknown error' };
    } finally {
      setIsSaving(false);
    }
  }, [userId]);

  const updateStore = useCallback(async (
    updates: Partial<Pick<MarketplaceStore, 'store_name' | 'description' | 'banner_url' | 'is_active'>>
  ): Promise<{ success: boolean; error?: string }> => {
    if (!userId || !store) {
      return { success: false, error: 'No store to update' };
    }

    // Validate
    if (updates.store_name !== undefined) {
      if (!updates.store_name.trim()) {
        return { success: false, error: 'Store name is required' };
      }
      if (updates.store_name.length > STORE_NAME_MAX_LENGTH) {
        return { success: false, error: `Store name must be ${STORE_NAME_MAX_LENGTH} characters or less` };
      }
    }
    if (updates.description !== undefined && updates.description && updates.description.length > STORE_DESCRIPTION_MAX_LENGTH) {
      return { success: false, error: `Description must be ${STORE_DESCRIPTION_MAX_LENGTH} characters or less` };
    }

    setIsSaving(true);

    try {
      const { error: updateError } = await supabase
        .from('marketplace_stores')
        .update(updates)
        .eq('id', store.id);

      if (updateError) {
        console.error('[useStore] Update error:', updateError);
        return { success: false, error: updateError.message };
      }

      // Optimistic update
      setStore(prev => prev ? { ...prev, ...updates } : null);
      return { success: true };
    } catch (err) {
      console.error('[useStore] Update exception:', err);
      return { success: false, error: err instanceof Error ? err.message : 'Unknown error' };
    } finally {
      setIsSaving(false);
    }
  }, [userId, store]);

  return {
    store,
    isLoading,
    error,
    createStore,
    updateStore,
    isSaving,
  };
}
