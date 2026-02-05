// Hook to fetch display names for tree planters
// Uses blockchain_address from user_profiles (or truncated user_id as fallback)

import { useState, useEffect, useMemo, useRef } from 'react';
import { supabase } from '@/integrations/supabase/client';
import { PlantedTree } from '../types';

// Truncate user ID or address for display
function truncateId(id: string): string {
  if (id.length <= 12) return id;
  return `${id.slice(0, 6)}...${id.slice(-4)}`;
}

export function useTreePlanterNames(plantedTrees: PlantedTree[]) {
  const [usernamesMap, setUsernamesMap] = useState<Map<string, string>>(new Map());
  const [isLoading, setIsLoading] = useState(false);
  const lastFetchedIdsRef = useRef<string>('');
  const errorCountRef = useRef(0);

  // Get unique user IDs from planted trees - create stable string key
  const { uniqueUserIds, userIdsKey } = useMemo(() => {
    const ids = new Set<string>();
    for (const tree of plantedTrees) {
      if (tree.planted_by) {
        ids.add(tree.planted_by);
      }
    }
    const idsArray = Array.from(ids).sort();
    return { uniqueUserIds: idsArray, userIdsKey: idsArray.join(',') };
  }, [plantedTrees]);

  // Fetch user profiles when user IDs change
  useEffect(() => {
    if (uniqueUserIds.length === 0) {
      setUsernamesMap(new Map());
      return;
    }

    // Skip if we already fetched these IDs
    if (lastFetchedIdsRef.current === userIdsKey) {
      return;
    }

    const fetchUserProfiles = async () => {
      setIsLoading(true);
      try {
        const { data, error } = await supabase
          .from('user_profiles')
          .select('user_id, blockchain_address')
          .in('user_id', uniqueUserIds);

        if (error) {
          // Only log first 3 errors to avoid spam during network issues
          if (errorCountRef.current < 3) {
            console.error('[TreePlanterNames] Error fetching profiles:', error);
            errorCountRef.current++;
          }
          // Fallback to truncated user IDs
          const fallbackMap = new Map<string, string>();
          for (const userId of uniqueUserIds) {
            fallbackMap.set(userId, truncateId(userId));
          }
          setUsernamesMap(fallbackMap);
          return;
        }

        // Reset error count on success
        errorCountRef.current = 0;
        lastFetchedIdsRef.current = userIdsKey;
        
        const newMap = new Map<string, string>();
        const foundUserIds = new Set<string>();
        
        for (const profile of data || []) {
          if (profile.user_id) {
            foundUserIds.add(profile.user_id);
            // Use blockchain address if available, otherwise truncated user_id
            const displayName = profile.blockchain_address 
              ? truncateId(profile.blockchain_address)
              : truncateId(profile.user_id);
            newMap.set(profile.user_id, displayName);
          }
        }
        
        // Add fallback for any user IDs not found in profiles
        for (const userId of uniqueUserIds) {
          if (!foundUserIds.has(userId)) {
            newMap.set(userId, truncateId(userId));
          }
        }
        
        setUsernamesMap(newMap);
      } catch (err) {
        console.error('[TreePlanterNames] Unexpected error:', err);
        // Fallback to truncated user IDs
        const fallbackMap = new Map<string, string>();
        for (const userId of uniqueUserIds) {
          fallbackMap.set(userId, truncateId(userId));
        }
        setUsernamesMap(fallbackMap);
      } finally {
        setIsLoading(false);
      }
    };
    
    fetchUserProfiles();
  }, [uniqueUserIds, userIdsKey]);
  
  return {
    usernamesMap,
    isLoading,
  };
}
