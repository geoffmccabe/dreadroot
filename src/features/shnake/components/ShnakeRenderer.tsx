import React, { useMemo, useRef, useEffect, useState } from 'react';
import * as THREE from 'three';
import { useFrame } from '@react-three/fiber';
import type { ShnakeInstance } from '../types';
import { playSpatialSound } from '@/lib/spatialAudio';
import { getGlobalAtlasTexture, isAtlasReady } from '@/hooks/useTextureAtlas';
import { getShnakeUVs, slotIndexToUVs } from '@/lib/atlasLookup';
import { createAtlasLambertMaterial, createUvOffsetAttribute, setInstanceUvOffset } from '@/lib/atlasMaterial';

// Universal flame renderer handle type (external)
interface UniversalFlameRendererHandle {
  spawnFlame: (config: {
    type: 'point' | 'hex' | 'plume';
    position: THREE.Vector3;
    colors: string[];
    size?: number;
    height?: number;
    duration?: number;
    particleCount?: number;
    attachTo?: string;
  }) => string;
  updateAttachedPosition: (attachId: string, position: THREE.Vector3) => void;
  removeFlame: (flameId: string) => void;
  removeAttached: (attachId: string) => void;
}

interface Props {
  shnakesRef: React.RefObject<ShnakeInstance[]>;
  cameraRef?: React.RefObject<THREE.Camera>;
  universalFlameRef?: React.MutableRefObject<UniversalFlameRendererHandle | null>;
}

// Fire effect tracking per shnake segment
interface SegmentFire {
  shnakeId: string;
  segmentIndex: number;
  startTime: number;
  duration: number;
  colors: string[];
}

// Damage flash state per shnake
interface DamageFlash {
  shnakeId: string;
  startTime: number;
  duration: number;
}

// Wiggle animation state per shnake
interface WiggleState {
  shnakeId: string;
  startTime: number;
  duration: number;
}

export interface ShnakeRendererHandle {
  getSegmentAtPosition: (x: number, y: number, z: number) => { shnakeId: string; segmentIndex: number; isHead: boolean } | null;
  addFireToSegment: (shnakeId: string, segmentIndex: number, duration: number, colors: string[]) => void;
  getActiveFires: () => Array<{ position: THREE.Vector3; colors: string[]; progress: number }>;
  triggerDamageFlash: (shnakeId: string) => void;
  propagateFire: (shnakeId: string) => void;
  playDeathSound: (position: THREE.Vector3, tier: number) => void;
  triggerWiggle: (shnakeId: string) => void;
}

// Fallback colors for tiers without textures
const TIER_COLORS: { [tier: number]: number } = {
  1: 0x22ff44, 2: 0x44ff66, 3: 0x66ff88, 4: 0x88ffaa, 5: 0xaaffcc,
  6: 0xccffee, 7: 0x44ccff, 8: 0x6688ff, 9: 0x8844ff, 10: 0xaa22ff,
  11: 0xff44aa, 12: 0xff6688, 13: 0xff8866, 14: 0xffaa44, 15: 0xffcc22,
  16: 0xeeff00, 17: 0xccff00, 18: 0xaaff00, 19: 0x88ff22, 20: 0x66ff44,
};

const getTierColor = (tier: number): number => TIER_COLORS[tier] || 0x22ff44;

// Shnake sound constants
const SHNAKE_SOUND_URL = '/shnake_sound_1.mp3';
const SHNAKE_DEATH_SOUND_URL = '/shnake_death.mp3';
const SHNAKE_SOUND_CHANCE = 0.00333;
const SHNAKE_SOUND_INTERVAL = 1000;
const SHNAKE_SOUND_BASE_VOLUME = 0.32;
const SHNAKE_SOUND_VOLUME_PER_TIER = 0.056;

// Wiggle animation constants
const WIGGLE_DURATION = 2000;
const WIGGLE_FREQUENCY = 3;
const WIGGLE_AMPLITUDE = 1.2;

// Per-tier rendering component
interface TierRendererProps {
  tier: number;
  shnakesRef: React.RefObject<ShnakeInstance[]>;
  flashesRef: React.RefObject<DamageFlash[]>;
  wigglesRef: React.RefObject<WiggleState[]>;
}

const TierRenderer: React.FC<TierRendererProps> = ({
  tier,
  shnakesRef,
  flashesRef,
  wigglesRef,
}) => {
  const headMeshRef = useRef<THREE.InstancedMesh>(null);
  const bodyMeshRef = useRef<THREE.InstancedMesh>(null);
  const faceMeshRef = useRef<THREE.InstancedMesh>(null);

  const headUvAttrRef = useRef<THREE.InstancedBufferAttribute | null>(null);
  const bodyUvAttrRef = useRef<THREE.InstancedBufferAttribute | null>(null);
  const faceUvAttrRef = useRef<THREE.InstancedBufferAttribute | null>(null);

  const headMaterialRef = useRef<THREE.MeshLambertMaterial | null>(null);
  const bodyMaterialRef = useRef<THREE.MeshLambertMaterial | null>(null);
  const faceMaterialRef = useRef<THREE.MeshLambertMaterial | null>(null);

  // Geometry
  const headGeo = useMemo(() => new THREE.BoxGeometry(1, 1, 1), []);
  const bodyGeo = useMemo(() => new THREE.BoxGeometry(1, 1, 1), []);
  const faceGeo = useMemo(() => {
    const geo = new THREE.PlaneGeometry(1, 1);
    geo.translate(0, 0, 0.501);
    return geo;
  }, []);

  // Create atlas materials
  const headMaterial = useMemo(() => {
    const atlasTexture = getGlobalAtlasTexture();
    if (!atlasTexture || !isAtlasReady()) {
      const mat = new THREE.MeshLambertMaterial({ color: getTierColor(tier) });
      headMaterialRef.current = mat;
      return mat;
    }
    const mat = createAtlasLambertMaterial(atlasTexture);
    headMaterialRef.current = mat;
    return mat;
  }, [tier]);

  const bodyMaterial = useMemo(() => {
    const atlasTexture = getGlobalAtlasTexture();
    if (!atlasTexture || !isAtlasReady()) {
      const mat = new THREE.MeshLambertMaterial({ color: getTierColor(tier) });
      bodyMaterialRef.current = mat;
      return mat;
    }
    const mat = createAtlasLambertMaterial(atlasTexture);
    bodyMaterialRef.current = mat;
    return mat;
  }, [tier]);

  const faceMaterial = useMemo(() => {
    const atlasTexture = getGlobalAtlasTexture();
    if (!atlasTexture || !isAtlasReady()) {
      const mat = new THREE.MeshLambertMaterial({ color: 0xff4444, side: THREE.DoubleSide });
      faceMaterialRef.current = mat;
      return mat;
    }
    const mat = createAtlasLambertMaterial(atlasTexture);
    mat.side = THREE.DoubleSide;
    mat.transparent = true;
    faceMaterialRef.current = mat;
    return mat;
  }, [tier]);

  // Update materials when atlas becomes ready
  useEffect(() => {
    const checkAtlas = () => {
      if (isAtlasReady()) {
        const atlasTexture = getGlobalAtlasTexture();
        if (!atlasTexture) return;

        if (headMeshRef.current && headMaterialRef.current && !headMaterialRef.current.map) {
          const newMat = createAtlasLambertMaterial(atlasTexture);
          headMaterialRef.current = newMat;
          headMeshRef.current.material = newMat;
        }
        if (bodyMeshRef.current && bodyMaterialRef.current && !bodyMaterialRef.current.map) {
          const newMat = createAtlasLambertMaterial(atlasTexture);
          bodyMaterialRef.current = newMat;
          bodyMeshRef.current.material = newMat;
        }
        if (faceMeshRef.current && faceMaterialRef.current && !faceMaterialRef.current.map) {
          const newMat = createAtlasLambertMaterial(atlasTexture);
          newMat.side = THREE.DoubleSide;
          newMat.transparent = true;
          faceMaterialRef.current = newMat;
          faceMeshRef.current.material = newMat;
        }
      }
    };

    const interval = setInterval(checkAtlas, 100);
    return () => clearInterval(interval);
  }, []);

  // Setup UV offset attributes
  useEffect(() => {
    if (headMeshRef.current && !headUvAttrRef.current) {
      headUvAttrRef.current = createUvOffsetAttribute(headMeshRef.current, 32);
    }
    if (bodyMeshRef.current && !bodyUvAttrRef.current) {
      bodyUvAttrRef.current = createUvOffsetAttribute(bodyMeshRef.current, 1024);
    }
    if (faceMeshRef.current && !faceUvAttrRef.current) {
      faceUvAttrRef.current = createUvOffsetAttribute(faceMeshRef.current, 32);
    }
  }, []);

  // Check flash state
  const isFlashing = (shnakeId: string, now: number): boolean => {
    const flash = flashesRef.current?.find(f => f.shnakeId === shnakeId);
    if (!flash) return false;
    const elapsed = now - flash.startTime;
    if (elapsed >= flash.duration) return false;
    const flashCycle = Math.floor(elapsed / (flash.duration / 6));
    return flashCycle % 2 === 0;
  };

  // Get wiggle offset for a segment
  const getWiggleOffset = (shnakeId: string, segmentIndex: number, totalSegments: number, now: number): THREE.Vector3 => {
    const wiggle = wigglesRef.current?.find(w => w.shnakeId === shnakeId);
    if (!wiggle) return new THREE.Vector3(0, 0, 0);

    const elapsed = now - wiggle.startTime;
    if (elapsed >= wiggle.duration) return new THREE.Vector3(0, 0, 0);

    const progress = elapsed / wiggle.duration;
    const fadeOut = 1 - progress;
    const phaseOffset = (segmentIndex / totalSegments) * Math.PI * 2;
    const timePhase = progress * WIGGLE_FREQUENCY * Math.PI * 2;
    const offset = Math.sin(timePhase + phaseOffset) * WIGGLE_AMPLITUDE * fadeOut;

    return new THREE.Vector3(offset, 0, 0);
  };

  useFrame(() => {
    const now = performance.now();
    const shnakes = shnakesRef.current || [];
    const tierShnakes = shnakes.filter(s => s.isActive && s.tier === tier);

    let headCount = 0;
    let bodyCount = 0;
    let faceCount = 0;

    const headMesh = headMeshRef.current;
    const bodyMesh = bodyMeshRef.current;
    const faceMesh = faceMeshRef.current;
    if (!headMesh || !bodyMesh || !faceMesh) return;

    const headUvAttr = headUvAttrRef.current;
    const bodyUvAttr = bodyUvAttrRef.current;
    const faceUvAttr = faceUvAttrRef.current;

    const m = new THREE.Matrix4();
    const white = new THREE.Color(0xffffff);
    const flashColor = new THREE.Color(0xff00ff);
    const tierFallbackColor = new THREE.Color(getTierColor(tier));

    // Get UV offsets from atlas
    const headUvs = getShnakeUVs(tier, 'head');
    const bodyUvs = getShnakeUVs(tier, 'body');
    const faceUvs = getShnakeUVs(tier, 'face');

    const hasHeadTexture = headUvs !== null;
    const hasBodyTexture = bodyUvs !== null;
    const hasFaceTexture = faceUvs !== null;

    // Calculate animated face UV offset if applicable
    let faceUvOffsetX = 0;
    let faceUvOffsetY = 0;
    if (faceUvs && faceUvs.frameCount > 1) {
      const elapsed = performance.now();
      const frameIndex = Math.floor(elapsed / faceUvs.frameDelayMs) % faceUvs.frameCount;
      const frameUVs = slotIndexToUVs(faceUvs.baseSlotIndex + frameIndex);
      faceUvOffsetX = frameUVs.uvOffsetX;
      faceUvOffsetY = frameUVs.uvOffsetY;
    } else if (faceUvs) {
      faceUvOffsetX = faceUvs.uvOffsetX;
      faceUvOffsetY = faceUvs.uvOffsetY;
    }

    for (const s of tierShnakes) {
      if (s.segments.length === 0) continue;

      const flashing = isFlashing(s.id, now);
      const instanceColor = flashing ? flashColor : (hasHeadTexture ? white : tierFallbackColor);
      const bodyInstanceColor = flashing ? flashColor : (hasBodyTexture ? white : tierFallbackColor);

      // Head
      const h = s.segments[0];
      const headWiggle = getWiggleOffset(s.id, 0, s.segments.length, now);
      m.makeTranslation(h.x + 0.5 + headWiggle.x, h.y + 0.5 + headWiggle.y, h.z + 0.5 + headWiggle.z);
      headMesh.setMatrixAt(headCount, m);
      headMesh.setColorAt(headCount, instanceColor);

      // Set UV offset for head
      if (headUvAttr && headUvs) {
        setInstanceUvOffset(headUvAttr, headCount, headUvs.uvOffsetX, headUvs.uvOffsetY);
      }
      headCount++;

      // Face on head
      const faceMatrix = new THREE.Matrix4();
      const facePos = new THREE.Vector3(h.x + 0.5 + headWiggle.x, h.y + 0.5 + headWiggle.y, h.z + 0.5 + headWiggle.z);

      if (s.headDir.lengthSq() > 0.01) {
        const targetDir = s.headDir.clone().normalize();
        const faceQuat = new THREE.Quaternion();
        const defaultDir = new THREE.Vector3(0, 0, 1);
        faceQuat.setFromUnitVectors(defaultDir, targetDir);
        faceMatrix.compose(facePos, faceQuat, new THREE.Vector3(1, 1, 1));
      } else {
        faceMatrix.makeTranslation(facePos.x, facePos.y, facePos.z);
      }

      faceMesh.setMatrixAt(faceCount, faceMatrix);
      faceMesh.setColorAt(faceCount, flashing ? flashColor : (hasFaceTexture ? white : new THREE.Color(0xff4444)));

      // Set UV offset for face (with animation)
      if (faceUvAttr && hasFaceTexture) {
        setInstanceUvOffset(faceUvAttr, faceCount, faceUvOffsetX, faceUvOffsetY);
      }
      faceCount++;

      // Body segments
      for (let i = 1; i < s.segments.length; i++) {
        const seg = s.segments[i];
        const wiggle = getWiggleOffset(s.id, i, s.segments.length, now);
        m.makeTranslation(seg.x + 0.5 + wiggle.x, seg.y + 0.5 + wiggle.y, seg.z + 0.5 + wiggle.z);
        bodyMesh.setMatrixAt(bodyCount, m);
        bodyMesh.setColorAt(bodyCount, bodyInstanceColor);

        // Set UV offset for body
        if (bodyUvAttr && bodyUvs) {
          setInstanceUvOffset(bodyUvAttr, bodyCount, bodyUvs.uvOffsetX, bodyUvs.uvOffsetY);
        }
        bodyCount++;
      }
    }

    headMesh.count = headCount;
    bodyMesh.count = bodyCount;
    faceMesh.count = faceCount;

    headMesh.instanceMatrix.needsUpdate = true;
    bodyMesh.instanceMatrix.needsUpdate = true;
    faceMesh.instanceMatrix.needsUpdate = true;

    if (headMesh.instanceColor) headMesh.instanceColor.needsUpdate = true;
    if (bodyMesh.instanceColor) bodyMesh.instanceColor.needsUpdate = true;
    if (faceMesh.instanceColor) faceMesh.instanceColor.needsUpdate = true;

    if (headUvAttr) headUvAttr.needsUpdate = true;
    if (bodyUvAttr) bodyUvAttr.needsUpdate = true;
    if (faceUvAttr) faceUvAttr.needsUpdate = true;
  });

  const maxHeads = 32;
  const maxBodies = 1024;
  const maxFaces = 32;

  return (
    <group>
      <instancedMesh
        ref={headMeshRef}
        args={[headGeo, headMaterial, maxHeads]}
        frustumCulled={false}
      />
      <instancedMesh
        ref={bodyMeshRef}
        args={[bodyGeo, bodyMaterial, maxBodies]}
        frustumCulled={false}
      />
      <instancedMesh
        ref={faceMeshRef}
        args={[faceGeo, faceMaterial, maxFaces]}
        frustumCulled={false}
      />
    </group>
  );
};

export const ShnakeRenderer = React.forwardRef<ShnakeRendererHandle, Props>(({ shnakesRef, cameraRef, universalFlameRef }, ref) => {
  const firesRef = useRef<SegmentFire[]>([]);
  const flashesRef = useRef<DamageFlash[]>([]);
  const wigglesRef = useRef<WiggleState[]>([]);
  // Track universal flame IDs for cleanup
  const universalFlameIdsRef = useRef<Map<string, string>>(new Map()); // attachId -> flameId

  // Track which tiers have active shnakes
  const [activeTiers, setActiveTiers] = useState<Set<number>>(new Set());

  // Update active tiers when shnakes change
  useEffect(() => {
    const interval = setInterval(() => {
      const shnakes = shnakesRef.current || [];
      const newTiers = new Set<number>();

      for (const s of shnakes) {
        if (!s.isActive) continue;
        newTiers.add(s.tier);
      }

      // Compare sets
      const currentArr = [...activeTiers].sort();
      const newArr = [...newTiers].sort();
      if (JSON.stringify(currentArr) !== JSON.stringify(newArr)) {
        setActiveTiers(newTiers);
      }
    }, 100);

    return () => clearInterval(interval);
  }, [shnakesRef, activeTiers]);

  // Shnake sounds
  useEffect(() => {
    const soundInterval = setInterval(() => {
      const shnakes = shnakesRef.current || [];
      const camera = cameraRef?.current;
      if (!camera) return;

      for (const s of shnakes) {
        if (!s.isActive || s.segments.length === 0) continue;

        if (Math.random() > SHNAKE_SOUND_CHANCE) continue;

        const head = s.segments[0];
        const dx = head.x + 0.5 - camera.position.x;
        const dy = head.y + 0.5 - camera.position.y;
        const dz = head.z + 0.5 - camera.position.z;
        const distance = Math.sqrt(dx * dx + dy * dy + dz * dz);

        const pitchMultiplier = 1.0 - ((s.tier - 1) * 0.025);
        const tierVolume = SHNAKE_SOUND_BASE_VOLUME + (s.tier * SHNAKE_SOUND_VOLUME_PER_TIER);
        const clampedVolume = Math.min(1.0, tierVolume);

        playSpatialSound(SHNAKE_SOUND_URL, distance, {
          baseVolume: clampedVolume,
          playbackRate: pitchMultiplier,
        });
      }
    }, SHNAKE_SOUND_INTERVAL);

    return () => clearInterval(soundInterval);
  }, [shnakesRef, cameraRef]);

  // Clean up flashes and update attached flame positions
  useFrame(() => {
    const now = performance.now();
    flashesRef.current = flashesRef.current.filter(f => now - f.startTime < f.duration);

    // Update attached flame positions for moving shnakes
    if (universalFlameRef?.current) {
      const shnakes = shnakesRef.current || [];

      // Update positions for active fires
      for (const fire of firesRef.current) {
        const elapsed = now - fire.startTime;
        if (elapsed >= fire.duration) continue;

        const shnake = shnakes.find(s => s.id === fire.shnakeId && s.isActive);
        if (!shnake || fire.segmentIndex >= shnake.segments.length) continue;

        const seg = shnake.segments[fire.segmentIndex];
        const attachId = `shnake_${fire.shnakeId}_seg${fire.segmentIndex}`;
        universalFlameRef.current.updateAttachedPosition(
          attachId,
          new THREE.Vector3(seg.x + 0.5, seg.y + 0.7, seg.z + 0.5)
        );
      }

      // Clean up flames for expired fires or dead shnakes
      firesRef.current = firesRef.current.filter(fire => {
        const elapsed = now - fire.startTime;
        if (elapsed >= fire.duration) {
          const attachId = `shnake_${fire.shnakeId}_seg${fire.segmentIndex}`;
          const flameId = universalFlameIdsRef.current.get(attachId);
          if (flameId) {
            universalFlameRef.current?.removeFlame(flameId);
            universalFlameIdsRef.current.delete(attachId);
          }
          return false;
        }

        const shnake = shnakes.find(s => s.id === fire.shnakeId && s.isActive);
        if (!shnake) {
          const attachId = `shnake_${fire.shnakeId}_seg${fire.segmentIndex}`;
          const flameId = universalFlameIdsRef.current.get(attachId);
          if (flameId) {
            universalFlameRef.current?.removeFlame(flameId);
            universalFlameIdsRef.current.delete(attachId);
          }
          return false;
        }

        return true;
      });
    }
  });

  // Expose methods
  React.useImperativeHandle(ref, () => ({
    getSegmentAtPosition: (x: number, y: number, z: number) => {
      const shnakes = shnakesRef.current || [];
      const fx = Math.floor(x);
      const fy = Math.floor(y);
      const fz = Math.floor(z);

      for (const s of shnakes) {
        if (!s.isActive) continue;
        for (let i = 0; i < s.segments.length; i++) {
          const seg = s.segments[i];
          if (seg.x === fx && seg.y === fy && seg.z === fz) {
            return { shnakeId: s.id, segmentIndex: i, isHead: i === 0 };
          }
        }
      }
      return null;
    },

    addFireToSegment: (shnakeId: string, segmentIndex: number, duration: number, colors: string[]) => {
      // Store fire tracking info
      firesRef.current.push({
        shnakeId,
        segmentIndex,
        startTime: performance.now(),
        duration,
        colors,
      });

      // Spawn visual flame via UniversalFlameRenderer if available
      if (universalFlameRef?.current) {
        const shnakes = shnakesRef.current || [];
        const shnake = shnakes.find(s => s.id === shnakeId && s.isActive);
        if (shnake && segmentIndex < shnake.segments.length) {
          const seg = shnake.segments[segmentIndex];
          const attachId = `shnake_${shnakeId}_seg${segmentIndex}`;
          const flameId = universalFlameRef.current.spawnFlame({
            type: 'point',
            position: new THREE.Vector3(seg.x + 0.5, seg.y + 0.7, seg.z + 0.5),
            colors: colors,
            size: 0.6,
            height: 0.8,
            duration: duration / 1000,
            particleCount: 50,
            attachTo: attachId,
          });
          universalFlameIdsRef.current.set(attachId, flameId);
        }
      }
    },

    getActiveFires: () => {
      const now = performance.now();
      const shnakes = shnakesRef.current || [];
      const result: Array<{ position: THREE.Vector3; colors: string[]; progress: number }> = [];

      firesRef.current = firesRef.current.filter(fire => {
        const elapsed = now - fire.startTime;
        if (elapsed >= fire.duration) return false;

        const shnake = shnakes.find(s => s.id === fire.shnakeId && s.isActive);
        if (!shnake) return false;

        if (fire.segmentIndex < shnake.segments.length) {
          const seg = shnake.segments[fire.segmentIndex];
          result.push({
            position: new THREE.Vector3(seg.x + 0.5, seg.y + 0.5, seg.z + 0.5),
            colors: fire.colors,
            progress: elapsed / fire.duration,
          });
        }

        return true;
      });

      return result;
    },

    triggerDamageFlash: (shnakeId: string) => {
      if (typeof (window as any).__markShnakeAttacked === 'function') {
        (window as any).__markShnakeAttacked(shnakeId);
      }

      flashesRef.current = flashesRef.current.filter(f => f.shnakeId !== shnakeId);
      flashesRef.current.push({
        shnakeId,
        startTime: performance.now(),
        duration: 1000,
      });
    },

    propagateFire: (shnakeId: string) => {
      firesRef.current = firesRef.current.map(fire => {
        if (fire.shnakeId !== shnakeId) return fire;

        const newIndex = fire.segmentIndex - 1;
        if (newIndex < 0) {
          return { ...fire, segmentIndex: -999 };
        }

        return { ...fire, segmentIndex: newIndex };
      }).filter(fire => fire.segmentIndex >= 0);
    },

    playDeathSound: (position: THREE.Vector3, tier: number) => {
      const camera = cameraRef?.current;
      if (!camera) return;

      const dx = position.x - camera.position.x;
      const dy = position.y - camera.position.y;
      const dz = position.z - camera.position.z;
      const distance = Math.sqrt(dx * dx + dy * dy + dz * dz);

      const tierVolume = SHNAKE_SOUND_BASE_VOLUME + (tier * SHNAKE_SOUND_VOLUME_PER_TIER);
      const clampedVolume = Math.min(2.0, tierVolume);
      const pitchMultiplier = 1.0 - ((tier - 1) * 0.025);

      playSpatialSound(SHNAKE_DEATH_SOUND_URL, distance, {
        baseVolume: clampedVolume,
        playbackRate: pitchMultiplier,
      });
    },

    triggerWiggle: (shnakeId: string) => {
      wigglesRef.current = wigglesRef.current.filter(w => w.shnakeId !== shnakeId);
      wigglesRef.current.push({
        shnakeId,
        startTime: performance.now(),
        duration: WIGGLE_DURATION,
      });
    },
  }), [shnakesRef, cameraRef]);

  // Render a TierRenderer for each active tier
  const tiers = [...activeTiers];

  return (
    <group>
      {tiers.map((tier) => (
        <TierRenderer
          key={tier}
          tier={tier}
          shnakesRef={shnakesRef}
          flashesRef={flashesRef}
          wigglesRef={wigglesRef}
        />
      ))}
    </group>
  );
});

ShnakeRenderer.displayName = 'ShnakeRenderer';
