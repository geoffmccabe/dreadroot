// KaijuSoldierMarkers — the reason you can see an army at a mile.
//
// Geoff, three times: "i still can't see the soldiers."
//
// They were being drawn correctly the whole time. Measured, at the camera distance B3 actually
// uses — 1,470 m back from the Kaiju, on a 1080p screen:
//
//     Kaiju, and a Dubai tower      300 m   ->   191 px
//     parachute                       8 m   ->   5.1 px
//     SOLDIER                       1.8 m   ->   1.1 px
//
// One pixel. That is not a bug to fix in the renderer; it is what a person looks like from a mile
// away, and it is also exactly why the canopies were visible and the men under them were not — five
// pixels against one.
//
// So this is the answer every game with units at range uses: draw the MODEL when it is big enough to
// read, and a MARKER when it is not. A three-pixel dot per soldier makes two hundred and fifty men a
// visible force at any distance, and it fades out as the camera closes so that up near them you are
// looking at soldiers rather than at dots on top of soldiers.
//
// One draw call for the whole army, and it costs a Float32Array the crowd already fills.

import { useEffect, useMemo, useRef } from 'react';
import { useFrame, useThree } from '@react-three/fiber';
import * as THREE from 'three';
import { METRES_PER_UNIT } from './cubeSphere';
import { getSoldierMarkers, isCrowdOn } from './KaijuCrowd';

/** How many pixels across a marker is. Three is a man-sized smudge, not a UI pip. */
const MARKER_PX = 3.4;
/**
 * Where the marker gives way to the model, in metres.
 *
 * FULL at 700 m and beyond, where a soldier is under 2.5 px and unreadable. GONE by 250 m, where he
 * is 7 px and plainly a person. In between they cross-fade, so there is never a frame with both a
 * dot and a figure fighting for the same three pixels.
 */
const FADE_FAR_M = 700;
const FADE_NEAR_M = 250;

/** A soft round dot. Drawn rather than loaded, for the same reasons as the muzzle flash. */
function dotSprite(size = 32): THREE.Texture {
  const cv = document.createElement('canvas');
  cv.width = cv.height = size;
  const ctx = cv.getContext('2d');
  if (!ctx) return new THREE.Texture();
  const c = size / 2;
  const g = ctx.createRadialGradient(c, c, 0, c, c, c);
  // Solid in the middle, soft at the edge — a hard-edged square reads as a pixel artefact, and at
  // three pixels across that is all anybody would see.
  g.addColorStop(0, 'rgba(255,255,255,1)');
  g.addColorStop(0.55, 'rgba(255,255,255,0.85)');
  g.addColorStop(1, 'rgba(255,255,255,0)');
  ctx.fillStyle = g;
  ctx.fillRect(0, 0, size, size);
  const tex = new THREE.CanvasTexture(cv);
  tex.colorSpace = THREE.SRGBColorSpace;
  return tex;
}

export function KaijuSoldierMarkers() {
  const points = useRef<THREE.Points>(null);
  const camera = useThree((s) => s.camera);
  const sprite = useMemo(() => dotSprite(), []);
  useEffect(() => () => sprite.dispose(), [sprite]);

  // Sized from the crowd's own buffer the first time it is seen, so the two cannot disagree.
  const buf = useMemo(() => {
    const n = getSoldierMarkers().pos.length / 3;
    return { pos: new Float32Array(n * 3), col: new Float32Array(n * 3), max: n };
  }, []);
  const _v = useMemo(() => new THREE.Vector3(), []);

  useFrame(() => {
    const p = points.current;
    if (!p) return;
    if (!isCrowdOn()) { p.geometry.setDrawRange(0, 0); return; }

    const src = getSoldierMarkers();
    const n = Math.min(src.count, buf.max);
    let drawn = 0;
    for (let i = 0; i < n; i++) {
      const x = src.pos[i * 3], y = src.pos[i * 3 + 1], z = src.pos[i * 3 + 2];
      const distM = _v.set(x, y, z).distanceTo(camera.position) * METRES_PER_UNIT;
      // CROSS-FADE, not a switch. A hard cut-over at one distance makes an army blink in and out as
      // the camera drifts across it, which is worse than either state.
      const a = Math.min(1, Math.max(0, (distM - FADE_NEAR_M) / (FADE_FAR_M - FADE_NEAR_M)));
      if (a <= 0.01) continue;
      const o = drawn * 3;
      buf.pos[o] = x; buf.pos[o + 1] = y; buf.pos[o + 2] = z;
      // Khaki. A soldier at a mile is a dun-coloured speck; anything brighter reads as a light or a
      // marker on a map rather than as a man.
      buf.col[o] = 0.52 * a; buf.col[o + 1] = 0.47 * a; buf.col[o + 2] = 0.33 * a;
      drawn++;
    }
    p.geometry.setDrawRange(0, drawn);
    p.geometry.attributes.position.needsUpdate = true;
    p.geometry.attributes.color.needsUpdate = true;
  });

  return (
    <points ref={points} frustumCulled={false}>
      <bufferGeometry>
        <bufferAttribute attach="attributes-position" args={[buf.pos, 3]} usage={THREE.DynamicDrawUsage} />
        <bufferAttribute attach="attributes-color" args={[buf.col, 3]} usage={THREE.DynamicDrawUsage} />
      </bufferGeometry>
      {/* sizeAttenuation OFF: the whole point is a CONSTANT few pixels however far away he is. With
          it on the marker shrinks with distance and solves nothing. */}
      <pointsMaterial
        map={sprite}
        size={MARKER_PX}
        sizeAttenuation={false}
        vertexColors
        transparent
        depthWrite={false}
        toneMapped={false}
      />
    </points>
  );
}
