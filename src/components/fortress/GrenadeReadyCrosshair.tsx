// Crosshair shown while a grenade is "pin-pulled" (ready to throw).
// Bright green ring with a small "G" in the middle so the player knows
// the next click throws the grenade in the direction the camera is
// pointing.

import React from 'react';

interface Props {
  visible: boolean;
}

export function GrenadeReadyCrosshair({ visible }: Props) {
  if (!visible) return null;
  const color = '#00ff66'; // bright green
  return (
    <div
      className="fixed left-1/2 top-1/2 -translate-x-1/2 -translate-y-1/2 pointer-events-none z-50"
      aria-hidden
    >
      {/* Outer ring with tick marks (matches PentabulletCrosshair shape
          so the eye recognizes "this is a crosshair") */}
      <div
        className="absolute left-1/2 top-1/2 rounded-full"
        style={{
          width: 24,
          height: 24,
          transform: 'translate(-50%, -50%)',
          border: `2px solid ${color}`,
          boxShadow: `0 0 6px ${color}, 0 0 2px rgba(0,0,0,0.8)`,
        }}
      >
        {/* Top tick */}
        <div className="absolute left-1/2" style={{
          width: 2, height: 5, top: -5, transform: 'translateX(-50%)', backgroundColor: color,
        }} />
        {/* Bottom tick */}
        <div className="absolute left-1/2" style={{
          width: 2, height: 5, bottom: -5, transform: 'translateX(-50%)', backgroundColor: color,
        }} />
        {/* Left tick */}
        <div className="absolute top-1/2" style={{
          width: 5, height: 2, left: -5, transform: 'translateY(-50%)', backgroundColor: color,
        }} />
        {/* Right tick */}
        <div className="absolute top-1/2" style={{
          width: 5, height: 2, right: -5, transform: 'translateY(-50%)', backgroundColor: color,
        }} />
      </div>
      {/* "G" in the center — small, bold, glowing so it's legible on
          any background. */}
      <div
        className="absolute left-1/2 top-1/2"
        style={{
          transform: 'translate(-50%, -50%)',
          color,
          fontFamily: 'var(--hud-font, sans-serif)',
          fontWeight: 800,
          fontSize: 11,
          lineHeight: 1,
          textShadow: '0 0 4px rgba(0,0,0,0.95), 0 0 2px rgba(0,0,0,0.95)',
        }}
      >
        G
      </div>
    </div>
  );
}
