/**
 * NpcPanel — the near-full-page NPC Builder (Ctrl/Cmd-N). NPCs = enemies AND
 * friends. Left: NPC list + "New NPC". Right: an editable header (name/faction/
 * locomotion/scale) + PHASE tabs (the EMS build layers + AI + combat). Edits write
 * through the NpcManager, which reconciles any LIVE spawned NPCs immediately — so
 * dragging a size or a spring value updates the creature in the world in real time.
 */
import { useState, useEffect, useSyncExternalStore, type ReactElement } from 'react';
import { npcManager } from '../NpcManager';
import { spawnNpcInFrontOfPlayer } from '../spawnNpc';
import type { EMSDefinition, EMSNode, PrimitiveShape, Locomotion } from '../ems/types';

const PHASES = ['Spawn', 'Primitives', 'Skeleton', 'Textures', 'Magic', 'AI', 'Combat'] as const;
type Phase = typeof PHASES[number];
const SHAPES: readonly PrimitiveShape[] = ['box', 'sphere', 'capsule', 'cone', 'cylinder'];
const LOCOMOTIONS: readonly Locomotion[] = ['static', 'walk', 'hop', 'fly'];

// ── tiny field helpers ──
function Num({ value, onChange, step = 0.1, w = 'w-16' }: { value: number; onChange: (v: number) => void; step?: number; w?: string }): ReactElement {
  // Keep a local string so intermediate states ("-", "", "1.") are typeable —
  // a plain `parseFloat() || 0` ate the leading "-", making negative offsets
  // (e.g. a left-side eye at -0.35) impossible to enter.
  const [text, setText] = useState(() => String(value));
  useEffect(() => {
    const parsed = parseFloat(text);
    if (!Number.isFinite(parsed) || parsed !== value) setText(String(value));
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [value]);
  return (
    <input
      type="number" value={text} step={step}
      onChange={(e) => {
        setText(e.target.value);
        const v = parseFloat(e.target.value);
        if (Number.isFinite(v)) onChange(v);
      }}
      className={`${w} bg-zinc-800 border border-zinc-700 rounded px-1.5 py-0.5 text-sm`}
    />
  );
}
function Vec3({ value, onChange, step = 0.1 }: { value: [number, number, number]; onChange: (v: [number, number, number]) => void; step?: number }): ReactElement {
  return (
    <span className="inline-flex gap-1">
      {[0, 1, 2].map((i) => (
        <Num key={i} value={value[i]} step={step} w="w-14" onChange={(v) => { const nv = [...value] as [number, number, number]; nv[i] = v; onChange(nv); }} />
      ))}
    </span>
  );
}
function Sel<T extends string>({ value, options, onChange, w = '' }: { value: T; options: readonly T[]; onChange: (v: T) => void; w?: string }): ReactElement {
  return (
    <select value={value} onChange={(e) => onChange(e.target.value as T)} className={`${w} bg-zinc-800 border border-zinc-700 rounded px-1.5 py-0.5 text-sm`}>
      {options.map((o) => <option key={o} value={o}>{o}</option>)}
    </select>
  );
}

export function NpcPanel({ onClose }: { onClose: () => void }): ReactElement {
  useSyncExternalStore(npcManager.subscribe, npcManager.getVersion);
  const defs = npcManager.getDefinitions();
  const [selectedSlug, setSelectedSlug] = useState<string | null>(defs[0]?.slug ?? null);
  const [phase, setPhase] = useState<Phase>('Spawn');
  const selected = defs.find((d) => d.slug === selectedSlug) ?? null;

  const newNpc = () => { const d = npcManager.createDefinition(); setSelectedSlug(d.slug); setPhase('Primitives'); };

  return (
    <div className="fixed inset-0 z-[9999] flex items-center justify-center bg-black/60" onClick={onClose}>
      <div className="w-[96vw] h-[94vh] bg-zinc-900 text-zinc-100 rounded-lg shadow-2xl flex flex-col overflow-hidden" onClick={(e) => e.stopPropagation()}>
        <div className="flex items-center justify-between px-5 py-3 border-b border-zinc-700">
          <div className="flex items-center gap-3">
            <h2 className="text-lg font-semibold">NPC Builder</h2>
            <span className="text-xs text-zinc-400">EMS — Electromagnetic Skeleton (edits apply to spawned NPCs live)</span>
          </div>
          <button onClick={onClose} className="px-3 py-1 rounded bg-zinc-700 hover:bg-zinc-600 text-sm">Close (Esc)</button>
        </div>

        <div className="flex flex-1 min-h-0">
          {/* left: NPC list */}
          <div className="w-60 border-r border-zinc-700 flex flex-col">
            <div className="px-3 py-2 flex items-center justify-between">
              <span className="text-xs uppercase tracking-wide text-zinc-500">NPCs ({defs.length})</span>
              <button onClick={newNpc} className="text-xs px-2 py-1 rounded bg-emerald-700 hover:bg-emerald-600">+ New</button>
            </div>
            <div className="flex-1 overflow-y-auto">
              {defs.map((d) => (
                <div key={d.slug} className={`group flex items-center border-l-2 ${selectedSlug === d.slug ? 'border-emerald-400 bg-zinc-800' : 'border-transparent hover:bg-zinc-800/50'}`}>
                  <button onClick={() => setSelectedSlug(d.slug)} className="flex-1 text-left px-3 py-2 text-sm min-w-0">
                    <div className="flex items-center justify-between gap-2">
                      <span className="truncate">{d.name}</span>
                      <span className={`text-[10px] px-1.5 py-0.5 rounded shrink-0 ${d.faction === 'enemy' ? 'bg-red-900 text-red-300' : 'bg-sky-900 text-sky-300'}`}>{d.faction}</span>
                    </div>
                    <div className="text-[10px] text-zinc-500">{d.nodes.length} primitives · {d.locomotion}</div>
                  </button>
                  <button
                    onClick={() => { npcManager.deleteDefinition(d.slug); if (selectedSlug === d.slug) setSelectedSlug(npcManager.getDefinitions()[0]?.slug ?? null); }}
                    className="opacity-0 group-hover:opacity-100 text-zinc-500 hover:text-red-400 px-2 text-sm" title="Delete NPC"
                  >×</button>
                </div>
              ))}
            </div>
          </div>

          {/* right: editable header + phases */}
          <div className="flex-1 flex flex-col min-w-0">
            {selected && (
              <div className="flex flex-wrap items-center gap-3 px-5 py-2 border-b border-zinc-800 text-sm">
                <input value={selected.name} onChange={(e) => npcManager.updateMeta(selected.slug, { name: e.target.value })} className="bg-zinc-800 border border-zinc-700 rounded px-2 py-0.5 w-44" />
                <label className="flex items-center gap-1 text-zinc-400">faction <Sel value={selected.faction} options={['enemy', 'friend'] as const} onChange={(v) => npcManager.updateMeta(selected.slug, { faction: v })} /></label>
                <label className="flex items-center gap-1 text-zinc-400">move <Sel value={selected.locomotion} options={LOCOMOTIONS} onChange={(v) => npcManager.updateMeta(selected.slug, { locomotion: v })} /></label>
                <label className="flex items-center gap-1 text-zinc-400">scale <Num value={selected.scale} step={0.1} onChange={(v) => npcManager.updateMeta(selected.slug, { scale: v })} /></label>
              </div>
            )}
            <div className="flex gap-1 px-4 pt-2 border-b border-zinc-700">
              {PHASES.map((p) => (
                <button key={p} onClick={() => setPhase(p)} className={`px-3 py-1.5 text-sm rounded-t ${phase === p ? 'bg-zinc-800 text-white' : 'text-zinc-400 hover:text-zinc-200'}`}>{p}</button>
              ))}
            </div>
            <div className="flex-1 overflow-y-auto p-5">
              {selected ? <PhaseContent phase={phase} def={selected} /> : <div className="text-zinc-500">No NPC selected. Click “+ New” to create one.</div>}
            </div>
          </div>
        </div>
      </div>
    </div>
  );
}

function PhaseContent({ phase, def }: { phase: Phase; def: EMSDefinition }): ReactElement {
  useSyncExternalStore(npcManager.subscribe, npcManager.getVersion);
  const slug = def.slug;
  const nodeIds = def.nodes.map((n) => n.id);

  if (phase === 'Spawn') {
    const live = npcManager.getInstances().filter((i) => i.def.slug === slug).length;
    const total = npcManager.count();
    return (
      <div className="space-y-4 max-w-xl">
        <p className="text-sm text-zinc-400">Spawn a <b className="text-white">{def.name}</b> to test it live — then edit it in the other tabs and watch it change in the world. In-world: <kbd className="px-1 bg-zinc-700 rounded">@</kbd> then a number.</p>
        <div className="flex gap-2">
          <button onClick={() => spawnNpcInFrontOfPlayer(slug)} className="px-4 py-2 rounded bg-emerald-600 hover:bg-emerald-500 text-sm font-medium">Spawn {def.name}</button>
          <button onClick={() => npcManager.clearAll()} className="px-4 py-2 rounded bg-zinc-700 hover:bg-zinc-600 text-sm">Clear all ({total})</button>
        </div>
        <div className="text-xs text-zinc-500">Live now: {live} {def.name}(s) · {total} NPCs total.</div>
      </div>
    );
  }

  if (phase === 'Primitives') {
    return (
      <div className="space-y-3">
        <div className="flex items-center justify-between max-w-3xl">
          <p className="text-sm text-zinc-400">The shapes bound onto the skeleton. Edit shape / size / offset / color — spawned NPCs update live.</p>
          <button onClick={() => npcManager.addNode(slug)} className="text-xs px-2 py-1 rounded bg-emerald-700 hover:bg-emerald-600 shrink-0">+ Primitive</button>
        </div>
        <table className="text-sm w-full max-w-3xl">
          <thead className="text-zinc-500 text-xs"><tr><th className="text-left py-1">Node</th><th className="text-left">Shape</th><th className="text-left">Size</th><th className="text-left">Offset</th><th className="text-left">Color</th><th></th></tr></thead>
          <tbody>
            {def.nodes.map((n) => (
              <tr key={n.id} className="border-t border-zinc-800 align-middle">
                <td className="py-1 pr-2 text-zinc-300">{n.id}</td>
                <td className="pr-2"><Sel value={n.shape} options={SHAPES} onChange={(v) => npcManager.updateNode(slug, n.id, { shape: v })} /></td>
                <td className="pr-2"><Vec3 value={n.size} onChange={(v) => npcManager.updateNode(slug, n.id, { size: v })} /></td>
                <td className="pr-2"><Vec3 value={n.offset} onChange={(v) => npcManager.updateNode(slug, n.id, { offset: v })} /></td>
                <td className="pr-2"><input type="color" value={n.color} onChange={(e) => npcManager.updateNode(slug, n.id, { color: e.target.value })} className="w-7 h-6 bg-transparent border border-zinc-700 rounded" /></td>
                <td><button onClick={() => npcManager.removeNode(slug, n.id)} className="text-zinc-500 hover:text-red-400 px-1" title="Remove">×</button></td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
    );
  }

  if (phase === 'Skeleton') {
    return (
      <div className="space-y-3">
        <p className="text-sm text-zinc-400">The electromagnetic bonds. <span className="text-amber-400">Spring</span> bonds wobble/lag (set stiffness k + damping); rigid bonds stick. Parent decides what each primitive hangs off.</p>
        <table className="text-sm w-full max-w-3xl">
          <thead className="text-zinc-500 text-xs"><tr><th className="text-left py-1">Node</th><th className="text-left">Parent</th><th className="text-left">Bond</th><th className="text-left">Stiffness</th><th className="text-left">Damping</th></tr></thead>
          <tbody>
            {def.nodes.map((n) => (
              <tr key={n.id} className="border-t border-zinc-800 align-middle">
                <td className="py-1 pr-2 text-zinc-300">{n.id}</td>
                <td className="pr-2">
                  <Sel value={n.parent ?? 'root'} options={['root', ...nodeIds.filter((id) => id !== n.id)]} onChange={(v) => npcManager.updateNode(slug, n.id, { parent: v === 'root' ? null : v })} />
                </td>
                <td className="pr-2"><Sel value={n.bond} options={['rigid', 'spring'] as const} onChange={(v) => npcManager.updateNode(slug, n.id, { bond: v })} /></td>
                <td className="pr-2">{n.bond === 'spring' ? <Num value={n.spring?.stiffness ?? 100} step={5} onChange={(v) => npcManager.updateNode(slug, n.id, { spring: { stiffness: v, damping: n.spring?.damping ?? 7 } })} /> : <span className="text-zinc-600">—</span>}</td>
                <td className="pr-2">{n.bond === 'spring' ? <Num value={n.spring?.damping ?? 7} step={0.5} onChange={(v) => npcManager.updateNode(slug, n.id, { spring: { stiffness: n.spring?.stiffness ?? 100, damping: v } })} /> : <span className="text-zinc-600">—</span>}</td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
    );
  }

  if (phase === 'Combat') {
    return (
      <div className="space-y-3 text-sm max-w-md">
        <label className="flex items-center justify-between">Health <Num value={def.health} step={10} w="w-24" onChange={(v) => npcManager.updateMeta(slug, { health: v })} /></label>
        <label className="flex items-center justify-between">Damage per hit <Num value={def.damagePerHit} step={1} w="w-24" onChange={(v) => npcManager.updateMeta(slug, { damagePerHit: v })} /></label>
        <label className="flex items-center justify-between">Move speed <Num value={def.moveSpeed} step={0.5} w="w-24" onChange={(v) => npcManager.updateMeta(slug, { moveSpeed: v })} /></label>
        <p className="text-zinc-500 text-xs pt-2">Armor + the combat-registry hookup (so a new NPC auto-appears in leaderboards/spawn rules) land in the plug-and-play phase.</p>
      </div>
    );
  }

  if (phase === 'AI') {
    return <Placeholder title="AI — behavior tree" body={`The behavior-tree editor moves here as a phase. Current tree: ${def.behaviorTreeId ?? 'none (idle stub)'}. The shpider/shtickman AI we unified runs on this same engine.`} />;
  }
  if (phase === 'Textures') {
    return <Placeholder title="Textures" body="Per-primitive atlas textures (the shombie/shroomer pipeline) plug in here; for now primitives use the flat colors set in the Primitives tab." />;
  }
  return <Placeholder title="Magic" body="Collider-less visual FX bound to nodes — sparkles, dust, fire, feathers. Purely visual, no physics. Arrives with Phase 1's magic layer." />;
}

function Placeholder({ title, body }: { title: string; body: string }): ReactElement {
  return (
    <div className="max-w-xl">
      <h3 className="text-base font-medium mb-2">{title}</h3>
      <p className="text-sm text-zinc-400">{body}</p>
    </div>
  );
}
