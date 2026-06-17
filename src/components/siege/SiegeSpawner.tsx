// SiegeSpawner — quick horde-test spawner for Siege Worlds.
// Command:  "!"  then a TYPE digit  then a QUANTITY digit (1-9, or 0 = 10), all within ~3s:
//   !1#  → red-demon zombies (npcType 32): CLIMB gait (walk up obstacles, no jump), size ±10%,
//          wide speed variety, desaturated.
//   !2#  → mushroom-grunt horde (npcType 6): HOP gait (the bouncy hop/stack), size ±50%,
//          same grey desaturation.
//   !3#  → GIANT SKELETON horde: red-demon CLIMB gait (no jump), 500 HP, size ±20%, speed ±10%.
// After a spawn, spamming "0" within 2s adds another 10 of the LAST type — for stress-testing
// hordes. Keys are consumed (capture + stopPropagation) so they don't also trigger game keybinds.
import { useEffect, useRef, useState } from 'react';
import { useThree } from '@react-three/fiber';
import { MonsterEnemy } from './MonsterEnemy';

let nextId = 0;
type MType = 1 | 2 | 3;
type Demon = { id: number; spawn: [number, number, number]; type: MType };

// Per-type config. gait/sizeJitter/speedJitter are the reusable SW horde algorithms.
const CFG: Record<MType, {
  url: string; modelHeight: number; height: number; speed: number;
  gait: 'hop' | 'climb'; sizeJitter: number; speedJitter: number; health: number; animSpeed?: number;
}> = {
  1: { url: '/siege/monsters/reddemon.glb',         modelHeight: 1.886, height: 1.8,  speed: 3.2, gait: 'climb', sizeJitter: 0.10, speedJitter: 0.30, health: 100 },
  2: { url: '/siege/monsters/mushroomgruntanim.glb', modelHeight: 2.331, height: 0.66, speed: 2.8, gait: 'hop',   sizeJitter: 0.50, speedJitter: 0.10, health: 100 },
  // 3 = GIANT SKELETON: red-demon hording (climb gait, NO jump), 500 HP, ±20% size, ±10% speed, 3x anim.
  3: { url: '/siege/monsters/dfskeleton.glb',        modelHeight: 1.795, height: 6.0,  speed: 5.0, gait: 'climb', sizeJitter: 0.20, speedJitter: 0.10, health: 500, animSpeed: 3 },
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
    const spawn = (count: number, type: MType) => {
      const { x, y, z } = camera.position;
      const add: Demon[] = [];
      for (let i = 0; i < count; i++) {
        const ang = Math.random() * Math.PI * 2, rad = 6 + Math.random() * 14;
        add.push({ id: nextId++, spawn: [x + Math.cos(ang) * rad, y, z + Math.sin(ang) * rad], type });
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
        if (k === '1' || k === '2' || k === '3') { pendingType.current = (k === '1' ? 1 : k === '2' ? 2 : 3); stage.current = 'qty'; arm(); }
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
        const m = CFG[d.type];
        return (
          <MonsterEnemy key={d.id} id={`d${d.id}`} spawn={d.spawn} url={m.url}
            modelHeight={m.modelHeight} height={m.height} aggro={400} speed={m.speed} wanderRadius={6}
            health={m.health} animSpeed={m.animSpeed} onDespawn={despawn} zombie gait={m.gait}
            sizeJitter={m.sizeJitter} speedJitter={m.speedJitter} />
        );
      })}
    </>
  );
}
