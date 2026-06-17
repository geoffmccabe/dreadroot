// SiegeTeleport — quick travel between the named areas. Press the backtick/tilde
// key ( ` ) to ARM, then a digit 1-8 to jump there. Shift+<digit> while armed
// SAVES your current position to that slot (persisted to localStorage), so you
// can set Harold / Nero / anything to exactly where you want.
//
// Why backtick and not Ctrl/Cmd+T (as requested): Cmd/Cmd+T is the browser
// "new tab" shortcut and can't be intercepted by the page, and plain T + the
// number keys are already used by the controls. Backtick is free + capturable.

import { useEffect } from 'react';
import { useThree } from '@react-three/fiber';
import { SIEGE_TELEPORTS } from './siegeAreas';

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
function nameFor(slot: number): string {
  return SIEGE_TELEPORTS.find((t) => t.slot === slot)?.name ?? `slot ${slot}`;
}

function hint(text: string | null): void {
  let el = document.getElementById('sw-teleport-hint');
  if (text === null) { el?.remove(); return; }
  if (!el) {
    el = document.createElement('div');
    el.id = 'sw-teleport-hint';
    el.style.cssText = 'position:fixed;left:50%;bottom:84px;transform:translateX(-50%);z-index:9999;font:13px monospace;color:#ffd24a;background:rgba(0,0,0,.72);padding:7px 14px;border-radius:6px;pointer-events:none;white-space:pre;text-align:center;line-height:1.5;';
    document.body.appendChild(el);
  }
  el.textContent = text;
}

export function SiegeTeleport() {
  const camera = useThree((s) => s.camera);
  useEffect(() => {
    let armed = false;
    let timer: ReturnType<typeof setTimeout> | undefined;
    const overrides = loadOverrides();
    const disarm = () => { armed = false; hint(null); };

    const onKey = (e: KeyboardEvent) => {
      if (e.code === 'Backquote') {            // ARM
        e.preventDefault(); e.stopPropagation();
        armed = true;
        const list = SIEGE_TELEPORTS.map((t) => `${t.slot} ${t.name}`).join('   ');
        hint(`TELEPORT  —  press 1-8   (Shift+# = save here)\n${list}`);
        if (timer) clearTimeout(timer);
        timer = setTimeout(disarm, 5000);
        return;
      }
      if (armed && /^Digit[1-8]$/.test(e.code)) {
        e.preventDefault(); e.stopPropagation();
        const slot = parseInt(e.code.slice(5), 10);
        if (e.shiftKey) {                       // SAVE current position
          const p: Vec3 = [Math.round(camera.position.x), Math.round(camera.position.y), Math.round(camera.position.z)];
          saveOverride(slot, p); overrides[slot] = p;
          hint(`saved ${nameFor(slot)} = ${p.join(', ')}`);
        } else {                                // TELEPORT
          const p = destFor(slot, overrides);
          if (p) { camera.position.set(p[0], p[1], p[2]); hint(`→ ${nameFor(slot)}`); }
          else hint(`slot ${slot} not set`);
        }
        armed = false;
        if (timer) clearTimeout(timer);
        timer = setTimeout(() => hint(null), 1500);
      }
    };

    window.addEventListener('keydown', onKey, true);
    return () => {
      window.removeEventListener('keydown', onKey, true);
      if (timer) clearTimeout(timer);
      hint(null);
    };
  }, [camera]);

  return null;
}
