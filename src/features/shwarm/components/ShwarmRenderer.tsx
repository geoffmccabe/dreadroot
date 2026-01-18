import React, { useRef, useImperativeHandle, forwardRef, useMemo, useEffect } from 'react';
import * as THREE from 'three';
import { SHWARM_BLOCK_SIZE, DEFAULT_SHWARM_COLOR, MAX_SHWARM_BLOCKS } from '../constants';
import type { ShwarmInstance } from '../hooks/useShwarmSystem';

// Pre-allocated objects for InstancedMesh updates
const tmpMatrix = new THREE.Matrix4();
const tmpScale = new THREE.Vector3();
const tmpPosition = new THREE.Vector3();
const tmpQuaternion = new THREE.Quaternion();
const tmpColor = new THREE.Color();

// Shared geometry for all shwarm blocks (0.5 size)
const shwarmBlockGeometry = new THREE.BoxGeometry(
  SHWARM_BLOCK_SIZE,
  SHWARM_BLOCK_SIZE,
  SHWARM_BLOCK_SIZE
);

export interface ShwarmRendererHandle {
  update: () => void;
  getMesh: () => THREE.InstancedMesh | null;
}

interface ShwarmRendererProps {
  shwarms: ShwarmInstance[];
}

/**
 * Renders all shwarm blocks using InstancedMesh for performance
 * Exposes update() for frame loop integration (no useFrame)
 */
export const ShwarmRenderer = forwardRef<ShwarmRendererHandle, ShwarmRendererProps>(
  ({ shwarms }, ref) => {
    const meshRef = useRef<THREE.InstancedMesh>(null);
    const materialRef = useRef<THREE.MeshStandardMaterial | null>(null);

    // Create material once
    const material = useMemo(() => {
      const mat = new THREE.MeshStandardMaterial({
        color: DEFAULT_SHWARM_COLOR,
        roughness: 0.5,
        metalness: 0.2,
      });
      materialRef.current = mat;
      return mat;
    }, []);

    // Cleanup material on unmount
    useEffect(() => {
      return () => {
        materialRef.current?.dispose();
      };
    }, []);

    // Expose update function and mesh getter
    useImperativeHandle(ref, () => ({
      update: () => {
        const mesh = meshRef.current;
        if (!mesh) return;

        let instanceCount = 0;

        for (const shwarm of shwarms) {
          if (!shwarm.isActive) continue;

          for (const block of shwarm.blocks) {
            if (!block.isAlive) continue;
            if (instanceCount >= MAX_SHWARM_BLOCKS) break;

            // Set position
            tmpPosition.copy(block.position);

            // Set scale based on health (hitbox is constant, visual scales)
            const visualScale = block.scale;
            tmpScale.set(visualScale, visualScale, visualScale);

            // Compose matrix
            tmpMatrix.compose(tmpPosition, tmpQuaternion, tmpScale);
            mesh.setMatrixAt(instanceCount, tmpMatrix);

            // Color based on health percentage (red -> dark red as damaged)
            const healthPercent = block.currentHealth / block.maxHealth;
            // Lerp from dark red (0x880000) to bright red (0xff4444)
            tmpColor.setRGB(
              0.53 + healthPercent * 0.47,  // 0.53 to 1.0
              healthPercent * 0.27,          // 0 to 0.27
              healthPercent * 0.27           // 0 to 0.27
            );
            mesh.setColorAt(instanceCount, tmpColor);

            instanceCount++;
          }

          if (instanceCount >= MAX_SHWARM_BLOCKS) break;
        }

        mesh.count = instanceCount;
        
        if (instanceCount > 0) {
          mesh.instanceMatrix.needsUpdate = true;
          if (mesh.instanceColor) {
            mesh.instanceColor.needsUpdate = true;
          }
        }
      },
      getMesh: () => meshRef.current,
    }), [shwarms]);

    return (
      <instancedMesh
        ref={meshRef}
        args={[shwarmBlockGeometry, material, MAX_SHWARM_BLOCKS]}
        frustumCulled={false}
        castShadow
        receiveShadow
      />
    );
  }
);

ShwarmRenderer.displayName = 'ShwarmRenderer';
