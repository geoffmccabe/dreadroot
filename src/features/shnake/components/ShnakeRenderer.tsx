import React, { useMemo, useRef } from 'react';
import * as THREE from 'three';
import { useFrame } from '@react-three/fiber';
import { useAnimatedTexture } from '@/hooks/useAnimatedTexture';
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
  duration: number; // 1 second for 3 flashes
}

export interface ShnakeRendererHandle {
  /** Get segment at position (returns {shnakeId, segmentIndex, isHead} or null) */
  getSegmentAtPosition: (x: number, y: number, z: number) => { shnakeId: string; segmentIndex: number; isHead: boolean } | null;
  /** Add fire to a segment - fire propagates as shnake moves */
  addFireToSegment: (shnakeId: string, segmentIndex: number, duration: number, colors: string[]) => void;
  /** Get active fires for rendering */
  getActiveFires: () => Array<{ position: THREE.Vector3; colors: string[]; progress: number }>;
  /** Trigger damage flash on entire shnake */
  triggerDamageFlash: (shnakeId: string) => void;
}

export const ShnakeRenderer = React.forwardRef<ShnakeRendererHandle, Props>(({ shnakesRef }, ref) => {
  const BLANK = 'data:image/gif;base64,R0lGODlhAQABAAAAACw=';
  
  // Get first active shnake for textures (all shnakes of same tier share textures)
  const first = shnakesRef.current?.find(s => s.isActive) || null;
  const headUrl = first?.definition.head_texture_url || BLANK;
  const bodyUrl = first?.definition.body_texture_url || BLANK;
  const faceUrl = first?.definition.face_texture_url || BLANK;

  const { texture: headTex } = useAnimatedTexture(headUrl || '');
  const { texture: bodyTex } = useAnimatedTexture(bodyUrl || '');
  const { texture: faceTex } = useAnimatedTexture(faceUrl || '');

  // Geometry for cubes
  const headGeo = useMemo(() => new THREE.BoxGeometry(1, 1, 1), []);
  const bodyGeo = useMemo(() => new THREE.BoxGeometry(1, 1, 1), []);
  
  // Face plane geometry (positioned on +Z face of head)
  const faceGeo = useMemo(() => {
    const geo = new THREE.PlaneGeometry(1, 1);
    // Position at front face of cube (+Z), offset slightly to avoid z-fighting
    geo.translate(0, 0, 0.501);
    return geo;
  }, []);

  const headMeshRef = useRef<THREE.InstancedMesh>(null);
  const bodyMeshRef = useRef<THREE.InstancedMesh>(null);
  const faceMeshRef = useRef<THREE.InstancedMesh>(null);
  
  // Fire tracking - uses segment index which shifts as shnake moves
  const firesRef = useRef<SegmentFire[]>([]);
  
  // Damage flash tracking
  const flashesRef = useRef<DamageFlash[]>([]);

  // Materials with detection for textures
  const hasHeadTex = headTex && headUrl !== BLANK;
  const hasBodyTex = bodyTex && bodyUrl !== BLANK;
  const hasFaceTex = faceTex && faceUrl !== BLANK;

  // Normal material for head (bright green fallback)
  const headMaterial = useMemo(() => {
    return hasHeadTex 
      ? new THREE.MeshLambertMaterial({ map: headTex })
      : new THREE.MeshLambertMaterial({ color: 0x22ff44 });
  }, [headTex, hasHeadTex]);

  // Inverted material for damage flash
  const headMaterialInverted = useMemo(() => {
    return new THREE.MeshLambertMaterial({ color: 0xdd00bb }); // Magenta inverse
  }, []);

  // Normal body material (darker green fallback)
  const bodyMaterial = useMemo(() => {
    return hasBodyTex
      ? new THREE.MeshLambertMaterial({ map: bodyTex })
      : new THREE.MeshLambertMaterial({ color: 0x44cc44 });
  }, [bodyTex, hasBodyTex]);

  // Inverted body material
  const bodyMaterialInverted = useMemo(() => {
    return new THREE.MeshLambertMaterial({ color: 0xbb33bb }); // Magenta inverse
  }, []);

  // Face material (red fallback)
  const faceMaterial = useMemo(() => {
    return hasFaceTex
      ? new THREE.MeshLambertMaterial({ map: faceTex, side: THREE.DoubleSide })
      : new THREE.MeshLambertMaterial({ color: 0xff4444, side: THREE.DoubleSide });
  }, [faceTex, hasFaceTex]);

  // Inverted face material
  const faceMaterialInverted = useMemo(() => {
    return new THREE.MeshLambertMaterial({ color: 0x00bbbb, side: THREE.DoubleSide });
  }, []);

  // Expose methods for bullet collision and fire
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
      
      // Clean up expired fires and collect active ones
      firesRef.current = firesRef.current.filter(fire => {
        const elapsed = now - fire.startTime;
        if (elapsed >= fire.duration) return false;
        
        // Find the shnake and segment
        const shnake = shnakes.find(s => s.id === fire.shnakeId && s.isActive);
        if (!shnake) return false;
        
        // Fire stays at the same segment INDEX as shnake moves
        // This means fire "propagates" down the body as new segments are added at head
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
      // Remove any existing flash for this shnake
      flashesRef.current = flashesRef.current.filter(f => f.shnakeId !== shnakeId);
      // Add new flash (1 second duration for 3 flashes)
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
    
    // 3 flashes over 1 second: each flash is ~166ms on, ~166ms off
    // Flash pattern: ON at 0-166ms, OFF at 166-333ms, ON at 333-500ms, etc.
    const flashCycle = Math.floor(elapsed / (flash.duration / 6)); // 6 half-cycles for 3 full flashes
    return flashCycle % 2 === 0;
  };

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
    const rot = new THREE.Quaternion();

    for (const s of shnakes) {
      if (!s.isActive || s.segments.length === 0) continue;
      
      const flashing = isFlashing(s.id, now);

      // Head - always render first segment as head
      const h = s.segments[0];
      m.makeTranslation(h.x + 0.5, h.y + 0.5, h.z + 0.5);
      headMesh.setMatrixAt(headCount, m);
      
      // Set color based on flash state
      if (flashing) {
        headMesh.setColorAt(headCount, new THREE.Color(0xff00ff)); // Magenta flash
      } else {
        headMesh.setColorAt(headCount, new THREE.Color(0xffffff)); // Normal (texture or fallback)
      }
      headCount++;

      // Face on head - rotated to face the direction of movement
      // Calculate rotation based on headDir
      const faceMatrix = new THREE.Matrix4();
      const facePos = new THREE.Vector3(h.x + 0.5, h.y + 0.5, h.z + 0.5);
      
      // Create rotation to face the headDir direction
      if (s.headDir.lengthSq() > 0.01) {
        // headDir is the movement direction - face should point that way
        const targetDir = s.headDir.clone().normalize();
        const faceQuat = new THREE.Quaternion();
        
        // Default face looks at +Z, rotate to look at headDir
        const defaultDir = new THREE.Vector3(0, 0, 1);
        faceQuat.setFromUnitVectors(defaultDir, targetDir);
        
        faceMatrix.compose(
          facePos,
          faceQuat,
          new THREE.Vector3(1, 1, 1)
        );
      } else {
        faceMatrix.makeTranslation(facePos.x, facePos.y, facePos.z);
      }
      
      faceMesh.setMatrixAt(faceCount, faceMatrix);
      if (flashing) {
        faceMesh.setColorAt(faceCount, new THREE.Color(0x00ffff)); // Cyan flash (inverted red)
      } else {
        faceMesh.setColorAt(faceCount, new THREE.Color(0xffffff));
      }
      faceCount++;

      // Body segments
      for (let i = 1; i < s.segments.length; i++) {
        const seg = s.segments[i];
        m.makeTranslation(seg.x + 0.5, seg.y + 0.5, seg.z + 0.5);
        bodyMesh.setMatrixAt(bodyCount, m);
        
        if (flashing) {
          bodyMesh.setColorAt(bodyCount, new THREE.Color(0xff00ff)); // Magenta flash
        } else {
          bodyMesh.setColorAt(bodyCount, new THREE.Color(0xffffff));
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
  });

  // Upper bound instance counts
  const maxHeads = 256;
  const maxBodies = 8192;
  const maxFaces = 256;

  // Use MeshLambertMaterial with vertex colors for flash effect
  const headMatWithColor = useMemo(() => {
    const mat = hasHeadTex 
      ? new THREE.MeshLambertMaterial({ map: headTex, vertexColors: true })
      : new THREE.MeshLambertMaterial({ color: 0x22ff44, vertexColors: true });
    return mat;
  }, [headTex, hasHeadTex]);

  const bodyMatWithColor = useMemo(() => {
    const mat = hasBodyTex
      ? new THREE.MeshLambertMaterial({ map: bodyTex, vertexColors: true })
      : new THREE.MeshLambertMaterial({ color: 0x44cc44, vertexColors: true });
    return mat;
  }, [bodyTex, hasBodyTex]);

  const faceMatWithColor = useMemo(() => {
    const mat = hasFaceTex
      ? new THREE.MeshLambertMaterial({ map: faceTex, side: THREE.DoubleSide, vertexColors: true })
      : new THREE.MeshLambertMaterial({ color: 0xff4444, side: THREE.DoubleSide, vertexColors: true });
    return mat;
  }, [faceTex, hasFaceTex]);

  return (
    <group>
      <instancedMesh 
        ref={headMeshRef} 
        args={[headGeo, headMatWithColor, maxHeads]} 
        frustumCulled={false}
      />
      <instancedMesh 
        ref={bodyMeshRef} 
        args={[bodyGeo, bodyMatWithColor, maxBodies]} 
        frustumCulled={false}
      />
      <instancedMesh 
        ref={faceMeshRef} 
        args={[faceGeo, faceMatWithColor, maxFaces]} 
        frustumCulled={false}
      />
    </group>
  );
});

ShnakeRenderer.displayName = 'ShnakeRenderer';
