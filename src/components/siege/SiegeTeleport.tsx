// SiegeTeleport (in-Canvas) — owns the camera + the teleport keys. Ctrl/Cmd+J
// ARMS quick-travel (a styled "Jump To:" menu shows via SiegeTeleportMenu for 5s),
// then a digit 1-8 jumps. Shift+<digit> while armed SAVES your current spot AND FACING
// to that slot (localStorage), so any pad can be set exactly. A jump restores both the
// position and the view angle. Each save also logs a paste-ready pose to the console, so
// the captured spot can be baked into siegeAreas as the default for everyone. Esc cancels.

import { useEffect } from 'react';
import { useThree } from '@react-three/fiber';
import * as THREE from 'three';
import { SIEGE_TELEPORTS } from './siegeAreas';
import { setTeleportArmed } from './teleportStore';
import { SIEGE_MAP_JUMPS } from '@/config/worldDefinition';
import { setActiveMapId } from '@/config/activeMap';
import { getActiveGame, setActiveGame } from '@/config/activeGame';

const MAP_JUMP_BY_CODE: Record<string, string> = Object.fromEntries(
  SIEGE_MAP_JUMPS.map((m) => [m.code, m.id]),
);

const LS = 'sw_teleports_v2';
type Vec3 = [number, number, number];
interface Saved { pos: Vec3; yaw?: number; pitch?: number }

function loadOverrides(): Record<number, Saved> {
  try {
    const raw = JSON.parse(localStorage.getItem(LS) || '{}') as Record<string, Saved | Vec3>;
    const out: Record<number, Saved> = {};
    for (const k of Object.keys(raw)) { const v = raw[k]; out[+k] = Array.isArray(v) ? { pos: v } : v; }  // tolerate legacy bare-array
    return out;
  } catch { return {}; }
}
function saveOverride(slot: number, s: Saved): void {
  const o = loadOverrides(); o[slot] = s;
  try { localStorage.setItem(LS, JSON.stringify(o)); } catch { /* ignore */ }
}
function destFor(slot: number, overrides: Record<number, Saved>): Saved | null {
  if (overrides[slot]) return overrides[slot];
  const t = SIEGE_TELEPORTS.find((t) => t.slot === slot);
  return t ? { pos: t.pos, yaw: t.yaw, pitch: t.pitch } : null;
}

export function SiegeTeleport() {
  const camera = useThree((s) => s.camera);
  useEffect(() => {
    let armed = false;
    let timer: ReturnType<typeof setTimeout> | undefined;
    const overrides = loadOverrides();
    const euler = new THREE.Euler(0, 0, 0, 'YXZ');
    const r3 = (n: number) => Math.round(n * 1000) / 1000;
    const disarm = () => { armed = false; setTeleportArmed(false); if (timer) clearTimeout(timer); };
    const arm = () => {
      armed = true; setTeleportArmed(true);
      if (timer) clearTimeout(timer);
      timer = setTimeout(disarm, 5000);
    };

    const onKey = (e: KeyboardEvent) => {
      if ((e.ctrlKey || e.metaKey) && e.code === 'KeyJ') {     // ARM
        e.preventDefault(); e.stopPropagation(); arm(); return;
      }
      if (!armed) return;
      if (e.code === 'Escape') { e.preventDefault(); disarm(); return; }
      // Map jump (switch the whole world): 0=Starblink, 9=Bleakrock/SWW. FortressScene
      // teleports the player to the new map's spawn when the active map changes.
      if (MAP_JUMP_BY_CODE[e.code]) {
        e.preventDefault(); e.stopPropagation();
        if (getActiveGame() !== 'siege-worlds') setActiveGame('siege-worlds');
        setActiveMapId(MAP_JUMP_BY_CODE[e.code]);
        disarm(); return;
      }
      if (/^Digit[1-8]$/.test(e.code)) {
        e.preventDefault(); e.stopPropagation();
        const slot = parseInt(e.code.slice(5), 10);
        if (e.shiftKey) {                                       // SAVE current spot + facing
          euler.setFromQuaternion(camera.quaternion, 'YXZ');
          const s: Saved = {
            pos: [Math.round(camera.position.x), Math.round(camera.position.y), Math.round(camera.position.z)],
            yaw: r3(euler.y), pitch: r3(euler.x),
          };
          saveOverride(slot, s); overrides[slot] = s;
          const name = SIEGE_TELEPORTS.find((t) => t.slot === slot)?.name ?? `slot ${slot}`;
          // Paste this line back to bake it into siegeAreas as the default for everyone.
          console.log(`[SiegeTeleport] Saved ${name}: pos=[${s.pos.join(', ')}] yaw=${s.yaw} pitch=${s.pitch}`);
        } else {                                                // TELEPORT (position + view angle)
          const d = destFor(slot, overrides);
          if (d) {
            camera.position.set(d.pos[0], d.pos[1], d.pos[2]);
            if (d.yaw != null) {
              const setView = (window as unknown as { __siegeSetView?: (y: number, p?: number) => void }).__siegeSetView;
              if (setView) setView(d.yaw, d.pitch ?? 0);
              else camera.quaternion.setFromEuler(euler.set(d.pitch ?? 0, d.yaw, 0, 'YXZ'));   // fallback if controls not mounted
            }
          }
        }
        disarm();
      }
    };

    window.addEventListener('keydown', onKey, true);
    return () => { window.removeEventListener('keydown', onKey, true); if (timer) clearTimeout(timer); setTeleportArmed(false); };
  }, [camera]);

  return null;
}
