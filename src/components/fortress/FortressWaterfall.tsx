import React, { useRef, useEffect, useMemo, useCallback } from 'react';
import { useFrame } from '@react-three/fiber';
import * as THREE from 'three';
import { WaterfallDrop } from './FortressTypes';

interface WaterfallProps {
  flowSpeed?: number;
  msBetweeenDrops?: number;
  colorPalette: Array<{ hex: string; weight: number }>;
}

export function Waterfall({ 
  flowSpeed = 1.2, 
  msBetweeenDrops = 10, 
  colorPalette 
}: WaterfallProps) {
  const instancedMeshRef = useRef<THREE.InstancedMesh>(null);
  const activeDropsRef = useRef<WaterfallDrop[]>([]);
  const timeAccumulatorRef = useRef(0);
  const maxDrops = 500;

  const fall = {
    width: 6,
    depth: 0.6,
    topY: 19.95,
    bottomY: 0.2,
    centerX: 0,
    z: -6.8
  };

  // Water drop colors with proper normalization
  const dropPaletteColors = useMemo(() => {
    return colorPalette.map(item => ({
      color: new THREE.Color(item.hex),
      weight: item.weight,
      hex: item.hex
    }));
  }, [colorPalette]);

  // Create cumulative distribution function
  const dropCDF = useMemo(() => {
    const cdf: number[] = [];
    let sum = 0;
    for (const p of dropPaletteColors) {
      sum += p.weight;
      cdf.push(sum);
    }
    for (let i = 0; i < cdf.length; i++) {
      cdf[i] /= sum;
    }
    return cdf;
  }, [dropPaletteColors]);

  const pickColor = useCallback(() => {
    const r = Math.random();
    for (let i = 0; i < dropCDF.length; i++) {
      if (r <= dropCDF[i]) {
        const color = new THREE.Color(dropPaletteColors[i].hex);
        color.multiplyScalar(0.4); // Darken for additive blending
        return color;
      }
    }
    const color = new THREE.Color(dropPaletteColors[dropPaletteColors.length - 1].hex);
    color.multiplyScalar(0.4);
    return color;
  }, [dropCDF, dropPaletteColors]);

  // Initialize drops array
  useEffect(() => {
    activeDropsRef.current = Array.from({ length: maxDrops }, () => ({
      position: new THREE.Vector3(0, fall.topY, fall.z),
      velocity: 0,
      stretchFactor: 10,
      color: pickColor(),
      active: false
    }));
  }, [pickColor, fall.topY, fall.z]);

  // Reusable objects for animation loop
  const matrix = useMemo(() => new THREE.Matrix4(), []);
  const position = useMemo(() => new THREE.Vector3(), []);
  const scale = useMemo(() => new THREE.Vector3(), []);
  const rotation = useMemo(() => new THREE.Euler(), []);
  const quaternionRef = useRef(new THREE.Quaternion());

  useFrame((state, delta) => {
    if (!instancedMeshRef.current) return;

    const mul = flowSpeed;
    const msInterval = msBetweeenDrops;
    timeAccumulatorRef.current += delta * 1000;

    // Spawn new drops
    while (timeAccumulatorRef.current >= msInterval) {
      timeAccumulatorRef.current -= msInterval;

      const inactiveDropIndex = activeDropsRef.current.findIndex(d => !d.active);
      if (inactiveDropIndex !== -1) {
        const drop = activeDropsRef.current[inactiveDropIndex];
        drop.active = true;
        drop.position.set(
          fall.centerX + (Math.random() - 0.5) * fall.width,
          fall.topY,
          fall.z + (Math.random() - 0.5) * fall.depth
        );
        drop.velocity = 0;
        drop.color = pickColor();
      }
    }

    let activeCount = 0;

    // Update all active drops
    activeDropsRef.current.forEach((drop) => {
      if (!drop.active) return;

      // Apply gravity
      drop.velocity += 9.8 * mul * delta;
      drop.position.y -= drop.velocity * delta;

      // Check if drop reached bottom
      if (drop.position.y <= fall.bottomY) {
        drop.active = false;
        return;
      }

      // Calculate stretch based on fall progress
      const fallProgress = 1 - (drop.position.y - fall.bottomY) / (fall.topY - fall.bottomY);
      const stretchMultiplier = 1 + (drop.stretchFactor - 1) * fallProgress;

      // Scale: stretch only in Y
      const baseSize = 0.1;
      const scaleY = baseSize * stretchMultiplier;
      scale.set(baseSize, scaleY, baseSize);

      // Adjust position so bottom edge falls at constant rate
      const yOffset = (scaleY - baseSize) / 2;
      position.set(drop.position.x, drop.position.y + yOffset, drop.position.z);
      rotation.set(0, 0, 0);

      quaternionRef.current.setFromEuler(rotation);
      matrix.compose(position, quaternionRef.current, scale);
      instancedMeshRef.current!.setMatrixAt(activeCount, matrix);
      instancedMeshRef.current!.setColorAt(activeCount, drop.color);

      activeCount++;
    });

    // Update instance count
    instancedMeshRef.current.count = activeCount;
    instancedMeshRef.current.instanceMatrix.needsUpdate = true;
    if (instancedMeshRef.current.instanceColor) {
      instancedMeshRef.current.instanceColor.needsUpdate = true;
    }
  });

  return (
    <instancedMesh
      ref={instancedMeshRef}
      args={[undefined, undefined, maxDrops]}
      frustumCulled={false}
    >
      <boxGeometry args={[1, 1, 1]} />
      <meshBasicMaterial
        transparent
        opacity={0.8}
        depthWrite={false}
        depthTest={true}
        blending={THREE.AdditiveBlending}
      />
    </instancedMesh>
  );
}
