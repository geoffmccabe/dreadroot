/**
 * UniversalFlameRenderer - A unified flame/fire rendering system
 *
 * Supports multiple flame types:
 * - 'point': Single fire (for shombie hair, small effects)
 * - 'hex': 7-fire hex pattern (for bullet impacts)
 * - 'plume': Inverted fire plume (for jet boots)
 *
 * All flame types use a single batched particle system (1 draw call).
 */

import { forwardRef, useImperativeHandle, useRef, useCallback, useMemo } from 'react';
import { useFrame, useThree } from '@react-three/fiber';
import * as THREE from 'three';

// Constants
const MAX_FLAMES = 80;
const MAX_PARTICLES = 6000;
const DEFAULT_PARTICLES_POINT = 80;
const DEFAULT_PARTICLES_HEX_CENTER = 60;
const PARTICLES_PER_PLUME = 60;

// Flame types
export type FlameType = 'point' | 'hex' | 'plume';

// Special color modes for tier fires
export type FlameColorMode = 'static' | 'rainbow' | 'black';

// Configuration for spawning a flame
export interface FlameConfig {
  type: FlameType;
  position: THREE.Vector3;
  colors: string[];
  size?: number;
  height?: number;
  duration?: number;
  particleCount?: number;
  attachTo?: string;
  colorMode?: FlameColorMode;
}

// Rainbow fire hue cycling speed
const RAINBOW_CYCLE_SPEED = 2.0;

// Internal flame tracking
interface BatchedFlame {
  id: string;
  type: FlameType;
  startTime: number;
  duration: number;       // in seconds
  position: THREE.Vector3;
  attachTo?: string;
  colorMode: FlameColorMode;
  size: number;
  height: number;
  particleCount: number;
  // Pre-parsed colors as THREE.Color
  color1: THREE.Color;
  color2: THREE.Color;
  color3: THREE.Color;
  // Hex offsets (precomputed for hex type)
  hexOffsets?: { x: number; z: number }[];
  // Per-particle random seeds (assigned once on spawn)
  seeds: Float32Array;
}

// Handle for external access
export interface UniversalFlameRendererHandle {
  spawnFlame: (config: FlameConfig) => string;
  updateAttachedPosition: (attachId: string, position: THREE.Vector3) => void;
  removeFlame: (flameId: string) => void;
  removeAttached: (attachId: string) => void;
}

// Distance LoD: flames fade out between these distances (world units)
const FLAME_FADE_START = 48; // 3 chunks
const FLAME_FADE_END = 80;   // 5 chunks - fully invisible

// Temp color for rainbow computation
const _tmpColor = new THREE.Color();

export const UniversalFlameRenderer = forwardRef<UniversalFlameRendererHandle, {}>((_, ref) => {
  const { camera } = useThree();
  const flamesRef = useRef<BatchedFlame[]>([]);
  const nextIdRef = useRef(0);

  // Batched particle system
  const particleData = useMemo(() => {
    const positions = new Float32Array(MAX_PARTICLES * 3);
    const colors = new Float32Array(MAX_PARTICLES * 3);
    const sizes = new Float32Array(MAX_PARTICLES);
    const alphas = new Float32Array(MAX_PARTICLES);

    // Initialize off-screen
    for (let i = 0; i < MAX_PARTICLES; i++) {
      positions[i * 3 + 1] = -1000;
      sizes[i] = 0;
      alphas[i] = 0;
    }

    const geometry = new THREE.BufferGeometry();
    geometry.setAttribute('position', new THREE.BufferAttribute(positions, 3));
    geometry.setAttribute('color', new THREE.BufferAttribute(colors, 3));
    geometry.setAttribute('size', new THREE.BufferAttribute(sizes, 1));
    geometry.setAttribute('alpha', new THREE.BufferAttribute(alphas, 1));
    geometry.setDrawRange(0, 0);

    const material = new THREE.ShaderMaterial({
      vertexShader: `
        attribute float size;
        attribute float alpha;
        attribute vec3 color;
        varying vec3 vColor;
        varying float vAlpha;
        void main() {
          vColor = color;
          vAlpha = alpha;
          vec4 mvPosition = modelViewMatrix * vec4(position, 1.0);
          gl_PointSize = size * (300.0 / -mvPosition.z);
          gl_Position = projectionMatrix * mvPosition;
        }
      `,
      fragmentShader: `
        varying vec3 vColor;
        varying float vAlpha;
        void main() {
          float dist = length(gl_PointCoord - vec2(0.5));
          if (dist > 0.5) discard;
          float glow = 1.0 - (dist * 2.0);
          glow = pow(glow, 1.5);
          gl_FragColor = vec4(vColor * glow, glow * vAlpha);
        }
      `,
      transparent: true,
      blending: THREE.AdditiveBlending,
      depthWrite: false,
      depthTest: true,
    });

    return { positions, colors, sizes, alphas, geometry, material };
  }, []);

  // Generate random seeds for a flame
  const generateSeeds = (count: number): Float32Array => {
    const seeds = new Float32Array(count * 3);
    for (let i = 0; i < count * 3; i++) {
      seeds[i] = Math.random();
    }
    return seeds;
  };

  // Compute hex offsets
  const computeHexOffsets = (diameter: number): { x: number; z: number }[] => {
    const radius = diameter / 2;
    const offsets: { x: number; z: number }[] = [];
    for (let i = 0; i < 6; i++) {
      const angle = (i * Math.PI) / 3;
      offsets.push({
        x: Math.cos(angle) * radius,
        z: Math.sin(angle) * radius,
      });
    }
    return offsets;
  };

  // Compute total particles for a flame config
  const computeParticleCount = (type: FlameType, particleCount?: number): number => {
    if (type === 'point') return particleCount || DEFAULT_PARTICLES_POINT;
    if (type === 'hex') {
      const center = particleCount || DEFAULT_PARTICLES_HEX_CENTER;
      const outer = Math.floor(center * 0.5);
      return center + outer * 6;
    }
    if (type === 'plume') return PARTICLES_PER_PLUME;
    return DEFAULT_PARTICLES_POINT;
  };

  const spawnFlame = useCallback((config: FlameConfig): string => {
    const id = `flame_${nextIdRef.current++}`;
    const {
      type,
      position,
      colors,
      size = 0.5,
      height = 1.0,
      duration = 1.0,
      particleCount: userParticleCount,
      attachTo,
      colorMode = 'static',
    } = config;

    const totalParticles = computeParticleCount(type, userParticleCount);

    const color1 = new THREE.Color(colors[0] || '#FFFF00');
    const color2 = new THREE.Color(colors[1] || colors[0] || '#FFFF00');
    const color3 = new THREE.Color(colors[2] || colors[0] || '#FFFF00');

    // Remove oldest if at limit
    if (flamesRef.current.length >= MAX_FLAMES) {
      flamesRef.current.shift();
    }

    const flame: BatchedFlame = {
      id,
      type,
      startTime: performance.now() / 1000,
      duration,
      position: position.clone(),
      attachTo,
      colorMode,
      size,
      height,
      particleCount: totalParticles,
      color1,
      color2,
      color3,
      seeds: generateSeeds(totalParticles),
    };

    if (type === 'hex') {
      flame.hexOffsets = computeHexOffsets(size);
    }

    flamesRef.current.push(flame);
    return id;
  }, []);

  const updateAttachedPosition = useCallback((attachId: string, position: THREE.Vector3) => {
    for (const flame of flamesRef.current) {
      if (flame.attachTo === attachId) {
        flame.position.copy(position);
      }
    }
  }, []);

  const removeFlame = useCallback((flameId: string) => {
    const index = flamesRef.current.findIndex(f => f.id === flameId);
    if (index !== -1) flamesRef.current.splice(index, 1);
  }, []);

  const removeAttached = useCallback((attachId: string) => {
    flamesRef.current = flamesRef.current.filter(f => f.attachTo !== attachId);
  }, []);

  useImperativeHandle(ref, () => ({
    spawnFlame,
    updateAttachedPosition,
    removeFlame,
    removeAttached,
  }), [spawnFlame, updateAttachedPosition, removeFlame, removeAttached]);

  // Update all particles each frame
  useFrame(() => {
    const nowSec = performance.now() / 1000;
    const { positions, colors, sizes, alphas, geometry } = particleData;

    let pIdx = 0;

    // Remove expired flames
    flamesRef.current = flamesRef.current.filter(f => (nowSec - f.startTime) < f.duration);

    for (const flame of flamesRef.current) {
      const elapsed = nowSec - flame.startTime;
      const progress = elapsed / flame.duration;

      // Global fade out in last 20%
      let fadeOut = progress > 0.8 ? (1.0 - progress) / 0.2 : 1.0;

      // Distance-based LoD: fade flames that are far from camera
      const fdx = flame.position.x - camera.position.x;
      const fdz = flame.position.z - camera.position.z;
      const flameDist = Math.sqrt(fdx * fdx + fdz * fdz);
      if (flameDist > FLAME_FADE_START) {
        const distFade = 1.0 - Math.min(1.0, (flameDist - FLAME_FADE_START) / (FLAME_FADE_END - FLAME_FADE_START));
        fadeOut *= distFade;
        if (fadeOut < 0.01) continue; // Skip fully faded flames
      }

      // Rainbow color cycling
      if (flame.colorMode === 'rainbow') {
        const hue = (nowSec * RAINBOW_CYCLE_SPEED) % 1.0;
        _tmpColor.setHSL(hue, 1.0, 0.5);
        flame.color1.copy(_tmpColor);
        _tmpColor.setHSL((hue + 0.33) % 1.0, 1.0, 0.5);
        flame.color2.copy(_tmpColor);
      }

      if (flame.type === 'point') {
        pIdx = renderPointFlame(flame, nowSec, elapsed, fadeOut, positions, colors, sizes, alphas, pIdx);
      } else if (flame.type === 'hex') {
        pIdx = renderHexFlame(flame, nowSec, elapsed, fadeOut, positions, colors, sizes, alphas, pIdx);
      } else if (flame.type === 'plume') {
        pIdx = renderPlumeFlame(flame, nowSec, elapsed, fadeOut, positions, colors, sizes, alphas, pIdx);
      }

      if (pIdx >= MAX_PARTICLES) break;
    }

    geometry.setDrawRange(0, pIdx);
    (geometry.attributes.position as THREE.BufferAttribute).needsUpdate = true;
    (geometry.attributes.color as THREE.BufferAttribute).needsUpdate = true;
    (geometry.attributes.size as THREE.BufferAttribute).needsUpdate = true;
    (geometry.attributes.alpha as THREE.BufferAttribute).needsUpdate = true;
  });

  return (
    <points
      geometry={particleData.geometry}
      material={particleData.material}
      frustumCulled={false}
      renderOrder={999}
    />
  );
});

UniversalFlameRenderer.displayName = 'UniversalFlameRenderer';

// --- Particle computation per flame type ---

function renderPointFlame(
  flame: BatchedFlame,
  nowSec: number,
  elapsed: number,
  fadeOut: number,
  positions: Float32Array,
  colors: Float32Array,
  sizes: Float32Array,
  alphas: Float32Array,
  startIdx: number,
): number {
  let pIdx = startIdx;
  const { position, size, height, color1, color2, seeds, particleCount, colorMode } = flame;
  const isBlack = colorMode === 'black';
  const baseSize = isBlack ? size * 0.6 : size * 0.8;

  for (let i = 0; i < particleCount && pIdx < MAX_PARTICLES; i++) {
    const s0 = seeds[i * 3];
    const s1 = seeds[i * 3 + 1];
    const s2 = seeds[i * 3 + 2];

    // Particle lifecycle: each particle loops through 0->1 at different phases
    const speed = 0.8 + s0 * 0.4;
    const life = ((elapsed * speed + s0 * 10.0) % 1.5) / 1.5;
    if (life > 1.0) { pIdx++; sizes[pIdx - 1] = 0; continue; } // Gap between cycles

    // Rising motion with turbulence
    const y = position.y + life * height;
    const spreadAmount = life * size * 0.4;
    const turbFreq = 3.0 + s1 * 2.0;
    const x = position.x + Math.sin(s0 * 17.3 + nowSec * turbFreq) * spreadAmount;
    const z = position.z + Math.cos(s1 * 23.7 + nowSec * turbFreq) * spreadAmount;

    positions[pIdx * 3] = x;
    positions[pIdx * 3 + 1] = y;
    positions[pIdx * 3 + 2] = z;

    // Color: lerp from hot (bottom) to cool (top)
    const colorMix = life;
    if (isBlack) {
      // Dark fire: very dark with faint purple glow
      colors[pIdx * 3] = 0.1 * (1 - colorMix);
      colors[pIdx * 3 + 1] = 0.0;
      colors[pIdx * 3 + 2] = 0.05 * (1 - colorMix);
    } else {
      colors[pIdx * 3] = color1.r * (1 - colorMix) + color2.r * colorMix;
      colors[pIdx * 3 + 1] = color1.g * (1 - colorMix) + color2.g * colorMix;
      colors[pIdx * 3 + 2] = color1.b * (1 - colorMix) + color2.b * colorMix;
    }

    // Size: larger at base, shrink at top
    sizes[pIdx] = baseSize * (1.0 - life * 0.6) * (0.7 + s2 * 0.3);

    // Alpha: full brightness, fade at top and with global fadeOut
    alphas[pIdx] = (1.0 - life * life) * fadeOut * (isBlack ? 0.6 : 0.9);

    pIdx++;
  }

  // For black fire, add a second pass with faint glow particles
  if (isBlack && pIdx + Math.floor(particleCount * 0.3) < MAX_PARTICLES) {
    const glowCount = Math.floor(particleCount * 0.3);
    for (let i = 0; i < glowCount && pIdx < MAX_PARTICLES; i++) {
      const s0 = seeds[(i % particleCount) * 3];
      const s1 = seeds[(i % particleCount) * 3 + 1];

      const life = ((elapsed * 0.9 + s0 * 10.0 + 0.5) % 1.5) / 1.5;
      if (life > 1.0) { pIdx++; sizes[pIdx - 1] = 0; continue; }

      const y = position.y + life * height * 1.1;
      const spread = life * size * 0.5;
      const x = position.x + Math.sin(s0 * 13.1 + nowSec * 2.5) * spread;
      const z = position.z + Math.cos(s1 * 19.3 + nowSec * 2.5) * spread;

      positions[pIdx * 3] = x;
      positions[pIdx * 3 + 1] = y;
      positions[pIdx * 3 + 2] = z;

      // Faint purple glow
      colors[pIdx * 3] = 0.1;
      colors[pIdx * 3 + 1] = 0.0;
      colors[pIdx * 3 + 2] = 0.12;

      sizes[pIdx] = size * 1.2 * (1.0 - life * 0.5);
      alphas[pIdx] = 0.3 * (1.0 - life) * fadeOut;

      pIdx++;
    }
  }

  return pIdx;
}

function renderHexFlame(
  flame: BatchedFlame,
  nowSec: number,
  elapsed: number,
  fadeOut: number,
  positions: Float32Array,
  colors: Float32Array,
  sizes: Float32Array,
  alphas: Float32Array,
  startIdx: number,
): number {
  let pIdx = startIdx;
  const { position, size, height, color1, color2, color3, seeds, hexOffsets } = flame;
  if (!hexOffsets) return pIdx;

  const centerCount = Math.floor(flame.particleCount * 0.3);
  const outerCount = Math.floor((flame.particleCount - centerCount) / 6);

  // Center fire cluster
  const centerHeight = height;
  const centerSize = size * 0.5;
  let seedOffset = 0;

  for (let i = 0; i < centerCount && pIdx < MAX_PARTICLES; i++) {
    const si = seedOffset + i;
    const s0 = seeds[(si * 3) % seeds.length];
    const s1 = seeds[(si * 3 + 1) % seeds.length];
    const s2 = seeds[(si * 3 + 2) % seeds.length];

    const speed = 0.8 + s0 * 0.4;
    const life = ((elapsed * speed + s0 * 10.0) % 1.3) / 1.3;
    if (life > 1.0) { sizes[pIdx] = 0; alphas[pIdx] = 0; pIdx++; continue; }

    const spread = life * centerSize * 0.4;
    positions[pIdx * 3] = position.x + Math.sin(s0 * 17.3 + nowSec * 3.5) * spread;
    positions[pIdx * 3 + 1] = position.y + life * centerHeight;
    positions[pIdx * 3 + 2] = position.z + Math.cos(s1 * 23.7 + nowSec * 3.5) * spread;

    colors[pIdx * 3] = color1.r * (1 - life) + color2.r * life;
    colors[pIdx * 3 + 1] = color1.g * (1 - life) + color2.g * life;
    colors[pIdx * 3 + 2] = color1.b * (1 - life) + color2.b * life;

    sizes[pIdx] = centerSize * 0.8 * (1.0 - life * 0.6) * (0.7 + s2 * 0.3);
    alphas[pIdx] = (1.0 - life * life) * fadeOut * 0.9;
    pIdx++;
  }

  seedOffset += centerCount;

  // 6 outer fire clusters
  for (let h = 0; h < 6; h++) {
    const off = hexOffsets[h];
    const outerHeight = h % 2 === 0 ? height * 0.4 : height * 0.6;
    const outerSize = size * 0.3;
    const useColor = h % 2 === 0 ? color2 : color3;

    for (let i = 0; i < outerCount && pIdx < MAX_PARTICLES; i++) {
      const si = seedOffset + i;
      const s0 = seeds[(si * 3) % seeds.length];
      const s1 = seeds[(si * 3 + 1) % seeds.length];
      const s2 = seeds[(si * 3 + 2) % seeds.length];

      const speed = 0.8 + s0 * 0.4;
      const life = ((elapsed * speed + s0 * 10.0) % 1.3) / 1.3;
      if (life > 1.0) { sizes[pIdx] = 0; alphas[pIdx] = 0; pIdx++; continue; }

      const spread = life * outerSize * 0.4;
      positions[pIdx * 3] = position.x + off.x + Math.sin(s0 * 13.1 + nowSec * 3.0) * spread;
      positions[pIdx * 3 + 1] = position.y + life * outerHeight;
      positions[pIdx * 3 + 2] = position.z + off.z + Math.cos(s1 * 19.3 + nowSec * 3.0) * spread;

      colors[pIdx * 3] = useColor.r * (1 - life) + color1.r * life * 0.3;
      colors[pIdx * 3 + 1] = useColor.g * (1 - life) + color1.g * life * 0.3;
      colors[pIdx * 3 + 2] = useColor.b * (1 - life) + color1.b * life * 0.3;

      sizes[pIdx] = outerSize * 0.7 * (1.0 - life * 0.5) * (0.7 + s2 * 0.3);
      alphas[pIdx] = (1.0 - life * life) * fadeOut * 0.85;
      pIdx++;
    }

    seedOffset += outerCount;
  }

  return pIdx;
}

function renderPlumeFlame(
  flame: BatchedFlame,
  nowSec: number,
  elapsed: number,
  fadeOut: number,
  positions: Float32Array,
  colors: Float32Array,
  sizes: Float32Array,
  alphas: Float32Array,
  startIdx: number,
): number {
  let pIdx = startIdx;
  const { position, height, color1, color2, particleCount } = flame;
  const halfParticles = Math.floor(particleCount / 2);
  const plumeSpacing = 0.5;

  for (let side = 0; side < 2; side++) {
    const xOffset = side === 0 ? -plumeSpacing : plumeSpacing;

    for (let i = 0; i < halfParticles && pIdx < MAX_PARTICLES; i++) {
      const particleProgress = (i / halfParticles + elapsed) % 1.0;
      const yOffset = -particleProgress * height;

      const spread = particleProgress * 0.3;
      const angle = (i / halfParticles) * Math.PI * 2 + elapsed * 5;
      const xSpread = Math.cos(angle) * spread;
      const zSpread = Math.sin(angle) * spread;

      positions[pIdx * 3] = position.x + xOffset + xSpread;
      positions[pIdx * 3 + 1] = position.y + yOffset;
      positions[pIdx * 3 + 2] = position.z + zSpread;

      const colorMix = particleProgress;
      colors[pIdx * 3] = color1.r * (1 - colorMix) + color2.r * colorMix;
      colors[pIdx * 3 + 1] = color1.g * (1 - colorMix) + color2.g * colorMix;
      colors[pIdx * 3 + 2] = color1.b * (1 - colorMix) + color2.b * colorMix;

      const baseSize = 0.5 + (1 - particleProgress) * 0.5;
      sizes[pIdx] = baseSize * fadeOut;
      alphas[pIdx] = 0.8 * fadeOut;

      pIdx++;
    }
  }

  return pIdx;
}
