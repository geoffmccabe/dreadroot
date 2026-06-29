// SiegeSpawner — THE single test spawner for Siege Worlds (the "!" system; there is no "@" spawner).
// Command:  "!"  then the monster's TWO-DIGIT catalog id  then a QUANTITY digit (1-9, or 0 = 10).
//   !02 5  → five Mushroom Grunts        !14 1 → one Barbarian Giant        !18 0 → ten Crawlies
// The id is the same one the Challenge Creator + admin panel use (MONSTER_CATALOG), always two digits.
// After a spawn, spamming "0" within ~4s adds another 10 of the LAST id — for stress-testing hordes.
// (Monsters have no TIER digit yet; when tiered monsters exist it slots between the id and the quantity.)
// Catalog ids:
//   01 Demon Horde · 02 Mushroom Grunt · 03 Giant Skeleton · 04 Vomit Demon · 05 Dark Lord(boss)
//   06 Bloody Skeleton horde(always 50) · 07 Spintroll · 08 Red Demon · 09 Ghost · 10 Slayer
//   11 Pig Butcher · 12 Mutant · 13 Forest Guardian · 14 Barbarian Giant · 15 Elemental Golem
//   16 Mechanical Golem · 17 Fort Golem · 18 Crawlies · 19 DF Demon.
//   (01 Demon Horde & 08 Red Demon are the SAME monster at different size/colour.)
// "!" sub-commands (not spawns): !c/!b Challenge Browser · !e Editor gallery · !hb hitboxes · !a bullseye.
// Keys are consumed (capture + stopPropagation) so they don't also trigger game keybinds.
import { useEffect, useRef, useState } from 'react';
import { useThree } from '@react-three/fiber';
import * as THREE from 'three';
import { CatalogMonster, makeHordeMember, isKnownMonsterType, type MType, type Ov } from './siegeMonsterCatalog';
import { toggleEditor } from './challenge/challengeCreatorStore';
import { toggleBrowser } from './challenge/challengeBrowserStore';
import { getChallengeState, subscribeChallenge } from './challenge/challengeStore';
import { toggleSiegeHitboxes, getMonstersPaused, setMonstersPaused, toggleBullseyeAnyHead } from './siegeDebugToggles';
import { applyEdit, toggleSelectedBox, resetNearest, markEditTarget } from './hitboxEditor';
import { exportHitboxes } from './hitboxConfig';
import { suppressQA } from '@/config/qaGuard';
import { useActiveMapId } from '@/config/activeMap';

let nextId = 0;
type Demon = { id: number; spawn: [number, number, number]; type: MType; ov?: Ov };

export function SiegeSpawner() {
  const camera = useThree((s) => s.camera);
  const [demons, setDemons] = useState<Demon[]>([]);
  // Monsters must NEVER follow the player across a map change (Cmd-J / teleport) — they chase the
  // camera regardless of world, so clear all test-spawns whenever the active map changes.
  const mapId = useActiveMapId();
  useEffect(() => { setDemons([]); }, [mapId]);
  const stage = useRef<'idle' | 'type' | 'type2' | 'qty' | 'hbwait'>('idle');
  const firstDigit = useRef('');
  const stageTimer = useRef<number | null>(null);
  const spamUntil = useRef(0);
  const pTaps = useRef<number[]>([]);   // recent 'P' press times for the triple-P pause gesture
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
      spamUntil.current = performance.now() + 4000;   // press 0 again within 4s to keep adding +10 (build a horde)
      suppressQA();   // a trailing digit must not leak into the QA number keys for ~1s
      console.log(`[SiegeSpawner] +${count} type-${type}`);
    };

    const onKey = (e: KeyboardEvent) => {
      const el = document.activeElement?.tagName;
      if (el === 'INPUT' || el === 'TEXTAREA' || el === 'SELECT') return;   // don't capture typing
      const k = e.key;
      // PAUSE gesture: P three times within 1s freezes all monsters; any P while
      // frozen unfreezes. Kept separate from the "!" command stages.
      if ((k === 'p' || k === 'P') && stage.current === 'idle') {
        e.preventDefault(); e.stopPropagation();
        const t = performance.now();
        if (getMonstersPaused()) { setMonstersPaused(false); pTaps.current = []; return; }
        pTaps.current = pTaps.current.filter((x) => t - x < 1000);
        pTaps.current.push(t);
        if (pTaps.current.length >= 3) { setMonstersPaused(true); pTaps.current = []; markEditTarget(camera.position.x, camera.position.z); }
        return;
      }
      // HITBOX EDIT MODE — only while frozen (PPP). Edits the box of the monster
      // type nearest the camera. j/l=∓X i/k=±Y u/o=∓Z (Shift=resize), b=body/head,
      // n=reset, x=export. Axes are the monster's own (z = its facing).
      if (getMonstersPaused() && stage.current === 'idle') {
        const cx = camera.position.x, cz = camera.position.z, sh = e.shiftKey, lk = k.toLowerCase();
        let handled = true;
        if (lk === 'b') toggleSelectedBox();
        else if (lk === 'n') resetNearest(cx, cz);
        else if (lk === 'x') exportHitboxes();
        else if (lk === 'j') applyEdit(cx, cz, 'x', -1, sh);
        else if (lk === 'l') applyEdit(cx, cz, 'x', 1, sh);
        else if (lk === 'i') applyEdit(cx, cz, 'y', 1, sh);
        else if (lk === 'k') applyEdit(cx, cz, 'y', -1, sh);
        else if (lk === 'u') applyEdit(cx, cz, 'z', -1, sh);
        else if (lk === 'o') applyEdit(cx, cz, 'z', 1, sh);
        else handled = false;
        if (handled) { e.preventDefault(); e.stopPropagation(); return; }
      }
      // Spam "0" within 2s of the last spawn → +10 more of the same type.
      if (k === '0' && stage.current === 'idle' && performance.now() < spamUntil.current) {
        e.preventDefault(); e.stopPropagation(); spawn(10, lastType.current); return;
      }
      if (k === '!') { e.preventDefault(); e.stopPropagation(); stage.current = 'type'; arm(); return; }
      if (stage.current === 'type') {
        e.preventDefault(); e.stopPropagation();
        if (k === 'c' || k === 'C') { toggleBrowser(); clearStage(); }         // !c → open the Challenge Browser (pick one)
        else if (k === 'e' || k === 'E') { toggleEditor(); clearStage(); }    // !e → open the Challenge Editor gallery
        else if (k === 'h' || k === 'H') { stage.current = 'hbwait'; arm(); }  // !h… → expect 'b' for hitboxes
        else if (k === 'a' || k === 'A') { const on = toggleBullseyeAnyHead(); console.log('[bullseye] any-headshot =', on); clearStage(); }  // !a → toggle "any headshot = bullseye" (TEMP testing)
        else if (k === 'b' || k === 'B') { toggleBrowser(); clearStage(); }    // !b → open the Challenge Browser
        else if (k >= '0' && k <= '9') { firstDigit.current = k; stage.current = 'type2'; arm(); }   // first digit of the two-digit id
        else clearStage();
        return;
      }
      // The monster id is ALWAYS two digits (e.g. !01 = Demon Horde, !08 = Red Demon, !18 = Crawlies).
      // First digit armed above; this second digit completes the id → quantity stage. No timing, no
      // ambiguity. (A per-monster TIER digit could slot in here later, before quantity, once tiers exist.)
      if (stage.current === 'type2') {
        e.preventDefault(); e.stopPropagation();
        if (k >= '0' && k <= '9') {
          const t = parseInt(firstDigit.current + k, 10);
          if (isKnownMonsterType(t)) { pendingType.current = t; stage.current = 'qty'; arm(); console.log(`[SiegeSpawner] type ${t} armed — press a quantity (0 = 10)`); }
          else clearStage();
        } else clearStage();
        return;
      }
      if (stage.current === 'hbwait') {
        e.preventDefault(); e.stopPropagation();
        if (k === 'b' || k === 'B') toggleSiegeHitboxes();   // !hb → toggle body + head hitbox wireframes
        clearStage();
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
