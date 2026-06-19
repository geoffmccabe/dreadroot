// In-Canvas chop feedback: on each axe hit, the chopped block briefly flashes a
// rainbow wireframe around every face and pulses inward ~5% toward its center,
// then snaps back to normal. Driven by chopFeedbackStore (triggerChop). One reused
// LineSegments overlay — zero per-frame allocations, hidden when no recent chop.
import { useEffect, useMemo, useRef } from 'react';
import * as THREE from 'three';
import { frameLoop } from '@/lib/frameLoop';
import { getChopPulse } from './chopFeedbackStore';

const PULSE_MS = 250;     // shorter than the 350ms chop interval → reverts between chops
const SHRINK = 0.05;      // 5% inward at the peak of the pulse

export function ChopFeedback() {
  const groupRef = useRef<THREE.Group>(null);
  const matRef = useRef<THREE.LineBasicMaterial>(null);

  // Unit-cube edges, very slightly inset so the lines hug the block faces.
  const edges = useMemo(() => new THREE.EdgesGeometry(new THREE.BoxGeometry(1, 1, 1)), []);
  useEffect(() => () => edges.dispose(), [edges]);

  useEffect(() => {
    const unregister = frameLoop.register('chop-feedback', () => {
      const g = groupRef.current;
      const mat = matRef.current;
      if (!g || !mat) return;

      const pulse = getChopPulse();
      const age = (typeof performance !== 'undefined' ? performance.now() : 0) - pulse.t;

      if (age < 0 || age > PULSE_MS) {
        if (g.visible) g.visible = false;
        return;
      }

      g.visible = true;
      // Center on the block (block min-corner + 0.5 on each axis).
      g.position.set(pulse.x + 0.5, pulse.y + 0.5, pulse.z + 0.5);

      // p: 0 → 1 across the pulse. sin gives a smooth out-and-back (vibrate).
      const p = age / PULSE_MS;
      const env = Math.sin(p * Math.PI); // 0 → 1 → 0
      const s = 1 - SHRINK * env;        // 1 → 0.95 → 1
      g.scale.set(s, s, s);

      // Rainbow hue cycles fast for a shimmering flash; opacity flashes with the envelope.
      const hue = (age / PULSE_MS + pulse.t * 0.0005) % 1;
      mat.color.setHSL(hue, 1, 0.55);
      mat.opacity = 0.25 + 0.75 * env;
    }, 60); // low priority cosmetic
    return unregister;
  }, []);

  return (
    <group ref={groupRef} visible={false} renderOrder={999}>
      <lineSegments>
        <primitive object={edges} attach="geometry" />
        <lineBasicMaterial
          ref={matRef}
          transparent
          depthTest={false}
          toneMapped={false}
        />
      </lineSegments>
    </group>
  );
}
