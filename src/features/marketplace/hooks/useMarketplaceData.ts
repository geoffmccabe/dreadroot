// useMarketplaceData - Fetches and manages marketplace listings with filters and sorting

import { useState, useEffect, useCallback, useRef } from 'react';
import { supabase } from '@/integrations/supabase/client';
import type { MarketplaceListing, MarketplaceFilters, MarketplaceSortOption } from '../types';
import { SORT_CONFIG, LISTINGS_PER_PAGE } from '../constants';

interface UseMarketplaceDataOptions {
  filters?: MarketplaceFilters;
  sortOption?: MarketplaceSortOption;
  pageSize?: number;
}

interface UseMarketplaceDataReturn {
  listings: MarketplaceListing[];
  isLoading: boolean;
  error: string | null;
  hasMore: boolean;
  loadMore: () => Promise<void>;
  refetch: () => Promise<void>;
  totalCount: number;
}

export function useMarketplaceData(options: UseMarketplaceDataOptions = {}): UseMarketplaceDataReturn {
  const { filters = {}, sortOption = 'date_desc', pageSize = LISTINGS_PER_PAGE } = options;

  const [listings, setListings] = useState<MarketplaceListing[]>([]);
  const [isLoading, setIsLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [hasMore, setHasMore] = useState(true);
  const [totalCount, setTotalCount] = useState(0);
  const offsetRef = useRef(0);

  const buildQuery = useCallback(() => {
    let query = supabase
      .from('marketplace_listings')
      .select(`
        *,
        seller_profile:user_profiles!marketplace_listings_seller_profile_fkey(display_name, avatar_url),
        store:marketplace_stores!store_id(id, store_name, banner_url, is_active),
        seed_definition:seed_definitions!seed_definition_id(id, name, tier, rarity, trunk_texture_url)
      `, { count: 'exact' })
      .eq('is_active', true);

    // Apply category filter
    if (filters.category) {
      query = query.eq('item_category', filters.category);
    }

    // Apply seller filter
    if (filters.seller_id) {
      query = query.eq('seller_id', filters.seller_id);
    }

    // Apply tier filters (works for both seeds and fruits)
    if (filters.tier_min !== undefined) {
      query = query.or(`seed_tier.gte.${filters.tier_min},fruit_tier.gte.${filters.tier_min}`);
    }
    if (filters.tier_max !== undefined) {
      query = query.or(`seed_tier.lte.${filters.tier_max},fruit_tier.lte.${filters.tier_max}`);
    }

    // Apply price filters
    if (filters.price_min !== undefined) {
      query = query.gte('price_divi', filters.price_min);
    }
    if (filters.price_max !== undefined) {
      query = query.lte('price_divi', filters.price_max);
    }

    // Apply expiring soon filter
    if (filters.expiring_soon) {
      const tomorrow = new Date();
      tomorrow.setHours(tomorrow.getHours() + 24);
      query = query
        .not('expires_at', 'is', null)
        .lte('expires_at', tomorrow.toISOString())
        .gt('expires_at', new Date().toISOString());
    }

    // Apply sorting
    const sortConfig = SORT_CONFIG[sortOption];
    if (sortOption === 'expiring_soon') {
      // For expiring soon, filter out permanent listings
      query = query
        .not('expires_at', 'is', null)
        .order('expires_at', { ascending: true, nullsFirst: false });
    } else if (sortOption === 'tier_asc' || sortOption === 'tier_desc') {
      // Sort by coalesced tier (seed_tier or fruit_tier)
      query = query
        .order('seed_tier', { ascending: sortConfig.ascending, nullsFirst: false })
        .order('fruit_tier', { ascending: sortConfig.ascending, nullsFirst: false });
    } else {
      query = query.order(sortConfig.field, { ascending: sortConfig.ascending });
    }

    return query;
  }, [filters, sortOption]);

  const fetchListings = useCallback(async (reset = false) => {
    setIsLoading(true);
    setError(null);

    const offset = reset ? 0 : offsetRef.current;

    try {
      const query = buildQuery()
        .range(offset, offset + pageSize - 1);

      const { data, error: fetchError, count } = await query;

      if (fetchError) {
        console.error('[useMarketplaceData] Fetch error:', fetchError);
        setError(fetchError.message);
        return;
      }

      let newListings = data as MarketplaceListing[];

      // Fetch block definitions for block listings (no FK relationship)
      const blockListings = newListings.filter(l => l.item_category === 'block' && l.item_type);
      if (blockListings.length > 0) {
        const blockKeys = [...new Set(blockListings.map(l => l.item_type!))];
        const { data: blockDefs } = await supabase
          .from('blocks')
          .select('key, name, category, rarity, texture_url')
          .in('key', blockKeys);

        if (blockDefs) {
          const blockDefMap = new Map(blockDefs.map(b => [b.key, b]));
          newListings = newListings.map(l => {
            if (l.item_category === 'block' && l.item_type && blockDefMap.has(l.item_type)) {
              return { ...l, block_definition: blockDefMap.get(l.item_type) };
            }
            return l;
          });
        }
      }

      // Apply text search filter (client-side since it spans multiple fields)
      if (filters.search) {
        const searchLower = filters.search.toLowerCase();
        newListings = newListings.filter(l => {
          // Search in item_type
          if (l.item_type?.toLowerCase().includes(searchLower)) return true;
          // Search in seller description
          if (l.seller_description?.toLowerCase().includes(searchLower)) return true;
          // Search in block name/category
          if (l.block_definition?.name?.toLowerCase().includes(searchLower)) return true;
          if (l.block_definition?.category?.toLowerCase().includes(searchLower)) return true;
          // Search in seed name
          if (l.seed_definition?.name?.toLowerCase().includes(searchLower)) return true;
          // Search in category
          if (l.item_category.toLowerCase().includes(searchLower)) return true;
          // Search in store name
          if (l.store?.store_name?.toLowerCase().includes(searchLower)) return true;
          return false;
        });
      }

      if (reset) {
        setListings(newListings);
        offsetRef.current = pageSize;
      } else {
        setListings(prev => [...prev, ...newListings]);
        offsetRef.current += pageSize;
      }

      setTotalCount(count ?? 0);
      setHasMore(newListings.length === pageSize);
    } catch (err) {
      console.error('[useMarketplaceData] Error:', err);
      setError(err instanceof Error ? err.message : 'Unknown error');
    } finally {
      setIsLoading(false);
    }
  }, [buildQuery, pageSize, filters.search]);

  // Initial fetch and refetch on filter/sort change
  useEffect(() => {
    fetchListings(true);
  }, [fetchListings]);

  // Subscribe to realtime updates
  useEffect(() => {
    const channel = supabase
      .channel('marketplace_listings_changes')
      .on(
        'postgres_changes',
        {
          event: '*',
          schema: 'public',
          table: 'marketplace_listings',
        },
        (payload) => {
          if (payload.eventType === 'INSERT') {
            // Refetch to get joined data and maintain sort order
            fetchListings(true);
          } else if (payload.eventType === 'UPDATE') {
            const updated = payload.new as MarketplaceListing;
            setListings(prev =>
              prev.map(l => l.id === updated.id ? { ...l, ...updated } : l)
                .filter(l => l.is_active)
            );
          } else if (payload.eventType === 'DELETE') {
            const deleted = payload.old as { id: string };
            setListings(prev => prev.filter(l => l.id !== deleted.id));
          }
        }
      )
      .subscribe();

    return () => {
      supabase.removeChannel(channel);
    };
  }, []); // eslint-disable-line react-hooks/exhaustive-deps

  const loadMore = useCallback(async () => {
    if (hasMore && !isLoading) {
      await fetchListings(false);
    }
  }, [hasMore, isLoading, fetchListings]);

  const refetch = useCallback(async () => {
    await fetchListings(true);
  }, [fetchListings]);

  return {
    listings,
    isLoading,
    error,
    hasMore,
    loadMore,
    refetch,
    totalCount,
  };
}
