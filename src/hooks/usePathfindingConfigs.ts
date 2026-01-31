/**
 * React Query hook for pathfinding configurations
 *
 * Fetches and caches pathfinding configs from the database.
 * Also updates the pathfinding service cache when data changes.
 */

import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query';
import { supabase } from '@/integrations/supabase/client';
import { pathfindingService } from '@/lib/pathfinding';
import type { PathfindingConfig, PathfindingConfigFormData } from '@/lib/pathfinding';
import { useEffect } from 'react';

const QUERY_KEY = ['pathfinding-configs'];

/**
 * Fetch all pathfinding configurations
 */
export function usePathfindingConfigs() {
  const query = useQuery({
    queryKey: QUERY_KEY,
    queryFn: async (): Promise<PathfindingConfig[]> => {
      const { data, error } = await supabase
        .from('pathfinding_configs')
        .select('*')
        .order('name', { ascending: true });

      if (error) {
        console.error('[usePathfindingConfigs] Error fetching:', error);
        throw error;
      }

      return (data as PathfindingConfig[]) || [];
    },
    staleTime: 1000 * 60 * 5, // 5 minutes
  });

  // Update service cache when data changes
  useEffect(() => {
    if (query.data) {
      pathfindingService.setConfigCache(query.data);
    }
  }, [query.data]);

  return query;
}

/**
 * Get a single pathfinding config by code
 */
export function usePathfindingConfig(code: string) {
  return useQuery({
    queryKey: [...QUERY_KEY, code],
    queryFn: async (): Promise<PathfindingConfig | null> => {
      const { data, error } = await supabase
        .from('pathfinding_configs')
        .select('*')
        .eq('code', code)
        .single();

      if (error) {
        if (error.code === 'PGRST116') {
          return null; // Not found
        }
        console.error('[usePathfindingConfig] Error fetching:', error);
        throw error;
      }

      return data as PathfindingConfig;
    },
    enabled: !!code,
  });
}

/**
 * Create a new pathfinding configuration
 */
export function useCreatePathfindingConfig() {
  const queryClient = useQueryClient();

  return useMutation({
    mutationFn: async (config: PathfindingConfigFormData): Promise<PathfindingConfig> => {
      const { data, error } = await supabase
        .from('pathfinding_configs')
        .insert(config)
        .select()
        .single();

      if (error) {
        console.error('[useCreatePathfindingConfig] Error creating:', error);
        throw error;
      }

      return data as PathfindingConfig;
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: QUERY_KEY });
    },
  });
}

/**
 * Update an existing pathfinding configuration
 */
export function useUpdatePathfindingConfig() {
  const queryClient = useQueryClient();

  return useMutation({
    mutationFn: async ({
      id,
      ...updates
    }: Partial<PathfindingConfigFormData> & { id: string }): Promise<PathfindingConfig> => {
      const { data, error } = await supabase
        .from('pathfinding_configs')
        .update(updates)
        .eq('id', id)
        .select()
        .single();

      if (error) {
        console.error('[useUpdatePathfindingConfig] Error updating:', error);
        throw error;
      }

      return data as PathfindingConfig;
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: QUERY_KEY });
    },
  });
}

/**
 * Delete a pathfinding configuration
 */
export function useDeletePathfindingConfig() {
  const queryClient = useQueryClient();

  return useMutation({
    mutationFn: async (id: string): Promise<void> => {
      const { error } = await supabase
        .from('pathfinding_configs')
        .delete()
        .eq('id', id);

      if (error) {
        console.error('[useDeletePathfindingConfig] Error deleting:', error);
        throw error;
      }
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: QUERY_KEY });
    },
  });
}

/**
 * Get available algorithms from the pathfinding service
 */
export function usePathfindingAlgorithms() {
  return useQuery({
    queryKey: ['pathfinding-algorithms'],
    queryFn: () => pathfindingService.getAlgorithms(),
    staleTime: Infinity, // Algorithms don't change at runtime
  });
}
