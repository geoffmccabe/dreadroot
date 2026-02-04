import React, { useEffect, useMemo, useRef } from 'react';
import { useFrame } from '@react-three/fiber';
import * as THREE from 'three';
import { PlacedBlock } from '@/types/blocks';
import { ViewSettings, DEFAULT_VIEW_SETTINGS } from '@/components/fortress/FortressTypes';

interface FadeChunkEntry {
  key: string;
  blocks: PlacedBlock[];
  distanceFactor: number; // 0..1 across fade rings
}

interface FadeChunkBlocksProps {
  entries: FadeChunkEntry[];
  viewSettings?: ViewSettings;
}

const MAX_INSTANCES_PER_RING = 5000;
const FADE_IN_DURATION = 2.0; // seconds

// Vertex shader: passes per-instance opacity to fragment, includes fog
const vertexShader = `
  attribute float instanceOpacity;
  varying float vInstanceOpacity;
  #include <fog_pars_vertex>
  void main() {
    vInstanceOpacity = instanceOpacity;
    vec4 mvPosition = modelViewMatrix * instanceMatrix * vec4(position, 1.0);
    gl_Position = projectionMatrix * mvPosition;
    #include <fog_vertex>
  }
`;

// Fragment shader: applies base color, base opacity * per-instance opacity, then fog
// After standard fog color blend, also fades alpha so distant chunks become transparent
const fragmentShader = `
  uniform vec3 baseColor;
  uniform float baseOpacity;
  varying float vInstanceOpacity;
  #include <fog_pars_fragment>
  void main() {
    gl_FragColor = vec4(baseColor, baseOpacity * vInstanceOpacity);
    #include <fog_fragment>
    #ifdef USE_FOG
      gl_FragColor.a *= (1.0 - fogFactor);
    #endif
  }
`;

/** Generate a position key for a block */
function blockKey(b: PlacedBlock): string {
  return `${b.position_x},${b.position_y},${b.position_z}`;
}

function FadeRing({ blocks, ring, viewSettings }: { blocks: PlacedBlock[]; ring: number; viewSettings: ViewSettings }) {
  const meshRef = useRef<THREE.InstancedMesh>(null);
  const tempObj = useMemo(() => new THREE.Object3D(), []);

  // Pre-allocate geometry with instanceOpacity attribute
  const geometry = useMemo(() => {
    const geo = new THREE.BoxGeometry(1, 1, 1);
    const arr = new Float32Array(MAX_INSTANCES_PER_RING);
    const attr = new THREE.InstancedBufferAttribute(arr, 1);
    attr.setUsage(THREE.DynamicDrawUsage);
    geo.setAttribute('instanceOpacity', attr);
    return geo;
  }, []);

  const ringSettings = ring === 0 ? viewSettings.ring1 : ring === 1 ? viewSettings.ring2 : viewSettings.ring3;

  const material = useMemo(() => {
    return new THREE.ShaderMaterial({
      uniforms: {
        baseColor: { value: new THREE.Color(viewSettings.baseColor) },
        baseOpacity: { value: ringSettings.opacity },
        ...THREE.UniformsLib.fog,
      },
      vertexShader,
      fragmentShader,
      transparent: true,
      depthWrite: false,
      fog: true,
    });
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  // Per-block fade progress tracking
  const fadeMap = useRef<Map<string, number>>(new Map());
  const fadingIndices = useRef<number[]>([]);

  // Store refs for useFrame
  const viewSettingsRef = useRef(viewSettings);
  viewSettingsRef.current = viewSettings;
  const blocksRef = useRef(blocks);
  blocksRef.current = blocks;

  useEffect(() => {
    const mesh = meshRef.current;
    if (!mesh) return;

    const count = Math.min(blocks.length, MAX_INSTANCES_PER_RING);
    const prevMap = fadeMap.current;
    const newMap = new Map<string, number>();
    const fading: number[] = [];

    const attr = geometry.getAttribute('instanceOpacity') as THREE.InstancedBufferAttribute;
    const arr = attr.array as Float32Array;

    for (let i = 0; i < count; i++) {
      const block = blocks[i];
      tempObj.position.set(block.position_x + 0.5, block.position_y + 0.5, block.position_z + 0.5);
      tempObj.scale.set(1, 1, 1);
      tempObj.updateMatrix();
      mesh.setMatrixAt(i, tempObj.matrix);

      const key = blockKey(block);
      const existing = prevMap.get(key);
      const progress = existing ?? 0; // new blocks start at 0
      newMap.set(key, progress);
      arr[i] = progress;
      if (progress < 1) fading.push(i);
    }

    fadeMap.current = newMap;
    fadingIndices.current = fading;
    attr.needsUpdate = true;
    mesh.count = count;
    mesh.instanceMatrix.needsUpdate = true;
  }, [blocks, tempObj, geometry]);

  useFrame((_, delta) => {
    const mat = material as THREE.ShaderMaterial;

    // Update uniforms from live viewSettings (admin panel real-time tuning)
    const vs = viewSettingsRef.current;
    const rs = ring === 0 ? vs.ring1 : ring === 1 ? vs.ring2 : vs.ring3;
    (mat.uniforms.baseColor.value as THREE.Color).set(vs.baseColor);
    mat.uniforms.baseOpacity.value = rs.opacity;

    // Advance per-instance fade-in
    const indices = fadingIndices.current;
    if (indices.length === 0) return;

    const curBlocks = blocksRef.current;
    const map = fadeMap.current;
    const attr = geometry.getAttribute('instanceOpacity') as THREE.InstancedBufferAttribute;
    const arr = attr.array as Float32Array;
    const remaining: number[] = [];

    for (const i of indices) {
      const block = curBlocks[i];
      if (!block) continue;
      const key = blockKey(block);
      let progress = map.get(key) ?? 0;
      progress = Math.min(1, progress + delta / FADE_IN_DURATION);
      map.set(key, progress);
      arr[i] = progress;
      if (progress < 1) remaining.push(i);
    }

    fadingIndices.current = remaining;
    attr.needsUpdate = true;
  });

  if (blocks.length === 0) return null;

  return (
    <instancedMesh
      ref={meshRef}
      args={[geometry, material, MAX_INSTANCES_PER_RING]}
      frustumCulled={false}
      name={`fade-ring-${ring}`}
    />
  );
}

export function FadeChunkBlocks({ entries, viewSettings }: FadeChunkBlocksProps) {
  const vs = viewSettings ?? DEFAULT_VIEW_SETTINGS;

  // Bucket entries into 3 rings by distanceFactor
  const ringBlocks = useMemo(() => {
    const rings: [PlacedBlock[], PlacedBlock[], PlacedBlock[]] = [[], [], []];
    for (const entry of entries) {
      const ringIdx = Math.min(2, Math.round(entry.distanceFactor * 3) - 1);
      const idx = Math.max(0, ringIdx);
      for (const block of entry.blocks) {
        rings[idx].push(block);
      }
    }
    return rings;
  }, [entries]);

  if (entries.length === 0) return null;

  return (
    <>
      {ringBlocks[0].length > 0 && <FadeRing blocks={ringBlocks[0]} ring={0} viewSettings={vs} />}
      {ringBlocks[1].length > 0 && <FadeRing blocks={ringBlocks[1]} ring={1} viewSettings={vs} />}
      {ringBlocks[2].length > 0 && <FadeRing blocks={ringBlocks[2]} ring={2} viewSettings={vs} />}
    </>
  );
}
