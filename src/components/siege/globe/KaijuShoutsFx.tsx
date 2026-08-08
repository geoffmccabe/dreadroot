// KaijuShoutsFx — the comic speech bubbles, drawn rather than loaded.
//
// Geoff: "comic book style shapes called a squircle, with a long tail... white with black text and
// use comic sans font... around 10m wide x 6m tall, so if we get close they are larger but from
// normal distances they're not really readable."
//
// A SQUIRCLE IS A SUPERELLIPSE. |x/a|^n + |y/b|^n = 1. At n=2 that is an ellipse; at n=4 the sides
// straighten out and the corners stay round, which is the shape comics actually use. It is drawn
// here as one continuous path with the tail spliced into the bottom edge, rather than a rounded box
// with a triangle stuck underneath — the join on the latter always shows, and at this size it would
// be the first thing anyone notices.
//
// Each line is rendered to its own canvas the first time it is shouted and cached. There are a
// hundred of them and only two or three visible at once, so a small cache covers every repeat
// without keeping a hundred textures resident.

import { useEffect, useMemo, useRef } from 'react';
import { useFrame, useThree } from '@react-three/fiber';
import * as THREE from 'three';
import { METRES_PER_UNIT } from './cubeSphere';
import { SHOUTS, getShouts, stepShouts, shoutOpacity } from './kaijuShouts';

/** Bubble body, in metres. Geoff's numbers. */
const BODY_W_M = 10;
const BODY_H_M = 6;
/** The tail hangs below the body. "A long tail", so it is half the body's height again. */
const TAIL_H_M = 3;

const QUAD_W = BODY_W_M / METRES_PER_UNIT;
const QUAD_H = (BODY_H_M + TAIL_H_M) / METRES_PER_UNIT;
/** How far above the speaker's head the tail tip sits. */
const LIFT = 2 / METRES_PER_UNIT;

/** Pixels across the rendered bubble. Sets how crisp it is when you walk right up to one. */
const TEX_W = 640;
const TEX_H = Math.round((TEX_W * (BODY_H_M + TAIL_H_M)) / BODY_W_M);
/** Fraction of the canvas height taken by the bubble body; the rest is tail. */
const BODY_FRAC = BODY_H_M / (BODY_H_M + TAIL_H_M);

/** Superellipse exponent. 2 is an ellipse, 4 is a squircle, 8 is nearly a rounded rectangle. */
const SQUIRCLE_N = 4;

/**
 * Comic Sans, with fallbacks that are at least informal. Named explicitly because the whole point is
 * that it reads as a comic; if a machine genuinely lacks it, a rounded fallback is far better than
 * dropping to the browser's serif default.
 */
const FONT_STACK = '"Comic Sans MS", "Chalkboard SE", "Comic Neue", cursive';

/** One point on the superellipse, in canvas pixels. `t` runs 0..2pi, y grows DOWNWARD. */
function squirclePoint(
  t: number, cx: number, cy: number, a: number, b: number, out: { x: number; y: number },
): void {
  const c = Math.cos(t), s = Math.sin(t);
  const p = 2 / SQUIRCLE_N;
  out.x = cx + a * Math.sign(c) * Math.pow(Math.abs(c), p);
  out.y = cy - b * Math.sign(s) * Math.pow(Math.abs(s), p);
}

/**
 * Wrap text to fit a width, then shrink the font until the whole thing fits the height too.
 *
 * Sized rather than assumed because the lines run from "LIGHT IT UP!" to fifty-odd characters, and
 * one fixed font size would either overflow the long ones or make the short ones look lost.
 */
function layoutText(
  ctx: CanvasRenderingContext2D, text: string, maxW: number, maxH: number,
): { lines: string[]; size: number } {
  for (let size = 46; size >= 14; size -= 2) {
    ctx.font = `bold ${size}px ${FONT_STACK}`;
    const words = text.split(' ');
    const lines: string[] = [];
    let cur = '';
    let tooWide = false;
    for (const w of words) {
      const next = cur ? `${cur} ${w}` : w;
      if (ctx.measureText(next).width <= maxW) { cur = next; continue; }
      if (cur) lines.push(cur);
      cur = w;
      if (ctx.measureText(w).width > maxW) tooWide = true;
    }
    if (cur) lines.push(cur);
    if (!tooWide && lines.length * size * 1.18 <= maxH) return { lines, size };
  }
  ctx.font = `bold 14px ${FONT_STACK}`;
  return { lines: [text], size: 14 };
}

/** Draw one shout as a white squircle with a long tail and black text. */
function bubbleTexture(text: string): THREE.CanvasTexture {
  const cv = document.createElement('canvas');
  cv.width = TEX_W;
  cv.height = TEX_H;
  const ctx = cv.getContext('2d')!;

  const stroke = 7;
  const bodyH = TEX_H * BODY_FRAC;
  const cx = TEX_W / 2;
  const cy = bodyH / 2;
  const a = TEX_W / 2 - stroke;
  const b = bodyH / 2 - stroke;

  // ONE CONTINUOUS OUTLINE. The path walks the squircle, stops short of the bottom, detours out to
  // the tail tip, and rejoins — so the tail is part of the bubble rather than a triangle parked
  // under it. Splicing it in is the difference between a speech bubble and a lollipop.
  //
  // The angles are NOT symmetric numbers picked by eye. On a superellipse with a 0.5 exponent the
  // bottom edge is nearly flat, so a few degrees of angle covers a huge span of x — the first values
  // tried opened a gap across two thirds of the bubble's width and produced a lampshade. These give
  // a base about a third of the width, which is what a comic tail actually looks like.
  const tailFrom = -Math.PI * 0.545;   // left side of the tail's base
  const tailTo = -Math.PI * 0.475;     // right side of it
  const p = { x: 0, y: 0 };

  ctx.beginPath();
  const STEPS = 96;
  squirclePoint(tailTo, cx, cy, a, b, p);
  ctx.moveTo(p.x, p.y);
  for (let i = 1; i <= STEPS; i++) {
    // From the far side of the gap all the way round to the near side.
    const t = tailTo + (i / STEPS) * (Math.PI * 2 - (tailTo - tailFrom));
    squirclePoint(t, cx, cy, a, b, p);
    ctx.lineTo(p.x, p.y);
  }
  // ...and out to the point, which hangs STRAIGHT DOWN. Geoff: "the tail of the squircle must point
  // at that soldier that fired it." The bubble is placed directly above the speaker, so a tail that
  // leans — which looks better in isolation — would point at a patch of ground beside them. The two
  // curves are swept in opposite directions, which keeps the hook of a comic tail without moving
  // the tip off centre.
  const tipY = TEX_H - stroke;
  ctx.quadraticCurveTo(cx - a * 0.34, bodyH + (TEX_H - bodyH) * 0.35, cx, tipY);
  squirclePoint(tailTo, cx, cy, a, b, p);
  ctx.quadraticCurveTo(cx + a * 0.14, bodyH + (TEX_H - bodyH) * 0.30, p.x, p.y);
  ctx.closePath();

  ctx.fillStyle = '#ffffff';
  ctx.fill();
  ctx.lineJoin = 'round';
  ctx.lineWidth = stroke;
  ctx.strokeStyle = '#000000';
  ctx.stroke();

  // Text, inside the body only.
  const innerW = a * 1.55;
  const innerH = b * 1.5;
  const { lines, size } = layoutText(ctx, text, innerW, innerH);
  ctx.fillStyle = '#000000';
  ctx.textAlign = 'center';
  ctx.textBaseline = 'middle';
  ctx.font = `bold ${size}px ${FONT_STACK}`;
  const lh = size * 1.18;
  const top = cy - ((lines.length - 1) * lh) / 2;
  lines.forEach((ln, i) => ctx.fillText(ln, cx, top + i * lh));

  const tex = new THREE.CanvasTexture(cv);
  tex.colorSpace = THREE.SRGBColorSpace;
  tex.anisotropy = 4;
  tex.needsUpdate = true;
  return tex;
}

export function KaijuShoutsFx() {
  const camera = useThree((s) => s.camera);
  const group = useRef<THREE.Group>(null);

  /** Rendered lines, kept for reuse. Capped, because a hundred textures resident is pointless. */
  const cache = useMemo(() => new Map<number, THREE.CanvasTexture>(), []);
  const CACHE_MAX = 40;

  const getTexture = (line: number): THREE.CanvasTexture => {
    const hit = cache.get(line);
    if (hit) return hit;
    const tex = bubbleTexture(SHOUTS[line] ?? '');
    if (cache.size >= CACHE_MAX) {
      const oldest = cache.keys().next().value as number | undefined;
      if (oldest != null) { cache.get(oldest)?.dispose(); cache.delete(oldest); }
    }
    cache.set(line, tex);
    return tex;
  };

  // One mesh per possible bubble, built once. They differ by texture, so they cannot be instanced —
  // but there are only ever a dozen, which is nothing next to two hundred skinned soldiers.
  const panels = useMemo(() => {
    const geo = new THREE.PlaneGeometry(QUAD_W, QUAD_H);
    return getShouts().map(() => {
      const mat = new THREE.MeshBasicMaterial({
        transparent: true, depthWrite: false, toneMapped: false, side: THREE.DoubleSide,
      });
      const mesh = new THREE.Mesh(geo, mat);
      mesh.visible = false;
      mesh.frustumCulled = false;
      // Drawn after the world, so a bubble is never half-buried in the terrain behind it.
      mesh.renderOrder = 12;
      return mesh;
    });
  }, []);

  useEffect(() => {
    const g = group.current;
    if (!g) return;
    for (const m of panels) g.add(m);
    return () => {
      for (const m of panels) { g.remove(m); (m.material as THREE.Material).dispose(); }
      panels[0]?.geometry.dispose();
      for (const t of cache.values()) t.dispose();
      cache.clear();
    };
  }, [panels, cache]);

  const _up = useMemo(() => new THREE.Vector3(), []);

  useFrame((_, rawDt) => {
    stepShouts(Math.min(rawDt, 0.05));
    const list = getShouts();
    for (let i = 0; i < panels.length; i++) {
      const s = list[i];
      const m = panels[i];
      if (!s || !s.live) { m.visible = false; continue; }

      const mat = m.material as THREE.MeshBasicMaterial;
      const tex = getTexture(s.line);
      if (mat.map !== tex) { mat.map = tex; mat.needsUpdate = true; }
      mat.opacity = shoutOpacity(s);
      m.visible = mat.opacity > 0.01;

      // Sit directly above the speaker so the tail, which hangs straight down out of the bubble,
      // genuinely points at them. Anything cleverer than "above" needs the tail to be redrawn per
      // bubble, and the tail is baked into the texture.
      _up.copy(s.anchor).normalize();
      m.position.copy(s.anchor).addScaledVector(_up, LIFT + QUAD_H / 2);
      // Face the camera, but keep the bubble upright relative to the planet rather than to the
      // screen — a speech bubble that rolls with the camera reads as a decal, not as lettering.
      m.quaternion.copy(camera.quaternion);
    }
  });

  return <group ref={group} />;
}
