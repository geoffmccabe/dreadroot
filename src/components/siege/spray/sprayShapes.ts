// Procedural white sprite shapes for the spray (tinted per-particle via vertex color).
// Each is drawn once to a 64px canvas and cached. White on transparent so the
// instance color fully determines the look.
import * as THREE from 'three';
import type { SpraySprite } from './sprayConfig';

const cache = new Map<SpraySprite, THREE.Texture>();

function draw(shape: SpraySprite): THREE.Texture {
  const S = 64, c = document.createElement('canvas');
  c.width = c.height = S;
  const x = c.getContext('2d')!;
  x.fillStyle = '#ffffff';
  x.strokeStyle = '#ffffff';
  x.lineCap = 'round';
  const m = S / 2;
  switch (shape) {
    case 'circle': x.beginPath(); x.arc(m, m, m * 0.82, 0, Math.PI * 2); x.fill(); break;
    case 'oval':   x.beginPath(); x.ellipse(m, m, m * 0.55, m * 0.85, 0, 0, Math.PI * 2); x.fill(); break;
    case 'square': x.fillRect(S * 0.16, S * 0.16, S * 0.68, S * 0.68); break;
    case 'line':   x.lineWidth = S * 0.22; x.beginPath(); x.moveTo(m, S * 0.12); x.lineTo(m, S * 0.88); x.stroke(); break;
    case 'diamond':
      x.beginPath(); x.moveTo(m, S * 0.1); x.lineTo(S * 0.9, m); x.lineTo(m, S * 0.9); x.lineTo(S * 0.1, m); x.closePath(); x.fill(); break;
    case 'star': {
      x.beginPath();
      for (let i = 0; i < 10; i++) {
        const r = i % 2 === 0 ? m * 0.92 : m * 0.4;
        const a = (Math.PI / 5) * i - Math.PI / 2;
        const px = m + Math.cos(a) * r, py = m + Math.sin(a) * r;
        i === 0 ? x.moveTo(px, py) : x.lineTo(px, py);
      }
      x.closePath(); x.fill(); break;
    }
  }
  const t = new THREE.CanvasTexture(c);
  t.needsUpdate = true;
  return t;
}

export function getSprayShapeTexture(shape: SpraySprite): THREE.Texture {
  let t = cache.get(shape);
  if (!t) { t = draw(shape); cache.set(shape, t); }
  return t;
}
