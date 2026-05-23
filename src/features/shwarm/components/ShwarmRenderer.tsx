import React, { useRef, useImperativeHandle, forwardRef, useMemo, useEffect } from 'react';
import * as THREE from 'three';
import { useFrustumCullGroup } from '@/lib/useFrustumCullGroup';
import { SHWARM_BLOCK_SIZE, DEFAULT_SHWARM_COLOR, MAX_SHWARM_BLOCKS } from '../constants';
import type { ShwarmInstance } from '../hooks/useShwarmSystem';
import { frameLoop } from '@/lib/frameLoop';
import { getGlobalAtlasTexture, isAtlasReady } from '@/hooks/useTextureAtlas';
import { getShwarmFaceUVs, slotIndexToUVs } from '@/lib/atlasLookup';
import { createAtlasHueShiftMaterial, createUvOffsetAttribute, setInstanceUvOffset, createHueShiftAttribute, setInstanceHueShift, createEffectsAttribute, setInstanceEffects } from '@/lib/atlasMaterial';
import type { UniversalFlameRendererHandle } from '@/components/fortress/UniversalFlameRenderer';

// Per-tier visual configuration
interface TierConfig {
  hueShift: number;      // HSV hue rotation [0,1]
  effectMode: number;    // 0=normal, 1=White/Divine, 2=Apocalyptic, 3=Cosmic
  hasFlames: boolean;    // Whether this tier has flame particles
  flameColors: string[]; // Flame colors for UniversalFlameRenderer
  flameSize: number;     // Flame diameter
  flameHeight: number;   // Flame height
}

const TIER_CONFIG: Record<number, TierConfig> = {
  1:  { hueShift: 0,     effectMode: 0, hasFlames: false, flameColors: [], flameSize: 0, flameHeight: 0 },         // Yellow
  2:  { hueShift: 0.167, effectMode: 0, hasFlames: false, flameColors: [], flameSize: 0, flameHeight: 0 },         // Green
  3:  { hueShift: 0.5,   effectMode: 0, hasFlames: false, flameColors: [], flameSize: 0, flameHeight: 0 },         // Blue
  4:  { hueShift: 0.583, effectMode: 0, hasFlames: false, flameColors: [], flameSize: 0, flameHeight: 0 },         // Purple
  5:  { hueShift: 0.833, effectMode: 0, hasFlames: false, flameColors: [], flameSize: 0, flameHeight: 0 },         // Red
  6:  { hueShift: 0,     effectMode: 1, hasFlames: false, flameColors: [], flameSize: 0, flameHeight: 0 },         // White/Divine
  7:  { hueShift: 0.75,  effectMode: 0, hasFlames: false, flameColors: [], flameSize: 0, flameHeight: 0 },         // Pink/Mystic
  8:  { hueShift: 0,     effectMode: 0, hasFlames: false, flameColors: [], flameSize: 0, flameHeight: 0 },         // Rainbow (dynamic)
  9:  { hueShift: 0,     effectMode: 2, hasFlames: true,  flameColors: ['#FF6600', '#FF3300', '#CC2200'], flameSize: 0.3, flameHeight: 0.4 }, // Apocalyptic
  10: { hueShift: 0.974, effectMode: 3, hasFlames: true,  flameColors: ['#FFCC00', '#FFB800', '#FF9900'], flameSize: 0.4, flameHeight: 1.2 }, // Cosmic (3x taller)
};

// Default config for unknown tiers
const DEFAULT_TIER_CONFIG: TierConfig = { hueShift: 0, effectMode: 0, hasFlames: false, flameColors: [], flameSize: 0, flameHeight: 0 };

// Pre-allocated objects for InstancedMesh updates
const tmpMatrix = new THREE.Matrix4();
const tmpScale = new THREE.Vector3();
const tmpPosition = new THREE.Vector3();
const tmpQuaternion = new THREE.Quaternion();
const tmpColor = new THREE.Color();
const tmpFlamePos = new THREE.Vector3();

// Shared geometry for all shwarm blocks (0.5 size)
const shwarmBlockGeometry = new THREE.BoxGeometry(
  SHWARM_BLOCK_SIZE,
  SHWARM_BLOCK_SIZE,
  SHWARM_BLOCK_SIZE
);

// Particle geometry (small squares - larger for visibility)
const particleGeometry = new THREE.BoxGeometry(0.15, 0.15, 0.15);

// Maximum particles for hit effects
const MAX_HIT_PARTICLES = 200;

// Particle interface
interface HitParticle {
  position: THREE.Vector3;
  velocity: THREE.Vector3;
  opacity: number;
  scale: number;
  active: boolean;
  color: THREE.Color;
  tier: number;
}

export interface ShwarmRendererHandle {
  update: () => void;
  getMesh: () => THREE.InstancedMesh | null;
  createHitEffect: (position: THREE.Vector3, tier?: number) => void;
}

interface ShwarmRendererProps {
  shwarms: ShwarmInstance[];
  universalFlameRef?: React.RefObject<UniversalFlameRendererHandle | null>;
}

/**
 * Renders all shwarm blocks using InstancedMesh with atlas UV offsets.
 * Each block gets one of 5 face textures (blockIndex % 5).
 * Per-tier color tinting via hue shift, plus special effects for T6-T10.
 * T9/T10 use UniversalFlameRenderer for fire effects.
 */
export const ShwarmRenderer = forwardRef<ShwarmRendererHandle, ShwarmRendererProps>(
  ({ shwarms, universalFlameRef }, ref) => {
    const meshRef = useRef<THREE.InstancedMesh>(null);
    const particleMeshRef = useRef<THREE.InstancedMesh>(null);
    const uvOffsetAttrRef = useRef<THREE.InstancedBufferAttribute | null>(null);
    const hueShiftAttrRef = useRef<THREE.InstancedBufferAttribute | null>(null);
    const effectsAttrRef = useRef<THREE.InstancedBufferAttribute | null>(null);
    const materialRef = useRef<THREE.MeshStandardMaterial | null>(null);

    // Frustum-cull the shwarm group — was always-rendered (frustumCulled=false).
    useFrustumCullGroup(
      'shwarm',
      [meshRef, particleMeshRef],
      () => {
        if (shwarms.length === 0) return null;
        const out: { x: number; y: number; z: number }[] = [];
        for (const s of shwarms) {
          if (!s.isActive) continue;
          for (const b of s.blocks) if (b.isAlive) out.push(b.position);
        }
        return out.length === 0 ? null : out;
      },
      { radiusPad: 3 },
    );

    // Track active flames by block ID -> flame ID
    const activeFlamesRef = useRef<Map<string, string>>(new Map());

    // Create atlas material
    const material = useMemo(() => {
      const atlasTexture = getGlobalAtlasTexture();
      if (!atlasTexture || !isAtlasReady()) {
        const mat = new THREE.MeshStandardMaterial({
          color: DEFAULT_SHWARM_COLOR,
          roughness: 0.4,
          metalness: 0.1,
        });
        materialRef.current = mat;
        return mat;
      }

      const mat = createAtlasHueShiftMaterial(atlasTexture, {
        roughness: 0.4,
        metalness: 0.1,
      });
      materialRef.current = mat;
      return mat;
    }, []);

    // Update material when atlas becomes ready
    useEffect(() => {
      const checkAtlas = () => {
        if (isAtlasReady() && meshRef.current) {
          const atlasTexture = getGlobalAtlasTexture();
          if (atlasTexture && materialRef.current && !materialRef.current.map) {
            const newMat = createAtlasHueShiftMaterial(atlasTexture, {
              roughness: 0.4,
              metalness: 0.1,
            });
            materialRef.current = newMat;
            meshRef.current.material = newMat;
          }
        }
      };

      const interval = setInterval(checkAtlas, 100);
      return () => clearInterval(interval);
    }, []);

    // Setup UV offset, hue shift, and effects attributes when mesh is ready
    useEffect(() => {
      const mesh = meshRef.current;
      if (!mesh) return;

      if (!uvOffsetAttrRef.current) {
        uvOffsetAttrRef.current = createUvOffsetAttribute(mesh, MAX_SHWARM_BLOCKS);
      }
      if (!hueShiftAttrRef.current) {
        hueShiftAttrRef.current = createHueShiftAttribute(mesh, MAX_SHWARM_BLOCKS);
      }
      if (!effectsAttrRef.current) {
        effectsAttrRef.current = createEffectsAttribute(mesh, MAX_SHWARM_BLOCKS);
      }
    }, []);

    // Create particle material - uses instance colors
    const particleMaterial = useMemo(() => {
      return new THREE.MeshBasicMaterial({
        color: 0xffffff,
        transparent: true,
        opacity: 1,
      });
    }, []);

    // Pre-allocate particles
    const particles = useMemo<HitParticle[]>(() => {
      const arr: HitParticle[] = [];
      for (let i = 0; i < MAX_HIT_PARTICLES; i++) {
        arr.push({
          position: new THREE.Vector3(),
          velocity: new THREE.Vector3(),
          opacity: 0,
          scale: 0.08,
          active: false,
          color: new THREE.Color(0xffffff),
          tier: 1,
        });
      }
      return arr;
    }, []);

    // Create hit particle effect at position
    const createHitEffect = (position: THREE.Vector3, tier: number = 1) => {
      const particleCount = 20;
      let spawned = 0;

      for (let i = 0; i < particles.length && spawned < particleCount; i++) {
        const particle = particles[i];
        if (!particle.active) {
          const angle = (Math.PI * 2 * spawned) / particleCount + Math.random() * 0.3;
          const elevation = (Math.random() - 0.2) * Math.PI * 0.6;
          const speed = 5 + Math.random() * 6;

          particle.active = true;
          particle.position.copy(position);
          particle.velocity.set(
            Math.cos(angle) * Math.cos(elevation) * speed,
            Math.sin(elevation) * speed + 3,
            Math.sin(angle) * Math.cos(elevation) * speed
          );
          particle.opacity = 1;
          particle.scale = 0.24 + Math.random() * 0.2;
          particle.tier = tier;

          // Generate color based on tier
          const config = TIER_CONFIG[tier] ?? DEFAULT_TIER_CONFIG;
          let baseHue: number;
          let saturation = 0.6 + Math.random() * 0.3;
          let lightness = 0.5 + Math.random() * 0.3;

          if (config.effectMode === 1) {
            saturation = 0.05 + Math.random() * 0.1;
            lightness = 0.85 + Math.random() * 0.15;
            baseHue = Math.random();
          } else if (config.effectMode === 2) {
            baseHue = 0.05 + Math.random() * 0.05;
            lightness = 0.3 + Math.random() * 0.3;
          } else if (config.effectMode === 3) {
            baseHue = 0.12 + Math.random() * 0.04;
            lightness = 0.55 + Math.random() * 0.2;
          } else if (tier === 8) {
            baseHue = Math.random();
          } else {
            baseHue = config.hueShift > 0 ? (1/6 + config.hueShift) % 1 : 1/6;
          }
          particle.color.setHSL(baseHue, saturation, lightness);
          spawned++;
        }
      }
    };

    // Register particle updates with frame loop
    useEffect(() => {
      const unregister = frameLoop.register('shwarmParticles', (delta) => {
        const particleMesh = particleMeshRef.current;
        if (!particleMesh) return;

        let activeCount = 0;
        const gravity = 15;

        for (const particle of particles) {
          if (!particle.active) continue;

          particle.position.addScaledVector(particle.velocity, delta);
          particle.velocity.y -= gravity * delta;
          particle.opacity -= delta * 2.5;

          if (particle.opacity <= 0 || particle.position.y <= 0) {
            particle.active = false;
            continue;
          }

          tmpPosition.copy(particle.position);
          tmpScale.set(particle.scale, particle.scale, particle.scale);
          tmpMatrix.compose(tmpPosition, tmpQuaternion, tmpScale);
          particleMesh.setMatrixAt(activeCount, tmpMatrix);

          tmpColor.copy(particle.color);
          particleMesh.setColorAt(activeCount, tmpColor);

          activeCount++;
        }

        particleMesh.count = activeCount;
        if (activeCount > 0) {
          particleMesh.instanceMatrix.needsUpdate = true;
          if (particleMesh.instanceColor) {
            particleMesh.instanceColor.needsUpdate = true;
          }
        }
      }, 65);

      return unregister;
    }, [particles]);

    // Cleanup materials and flames on unmount
    useEffect(() => {
      return () => {
        particleMaterial.dispose();
        if (materialRef.current) {
          materialRef.current.dispose();
        }
        // Remove all active flames
        if (universalFlameRef?.current) {
          for (const [, flameId] of activeFlamesRef.current) {
            universalFlameRef.current.removeFlame(flameId);
          }
        }
        activeFlamesRef.current.clear();
      };
    }, [particleMaterial, universalFlameRef]);

    // Cache face UVs per frame (all 5 faces, with animation)
    const faceUVCache = useRef<Array<{ uvOffsetX: number; uvOffsetY: number } | null>>([null, null, null, null, null]);

    // Expose update function, mesh getter, and hit effect creator
    useImperativeHandle(ref, () => ({
      update: () => {
        const mesh = meshRef.current;
        const uvOffsetAttr = uvOffsetAttrRef.current;
        const hueShiftAttr = hueShiftAttrRef.current;
        const effectsAttr = effectsAttrRef.current;
        if (!mesh) return;

        const now = performance.now();
        const flameRenderer = universalFlameRef?.current;

        // Pre-compute face UVs for this frame (all 5 faces with animation)
        for (let f = 0; f < 5; f++) {
          const faceUVs = getShwarmFaceUVs(f);
          if (faceUVs && faceUVs.frameCount > 1) {
            const frameIndex = Math.floor(now / faceUVs.frameDelayMs) % faceUVs.frameCount;
            const frameUV = slotIndexToUVs(faceUVs.baseSlotIndex + frameIndex);
            faceUVCache.current[f] = { uvOffsetX: frameUV.uvOffsetX, uvOffsetY: frameUV.uvOffsetY };
          } else if (faceUVs) {
            faceUVCache.current[f] = { uvOffsetX: faceUVs.uvOffsetX, uvOffsetY: faceUVs.uvOffsetY };
          } else {
            faceUVCache.current[f] = null;
          }
        }

        // T8 rainbow: cycle hue at 2 cycles/sec
        const rainbowHue = (now / 1000 * 2.0) % 1;

        let instanceCount = 0;

        // Track which block IDs are alive this frame (for flame cleanup)
        const aliveBlockIds = new Set<string>();

        for (const shwarm of shwarms) {
          if (!shwarm.isActive) continue;

          const tier = shwarm.definition.tier;
          const config = TIER_CONFIG[tier] ?? DEFAULT_TIER_CONFIG;

          // Determine hue shift for this tier
          const hueShift = tier === 8 ? rainbowHue : config.hueShift;

          for (const block of shwarm.blocks) {
            if (!block.isAlive) continue;
            if (instanceCount >= MAX_SHWARM_BLOCKS) break;

            // Pick face texture based on blockIndex
            const faceIndex = block.blockIndex % 5;
            const faceUV = faceUVCache.current[faceIndex];

            // Set position
            tmpPosition.copy(block.position);

            // Set scale based on health
            const visualScale = block.scale;
            tmpScale.set(visualScale, visualScale, visualScale);

            // Compose matrix
            tmpMatrix.compose(tmpPosition, tmpQuaternion, tmpScale);
            mesh.setMatrixAt(instanceCount, tmpMatrix);

            // Set UV offset for the selected face texture
            if (uvOffsetAttr && faceUV) {
              setInstanceUvOffset(uvOffsetAttr, instanceCount, faceUV.uvOffsetX, faceUV.uvOffsetY);
            }

            // Set hue shift
            if (hueShiftAttr) {
              setInstanceHueShift(hueShiftAttr, instanceCount, hueShift);
            }

            // Set effect mode
            if (effectsAttr) {
              setInstanceEffects(effectsAttr, instanceCount, config.effectMode);
            }

            // Color tint based on health
            const healthPercent = block.currentHealth / block.maxHealth;
            const brightness = 0.4 + healthPercent * 0.6;
            tmpColor.setRGB(brightness, brightness, brightness);
            mesh.setColorAt(instanceCount, tmpColor);

            instanceCount++;

            // Manage flames for T9/T10 via UniversalFlameRenderer
            if (config.hasFlames && flameRenderer) {
              const attachId = `shwarm_${block.id}`;
              aliveBlockIds.add(block.id);

              if (!activeFlamesRef.current.has(block.id)) {
                // Spawn new flame for this block
                tmpFlamePos.copy(block.position);
                tmpFlamePos.y += SHWARM_BLOCK_SIZE * 0.5;

                const flameId = flameRenderer.spawnFlame({
                  type: 'point',
                  position: tmpFlamePos.clone(),
                  colors: config.flameColors,
                  size: config.flameSize,
                  height: config.flameHeight,
                  duration: 999999, // Permanent until removed
                  particleCount: 30,
                  attachTo: attachId,
                });
                activeFlamesRef.current.set(block.id, flameId);
              } else {
                // Update flame position
                tmpFlamePos.copy(block.position);
                tmpFlamePos.y += SHWARM_BLOCK_SIZE * 0.5;
                flameRenderer.updateAttachedPosition(attachId, tmpFlamePos);
              }
            }
          }

          if (instanceCount >= MAX_SHWARM_BLOCKS) break;
        }

        // Remove flames for dead/removed blocks
        if (flameRenderer) {
          for (const [blockId, flameId] of activeFlamesRef.current) {
            if (!aliveBlockIds.has(blockId)) {
              flameRenderer.removeFlame(flameId);
              activeFlamesRef.current.delete(blockId);
            }
          }
        }

        mesh.count = instanceCount;

        if (instanceCount > 0) {
          mesh.instanceMatrix.needsUpdate = true;
          if (mesh.instanceColor) {
            mesh.instanceColor.needsUpdate = true;
          }
          if (uvOffsetAttr) {
            uvOffsetAttr.needsUpdate = true;
          }
          if (hueShiftAttr) {
            hueShiftAttr.needsUpdate = true;
          }
          if (effectsAttr) {
            effectsAttr.needsUpdate = true;
          }
        }
      },
      getMesh: () => meshRef.current,
      createHitEffect,
    }), [shwarms, createHitEffect, universalFlameRef]);

    return (
      <>
        <instancedMesh
          ref={meshRef}
          args={[shwarmBlockGeometry, material, MAX_SHWARM_BLOCKS]}
          frustumCulled={false}
          castShadow
          receiveShadow
        />
        <instancedMesh
          ref={particleMeshRef}
          args={[particleGeometry, particleMaterial, MAX_HIT_PARTICLES]}
          frustumCulled={false}
        />
      </>
    );
  }
);

ShwarmRenderer.displayName = 'ShwarmRenderer';
