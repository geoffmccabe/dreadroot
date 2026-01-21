import React, { useMemo, useRef, useEffect, useState } from 'react';
import * as THREE from 'three';
import { useFrame } from '@react-three/fiber';
import type { ShnakeInstance } from '../types';
import { playSpatialSound } from '@/lib/spatialAudio';

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

export interface ShnakeRendererHandle {
  getSegmentAtPosition: (x: number, y: number, z: number) => { shnakeId: string; segmentIndex: number; isHead: boolean } | null;
  addFireToSegment: (shnakeId: string, segmentIndex: number, duration: number, colors: string[]) => void;
  getActiveFires: () => Array<{ position: THREE.Vector3; colors: string[]; progress: number }>;
  triggerDamageFlash: (shnakeId: string) => void;
  propagateFire: (shnakeId: string) => void; // Called when shnake head moves
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
const SHNAKE_SOUND_CHANCE = 0.01; // 1% chance per second
const SHNAKE_SOUND_INTERVAL = 1000; // Check every 1 second

// Per-tier rendering component
interface TierRendererProps {
  tier: number;
  shnakesRef: React.RefObject<ShnakeInstance[]>;
  flashesRef: React.RefObject<DamageFlash[]>;
  headTexUrl: string | null;
  bodyTexUrl: string | null;
  faceTexUrl: string | null;
}

const TierRenderer: React.FC<TierRendererProps> = ({ 
  tier, 
  shnakesRef, 
  flashesRef,
  headTexUrl,
  bodyTexUrl,
  faceTexUrl,
}) => {
  const headMeshRef = useRef<THREE.InstancedMesh>(null);
  const bodyMeshRef = useRef<THREE.InstancedMesh>(null);
  const faceMeshRef = useRef<THREE.InstancedMesh>(null);

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
    
    // Face texture
    if (isValidTextureUrl(faceTexUrl)) {
      console.log(`[TierRenderer T${tier}] Loading face: ${faceTexUrl}`);
      loader.load(
        faceTexUrl!,
        (tex) => {
          tex.magFilter = THREE.NearestFilter;
          tex.minFilter = THREE.NearestFilter;
          tex.colorSpace = THREE.SRGBColorSpace;
          tex.needsUpdate = true;
          setFaceMaterial(new THREE.MeshLambertMaterial({ map: tex, side: THREE.DoubleSide, transparent: true }));
          console.log(`[TierRenderer T${tier}] Face texture loaded successfully`);
        },
        undefined,
        (err) => {
          console.warn(`[TierRenderer T${tier}] Face texture failed:`, err);
          setFaceMaterial(new THREE.MeshLambertMaterial({ color: 0xff4444, side: THREE.DoubleSide }));
        }
      );
    } else {
      console.log(`[TierRenderer T${tier}] No valid face texture, using color: ${faceTexUrl}`);
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

      // Head
      const h = s.segments[0];
      m.makeTranslation(h.x + 0.5, h.y + 0.5, h.z + 0.5);
      headMesh.setMatrixAt(headCount, m);
      headMesh.setColorAt(headCount, instanceColor);
      headCount++;

      // Face on head
      const faceMatrix = new THREE.Matrix4();
      const facePos = new THREE.Vector3(h.x + 0.5, h.y + 0.5, h.z + 0.5);
      
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

      // Body segments
      for (let i = 1; i < s.segments.length; i++) {
        const seg = s.segments[i];
        m.makeTranslation(seg.x + 0.5, seg.y + 0.5, seg.z + 0.5);
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
    }, 500);
    
    return () => clearInterval(interval);
  }, [shnakesRef, tierData]);

  // Shnake sounds - 1% chance per second per shnake
  useEffect(() => {
    const soundInterval = setInterval(() => {
      const shnakes = shnakesRef.current || [];
      const camera = cameraRef?.current;
      if (!camera) return;
      
      for (const s of shnakes) {
        if (!s.isActive || s.segments.length === 0) continue;
        
        // 1% chance per second
        if (Math.random() > SHNAKE_SOUND_CHANCE) continue;
        
        // Calculate distance to player
        const head = s.segments[0];
        const dx = head.x + 0.5 - camera.position.x;
        const dy = head.y + 0.5 - camera.position.y;
        const dz = head.z + 0.5 - camera.position.z;
        const distance = Math.sqrt(dx * dx + dy * dy + dz * dz);
        
        // Lower pitch by 2.5% per tier above 1
        const pitchMultiplier = 1.0 - ((s.tier - 1) * 0.025);
        
        playSpatialSound(SHNAKE_SOUND_URL, distance, {
          baseVolume: 0.5,
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
  }), [shnakesRef]);

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
          headTexUrl={urls.head}
          bodyTexUrl={urls.body}
          faceTexUrl={urls.face}
        />
      ))}
    </group>
  );
});

ShnakeRenderer.displayName = 'ShnakeRenderer';
