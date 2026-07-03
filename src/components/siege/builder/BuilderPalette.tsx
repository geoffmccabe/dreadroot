// BuilderPalette — styled (game CSS) drop-in object builder panel, rendered OUTSIDE the Canvas
// like the terrain panel. Shows only on editable (heightmap) siege maps. Toggle build mode, pick
// an asset set + asset to ARM, then place it in-world with the crosshair (BuilderController does
// the placing). Save writes terrain + water + objects together via mapPersistence.
import { useEffect, useMemo, useRef, useState, useSyncExternalStore } from 'react';
import { useDraggablePanel } from '../useDraggablePanel';
import { subscribeChallenge, getChallengeState } from '../challenge/challengeStore';
import { Card } from '@/components/ui/card';
import { Button } from '@/components/ui/button';
import { useActiveGame } from '@/config/activeGame';
import { useActiveMapId } from '@/config/activeMap';
import { getWorldDefinition, isEnchantedForest } from '@/config/worldDefinition';
import { serializeField } from '../terrain/heightField';
import { getBrushState, setBrushState } from '../terrain/terrainBrushState';
import { saveMap } from '../terrain/mapPersistence';
import { useBuilder, setBuilder, removeObject, clearObjects, getBuilder } from './builderObjectsState';
import { ProceduralPanel } from './ProceduralPanel';
import { ModelPreview } from './ModelPreview';
import { MUSHROOM_TREES } from './mushroomCatalog';
import { scifiData, ASSET_BASE } from '@/config/assetBase';
import { assetCode, idFromFile, loadAllAssets, resolveCode, type AssetEntry } from '../scifi/assetCode';
import { useFavorites, toggleFavorite, isFavorite, removeFavorite } from '../scifi/assetFavorites';

// The converted asset sets (catalogs live at /siege/scifi/_catalog_<set>.json).
const SETS: { id: string; label: string }[] = [
  { id: 'mushrooms', label: '🍄 Mushroom Trees' },
  { id: 'nature', label: 'Nature' }, { id: 'alpine', label: 'Alpine' }, { id: 'meadow', label: 'Meadow' },
  { id: 'swamp', label: 'Swamp' }, { id: 'jungle', label: 'Jungle' }, { id: 'desert', label: 'Desert' },
  { id: 'apoc', label: 'Apocalypse' }, { id: 'dark', label: 'Dark Fantasy' }, { id: 'city', label: 'SciFi City' },
  { id: 'cyber', label: 'Cyber City' }, { id: 'space', label: 'SciFi Space' }, { id: 'mech', label: 'Mech' },
  { id: 'worlds', label: 'SciFi Worlds' },
  // Synty "Various 2" packs.
  { id: 'adventure', label: 'Adventure' }, { id: 'ancient', label: 'Ancient Empire' },
  { id: 'dungeon', label: 'Dungeon Props' }, { id: 'elven', label: 'Elven Realm' },
  { id: 'enchanted', label: 'Enchanted Forest' }, { id: 'kingdom', label: 'Fantasy Kingdom' },
  { id: 'samurai', label: 'Samurai Empire' },
  { id: 'mining', label: 'Mining / Crystals' },
];
interface CatItem { id: string; name: string; set: string; file: string; category?: string }
const catalogCache = new Map<string, CatItem[]>();

// The manual "🍄 Mushroom Trees" set = the shared mushroom-tree catalog (kept in sync with the PG,
// incl. the split individuals) + Khaured Tower. BuilderObjectsLayer loads absolute '/…' paths directly.
const MUSHROOM_FILES = [...MUSHROOM_TREES, 'Khaured_Tower_1'];
const MUSHROOMS: CatItem[] = MUSHROOM_FILES.map((f) => ({ id: `mush:${f}`, name: f, set: 'mushrooms', file: `/siege/imports/${f}.glb` }));

export function BuilderPalette() {
  const game = useActiveGame();
  const mapId = useActiveMapId();
  const world = getWorldDefinition(mapId);
  const b = useBuilder();
  const [set, setSet] = useState('nature');
  const [items, setItems] = useState<CatItem[]>([]);
  const [q, setQ] = useState('');
  const [saved, setSaved] = useState(false);
  const [savedCloud, setSavedCloud] = useState(false);
  const [codeQ, setCodeQ] = useState('');
  const [matches, setMatches] = useState<AssetEntry[]>([]);
  const favs = useFavorites();

  // Draggable (by the title) + resizable (bottom-right corner), like the other panels.
  const { pos, handleProps } = useDraggablePanel({ left: Math.max(8, window.innerWidth - 268), top: 96 });
  const [size, setSize] = useState({ w: 347, h: 624 });   // 40% wider, 20% taller — more prominent
  const rz = useRef<{ x: number; y: number; w: number; h: number } | null>(null);
  const onRzDown = (e: React.PointerEvent) => {
    rz.current = { x: e.clientX, y: e.clientY, w: size.w, h: size.h };
    (e.target as HTMLElement).setPointerCapture?.(e.pointerId); e.preventDefault(); e.stopPropagation();
  };
  const onRzMove = (e: React.PointerEvent) => {
    if (!rz.current) return;
    setSize({ w: Math.max(200, rz.current.w + (e.clientX - rz.current.x)), h: Math.max(220, rz.current.h + (e.clientY - rz.current.y)) });
  };
  const onRzUp = (e: React.PointerEvent) => { rz.current = null; (e.target as HTMLElement).releasePointerCapture?.(e.pointerId); };

  // Type a stable asset code (any pack) → prefix-resolve against the global index and arm it.
  useEffect(() => {
    if (codeQ.trim().length < 3) { setMatches([]); return; }
    let alive = true;
    loadAllAssets(ASSET_BASE).then((all) => { if (alive) setMatches(resolveCode(codeQ, all)); });
    return () => { alive = false; };
  }, [codeQ]);

  const arm = (a: { set: string; file: string; name: string }) => {
    setBuilder({ armed: { set: a.set, file: a.file, name: a.name }, armedY: 0 });
    setSet(a.set);
  };

  useEffect(() => {
    let alive = true;
    if (set === 'mushrooms') { setItems(MUSHROOMS); return; }   // local catalog, no R2 fetch
    const cached = catalogCache.get(set);
    if (cached) { setItems(cached); return; }
    fetch(scifiData(`_catalog_${set}.json`)).then((r) => r.json()).then((d) => {
      const its = (d.items ?? []) as CatItem[];
      catalogCache.set(set, its);
      if (alive) setItems(its);
    }).catch(() => { if (alive) setItems([]); });
    return () => { alive = false; };
  }, [set]);

  const filtered = useMemo(() => {
    const t = q.trim().toLowerCase();
    const list = t ? items.filter((i) => i.name.toLowerCase().includes(t)) : items;
    return list.slice(0, 200);
  }, [items, q]);

  // Hide during a challenge (open-world build tool, not a gameplay panel).
  const inChallenge = useSyncExternalStore(subscribeChallenge, () => getChallengeState().active);
  // Enchanted Forest is a finished, reconstructed map (not a build canvas) — no terrain/builder tools.
  if (game !== 'siege-worlds' || world.ground.kind !== 'heightmap' || isEnchantedForest(world.id) || inChallenge) return null;

  const onSave = async () => {
    const res = await saveMap({
      id: world.id, name: world.name,
      heightField: serializeField(),
      water: { on: getBrushState().waterOn, level: getBrushState().waterLevel },
      objects: getBuilder().objects,
    });
    setSavedCloud(res.cloud);
    setSaved(true); setTimeout(() => setSaved(false), 1800);
  };

  // Download the current map (terrain + water + objects) as a GZIP-compressed backup. Terrain
  // heightmaps compress ~10× (neighbouring points are similar), so a ~12MB JSON becomes ~1MB.
  const onExport = async () => {
    const data = {
      id: world.id, name: world.name, savedAt: Date.now(),
      heightField: serializeField(),
      water: { on: getBrushState().waterOn, level: getBrushState().waterLevel },
      objects: getBuilder().objects,
    };
    const json = JSON.stringify(data);
    const date = new Date().toISOString().slice(0, 10);
    let blob: Blob, ext: string;
    try {
      const gz = new Blob([json]).stream().pipeThrough(new CompressionStream('gzip'));
      blob = await new Response(gz).blob(); ext = 'json.gz';
    } catch { blob = new Blob([json], { type: 'application/json' }); ext = 'json'; } // older browser: plain
    const url = URL.createObjectURL(blob);
    const a = document.createElement('a');
    a.href = url; a.download = `${world.id}-map-${date}.${ext}`;
    a.click(); URL.revokeObjectURL(url);
  };
  // Restore a backup (compressed .json.gz OR plain .json), save it, then reload to render it.
  const onImport = async (e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0]; if (!file) { return; }
    try {
      const text = file.name.endsWith('.gz')
        ? await new Response(file.stream().pipeThrough(new DecompressionStream('gzip'))).text()
        : await file.text();
      const d = JSON.parse(text);
      if (!d.heightField?.samples) { alert('Not a valid map backup file.'); return; }
      await saveMap({ id: world.id, name: world.name, heightField: d.heightField, water: d.water ?? { on: false, level: 4 }, objects: d.objects ?? [] });
      alert('Backup imported — reloading to render it.');
      window.location.reload();
    } catch { alert('Could not read that file.'); }
    e.target.value = '';
  };
  const selected = b.selectedId ? b.objects.find((o) => o.id === b.selectedId) : null;

  return (
    <>
    {b.enabled && b.pgMode === 'pg' && <ModelPreview panelLeft={pos.left} />}
    <Card className="waterfall-card fixed z-50 p-3 text-xs font-mono flex flex-col overflow-hidden"
      style={{ left: pos.left, top: pos.top, width: size.w, height: b.enabled ? size.h : undefined, opacity: b.enabled ? 1 : 0.5 }}>
      <div className="mb-2 flex items-center justify-between gap-1">
        <span {...handleProps} className="font-bold text-primary select-none" title="Drag to move">⠿ 🧩 Model Placer</span>
        <span className="flex gap-1">
          <Button size="sm" variant={b.enabled ? 'default' : 'outline'} className="h-6 px-2 text-[10px]"
            onClick={() => { const on = !b.enabled; setBuilder({ enabled: on }); if (on) setBrushState({ enabled: false }); }}>{b.enabled ? 'ON' : 'OFF'}</Button>
          <Button size="sm" variant={b.enabled && b.pgMode === 'place' ? 'default' : 'outline'} className="h-6 px-2 text-[10px]"
            onClick={() => { setBuilder({ enabled: true, pgMode: 'place' }); setBrushState({ enabled: false }); }}>Place</Button>
          <Button size="sm" variant={b.enabled && b.pgMode === 'pg' ? 'default' : 'outline'} className="h-6 px-2 text-[10px]"
            onClick={() => { setBuilder({ enabled: true, pgMode: 'pg' }); setBrushState({ enabled: false }); }} title="Procedural Generator">PG</Button>
        </span>
      </div>

      {b.enabled && b.pgMode === 'pg' && <ProceduralPanel />}

      {b.enabled && b.pgMode === 'place' && (
        <div className="flex flex-1 flex-col overflow-y-auto pr-0.5">
          {/* Type an asset CODE (from the ASSETGRID labels) — pulls that exact asset from ANY pack. */}
          <input value={codeQ} onChange={(e) => setCodeQ(e.target.value)} placeholder="type a code (e.g. 3fa9c…)"
            className="mb-1 w-full rounded bg-background/60 px-2 py-1 font-mono text-[11px]" />
          {matches.length > 0 && (
            <div className="mb-2 max-h-24 overflow-y-auto rounded border border-primary/40">
              {matches.map((m) => (
                <div key={m.code} onClick={() => arm(m)}
                  className="flex cursor-pointer items-center gap-1 px-2 py-0.5 text-[10px] hover:bg-accent">
                  <span className="font-mono text-primary">{m.code}</span>
                  <span className="truncate text-muted-foreground">{m.set} · {m.name}</span>
                </div>
              ))}
            </div>
          )}

          <select value={set} onChange={(e) => setSet(e.target.value)}
            className="mb-2 w-full rounded bg-background/60 px-1 py-1 text-[11px]">
            {SETS.map((s) => <option key={s.id} value={s.id}>{s.label}</option>)}
          </select>
          <input value={q} onChange={(e) => setQ(e.target.value)} placeholder="search…"
            className="mb-2 w-full rounded bg-background/60 px-2 py-1 text-[11px]" />
          <div className="mb-2 max-h-44 overflow-y-auto rounded border border-border/40">
            {filtered.map((i) => {
              const code = assetCode(i.id ?? idFromFile(i.file));
              return (
                <div key={i.id}
                  onClick={() => arm(i)}
                  className={`flex cursor-pointer items-center gap-1 px-2 py-0.5 text-[10px] hover:bg-accent ${b.armed?.file === i.file ? 'bg-primary/30 text-foreground' : 'text-muted-foreground'}`}>
                  <span onClick={(e) => { e.stopPropagation(); toggleFavorite({ code, set: i.set, file: i.file, name: i.name }); }}
                    className="cursor-pointer" title="Add to staging">{isFavorite(code) ? '★' : '☆'}</span>
                  <span className="font-mono text-primary/80">{code}</span>
                  <span className="truncate">{i.name}</span>
                </div>
              );
            })}
            {!filtered.length && <div className="px-2 py-1 text-[10px] text-muted-foreground">no matches</div>}
          </div>

          {/* Staging area — starred assets collected from the grids / lookup, ready to drop. */}
          {favs.length > 0 && (
            <div className="mb-2 rounded border border-border/40 p-1">
              <div className="mb-1 text-[10px] font-bold text-muted-foreground">★ Staging ({favs.length})</div>
              <div className="flex flex-wrap gap-1">
                {favs.map((f) => (
                  <span key={f.code}
                    className={`flex items-center gap-1 rounded px-1 py-0.5 text-[9px] ${b.armed?.file === f.file ? 'bg-primary/40' : 'bg-accent/40'}`}>
                    <button onClick={() => arm(f)} className="max-w-24 truncate" title={`${f.code} · ${f.name}`}>{f.name}</button>
                    <button onClick={() => removeFavorite(f.code)} className="text-muted-foreground hover:text-foreground" title="Remove">×</button>
                  </span>
                ))}
              </div>
            </div>
          )}

          {b.armed ? (
            <div className="mb-2 rounded bg-primary/15 p-1.5 text-[10px] leading-snug">
              <div>Placing: <b className="text-foreground">{b.armed.name}</b></div>
              <div className="text-muted-foreground">click = drop · scroll = up/down · [ ] rotate · - = scale · Esc = let go</div>
            </div>
          ) : (
            <div className="mb-2 text-[10px] text-muted-foreground">Pick an asset to place, or click a placed object to select.</div>
          )}

          {selected && (
            <div className="mb-2 flex items-center justify-between rounded bg-accent/30 p-1.5 text-[10px]">
              <span className="truncate">Selected: {selected.name}</span>
              <Button size="sm" variant="destructive" className="h-5 px-1.5 text-[9px]" onClick={() => removeObject(selected.id)}>Delete</Button>
            </div>
          )}

          <div className="mt-1 flex items-center justify-between">
            <span className="text-[10px] text-muted-foreground">{b.objects.length} placed</span>
            <span className="flex gap-1">
              <Button size="sm" className="h-6 px-2 text-[10px]" onClick={onSave} title="Save to your browser + Supabase cloud">{saved ? (savedCloud ? 'Saved ☁' : 'Saved (local)') : 'Save map'}</Button>
              <Button size="sm" variant="outline" className="h-6 px-2 text-[10px]" onClick={() => clearObjects()}>Clear</Button>
            </span>
          </div>
          <div className="mt-1 flex items-center justify-between text-[10px]">
            <span className="text-muted-foreground" title="Download / restore a backup file you keep">Backup file</span>
            <span className="flex gap-1">
              <Button size="sm" variant="outline" className="h-6 px-2 text-[10px]" onClick={onExport}>⬇ Export</Button>
              <label className="inline-flex h-6 cursor-pointer items-center rounded border border-border px-2 text-[10px] hover:bg-accent" title="Restore from a backup file (reloads)">
                ⬆ Import<input type="file" accept=".gz,.json,application/json,application/gzip" className="hidden" onChange={onImport} />
              </label>
            </span>
          </div>
        </div>
      )}
      {b.enabled && (
        <div onPointerDown={onRzDown} onPointerMove={onRzMove} onPointerUp={onRzUp} title="Drag to resize"
          className="absolute bottom-0 right-0 flex h-4 w-4 cursor-nwse-resize items-end justify-end text-primary/70"
          style={{ touchAction: 'none' }}>◢</div>
      )}
    </Card>
    </>
  );
}
