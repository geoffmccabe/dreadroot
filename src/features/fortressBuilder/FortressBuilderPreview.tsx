// Live in-Canvas preview for the Fortress Builder. Reads the external store, decodes
// the chosen image, runs the voxel algorithm, and renders the result as 5 instanced
// meshes (one grey tier each, cliff-textured, multiplied by the tint). Rebuilds on
// any param change — client-side only, nothing persisted. Placed ~35 blocks in front
// of the player when the builder opens, so you can stand/float and watch it update.
import { useEffect, useMemo, useRef, useState } from 'react';
import * as THREE from 'three';
import { useThree } from '@react-three/fiber';
import { builderStore, useBuilder } from './fortressBuilderStore';
import { buildFortressVoxels, type FortressVoxel } from './imageToFortress';
import { loadImageEl, imageToGrayGrid } from './imageToGrayGrid';
import { setBuilderBarrier } from '@/features/enemies/ai/fortressSafeZone';
import { frameLoop } from '@/lib/frameLoop';

const TIER_GREY = ['#e6e6e6', '#b0b0b0', '#808080', '#505050', '#2a2a2a'];
const BUFFER = 60000; // fixed per-tier instance buffer (avoids mesh recreation on slider drag)

// Emissive FRAME texture (bright border, black centre) — used as an emissiveMap so a
// lit block glows only on its EDGES (recessed-LED / niche look), not the whole face.
let _frameTex: THREE.CanvasTexture | null = null;
function frameTexture(): THREE.CanvasTexture {
  if (_frameTex) return _frameTex;
  const s = 64, b = Math.round(s * 0.13);
  const cv = document.createElement('canvas');
  cv.width = cv.height = s;
  const ctx = cv.getContext('2d')!;
  ctx.fillStyle = '#000';
  ctx.fillRect(0, 0, s, s);
  ctx.fillStyle = '#fff';
  ctx.fillRect(0, 0, s, b); ctx.fillRect(0, s - b, s, b);
  ctx.fillRect(0, 0, b, s); ctx.fillRect(s - b, 0, b, s);
  _frameTex = new THREE.CanvasTexture(cv);
  _frameTex.needsUpdate = true;
  return _frameTex;
}

function TierMesh({
  voxels, grey, tint, texture,
}: { voxels: FortressVoxel[]; grey: string; tint: string; texture: THREE.Texture }) {
  const meshRef = useRef<THREE.InstancedMesh>(null);
  const geo = useMemo(() => new THREE.BoxGeometry(1, 1, 1), []);
  const mat = useMemo(() => new THREE.MeshLambertMaterial({ map: texture }), [texture]);
  useEffect(() => () => { geo.dispose(); mat.dispose(); }, [geo, mat]);

  useEffect(() => {
    mat.color = new THREE.Color(grey).multiply(new THREE.Color(tint));
    mat.needsUpdate = true;
  }, [mat, grey, tint]);

  useEffect(() => {
    const mesh = meshRef.current;
    if (!mesh) return;
    const m = new THREE.Matrix4();
    const n = Math.min(voxels.length, BUFFER);
    for (let i = 0; i < n; i++) {
      const v = voxels[i];
      m.setPosition(v.x + 0.5, v.y + 0.5, v.z + 0.5);
      mesh.setMatrixAt(i, m);
    }
    mesh.count = n;
    mesh.instanceMatrix.needsUpdate = true;
  }, [voxels]);

  return <instancedMesh ref={meshRef} args={[geo, mat, BUFFER]} frustumCulled={false} castShadow receiveShadow />;
}

// Emissive, flickering blocks for lit extrude/inset parts.
function LightMesh({
  lid, voxels, color, intensity, texture,
}: { lid: string; voxels: FortressVoxel[]; color: string; intensity: number; texture: THREE.Texture }) {
  const meshRef = useRef<THREE.InstancedMesh>(null);
  const geo = useMemo(() => new THREE.BoxGeometry(1, 1, 1), []);
  // Stone block (map) whose EDGES glow via the emissive frame map — not the whole face.
  const mat = useMemo(() => new THREE.MeshLambertMaterial({
    map: texture, emissive: new THREE.Color(0, 0, 0), emissiveMap: frameTexture(), toneMapped: false,
  }), [texture]);
  useEffect(() => () => { geo.dispose(); mat.dispose(); }, [geo, mat]);
  useEffect(() => { mat.emissive = new THREE.Color(color); mat.needsUpdate = true; }, [mat, color]);

  useEffect(() => {
    const mesh = meshRef.current;
    if (!mesh) return;
    const m = new THREE.Matrix4();
    const n = Math.min(voxels.length, BUFFER);
    for (let i = 0; i < n; i++) { const v = voxels[i]; m.setPosition(v.x + 0.5, v.y + 0.5, v.z + 0.5); mesh.setMatrixAt(i, m); }
    mesh.count = n;
    mesh.instanceMatrix.needsUpdate = true;
  }, [voxels]);

  const intensityRef = useRef(intensity);
  useEffect(() => { intensityRef.current = intensity; }, [intensity]);
  useEffect(() => {
    const unreg = frameLoop.register(`fb-light-${lid}`, (_d, t) => {
      // Gentle torch flicker. Kept moderate (was x2.5 with a wide dip) so the emissive
      // edges don't blow out the bloom/exposure and cause black flashing.
      const f = 0.85 + 0.15 * Math.sin(t * 9) * Math.sin(t * 5.3 + 1.7); // ~0.70..1.0
      mat.emissiveIntensity = intensityRef.current * 1.3 * f;
    }, 64);
    return unreg;
  }, [mat, lid]);

  return <instancedMesh ref={meshRef} args={[geo, mat, BUFFER]} frustumCulled={false} />;
}

// Cluster lit voxels into up to `max` centroids (coarse spatial buckets, most-populated
// first) so we can cast REAL light from a handful of point lights instead of hundreds.
function clusterCentroids(voxels: FortressVoxel[], max: number): { x: number; y: number; z: number }[] {
  if (voxels.length === 0) return [];
  const CELL = 10;
  const buckets = new Map<string, { x: number; y: number; z: number; n: number }>();
  for (const v of voxels) {
    const k = `${Math.floor(v.x / CELL)},${Math.floor(v.y / CELL)},${Math.floor(v.z / CELL)}`;
    const b = buckets.get(k);
    if (b) { b.x += v.x; b.y += v.y; b.z += v.z; b.n++; }
    else buckets.set(k, { x: v.x, y: v.y, z: v.z, n: 1 });
  }
  return [...buckets.values()]
    .sort((a, b) => b.n - a.n)
    .slice(0, max)
    .map((b) => ({ x: b.x / b.n, y: b.y / b.n, z: b.z / b.n }));
}

// Real point lights that spill onto nearby blocks/terrain. A FIXED count is always
// rendered (unused ones parked far away at 0 intensity) so the scene's light count
// never changes — that avoids the material recompiles that cause black flashing.
function LightSpill({ voxels, color, intensity, spread, max = 6 }: { voxels: FortressVoxel[]; color: string; intensity: number; spread: number; max?: number }) {
  const centroids = useMemo(() => clusterCentroids(voxels, max), [voxels, max]);
  return (
    <>
      {Array.from({ length: max }).map((_, i) => {
        const c = centroids[i];
        return (
          <pointLight
            key={i}
            // Sits at the extruded/inset cells (out from the wall face) so it washes back
            // onto the wall it came from. `spread` = how far that wash reaches.
            position={c ? [c.x + 0.5, c.y + 0.5, c.z + 0.5] : [0, -10000, 0]}
            color={color}
            intensity={c ? intensity * 5 : 0}
            distance={Math.max(2, spread)}
            decay={2}
          />
        );
      })}
    </>
  );
}

// Translucent barrier walls (20-60-20 outer ring = D), tall. Local to the preview
// group (parent already sits at the build center, ground at y 0).
function BarrierWalls({ D }: { D: number }) {
  const H = 400, half = D / 2;
  const mat = useMemo(() => new THREE.MeshBasicMaterial({
    color: new THREE.Color(0.45, 0.85, 1.0), transparent: true, opacity: 0.12,
    side: THREE.DoubleSide, depthWrite: false, blending: THREE.AdditiveBlending, toneMapped: false,
  }), []);
  useEffect(() => () => mat.dispose(), [mat]);
  return (
    <group position={[0, H / 2, 0]}>
      <mesh position={[0, 0, half]} material={mat}><planeGeometry args={[D, H]} /></mesh>
      <mesh position={[0, 0, -half]} material={mat}><planeGeometry args={[D, H]} /></mesh>
      <mesh position={[-half, 0, 0]} rotation={[0, Math.PI / 2, 0]} material={mat}><planeGeometry args={[D, H]} /></mesh>
      <mesh position={[half, 0, 0]} rotation={[0, Math.PI / 2, 0]} material={mat}><planeGeometry args={[D, H]} /></mesh>
    </group>
  );
}

export function FortressBuilderPreview() {
  const {
    isOpen, imageSrc, D, T, heightScale, tintHex, barrierOn, rebuildSeed,
    faceSym, faceFlip, wallSym, entryW, entryH, entryWall, entryVert, stairs,
    extrudeOut, extrudeIn,
    extrudeLightOn, extrudeLightColor, extrudeLightIntensity, extrudeLightSpread,
    insetLightOn, insetLightColor, insetLightIntensity, insetLightSpread,
  } = useBuilder();
  const { camera } = useThree();
  const [img, setImg] = useState<HTMLImageElement | null>(null);
  const centerRef = useRef<THREE.Vector3 | null>(null);
  const texRef = useRef<THREE.Texture | null>(null);
  const [texReady, setTexReady] = useState(false);

  // Cliff texture, loaded once.
  useEffect(() => {
    const t = new THREE.TextureLoader().load('/cliff_texture_seamless.webp', () => setTexReady(true));
    t.colorSpace = THREE.SRGBColorSpace;
    t.wrapS = t.wrapT = THREE.RepeatWrapping;
    texRef.current = t;
    return () => { t.dispose(); };
  }, []);

  // (Re)load the source image when it changes.
  useEffect(() => {
    if (!imageSrc) { setImg(null); return; }
    let ok = true;
    loadImageEl(imageSrc).then((i) => { if (ok) setImg(i); }).catch(() => { if (ok) setImg(null); });
    return () => { ok = false; };
  }, [imageSrc]);

  // Pin a build center ~35 blocks in front of the player when the builder opens.
  useEffect(() => {
    if (isOpen && !centerRef.current) {
      const fwd = new THREE.Vector3(0, 0, -1).applyQuaternion(camera.quaternion);
      fwd.y = 0;
      if (fwd.lengthSq() < 1e-6) fwd.set(0, 0, -1);
      fwd.normalize();
      const c = camera.position.clone().addScaledVector(fwd, 35);
      // Snap to the integer voxel grid so preview blocks line up exactly with the
      // game's blocks (the camera position is fractional). Blocks are placed at
      // local x+0.5 etc, so an integer group center keeps them on whole cells.
      c.x = Math.round(c.x);
      c.z = Math.round(c.z);
      c.y = 0;
      centerRef.current = c;
      // Default the entry to the wall facing the player (so they see it). Nearest
      // wall normal ≈ -forward. 0 front(-z) 1 right(+x) 2 back(+z) 3 left(-x).
      const nx = -fwd.x, nz = -fwd.z;
      const wall = Math.abs(nz) >= Math.abs(nx) ? (nz < 0 ? 0 : 2) : (nx > 0 ? 1 : 3);
      builderStore.set({ entryWall: wall });
    }
    if (!isOpen) centerRef.current = null;
  }, [isOpen, camera]);

  const F = Math.max(1, Math.round(0.6 * D));
  const grid = useMemo(() => (img ? imageToGrayGrid(img, F, rebuildSeed) : null), [img, F, rebuildSeed]);
  const result = useMemo(
    () => (grid ? buildFortressVoxels(grid, {
      D, T, heightScale, seed: rebuildSeed,
      faceSym, faceFlip, wallSym, stairs,
      entry: entryW > 0 ? { w: entryW, h: entryH, wall: entryWall, vert: entryVert } : null,
      extrudeOut, extrudeIn,
    }) : null),
    [grid, D, T, heightScale, rebuildSeed, faceSym, faceFlip, wallSym, stairs, entryW, entryH, entryWall, entryVert, extrudeOut, extrudeIn]
  );

  // Register/clear the dynamic monster-exclusion barrier (20-60-20 outer ring = D).
  useEffect(() => {
    const c = centerRef.current;
    if (isOpen && barrierOn && c) {
      setBuilderBarrier({ minX: c.x - D / 2, maxX: c.x + D / 2, minZ: c.z - D / 2, maxZ: c.z + D / 2 });
    } else {
      setBuilderBarrier(null);
    }
    return () => setBuilderBarrier(null);
  }, [isOpen, barrierOn, D]);

  // Publish block count back to the panel.
  useEffect(() => {
    builderStore.set({ blockCount: result?.voxels.length ?? 0 });
  }, [result]);

  const groups = useMemo(() => {
    const tiers: FortressVoxel[][] = [[], [], [], [], []];
    const lightExtrude: FortressVoxel[] = [];
    const lightInset: FortressVoxel[] = [];
    if (result) for (const v of result.voxels) {
      if (v.light === 1 && extrudeLightOn) lightExtrude.push(v);
      else if (v.light === 2 && insetLightOn) lightInset.push(v);
      else tiers[Math.min(4, v.tier - 1)].push(v);
    }
    return { tiers, lightExtrude, lightInset };
  }, [result, extrudeLightOn, insetLightOn]);

  if (!isOpen || !result || !texReady || !texRef.current || !centerRef.current) return null;
  const c = centerRef.current;
  return (
    <group position={[c.x, c.y, c.z]}>
      {groups.tiers.map((vox, i) => (
        <TierMesh key={i} voxels={vox} grey={TIER_GREY[i]} tint={tintHex} texture={texRef.current!} />
      ))}
      <LightMesh lid="extrude" voxels={groups.lightExtrude} color={extrudeLightColor} intensity={extrudeLightIntensity} texture={texRef.current!} />
      <LightMesh lid="inset" voxels={groups.lightInset} color={insetLightColor} intensity={insetLightIntensity} texture={texRef.current!} />
      {/* Real light spill onto nearby blocks/terrain (capped, constant count). */}
      {extrudeLightOn && <LightSpill voxels={groups.lightExtrude} color={extrudeLightColor} intensity={extrudeLightIntensity} spread={extrudeLightSpread} />}
      {insetLightOn && <LightSpill voxels={groups.lightInset} color={insetLightColor} intensity={insetLightIntensity} spread={insetLightSpread} />}
      {barrierOn && <BarrierWalls D={D} />}
    </group>
  );
}
