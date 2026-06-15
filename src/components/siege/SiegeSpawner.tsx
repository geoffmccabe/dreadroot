// SiegeSpawner — quick horde-test spawner for Siege Worlds.
// Command:  "!"  then  "1" (type 1 = red demon)  then a quantity digit (1-9, or 0 = 10)
// spawns that many SMALL (1.8m) red demons in a ring around the player, as zombie stand-ins.
// After a spawn, spamming "0" within 2 seconds adds another 10 each press — for stress-testing
// hordes. Keys are consumed (capture + stopPropagation) so they don't also trigger game keybinds.
import { useEffect, useRef, useState } from 'react';
import { useThree } from '@react-three/fiber';
import { MonsterEnemy } from './MonsterEnemy';

let nextId = 0;
type Demon = { id: number; spawn: [number, number, number] };

export function SiegeSpawner() {
  const camera = useThree((s) => s.camera);
  const [demons, setDemons] = useState<Demon[]>([]);
  const stage = useRef<'idle' | 'type' | 'qty'>('idle');
  const stageTimer = useRef<number | null>(null);
  const spamUntil = useRef(0);

  useEffect(() => {
    const clearStage = () => {
      stage.current = 'idle';
      if (stageTimer.current) { clearTimeout(stageTimer.current); stageTimer.current = null; }
    };
    const arm = () => {
      if (stageTimer.current) clearTimeout(stageTimer.current);
      stageTimer.current = window.setTimeout(() => { stage.current = 'idle'; }, 3000);
    };
    const spawn = (count: number) => {
      const { x, y, z } = camera.position;
      const add: Demon[] = [];
      for (let i = 0; i < count; i++) {
        const ang = Math.random() * Math.PI * 2, rad = 6 + Math.random() * 14;
        add.push({ id: nextId++, spawn: [x + Math.cos(ang) * rad, y, z + Math.sin(ang) * rad] });
      }
      setDemons((d) => [...d, ...add]);
      spamUntil.current = performance.now() + 2000;
      console.log(`[SiegeSpawner] +${count} red demons (total ${demons.length + count})`);
    };

    const onKey = (e: KeyboardEvent) => {
      const k = e.key;
      // Spam "0" within 2s of the last spawn → +10 more.
      if (k === '0' && stage.current === 'idle' && performance.now() < spamUntil.current) {
        e.preventDefault(); e.stopPropagation(); spawn(10); return;
      }
      if (k === '!') { e.preventDefault(); e.stopPropagation(); stage.current = 'type'; arm(); return; }
      if (stage.current === 'type') {
        e.preventDefault(); e.stopPropagation();
        if (k === '1') { stage.current = 'qty'; arm(); } else { clearStage(); }
        return;
      }
      if (stage.current === 'qty') {
        e.preventDefault(); e.stopPropagation();
        if (/^[0-9]$/.test(k)) spawn(k === '0' ? 10 : parseInt(k, 10));
        clearStage();
        return;
      }
    };
    window.addEventListener('keydown', onKey, true);
    return () => { window.removeEventListener('keydown', onKey, true); clearStage(); };
  }, [camera, demons.length]);

  return (
    <>
      {demons.map((d) => (
        <MonsterEnemy key={d.id} spawn={d.spawn} url="/siege/monsters/reddemon.glb"
          modelHeight={1.886} height={1.8} aggro={400} speed={3.2} wanderRadius={6} />
      ))}
    </>
  );
}
