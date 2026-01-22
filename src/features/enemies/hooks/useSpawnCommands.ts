/**
 * Universal Spawn Command System
 * Handles !X## keyboard sequences for all enemy types:
 * - !1## = Shwarm (tier, no count)
 * - !2## = Shnake (tier, no count)
 * - !3## = Shombie (tier, count)
 */

import { useEffect, useRef, useCallback } from 'react';

const SEQUENCE_TIMEOUT_MS = 3000;

export interface SpawnCommandCallbacks {
  onSpawnShwarm?: (tier: number) => void;
  onSpawnShnake?: (tier: number) => void;
  onSpawnShombie?: (tier: number, count: number) => void;
}

interface UseSpawnCommandsOptions {
  isEnabled: boolean;
  isAdmin: boolean;
  callbacks: SpawnCommandCallbacks;
}

/**
 * Hook that handles the universal !X## spawn command sequence
 */
export function useSpawnCommands({
  isEnabled,
  isAdmin,
  callbacks,
}: UseSpawnCommandsOptions) {
  const sequenceRef = useRef<{
    step: number; // 0=idle, 1=got !, 2=got type, 3=got tier (shombie only, waiting for count)
    startTime: number;
    type: number | null; // 1=shwarm, 2=shnake, 3=shombie
    tier: number | null;
  }>({ step: 0, startTime: 0, type: null, tier: null });

  const resetSequence = useCallback(() => {
    sequenceRef.current = { step: 0, startTime: 0, type: null, tier: null };
  }, []);

  useEffect(() => {
    if (!isEnabled) return;

    console.log('[SpawnCommands] Keyboard listener mounted, isAdmin:', isAdmin);

    const handleKeyDown = (e: KeyboardEvent) => {
      // Skip if in input fields
      if (
        document.activeElement?.tagName === 'INPUT' ||
        document.activeElement?.tagName === 'TEXTAREA'
      ) {
        return;
      }

      const now = Date.now();
      const seq = sequenceRef.current;

      // Check for timeout
      if (seq.step > 0 && now - seq.startTime > SEQUENCE_TIMEOUT_MS) {
        console.log('[SpawnCommands] Sequence timeout, resetting');
        resetSequence();
      }

      // Step 0: Wait for "!" (Shift+1)
      if (seq.step === 0) {
        if (e.key === '!' || (e.shiftKey && e.key === '1')) {
          seq.step = 1;
          seq.startTime = now;
          console.log('[SpawnCommands] Sequence started - press 1=shwarm, 2=shnake, 3=shombie');
          return;
        }
        return;
      }

      // Step 1: Wait for enemy type (1, 2, or 3)
      if (seq.step === 1) {
        if (e.key === '1' || e.key === '2' || e.key === '3') {
          if (!isAdmin) {
            console.log('[SpawnCommands] Spawn denied - admin only');
            resetSequence();
            return;
          }
          seq.type = parseInt(e.key, 10);
          seq.step = 2;
          seq.startTime = now;
          const typeName = seq.type === 1 ? 'shwarm' : seq.type === 2 ? 'shnake' : 'shombie';
          console.log(`[SpawnCommands] Type: ${typeName} - press 1-9 (0=10) for tier`);
          return;
        }
        // Invalid key
        console.log('[SpawnCommands] Invalid type key:', e.key);
        resetSequence();
        return;
      }

      // Step 2: Wait for tier (0-9)
      if (seq.step === 2) {
        if (/^[0-9]$/.test(e.key)) {
          const tier = parseInt(e.key, 10);
          const actualTier = tier === 0 ? 10 : tier;
          
          // For shwarm and shnake, spawn immediately
          if (seq.type === 1) {
            console.log(`[SpawnCommands] Spawning shwarm tier ${actualTier}`);
            callbacks.onSpawnShwarm?.(actualTier);
            resetSequence();
            return;
          }
          
          if (seq.type === 2) {
            console.log(`[SpawnCommands] Spawning shnake tier ${actualTier}`);
            callbacks.onSpawnShnake?.(actualTier);
            resetSequence();
            return;
          }
          
          // For shombie, wait for count
          if (seq.type === 3) {
            seq.tier = tier;
            seq.step = 3;
            seq.startTime = now;
            console.log(`[SpawnCommands] Shombie tier ${actualTier} - press 1-9 (0=10) for count, or wait for 1`);
            
            // Auto-spawn 1 after delay if no count entered
            const tierCapture = tier;
            setTimeout(() => {
              if (sequenceRef.current.step === 3 && sequenceRef.current.tier === tierCapture) {
                const t = tierCapture === 0 ? 10 : tierCapture;
                console.log(`[SpawnCommands] Auto-spawning 1 shombie tier ${t}`);
                callbacks.onSpawnShombie?.(t, 1);
                resetSequence();
              }
            }, 800);
            return;
          }
        }
        // Invalid key
        console.log('[SpawnCommands] Invalid tier key:', e.key);
        resetSequence();
        return;
      }

      // Step 3: Wait for count (shombie only)
      if (seq.step === 3) {
        if (/^[0-9]$/.test(e.key)) {
          const count = parseInt(e.key, 10);
          const actualCount = count === 0 ? 10 : count;
          const actualTier = seq.tier === 0 ? 10 : seq.tier!;
          
          console.log(`[SpawnCommands] Spawning ${actualCount} shombie(s) tier ${actualTier}`);
          callbacks.onSpawnShombie?.(actualTier, actualCount);
          resetSequence();
          return;
        }
        // Any other key spawns 1
        const actualTier = seq.tier === 0 ? 10 : seq.tier!;
        console.log(`[SpawnCommands] Spawning 1 shombie tier ${actualTier}`);
        callbacks.onSpawnShombie?.(actualTier, 1);
        resetSequence();
        return;
      }
    };

    window.addEventListener('keydown', handleKeyDown);
    return () => window.removeEventListener('keydown', handleKeyDown);
  }, [isEnabled, isAdmin, callbacks, resetSequence]);
}
