/**
 * InspectorCrosshair - Rainbow-animated "I" indicator for Inspector Mode.
 * Displays in center of screen when Inspector Mode is active.
 * Cycles through spectrum 5 times per second.
 */

import React, { useEffect, useState } from 'react';

const CYCLES_PER_SECOND = 5;

interface InspectorCrosshairProps {
  visible: boolean;
}

export function InspectorCrosshair({ visible }: InspectorCrosshairProps) {
  const [hue, setHue] = useState(0);

  // Animate hue through spectrum 5x per second
  useEffect(() => {
    if (!visible) return;

    let animationId: number;
    let lastTime = performance.now();

    const animate = (now: number) => {
      const delta = now - lastTime;
      lastTime = now;
      // Advance hue based on time (360 degrees * 5 cycles per second)
      setHue(h => (h + (delta / 1000) * 360 * CYCLES_PER_SECOND) % 360);
      animationId = requestAnimationFrame(animate);
    };

    animationId = requestAnimationFrame(animate);
    return () => cancelAnimationFrame(animationId);
  }, [visible]);

  if (!visible) return null;

  const color = `hsl(${hue}, 100%, 50%)`;

  // "I" shape made of lines
  // Height: ~20px, Width: ~12px (serif I shape)
  // Line thickness: 2px
  return (
    <div
      className="fixed left-1/2 top-1/2 -translate-x-1/2 -translate-y-1/2 pointer-events-none z-50"
      style={{
        width: '14px',
        height: '20px',
      }}
    >
      {/* Top serif (horizontal) */}
      <div
        style={{
          position: 'absolute',
          top: 0,
          left: 0,
          width: '14px',
          height: '2px',
          backgroundColor: color,
        }}
      />
      {/* Vertical stem */}
      <div
        style={{
          position: 'absolute',
          top: 0,
          left: '50%',
          width: '2px',
          height: '20px',
          transform: 'translateX(-50%)',
          backgroundColor: color,
        }}
      />
      {/* Bottom serif (horizontal) */}
      <div
        style={{
          position: 'absolute',
          bottom: 0,
          left: 0,
          width: '14px',
          height: '2px',
          backgroundColor: color,
        }}
      />
    </div>
  );
}
