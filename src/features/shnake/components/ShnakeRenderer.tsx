import React, { useMemo, useRef, useEffect, useState } from 'react';
import * as THREE from 'three';
import { useFrame } from '@react-three/fiber';
import type { ShnakeInstance } from '../types';
import { playSpatialSound } from '@/lib/spatialAudio';
import { parseStripMetadata } from '@/lib/animationToStrip';

interface Props {
  shnakesRef: React.RefObject<ShnakeInstance[]>;
  cameraRef?: React.RefObject<THREE.Camera>;
}

// Fire effect tracking per shnake segment
// segmentIndex moves with the snake: when head moves, fire propagates toward head
interface SegmentFire {
  shnakeId: string;
  segmentIndex: number; // Current segment index (decrements as head moves)
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

// Wiggle animation state per shnake (indignant behavior)
interface WiggleState {
  shnakeId: string;
  startTime: number;
  duration: number; // 2 seconds of wiggling
}

export interface ShnakeRendererHandle {
  getSegmentAtPosition: (x: number, y: number, z: number) => { shnakeId: string; segmentIndex: number; isHead: boolean } | null;
  addFireToSegment: (shnakeId: string, segmentIndex: number, duration: number, colors: string[]) => void;
  getActiveFires: () => Array<{ position: THREE.Vector3; colors: string[]; progress: number }>;
  triggerDamageFlash: (shnakeId: string) => void;
  propagateFire: (shnakeId: string) => void; // Called when shnake head moves
  playDeathSound: (position: THREE.Vector3, tier: number) => void; // Play death sound at position
  triggerWiggle: (shnakeId: string) => void; // Trigger S-formation wiggle animation
}

// Fallback colors for tiers without textures
const TIER_COLORS: { [tier: number]: number } = {
  1: 0x22ff44,   // bright green
  2: 0x44ff66,
  3: 0x66ff88,
  4: 0x88ffaa,
  5: 0xaaffcc,
  6: 0xccffee,
  7: 0x44ccff,   // cyan
  8: 0x6688ff,
  9: 0x8844ff,
  10: 0xaa22ff,  // purple
  11: 0xff44aa,  // pink
  12: 0xff6688,
  13: 0xff8866,  // orange
  14: 0xffaa44,
  15: 0xffcc22,  // yellow
  16: 0xeeff00,
  17: 0xccff00,
  18: 0xaaff00,
  19: 0x88ff22,
  20: 0x66ff44,
};

const getTierColor = (tier: number): number => TIER_COLORS[tier] || 0x22ff44;

// Check if URL is a valid image format
const isValidTextureUrl = (url: string | null | undefined): boolean => {
  if (!url) return false;
  const lower = url.toLowerCase();
  // Only allow web-compatible formats
  return lower.endsWith('.webp') || lower.endsWith('.png') || lower.endsWith('.jpg') || lower.endsWith('.jpeg') || lower.endsWith('.gif');
};

// Shnake sound constants
const SHNAKE_SOUND_URL = '/shnake_sound_1.mp3';
const SHNAKE_DEATH_SOUND_URL = '/shnake_death.mp3';
const SHNAKE_SOUND_CHANCE = 0.00333; // ~0.33% chance per second (1/3 of previous 1%)
const SHNAKE_SOUND_INTERVAL = 1000; // Check every 1 second
// Volume doubled: base 32% + 5.6% per tier (tier 1 = 37.6%, tier 30 = 200%)
const SHNAKE_SOUND_BASE_VOLUME = 0.32; // 32% base volume (2x original 16%)
const SHNAKE_SOUND_VOLUME_PER_TIER = 0.056; // +5.6% per tier (2x original 2.8%)

// Wiggle animation constants
const WIGGLE_DURATION = 2000; // 2 seconds
const WIGGLE_FREQUENCY = 3; // 3 full oscillations
const WIGGLE_AMPLITUDE = 1.2; // Max offset in world units (3x larger undulations)

// Per-tier rendering component
interface TierRendererProps {
  tier: number;
  shnakesRef: React.RefObject<ShnakeInstance[]>;
  flashesRef: React.RefObject<DamageFlash[]>;
  wigglesRef: React.RefObject<WiggleState[]>;
  headTexUrl: string | null;
  bodyTexUrl: string | null;
  faceTexUrl: string | null;
}

const TierRenderer: React.FC<TierRendererProps> = ({ 
  tier, 
  shnakesRef, 
  flashesRef,
  wigglesRef,
  headTexUrl,
  bodyTexUrl,
  faceTexUrl,
}) => {
  const headMeshRef = useRef<THREE.InstancedMesh>(null);
  const bodyMeshRef = useRef<THREE.InstancedMesh>(null);
  const faceMeshRef = useRef<THREE.InstancedMesh>(null);
  
  // Track face texture for strip animation
  const faceTextureRef = useRef<THREE.Texture | null>(null);
  const faceStripInfo = useMemo(() => parseStripMetadata(faceTexUrl), [faceTexUrl]);

  // Geometry - memoized once
  const headGeo = useMemo(() => new THREE.BoxGeometry(1, 1, 1), []);
  const bodyGeo = useMemo(() => new THREE.BoxGeometry(1, 1, 1), []);
  const faceGeo = useMemo(() => {
    const geo = new THREE.PlaneGeometry(1, 1);
    geo.translate(0, 0, 0.501);
    return geo;
  }, []);

  // Load textures with proper error handling - NO vertexColors
  const [headMaterial, setHeadMaterial] = useState<THREE.Material>(() => 
    new THREE.MeshLambertMaterial({ color: getTierColor(tier) })
  );
  const [bodyMaterial, setBodyMaterial] = useState<THREE.Material>(() => 
    new THREE.MeshLambertMaterial({ color: getTierColor(tier) })
  );
  const [faceMaterial, setFaceMaterial] = useState<THREE.Material>(() => 
    new THREE.MeshLambertMaterial({ color: 0xff4444, side: THREE.DoubleSide })
  );

  // Load textures on mount and when URLs change
  useEffect(() => {
    const loader = new THREE.TextureLoader();
    const tierColor = getTierColor(tier);
    
    // Head texture
    if (isValidTextureUrl(headTexUrl)) {
      console.log(`[TierRenderer T${tier}] Loading head: ${headTexUrl}`);
      loader.load(
        headTexUrl!,
        (tex) => {
          tex.magFilter = THREE.NearestFilter;
          tex.minFilter = THREE.NearestFilter;
          tex.colorSpace = THREE.SRGBColorSpace;
          tex.needsUpdate = true;
          setHeadMaterial(new THREE.MeshLambertMaterial({ map: tex }));
          console.log(`[TierRenderer T${tier}] Head texture loaded successfully`);
        },
        undefined,
        (err) => {
          console.warn(`[TierRenderer T${tier}] Head texture failed:`, err);
          setHeadMaterial(new THREE.MeshLambertMaterial({ color: tierColor }));
        }
      );
    } else {
      console.log(`[TierRenderer T${tier}] No valid head texture, using color: ${headTexUrl}`);
      setHeadMaterial(new THREE.MeshLambertMaterial({ color: tierColor }));
    }
    
    // Body texture
    if (isValidTextureUrl(bodyTexUrl)) {
      console.log(`[TierRenderer T${tier}] Loading body: ${bodyTexUrl}`);
      loader.load(
        bodyTexUrl!,
        (tex) => {
          tex.magFilter = THREE.NearestFilter;
          tex.minFilter = THREE.NearestFilter;
          tex.colorSpace = THREE.SRGBColorSpace;
          tex.needsUpdate = true;
          setBodyMaterial(new THREE.MeshLambertMaterial({ map: tex }));
          console.log(`[TierRenderer T${tier}] Body texture loaded successfully`);
        },
        undefined,
        (err) => {
          console.warn(`[TierRenderer T${tier}] Body texture failed:`, err);
          setBodyMaterial(new THREE.MeshLambertMaterial({ color: tierColor }));
        }
      );
    } else {
      console.log(`[TierRenderer T${tier}] No valid body texture, using color: ${bodyTexUrl}`);
      setBodyMaterial(new THREE.MeshLambertMaterial({ color: tierColor }));
    }
    
    // Face texture - with strip animation support
    if (isValidTextureUrl(faceTexUrl)) {
      console.log(`[TierRenderer T${tier}] Loading face: ${faceTexUrl}`);
      loader.load(
        faceTexUrl!,
        (tex) => {
          tex.magFilter = THREE.NearestFilter;
          tex.minFilter = THREE.NearestFilter;
          tex.colorSpace = THREE.SRGBColorSpace;
          
          // Configure for strip animation if applicable
          const stripInfo = parseStripMetadata(faceTexUrl);
          if (stripInfo) {
            tex.wrapS = THREE.RepeatWrapping;
            tex.repeat.set(1 / stripInfo.frames, 1);
            tex.offset.set(0, 0);
            console.log(`[TierRenderer T${tier}] Face is animated strip: ${stripInfo.frames} frames, ${stripInfo.delay}ms delay`);
          }
          
          tex.needsUpdate = true;
          faceTextureRef.current = tex;
          setFaceMaterial(new THREE.MeshLambertMaterial({ map: tex, side: THREE.DoubleSide, transparent: true }));
          console.log(`[TierRenderer T${tier}] Face texture loaded successfully`);
        },
        undefined,
        (err) => {
          console.warn(`[TierRenderer T${tier}] Face texture failed:`, err);
          faceTextureRef.current = null;
          setFaceMaterial(new THREE.MeshLambertMaterial({ color: 0xff4444, side: THREE.DoubleSide }));
        }
      );
    } else {
      console.log(`[TierRenderer T${tier}] No valid face texture, using color: ${faceTexUrl}`);
      faceTextureRef.current = null;
      setFaceMaterial(new THREE.MeshLambertMaterial({ color: 0xff4444, side: THREE.DoubleSide }));
    }
  }, [tier, headTexUrl, bodyTexUrl, faceTexUrl]);

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
    
    // Progress through animation (0 to 1)
    const progress = elapsed / wiggle.duration;
    
    // Fade out amplitude over time
    const fadeOut = 1 - progress;
    
    // S-wave: phase offset based on segment position
    const phaseOffset = (segmentIndex / totalSegments) * Math.PI * 2;
    const timePhase = progress * WIGGLE_FREQUENCY * Math.PI * 2;
    
    // Calculate perpendicular offset (S-wave along body)
    const offset = Math.sin(timePhase + phaseOffset) * WIGGLE_AMPLITUDE * fadeOut;
    
    // Return offset in X direction (perpendicular to typical snake movement)
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

    const m = new THREE.Matrix4();
    const white = new THREE.Color(0xffffff);
    const flashColor = new THREE.Color(0xff00ff);

    for (const s of tierShnakes) {
      if (s.segments.length === 0) continue;
      
      const flashing = isFlashing(s.id, now);
      const instanceColor = flashing ? flashColor : white;

      // Head - apply wiggle offset
      const h = s.segments[0];
      const headWiggle = getWiggleOffset(s.id, 0, s.segments.length, now);
      m.makeTranslation(h.x + 0.5 + headWiggle.x, h.y + 0.5 + headWiggle.y, h.z + 0.5 + headWiggle.z);
      headMesh.setMatrixAt(headCount, m);
      headMesh.setColorAt(headCount, instanceColor);
      headCount++;

      // Face on head - also apply wiggle
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
      faceMesh.setColorAt(faceCount, instanceColor);
      faceCount++;

      // Body segments - apply wiggle offset to each
      for (let i = 1; i < s.segments.length; i++) {
        const seg = s.segments[i];
        const wiggle = getWiggleOffset(s.id, i, s.segments.length, now);
        m.makeTranslation(seg.x + 0.5 + wiggle.x, seg.y + 0.5 + wiggle.y, seg.z + 0.5 + wiggle.z);
        bodyMesh.setMatrixAt(bodyCount, m);
        bodyMesh.setColorAt(bodyCount, instanceColor);
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
    
    // Animate face strip texture (if applicable) - cheap UV offset, no needsUpdate needed
    if (faceStripInfo && faceTextureRef.current) {
      const elapsed = performance.now();
      const frameIndex = Math.floor(elapsed / faceStripInfo.delay) % faceStripInfo.frames;
      faceTextureRef.current.offset.x = frameIndex / faceStripInfo.frames;
    }
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

export const ShnakeRenderer = React.forwardRef<ShnakeRendererHandle, Props>(({ shnakesRef, cameraRef }, ref) => {
  const firesRef = useRef<SegmentFire[]>([]);
  const flashesRef = useRef<DamageFlash[]>([]);
  const wigglesRef = useRef<WiggleState[]>([]);
  
  // Track which tiers have active shnakes and their texture URLs
  const [tierData, setTierData] = useState<Map<number, { head: string | null; body: string | null; face: string | null }>>(new Map());
  
  // Update tier data when shnakes change
  useEffect(() => {
    const interval = setInterval(() => {
      const shnakes = shnakesRef.current || [];
      const newData = new Map<number, { head: string | null; body: string | null; face: string | null }>();
      
      for (const s of shnakes) {
        if (!s.isActive) continue;
        if (newData.has(s.tier)) continue;
        
        // Get texture URLs - only use valid formats
        const head = isValidTextureUrl(s.definition.head_texture_url) ? s.definition.head_texture_url : null;
        const body = isValidTextureUrl(s.definition.body_texture_url) ? s.definition.body_texture_url : null;
        const face = isValidTextureUrl(s.definition.face_texture_url) ? s.definition.face_texture_url : null;
        
        newData.set(s.tier, { head, body, face });
      }
      
      // Deep compare - detect texture URL changes, not just tier presence
      const serialize = (m: Map<number, { head: string | null; body: string | null; face: string | null }>) => 
        JSON.stringify([...m.entries()].sort((a, b) => a[0] - b[0]));
      
      if (serialize(newData) !== serialize(tierData)) {
        setTierData(newData);
      }
    }, 100); // Reduced from 500ms for faster texture updates
    
    return () => clearInterval(interval);
  }, [shnakesRef, tierData]);

  // Shnake sounds - ~0.33% chance per second per shnake
  useEffect(() => {
    const soundInterval = setInterval(() => {
      const shnakes = shnakesRef.current || [];
      const camera = cameraRef?.current;
      if (!camera) return;
      
      for (const s of shnakes) {
        if (!s.isActive || s.segments.length === 0) continue;
        
        // ~0.33% chance per second (1/3 of original)
        if (Math.random() > SHNAKE_SOUND_CHANCE) continue;
        
        // Calculate distance to player
        const head = s.segments[0];
        const dx = head.x + 0.5 - camera.position.x;
        const dy = head.y + 0.5 - camera.position.y;
        const dz = head.z + 0.5 - camera.position.z;
        const distance = Math.sqrt(dx * dx + dy * dy + dz * dz);
        
        // Lower pitch by 2.5% per tier above 1
        const pitchMultiplier = 1.0 - ((s.tier - 1) * 0.025);
        
        // Volume: 16% base + 2.8% per tier (tier 1 = 18.8%, tier 30 = 100%)
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

  // Clean up flashes periodically
  useFrame(() => {
    const now = performance.now();
    flashesRef.current = flashesRef.current.filter(f => now - f.startTime < f.duration);
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
      firesRef.current.push({
        shnakeId,
        segmentIndex,
        startTime: performance.now(),
        duration,
        colors,
      });
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
      // Mark shnake as attacked for ground-attack behavior
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
    
    // Called when shnake head moves - propagate fire toward head by decrementing indices
    propagateFire: (shnakeId: string) => {
      firesRef.current = firesRef.current.map(fire => {
        if (fire.shnakeId !== shnakeId) return fire;
        
        // Decrement segment index (fire moves toward head as body follows)
        const newIndex = fire.segmentIndex - 1;
        
        // If fire reaches index -1, it has passed through the head and should be removed
        if (newIndex < 0) {
          return { ...fire, segmentIndex: -999 }; // Mark for removal
        }
        
        return { ...fire, segmentIndex: newIndex };
      }).filter(fire => fire.segmentIndex >= 0);
    },
    
    // Play death sound at a specific position
    playDeathSound: (position: THREE.Vector3, tier: number) => {
      const camera = cameraRef?.current;
      if (!camera) return;
      
      const dx = position.x - camera.position.x;
      const dy = position.y - camera.position.y;
      const dz = position.z - camera.position.z;
      const distance = Math.sqrt(dx * dx + dy * dy + dz * dz);
      
      // Volume: same formula as ambient sounds but for death
      const tierVolume = SHNAKE_SOUND_BASE_VOLUME + (tier * SHNAKE_SOUND_VOLUME_PER_TIER);
      const clampedVolume = Math.min(2.0, tierVolume); // Allow up to 200%
      
      // Lower pitch for higher tiers
      const pitchMultiplier = 1.0 - ((tier - 1) * 0.025);
      
      playSpatialSound(SHNAKE_DEATH_SOUND_URL, distance, {
        baseVolume: clampedVolume,
        playbackRate: pitchMultiplier,
      });
    },
    
    // Trigger S-formation wiggle animation for indignant behavior
    triggerWiggle: (shnakeId: string) => {
      // Remove existing wiggle for this shnake
      wigglesRef.current = wigglesRef.current.filter(w => w.shnakeId !== shnakeId);
      // Add new wiggle
      wigglesRef.current.push({
        shnakeId,
        startTime: performance.now(),
        duration: WIGGLE_DURATION,
      });
    },
  }), [shnakesRef, cameraRef]);

  // Render a TierRenderer for each active tier
  const tiers = [...tierData.entries()];

  return (
    <group>
      {tiers.map(([tier, urls]) => (
        <TierRenderer
          key={tier}
          tier={tier}
          shnakesRef={shnakesRef}
          flashesRef={flashesRef}
          wigglesRef={wigglesRef}
          headTexUrl={urls.head}
          bodyTexUrl={urls.body}
          faceTexUrl={urls.face}
        />
      ))}
    </group>
  );
});

ShnakeRenderer.displayName = 'ShnakeRenderer';
