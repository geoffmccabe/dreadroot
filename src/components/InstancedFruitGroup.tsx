/**
 * InstancedFruitGroup
 *
 * Renders fruit (seed) blocks as a SINGLE instanced mesh sampled from the
 * tree atlas, with a pulsing emissive glow driven entirely on the GPU.
 *
 * Why this exists separately from InstancedAtlasBlockGroup:
 *  - Fruit are the only tree block that should glow/pulse. Adding a per-
 *    instance emissive flag to the shared (and co-built, perf-critical)
 *    atlas pipeline would mean touching the off-thread worker packer and
 *    every rebuild path. Splitting fruit into their own small group keeps
 *    that hot pipeline untouched.
 *  - Fruit are excluded from the atlas group in PlacedBlocks, so there is
 *    exactly one renderer per fruit block (no double-render → no z-fighting,
 *    the bug that retired the old per-fruit-mesh PulsingSeedBlocks path).
 *
 * Cost: one draw call for ALL fruit + ONE shared uniform write per frame for
 * the pulse (zero per-fruit JS, no per-fruit meshes/materials/callbacks).
 */

import React, { useEffect, useMemo, useRef } from 'react';
import * as THREE from 'three';
import { PlacedBlock } from '@/types/blocks';
import { frameLoop } from '@/lib/frameLoop';
import { ATLAS_GRID_SIZE } from '@/lib/textureAtlas';
import { getInstanceUVsForTreeBlock } from '@/hooks/useTextureAtlas';
import { numPosKey } from '@/lib/spatialHashGrid';

// One shared pulse value read by every fruit material's shader. A single
// write per frame animates ALL fruit glow on the GPU — the same pattern as
// the strip-animation clock in stripAnimationMaterial.ts.
const sharedFruitPulse = { value: 0.5 };
let pulseRegistered = false;
function ensureFruitPulse(): void {
  if (pulseRegistered) return;
  pulseRegistered = true;
  // Gentle 0.2 → 0.8 sine (~2s period) — matches the feel of the old
  // per-fruit emissiveIntensity pulse, but free.
  frameLoop.register(
    'fruit-glow-pulse',
    (_delta, elapsed) => {
      sharedFruitPulse.value = 0.5 + 0.3 * Math.sin(elapsed * 3.0);
    },
    1,
  );
}

const SLOT_SIZE = (1.0 / ATLAS_GRID_SIZE).toFixed(6);
const EPS_LO = (4.0 / 256).toFixed(6);
const EPS_HI = (1 - 4.0 / 256).toFixed(6);

// Atlas-sampled Lambert material + pulsing emissive glow. Mirrors the atlas
// material's UV-offset + per-face shading so fruit look identical to before,
// then adds `totalEmissiveRadiance += texColor * uFruitPulse`.
function createFruitMaterial(atlasTexture: THREE.Texture): THREE.MeshLambertMaterial {
  const material = new THREE.MeshLambertMaterial({
    map: atlasTexture,
    color: 0xffffff,
    transparent: false,
    alphaTest: 0,
  });

  material.onBeforeCompile = (shader) => {
    shader.uniforms.uFruitPulse = sharedFruitPulse;

    shader.vertexShader = shader.vertexShader.replace(
      '#include <common>',
      `#include <common>
      attribute vec2 instanceUvOffset;
      varying vec2 vInstanceUvOffset;
      varying float vFaceShade;`,
    );

    shader.vertexShader = shader.vertexShader.replace(
      '#include <uv_vertex>',
      `#include <uv_vertex>
      vInstanceUvOffset = instanceUvOffset;
      vec3 worldNormal = normalize(mat3(modelMatrix) * normal);
      if (worldNormal.y > 0.5) { vFaceShade = 1.0; }
      else if (worldNormal.y < -0.5) { vFaceShade = 0.65; }
      else if (abs(worldNormal.z) > 0.5) { vFaceShade = 0.8; }
      else { vFaceShade = 0.9; }`,
    );

    shader.fragmentShader = shader.fragmentShader.replace(
      '#include <common>',
      `#include <common>
      uniform float uFruitPulse;
      varying vec2 vInstanceUvOffset;
      varying float vFaceShade;`,
    );

    // totalEmissiveRadiance is declared above <map_fragment> in the standard
    // fragment shader, so we can add the glow here in one injection point.
    shader.fragmentShader = shader.fragmentShader.replace(
      '#include <map_fragment>',
      `#ifdef USE_MAP
        vec2 slotUv = clamp(fract(vMapUv), vec2(${EPS_LO}), vec2(${EPS_HI}));
        vec2 atlasUv = vInstanceUvOffset + slotUv * ${SLOT_SIZE};
        vec4 sampledDiffuseColor = texture2D(map, atlasUv);
        sampledDiffuseColor.rgb *= vFaceShade;
        diffuseColor *= sampledDiffuseColor;
        totalEmissiveRadiance += sampledDiffuseColor.rgb * uFruitPulse;
      #endif`,
    );
  };

  return material;
}

interface InstancedFruitGroupProps {
  blocks: PlacedBlock[];
  atlasTexture: THREE.Texture;
}

export function InstancedFruitGroup({ blocks, atlasTexture }: InstancedFruitGroupProps) {
  const meshRef = useRef<THREE.InstancedMesh>(null);

  ensureFruitPulse();

  // Own geometry/material (NOT shared) so the per-instance UV attribute and
  // GPU program belong to this one mesh. Disposed on unmount / atlas swap.
  const geometry = useMemo(() => new THREE.BoxGeometry(1, 1, 1), []);
  const material = useMemo(() => createFruitMaterial(atlasTexture), [atlasTexture]);
  useEffect(() => () => geometry.dispose(), [geometry]);
  useEffect(() => () => material.dispose(), [material]);

  const count = blocks.length;

  // Cheap signature so matrices/UVs only rebuild when the fruit set changes
  // (position added/removed/moved or tier changed), not every render.
  const sig = useMemo(() => {
    let h = count >>> 0;
    for (let i = 0; i < count; i++) {
      const b = blocks[i];
      h = (Math.imul(h, 31) + numPosKey(b.position_x, b.position_y, b.position_z)) >>> 0;
      const bt = b.block_type;
      h = (Math.imul(h, 31) + (bt.charCodeAt(bt.length - 1) | 0)) >>> 0;
    }
    return h;
  }, [blocks, count]);

  useEffect(() => {
    const mesh = meshRef.current;
    if (!mesh || count === 0) return;

    const matrix = new THREE.Matrix4();
    const uv = new Float32Array(count * 2);
    for (let i = 0; i < count; i++) {
      const b = blocks[i];
      matrix.makeTranslation(b.position_x + 0.5, b.position_y + 0.5, b.position_z + 0.5);
      mesh.setMatrixAt(i, matrix);
      const u = getInstanceUVsForTreeBlock(b.block_type);
      uv[i * 2] = u.uvOffsetX;
      uv[i * 2 + 1] = u.uvOffsetY;
    }
    mesh.instanceMatrix.needsUpdate = true;
    mesh.geometry.setAttribute('instanceUvOffset', new THREE.InstancedBufferAttribute(uv, 2));
    mesh.count = count;
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [sig, atlasTexture]);

  if (count === 0) return null;

  return (
    <instancedMesh
      ref={meshRef}
      // key on count so capacity always matches; same-count changes update in place
      key={count}
      args={[geometry, material, count]}
      // fruit are few; skip frustum culling so the unit-box bounds never
      // mis-cull them (same reasoning as the atlas group's initial bounds)
      frustumCulled={false}
      dispose={null}
      castShadow
      receiveShadow
    />
  );
}

export default InstancedFruitGroup;
