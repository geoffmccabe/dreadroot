// ProceduralPanel — the PG control section shown inside the Model Placer when it's in "PG" mode.
// Pick which species are in the mix, set the scatter/size/jitter/placement rules, then Generate (fills
// the instanced layer in one synchronous pass) or Clear. Seed makes a run reproducible; 🎲 re-rolls it.
import { Button } from '@/components/ui/button';
import { MUSHROOM_TREES } from './mushroomCatalog';
import { usePgParams, usePgInstances, setPgParams, toggleSpecies, generate, clearInstances, setPgPreview } from './pgState';

function Row({ label, children }: { label: string; children: React.ReactNode }) {
  return <div className="flex items-center justify-between gap-2"><span className="text-muted-foreground">{label}</span>{children}</div>;
}
function Slider({ label, val, min, max, step, suffix, on }: { label: string; val: number; min: number; max: number; step: number; suffix?: string; on: (v: number) => void }) {
  return (
    <div>
      <div className="flex justify-between"><span className="text-muted-foreground">{label}</span><b className="text-foreground">{val}{suffix}</b></div>
      <input type="range" min={min} max={max} step={step} value={val} onChange={(e) => on(parseFloat(e.target.value))} className="w-full" />
    </div>
  );
}
const num = "w-16 rounded bg-background/60 px-1 py-0.5 text-right text-[10px]";

export function ProceduralPanel() {
  const p = usePgParams();
  const count = usePgInstances().length;
  return (
    <div className="flex flex-1 flex-col gap-2 overflow-y-auto pr-0.5 text-[10px]">
      <select className="w-full rounded bg-background/60 px-1 py-1 text-[11px]" value="mushrooms" onChange={() => { /* only category for now */ }}>
        <option value="mushrooms">🍄 Mushroom Trees</option>
      </select>

      <div>
        <div className="mb-1 flex items-center justify-between">
          <span className="font-bold text-muted-foreground">Species ({p.species.length}/{MUSHROOM_TREES.length})</span>
          <span className="flex gap-1">
            <button className="rounded border border-border px-1" onClick={() => setPgParams({ species: [...MUSHROOM_TREES] })}>all</button>
            <button className="rounded border border-border px-1" onClick={() => setPgParams({ species: [] })}>none</button>
          </span>
        </div>
        <div className="max-h-28 overflow-y-auto rounded border border-border/40 p-1">
          {MUSHROOM_TREES.map((f) => (
            <div key={f} className="flex items-center gap-1 px-1 py-0.5 hover:bg-accent">
              <span onMouseEnter={() => setPgPreview(f)} onMouseLeave={() => setPgPreview(null)}
                className="cursor-help select-none" title="Hover to preview">🔍</span>
              <label className="flex flex-1 cursor-pointer items-center gap-1 truncate">
                <input type="checkbox" checked={p.species.includes(f)} onChange={() => toggleSpecies(f)} />
                <span className="truncate">{f}</span>
              </label>
            </div>
          ))}
        </div>
      </div>

      <Slider label="Count (attempts)" val={p.count} min={10} max={3000} step={10} on={(v) => setPgParams({ count: v })} />

      <div className="rounded border border-border/40 p-1.5">
        <div className="mb-1 font-bold text-muted-foreground">Size (metres tall)</div>
        <Row label="min / max"><span className="flex gap-1">
          <input type="number" className={num} value={p.minH} onChange={(e) => setPgParams({ minH: Math.max(1, +e.target.value) })} />
          <input type="number" className={num} value={p.maxH} onChange={(e) => setPgParams({ maxH: Math.max(2, +e.target.value) })} />
        </span></Row>
        <Slider label="Big-is-rare bias" val={p.sizeBias} min={1} max={6} step={0.5} on={(v) => setPgParams({ sizeBias: v })} />
      </div>

      <div className="rounded border border-border/40 p-1.5">
        <div className="mb-1 font-bold text-muted-foreground">Variety</div>
        <label className="flex cursor-pointer items-center gap-1"><input type="checkbox" checked={p.yawRandom} onChange={(e) => setPgParams({ yawRandom: e.target.checked })} /> random spin</label>
        <Slider label="Lean / tilt" val={p.tiltMax} min={0} max={30} step={1} suffix="°" on={(v) => setPgParams({ tiltMax: v })} />
        <Slider label="Stretch jitter" val={Math.round(p.stretchVar * 100)} min={0} max={50} step={1} suffix="%" on={(v) => setPgParams({ stretchVar: v / 100 })} />
      </div>

      <div className="rounded border border-border/40 p-1.5">
        <div className="mb-1 font-bold text-muted-foreground">Where</div>
        <Row label="altitude min / max"><span className="flex gap-1">
          <input type="number" className={num} value={p.altMin} onChange={(e) => setPgParams({ altMin: +e.target.value })} />
          <input type="number" className={num} value={p.altMax} onChange={(e) => setPgParams({ altMax: +e.target.value })} />
        </span></Row>
        <Slider label="Max slope" val={p.slopeMax} min={0} max={70} step={1} suffix="°" on={(v) => setPgParams({ slopeMax: v })} />
        <Row label="region X"><span className="flex gap-1">
          <input type="number" className={num} value={p.regionMinX} onChange={(e) => setPgParams({ regionMinX: +e.target.value })} />
          <input type="number" className={num} value={p.regionMaxX} onChange={(e) => setPgParams({ regionMaxX: +e.target.value })} />
        </span></Row>
        <Row label="region Z"><span className="flex gap-1">
          <input type="number" className={num} value={p.regionMinZ} onChange={(e) => setPgParams({ regionMinZ: +e.target.value })} />
          <input type="number" className={num} value={p.regionMaxZ} onChange={(e) => setPgParams({ regionMaxZ: +e.target.value })} />
        </span></Row>
      </div>

      <Row label="Seed"><span className="flex items-center gap-1">
        <input type="number" className={num} value={p.seed} onChange={(e) => setPgParams({ seed: +e.target.value })} />
        <button className="rounded border border-border px-1" title="Random seed" onClick={() => setPgParams({ seed: Math.floor(Math.random() * 1e9) })}>🎲</button>
      </span></Row>

      <div className="flex items-center justify-between pt-1">
        <span className="text-muted-foreground">{count.toLocaleString()} placed</span>
        <span className="flex gap-1">
          <Button size="sm" className="h-7 px-3 text-[11px]" onClick={() => generate()}>Generate</Button>
          <Button size="sm" variant="outline" className="h-7 px-2 text-[11px]" onClick={() => clearInstances()}>Clear</Button>
        </span>
      </div>
    </div>
  );
}
