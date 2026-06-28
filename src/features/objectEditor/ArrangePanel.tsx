// Arrange panel — the on-screen face of the object-manipulation tool. Renders OUTSIDE the
// 3D canvas (like the other HUD panels) and is driven by the editor store's live selection:
// shows the selected object's name + position / rotation / scale and the key legend, with
// Duplicate / Delete / Deselect buttons. Surface AND text are driven by the shared 'build'
// panel theme tokens (--pt-build-*), the same way the debug panels use --pt-debug-*, so an
// admin editing the Build style restyles it live. Mounted inside BuildToolsDock.
import type { CSSProperties } from 'react';
import { panelSurface } from '@/theme/panelSurface';
import { useCurrent, duplicateSelected, deleteSelected, setSelected } from './store';

const f1 = (n: number) => (Math.round(n * 10) / 10).toFixed(1);
const yawDeg = (q: [number, number, number, number]) =>
  Math.round((2 * Math.atan2(q[1], q[3]) * 180) / Math.PI);
function modelName(url: string): string {
  if (url.startsWith('builtin:')) return url.slice(8).replace(/^\w/, (c) => c.toUpperCase());
  return url.split('/').pop()?.replace(/\.(glb|gltf)$/i, '') ?? url;
}

// Text colours come from the Build theme so they follow the Admin CSS editor.
const heading: CSSProperties = { color: 'var(--pt-build-heading-color)' };
const muted: CSSProperties = { color: 'var(--pt-build-info-color)' };
const btn = 'rounded px-2 py-0.5 text-[10px] border border-white/25 hover:bg-white/10';

export function ArrangePanel() {
  const obj = useCurrent();
  const surface: CSSProperties = {
    ...panelSurface('build'),
    color: 'var(--pt-build-body-color)',
    fontFamily: 'var(--pt-build-body-family)',
  };
  return (
    <div style={surface} className="w-60 p-3 text-xs">
      <div className="mb-2 font-bold" style={heading}>↔ Arrange</div>

      {!obj ? (
        <div className="text-[11px]" style={muted}>Click an object to select it.</div>
      ) : (
        <>
          <div className="mb-2 truncate text-[11px]">
            <span style={muted}>selected: </span>
            <b>{modelName(obj.modelUrl)}</b>
          </div>
          <div className="mb-2 grid grid-cols-[auto_1fr] gap-x-3 gap-y-0.5 text-[10px]">
            <span style={muted}>pos</span>
            <span>{f1(obj.pos[0])}, {f1(obj.pos[1])}, {f1(obj.pos[2])}</span>
            <span style={muted}>rot</span>
            <span>{yawDeg(obj.quat)}°</span>
            <span style={muted}>scale</span>
            <span>{f1(obj.scale[0])}{obj.scale[0] !== obj.scale[1] || obj.scale[1] !== obj.scale[2] ? ` / ${f1(obj.scale[1])} / ${f1(obj.scale[2])}` : ''}</span>
          </div>
          <div className="mb-2 flex gap-1">
            <button className={btn} onClick={() => duplicateSelected([1, 0, 0])}>Duplicate</button>
            <button className={btn} onClick={() => deleteSelected()}>Delete</button>
            <button className={btn} onClick={() => setSelected(null)}>Deselect</button>
          </div>
        </>
      )}

      <div className="mt-2 border-t border-white/10 pt-2 text-[10px] leading-relaxed" style={muted}>
        <div>←→ / ↑↓ move · PgUp/Dn raise</div>
        <div>[ ] rotate · - = scale</div>
        <div>⇧D duplicate · Del delete · ⌘Z undo</div>
      </div>
    </div>
  );
}
