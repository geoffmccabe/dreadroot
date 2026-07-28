// kaijuFlash — the Kaiju visibly acknowledges that it heard you.
//
// Geoff: "we need something to show that the kaiju heard my voice and understood it... can you
// have it flash brighter... like just increase the color saturation, flash three times in one
// second and I'll know it's working and listening".
//
// That is a better idea than it first looks. Speech recognition fails silently in several
// different ways — no microphone permission, nothing heard, heard but not understood — and
// without a signal from the creature itself you cannot tell which. A flash on the CREATURE rather
// than in the UI also answers "which one heard me", which matters as soon as you own more than one.
//
// WHY MATERIALS ARE CLONED FIRST. SkeletonUtils.clone shares materials between clones by design,
// so tinting one Kaiju would tint every Kaiju using the same model — and in the demo fight two of
// them do. Each avatar therefore gets its own copies, which also opens the door to per-creature
// damage tints later.

import * as THREE from 'three';

/** Flashes per second, and how long the whole acknowledgement lasts. Geoff's spec exactly. */
export const FLASH_HZ = 3;
export const FLASH_SECONDS = 1;

interface Tinted {
  mat: THREE.MeshStandardMaterial | THREE.MeshPhongMaterial | THREE.MeshLambertMaterial;
  baseColour: THREE.Color;
  baseHSL: { h: number; s: number; l: number };
  baseEmissive: THREE.Color | null;
}

const registry = new WeakMap<THREE.Object3D, Tinted[]>();

/** The colour a burning Kaiju is tinted toward. */
const EMBER = new THREE.Color(1.0, 0.34, 0.06);

/**
 * Give this model its own materials and remember their resting colours.
 *
 * Call once, right after cloning the model. Safe to call again; it will not re-clone.
 */
export function prepareFlash(model: THREE.Object3D): void {
  if (registry.has(model)) return;
  const list: Tinted[] = [];
  model.traverse((o) => {
    const mesh = o as THREE.Mesh;
    if (!mesh.isMesh || !mesh.material) return;
    const mats = Array.isArray(mesh.material) ? mesh.material : [mesh.material];
    const cloned = mats.map((m) => {
      const c = m.clone() as Tinted['mat'];
      const baseColour = (c.color ?? new THREE.Color(1, 1, 1)).clone();
      const hsl = { h: 0, s: 0, l: 0 };
      baseColour.getHSL(hsl);
      list.push({
        mat: c,
        baseColour,
        baseHSL: hsl,
        // Not every material type has emissive; Lambert and Phong do, Basic does not.
        baseEmissive: 'emissive' in c && c.emissive ? c.emissive.clone() : null,
      });
      return c;
    });
    mesh.material = Array.isArray(mesh.material) ? cloned : cloned[0];
  });
  registry.set(model, list);
}

/**
 * Intensity of the acknowledgement flash, 0..1, for a countdown of `remaining` seconds.
 *
 * Three distinct pulses across one second, each a full rise and fall, so it reads as deliberate
 * signalling rather than as a rendering glitch or a lighting artefact.
 */
export function flashIntensity(remaining: number): number {
  if (remaining <= 0) return 0;
  const elapsed = FLASH_SECONDS - Math.min(FLASH_SECONDS, remaining);
  const pulse = Math.sin(elapsed * FLASH_HZ * Math.PI * 2 - Math.PI / 2) * 0.5 + 0.5;
  return pulse;
}

/**
 * Apply the flash. `intensity` 0 restores the resting appearance exactly.
 *
 * Saturation is the main channel, as asked: the creature goes vivid rather than white, which stays
 * readable against snow, sea and sky alike. A little extra lightness and emissive glow ride along
 * so it is still unmistakable at a kilometre, which at this scale is normal viewing distance.
 */
export function applyFlash(model: THREE.Object3D, intensity: number, burning = 0): void {
  const list = registry.get(model);
  if (!list) return;
  const t = Math.max(0, Math.min(1, intensity));

  // BURNING. A Kaiju on fire glows hot and flickers, so you can see at a glance which of them is
  // still alight — the damage was landing all along, but with nothing on screen saying so it
  // looked as though flame did nothing. Flicker is deliberately irregular: a steady glow reads as
  // a material change, an unsteady one reads as fire.
  if (burning > 0 && t <= 0.001) {
    const flicker = 0.62 + 0.38 * Math.abs(Math.sin(burning * 11.3) * Math.cos(burning * 7.1));
    // Fades out over the last second, so it stops smouldering rather than switching off.
    const strength = Math.min(1, burning) * flicker;
    for (const e of list) {
      e.mat.color.copy(e.baseColour).lerp(EMBER, 0.55 * strength);
      if (e.baseEmissive && 'emissive' in e.mat) {
        e.mat.emissive.setRGB(0.55 * strength, 0.17 * strength, 0.02 * strength);
      }
    }
    return;
  }

  for (const e of list) {
    if (t <= 0.001) {
      e.mat.color.copy(e.baseColour);
      if (e.baseEmissive && 'emissive' in e.mat) e.mat.emissive.copy(e.baseEmissive);
      continue;
    }
    // Saturation up toward fully vivid, lightness lifted modestly so dark models still register.
    const s = Math.min(1, e.baseHSL.s + (1 - e.baseHSL.s) * 0.85 * t);
    const l = Math.min(0.92, e.baseHSL.l + (1 - e.baseHSL.l) * 0.35 * t);
    e.mat.color.setHSL(e.baseHSL.h, s, l);
    if (e.baseEmissive && 'emissive' in e.mat) {
      e.mat.emissive.setHSL(e.baseHSL.h, Math.min(1, s), 0.22 * t);
    }
  }
}

/** Restore and forget. Call when the model goes away. */
export function releaseFlash(model: THREE.Object3D): void {
  const list = registry.get(model);
  if (!list) return;
  for (const e of list) e.mat.dispose();
  registry.delete(model);
}
