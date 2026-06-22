// SiegeZoneWatcher — in-Canvas proximity check for the lobby vault/market zones. Throttled to
// ~6Hz (the player can't cross a 3-4m zone faster than that). Updates the siegeLobbyZones store,
// which drives the HUD prompts and the V keybind. Mounts only in Siege.
import { useRef, useMemo } from 'react';
import * as THREE from 'three';
import { useThree, useFrame } from '@react-three/fiber';
import { rangesAt, setLobbyRanges } from './siegeLobbyZones';

export function SiegeZoneWatcher() {
  const camera = useThree((s) => s.camera);
  const n = useRef(0);
  const p = useMemo(() => new THREE.Vector3(), []);
  useFrame(() => {
    if (++n.current % 10 !== 0) return;
    camera.getWorldPosition(p);   // world space (camera may be nested) → matches the zone coords
    const { v, m, f, p: portal } = rangesAt(p.x, p.z);
    setLobbyRanges(v, m, f, portal);
  });
  return null;
}
