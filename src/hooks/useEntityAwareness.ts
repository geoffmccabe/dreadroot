/**
 * Universal Entity Awareness Hook
 *
 * React hook that enemies/NPCs use to subscribe to player tracking
 * with automatic updates and LoS checking.
 *
 * Features:
 * - Automatic player detection within awareness radius
 * - Throttled LoS checks for performance
 * - Nearest player tracking
 * - Direction and distance helpers
 */

import { useRef, useCallback, useMemo } from 'react';
import { useFrame } from '@react-three/fiber';
import * as THREE from 'three';
import { PlacedBlock } from '@/types/blocks';
import { playerTracker, PlayerState } from '@/lib/playerTracker';
import {
  hasLineOfSight,
  getVisiblePlayers,
  getNearestVisiblePlayer,
  LineOfSightOptions,
} from '@/lib/lineOfSight';

export interface EntityAwarenessOptions {
  /** How far to detect players (blocks) */
  awarenessRadius?: number;
  /** How often to check LoS (ms) - higher = better perf */
  losCheckInterval?: number;
  /** Enable/disable the hook */
  enabled?: boolean;
  /** Height offset for LoS checks (e.g., eye level) */
  eyeHeight?: number;
  /** Target height on players for LoS */
  targetHeight?: number;
}

export interface EntityAwarenessResult {
  /** All players within awareness radius */
  nearbyPlayers: PlayerState[];
  /** Closest player (may not be visible) */
  nearestPlayer: PlayerState | null;
  /** Players with clear line of sight */
  visiblePlayers: PlayerState[];
  /** Closest visible player */
  nearestVisiblePlayer: PlayerState | null;
  /** Distance to nearest player */
  nearestPlayerDistance: number | null;
  /** Distance to nearest visible player */
  nearestVisiblePlayerDistance: number | null;

  // Manual query functions
  /** Check LoS to a specific position */
  canSee: (targetPos: THREE.Vector3) => boolean;
  /** Get direction to a player */
  getPlayerDirection: (playerId: string) => THREE.Vector3 | null;
  /** Get distance to a player */
  getPlayerDistance: (playerId: string) => number | null;
  /** Update entity position (call each frame) */
  updatePosition: (pos: THREE.Vector3) => void;
}

/**
 * Hook for entity awareness of players
 *
 * @param blocks - Current world blocks (for LoS checks)
 * @param options - Configuration options
 */
export function useEntityAwareness(
  blocks: PlacedBlock[],
  options: EntityAwarenessOptions = {}
): EntityAwarenessResult {
  const {
    awarenessRadius = 32,
    losCheckInterval = 100,
    enabled = true,
    eyeHeight = 1.5,
    targetHeight = 1.0,
  } = options;

  // Current entity position
  const positionRef = useRef(new THREE.Vector3());

  // Cached results (updated periodically)
  const nearbyPlayersRef = useRef<PlayerState[]>([]);
  const nearestPlayerRef = useRef<PlayerState | null>(null);
  const visiblePlayersRef = useRef<PlayerState[]>([]);
  const nearestVisiblePlayerRef = useRef<PlayerState | null>(null);
  const nearestPlayerDistanceRef = useRef<number | null>(null);
  const nearestVisiblePlayerDistanceRef = useRef<number | null>(null);

  // Timing
  const lastLosCheckRef = useRef(0);
  const lastRangeCheckRef = useRef(0);

  // LoS options (memoized)
  const losOptions = useMemo<LineOfSightOptions>(
    () => ({
      maxDistance: awarenessRadius,
      observerHeight: eyeHeight,
      targetHeight: targetHeight,
    }),
    [awarenessRadius, eyeHeight, targetHeight]
  );

  // Update position function
  const updatePosition = useCallback((pos: THREE.Vector3) => {
    positionRef.current.copy(pos);
  }, []);

  // Manual LoS check
  const canSee = useCallback(
    (targetPos: THREE.Vector3): boolean => {
      if (!enabled) return false;
      const result = hasLineOfSight(positionRef.current, targetPos, blocks, losOptions);
      return result.visible;
    },
    [blocks, losOptions, enabled]
  );

  // Get direction to player
  const getPlayerDirection = useCallback(
    (playerId: string): THREE.Vector3 | null => {
      return playerTracker.getDirectionToPlayer(positionRef.current, playerId);
    },
    []
  );

  // Get distance to player
  const getPlayerDistance = useCallback(
    (playerId: string): number | null => {
      return playerTracker.getDistanceToPlayer(positionRef.current, playerId);
    },
    []
  );

  // Frame update - throttled checks
  useFrame(() => {
    if (!enabled) return;

    const now = performance.now();
    const pos = positionRef.current;

    // Range check (fast, every frame or 50ms)
    if (now - lastRangeCheckRef.current > 50) {
      lastRangeCheckRef.current = now;

      // Get nearby players (fast spatial query)
      nearbyPlayersRef.current = playerTracker.getPlayersInRange(pos, awarenessRadius);

      // Find nearest player
      let nearest: PlayerState | null = null;
      let nearestDist = Infinity;

      for (const player of nearbyPlayersRef.current) {
        const dist = pos.distanceTo(player.position);
        if (dist < nearestDist) {
          nearestDist = dist;
          nearest = player;
        }
      }

      nearestPlayerRef.current = nearest;
      nearestPlayerDistanceRef.current = nearest ? nearestDist : null;
    }

    // LoS check (slower, configurable interval)
    if (now - lastLosCheckRef.current > losCheckInterval) {
      lastLosCheckRef.current = now;

      // Only check LoS if there are nearby players
      if (nearbyPlayersRef.current.length > 0) {
        visiblePlayersRef.current = getVisiblePlayers(pos, blocks, losOptions);

        // Find nearest visible player
        const nearestVisible = getNearestVisiblePlayer(pos, blocks, losOptions);
        nearestVisiblePlayerRef.current = nearestVisible;
        nearestVisiblePlayerDistanceRef.current = nearestVisible
          ? pos.distanceTo(nearestVisible.position)
          : null;
      } else {
        visiblePlayersRef.current = [];
        nearestVisiblePlayerRef.current = null;
        nearestVisiblePlayerDistanceRef.current = null;
      }
    }
  });

  return {
    nearbyPlayers: nearbyPlayersRef.current,
    nearestPlayer: nearestPlayerRef.current,
    visiblePlayers: visiblePlayersRef.current,
    nearestVisiblePlayer: nearestVisiblePlayerRef.current,
    nearestPlayerDistance: nearestPlayerDistanceRef.current,
    nearestVisiblePlayerDistance: nearestVisiblePlayerDistanceRef.current,
    canSee,
    getPlayerDirection,
    getPlayerDistance,
    updatePosition,
  };
}

/**
 * Lightweight version for non-React contexts (e.g., in useFrame callbacks)
 * Call this directly instead of using the hook
 */
export function checkEntityAwareness(
  position: THREE.Vector3,
  blocks: PlacedBlock[],
  awarenessRadius: number = 32,
  options: LineOfSightOptions = {}
): {
  nearbyPlayers: PlayerState[];
  nearestPlayer: PlayerState | null;
  nearestPlayerDistance: number | null;
  visiblePlayers: PlayerState[];
  nearestVisiblePlayer: PlayerState | null;
} {
  const nearbyPlayers = playerTracker.getPlayersInRange(position, awarenessRadius);

  // Find nearest
  let nearestPlayer: PlayerState | null = null;
  let nearestPlayerDistance: number | null = null;

  for (const player of nearbyPlayers) {
    const dist = position.distanceTo(player.position);
    if (nearestPlayerDistance === null || dist < nearestPlayerDistance) {
      nearestPlayerDistance = dist;
      nearestPlayer = player;
    }
  }

  // Check visibility
  const visiblePlayers = getVisiblePlayers(position, blocks, {
    maxDistance: awarenessRadius,
    ...options,
  });

  const nearestVisiblePlayer = getNearestVisiblePlayer(position, blocks, {
    maxDistance: awarenessRadius,
    ...options,
  });

  return {
    nearbyPlayers,
    nearestPlayer,
    nearestPlayerDistance,
    visiblePlayers,
    nearestVisiblePlayer,
  };
}
