// CoordsHud — live position + facing readout, with a one-press copy (key C, or the
// button) that puts a full report on the clipboard so Geoff can paste exactly where
// he is and which way he's looking. Engine space is mirrored-X vs Unity, so we
// report both, plus the forward vector (so "in front of me" is unambiguous).

import { useEffect, useState } from 'react';
import { playerState, heading } from './playerState';
import { probeState } from './probeState';
import { APP_VERSION } from '@/version';

function report(): string {
  const { x, y, z, fx, fz } = playerState;
  const h = heading(fx, fz);
  const lines = [
    `SW position (engine): x=${x.toFixed(1)} y=${y.toFixed(1)} z=${z.toFixed(1)}`,
    `SW position (Unity):  x=${(-x).toFixed(1)} y=${y.toFixed(1)} z=${z.toFixed(1)}`,
    `facing: ${h.deg}° ${h.dir}  forward=(${fx.toFixed(2)}, ${fz.toFixed(2)})`,
  ];
  if (probeState.on) {
    lines.push(probeState.hasHit
      ? `laser → POINTING AT: ${probeState.hit}  (hit engine x=${probeState.hx.toFixed(1)} y=${probeState.hy.toFixed(1)} z=${probeState.hz.toFixed(1)})`
      : `laser → pointing at: nothing`);
  }
  lines.push(`("in front of me" = move along forward from engine position)`, `build v${APP_VERSION}`);
  return lines.join('\n');
}

export function CoordsHud() {
  const [, tick] = useState(0);
  const [copied, setCopied] = useState(false);

  useEffect(() => {
    // C is handled by TriagePanel (capture pointed item); keep just the live readout.
    const id = setInterval(() => tick((n) => n + 1), 150);
    return () => clearInterval(id);
  }, []);

  const doCopy = () => {
    navigator.clipboard?.writeText(report()).then(() => {
      setCopied(true);
      setTimeout(() => setCopied(false), 1200);
    }).catch(() => {});
  };

  const { x, y, z, fx, fz } = playerState;
  const h = heading(fx, fz);

  return (
    <div
      style={{
        position: 'fixed', right: 10, top: 10, color: 'rgba(255,255,255,0.9)',
        font: '12px ui-monospace, monospace', textShadow: '0 1px 2px #000',
        textAlign: 'right', pointerEvents: 'none',
      }}
    >
      <div>x {x.toFixed(1)}  y {y.toFixed(1)}  z {z.toFixed(1)}</div>
      <div>facing {h.deg}° {h.dir}</div>
      <button
        onClick={doCopy}
        style={{
          marginTop: 4, pointerEvents: 'auto', cursor: 'pointer',
          font: '11px ui-monospace, monospace', color: '#fff',
          background: copied ? 'rgba(60,160,90,0.85)' : 'rgba(0,0,0,0.55)',
          border: '1px solid rgba(255,255,255,0.3)', borderRadius: 4, padding: '2px 8px',
        }}
      >
        {copied ? 'Copied!' : 'Copy position (C)'}
      </button>
    </div>
  );
}
