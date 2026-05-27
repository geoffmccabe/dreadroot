// In-scene watcher: emits true whenever at least one growing tree is
// within view range of the camera, false otherwise. Used by the tree
// growth poller to switch to a 1s cadence for visible smooth growth
// vs. 10s when nothing nearby cares about real-time updates.

import React, { useRef, useEffect } from 'react';
import { useFrame } from '@react-three/fiber';
import * as THREE from 'three';
import type { PlantedTree } from '../types';

// Sample every ~10 frames to keep per-frame cost negligible.
const FRAMES_PER_CHECK = 10;
// "Near" = within this many blocks horizontally. Loosely matches the
// player's render distance (4-10 chunks × 16 blocks). Tighter than
// the full chunk-load range so we don't fire fast polls for trees
// the player isn't actually watching.
const NEAR_DISTANCE_BLOCKS = 80;
const NEAR_DISTANCE_SQ = NEAR_DISTANCE_BLOCKS * NEAR_DISTANCE_BLOCKS;

interface Props {
  cameraRef: React.RefObject<THREE.Camera>;
  growingTrees: PlantedTree[];
  onChange: (nearby: boolean) => void;
}

export function GrowthProximityWatcher({ cameraRef, growingTrees, onChange }: Props) {
  const frameRef = useRef(0);
  const lastValueRef = useRef<boolean | null>(null);

  // Hold growing trees in a ref so the per-frame check doesn't
  // re-allocate the callback. Updated on every prop change.
  const treesRef = useRef<PlantedTree[]>(growingTrees);
  useEffect(() => { treesRef.current = growingTrees; }, [growingTrees]);

  useFrame(() => {
    frameRef.current++;
    if (frameRef.current % FRAMES_PER_CHECK !== 0) return;
    const cam = cameraRef.current;
    if (!cam) return;
    const cx = cam.position.x;
    const cz = cam.position.z;

    let nearby = false;
    const trees = treesRef.current;
    for (let i = 0; i < trees.length; i++) {
      const t = trees[i];
      const dx = t.base_x - cx;
      const dz = t.base_z - cz;
      if (dx * dx + dz * dz <= NEAR_DISTANCE_SQ) {
        nearby = true;
        break;
      }
    }
    if (nearby !== lastValueRef.current) {
      lastValueRef.current = nearby;
      onChange(nearby);
    }
  });

  return null;
}
