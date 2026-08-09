// KaijuBombs — the thing the Reaver throws, as an object rather than a fireball.
//
// Geoff: "Make the bombs be more like a sphere 25% of the current size, and give it some random
// texture of a grid so it looks like a high-tech bomb."
//
// Until now a grenade in flight was drawn by the same billboard shader as the fire and the debris —
// so what you saw arcing across the sky was a glowing blob, indistinguishable from the explosion it
// was about to become. That is fine for a fireball and wrong for ordnance: a bomb is a made thing,
// it has a surface, and it should read as hardware right up to the moment it stops being any.
//
// So in-flight grenades get their own instanced spheres, and the sprite pass skips them. Everything
// else about them is unchanged — the ballistics, the arc, the blast and the fire it starts are all
// still the weapon system's, and this only changes what you look at.
//
// THE TEXTURE IS DRAWN ONCE, IN CODE. Same reasoning as the windows and the muzzle flash: a 256 px
// canvas costs a few milliseconds at startup and nothing on disk, and it can be tuned by changing a
// number rather than by round-tripping through an image editor.

import { useEffect, useMemo, useRef } from 'react';
import { useFrame } from '@react-three/fiber';
import * as THREE from 'three';
import { getProjectiles } from './kaijuWeapons';

/**
 * Fraction of the projectile's own size to draw.
 *
 * A quarter, exactly as asked. The underlying number is tuned for a FIREBALL, which is mostly glow
 * and wants to be bigger than the thing at its centre; a solid object at that size looked like a
 * moon. Note this changes only the drawing — the blast radius and the damage come from the weapon
 * and are deliberately untouched, so the bomb still does what it did.
 */
const BOMB_SCALE = 0.25;

/** Bombs on screen at once. A Reaver throws one every 2.4 s and they live 8 s, so this is generous. */
const MAX_BOMBS = 64;

/**
 * The casing: dark metal, a lit grid, and panels.
 *
 * Built from three passes so it reads as engineered rather than as wallpaper — a base plate, a
 * regular grid of seams, and a scatter of panels and lit cells that breaks the regularity up. The
 * randomness is seeded off a fixed sequence rather than Math.random so every bomb in every session
 * has the same casing, which is what makes it a MODEL of a bomb and not noise.
 */
function bombTexture(): THREE.Texture {
  const S = 256;
  const cv = document.createElement('canvas');
  cv.width = cv.height = S;
  const ctx = cv.getContext('2d')!;

  // Deterministic pseudo-random, so the casing is identical every run.
  let seed = 0x9e3779b9;
  const rnd = () => {
    seed = (Math.imul(seed ^ (seed >>> 15), 0x85ebca6b) >>> 0);
    return (seed >>> 8) / 16777216;
  };

  ctx.fillStyle = '#191d24';
  ctx.fillRect(0, 0, S, S);

  // Plating: darker and lighter rectangles on the grid, so the surface has areas rather than being
  // one even tone under the lines.
  const CELL = S / 16;
  for (let y = 0; y < 16; y++) {
    for (let x = 0; x < 16; x++) {
      const v = rnd();
      if (v > 0.72) {
        const g = 26 + Math.floor(rnd() * 26);
        ctx.fillStyle = `rgb(${g},${g + 4},${g + 9})`;
        ctx.fillRect(x * CELL, y * CELL, CELL, CELL);
      }
    }
  }

  // The grid itself. Two weights: fine seams everywhere, heavier structural bands every fourth line.
  ctx.strokeStyle = 'rgba(90,200,220,0.30)';
  ctx.lineWidth = 1;
  ctx.beginPath();
  for (let i = 0; i <= 16; i++) {
    ctx.moveTo(i * CELL, 0); ctx.lineTo(i * CELL, S);
    ctx.moveTo(0, i * CELL); ctx.lineTo(S, i * CELL);
  }
  ctx.stroke();
  ctx.strokeStyle = 'rgba(120,255,230,0.75)';
  ctx.lineWidth = 2.5;
  ctx.beginPath();
  for (let i = 0; i <= 16; i += 4) {
    ctx.moveTo(i * CELL, 0); ctx.lineTo(i * CELL, S);
    ctx.moveTo(0, i * CELL); ctx.lineTo(S, i * CELL);
  }
  ctx.stroke();

  // Lit cells: a handful of bright squares, the "this thing is armed" detail. Rare on purpose —
  // covering it in glowing tiles would make a Christmas bauble, which is the same mistake the window
  // lights were warned against.
  for (let i = 0; i < 14; i++) {
    const x = Math.floor(rnd() * 16), y = Math.floor(rnd() * 16);
    ctx.fillStyle = rnd() > 0.35 ? 'rgba(140,255,225,0.85)' : 'rgba(255,150,60,0.85)';
    ctx.fillRect(x * CELL + CELL * 0.28, y * CELL + CELL * 0.28, CELL * 0.44, CELL * 0.44);
  }

  const t = new THREE.CanvasTexture(cv);
  t.colorSpace = THREE.SRGBColorSpace;
  t.wrapS = t.wrapT = THREE.RepeatWrapping;
  // Twice around, so the grid stays fine on a sphere rather than stretching into stripes at the poles.
  t.repeat.set(2, 1);
  t.anisotropy = 4;
  return t;
}

export function KaijuBombs() {
  const mesh = useRef<THREE.InstancedMesh>(null);
  const dummy = useMemo(() => new THREE.Object3D(), []);
  const time = useRef(0);

  const texture = useMemo(() => bombTexture(), []);
  useEffect(() => () => texture.dispose(), [texture]);

  // Low-poly on purpose: a 16x12 sphere is 360 triangles and, at something that crosses the screen
  // in four seconds, indistinguishable from a smooth one.
  const geometry = useMemo(() => new THREE.SphereGeometry(1, 16, 12), []);
  useEffect(() => () => geometry.dispose(), [geometry]);

  const material = useMemo(() => new THREE.MeshLambertMaterial({
    map: texture,
    // The grid glows. emissiveMap reuses the same canvas, so the bright seams and lit cells carry
    // their own light and stay readable against a dark sky or a bright one — which matters here
    // because the lighting on this map is still being worked on and a purely lit object could
    // disappear into either extreme.
    emissive: new THREE.Color(0x2a5f66),
    emissiveMap: texture,
    emissiveIntensity: 1.0,
  }), [texture]);
  useEffect(() => () => material.dispose(), [material]);

  useFrame((_, dt) => {
    const m = mesh.current;
    if (!m) return;
    time.current += dt;

    let n = 0;
    for (const p of getProjectiles()) {
      if (p.visual !== 'grenade' || p.dead) continue;
      if (n >= MAX_BOMBS) break;
      dummy.position.copy(p.pos);
      // TUMBLING, from the projectile's own seed. A thrown object rotates, and a sphere that does
      // not is a sphere you cannot tell is moving except by its path. Three different rates so the
      // tumble is not a spin about one obvious axis.
      const s = p.seed * 12.9898;
      dummy.rotation.set(
        time.current * (0.8 + p.seed * 1.6) + s,
        time.current * (1.3 + p.seed * 0.9) + s * 2.1,
        time.current * (0.5 + p.seed * 1.1) + s * 3.7,
      );
      dummy.scale.setScalar(Math.max(1e-4, p.size * BOMB_SCALE));
      dummy.updateMatrix();
      m.setMatrixAt(n, dummy.matrix);
      n++;
    }
    m.count = n;
    m.instanceMatrix.needsUpdate = true;
  });

  return (
    <instancedMesh
      ref={mesh}
      args={[geometry, material, MAX_BOMBS]}
      // The bombs travel kilometres from wherever this component's origin is; a bounding sphere
      // computed once from an empty buffer would cull them the moment they left it.
      frustumCulled={false}
      castShadow
    />
  );
}
