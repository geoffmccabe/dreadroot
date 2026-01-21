import React, { useMemo, useRef } from 'react';
import * as THREE from 'three';
import { useFrame } from '@react-three/fiber';
import { useAnimatedTexture } from '@/hooks/useAnimatedTexture';
import type { ShnakeInstance } from '../types';

interface Props {
  shnakesRef: React.RefObject<ShnakeInstance[]>;
}

function createBoxGeometry() {
  // BoxGeometry provides 6 material groups (one per face)
  return new THREE.BoxGeometry(1, 1, 1);
}

export function ShnakeRenderer({ shnakesRef }: Props) {
  // We keep one instanced mesh for heads and one for bodies; each uses a single material set.
  // Texture URLs are per-tier, but in practice most tiers share assets. For now, we render using the first active shnake's textures.
  const first = shnakesRef.current?.find(s => s.isActive) || null;
  // Avoid fetch failures for empty URLs by using a tiny transparent data URI.
  const BLANK = 'data:image/gif;base64,R0lGODlhAQABAAAAACw=';
  const headUrl = first?.definition.head_texture_url || BLANK;
  const bodyUrl = first?.definition.body_texture_url || BLANK;
  const faceUrl = first?.definition.face_texture_url || BLANK;

  const { texture: headTex } = useAnimatedTexture(headUrl || '');
  const { texture: bodyTex } = useAnimatedTexture(bodyUrl || '');
  const { texture: faceTex } = useAnimatedTexture(faceUrl || '');

  const headGeo = useMemo(() => createBoxGeometry(), []);
  const bodyGeo = useMemo(() => createBoxGeometry(), []);

  const headMeshRef = useRef<THREE.InstancedMesh>(null);
  const bodyMeshRef = useRef<THREE.InstancedMesh>(null);

  const headMaterials = useMemo(() => {
    // BoxGeometry face order: +x,-x,+y,-y,+z,-z (varies by Three version but groups align)
    // We want face texture on +z (front). We'll just apply faceTex to one group, fallback to headTex.
    const baseMap = headTex || null;
    const faceMap = faceTex || baseMap;
    const mk = (map: THREE.Texture | null) => new THREE.MeshLambertMaterial({ map: map || undefined });
    return [mk(baseMap), mk(baseMap), mk(baseMap), mk(baseMap), mk(faceMap), mk(baseMap)];
  }, [headTex, faceTex]);

  const bodyMaterial = useMemo(() => {
    return new THREE.MeshLambertMaterial({ map: bodyTex || undefined });
  }, [bodyTex]);

  // Update instances each frame (cheap: just matrix updates)
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

      // Head
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
      <instancedMesh ref={headMeshRef} args={[headGeo, headMaterials as any, maxHeads]} frustumCulled={false} />
      <instancedMesh ref={bodyMeshRef} args={[bodyGeo, bodyMaterial as any, maxBodies]} frustumCulled={false} />
    </group>
  );
}
