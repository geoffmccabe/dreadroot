// WorldBoundsWall — safety-net mount of the arena-wall clamp for walled maps (e.g. Snowy Cabin).
// The AUTHORITATIVE clamp runs at the end of the mover (SiegeFlyController) so it always has the
// final say after movement; this component just calls the same shared clamp from a useFrame so any
// non-fly context is still covered. Both share module-level state in worldBoundsClamp, so calling
// it twice a frame is harmless (it only ever records positions that were already inside).
// A no-op on any world without a `wallBox`, so it's safe to mount globally.

import { useFrame, useThree } from '@react-three/fiber';
import { clampToWorldBounds } from './worldBoundsClamp';

export function WorldBoundsWall() {
  const camera = useThree((s) => s.camera);
  useFrame(() => clampToWorldBounds(camera));
  return null;
}
