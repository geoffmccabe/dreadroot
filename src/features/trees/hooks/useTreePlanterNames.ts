// Hook to fetch display names for tree planters
// Uses blockchain_address from user_profiles (or truncated user_id as fallback)

import { useState, useEffect, useMemo } from 'react';
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
  
  // Get unique user IDs from planted trees
  const uniqueUserIds = useMemo(() => {
    const ids = new Set<string>();
    for (const tree of plantedTrees) {
      if (tree.planted_by) {
        ids.add(tree.planted_by);
      }
    }
    return Array.from(ids);
  }, [plantedTrees]);
  
  // Fetch user profiles when user IDs change
  useEffect(() => {
    if (uniqueUserIds.length === 0) {
      setUsernamesMap(new Map());
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
          console.error('[TreePlanterNames] Error fetching profiles:', error);
          // Fallback to truncated user IDs
          const fallbackMap = new Map<string, string>();
          for (const userId of uniqueUserIds) {
            fallbackMap.set(userId, truncateId(userId));
          }
          setUsernamesMap(fallbackMap);
          return;
        }
        
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
  }, [uniqueUserIds]);
  
  return {
    usernamesMap,
    isLoading,
  };
}
