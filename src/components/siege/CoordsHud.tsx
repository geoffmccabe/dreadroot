// CoordsHud — live position + facing readout, with a one-press copy (key C, or the
// button) that puts a full report on the clipboard so Geoff can paste exactly where
// he is and which way he's looking. Engine space is mirrored-X vs Unity, so we
// report both, plus the forward vector (so "in front of me" is unambiguous).

import { useEffect, useState } from 'react';
import { heading } from './playerState';
import { probeState } from './probeState';
import { APP_VERSION } from '@/version';

// Full report from the REAL laser state (camera pos + what the laser points at). The old
// playerState store is not wired in this shell, so everything reads off probeState.
function report(): string {
  const { camX, camY, camZ, dirX, dirZ } = probeState;
  const h = heading(dirX, dirZ);
  const lines = [
    `SW camera (engine): x=${camX.toFixed(1)} y=${camY.toFixed(1)} z=${camZ.toFixed(1)}`,
    `facing: ${h.deg}° ${h.dir}  forward=(${dirX.toFixed(2)}, ${dirZ.toFixed(2)})`,
  ];
  if (probeState.hasHit) {
    lines.push(
      `laser → POINTING AT: ${probeState.hit}`,
      `  ${probeState.tris.toLocaleString()} tris · ${probeState.dist.toFixed(1)}m away`,
      `  hit engine x=${probeState.hx.toFixed(1)} y=${probeState.hy.toFixed(1)} z=${probeState.hz.toFixed(1)}`,
    );
  } else {
    lines.push(`laser → pointing at: nothing`);
  }
  lines.push(`build v${APP_VERSION}`);
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

  // Laser inspector panel — only while the laser is ON (so it disappears when you toggle
  // it off). Sits at the bottom-left, ABOVE the user menu (which is bottom-4 left-4), left-
  // aligned and rounded to match it.
  if (!probeState.on) return null;
  const hitName = probeState.hasHit ? probeState.hit : null;

  return (
    <div
      style={{
        position: 'fixed', left: 16, bottom: 150, width: 300,
        color: 'rgba(255,255,255,0.92)', font: '12px ui-monospace, monospace',
        background: 'rgba(8, 24, 16, 0.82)', border: '1px solid rgba(90,200,140,0.55)',
        borderRadius: 12, padding: '8px 10px', pointerEvents: 'auto',
        boxShadow: '0 2px 10px rgba(0,0,0,0.5)',
      }}
    >
      <div style={{ color: '#7fe6a8', fontWeight: 700, marginBottom: 4 }}>⌖ Laser inspector</div>
      <div style={{ wordBreak: 'break-all' }}>
        {hitName
          ? <>pointing at: <b style={{ color: '#ffe' }}>{hitName}</b></>
          : <span style={{ opacity: 0.7 }}>pointing at: nothing</span>}
      </div>
      {hitName && (
        <div style={{ marginTop: 2, opacity: 0.85 }}>
          {probeState.tris.toLocaleString()} tris · {probeState.dist.toFixed(1)}m away
        </div>
      )}
      <div style={{ marginTop: 3, opacity: 0.85 }}>
        <b style={{ color: '#ff8a8a' }}>B</b> = flag Bad &nbsp;·&nbsp; <b style={{ color: '#8aff8a' }}>G</b> = flag Good
      </div>
      <div style={{ marginTop: 3, opacity: 0.55, fontSize: 10 }}>cam x {probeState.camX.toFixed(0)} y {probeState.camY.toFixed(0)} z {probeState.camZ.toFixed(0)}</div>
      <div style={{ opacity: 0.55, fontSize: 10 }}>debug: {probeState.dbgMeshes} meshes · {probeState.dbgHits} hits</div>
      <button
        onClick={doCopy}
        style={{
          marginTop: 5, pointerEvents: 'auto', cursor: 'pointer',
          font: '11px ui-monospace, monospace', color: '#fff',
          background: copied ? 'rgba(60,160,90,0.9)' : 'rgba(255,255,255,0.12)',
          border: '1px solid rgba(255,255,255,0.3)', borderRadius: 6, padding: '2px 8px',
        }}
      >
        {copied ? 'Copied!' : 'Copy position (C)'}
      </button>
    </div>
  );
}
