// TerrainGenPanel — the dials for Starblink's procedural terrain, plus Generate and named presets.
//
// The whole landscape is a function of these numbers, so a preset IS a world: a few hundred bytes
// that reproduce it exactly. Write down a seed you like, or save it by name and load it back.
//
// Only shows on the hexland map, and only while building is on, so it never clutters normal play.

import { useState } from 'react';
import { useActiveGame } from '@/config/activeGame';
import { useActiveMapId } from '@/config/activeMap';
import { getWorldDefinition } from '@/config/worldDefinition';
import {
  useTerrainParams, setTerrainParams, rollSeed, DEFAULT_TERRAIN,
  listPresets, savePreset, loadPreset, deletePreset, type TerrainParams,
} from '@/features/starblink/terrainParams';

type Dial = { key: keyof TerrainParams; label: string; min: number; max: number; step: number };

/** Grouped so the panel reads as "how big", "how rough", "what shapes". */
const GROUPS: { title: string; dials: Dial[] }[] = [
  {
    title: 'Scale',
    dials: [
      { key: 'maxHeight', label: 'Peak ceiling', min: 100, max: 900, step: 10 },
      { key: 'baseElevation', label: 'Base elevation', min: -100, max: 200, step: 5 },
      { key: 'ampContinent', label: 'Continental rise', min: 0, max: 400, step: 5 },
      { key: 'wlContinent', label: 'Continental size', min: 2000, max: 16000, step: 250 },
    ],
  },
  {
    title: 'Mountains',
    dials: [
      { key: 'ampMountain', label: 'Mountain height', min: 0, max: 700, step: 10 },
      { key: 'wlMountain', label: 'Range size', min: 600, max: 6000, step: 100 },
      { key: 'ridgeFloor', label: 'Rarity of ranges', min: 0.2, max: 0.85, step: 0.01 },
    ],
  },
  {
    title: 'Roughness',
    dials: [
      { key: 'ampHill', label: 'Hills', min: 0, max: 200, step: 5 },
      { key: 'wlHill', label: 'Hill size', min: 200, max: 3000, step: 50 },
      { key: 'ampDetail', label: 'Surface wrinkle', min: 0, max: 60, step: 1 },
      { key: 'wlDetail', label: 'Wrinkle size', min: 15, max: 200, step: 5 },
      { key: 'warpAmount', label: 'Warp (organic-ness)', min: 0, max: 900, step: 10 },
      { key: 'warpWavelength', label: 'Warp size', min: 200, max: 3000, step: 50 },
    ],
  },
  {
    title: 'Features',
    dials: [
      { key: 'canyonDepth', label: 'Canyon depth', min: 0, max: 300, step: 5 },
      { key: 'canyonWidth', label: 'Canyon width', min: 0.03, max: 0.6, step: 0.01 },
      { key: 'canyonWavelength', label: 'Canyon spacing', min: 400, max: 5000, step: 100 },
      { key: 'lakeDepth', label: 'Lake basin depth', min: 0, max: 250, step: 5 },
      { key: 'lakeWavelength', label: 'Lake size', min: 800, max: 8000, step: 100 },
      { key: 'terraceStep', label: 'Bench height', min: 4, max: 90, step: 2 },
      { key: 'terraceSharpness', label: 'Cliff sharpness', min: 0, max: 1, step: 0.05 },
    ],
  },
  {
    title: 'Fortress',
    dials: [
      { key: 'flatRadius', label: 'Flat radius', min: 0, max: 600, step: 10 },
      { key: 'flatBlend', label: 'Blend out to', min: 100, max: 2000, step: 20 },
    ],
  },
];

const card: React.CSSProperties = {
  position: 'fixed', right: 12, bottom: 12, zIndex: 62, width: 268, maxHeight: '72vh',
  overflowY: 'auto', padding: '10px 12px', borderRadius: 10, fontSize: 11,
  background: 'rgba(10,14,20,0.92)', border: '1px solid rgba(190,215,255,0.22)', color: '#dfe7f2',
};
const btn: React.CSSProperties = {
  cursor: 'pointer', borderRadius: 6, padding: '4px 8px', fontSize: 11,
  background: 'rgba(90,130,200,0.35)', border: '1px solid rgba(190,215,255,0.3)', color: '#eaf1ff',
};

export function TerrainGenPanel() {
  const p = useTerrainParams();
  const game = useActiveGame();
  const world = getWorldDefinition(useActiveMapId());
  const [open, setOpen] = useState(true);
  const [name, setName] = useState('');
  const [presets, setPresets] = useState(() => listPresets());

  if (game !== 'siege-worlds' || world.ground.kind !== 'hexland') return null;

  const set = (k: keyof TerrainParams, v: number) => setTerrainParams({ [k]: v } as Partial<TerrainParams>);
  const refresh = () => setPresets(listPresets());

  if (!open) {
    return <div style={{ ...card, width: 'auto', maxHeight: 'none' }} onClick={() => setOpen(true)}>⛰ Terrain Generator</div>;
  }

  return (
    <div style={card}>
      <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: 8 }}>
        <b>⛰ Terrain Generator</b>
        <span style={{ cursor: 'pointer', opacity: 0.7 }} onClick={() => setOpen(false)}>–</span>
      </div>

      {/* Seed: the one number that defines which world you are looking at. */}
      <div style={{ display: 'flex', gap: 6, alignItems: 'center', marginBottom: 8 }}>
        <span style={{ opacity: 0.75 }}>Seed</span>
        <input
          value={p.seed}
          onChange={(e) => set('seed', Number(e.target.value) || 0)}
          style={{ flex: 1, minWidth: 0, background: 'rgba(0,0,0,0.4)', border: '1px solid rgba(190,215,255,0.25)', borderRadius: 5, color: '#fff', padding: '3px 6px', fontSize: 11 }}
        />
        <button style={btn} onClick={() => setTerrainParams({ seed: rollSeed() })} title="New random world with these settings">Generate</button>
      </div>

      {GROUPS.map((g) => (
        <div key={g.title} style={{ marginBottom: 8 }}>
          <div style={{ opacity: 0.6, textTransform: 'uppercase', letterSpacing: '0.08em', fontSize: 9, marginBottom: 3 }}>{g.title}</div>
          {g.dials.map((d) => (
            <div key={String(d.key)} style={{ marginBottom: 3 }}>
              <div style={{ display: 'flex', justifyContent: 'space-between' }}>
                <span style={{ opacity: 0.85 }}>{d.label}</span>
                <span style={{ opacity: 0.6 }}>{Number(p[d.key]).toFixed(d.step < 1 ? 2 : 0)}</span>
              </div>
              <input
                type="range" min={d.min} max={d.max} step={d.step}
                value={Number(p[d.key])}
                onChange={(e) => set(d.key, Number(e.target.value))}
                style={{ width: '100%' }}
              />
            </div>
          ))}
        </div>
      ))}

      <div style={{ display: 'flex', gap: 6, marginBottom: 6 }}>
        <input
          value={name} placeholder="preset name" onChange={(e) => setName(e.target.value)}
          style={{ flex: 1, minWidth: 0, background: 'rgba(0,0,0,0.4)', border: '1px solid rgba(190,215,255,0.25)', borderRadius: 5, color: '#fff', padding: '3px 6px', fontSize: 11 }}
        />
        <button style={btn} onClick={() => { if (name.trim()) { savePreset(name.trim()); refresh(); } }}>Save</button>
      </div>
      <button style={{ ...btn, width: '100%', marginBottom: 6 }} onClick={() => setTerrainParams(DEFAULT_TERRAIN)}>Reset to defaults</button>

      {presets.length > 0 && (
        <div>
          <div style={{ opacity: 0.6, fontSize: 9, textTransform: 'uppercase', letterSpacing: '0.08em', marginBottom: 3 }}>Saved worlds</div>
          {presets.map((pr) => (
            <div key={pr.name} style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', padding: '2px 0' }}>
              <span style={{ cursor: 'pointer' }} onClick={() => { loadPreset(pr.name); }} title={`seed ${pr.params.seed}`}>
                {pr.name} <span style={{ opacity: 0.5 }}>#{pr.params.seed}</span>
              </span>
              <span style={{ cursor: 'pointer', opacity: 0.5 }} onClick={() => { deletePreset(pr.name); refresh(); }}>✕</span>
            </div>
          ))}
        </div>
      )}
    </div>
  );
}
