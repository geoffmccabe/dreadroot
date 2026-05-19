// useWatchlist - Manage user's favorite listings

import { useState, useEffect, useCallback, useMemo } from 'react';
import { supabase } from '@/integrations/supabase/client';
import type { WatchlistItem, MarketplaceListing } from '../types';

interface UseWatchlistReturn {
  watchlist: WatchlistItem[];
  watchedIds: Set<string>;
  isWatched: (listingId: string) => boolean;
  toggleWatch: (listingId: string) => Promise<boolean>;
  isLoading: boolean;
  error: string | null;
}

export function useWatchlist(userId: string | null): UseWatchlistReturn {
  const [watchlist, setWatchlist] = useState<WatchlistItem[]>([]);
  const [isLoading, setIsLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  const watchedIds = useMemo(() => new Set(watchlist.map(w => w.listing_id)), [watchlist]);

  const fetchWatchlist = useCallback(async () => {
    if (!userId) {
      setWatchlist([]);
      setIsLoading(false);
      return;
    }

    try {
      const { data, error: fetchError } = await supabase
        .from('marketplace_watchlist')
        .select(`
          *,
          listing:marketplace_listings!listing_id(*)
        `)
        .eq('user_id', userId)
        .order('created_at', { ascending: false });

      if (fetchError) {
        console.error('[useWatchlist] Fetch error:', fetchError);
        setError(fetchError.message);
        return;
      }

      // Filter out items where listing is null (deleted)
      const validItems = (data ?? []).filter(
        (item): item is WatchlistItem & { listing: MarketplaceListing } =>
          item.listing !== null
      );

      setWatchlist(validItems);
      setError(null);
    } catch (err) {
      console.error('[useWatchlist] Error:', err);
      setError(err instanceof Error ? err.message : 'Unknown error');
    } finally {
      setIsLoading(false);
    }
  }, [userId]);

  // Initial fetch
  useEffect(() => {
    fetchWatchlist();
  }, [fetchWatchlist]);

  // Subscribe to realtime updates
  useEffect(() => {
    if (!userId) return;

    const channel = supabase
      .channel(`watchlist_${userId}-${Math.random().toString(36).slice(2)}`)
      .on(
        'postgres_changes',
        {
          event: '*',
          schema: 'public',
          table: 'marketplace_watchlist',
          filter: `user_id=eq.${userId}`,
        },
        () => {
          // Refetch to get joined data
          fetchWatchlist();
        }
      )
      .subscribe();

    return () => {
      supabase.removeChannel(channel);
    };
  }, [userId, fetchWatchlist]);

  const isWatched = useCallback((listingId: string): boolean => {
    return watchedIds.has(listingId);
  }, [watchedIds]);

  const toggleWatch = useCallback(async (listingId: string): Promise<boolean> => {
    if (!userId) return false;

    const currentlyWatched = watchedIds.has(listingId);

    try {
      if (currentlyWatched) {
        // Remove from watchlist
        const { error } = await supabase
          .from('marketplace_watchlist')
          .delete()
          .eq('user_id', userId)
          .eq('listing_id', listingId);

        if (error) {
          console.error('[useWatchlist] Remove error:', error);
          return false;
        }

        // Optimistic update
        setWatchlist(prev => prev.filter(w => w.listing_id !== listingId));
        return true;
      } else {
        // Add to watchlist
        const { data, error } = await supabase
          .from('marketplace_watchlist')
          .insert({ user_id: userId, listing_id: listingId })
          .select()
          .single();

        if (error) {
          console.error('[useWatchlist] Add error:', error);
          return false;
        }

        // Refetch to get joined listing data
        fetchWatchlist();
        return true;
      }
    } catch (err) {
      console.error('[useWatchlist] Toggle error:', err);
      return false;
    }
  }, [userId, watchedIds, fetchWatchlist]);

  return {
    watchlist,
    watchedIds,
    isWatched,
    toggleWatch,
    isLoading,
    error,
  };
}
