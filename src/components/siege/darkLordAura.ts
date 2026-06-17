// Dark Lord aura — the swirling particle envelope around the teleporting boss:
//   • black→purple "fire" (small, thin, fast-rising wisps) registered as its own recipe
//   • 3 heavy fire-smoke columns (the same smoke a flame bullet leaves on an enemy)
// All emitters follow the live body and PAUSE (getPos→false) while the boss is fading out
// / teleporting, so production stops but the already-spawned puffs finish their lifetime
// where they were (per spec). Built on the shared GPU billboard effects engine.
import { useEffect } from 'react';
import * as THREE from 'three';
import { useAdminPanel } from '@/contexts/AdminPanelContext';
import { registerRecipe } from '@/effects/recipes';
import type { EffectEmitter, EffectRecipe } from '@/effects/types';
import type { DemonInstance } from './siegeHorde';

// Black-to-purple flame: small start, shrinking to a thin wisp as it rises (alpha-blended so
// the BLACK reads as dark, not invisible the way additive would render it).
const DARKLORD_FIRE: EffectRecipe = {
  code: 'darklord-fire',
  family: 'fire',
  backend: 'billboard',
  blend: 'alpha',
  lifetime: 0.9,
  spawnRate: 90,
  spread: 0.18,
  rise: 2.8,
  gravity: 0,
  wind: [0, 0],
  flutterAmp: 0.35,
  flutterFreq: 2.4,
  spin: 1.6,
  size0: 0.16,
  size1: 0.03,          // thin: tapers to a wisp
  opacity0: 0.8,
  opacity1: 0.0,
  color0: '#0a0012',    // near-black violet
  color1: '#8a2be2',    // purple
  cullDistance: 110,
  fadeStart: 85,
  fadeEnd: 110,
  importance: 0.5,
};
registerRecipe(DARKLORD_FIRE);

const _r = () => Math.random() - 0.5;

/** Attach the smoke + black/purple fire aura to a teleporting boss while `enabled`. */
export function useBossAura(inst: DemonInstance, enabled: boolean) {
  const { effectsRef } = useAdminPanel();
  useEffect(() => {
    if (!enabled) return;
    const fx = effectsRef.current;
    if (!fx) return;
    const emitters: EffectEmitter[] = [];
    // Emit only while corporeal — pause (keep emitter) once he fades toward the teleport.
    const live = () => !inst.dead && (inst.opacity ?? 1) > 0.12;
    const at = (code: string, frac: number, rad: number, imp: number) =>
      fx.createEmitter(code, (out) => {
        if (!live()) return false;
        out.set(inst.x + _r() * rad, inst.y + inst.height * frac, inst.z + _r() * rad);
        return true;
      }, imp);
    // Heavy smoke: three columns up the body (low / mid / high).
    emitters.push(at('fire-smoke', 0.20, inst.height * 0.32, 0.5));
    emitters.push(at('fire-smoke', 0.50, inst.height * 0.30, 0.5));
    emitters.push(at('fire-smoke', 0.78, inst.height * 0.24, 0.45));
    // Black/purple fire wreathing the body.
    emitters.push(at('darklord-fire', 0.22, inst.height * 0.30, 0.5));
    emitters.push(at('darklord-fire', 0.52, inst.height * 0.26, 0.5));
    emitters.push(at('darklord-fire', 0.80, inst.height * 0.20, 0.45));
    return () => emitters.forEach((e) => e.stop());
  }, [enabled, inst, effectsRef]);
}
