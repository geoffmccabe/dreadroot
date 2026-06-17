// Dark Lord aura — the heavy smoke around the teleporting boss: 3 fire-smoke columns (the
// same smoke a flame bullet leaves on a burning enemy). The actual flames are real
// UniversalFlameRenderer hex columns spawned by MonsterEnemy (not billboards). Emitters
// follow the live body and PAUSE (getPos→false) while the boss fades out / teleports, so
// production stops but the already-spawned puffs finish their lifetime where they were.
import { useEffect } from 'react';
import { useAdminPanel } from '@/contexts/AdminPanelContext';
import type { EffectEmitter } from '@/effects/types';
import type { DemonInstance } from './siegeHorde';

const _r = () => Math.random() - 0.5;

/** Attach the heavy smoke aura to a teleporting boss while `enabled`. */
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
    return () => emitters.forEach((e) => e.stop());
  }, [enabled, inst, effectsRef]);
}
