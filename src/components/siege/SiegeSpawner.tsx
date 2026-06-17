// SiegeSpawner — quick horde-test spawner for Siege Worlds.
// Command:  "!"  then a TYPE digit  then a QUANTITY digit (1-9, or 0 = 10), all within ~3s:
//   !1#  → red-demon zombies (npcType 32): CLIMB gait (walk up obstacles, no jump), size ±10%,
//          wide speed variety, desaturated.
//   !2#  → mushroom-grunt horde (npcType 6): HOP gait (the bouncy hop/stack), size ±50%,
//          same grey desaturation.
//   !3#  → GIANT SKELETON horde: red-demon CLIMB gait (no jump), 500 HP, size ±20%, speed ±10%.
//   !4#  → VOMIT DEMON (4m): holds at 20-30m, sprays acid over ~1s, recharges 5-10s; no melee.
//   !5#  → DARK LORD (6m boss): teleports near you every 1-4s (1/3 behind = 20-100 dmg strike,
//          1s dodge window). Opacity (1→0 between jumps) = its damage resistance. 500 HP.
//   !6#  → BLOODY SKELETON HORDE: ALWAYS 50, dropped tight (5m) in front. Random mix of
//          heavy/light/ranger; size 0.5-3m, speed ±50%, HP 10-100 (×2 heavy, ×3 ranger),
//          desat 0-90% + ±10% hue, 25-70% red tint; climb gait + SW zombie moans.
// After a spawn, spamming "0" within 2s adds another 10 of the LAST type — for stress-testing
// hordes. Keys are consumed (capture + stopPropagation) so they don't also trigger game keybinds.
import { useEffect, useRef, useState } from 'react';
import { useThree } from '@react-three/fiber';
import * as THREE from 'three';
import { MonsterEnemy } from './MonsterEnemy';
import { fireSpray } from './spray/sprayAttackSystem';
import { ACID_VOMIT, type SprayConfig } from './spray/sprayConfig';

let nextId = 0;
type MType = 1 | 2 | 3 | 4 | 5 | 6;
// Per-individual override (type 6 horde): each mob rolls its own model + stats + colour.
type Ov = { url: string; modelHeight: number; height: number; speed: number; health: number;
            desat: number; hueShift: number; tintRed: number; animSpeed: number };
type Demon = { id: number; spawn: [number, number, number]; type: MType; ov?: Ov };

// Type-6 horde: a random mix of three skeletons (ranger/heavy get more HP). The SW zombie moans.
const HORDE6 = [
  { url: '/siege/monsters/skeletonheavy.glb',  modelHeight: 1.795, healthMul: 2 },
  { url: '/siege/monsters/skeletonlight.glb',  modelHeight: 1.795, healthMul: 1 },
  { url: '/siege/monsters/skeletonranger.glb', modelHeight: 1.797, healthMul: 3 },
];
const HORDE6_MOANS = ['/monster-sounds/zombie_moan_3p1.mp3', '/monster-sounds/zombie_moan_3p2.mp3', '/monster-sounds/zombie_moan_6p1.mp3'];
function makeHordeMember(): Ov {
  const k = HORDE6[(Math.random() * HORDE6.length) | 0];
  const height = 0.5 + Math.random() * 2.5;            // 0.5–3 m (wide range)
  return {
    url: k.url, modelHeight: k.modelHeight, height,
    speed: 2.5 * (0.5 + Math.random()),                // ±50% (0.5×–1.5× of 2.5)
    health: (10 + Math.random() * 90) * k.healthMul,   // 10–100 × type multiplier
    desat: 1 - (0.1 + Math.random() * 0.9),            // saturation 10–100% → desat 0–0.9
    hueShift: (Math.random() * 2 - 1) * 0.628,         // ±10% of the spectrum (±0.1·2π rad)
    tintRed: 0.125 + Math.random() * 0.225,            // 12.5–35% red tint (half the old 25–70%)
    animSpeed: 4 - ((height - 0.5) / 2.5) * 2,          // shamble 4× at 0.5m → 2× at 3m
  };
}

// Per-type config. gait/sizeJitter/speedJitter are the reusable SW horde algorithms.
const CFG: Partial<Record<MType, {
  url: string; modelHeight: number; height: number; speed: number;
  gait: 'hop' | 'climb'; sizeJitter: number; speedJitter: number; health: number; animSpeed?: number;
  rangedRange?: number; rangedCooldownMs?: number; rangedCooldownMaxMs?: number; spray?: SprayConfig;
  boss?: 'teleporter'; noStun?: boolean; bossSpeedFactor?: number;
}>> = {
  1: { url: '/siege/monsters/reddemon.glb',         modelHeight: 1.886, height: 1.8,  speed: 3.2, gait: 'climb', sizeJitter: 0.10, speedJitter: 0.30, health: 100 },
  2: { url: '/siege/monsters/mushroomgruntanim.glb', modelHeight: 2.331, height: 0.66, speed: 2.8, gait: 'hop',   sizeJitter: 0.50, speedJitter: 0.10, health: 100 },
  // 3 = GIANT SKELETON: red-demon hording (climb gait, NO jump), 500 HP, ±20% size, ±10% speed, 3x anim.
  3: { url: '/siege/monsters/dfskeleton.glb',        modelHeight: 1.795, height: 6.0,  speed: 5.0, gait: 'climb', sizeJitter: 0.20, speedJitter: 0.10, health: 500, animSpeed: 3 },
  // 4 = VOMIT DEMON: 4m, HOLDS at 20-30m, sprays acid over a 1s window, then recharges 5-10s. No melee bite.
  4: { url: '/siege/monsters/demonmale.glb',         modelHeight: 2.145, height: 4.0,  speed: 3.0, gait: 'climb', sizeJitter: 0.10, speedJitter: 0.10, health: 200, animSpeed: 1.8, rangedRange: 30, rangedCooldownMs: 5000, rangedCooldownMaxMs: 10000, spray: ACID_VOMIT },
  // 5 = DARK LORD: 6m teleporting boss. Teleports near the player every 1-4s (1/3 directly
  // behind for a 20-100 dmg strike, 1s grace to dodge). Opacity ramps 1→0 between jumps and
  // IS its damage resistance. Wreathed in black/purple fire + heavy smoke. 500 HP, slow shamble.
  5: { url: '/siege/monsters/darklord.glb',          modelHeight: 1.843, height: 6.0,  speed: 3.0, gait: 'climb', sizeJitter: 0.0,  speedJitter: 0.0,  health: 500, animSpeed: 1.0, boss: 'teleporter', noStun: true, bossSpeedFactor: 0.4 },
};

export function SiegeSpawner() {
  const camera = useThree((s) => s.camera);
  const [demons, setDemons] = useState<Demon[]>([]);
  const stage = useRef<'idle' | 'type' | 'qty'>('idle');
  const stageTimer = useRef<number | null>(null);
  const spamUntil = useRef(0);
  const pendingType = useRef<MType>(1);
  const lastType = useRef<MType>(1);

  useEffect(() => {
    const clearStage = () => {
      stage.current = 'idle';
      if (stageTimer.current) { clearTimeout(stageTimer.current); stageTimer.current = null; }
    };
    const arm = () => {
      if (stageTimer.current) clearTimeout(stageTimer.current);
      stageTimer.current = window.setTimeout(() => { stage.current = 'idle'; }, 3000);
    };
    const fwd = new THREE.Vector3();
    const spawn = (count: number, type: MType) => {
      const { x, y, z } = camera.position;
      const add: Demon[] = [];
      if (type === 6) {
        // Always a 50-strong horde, dropped TIGHT (within 5m) around a point ~12m in front.
        camera.getWorldDirection(fwd); fwd.y = 0;
        if (fwd.lengthSq() < 1e-4) fwd.set(0, 0, -1); else fwd.normalize();
        const cx = x + fwd.x * 12, cz = z + fwd.z * 12;
        for (let i = 0; i < 50; i++) {
          const ang = Math.random() * Math.PI * 2, rad = Math.random() * 5;
          add.push({ id: nextId++, spawn: [cx + Math.cos(ang) * rad, y, cz + Math.sin(ang) * rad], type, ov: makeHordeMember() });
        }
        count = 50;
      } else {
        for (let i = 0; i < count; i++) {
          const ang = Math.random() * Math.PI * 2, rad = 6 + Math.random() * 14;
          add.push({ id: nextId++, spawn: [x + Math.cos(ang) * rad, y, z + Math.sin(ang) * rad], type });
        }
      }
      setDemons((d) => [...d, ...add]);
      lastType.current = type;
      spamUntil.current = performance.now() + 2000;
      console.log(`[SiegeSpawner] +${count} type-${type}`);
    };

    const onKey = (e: KeyboardEvent) => {
      const k = e.key;
      // Spam "0" within 2s of the last spawn → +10 more of the same type.
      if (k === '0' && stage.current === 'idle' && performance.now() < spamUntil.current) {
        e.preventDefault(); e.stopPropagation(); spawn(10, lastType.current); return;
      }
      if (k === '!') { e.preventDefault(); e.stopPropagation(); stage.current = 'type'; arm(); return; }
      if (stage.current === 'type') {
        e.preventDefault(); e.stopPropagation();
        if (k >= '1' && k <= '6') { pendingType.current = parseInt(k, 10) as MType; stage.current = 'qty'; arm(); }
        else clearStage();
        return;
      }
      if (stage.current === 'qty') {
        e.preventDefault(); e.stopPropagation();
        if (/^[0-9]$/.test(k)) spawn(k === '0' ? 10 : parseInt(k, 10), pendingType.current);
        clearStage();
        return;
      }
    };
    window.addEventListener('keydown', onKey, true);
    return () => { window.removeEventListener('keydown', onKey, true); clearStage(); };
  }, [camera]);

  const despawn = (id: string) => setDemons((d) => d.filter((x) => `d${x.id}` !== id));

  return (
    <>
      {demons.map((d) => {
        const m = CFG[d.type];           // undefined for the type-6 horde (uses d.ov instead)
        const o = d.ov;
        return (
          <MonsterEnemy key={d.id} id={`d${d.id}`} spawn={d.spawn} url={o?.url ?? m!.url}
            modelHeight={o?.modelHeight ?? m!.modelHeight} height={o?.height ?? m!.height} aggro={400}
            speed={o?.speed ?? m!.speed} wanderRadius={6} health={o?.health ?? m!.health}
            animSpeed={o?.animSpeed ?? m?.animSpeed} onDespawn={despawn} zombie gait={m?.gait ?? 'climb'}
            sizeJitter={o ? 0 : m!.sizeJitter} speedJitter={o ? 0 : m!.speedJitter}
            desat={o?.desat} hueShift={o?.hueShift} tintRed={o?.tintRed}
            moanSounds={o ? HORDE6_MOANS : undefined}
            contactDamage={o ? 20 : undefined} kbInverseSize={!!o} stackSink={o ? 0.30 : undefined}
            rangedRange={m?.rangedRange} rangedCooldownMs={m?.rangedCooldownMs} rangedCooldownMaxMs={m?.rangedCooldownMaxMs}
            boss={m?.boss} noStun={o ? true : m?.noStun} bossSpeedFactor={m?.bossSpeedFactor}
            onRangedAttack={m?.spray ? (x, y, z, dx, dy, dz) => fireSpray(x, y, z, dx, dy, dz, m!.spray!) : undefined} />
        );
      })}
    </>
  );
}
