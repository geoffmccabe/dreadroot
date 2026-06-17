// siegeSmoke — extra smoke recipes + a trail hook for siege monsters. The Spintroll drops a
// long-lived (7s) greenish smoke trail: the emitter drops puffs at the body each frame and they
// stay where dropped (fire-and-forget), so a fast mover leaves a streak that lingers.
import { useEffect } from 'react';
import { useAdminPanel } from '@/contexts/AdminPanelContext';
import { FIRE_SMOKE, registerRecipe } from '@/effects/recipes';
import type { EffectEmitter } from '@/effects/types';
import type { DemonInstance } from './siegeHorde';

// 7s lifetime (vs the usual 3s), greenish, a touch bigger so the trail reads.
registerRecipe({
  ...FIRE_SMOKE,
  code: 'spintroll-smoke',
  lifetime: 7.0,
  spawnRate: 70,
  color0: '#46603f',
  color1: '#8aa07e',
  size1: 0.8,
  spiralOpacity: 0.4,
});

/** Drop a continuous smoke trail from a monster's body while `enabled`. */
export function useSmokeTrail(inst: DemonInstance, enabled: boolean, code = 'spintroll-smoke') {
  const { effectsRef } = useAdminPanel();
  useEffect(() => {
    if (!enabled) return;
    const fx = effectsRef.current;
    if (!fx) return;
    const e: EffectEmitter = fx.createEmitter(code, (out) => {
      if (inst.dead) return false;
      out.set(inst.x, inst.y + inst.height * 0.4, inst.z);
      return true;
    }, 0.55);
    return () => e.stop();
  }, [enabled, inst, effectsRef, code]);
}
