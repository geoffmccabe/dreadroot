/**
 * Tree Growth Poller
 *
 * Automatically calls process_tree_growth() RPC at regular intervals
 * to grow trees server-side. Only polls when there are trees that
 * haven't finished growing.
 */

import { useEffect, useRef, useCallback } from 'react';
import { supabase } from '@/integrations/supabase/client';
import { recordPollResult, setPollerStatus } from '../lib/treeDiagnosticsStore';

const POLL_INTERVAL_MS = 10_000; // Poll every 10 seconds
const ERROR_BACKOFF_MS = 30_000; // Back off to 30s on errors

interface UseTreeGrowthPollerOptions {
  /** Whether there are any trees still growing */
  hasGrowingTrees: boolean;
  /** Whether the user is authenticated */
  enabled: boolean;
}

export function useTreeGrowthPoller({ hasGrowingTrees, enabled }: UseTreeGrowthPollerOptions) {
  const timerRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  const isPollingRef = useRef(false);
  const consecutiveErrorsRef = useRef(0);

  const pollGrowth = useCallback(async () => {
    if (isPollingRef.current) return;
    isPollingRef.current = true;

    try {
      // Call trigger_tree_growth (granted to authenticated users) which wraps process_tree_growth
      const { data, error } = await supabase.rpc('trigger_tree_growth');

      if (error) {
        // PGRST202 = function doesn't exist (migration not applied)
        if (error.code === 'PGRST202') {
          console.warn('[TreeGrowthPoller] trigger_tree_growth() not found - migration 20260126200000_server_side_tree_growth.sql not applied');
          consecutiveErrorsRef.current = 10; // Stop retrying frequently
          recordPollResult({ timestamp: Date.now(), treesProcessed: 0, treesCompleted: 0, blocksInserted: 0, error: 'Function not found (PGRST202) - apply migration' });
          return;
        }
        console.error('[TreeGrowthPoller] Error:', error.message);
        consecutiveErrorsRef.current++;
        recordPollResult({ timestamp: Date.now(), treesProcessed: 0, treesCompleted: 0, blocksInserted: 0, error: error.message });
        return;
      }

      consecutiveErrorsRef.current = 0;

      recordPollResult({
        timestamp: Date.now(),
        treesProcessed: data?.trees_processed ?? 0,
        treesCompleted: data?.trees_completed ?? 0,
        blocksInserted: data?.total_blocks_inserted ?? 0,
      });

      if (data?.total_blocks_inserted > 0) {
        console.log(
          `[TreeGrowthPoller] Grew ${data.total_blocks_inserted} blocks across ${data.trees_processed} trees`
        );
      } else if (data) {
        console.log(`[TreeGrowthPoller] Poll OK - ${data.trees_processed} trees checked, 0 blocks inserted`);
      }
    } catch (err) {
      console.error('[TreeGrowthPoller] Exception:', err);
      consecutiveErrorsRef.current++;
      recordPollResult({ timestamp: Date.now(), treesProcessed: 0, treesCompleted: 0, blocksInserted: 0, error: String(err) });
    } finally {
      isPollingRef.current = false;
    }
  }, []);

  useEffect(() => {
    if (!enabled || !hasGrowingTrees) {
      // Clear timer when disabled or no growing trees
      if (timerRef.current) {
        clearInterval(timerRef.current);
        timerRef.current = null;
      }
      setPollerStatus(false, 0);
      return;
    }

    // Start polling
    const interval = consecutiveErrorsRef.current > 3 ? ERROR_BACKOFF_MS : POLL_INTERVAL_MS;
    setPollerStatus(true, interval);
    console.log(`[TreeGrowthPoller] Starting - polling every ${interval / 1000}s`);
    timerRef.current = setInterval(pollGrowth, interval);

    // Run once immediately
    pollGrowth();

    return () => {
      if (timerRef.current) {
        clearInterval(timerRef.current);
        timerRef.current = null;
      }
    };
  }, [enabled, hasGrowingTrees, pollGrowth]);
}
