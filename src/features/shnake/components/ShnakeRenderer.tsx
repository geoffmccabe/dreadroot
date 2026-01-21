import React, { useMemo, useRef, useEffect } from 'react';
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

// Texture cache per URL
interface TextureCache {
  [url: string]: THREE.Texture | null;
}

export interface ShnakeRendererHandle {
  getSegmentAtPosition: (x: number, y: number, z: number) => { shnakeId: string; segmentIndex: number; isHead: boolean } | null;
  addFireToSegment: (shnakeId: string, segmentIndex: number, duration: number, colors: string[]) => void;
  getActiveFires: () => Array<{ position: THREE.Vector3; colors: string[]; progress: number }>;
  triggerDamageFlash: (shnakeId: string) => void;
}

// Fallback colors for tiers without textures
const TIER_COLORS = [
  0x22ff44, // T1 - bright green
  0x44ff66, // T2
  0x66ff88, // T3
  0x88ffaa, // T4
  0xaaffcc, // T5
  0xccffee, // T6
  0x44ccff, // T7 - cyan
  0x6688ff, // T8
  0x8844ff, // T9
  0xaa22ff, // T10 - purple
  0xff44aa, // T11 - pink
  0xff6688, // T12
  0xff8866, // T13 - orange
  0xffaa44, // T14
  0xffcc22, // T15 - yellow
  0xeeff00, // T16
  0xccff00, // T17
  0xaaff00, // T18
  0x88ff22, // T19
  0x66ff44, // T20
];

// Get fallback color for tier
const getTierColor = (tier: number): number => {
  return TIER_COLORS[(tier - 1) % TIER_COLORS.length];
};

export const ShnakeRenderer = React.forwardRef<ShnakeRendererHandle, Props>(({ shnakesRef }, ref) => {
  // Texture loading state
  const textureLoaderRef = useRef(new THREE.TextureLoader());
  const textureCacheRef = useRef<TextureCache>({});
  const loadingUrlsRef = useRef<Set<string>>(new Set());
  
  // Force re-render when textures load
  const [, forceUpdate] = React.useState(0);
  
  // Geometry for cubes
  const headGeo = useMemo(() => new THREE.BoxGeometry(1, 1, 1), []);
  const bodyGeo = useMemo(() => new THREE.BoxGeometry(1, 1, 1), []);
  const faceGeo = useMemo(() => {
    const geo = new THREE.PlaneGeometry(1, 1);
    geo.translate(0, 0, 0.501);
    return geo;
  }, []);

  const headMeshRef = useRef<THREE.InstancedMesh>(null);
  const bodyMeshRef = useRef<THREE.InstancedMesh>(null);
  const faceMeshRef = useRef<THREE.InstancedMesh>(null);
  
  const firesRef = useRef<SegmentFire[]>([]);
  const flashesRef = useRef<DamageFlash[]>([]);

  // Load texture from URL (with caching)
  const loadTexture = (url: string | null | undefined): THREE.Texture | null => {
    if (!url) return null;
    
    // Skip unsupported formats like .psd
    const lowerUrl = url.toLowerCase();
    if (lowerUrl.endsWith('.psd') || lowerUrl.endsWith('.ai') || lowerUrl.endsWith('.eps')) {
      console.warn(`[ShnakeRenderer] Unsupported texture format: ${url}`);
      return null;
    }
    
    // Return cached texture if available
    if (textureCacheRef.current[url] !== undefined) {
      return textureCacheRef.current[url];
    }
    
    // Start loading if not already loading
    if (!loadingUrlsRef.current.has(url)) {
      loadingUrlsRef.current.add(url);
      textureCacheRef.current[url] = null; // Mark as loading
      
      textureLoaderRef.current.load(
        url,
        (texture) => {
          texture.magFilter = THREE.NearestFilter;
          texture.minFilter = THREE.NearestFilter;
          texture.colorSpace = THREE.SRGBColorSpace;
          textureCacheRef.current[url] = texture;
          loadingUrlsRef.current.delete(url);
          forceUpdate(n => n + 1); // Trigger re-render
        },
        undefined,
        (error) => {
          console.warn(`[ShnakeRenderer] Failed to load texture: ${url}`, error);
          textureCacheRef.current[url] = null;
          loadingUrlsRef.current.delete(url);
        }
      );
    }
    
    return null;
  };

  // Create material for a texture or fallback color
  const createMaterial = (
    texture: THREE.Texture | null, 
    fallbackColor: number, 
    isPlane: boolean = false
  ): THREE.MeshLambertMaterial => {
    if (texture) {
      return new THREE.MeshLambertMaterial({ 
        map: texture, 
        vertexColors: true,
        side: isPlane ? THREE.DoubleSide : THREE.FrontSide
      });
    }
    return new THREE.MeshLambertMaterial({ 
      color: fallbackColor, 
      vertexColors: true,
      side: isPlane ? THREE.DoubleSide : THREE.FrontSide
    });
  };

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

  // Check if shnake is currently in "inverted" flash state
  const isFlashing = (shnakeId: string, now: number): boolean => {
    const flash = flashesRef.current.find(f => f.shnakeId === shnakeId);
    if (!flash) return false;
    
    const elapsed = now - flash.startTime;
    if (elapsed >= flash.duration) return false;
    
    const flashCycle = Math.floor(elapsed / (flash.duration / 6));
    return flashCycle % 2 === 0;
  };

  // Build per-tier texture/material data
  const tierMaterials = useMemo(() => {
    const shnakes = shnakesRef.current || [];
    const materials: Map<number, { head: THREE.MeshLambertMaterial; body: THREE.MeshLambertMaterial; face: THREE.MeshLambertMaterial }> = new Map();
    
    for (const s of shnakes) {
      if (!s.isActive || materials.has(s.tier)) continue;
      
      const def = s.definition;
      const headTex = loadTexture(def.head_texture_url);
      const bodyTex = loadTexture(def.body_texture_url);
      const faceTex = loadTexture(def.face_texture_url);
      
      const tierColor = getTierColor(s.tier);
      const faceColor = 0xff4444; // Red fallback for face
      
      materials.set(s.tier, {
        head: createMaterial(headTex, tierColor, false),
        body: createMaterial(bodyTex, tierColor, false),
        face: createMaterial(faceTex, faceColor, true),
      });
    }
    
    return materials;
  }, [shnakesRef.current, forceUpdate]);

  // Use single shared materials for InstancedMesh (we'll use colors per-instance)
  const sharedHeadMat = useMemo(() => new THREE.MeshLambertMaterial({ vertexColors: true }), []);
  const sharedBodyMat = useMemo(() => new THREE.MeshLambertMaterial({ vertexColors: true }), []);
  const sharedFaceMat = useMemo(() => new THREE.MeshLambertMaterial({ vertexColors: true, side: THREE.DoubleSide }), []);

  // Update instances each frame
  useFrame(() => {
    const now = performance.now();
    const shnakes = shnakesRef.current || [];
    let headCount = 0;
    let bodyCount = 0;
    let faceCount = 0;

    const headMesh = headMeshRef.current;
    const bodyMesh = bodyMeshRef.current;
    const faceMesh = faceMeshRef.current;
    if (!headMesh || !bodyMesh || !faceMesh) return;

    // Clean up expired flashes
    flashesRef.current = flashesRef.current.filter(f => now - f.startTime < f.duration);

    const m = new THREE.Matrix4();

    for (const s of shnakes) {
      if (!s.isActive || s.segments.length === 0) continue;
      
      const flashing = isFlashing(s.id, now);
      const def = s.definition;
      
      // Load textures for this tier
      const headTex = loadTexture(def.head_texture_url);
      const bodyTex = loadTexture(def.body_texture_url);
      const faceTex = loadTexture(def.face_texture_url);
      
      // Determine colors - use texture color (white) if texture loaded, else tier fallback
      const tierColor = getTierColor(s.tier);
      const headColor = new THREE.Color(headTex ? 0xffffff : tierColor);
      const bodyColor = new THREE.Color(bodyTex ? 0xffffff : tierColor);
      const faceColor = new THREE.Color(faceTex ? 0xffffff : 0xff4444);
      
      const flashColor = new THREE.Color(0xff00ff); // Magenta flash

      // Head
      const h = s.segments[0];
      m.makeTranslation(h.x + 0.5, h.y + 0.5, h.z + 0.5);
      headMesh.setMatrixAt(headCount, m);
      headMesh.setColorAt(headCount, flashing ? flashColor : headColor);
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
      faceMesh.setColorAt(faceCount, flashing ? new THREE.Color(0x00ffff) : faceColor);
      faceCount++;

      // Body segments
      for (let i = 1; i < s.segments.length; i++) {
        const seg = s.segments[i];
        m.makeTranslation(seg.x + 0.5, seg.y + 0.5, seg.z + 0.5);
        bodyMesh.setMatrixAt(bodyCount, m);
        bodyMesh.setColorAt(bodyCount, flashing ? flashColor : bodyColor);
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

  // Get first shnake to determine which material to use (for now shared)
  const shnakes = shnakesRef.current || [];
  const firstActive = shnakes.find(s => s.isActive);
  
  // Create materials with textures if available
  const { headMaterial, bodyMaterial, faceMaterial } = useMemo(() => {
    if (!firstActive) {
      return {
        headMaterial: new THREE.MeshLambertMaterial({ color: 0x22ff44, vertexColors: true }),
        bodyMaterial: new THREE.MeshLambertMaterial({ color: 0x44cc44, vertexColors: true }),
        faceMaterial: new THREE.MeshLambertMaterial({ color: 0xff4444, vertexColors: true, side: THREE.DoubleSide }),
      };
    }
    
    const def = firstActive.definition;
    const headTex = loadTexture(def.head_texture_url);
    const bodyTex = loadTexture(def.body_texture_url);
    const faceTex = loadTexture(def.face_texture_url);
    
    return {
      headMaterial: createMaterial(headTex, getTierColor(firstActive.tier), false),
      bodyMaterial: createMaterial(bodyTex, getTierColor(firstActive.tier), false),
      faceMaterial: createMaterial(faceTex, 0xff4444, true),
    };
  }, [firstActive?.tier, forceUpdate]);

  const maxHeads = 256;
  const maxBodies = 8192;
  const maxFaces = 256;

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
});

ShnakeRenderer.displayName = 'ShnakeRenderer';
