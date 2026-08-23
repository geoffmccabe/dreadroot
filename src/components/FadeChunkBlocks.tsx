/**
 * FadeChunkBlocks — the far low-detail ring: cheap, textureless silhouettes of the
 * chunks just beyond the full-detail (textured) distance. See docs/LOD_FOG_PLAN.md.
 *
 * No custom shader, no timer. Just opaque instanced boxes with a plain
 * MeshBasicMaterial + fog:true — the scene's (patched, linear) FogExp2 lerps their
 * colour toward the sky colour by TRUE per-pixel distance, identical to the textured
 * chunks, so the boundary is seamless and the far edge dissolves into the sky.
 * Opaque ⇒ correct z-sort (no transparent overdraw); distance-only ⇒ never fades
 * backwards. Far-ring only (the classification never feeds it near chunks), so it
 * can't occlude your textures.
 */
import { useEffect, useMemo, useRef } from 'react';
import * as THREE from 'three';
import { PlacedBlock } from '@/types/blocks';

const MAX_INSTANCES_PER_RING = 20000;
const SILHOUETTE_COLOR = '#5b6b78'; // muted; the fog carries it to the sky with distance

interface FadeChunkEntry {
  key: string;
  blocks: PlacedBlock[];
}

interface FadeChunkBlocksProps {
  entries: FadeChunkEntry[];
}

function FadeRing({ blocks }: { blocks: PlacedBlock[] }) {
  const meshRef = useRef<THREE.InstancedMesh>(null);
  const tempObj = useMemo(() => new THREE.Object3D(), []);
  const geometry = useMemo(() => new THREE.BoxGeometry(1, 1, 1), []);
  // fog:true → the scene FogExp2 (patched to linear) colour-lerps toward sky by true
  // distance. Opaque default → z-sorted, zero overdraw. No instanceOpacity / no timer.
  const material = useMemo(() => new THREE.MeshBasicMaterial({ color: SILHOUETTE_COLOR, fog: true }), []);
  const warnedRef = useRef(false);

  useEffect(() => {
    const mesh = meshRef.current;
    if (!mesh) return;
    const count = Math.min(blocks.length, MAX_INSTANCES_PER_RING);
    if (blocks.length > MAX_INSTANCES_PER_RING && !warnedRef.current) {
      warnedRef.current = true;
      console.warn(`[FadeChunkBlocks] truncated ${blocks.length} > ${MAX_INSTANCES_PER_RING}`);
    }
    for (let i = 0; i < count; i++) {
      const b = blocks[i];
      tempObj.position.set(b.position_x + 0.5, b.position_y + 0.5, b.position_z + 0.5);
      tempObj.scale.set(1, 1, 1);
      tempObj.updateMatrix();
      mesh.setMatrixAt(i, tempObj.matrix);
    }
    mesh.count = count;
    mesh.instanceMatrix.needsUpdate = true;
  }, [blocks, tempObj]);

  if (blocks.length === 0) return null;
  return (
    <instancedMesh name="far-ring" ref={meshRef} args={[geometry, material, MAX_INSTANCES_PER_RING]} frustumCulled={false} />
  );
}

export function FadeChunkBlocks({ entries }: FadeChunkBlocksProps) {
  // Bucket into 3 meshes ONLY for the per-mesh instance cap (round-robin by index;
  // identical material, so no banding / no per-ring opacity).
  const rings = useMemo(() => {
    const r: PlacedBlock[][] = [[], [], []];
    let n = 0;
    for (const e of entries) {
      for (const b of e.blocks) r[(n++) % 3].push(b);
    }
    return r;
  }, [entries]);

  if (entries.length === 0) return null;
  return (
    <>
      {rings[0].length > 0 && <FadeRing blocks={rings[0]} />}
      {rings[1].length > 0 && <FadeRing blocks={rings[1]} />}
      {rings[2].length > 0 && <FadeRing blocks={rings[2]} />}
    </>
  );
}
