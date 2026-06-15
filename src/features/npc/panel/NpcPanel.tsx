/**
 * NpcPanel — the near-full-page NPC Builder (Ctrl/Cmd-N). NPCs = enemies AND
 * friends, so it's "NPC", not "Enemy". A left list of NPC definitions; a set of
 * PHASE tabs on the right (the EMS build layers + AI + combat). v1 makes Spawn /
 * Skeleton / Primitives / Combat real and stubs the rest with where-it-goes notes
 * (including moving the AI/behavior-tree editor here as a phase).
 */
import { useState, useSyncExternalStore, type ReactElement } from 'react';
import { npcManager } from '../NpcManager';
import { spawnNpcInFrontOfPlayer } from '../spawnNpc';
import type { EMSDefinition } from '../ems/types';

const PHASES = ['Spawn', 'Skeleton', 'Primitives', 'Textures', 'Magic', 'AI', 'Combat'] as const;
type Phase = typeof PHASES[number];

export function NpcPanel({ onClose }: { onClose: () => void }): ReactElement {
  useSyncExternalStore(npcManager.subscribe, npcManager.getVersion);
  const defs = npcManager.getDefinitions();
  const [selectedSlug, setSelectedSlug] = useState<string | null>(defs[0]?.slug ?? null);
  const [phase, setPhase] = useState<Phase>('Spawn');
  const selected = defs.find((d) => d.slug === selectedSlug) ?? null;

  return (
    <div className="fixed inset-0 z-[9999] flex items-center justify-center bg-black/60" onClick={onClose}>
      <div
        className="w-[96vw] h-[94vh] bg-zinc-900 text-zinc-100 rounded-lg shadow-2xl flex flex-col overflow-hidden"
        onClick={(e) => e.stopPropagation()}
      >
        <div className="flex items-center justify-between px-5 py-3 border-b border-zinc-700">
          <div className="flex items-center gap-3">
            <h2 className="text-lg font-semibold">NPC Builder</h2>
            <span className="text-xs text-zinc-400">EMS — Electromagnetic Skeleton system (new · parallel to the live enemies)</span>
          </div>
          <button onClick={onClose} className="px-3 py-1 rounded bg-zinc-700 hover:bg-zinc-600 text-sm">Close (Esc)</button>
        </div>

        <div className="flex flex-1 min-h-0">
          <div className="w-60 border-r border-zinc-700 flex flex-col">
            <div className="px-4 py-2 text-xs uppercase tracking-wide text-zinc-500">NPCs ({defs.length})</div>
            <div className="flex-1 overflow-y-auto">
              {defs.map((d) => (
                <button
                  key={d.slug}
                  onClick={() => setSelectedSlug(d.slug)}
                  className={`w-full text-left px-4 py-2 text-sm border-l-2 ${selectedSlug === d.slug ? 'border-emerald-400 bg-zinc-800' : 'border-transparent hover:bg-zinc-800/50'}`}
                >
                  <div className="flex items-center justify-between">
                    <span>{d.name}</span>
                    <span className={`text-[10px] px-1.5 py-0.5 rounded ${d.faction === 'enemy' ? 'bg-red-900 text-red-300' : 'bg-sky-900 text-sky-300'}`}>{d.faction}</span>
                  </div>
                  <div className="text-[10px] text-zinc-500">{d.nodes.length} primitives · {d.locomotion}</div>
                </button>
              ))}
            </div>
          </div>

          <div className="flex-1 flex flex-col min-w-0">
            <div className="flex gap-1 px-4 pt-3 border-b border-zinc-700">
              {PHASES.map((p) => (
                <button
                  key={p}
                  onClick={() => setPhase(p)}
                  className={`px-3 py-1.5 text-sm rounded-t ${phase === p ? 'bg-zinc-800 text-white' : 'text-zinc-400 hover:text-zinc-200'}`}
                >
                  {p}
                </button>
              ))}
            </div>
            <div className="flex-1 overflow-y-auto p-5">
              {selected ? <PhaseContent phase={phase} def={selected} /> : <div className="text-zinc-500">No NPC selected.</div>}
            </div>
          </div>
        </div>
      </div>
    </div>
  );
}

function PhaseContent({ phase, def }: { phase: Phase; def: EMSDefinition }): ReactElement {
  useSyncExternalStore(npcManager.subscribe, npcManager.getVersion);

  if (phase === 'Spawn') {
    const live = npcManager.getInstances().filter((i) => i.def.slug === def.slug).length;
    const total = npcManager.count();
    return (
      <div className="space-y-4 max-w-xl">
        <p className="text-sm text-zinc-400">
          Spawn a <b className="text-white">{def.name}</b> in front of you to test it live. In-world shortcut: press{' '}
          <kbd className="px-1 bg-zinc-700 rounded">@</kbd> then a number (1–{Math.min(9, npcManager.getDefinitions().length)}).
        </p>
        <div className="flex gap-2">
          <button onClick={() => spawnNpcInFrontOfPlayer(def.slug)} className="px-4 py-2 rounded bg-emerald-600 hover:bg-emerald-500 text-sm font-medium">Spawn {def.name}</button>
          <button onClick={() => npcManager.clearAll()} className="px-4 py-2 rounded bg-zinc-700 hover:bg-zinc-600 text-sm">Clear all ({total})</button>
        </div>
        <div className="text-xs text-zinc-500">Live now: {live} {def.name}(s) · {total} NPCs total.</div>
      </div>
    );
  }

  if (phase === 'Skeleton') {
    return (
      <div className="space-y-3">
        <p className="text-sm text-zinc-400">The electromagnetic skeleton: the primitive "nodes" and the bonds holding them. <span className="text-amber-400">Spring</span> bonds wobble/bounce/lag; rigid bonds stick fast.</p>
        <table className="text-sm w-full max-w-2xl">
          <thead className="text-zinc-500 text-xs"><tr><th className="text-left py-1">Node</th><th className="text-left">Parent</th><th className="text-left">Bond</th><th className="text-left">Spring (k / damp)</th></tr></thead>
          <tbody>
            {def.nodes.map((n) => (
              <tr key={n.id} className="border-t border-zinc-800">
                <td className="py-1">{n.id}</td>
                <td className="text-zinc-400">{n.parent ?? '— root'}</td>
                <td><span className={n.bond === 'spring' ? 'text-amber-400' : 'text-zinc-300'}>{n.bond}</span></td>
                <td className="text-zinc-400">{n.spring ? `${n.spring.stiffness} / ${n.spring.damping}` : '—'}</td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
    );
  }

  if (phase === 'Primitives') {
    return (
      <div className="space-y-3">
        <p className="text-sm text-zinc-400">The shapes + sizes bound onto the skeleton.</p>
        <table className="text-sm w-full max-w-2xl">
          <thead className="text-zinc-500 text-xs"><tr><th className="text-left py-1">Node</th><th className="text-left">Shape</th><th className="text-left">Size (x,y,z)</th><th className="text-left">Color</th></tr></thead>
          <tbody>
            {def.nodes.map((n) => (
              <tr key={n.id} className="border-t border-zinc-800">
                <td className="py-1">{n.id}</td>
                <td>{n.shape}</td>
                <td className="text-zinc-400">{n.size.join(', ')}</td>
                <td><span className="inline-flex items-center gap-1"><span className="w-3 h-3 rounded-sm inline-block" style={{ background: n.color }} />{n.color}</span></td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
    );
  }

  if (phase === 'Combat') {
    return (
      <div className="space-y-2 text-sm max-w-xl">
        <div>Health: <span className="text-white">{def.health}</span></div>
        <div>Damage per hit: <span className="text-white">{def.damagePerHit}</span></div>
        <div>Faction: <span className="text-white">{def.faction}</span></div>
        <p className="text-zinc-500 text-xs pt-2">Editing + armor + the combat-registry hookup land in the plug-and-play phase (so a new NPC appears in leaderboards/spawn rules automatically).</p>
      </div>
    );
  }

  if (phase === 'AI') {
    return <Placeholder title="AI — behavior tree" body={`The behavior-tree editor moves here as a phase. Current tree: ${def.behaviorTreeId ?? 'none (idle stub)'}. The shpider/shtickman AI we already unified runs on this same engine.`} />;
  }
  if (phase === 'Textures') {
    return <Placeholder title="Textures" body="Per-primitive atlas textures (the shombie/shroomer texture pipeline) plug in here; for now primitives use flat colors." />;
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
