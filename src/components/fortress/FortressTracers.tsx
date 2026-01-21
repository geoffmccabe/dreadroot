import React, { useRef, useImperativeHandle, forwardRef, useMemo } from 'react';
import * as THREE from 'three';

const MAX_TRACERS = 500; // Max tracer segments in pool
const TRACER_VISIBLE_DURATION = 1.0; // Seconds at full opacity
const TRACER_FADE_DURATION = 1.0; // Seconds to fade out

interface TracerSegment {
  startX: number;
  startY: number;
  startZ: number;
  endX: number;
  endY: number;
  endZ: number;
  color: string;
  createdAt: number;
  active: boolean;
}

export interface TracersHandle {
  addSegment: (
    startX: number, startY: number, startZ: number,
    endX: number, endY: number, endZ: number,
    color: string
  ) => void;
  update: () => void;
}

export const Tracers = forwardRef<TracersHandle>((_, ref) => {
  const segmentsRef = useRef<TracerSegment[]>([]);
  const nextIndexRef = useRef(0);
  const geometryRef = useRef<THREE.BufferGeometry>(null);
  const materialRef = useRef<THREE.LineBasicMaterial>(null);
  
  // Pre-allocate pool
  useMemo(() => {
    for (let i = 0; i < MAX_TRACERS; i++) {
      segmentsRef.current.push({
        startX: 0, startY: 0, startZ: 0,
        endX: 0, endY: 0, endZ: 0,
        color: '#ffffff',
        createdAt: 0,
        active: false,
      });
    }
  }, []);

  // Create geometry with position and color attributes
  const geometry = useMemo(() => {
    const geo = new THREE.BufferGeometry();
    // 2 vertices per segment, 3 floats per vertex
    const positions = new Float32Array(MAX_TRACERS * 2 * 3);
    const colors = new Float32Array(MAX_TRACERS * 2 * 4); // RGBA
    
    geo.setAttribute('position', new THREE.BufferAttribute(positions, 3));
    geo.setAttribute('color', new THREE.BufferAttribute(colors, 4));
    geo.setDrawRange(0, 0);
    
    return geo;
  }, []);

  const material = useMemo(() => {
    return new THREE.LineBasicMaterial({
      vertexColors: true,
      transparent: true,
      depthWrite: false,
      blending: THREE.AdditiveBlending,
    });
  }, []);

  useImperativeHandle(ref, () => ({
    addSegment: (
      startX: number, startY: number, startZ: number,
      endX: number, endY: number, endZ: number,
      color: string
    ) => {
      const segment = segmentsRef.current[nextIndexRef.current % MAX_TRACERS];
      segment.startX = startX;
      segment.startY = startY;
      segment.startZ = startZ;
      segment.endX = endX;
      segment.endY = endY;
      segment.endZ = endZ;
      segment.color = color;
      segment.createdAt = performance.now();
      segment.active = true;
      nextIndexRef.current++;
    },
    
    update: () => {
      const now = performance.now();
      const positions = geometry.attributes.position as THREE.BufferAttribute;
      const colors = geometry.attributes.color as THREE.BufferAttribute;
      const posArray = positions.array as Float32Array;
      const colArray = colors.array as Float32Array;
      
      let vertexIndex = 0;
      const tmpColor = new THREE.Color();
      
      for (const segment of segmentsRef.current) {
        if (!segment.active) continue;
        
        const age = (now - segment.createdAt) / 1000; // Convert to seconds
        const totalDuration = TRACER_VISIBLE_DURATION + TRACER_FADE_DURATION;
        
        if (age > totalDuration) {
          segment.active = false;
          continue;
        }
        
        // Calculate opacity
        let opacity = 1.0;
        if (age > TRACER_VISIBLE_DURATION) {
          const fadeProgress = (age - TRACER_VISIBLE_DURATION) / TRACER_FADE_DURATION;
          opacity = 1.0 - fadeProgress;
        }
        
        // Set positions (2 vertices per segment)
        const posOffset = vertexIndex * 3;
        posArray[posOffset] = segment.startX;
        posArray[posOffset + 1] = segment.startY;
        posArray[posOffset + 2] = segment.startZ;
        posArray[posOffset + 3] = segment.endX;
        posArray[posOffset + 4] = segment.endY;
        posArray[posOffset + 5] = segment.endZ;
        
        // Set colors with opacity (RGBA for both vertices)
        tmpColor.set(segment.color);
        const colOffset = vertexIndex * 4;
        colArray[colOffset] = tmpColor.r;
        colArray[colOffset + 1] = tmpColor.g;
        colArray[colOffset + 2] = tmpColor.b;
        colArray[colOffset + 3] = opacity;
        colArray[colOffset + 4] = tmpColor.r;
        colArray[colOffset + 5] = tmpColor.g;
        colArray[colOffset + 6] = tmpColor.b;
        colArray[colOffset + 7] = opacity;
        
        vertexIndex += 2;
      }
      
      geometry.setDrawRange(0, vertexIndex);
      positions.needsUpdate = true;
      colors.needsUpdate = true;
    },
  }), [geometry]);

  return (
    <lineSegments geometry={geometry} material={material} frustumCulled={false} />
  );
});

Tracers.displayName = 'Tracers';
