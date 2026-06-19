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

const TIER_GREY = ['#e6e6e6', '#b0b0b0', '#808080', '#505050', '#2a2a2a'];
const BUFFER = 60000; // fixed per-tier instance buffer (avoids mesh recreation on slider drag)

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
  const { isOpen, imageSrc, D, T, heightScale, tintHex, barrierOn, rebuildSeed } = useBuilder();
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
      c.y = 0;
      centerRef.current = c;
    }
    if (!isOpen) centerRef.current = null;
  }, [isOpen, camera]);

  const F = Math.max(1, Math.round(0.6 * D));
  const grid = useMemo(() => (img ? imageToGrayGrid(img, F) : null), [img, F]);
  const result = useMemo(
    () => (grid ? buildFortressVoxels(grid, { D, T, heightScale, seed: rebuildSeed }) : null),
    [grid, D, T, heightScale, rebuildSeed]
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

  const byTier = useMemo(() => {
    const g: FortressVoxel[][] = [[], [], [], [], []];
    if (result) for (const v of result.voxels) g[Math.min(4, v.tier - 1)].push(v);
    return g;
  }, [result]);

  if (!isOpen || !result || !texReady || !texRef.current || !centerRef.current) return null;
  const c = centerRef.current;
  return (
    <group position={[c.x, c.y, c.z]}>
      {byTier.map((vox, i) => (
        <TierMesh key={i} voxels={vox} grey={TIER_GREY[i]} tint={tintHex} texture={texRef.current!} />
      ))}
      {barrierOn && <BarrierWalls D={D} />}
    </group>
  );
}
