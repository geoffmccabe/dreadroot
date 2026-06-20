// TerrainBrushController — in-Canvas owner of the terrain brush. When build mode is on
// it shows a ring at the ground point under the crosshair and, while an apply key is
// held, stamps the heightField there (raise/lower/smooth/flat) every frame. Keys are
// captured ONLY while build mode is on, so normal play keybinds are never affected.
//   B (hold) = apply current mode · R/F/G/T = set mode raise/lower/smooth/flat
// Mode/size/strength/blur also come from the styled panel via terrainBrushState.

import { useEffect, useMemo, useRef } from 'react';
import { useFrame, useThree } from '@react-three/fiber';
import * as THREE from 'three';
import { applyBrush } from './heightField';
import { terrainMeshes } from './terrainMeshRegistry';
import { getBrushState, setBrushState } from './terrainBrushState';

export function TerrainBrushController() {
  const cam = useThree((s) => s.camera);
  const ring = useRef<THREE.Mesh>(null);
  const applying = useRef(false);
  const flatTarget = useRef<number | undefined>(undefined);
  const raycaster = useMemo(() => new THREE.Raycaster(), []);
  const center = useMemo(() => new THREE.Vector2(0, 0), []);
  const hit = useRef(new THREE.Vector3());
  const hasHit = useRef(false);

  useEffect(() => {
    const onDown = (e: KeyboardEvent) => {
      if (!getBrushState().enabled) return;
      const code = e.code;
      if (code === 'KeyB') { applying.current = true; flatTarget.current = undefined; e.preventDefault(); e.stopImmediatePropagation(); }
      else if (code === 'KeyR') { setBrushState({ mode: 'raise' }); e.preventDefault(); e.stopImmediatePropagation(); }
      else if (code === 'KeyF') { setBrushState({ mode: 'lower' }); e.preventDefault(); e.stopImmediatePropagation(); }
      else if (code === 'KeyG') { setBrushState({ mode: 'smooth' }); e.preventDefault(); e.stopImmediatePropagation(); }
      else if (code === 'KeyT') { setBrushState({ mode: 'flat' }); e.preventDefault(); e.stopImmediatePropagation(); }
    };
    const onUp = (e: KeyboardEvent) => {
      if (e.code === 'KeyB') applying.current = false;
    };
    window.addEventListener('keydown', onDown, true);
    window.addEventListener('keyup', onUp, true);
    return () => { window.removeEventListener('keydown', onDown, true); window.removeEventListener('keyup', onUp, true); };
  }, []);

  useFrame((_, dt) => {
    const bs = getBrushState();
    if (ring.current) ring.current.visible = bs.enabled && hasHit.current;
    if (!bs.enabled) { applying.current = false; return; }

    // Ground point under the crosshair (center ray vs streamed terrain meshes).
    raycaster.setFromCamera(center, cam);
    const hits = raycaster.intersectObjects(terrainMeshes(), false);
    hasHit.current = hits.length > 0;
    if (hasHit.current) {
      hit.current.copy(hits[0].point);
      if (ring.current) {
        ring.current.position.set(hit.current.x, hit.current.y + 0.2, hit.current.z);
        ring.current.scale.setScalar(bs.radius);
      }
    }

    if (applying.current && hasHit.current) {
      if (bs.mode === 'flat' && flatTarget.current === undefined) flatTarget.current = hit.current.y;
      applyBrush(hit.current.x, hit.current.z, bs.radius, bs.strength, bs.mode, Math.min(dt, 0.05), bs.edge, flatTarget.current);
    }
  });

  // Unit ring (scaled to radius each frame), laid flat on the ground.
  return (
    <mesh ref={ring} rotation={[-Math.PI / 2, 0, 0]} visible={false}>
      <ringGeometry args={[0.92, 1, 48]} />
      <meshBasicMaterial color={0x33ddff} transparent opacity={0.85} depthTest={false} />
    </mesh>
  );
}
