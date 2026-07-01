// BuilderPalette — styled (game CSS) drop-in object builder panel, rendered OUTSIDE the Canvas
// like the terrain panel. Shows only on editable (heightmap) siege maps. Toggle build mode, pick
// an asset set + asset to ARM, then place it in-world with the crosshair (BuilderController does
// the placing). Save writes terrain + water + objects together via mapPersistence.
import { useEffect, useMemo, useState, useSyncExternalStore } from 'react';
import { subscribeChallenge, getChallengeState } from '../challenge/challengeStore';
import { Card } from '@/components/ui/card';
import { Button } from '@/components/ui/button';
import { useActiveGame } from '@/config/activeGame';
import { useActiveMapId } from '@/config/activeMap';
import { getWorldDefinition, isEnchantedForest } from '@/config/worldDefinition';
import { serializeField } from '../terrain/heightField';
import { getBrushState } from '../terrain/terrainBrushState';
import { saveMap } from '../terrain/mapPersistence';
import { useBuilder, setBuilder, removeObject, clearObjects, getBuilder } from './builderObjectsState';
import { scifiData, ASSET_BASE } from '@/config/assetBase';
import { assetCode, idFromFile, loadAllAssets, resolveCode, type AssetEntry } from '../scifi/assetCode';
import { useFavorites, toggleFavorite, isFavorite, removeFavorite } from '../scifi/assetFavorites';

// The converted asset sets (catalogs live at /siege/scifi/_catalog_<set>.json).
const SETS: { id: string; label: string }[] = [
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

export function BuilderPalette() {
  const game = useActiveGame();
  const mapId = useActiveMapId();
  const world = getWorldDefinition(mapId);
  const b = useBuilder();
  const [set, setSet] = useState('nature');
  const [items, setItems] = useState<CatItem[]>([]);
  const [q, setQ] = useState('');
  const [saved, setSaved] = useState(false);
  const [codeQ, setCodeQ] = useState('');
  const [matches, setMatches] = useState<AssetEntry[]>([]);
  const favs = useFavorites();

  // Type a stable asset code (any pack) → prefix-resolve against the global index and arm it.
  useEffect(() => {
    if (codeQ.trim().length < 3) { setMatches([]); return; }
    let alive = true;
    loadAllAssets(ASSET_BASE).then((all) => { if (alive) setMatches(resolveCode(codeQ, all)); });
    return () => { alive = false; };
  }, [codeQ]);

  const arm = (a: { set: string; file: string; name: string }) => {
    setBuilder({ armed: { set: a.set, file: a.file, name: a.name } });
    setSet(a.set);
  };

  useEffect(() => {
    let alive = true;
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
    await saveMap({
      id: world.id, name: world.name,
      heightField: serializeField(),
      water: { on: getBrushState().waterOn, level: getBrushState().waterLevel },
      objects: getBuilder().objects,
    });
    setSaved(true); setTimeout(() => setSaved(false), 1500);
  };
  const selected = b.selectedId ? b.objects.find((o) => o.id === b.selectedId) : null;

  return (
    <Card className="waterfall-card fixed right-4 top-1/2 -translate-y-1/2 z-50 w-60 p-3 text-xs font-mono">
      <div className="mb-2 flex items-center justify-between">
        <span className="font-bold text-primary">🧱 Builder</span>
        <Button size="sm" variant={b.enabled ? 'default' : 'outline'} className="h-6 px-2 text-[10px]"
          onClick={() => setBuilder({ enabled: !b.enabled })}>
          {b.enabled ? 'Build ON' : 'Build off'}
        </Button>
      </div>

      {b.enabled && (
        <>
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
              <div className="text-muted-foreground">click = place · [ ] rotate · - = scale · Esc cancel</div>
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

          <div className="flex items-center justify-between">
            <span className="text-[10px] text-muted-foreground">{b.objects.length} placed</span>
            <span className="flex gap-1">
              <Button size="sm" className="h-6 px-2 text-[10px]" onClick={onSave}>{saved ? 'Saved!' : 'Save map'}</Button>
              <Button size="sm" variant="outline" className="h-6 px-2 text-[10px]" onClick={() => clearObjects()}>Clear</Button>
            </span>
          </div>
        </>
      )}
    </Card>
  );
}
