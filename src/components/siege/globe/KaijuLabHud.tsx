// KaijuLabHud — the Mini Earth readout (step D4 of docs/MINI_EARTH_P1_BUILD.md).
//
// Shows game units AND the implied real-world size at the same time, because that is what makes
// the Kaiju-size decision obvious by looking rather than by arithmetic. At 100 units the readout
// says "10.0 km real", next to Everest at 88.5 units, and the answer picks itself.
//
// Uses the shared debug-panel CSS variables so it matches the engine's other readouts.

import { useEffect, useState, useSyncExternalStore } from 'react';
import { useDraggablePanel } from '../useDraggablePanel';
import { METRES_PER_UNIT, PLANET_RADIUS } from './cubeSphere';
import { earthTileStats } from './earthTiles';
import { terrainDiag } from './GlobeTerrain';
import { crowdDiag } from './KaijuCrowd';
import { nearestKaijuMetres, getAgents } from './kaijuArena';
import { gunfireDiag } from './kaijuGunfire';
import { rigLimbCount } from './kaijuColliders';
import { failedLayers } from './GlobeErrorBoundary';
import { isKaijuWalkActive, subscribeKaijuWalk, cameraSubjectName, walkInputDiag } from './KaijuWalkController';
import { walkSpeed, runSpeed, body as kaijuBody } from './kaijuBody';
import { kaijuDiag } from './kaijuDiag';
import { currentLandmark, subscribeLandmark } from './landmarkJump';
import {
  getKaijuLab, subscribeKaijuLab, sizeRatio, animSpeedMul, SCALE_STEP, KAIJU_TYPES,
} from './kaijuLabState';

/** Reference values, in game units, so sizes can be judged against something real. */
const EVEREST_UNITS = 8848 / METRES_PER_UNIT;      // 88.5
const OCEAN_UNITS = 3688 / METRES_PER_UNIT;        // 36.9

function fmtReal(units: number): string {
  const metres = units * METRES_PER_UNIT;
  return metres >= 1000 ? `${(metres / 1000).toFixed(2)} km` : `${Math.round(metres)} m`;
}

/**
 * Starting x for a panel docked to the RIGHT edge.
 *
 * The Kaiju panels used to open on the left, where they formed a second column on top of the
 * game's own HUD and covered the view. They are still draggable; this only changes where they
 * start. Falls back to a sane left position if there is no window (SSR) or the screen is narrow.
 */
function rightEdge(width: number, margin = 16): number {
  if (typeof window === 'undefined') return margin;
  return Math.max(margin, window.innerWidth - width - margin);
}

export function KaijuLabHud() {
  const s = useSyncExternalStore(subscribeKaijuLab, getKaijuLab, getKaijuLab);
  const walking = useSyncExternalStore(subscribeKaijuWalk, isKaijuWalkActive, isKaijuWalkActive);
  const lm = useSyncExternalStore(subscribeLandmark, currentLandmark, currentLandmark);
  const { pos, handleProps } = useDraggablePanel({ left: rightEdge(268), top: 90 });
  // Repaint a few times a second: the terrain diagnostics below are live values, and this panel
  // otherwise only redraws when the lab state changes — which would show them permanently stale,
  // i.e. exactly as useless as not having them.
  const [, tick] = useState(0);
  useEffect(() => {
    const id = setInterval(() => tick((n) => n + 1), 300);
    return () => clearInterval(id);
  }, []);
  const tiles = earthTileStats();

  const row = (label: string, value: string) => (
    <div style={{ display: 'flex', justifyContent: 'space-between', gap: 12 }}>
      <span style={{ opacity: 0.75 }}>{label}</span><span>{value}</span>
    </div>
  );

  return (
    <div
      style={{
        position: 'fixed', left: pos.left, top: pos.top, width: 268,
        color: 'var(--pt-debug-body-color)', font: 'var(--pt-debug-body-size) var(--pt-debug-body-family)',
        background: 'var(--pt-debug-bg)', border: 'var(--pt-debug-border-w) solid var(--pt-debug-border)',
        borderRadius: 'var(--pt-debug-radius)', padding: '8px 10px', pointerEvents: 'auto',
        boxShadow: '0 2px 10px rgba(0,0,0,0.5)', zIndex: 40,
      }}
    >
      <div {...handleProps} style={{ cursor: 'move', fontWeight: 700, marginBottom: 6 }}>
        MINI EARTH - KAIJU LAB
      </div>

      {row('Kaiju', `${s.name} (${s.index + 1}/${KAIJU_TYPES.length})`)}
      {/* Real size first: that is how a Kaiju is actually described. Game units second. */}
      {row('Height', fmtReal(s.height))}
      {row('in units', `${s.height.toFixed(3)} u`)}
      {row('Scale', `${sizeRatio(s).toFixed(2)}x model (${s.baseHeight} m natural)`)}
      {row('Animation', `${animSpeedMul(s).toFixed(2)}x`)}
      <div style={{
        margin: '6px 0', padding: '3px 6px', borderRadius: 4, fontWeight: 700,
        background: walking ? 'rgba(60,180,90,0.28)' : 'rgba(90,140,220,0.28)',
      }}>
        {walking
          ? 'WALK MODE — gravity + ground contact on'
          : 'FLY MODE — no gravity (press K to land)'}
      </div>
      {/* Speeds shown in REAL m/s, since units/sec at this scale are unintuitively tiny. */}
      {row('Walk / run', `${(walkSpeed(s.height) * 100).toFixed(0)} / ${(runSpeed(s.height) * 100).toFixed(0)} m/s`)}
      {walking && row('State', kaijuBody.submerged
        ? `SWIMMING, ${Math.round(kaijuBody.depthMetres)} m deep`
        : kaijuBody.onGround
          ? 'on ground'
          // Falls are genuinely slow at this scale (real gravity, 300 m body), so show the speed:
          // without it a 7.8 second descent looks like being stuck rather than falling.
          : `FALLING ${Math.round(Math.abs(kaijuBody.vertVel) * 100)} m/s`)}

      <div style={{ borderTop: '1px solid rgba(255,255,255,0.15)', margin: '6px 0' }} />
      {/* Phrase the comparison whichever way round is readable, rather than always showing a
          fraction like 0.01x when the Kaiju is (correctly) far smaller than a mountain. */}
      {row('vs Everest', s.height >= EVEREST_UNITS
        ? `${(s.height / EVEREST_UNITS).toFixed(2)}x taller`
        : `Everest is ${(EVEREST_UNITS / s.height).toFixed(0)}x taller`)}
      {row('Everest', `${EVEREST_UNITS.toFixed(1)} u = 8.85 km`)}
      {row('Avg ocean depth', `${OCEAN_UNITS.toFixed(1)} u = 3.69 km`)}
      {row('Planet radius', `${PLANET_RADIUS.toLocaleString()} u = 6,371 km`)}

      <div style={{ borderTop: '1px solid rgba(255,255,255,0.15)', margin: '6px 0' }} />
      {row('Tiles', `${tiles.cached} cached, ${tiles.inFlight} loading`)}
      {/* Terrain diagnostics — these three lines identify WHY the planet is missing, if it is:
          patches 0 + wanted 0 = the LOD tree chose nothing; patches 0 + wanted > 0 = it wants them
          but they will not build; patches > 0 = the geometry is there and it is a camera problem. */}
      {row('Patches', `${terrainDiag.patches} drawn / ${terrainDiag.wanted} wanted`)}
      {row('Deepest', `level ${terrainDiag.deepest}`)}
      {row('Crowd', crowdDiag.on
        ? `${crowdDiag.spawned} ${crowdDiag.layout}${crowdDiag.modelOk ? '' : ' (NO MODEL)'}`
        : 'off')}
      {row('Altitude', `${Math.round(terrainDiag.altitudeUnits)} u (near ${terrainDiag.near.toFixed(2)}, far ${Math.round(terrainDiag.far)})`)}
      {/* A dropped layer stops being simulated, not just drawn. If the arena layer goes, the fight
          silently freezes and it reads as several unrelated bugs at once. Say it out loud. */}
      {failedLayers.size > 0 && row('LAYER FAILED', [...failedLayers].join(', '))}
      {/* THE COLLIDER, MEASURED LIVE. If this reads well above "contact" while two Kaiju look like
          they are inside each other, the physics is fine and the models are being drawn somewhere
          their bodies are not — which is a completely different bug from the one I have been
          chasing, and this line is the only way to tell the two apart. */}
      {(() => {
        const n = nearestKaijuMetres();
        return n ? row('Nearest Kaiju', `${Math.round(n.gap)} m (touch at ${Math.round(n.contact)} m)`) : null;
      })()}
      {/* THE ARMY. Two failures look identical from the outside — nobody is firing, and everybody is
          firing but nothing is drawn — and they need opposite fixes. The shot count separates them.
          The limb figure is the collider the sparks land on: 0 means the rigs did not attach and
          every bullet is hitting a plain cylinder, which is what this whole system did silently for
          weeks before anyone noticed. */}
      {row('Gunfire', `${gunfireDiag.fired} fired, ${gunfireDiag.hits} hit, ${gunfireDiag.live} live`)}
      {row('Limb colliders', `${getAgents().reduce((n, a) => n + rigLimbCount(a.id), 0)} on ${getAgents().length} Kaiju`)}
      {/* Diagnostic: turns "I can't see it" into something measurable. */}
      {/* THE INPUT CHAIN. Four links; whichever one is wrong is where the break is. */}
      {row('Keys held', walkInputDiag.typing
        ? 'NONE — A TEXT BOX HAS FOCUS'
        : (walkInputDiag.keys || '-'))}
      {row('Move speed', `${(walkInputDiag.moveSpeed * 100).toFixed(1)} m/s`)}
      {row('Camera on', cameraSubjectName())}
      {row('Landmark', lm ? lm.n : '- (, . to fly there)')}
      {row('Kaiju model', kaijuDiag.loaded ? 'loaded' : 'LOADING')}
      {row('Kaiju at', kaijuDiag.finite
        ? `${kaijuDiag.dist.toFixed(1)} u, ${kaijuDiag.offAxisDeg.toFixed(0)}° off centre`
        : 'INVALID POSITION (NaN)')}

      <div style={{ marginTop: 6, opacity: 0.65, lineHeight: 1.5 }}>
        [ ] cycle · - = size ({Math.round(SCALE_STEP * 100)}%) · 0 reset<br />
        , . fly to landmark · K LAND (starts walking) · G toggle · V view<br />
        WASD move · Shift run<br />
        Space jump / swim up · Z swim down<br />
        <b>TAB</b> watch next Kaiju · <b>C</b> free camera · <b>MIDDLE-drag</b> pan (click = centre)<br />
        <b>ALT+right-drag</b> look without turning
      </div>
    </div>
  );
}
