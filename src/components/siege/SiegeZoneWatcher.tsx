// SiegeZoneWatcher — in-Canvas proximity check for the lobby vault/market zones. Throttled to
// ~6Hz (the player can't cross a 3-4m zone faster than that). Updates the siegeLobbyZones store,
// which drives the HUD prompts and the V keybind. Mounts only in Siege.
import { useRef } from 'react';
import { useThree, useFrame } from '@react-three/fiber';
import { rangesAt, setLobbyRanges } from './siegeLobbyZones';

export function SiegeZoneWatcher() {
  const camera = useThree((s) => s.camera);
  const n = useRef(0);
  useFrame(() => {
    if (++n.current % 10 !== 0) return;
    const p = camera.position;
    const { v, m } = rangesAt(p.x, p.z);
    setLobbyRanges(v, m);
  });
  return null;
}
