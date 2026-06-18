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
//   !7#  → SPINTROLL: spins 3-5 rev/s, green+blue fire, zooms erratically (3-5×) every 1-10s.
//          Touch = 10-100 dmg + 1-10m kb (×2 + spins your view if hit mid-zoom). 7s smoke trail.
// After a spawn, spamming "0" within 2s adds another 10 of the LAST type — for stress-testing
// hordes. Keys are consumed (capture + stopPropagation) so they don't also trigger game keybinds.
import { useEffect, useRef, useState } from 'react';
import { useThree } from '@react-three/fiber';
import * as THREE from 'three';
import { CatalogMonster, makeHordeMember, type MType, type Ov } from './siegeMonsterCatalog';
import { fireChallengeToggle } from './challenge/challengeControl';
import { toggleCreator } from './challenge/challengeCreatorStore';
import { getChallengeState, subscribeChallenge } from './challenge/challengeStore';

let nextId = 0;
type Demon = { id: number; spawn: [number, number, number]; type: MType; ov?: Ov };

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
      const el = document.activeElement?.tagName;
      if (el === 'INPUT' || el === 'TEXTAREA' || el === 'SELECT') return;   // don't capture typing
      const k = e.key;
      // Spam "0" within 2s of the last spawn → +10 more of the same type.
      if (k === '0' && stage.current === 'idle' && performance.now() < spamUntil.current) {
        e.preventDefault(); e.stopPropagation(); spawn(10, lastType.current); return;
      }
      if (k === '!') { e.preventDefault(); e.stopPropagation(); stage.current = 'type'; arm(); return; }
      if (stage.current === 'type') {
        e.preventDefault(); e.stopPropagation();
        if (k === 'c' || k === 'C') { fireChallengeToggle(); clearStage(); }   // !c → start/stop the challenge
        else if (k === 'e' || k === 'E') { toggleCreator(); clearStage(); }    // !e → open the Challenge Creator
        else if (k >= '1' && k <= '7') { pendingType.current = parseInt(k, 10) as MType; stage.current = 'qty'; arm(); }
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

  // When a challenge starts, clear any !N# test-spawns so only the challenge monsters remain.
  useEffect(() => {
    let was = getChallengeState().active;
    return subscribeChallenge(() => {
      const a = getChallengeState().active;
      if (a && !was) setDemons([]);
      was = a;
    });
  }, []);

  return (
    <>
      {demons.map((d) => (
        <CatalogMonster key={d.id} id={`d${d.id}`} type={d.type} spawn={d.spawn} ov={d.ov} onDespawn={despawn} />
      ))}
    </>
  );
}
