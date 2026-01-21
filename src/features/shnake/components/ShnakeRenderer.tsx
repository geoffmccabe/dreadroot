import React, { useMemo, useRef, useEffect, useState } from 'react';
import * as THREE from 'three';
import { useFrame } from '@react-three/fiber';
import type { ShnakeInstance } from '../types';

interface Props {
  shnakesRef: React.RefObject<ShnakeInstance[]>;
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

export interface ShnakeRendererHandle {
  getSegmentAtPosition: (x: number, y: number, z: number) => { shnakeId: string; segmentIndex: number; isHead: boolean } | null;
  addFireToSegment: (shnakeId: string, segmentIndex: number, duration: number, colors: string[]) => void;
  getActiveFires: () => Array<{ position: THREE.Vector3; colors: string[]; progress: number }>;
  triggerDamageFlash: (shnakeId: string) => void;
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
  const [headTex, setHeadTex] = useState<THREE.Texture | null>(null);
  const [bodyTex, setBodyTex] = useState<THREE.Texture | null>(null);
  const [faceTex, setFaceTex] = useState<THREE.Texture | null>(null);
  
  const headMeshRef = useRef<THREE.InstancedMesh>(null);
  const bodyMeshRef = useRef<THREE.InstancedMesh>(null);
  const faceMeshRef = useRef<THREE.InstancedMesh>(null);

  // Geometry
  const headGeo = useMemo(() => new THREE.BoxGeometry(1, 1, 1), []);
  const bodyGeo = useMemo(() => new THREE.BoxGeometry(1, 1, 1), []);
  const faceGeo = useMemo(() => {
    const geo = new THREE.PlaneGeometry(1, 1);
    geo.translate(0, 0, 0.501);
    return geo;
  }, []);

  // Load textures
  useEffect(() => {
    const loader = new THREE.TextureLoader();
    
    const loadTex = (url: string | null, setter: (t: THREE.Texture | null) => void) => {
      if (!url) {
        setter(null);
        return;
      }
      // Skip unsupported formats
      const lower = url.toLowerCase();
      if (lower.endsWith('.psd') || lower.endsWith('.ai') || lower.endsWith('.eps')) {
        console.warn(`[TierRenderer T${tier}] Unsupported format: ${url}`);
        setter(null);
        return;
      }
      
      loader.load(
        url,
        (tex) => {
          tex.magFilter = THREE.NearestFilter;
          tex.minFilter = THREE.NearestFilter;
          tex.colorSpace = THREE.SRGBColorSpace;
          console.log(`[TierRenderer T${tier}] Loaded texture: ${url}`);
          setter(tex);
        },
        undefined,
        (err) => {
          console.warn(`[TierRenderer T${tier}] Failed to load: ${url}`, err);
          setter(null);
        }
      );
    };
    
    loadTex(headTexUrl, setHeadTex);
    loadTex(bodyTexUrl, setBodyTex);
    loadTex(faceTexUrl, setFaceTex);
  }, [tier, headTexUrl, bodyTexUrl, faceTexUrl]);

  // Materials with textures or fallback colors
  const tierColor = getTierColor(tier);
  
  const headMaterial = useMemo(() => {
    if (headTex) {
      return new THREE.MeshLambertMaterial({ map: headTex, vertexColors: true });
    }
    return new THREE.MeshLambertMaterial({ color: tierColor, vertexColors: true });
  }, [headTex, tierColor]);

  const bodyMaterial = useMemo(() => {
    if (bodyTex) {
      return new THREE.MeshLambertMaterial({ map: bodyTex, vertexColors: true });
    }
    return new THREE.MeshLambertMaterial({ color: tierColor, vertexColors: true });
  }, [bodyTex, tierColor]);

  const faceMaterial = useMemo(() => {
    if (faceTex) {
      return new THREE.MeshLambertMaterial({ map: faceTex, vertexColors: true, side: THREE.DoubleSide, transparent: true });
    }
    return new THREE.MeshLambertMaterial({ color: 0xff4444, vertexColors: true, side: THREE.DoubleSide });
  }, [faceTex]);

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
    const flash = new THREE.Color(0xff00ff);
    const flashCyan = new THREE.Color(0x00ffff);

    for (const s of tierShnakes) {
      if (s.segments.length === 0) continue;
      
      const flashing = isFlashing(s.id, now);

      // Head
      const h = s.segments[0];
      m.makeTranslation(h.x + 0.5, h.y + 0.5, h.z + 0.5);
      headMesh.setMatrixAt(headCount, m);
      headMesh.setColorAt(headCount, flashing ? flash : white);
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
      faceMesh.setColorAt(faceCount, flashing ? flashCyan : white);
      faceCount++;

      // Body segments
      for (let i = 1; i < s.segments.length; i++) {
        const seg = s.segments[i];
        m.makeTranslation(seg.x + 0.5, seg.y + 0.5, seg.z + 0.5);
        bodyMesh.setMatrixAt(bodyCount, m);
        bodyMesh.setColorAt(bodyCount, flashing ? flash : white);
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

export const ShnakeRenderer = React.forwardRef<ShnakeRendererHandle, Props>(({ shnakesRef }, ref) => {
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
        
        newData.set(s.tier, {
          head: s.definition.head_texture_url || null,
          body: s.definition.body_texture_url || null,
          face: s.definition.face_texture_url || null,
        });
      }
      
      // Only update if changed
      if (newData.size !== tierData.size || 
          [...newData.keys()].some(t => !tierData.has(t))) {
        setTierData(newData);
      }
    }, 500);
    
    return () => clearInterval(interval);
  }, [shnakesRef, tierData]);

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
      flashesRef.current = flashesRef.current.filter(f => f.shnakeId !== shnakeId);
      flashesRef.current.push({
        shnakeId,
        startTime: performance.now(),
        duration: 1000,
      });
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
