// ProceduralPanel — the PG controls (shown in the Model Placer when in PG mode). Two species groups:
// "All Species" (the pool — add to include) and "Chosen Species" (each with its own rarity weight,
// min/max size and altitude band). New chosen species inherit the current global defaults. Global
// scatter params + Generate/Clear/Save at the bottom.
import { useEffect, useState } from 'react';
import { Button } from '@/components/ui/button';
import { useActiveMapId } from '@/config/activeMap';
import { useActiveGame } from '@/config/activeGame';
import { SavePgSetModal, LoadPgSetModal } from './PgSetModals';
import { MUSHROOM_TREES, importUrl } from './mushroomCatalog';
import {
  usePgParams, usePgInstances, getPgInstances, setPgParams, generate, clearInstances, setPgPreview,
  isChosen, addSpecies, removeSpecies, updateSpecies, type SpeciesCfg,
} from './pgState';
import { loadPgSet, exportPgSet, importPgSet } from './pgPersistence';
import { addObjects, removeBySet, useBuilder } from './builderObjectsState';
import { modelHeights } from './modelMeasure';
import { ModelThumb, preloadModels } from './ModelPreview';

const num = 'w-12 rounded bg-background/60 px-1 py-0.5 text-right text-[10px]';
function Slider({ label, val, min, max, step, suffix, on }: { label: string; val: number; min: number; max: number; step: number; suffix?: string; on: (v: number) => void }) {
  return (
    <div>
      <div className="flex justify-between"><span className="text-muted-foreground">{label}</span><b className="text-foreground">{val}{suffix}</b></div>
      <input type="range" min={min} max={max} step={step} value={val} onChange={(e) => on(parseFloat(e.target.value))} className="w-full" />
    </div>
  );
}
// Editable number box. Holds the raw text while you type (so Backspace/Delete and clearing the
// field work normally) and only commits a clamped number on blur or Enter — the old version
// re-clamped on every keystroke, which snapped an emptied field back to the min so you could
// never delete the first digit.
function NumBox({ v, on, min = 0 }: { v: number; on: (n: number) => void; min?: number }) {
  const [txt, setTxt] = useState(String(v));
  useEffect(() => { setTxt(String(v)); }, [v]);   // resync when the value changes externally (reset, dice, etc.)
  const commit = () => { const n = parseFloat(txt); on(Number.isFinite(n) ? Math.max(min, n) : min); };
  return (
    <input
      type="text"
      className={num}
      value={txt}
      onChange={(e) => setTxt(e.target.value)}
      onBlur={commit}
      onKeyDown={(e) => { if (e.key === 'Enter') (e.currentTarget as HTMLInputElement).blur(); }}
    />
  );
}
const N = (v: number, on: (n: number) => void, min = 0) => <NumBox v={v} on={on} min={min} />;

function ChosenRow({ c }: { c: SpeciesCfg }) {
  return (
    <div className="flex gap-2 rounded border border-primary/30 bg-primary/5 p-1" style={{ minHeight: 138 }}>
      <span onMouseEnter={() => setPgPreview(importUrl(c.file))} onMouseLeave={() => setPgPreview(null)}
        className="flex items-center" title="Hover for a big view"><ModelThumb url={importUrl(c.file)} size={112} /></span>
      <div className="flex flex-1 flex-col justify-center gap-0.5">
        <div className="flex items-center gap-1">
          <span className="flex-1 truncate">{c.file}</span>
          <button className="rounded border border-border px-1 text-muted-foreground hover:text-foreground" title="Remove" onClick={() => removeSpecies(c.file)}>×</button>
        </div>
        <div className="flex items-center justify-between"><span className="text-muted-foreground">rarity ⚖</span>{N(c.weight, (v) => updateSpecies(c.file, { weight: v }))}</div>
        <div className="flex items-center justify-between"><span className="text-muted-foreground">size m</span><span className="flex gap-1">{N(c.minH, (v) => updateSpecies(c.file, { minH: v }), 1)}{N(c.maxH, (v) => updateSpecies(c.file, { maxH: v }), 2)}</span></div>
        <div className="flex items-center justify-between"><span className="text-muted-foreground">altitude</span><span className="flex gap-1">{N(c.altMin, (v) => updateSpecies(c.file, { altMin: v }))}{N(c.altMax, (v) => updateSpecies(c.file, { altMax: v }))}</span></div>
        <div className="flex items-center justify-between"><span className="text-muted-foreground" title="This species' own max ground slope. Higher than the global lets it climb steeper.">max slope °</span>{N(c.slopeMax, (v) => updateSpecies(c.file, { slopeMax: v }))}</div>
      </div>
    </div>
  );
}

export function ProceduralPanel() {
  const p = usePgParams();
  const count = usePgInstances().length;
  const unchosen = MUSHROOM_TREES.filter((f) => !isChosen(f));
  const mapId = useActiveMapId();
  const game = useActiveGame();
  const [setMsg, setSetMsg] = useState('');
  const [saveOpen, setSaveOpen] = useState(false);
  const [loadOpen, setLoadOpen] = useState(false);
  useEffect(() => { loadPgSet(mapId); }, [mapId]);   // load this map's last autosaved PG set on entry
  useEffect(() => { preloadModels(); }, []);          // warm the thumbnail/preview cache
  const flashMsg = (m: string) => { setSetMsg(m); setTimeout(() => setSetMsg(''), 2500); };
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
      {/* Starblink: one switch to cover every hex, instead of the Bleakrock-shaped region box.
          It also drops the altitude/water gates, which are tuned for Bleakrock's sea level. */}
      <label style={{ display: 'flex', alignItems: 'center', gap: 6, margin: '4px 0 8px', fontSize: 11 }}>
        <input type="checkbox" checked={!!p.wholeWorld}
          onChange={(e) => setPgParams({ wholeWorld: e.target.checked })} />
        <span>Entire world (all hexes)</span>
      </label>
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
        <div className="flex flex-col gap-1">
          {p.chosen.map((c) => <ChosenRow key={c.file} c={c} />)}
          {!p.chosen.length && <div className="text-muted-foreground">none — add from below</div>}
        </div>
      </div>

      <div>
        <div className="mb-1 font-bold text-muted-foreground">All Species ({unchosen.length})</div>
        <div className="rounded border border-border/40 p-1">
          {unchosen.map((f) => (
            <div key={f} className="flex items-center gap-2 px-1 py-0.5 hover:bg-accent">
              <span onMouseEnter={() => setPgPreview(importUrl(f))} onMouseLeave={() => setPgPreview(null)} title="Hover for a big view"><ModelThumb url={importUrl(f)} size={60} /></span>
              <span className="flex-1 truncate">{f}</span>
              <button className="rounded border border-border px-1" title="Add to chosen" onClick={() => addSpecies(f)}>+</button>
            </div>
          ))}
          {!unchosen.length && <div className="px-1 text-muted-foreground">all chosen</div>}
        </div>
      </div>

      <div className="rounded border border-border/40 p-1.5">
        <div className="mb-1 font-bold text-muted-foreground">Scatter</div>
        <div className="flex items-end gap-1">
          <div className="flex-1"><Slider label="Count (attempts)" val={p.count} min={10} max={1000000} step={500} on={(v) => setPgParams({ count: v })} /></div>
          {N(p.count, (v) => setPgParams({ count: Math.min(1000000, Math.max(10, v)) }), 10)}
        </div>
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
          <Button size="sm" className="h-6 px-2 text-[10px]" onClick={() => setSaveOpen(true)} title="Name + save this set (cloud + .json.gz), choose private/public">Save set…</Button>
          <Button size="sm" variant="outline" className="h-6 px-2 text-[10px]" onClick={() => setLoadOpen(true)} title="Load one of your sets or a public set">Load…</Button>
          <Button size="sm" variant="outline" className="h-6 px-1.5 text-[10px]" onClick={() => exportPgSet(mapId)} title="Download as a compressed .json.gz file">⬇</Button>
          <label className="inline-flex h-6 cursor-pointer items-center rounded border border-border px-1.5 text-[10px] hover:bg-accent" title="Load a set file (.json.gz or .json)">
            ⬆<input type="file" accept=".gz,.json,application/json,application/gzip" className="hidden" onChange={onImport} />
          </label>
        </span>
      </div>
      <SavePgSetModal open={saveOpen} game={game} onClose={() => setSaveOpen(false)} onDone={flashMsg} />
      <LoadPgSetModal open={loadOpen} game={game} onClose={() => setLoadOpen(false)} onDone={flashMsg} />
    </div>
  );
}
