// KaijuLabHud — the Mini Earth readout (step D4 of docs/MINI_EARTH_P1_BUILD.md).
//
// Shows game units AND the implied real-world size at the same time, because that is what makes
// the Kaiju-size decision obvious by looking rather than by arithmetic. At 100 units the readout
// says "10.0 km real", next to Everest at 88.5 units, and the answer picks itself.
//
// Uses the shared debug-panel CSS variables so it matches the engine's other readouts.

import { useSyncExternalStore } from 'react';
import { useDraggablePanel } from '../useDraggablePanel';
import { METRES_PER_UNIT, PLANET_RADIUS } from './cubeSphere';
import { earthTileStats } from './earthTiles';
import {
  getKaijuLab, subscribeKaijuLab, sizeRatio, speedMul, animSpeedMul, SCALE_STEP, KAIJU_TYPES,
} from './kaijuLabState';

/** Reference values, in game units, so sizes can be judged against something real. */
const EVEREST_UNITS = 8848 / METRES_PER_UNIT;      // 88.5
const OCEAN_UNITS = 3688 / METRES_PER_UNIT;        // 36.9

function fmtReal(units: number): string {
  const metres = units * METRES_PER_UNIT;
  return metres >= 1000 ? `${(metres / 1000).toFixed(2)} km` : `${Math.round(metres)} m`;
}

export function KaijuLabHud() {
  const s = useSyncExternalStore(subscribeKaijuLab, getKaijuLab, getKaijuLab);
  const { pos, handleProps } = useDraggablePanel({ left: 16, top: 90 });
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
      {row('Speed', `${speedMul(s).toFixed(2)}x`)}
      {row('Animation', `${animSpeedMul(s).toFixed(2)}x`)}

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

      <div style={{ marginTop: 6, opacity: 0.65, lineHeight: 1.5 }}>
        [ ] cycle · - = size ({Math.round(SCALE_STEP * 100)}%) · 0 reset · K go to Kaiju
      </div>
    </div>
  );
}
