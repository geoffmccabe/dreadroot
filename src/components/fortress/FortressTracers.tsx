import React, { useRef, useImperativeHandle, forwardRef, useMemo, useEffect } from 'react';
import * as THREE from 'three';
import { Line2 } from 'three/examples/jsm/lines/Line2.js';
import { LineGeometry } from 'three/examples/jsm/lines/LineGeometry.js';
import { LineMaterial } from 'three/examples/jsm/lines/LineMaterial.js';
import { useThree } from '@react-three/fiber';

const MAX_TRACERS = 500; // Max tracer segments in pool
const TRACER_VISIBLE_DURATION = 1.0; // Seconds at full opacity
const TRACER_FADE_DURATION = 1.0; // Seconds to fade out
const BASE_OPACITY = 0.5; // 50% base transparency
const TRACER_LINE_WIDTH = 0.1; // 2x bullet size (bullet is 0.05)

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

/**
 * Lighten a color 50% toward white for vapor effect
 */
function lightenColor(hexColor: string, factor: number = 0.5): THREE.Color {
  const color = new THREE.Color(hexColor);
  // Lerp each channel toward white (1.0)
  color.r = color.r + (1 - color.r) * factor;
  color.g = color.g + (1 - color.g) * factor;
  color.b = color.b + (1 - color.b) * factor;
  return color;
}

export const Tracers = forwardRef<TracersHandle>((_, ref) => {
  const segmentsRef = useRef<TracerSegment[]>([]);
  const nextIndexRef = useRef(0);
  const lineRef = useRef<Line2 | null>(null);
  const geometryRef = useRef<LineGeometry | null>(null);
  const materialRef = useRef<LineMaterial | null>(null);
  const { size } = useThree();
  
  // Pre-allocate pool
  useMemo(() => {
    segmentsRef.current = [];
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

  // Create Line2 geometry and material for fat lines
  useEffect(() => {
    const geometry = new LineGeometry();
    const material = new LineMaterial({
      vertexColors: true,
      transparent: true,
      opacity: BASE_OPACITY,
      linewidth: TRACER_LINE_WIDTH,
      worldUnits: true, // Use world units for consistent thickness
      alphaToCoverage: false,
      depthWrite: false,
      blending: THREE.AdditiveBlending,
    });
    
    // Set initial resolution
    material.resolution.set(size.width, size.height);
    
    const line = new Line2(geometry, material);
    line.frustumCulled = false;
    line.computeLineDistances();
    
    geometryRef.current = geometry;
    materialRef.current = material;
    lineRef.current = line;
    
    return () => {
      geometry.dispose();
      material.dispose();
    };
  }, []);
  
  // Update resolution when window resizes
  useEffect(() => {
    if (materialRef.current) {
      materialRef.current.resolution.set(size.width, size.height);
    }
  }, [size]);

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
      if (!geometryRef.current || !materialRef.current) return;
      
      const now = performance.now();
      const positions: number[] = [];
      const colors: number[] = [];
      
      for (const segment of segmentsRef.current) {
        if (!segment.active) continue;
        
        const age = (now - segment.createdAt) / 1000; // Convert to seconds
        const totalDuration = TRACER_VISIBLE_DURATION + TRACER_FADE_DURATION;
        
        if (age > totalDuration) {
          segment.active = false;
          continue;
        }
        
        // Calculate opacity - start at BASE_OPACITY, fade to 0
        let opacity = BASE_OPACITY;
        if (age > TRACER_VISIBLE_DURATION) {
          const fadeProgress = (age - TRACER_VISIBLE_DURATION) / TRACER_FADE_DURATION;
          opacity = BASE_OPACITY * (1.0 - fadeProgress);
        }
        
        // Lighten color 50% toward white for vapor effect
        const lightenedColor = lightenColor(segment.color, 0.5);
        
        // Add start position
        positions.push(segment.startX, segment.startY, segment.startZ);
        // Add end position  
        positions.push(segment.endX, segment.endY, segment.endZ);
        
        // Add colors for both vertices (with opacity baked in via alpha)
        // Note: LineMaterial uses RGB, opacity is global on material
        // We'll adjust the color brightness based on opacity
        const r = lightenedColor.r * (opacity / BASE_OPACITY);
        const g = lightenedColor.g * (opacity / BASE_OPACITY);
        const b = lightenedColor.b * (opacity / BASE_OPACITY);
        colors.push(r, g, b);
        colors.push(r, g, b);
      }
      
      // Update geometry if we have segments
      if (positions.length > 0) {
        geometryRef.current.setPositions(positions);
        geometryRef.current.setColors(colors);
        if (lineRef.current) {
          lineRef.current.computeLineDistances();
          lineRef.current.visible = true;
        }
      } else {
        if (lineRef.current) {
          lineRef.current.visible = false;
        }
      }
    },
  }), []);

  return lineRef.current ? (
    <primitive object={lineRef.current} />
  ) : null;
});

Tracers.displayName = 'Tracers';
