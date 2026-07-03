// ProceduralPanel — the PG controls (shown in the Model Placer when in PG mode). Two species groups:
// "All Species" (the pool — add to include) and "Chosen Species" (each with its own rarity weight,
// min/max size and altitude band). New chosen species inherit the current global defaults. Global
// scatter params + Generate/Clear/Save at the bottom.
import { useEffect, useState } from 'react';
import { Button } from '@/components/ui/button';
import { useActiveMapId } from '@/config/activeMap';
import { MUSHROOM_TREES, importUrl } from './mushroomCatalog';
import {
  usePgParams, usePgInstances, getPgInstances, setPgParams, generate, clearInstances, setPgPreview,
  isChosen, addSpecies, removeSpecies, updateSpecies, type SpeciesCfg,
} from './pgState';
import { savePgSet, loadPgSet, exportPgSet, importPgSet } from './pgPersistence';
import { addObjects, removeBySet, useBuilder } from './builderObjectsState';
import { modelHeights } from './modelMeasure';

const num = 'w-12 rounded bg-background/60 px-1 py-0.5 text-right text-[10px]';
function Slider({ label, val, min, max, step, suffix, on }: { label: string; val: number; min: number; max: number; step: number; suffix?: string; on: (v: number) => void }) {
  return (
    <div>
      <div className="flex justify-between"><span className="text-muted-foreground">{label}</span><b className="text-foreground">{val}{suffix}</b></div>
      <input type="range" min={min} max={max} step={step} value={val} onChange={(e) => on(parseFloat(e.target.value))} className="w-full" />
    </div>
  );
}
const N = (v: number, on: (n: number) => void, min = 0) => (
  <input type="number" className={num} value={v} onChange={(e) => on(Math.max(min, +e.target.value))} />
);

function ChosenRow({ c }: { c: SpeciesCfg }) {
  return (
    <div className="rounded border border-primary/30 bg-primary/5 p-1">
      <div className="flex items-center gap-1">
        <span onMouseEnter={() => setPgPreview(c.file)} onMouseLeave={() => setPgPreview(null)} className="cursor-help" title="Hover to preview">🔍</span>
        <span className="flex-1 truncate">{c.file}</span>
        <button className="rounded border border-border px-1 text-muted-foreground hover:text-foreground" title="Remove" onClick={() => removeSpecies(c.file)}>×</button>
      </div>
      <div className="mt-0.5 flex items-center justify-between"><span className="text-muted-foreground">rarity ⚖</span>{N(c.weight, (v) => updateSpecies(c.file, { weight: v }))}</div>
      <div className="flex items-center justify-between"><span className="text-muted-foreground">size m</span><span className="flex gap-1">{N(c.minH, (v) => updateSpecies(c.file, { minH: v }), 1)}{N(c.maxH, (v) => updateSpecies(c.file, { maxH: v }), 2)}</span></div>
      <div className="flex items-center justify-between"><span className="text-muted-foreground">altitude</span><span className="flex gap-1">{N(c.altMin, (v) => updateSpecies(c.file, { altMin: v }))}{N(c.altMax, (v) => updateSpecies(c.file, { altMax: v }))}</span></div>
    </div>
  );
}

export function ProceduralPanel() {
  const p = usePgParams();
  const count = usePgInstances().length;
  const unchosen = MUSHROOM_TREES.filter((f) => !isChosen(f));
  const mapId = useActiveMapId();
  const [setMsg, setSetMsg] = useState('');
  useEffect(() => { loadPgSet(mapId); }, [mapId]);   // load this map's saved PG set on entry
  const onSaveSet = async () => {
    const r = await savePgSet(mapId, `${mapId} mushrooms`);
    setSetMsg(r.cloud ? 'Saved ☁' : 'Saved local'); setTimeout(() => setSetMsg(''), 2500);
  };
  const onImport = async (e: React.ChangeEvent<HTMLInputElement>) => {
    const f = e.target.files?.[0]; if (f) { const ok = await importPgSet(f); setSetMsg(ok ? 'Imported' : 'Bad file'); setTimeout(() => setSetMsg(''), 2500); }
    e.target.value = '';
  };
  // ACCEPT: turn the live preview into real, editable objects (grab them with Shift+`). Preserves
  // lean + stretch. Tagged as a batch so it can be deleted cleanly later (no orphaned edits).
  const acceptedCount = useBuilder().objects.filter((o) => o.pgSetId).length;
  const [accepting, setAccepting] = useState(false);
  const onAccept = async () => {
    const insts = getPgInstances();
    if (!insts.length) return;
    setAccepting(true);
    const heights = await modelHeights(insts.map((i) => i.file));
    const setId = `pg_${Math.floor(performance.now())}`;
    addObjects(insts.map((i) => ({
      set: 'pg', file: importUrl(i.file), name: i.file,
      pos: [i.x, i.y, i.z] as [number, number, number], rotY: i.yaw, scale: i.height / (heights.get(i.file) || 1),
      tiltX: i.tiltX, tiltZ: i.tiltZ, sx: i.stretchX, sy: i.stretchY, sz: i.stretchZ, pgSetId: setId, noCollider: true,
    })));
    clearInstances();
    setAccepting(false);
  };
  const onDeleteAll = () => { if (window.confirm(`Delete all ${acceptedCount} generated objects (and their edits)?`)) removeBySet(); };
  return (
    <div className="flex flex-1 flex-col gap-2 overflow-y-auto pr-0.5 text-[10px]">
      <select className="w-full rounded bg-background/60 px-1 py-1 text-[11px]" value="mushrooms" onChange={() => { /* only category for now */ }}>
        <option value="mushrooms">🍄 Mushroom Trees</option>
      </select>

      {/* Global defaults new chosen species inherit */}
      <div className="rounded border border-border/40 p-1.5">
        <div className="mb-1 font-bold text-muted-foreground">New-species defaults</div>
        <div className="flex items-center justify-between"><span className="text-muted-foreground">size m</span><span className="flex gap-1">{N(p.defMinH, (v) => setPgParams({ defMinH: v }), 1)}{N(p.defMaxH, (v) => setPgParams({ defMaxH: v }), 2)}</span></div>
        <div className="flex items-center justify-between"><span className="text-muted-foreground">altitude</span><span className="flex gap-1">{N(p.defAltMin, (v) => setPgParams({ defAltMin: v }))}{N(p.defAltMax, (v) => setPgParams({ defAltMax: v }))}</span></div>
      </div>

      <div>
        <div className="mb-1 font-bold text-muted-foreground">Chosen Species ({p.chosen.length})</div>
        <div className="flex max-h-56 flex-col gap-1 overflow-y-auto">
          {p.chosen.map((c) => <ChosenRow key={c.file} c={c} />)}
          {!p.chosen.length && <div className="text-muted-foreground">none — add from below</div>}
        </div>
      </div>

      <div>
        <div className="mb-1 font-bold text-muted-foreground">All Species ({unchosen.length})</div>
        <div className="max-h-28 overflow-y-auto rounded border border-border/40 p-1">
          {unchosen.map((f) => (
            <div key={f} className="flex items-center gap-1 px-1 py-0.5 hover:bg-accent">
              <span onMouseEnter={() => setPgPreview(f)} onMouseLeave={() => setPgPreview(null)} className="cursor-help" title="Hover to preview">🔍</span>
              <span className="flex-1 truncate">{f}</span>
              <button className="rounded border border-border px-1" title="Add to chosen" onClick={() => addSpecies(f)}>+</button>
            </div>
          ))}
          {!unchosen.length && <div className="px-1 text-muted-foreground">all chosen</div>}
        </div>
      </div>

      <div className="rounded border border-border/40 p-1.5">
        <div className="mb-1 font-bold text-muted-foreground">Scatter</div>
        <Slider label="Count (attempts)" val={p.count} min={10} max={3000} step={10} on={(v) => setPgParams({ count: v })} />
        <Slider label="Big-is-rare bias" val={p.sizeBias} min={1} max={6} step={0.5} on={(v) => setPgParams({ sizeBias: v })} />
        <Slider label="Max slope" val={p.slopeMax} min={0} max={70} step={1} suffix="°" on={(v) => setPgParams({ slopeMax: v })} />
        <Slider label="Lean / tilt" val={p.tiltMax} min={0} max={30} step={1} suffix="°" on={(v) => setPgParams({ tiltMax: v })} />
        <Slider label="Stretch jitter" val={Math.round(p.stretchVar * 100)} min={0} max={50} step={1} suffix="%" on={(v) => setPgParams({ stretchVar: v / 100 })} />
        <label className="flex cursor-pointer items-center gap-1"><input type="checkbox" checked={p.yawRandom} onChange={(e) => setPgParams({ yawRandom: e.target.checked })} /> random spin</label>
        <div className="mt-1 flex items-center justify-between"><span className="text-muted-foreground">region X</span><span className="flex gap-1">{N(p.regionMinX, (v) => setPgParams({ regionMinX: v }), -99999)}{N(p.regionMaxX, (v) => setPgParams({ regionMaxX: v }), -99999)}</span></div>
        <div className="flex items-center justify-between"><span className="text-muted-foreground">region Z</span><span className="flex gap-1">{N(p.regionMinZ, (v) => setPgParams({ regionMinZ: v }), -99999)}{N(p.regionMaxZ, (v) => setPgParams({ regionMaxZ: v }), -99999)}</span></div>
        <div className="flex items-center justify-between"><span className="text-muted-foreground">seed</span><span className="flex items-center gap-1">{N(p.seed, (v) => setPgParams({ seed: v }))}<button className="rounded border border-border px-1" title="Random" onClick={() => setPgParams({ seed: Math.floor(Math.random() * 1e9) })}>🎲</button></span></div>
      </div>

      <div className="flex items-center justify-between pt-1">
        <span className="text-muted-foreground">{count.toLocaleString()} preview</span>
        <span className="flex gap-1">
          <Button size="sm" className="h-7 px-3 text-[11px]" onClick={() => generate()}>Generate</Button>
          <Button size="sm" className="h-7 px-3 text-[11px]" disabled={!count || accepting} onClick={onAccept}
            title="Turn the preview into real editable objects (grab with Shift+`)">{accepting ? '…' : 'Accept'}</Button>
          <Button size="sm" variant="outline" className="h-7 px-2 text-[11px]" onClick={() => clearInstances()}>Clear</Button>
        </span>
      </div>
      {acceptedCount > 0 && (
        <div className="flex items-center justify-between text-[10px]">
          <span className="text-muted-foreground">{acceptedCount.toLocaleString()} generated objects placed</span>
          <Button size="sm" variant="destructive" className="h-6 px-2 text-[10px]" onClick={onDeleteAll}>Delete set</Button>
        </div>
      )}
      <div className="flex items-center justify-between border-t border-border/40 pt-1 text-[10px]">
        <span className="text-muted-foreground">{setMsg || 'PG set'}</span>
        <span className="flex gap-1">
          <Button size="sm" className="h-6 px-2 text-[10px]" onClick={onSaveSet} title="Save this species set + settings to the cloud">Save set</Button>
          <Button size="sm" variant="outline" className="h-6 px-1.5 text-[10px]" onClick={() => exportPgSet(mapId)} title="Download as a file">⬇</Button>
          <label className="inline-flex h-6 cursor-pointer items-center rounded border border-border px-1.5 text-[10px] hover:bg-accent" title="Load a set file">
            ⬆<input type="file" accept="application/json,.json" className="hidden" onChange={onImport} />
          </label>
        </span>
      </div>
    </div>
  );
}
