// SiegeTeleport (in-Canvas) — owns the camera + the teleport keys. Ctrl/Cmd+T
// ARMS quick-travel (a styled menu shows via SiegeTeleportMenu for 5s), then a
// digit 1-8 jumps. Shift+<digit> while armed SAVES your current spot to that slot
// (localStorage), so Harold / Nero / anything can be set exactly. Esc cancels.
//
// NOTE: Cmd/Ctrl+T is also the browser "new tab" shortcut; the page may not be
// able to suppress it on every setup. If it opens a tab, say so and we'll rebind.

import { useEffect } from 'react';
import { useThree } from '@react-three/fiber';
import { SIEGE_TELEPORTS } from './siegeAreas';
import { setTeleportArmed } from './teleportStore';

const LS = 'sw_teleports_v1';
type Vec3 = [number, number, number];

function loadOverrides(): Record<number, Vec3> {
  try { return JSON.parse(localStorage.getItem(LS) || '{}'); } catch { return {}; }
}
function saveOverride(slot: number, pos: Vec3): void {
  const o = loadOverrides(); o[slot] = pos;
  try { localStorage.setItem(LS, JSON.stringify(o)); } catch { /* ignore */ }
}
function destFor(slot: number, overrides: Record<number, Vec3>): Vec3 | null {
  if (overrides[slot]) return overrides[slot];
  return SIEGE_TELEPORTS.find((t) => t.slot === slot)?.pos ?? null;
}

export function SiegeTeleport() {
  const camera = useThree((s) => s.camera);
  useEffect(() => {
    let armed = false;
    let timer: ReturnType<typeof setTimeout> | undefined;
    const overrides = loadOverrides();
    const disarm = () => { armed = false; setTeleportArmed(false); if (timer) clearTimeout(timer); };
    const arm = () => {
      armed = true; setTeleportArmed(true);
      if (timer) clearTimeout(timer);
      timer = setTimeout(disarm, 5000);
    };

    const onKey = (e: KeyboardEvent) => {
      if ((e.ctrlKey || e.metaKey) && e.code === 'KeyT') {     // ARM
        e.preventDefault(); e.stopPropagation(); arm(); return;
      }
      if (!armed) return;
      if (e.code === 'Escape') { e.preventDefault(); disarm(); return; }
      if (/^Digit[1-8]$/.test(e.code)) {
        e.preventDefault(); e.stopPropagation();
        const slot = parseInt(e.code.slice(5), 10);
        if (e.shiftKey) {                                       // SAVE current spot
          saveOverride(slot, [Math.round(camera.position.x), Math.round(camera.position.y), Math.round(camera.position.z)]);
          overrides[slot] = [Math.round(camera.position.x), Math.round(camera.position.y), Math.round(camera.position.z)];
        } else {                                                // TELEPORT
          const p = destFor(slot, overrides);
          if (p) camera.position.set(p[0], p[1], p[2]);
        }
        disarm();
      }
    };

    window.addEventListener('keydown', onKey, true);
    return () => { window.removeEventListener('keydown', onKey, true); if (timer) clearTimeout(timer); setTeleportArmed(false); };
  }, [camera]);

  return null;
}
