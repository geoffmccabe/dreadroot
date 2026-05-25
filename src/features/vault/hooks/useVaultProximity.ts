// useVaultProximity — emits inRange whenever the camera enters the
// back-wall trigger AABB. Throttled to ~6Hz (every 10 frames) since the
// player can't enter/exit the zone faster than that and we don't want
// the proximity check to thrash React state every frame.

import { useState, useRef, useEffect } from 'react';
import { useFrame } from '@react-three/fiber';
import * as THREE from 'three';
import { isInVaultTriggerZone } from '../lib/anchors';

const CHECK_EVERY_N_FRAMES = 10;

interface UseVaultProximityOptions {
  cameraRef: React.RefObject<THREE.Camera>;
  enabled: boolean;
}

export function useVaultProximity({ cameraRef, enabled }: UseVaultProximityOptions) {
  const [inRange, setInRange] = useState(false);
  const frameCountRef = useRef(0);
  const lastRef = useRef(false);

  useFrame(() => {
    if (!enabled) return;
    frameCountRef.current++;
    if (frameCountRef.current % CHECK_EVERY_N_FRAMES !== 0) return;
    const cam = cameraRef.current;
    if (!cam) return;
    const now = isInVaultTriggerZone(cam.position.x, cam.position.y, cam.position.z);
    if (now !== lastRef.current) {
      lastRef.current = now;
      setInRange(now);
    }
  });

  // Reset on disable so a re-enable starts cleanly.
  useEffect(() => {
    if (!enabled) {
      setInRange(false);
      lastRef.current = false;
    }
  }, [enabled]);

  return inRange;
}
