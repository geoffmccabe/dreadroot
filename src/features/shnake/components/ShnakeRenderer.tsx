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

export interface ShnakeRendererHandle {
  /** Get segment at position (returns {shnakeId, segmentIndex, isHead} or null) */
  getSegmentAtPosition: (x: number, y: number, z: number) => { shnakeId: string; segmentIndex: number; isHead: boolean } | null;
  /** Add fire to a segment - fire propagates as shnake moves */
  addFireToSegment: (shnakeId: string, segmentIndex: number, duration: number, colors: string[]) => void;
  /** Get active fires for rendering */
  getActiveFires: () => Array<{ position: THREE.Vector3; colors: string[]; progress: number }>;
}

export const ShnakeRenderer = React.forwardRef<ShnakeRendererHandle, Props>(({ shnakesRef }, ref) => {
  const BLANK = 'data:image/gif;base64,R0lGODlhAQABAAAAACw=';
  
  // Get first active shnake for textures
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

  const headMeshRef = useRef<THREE.InstancedMesh>(null);
  const bodyMeshRef = useRef<THREE.InstancedMesh>(null);
  
  // Fire tracking - uses segment index which shifts as shnake moves
  const firesRef = useRef<SegmentFire[]>([]);

  // Single material for head (instanced mesh can't use material array per instance)
  const headMaterial = useMemo(() => {
    const hasHeadTex = headTex && headUrl !== BLANK;
    return hasHeadTex 
      ? new THREE.MeshLambertMaterial({ map: headTex })
      : new THREE.MeshLambertMaterial({ color: 0x22ff44 }); // Bright green for visibility
  }, [headTex, headUrl]);

  const bodyMaterial = useMemo(() => {
    const hasBodyTex = bodyTex && bodyUrl !== BLANK;
    return hasBodyTex
      ? new THREE.MeshLambertMaterial({ map: bodyTex })
      : new THREE.MeshLambertMaterial({ color: 0x44cc44 }); // Darker green for body
  }, [bodyTex, bodyUrl]);

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
  }), [shnakesRef]);

  // Update instances each frame
  useFrame(() => {
    const shnakes = shnakesRef.current || [];
    let headCount = 0;
    let bodyCount = 0;

    const headMesh = headMeshRef.current;
    const bodyMesh = bodyMeshRef.current;
    if (!headMesh || !bodyMesh) return;

    const m = new THREE.Matrix4();

    for (const s of shnakes) {
      if (!s.isActive || s.segments.length === 0) continue;

      // Head - always render first segment as head
      const h = s.segments[0];
      m.makeTranslation(h.x + 0.5, h.y + 0.5, h.z + 0.5);
      headMesh.setMatrixAt(headCount++, m);

      // Body segments
      for (let i = 1; i < s.segments.length; i++) {
        const seg = s.segments[i];
        m.makeTranslation(seg.x + 0.5, seg.y + 0.5, seg.z + 0.5);
        bodyMesh.setMatrixAt(bodyCount++, m);
      }
    }

    headMesh.count = headCount;
    bodyMesh.count = bodyCount;
    headMesh.instanceMatrix.needsUpdate = true;
    bodyMesh.instanceMatrix.needsUpdate = true;
  });

  // Upper bound instance counts
  const maxHeads = 256;
  const maxBodies = 8192;

  return (
    <group>
      <instancedMesh ref={headMeshRef} args={[headGeo, headMaterial, maxHeads]} frustumCulled={false} />
      <instancedMesh ref={bodyMeshRef} args={[bodyGeo, bodyMaterial, maxBodies]} frustumCulled={false} />
    </group>
  );
});

ShnakeRenderer.displayName = 'ShnakeRenderer';
