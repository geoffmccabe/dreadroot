// Crosshair shown while a Shpider Egg is armed and waiting on the
// throw click. Black 8-spoke star with a bold "S" in the center.
// Black/white contrast makes it readable against any sky or tree.

import React from 'react';

interface Props {
  visible: boolean;
}

export function EggReadyCrosshair({ visible }: Props) {
  if (!visible) return null;
  const color = '#000000';
  const lineThick = 2;
  const lineLen = 7;
  const ringSize = 26;
  // 8 spokes — N, NE, E, SE, S, SW, W, NW.
  const spokes = [
    { rot: 0,   len: lineLen },
    { rot: 45,  len: lineLen },
    { rot: 90,  len: lineLen },
    { rot: 135, len: lineLen },
    { rot: 180, len: lineLen },
    { rot: 225, len: lineLen },
    { rot: 270, len: lineLen },
    { rot: 315, len: lineLen },
  ];
  return (
    <div
      className="fixed left-1/2 top-1/2 -translate-x-1/2 -translate-y-1/2 pointer-events-none z-50"
      aria-hidden
    >
      {/* Outer ring */}
      <div
        className="absolute left-1/2 top-1/2 rounded-full"
        style={{
          width: ringSize,
          height: ringSize,
          transform: 'translate(-50%, -50%)',
          border: `${lineThick}px solid ${color}`,
          // White halo so the black is visible against tree/dark blocks.
          boxShadow: `0 0 0 1px rgba(255,255,255,0.8), 0 0 4px rgba(0,0,0,0.7)`,
        }}
      />
      {/* 8 spokes radiating from the ring edge */}
      {spokes.map((s, i) => (
        <div
          key={i}
          className="absolute left-1/2 top-1/2"
          style={{
            width: lineThick,
            height: s.len,
            background: color,
            transform: `translate(-50%, -50%) rotate(${s.rot}deg) translateY(-${ringSize / 2 + s.len / 2}px)`,
            boxShadow: '0 0 0 1px rgba(255,255,255,0.7)',
          }}
        />
      ))}
      {/* "S" in the center — bold, with white halo for readability */}
      <div
        className="absolute left-1/2 top-1/2"
        style={{
          transform: 'translate(-50%, -50%)',
          color,
          fontFamily: 'var(--hud-font, sans-serif)',
          fontWeight: 900,
          fontSize: 13,
          lineHeight: 1,
          textShadow: '0 0 3px #fff, 0 0 5px #fff, 0 0 2px #fff',
        }}
      >
        S
      </div>
    </div>
  );
}
