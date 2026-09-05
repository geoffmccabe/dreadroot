// TerrainGenPanel — the dials for Starblink's procedural terrain, plus Generate and named presets.
//
// The whole landscape is a function of these numbers, so a preset IS a world: a few hundred bytes
// that reproduce it exactly. Write down a seed you like, or save it by name and load it back.
//
// Shell copied from TerrainBrushPanel on purpose: same Card, same top grab-bar, same bottom-right
// resize corner, and the same Radix <Slider>. A plain <input type="range"> does NOT work here —
// the game installs capture-phase pointer handlers on window, so a raw range input never sees its
// own drag and appears frozen. That is what made every dial on the first version dead.
import { Card } from '@/components/ui/card';
import { Button } from '@/components/ui/button';
import { Slider } from '@/components/ui/slider';
import { useRef, useState } from 'react';
import { useActiveGame } from '@/config/activeGame';
import { useActiveMapId } from '@/config/activeMap';
import { getWorldDefinition } from '@/config/worldDefinition';
import { useDraggablePanel } from '../useDraggablePanel';
import {
  useTerrainParams, setTerrainParams, rollSeed, DEFAULT_TERRAIN,
  listPresets, savePreset, loadPreset, deletePreset, type TerrainParams,
} from '@/features/starblink/terrainParams';

type Dial = { key: keyof TerrainParams; label: string; min: number; max: number; step: number };

const GROUPS: { title: string; dials: Dial[] }[] = [
  { title: 'Scale', dials: [
    { key: 'maxHeight', label: 'Peak ceiling', min: 100, max: 900, step: 10 },
    { key: 'baseElevation', label: 'Base elevation', min: -100, max: 200, step: 5 },
    { key: 'ampContinent', label: 'Continental rise', min: 0, max: 400, step: 5 },
    { key: 'wlContinent', label: 'Continental size', min: 2000, max: 16000, step: 250 },
  ] },
  { title: 'Mountains', dials: [
    { key: 'ampMountain', label: 'Mountain height', min: 0, max: 700, step: 10 },
    { key: 'wlMountain', label: 'Range size', min: 600, max: 6000, step: 100 },
    { key: 'ridgeFloor', label: 'Rarity of ranges', min: 0.2, max: 0.85, step: 0.01 },
  ] },
  { title: 'Roughness', dials: [
    { key: 'ampHill', label: 'Hills', min: 0, max: 200, step: 5 },
    { key: 'wlHill', label: 'Hill size', min: 200, max: 3000, step: 50 },
    { key: 'ampDetail', label: 'Surface wrinkle', min: 0, max: 60, step: 1 },
    { key: 'wlDetail', label: 'Wrinkle size', min: 15, max: 200, step: 5 },
    { key: 'warpAmount', label: 'Warp (organic-ness)', min: 0, max: 900, step: 10 },
    { key: 'warpWavelength', label: 'Warp size', min: 200, max: 3000, step: 50 },
  ] },
  { title: 'Features', dials: [
    { key: 'canyonDepth', label: 'Canyon depth', min: 0, max: 300, step: 5 },
    { key: 'canyonWidth', label: 'Canyon width', min: 0.03, max: 0.6, step: 0.01 },
    { key: 'canyonWavelength', label: 'Canyon spacing', min: 400, max: 5000, step: 100 },
    { key: 'lakeDepth', label: 'Lake basin depth', min: 0, max: 250, step: 5 },
    { key: 'lakeWavelength', label: 'Lake size', min: 800, max: 8000, step: 100 },
    { key: 'terraceStep', label: 'Bench height', min: 4, max: 90, step: 2 },
    { key: 'terraceSharpness', label: 'Cliff sharpness', min: 0, max: 1, step: 0.05 },
  ] },
  { title: 'Fortress', dials: [
    { key: 'flatRadius', label: 'Flat radius', min: 0, max: 600, step: 10 },
    { key: 'flatBlend', label: 'Blend out to', min: 100, max: 2000, step: 20 },
  ] },
];

export function TerrainGenPanel() {
  const p = useTerrainParams();
  const game = useActiveGame();
  const world = getWorldDefinition(useActiveMapId());
  const { pos, handleProps } = useDraggablePanel({ left: Math.max(8, window.innerWidth - 300), top: 90 });
  const [size, setSize] = useState({ w: 276, h: 520 });
  const [name, setName] = useState('');
  const [presets, setPresets] = useState(() => listPresets());

  const rz = useRef<{ x: number; y: number; w: number; h: number } | null>(null);
  const onRzDown = (e: React.PointerEvent) => {
    rz.current = { x: e.clientX, y: e.clientY, w: size.w, h: size.h };
    (e.target as HTMLElement).setPointerCapture?.(e.pointerId);
    e.preventDefault(); e.stopPropagation();
  };
  const onRzMove = (e: React.PointerEvent) => {
    if (!rz.current) return;
    setSize({ w: Math.max(230, rz.current.w + (e.clientX - rz.current.x)), h: Math.max(220, rz.current.h + (e.clientY - rz.current.y)) });
  };
  const onRzUp = (e: React.PointerEvent) => { rz.current = null; (e.target as HTMLElement).releasePointerCapture?.(e.pointerId); };

  if (game !== 'siege-worlds' || world.ground.kind !== 'hexland') return null;

  const set = (k: keyof TerrainParams, v: number) => setTerrainParams({ [k]: v } as Partial<TerrainParams>);
  const refresh = () => setPresets(listPresets());

  return (
    <Card className="waterfall-card fixed z-50 flex flex-col overflow-hidden p-0 text-xs font-mono"
      style={{ left: pos.left, top: pos.top, width: size.w, height: size.h }}>
      {/* Top grab-bar, same as the other panels. */}
      <div {...handleProps} title="Drag to move" className="relative h-[18px] shrink-0">
        <div className="absolute left-1/2 top-[6px] h-1 w-11 -translate-x-1/2 rounded" style={{ background: 'hsla(var(--hud-border-h) / 0.75)' }} />
      </div>

      <div className="flex-1 overflow-y-auto px-3 pb-6">
        <div className="mb-2 font-bold text-primary">⛰ Terrain Generator</div>

        {/* The seed is the one number that names this world. */}
        <div className="mb-2 flex items-center gap-1">
          <span className="opacity-70">Seed</span>
          <input value={p.seed} onChange={(e) => set('seed', Number(e.target.value) || 0)}
            className="min-w-0 flex-1 rounded bg-black/40 px-1.5 py-0.5 font-mono text-[11px] text-foreground outline-none"
            style={{ border: '1px solid hsla(var(--hud-border))' }} />
          <Button size="sm" className="h-6 px-2 text-[10px]"
            onClick={() => setTerrainParams({ seed: rollSeed() })} title="New random world, same settings">Generate</Button>
        </div>

        {GROUPS.map((g) => (
          <div key={g.title} className="mb-2">
            <div className="mb-1 text-[9px] uppercase tracking-wider opacity-60">{g.title}</div>
            {g.dials.map((d) => (
              <div key={String(d.key)} className="mb-1.5">
                <div className="flex justify-between text-[10px]">
                  <span className="opacity-85">{d.label}</span>
                  <span className="opacity-60">{Number(p[d.key]).toFixed(d.step < 1 ? 2 : 0)}</span>
                </div>
                <Slider value={[Number(p[d.key])]} min={d.min} max={d.max} step={d.step}
                  onValueChange={([v]) => set(d.key, v)} />
              </div>
            ))}
          </div>
        ))}

        <div className="mb-1.5 flex gap-1">
          <input value={name} placeholder="preset name" onChange={(e) => setName(e.target.value)}
            className="min-w-0 flex-1 rounded bg-black/40 px-1.5 py-0.5 font-mono text-[11px] text-foreground outline-none"
            style={{ border: '1px solid hsla(var(--hud-border))' }} />
          <Button size="sm" className="h-6 px-2 text-[10px]"
            onClick={() => { if (name.trim()) { savePreset(name.trim()); refresh(); } }}>Save</Button>
        </div>
        <Button size="sm" variant="outline" className="mb-2 h-6 w-full text-[10px]"
          onClick={() => setTerrainParams(DEFAULT_TERRAIN)}>Reset to defaults</Button>

        {presets.length > 0 && (
          <div>
            <div className="mb-1 text-[9px] uppercase tracking-wider opacity-60">Saved worlds</div>
            {presets.map((pr) => (
              <div key={pr.name} className="flex items-center justify-between py-0.5 text-[10px]">
                <span className="cursor-pointer hover:text-primary" onClick={() => loadPreset(pr.name)} title={`seed ${pr.params.seed}`}>
                  {pr.name} <span className="opacity-50">#{pr.params.seed}</span>
                </span>
                <span className="cursor-pointer opacity-50 hover:opacity-100" onClick={() => { deletePreset(pr.name); refresh(); }}>✕</span>
              </div>
            ))}
          </div>
        )}
      </div>

      {/* Resize from the bottom-right corner. */}
      <div onPointerDown={onRzDown} onPointerMove={onRzMove} onPointerUp={onRzUp} title="Drag to resize"
        className="absolute bottom-0 right-0 h-4 w-4 cursor-nwse-resize"
        style={{ touchAction: 'none', background: 'linear-gradient(135deg, transparent 50%, hsla(var(--hud-border-h) / 0.7) 50%)' }} />
    </Card>
  );
}
