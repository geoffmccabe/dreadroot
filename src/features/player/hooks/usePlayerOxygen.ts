/**
 * usePlayerOxygen Hook
 *
 * Manages player oxygen for underwater swimming:
 * - Drains oxygen when underwater
 * - Restores oxygen when surfaced
 * - Triggers drowning damage when depleted
 * - Level-based max oxygen scaling
 */

import { useCallback, useEffect, useRef, useState } from 'react';

// ============================================
// Types
// ============================================

export interface OxygenState {
  currentOxygen: number;      // 0 to maxOxygen (in units, 10 units = 1 second)
  maxOxygen: number;          // Base 100 + (playerLevel * 10)
  isUnderwater: boolean;
  isDrowning: boolean;
  secondsRemaining: number;   // For HUD display
}

export interface UsePlayerOxygenOptions {
  playerLevel: number;
  isUnderwater: boolean;
  waterType: 'water' | 'lava' | null;
  onDrowningDamage?: (damage: number) => void;
  onOxygenStateChange?: (state: OxygenState) => void;
}

// ============================================
// Constants
// ============================================

const BASE_MAX_OXYGEN = 100;           // Base oxygen (10 seconds)
const OXYGEN_PER_LEVEL = 10;           // +10 per level (+1 second)
const DRAIN_RATE = 10;                 // Units per second underwater
const RESTORE_RATE = 100;              // Units per second when surfaced (10x drain)
const DROWNING_DAMAGE = 2;             // HP per second when oxygen = 0
const DROWNING_TICK_MS = 500;          // Drowning damage every 0.5s

// ============================================
// Hook
// ============================================

export function usePlayerOxygen({
  playerLevel,
  isUnderwater,
  waterType,
  onDrowningDamage,
  onOxygenStateChange,
}: UsePlayerOxygenOptions): OxygenState {
  // Calculate max oxygen based on level
  const maxOxygen = BASE_MAX_OXYGEN + (playerLevel * OXYGEN_PER_LEVEL);

  // State
  const [oxygenState, setOxygenState] = useState<OxygenState>({
    currentOxygen: maxOxygen,
    maxOxygen,
    isUnderwater: false,
    isDrowning: false,
    secondsRemaining: maxOxygen / 10,
  });

  // Refs for tick handling
  const lastTickRef = useRef(Date.now());
  const currentOxygenRef = useRef(maxOxygen);
  const drowningTickRef = useRef(0);

  // Update max oxygen when level changes
  useEffect(() => {
    const newMax = BASE_MAX_OXYGEN + (playerLevel * OXYGEN_PER_LEVEL);

    setOxygenState(prev => {
      // If max increased, current can stay the same or increase
      // If max decreased (unlikely), cap current at new max
      const newCurrent = Math.min(prev.currentOxygen, newMax);

      return {
        ...prev,
        maxOxygen: newMax,
        currentOxygen: newCurrent,
        secondsRemaining: Math.ceil(newCurrent / 10),
      };
    });
  }, [playerLevel]);

  // Main oxygen tick logic
  useEffect(() => {
    const tickInterval = setInterval(() => {
      const now = Date.now();
      const dt = (now - lastTickRef.current) / 1000; // Delta in seconds
      lastTickRef.current = now;

      setOxygenState(prev => {
        let newOxygen = prev.currentOxygen;
        let isDrowning = false;

        if (isUnderwater && waterType === 'water') {
          // Drain oxygen underwater (lava doesn't use oxygen - it just burns)
          newOxygen = Math.max(0, newOxygen - DRAIN_RATE * dt);

          // Drowning damage when oxygen depleted
          if (newOxygen === 0) {
            isDrowning = true;
            drowningTickRef.current += dt * 1000;

            if (drowningTickRef.current >= DROWNING_TICK_MS) {
              drowningTickRef.current -= DROWNING_TICK_MS;
              onDrowningDamage?.(DROWNING_DAMAGE);
            }
          }
        } else {
          // Restore oxygen when not underwater (or in lava - different damage)
          newOxygen = Math.min(prev.maxOxygen, newOxygen + RESTORE_RATE * dt);
          drowningTickRef.current = 0;
        }

        currentOxygenRef.current = newOxygen;

        const newState: OxygenState = {
          currentOxygen: newOxygen,
          maxOxygen: prev.maxOxygen,
          isUnderwater: isUnderwater && waterType === 'water',
          isDrowning,
          secondsRemaining: Math.ceil(newOxygen / 10),
        };

        // Notify state change
        onOxygenStateChange?.(newState);

        return newState;
      });
    }, 100); // Tick every 100ms for smooth drain/restore

    return () => clearInterval(tickInterval);
  }, [isUnderwater, waterType, onDrowningDamage, onOxygenStateChange]);

  return oxygenState;
}

/**
 * Get formatted oxygen display for HUD
 */
export function formatOxygenDisplay(state: OxygenState): string {
  if (!state.isUnderwater) return '';

  const seconds = state.secondsRemaining;
  const bubbleIcon = '\u25CF'; // Filled circle as bubble

  return `${bubbleIcon} ${seconds}s`;
}

/**
 * Check if oxygen is critically low (for pulse animation)
 */
export function isOxygenCritical(state: OxygenState): boolean {
  return state.isUnderwater && state.secondsRemaining <= 3;
}
