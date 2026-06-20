// In-Canvas preview for the Lights designer. When preview is on, the authored light
// rides the camera like a headlamp (points where you look) so you can sweep it across
// trees, ground and monsters and watch the beam/shadow/fog update live as you tune it.
import { useEffect, useRef } from 'react';
import * as THREE from 'three';
import { useThree } from '@react-three/fiber';
import { frameLoop } from '@/lib/frameLoop';
import { useLightStore } from './lightStore';
import { GameLight } from './GameLight';

export function LightsPreview() {
  const { previewOn, def } = useLightStore();
  const { camera } = useThree();
  const groupRef = useRef<THREE.Group>(null);

  useEffect(() => {
    if (!previewOn) return;
    const unreg = frameLoop.register('lights-preview-follow', () => {
      const g = groupRef.current;
      if (!g) return;
      g.position.copy(camera.position);
      g.quaternion.copy(camera.quaternion);
    }, 30); // high priority so it tracks the camera tightly
    return unreg;
  }, [previewOn, camera]);

  if (!previewOn) return null;
  return (
    <group ref={groupRef}>
      <GameLight def={def} idSuffix="preview" />
    </group>
  );
}
