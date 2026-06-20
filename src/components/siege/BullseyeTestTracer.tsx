// Bullseye test tracer — a debug aid for tuning hitboxes. While monsters are
// FROZEN (PPP) AND boxes are shown (!hb), left-click casts an instant ray from the
// crosshair, finds which zone it would hit (bullseye > head > body), draws a
// colored line to that point, and floats a label. Lets you verify exactly where
// the bullseye box is and whether your aim intersects it — no real bullet needed.
import { useRef, useEffect } from 'react';
import { useThree, useFrame } from '@react-three/fiber';
import * as THREE from 'three';
import { siegeDemons } from './siegeHorde';
import { rayBoxEntryT } from './hitboxConfig';
import { effectiveBullseyePct } from '@/features/bullseye/bullseyeZone';
import { getMonstersPaused, useSiegeHitboxes } from './siegeDebugToggles';
import { spawnDamageNumber } from './damageNumbers';

const COLOR = { bullseye: 0xffd000, headshot: 0xff2233, body: 0x22ff55, miss: 0xffffff };
const LABEL = { bullseye: '#ffd000', headshot: '#ff3838', body: '#22ff55', miss: '#cccccc' };
const MAXLEN = 80;
const LIFE_MS = 6000;

export function BullseyeTestTracer() {
  const { camera } = useThree();
  const groupRef = useRef<THREE.Group>(null);
  const tracers = useRef<{ line: THREE.Line; bornAt: number }[]>([]);
  const showHb = useSiegeHitboxes();

  useEffect(() => {
    const onDown = (e: MouseEvent) => {
      if (e.button !== 0 || !getMonstersPaused() || !showHb || !groupRef.current) return;
      const ox = camera.position.x, oy = camera.position.y, oz = camera.position.z;
      const dir = new THREE.Vector3(0, 0, -1).applyQuaternion(camera.quaternion).normalize();
      const dx = dir.x, dy = dir.y, dz = dir.z;

      // Nearest entry distance per zone across all live boxed monsters.
      let tB = Infinity, tH = Infinity, tBo = Infinity;
      for (const d of siegeDemons) {
        if (d.dead || !d.hitboxes) continue;
        const hb = d.hitboxes;
        const cx = d.headBoxWorld ? d.headBoxWorld.x : d.x;
        const cy = d.headBoxWorld ? d.headBoxWorld.y : d.y;
        const cz = d.headBoxWorld ? d.headBoxWorld.z : d.z;
        const lx = d.headBoxWorld ? 0 : hb.head.lx, ly = d.headBoxWorld ? 0 : hb.head.ly, lz = d.headBoxWorld ? 0 : hb.head.lz;
        const pct = effectiveBullseyePct(d.bullseyePct ?? 0);
        if (pct > 0) {
          const t = rayBoxEntryT({ lx, ly, lz, hx: hb.head.hx * pct, hy: hb.head.hy * pct, hz: hb.head.hz * pct }, cx, cy, cz, d.yaw, ox, oy, oz, dx, dy, dz, MAXLEN);
          if (t >= 0 && t < tB) tB = t;
        }
        const th = rayBoxEntryT({ lx, ly, lz, hx: hb.head.hx, hy: hb.head.hy, hz: hb.head.hz }, cx, cy, cz, d.yaw, ox, oy, oz, dx, dy, dz, MAXLEN);
        if (th >= 0 && th < tH) tH = th;
        const tbo = rayBoxEntryT(hb.body, d.x, d.y, d.z, d.yaw, ox, oy, oz, dx, dy, dz, MAXLEN);
        if (tbo >= 0 && tbo < tBo) tBo = tbo;
      }

      const zone: keyof typeof COLOR = tB < Infinity ? 'bullseye' : tH < Infinity ? 'headshot' : tBo < Infinity ? 'body' : 'miss';
      const t = zone === 'bullseye' ? tB : zone === 'headshot' ? tH : zone === 'body' ? tBo : MAXLEN;
      const ex = ox + dx * t, ey = oy + dy * t, ez = oz + dz * t;

      const geo = new THREE.BufferGeometry().setFromPoints([new THREE.Vector3(ox, oy, oz), new THREE.Vector3(ex, ey, ez)]);
      const mat = new THREE.LineBasicMaterial({ color: COLOR[zone], transparent: true, opacity: 0.95, depthTest: false });
      const line = new THREE.Line(geo, mat);
      line.renderOrder = 1002;
      groupRef.current.add(line);
      tracers.current.push({ line, bornAt: performance.now() });
      spawnDamageNumber(ex, ey + 0.15, ez, zone === 'miss' ? 'miss' : zone.toUpperCase(), LABEL[zone]);
      // eslint-disable-next-line no-console
      console.log(`[bullseye test] ${zone}${zone !== 'miss' ? ` @ ${t.toFixed(2)}m` : ''}`);
    };
    window.addEventListener('mousedown', onDown);
    return () => window.removeEventListener('mousedown', onDown);
  }, [camera, showHb]);

  useFrame(() => {
    const now = performance.now();
    const arr = tracers.current;
    for (let i = arr.length - 1; i >= 0; i--) {
      const age = (now - arr[i].bornAt) / LIFE_MS;
      if (age >= 1) {
        groupRef.current?.remove(arr[i].line);
        arr[i].line.geometry.dispose();
        (arr[i].line.material as THREE.Material).dispose();
        arr.splice(i, 1);
      } else {
        (arr[i].line.material as THREE.LineBasicMaterial).opacity = 0.95 * (1 - age);
      }
    }
  });

  return <group ref={groupRef} />;
}
