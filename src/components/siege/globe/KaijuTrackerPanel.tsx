// KaijuTrackerPanel — watch the Kaiju think.
//
// The whole point of a utility AI is that its decisions are made of numbers you can read. This
// shows those numbers live: what each Kaiju can see, what it scored every option at, what it
// chose and why, and what has happened to it. The copy button dumps the same thing as plain text
// so it can be pasted straight back to us for analysis.
//
// Deliberately NOT a pretty combat HUD. It is a diagnostic, and the value is in showing the
// losing options' scores too, since "why did it not do X" is usually the question.

import { useEffect, useState, useSyncExternalStore } from 'react';
import { useDraggablePanel } from '../useDraggablePanel';
import {
  getAgents, getEvents, arenaClock, arenaStarted, arenaReport, resetArena,
  subscribeArena, arenaVersion, type Agent,
} from './kaijuArena';
import { WEAPONS } from './kaijuWeapons';
import { KaijuMiniMap } from './KaijuMiniMap';
import { panelLeft, panelStyle, kaijuColour, TRACKER_TOP } from './kaijuPanelLayout';

/** Plain words for each action, so the panel reads like a sentence rather than an enum. */
const ACTION_WORDS: Record<string, string> = {
  engage: 'closing in to attack',
  ranged: 'holding range and shooting',
  flee: 'running away',
  takeCover: 'getting behind cover',
  circle: 'circling, looking for an opening',
  explore: 'wandering, nothing to fight',
};

/** Plain words for each consideration, since the raw names are internal. */
const CONSIDERATION_WORDS: Record<string, string> = {
  healthFrac: 'how hurt it is',
  hurtEnough: 'hurt enough to matter',
  powerRatio: 'how outgunned it is here',
  powerIfClosed: 'how it would do up close',
  threatCount: 'how many enemies are near',
  distBodies: 'how far the enemy is',
  coverNearby: 'is there cover',
  weaponRange: 'does its weapon reach',
  hasTarget: 'is there anything to fight',
};

function bar(frac: number, colour: string) {
  return (
    <div style={{ height: 5, background: 'rgba(255,255,255,0.13)', borderRadius: 3, overflow: 'hidden' }}>
      <div style={{ width: `${Math.max(0, Math.min(1, frac)) * 100}%`, height: '100%', background: colour }} />
    </div>
  );
}

function AgentBlock({ a }: { a: Agent }) {
  const p = a.perception;
  // Health is per-build (Vigour decides it), so never divide by a shared constant.
  const hp = a.health / Math.max(1, a.maxHealth);
  const hpColour = hp > 0.5 ? '#5fd35f' : hp > 0.2 ? '#e0c04a' : '#e05a4a';

  return (
    <div style={{ marginBottom: 10, paddingBottom: 8, borderBottom: '1px solid rgba(255,255,255,0.10)' }}>
      <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'baseline' }}>
        <strong style={{ opacity: a.alive ? 1 : 0.45 }}>
          {a.name}{a.isPlayer ? ' (you)' : ''}
        </strong>
        <span style={{ opacity: 0.7, fontSize: '0.9em' }}>{WEAPONS[a.weapon].name}</span>
      </div>

      {bar(hp, hpColour)}
      <div style={{ display: 'flex', justifyContent: 'space-between', opacity: 0.75, fontSize: '0.9em' }}>
        <span>{a.alive ? `${Math.round(a.health)} / ${Math.round(a.maxHealth)} health` : `killed by ${a.killedBy ?? '?'}`}</span>
        <span>{Math.round(a.damageDealt)} dealt</span>
      </div>

      {a.alive && (
        <>
          <div style={{ marginTop: 4 }}>
            It is <strong>{ACTION_WORDS[a.action ?? 'explore'] ?? a.action}</strong>
          </div>
          {p && (
            <div style={{ opacity: 0.78, fontSize: '0.92em', marginTop: 2 }}>
              Sees {p.targetId ? 'an enemy' : 'nobody'}
              {p.targetId && <> {p.targetDistBodies.toFixed(1)} body-lengths away
                {' '}({Math.round(p.targetDistBodies * 300)} m)</>}.
              {' '}It reckons the enemy is{' '}
              {p.powerRatio > 1.3 ? 'stronger' : p.powerRatio < 0.77 ? 'weaker' : 'evenly matched'}
              {' '}at this range
              {p.powerRatioClosed < 0.77 && p.powerRatio > 1.3 ? ', but weaker up close' : ''}.
              {p.coverNearby ? ' There is cover nearby.' : ''}
              {a.shotsFired > 0 && <> Fired {a.shotsFired}, connected {a.hitsLanded}.</>}
            </div>
          )}

          <div style={{ marginTop: 5, opacity: 0.9 }}>Options it weighed:</div>
          {a.scores.map((s) => (
            <div key={s.action} style={{ display: 'flex', gap: 6, alignItems: 'center', fontSize: '0.9em' }}>
              <span style={{ width: 74, opacity: s.action === a.action ? 1 : 0.6 }}>
                {s.action === a.action ? '▸ ' : ''}{s.action}
              </span>
              <span style={{ flex: 1 }}>{bar(s.score, s.action === a.action ? '#6fa8ff' : 'rgba(255,255,255,0.35)')}</span>
              <span style={{ width: 30, textAlign: 'right', opacity: 0.7 }}>{s.score.toFixed(2)}</span>
            </div>
          ))}
          {/* The winning option's reasoning, spelled out. */}
          {a.scores[0] && (
            <div style={{ opacity: 0.7, fontSize: '0.88em', marginTop: 3 }}>
              {a.scores.find((s) => s.action === a.action)?.considerations
                .map((c) => `${CONSIDERATION_WORDS[c.name] ?? c.name}: ${c.score.toFixed(2)}`)
                .join(' · ')}
            </div>
          )}
        </>
      )}
    </div>
  );
}

export function KaijuTrackerPanel() {
  const { pos, handleProps } = useDraggablePanel({ left: panelLeft(), top: TRACKER_TOP });
  const [, tick] = useState(0);
  const [copied, setCopied] = useState(false);
  const [open, setOpen] = useState(true);
  /**
   * WHICH KAIJU'S STATS TO SHOW. Geoff: "make it half the size vertically and tabs to select the
   * Kaiju's stats to show."
   *
   * Four full read-outs stacked was most of the panel's height, and three quarters of it was about
   * creatures you were not watching. Held as an ID rather than an index so restarting the fight —
   * which rebuilds the agent array — cannot leave the tab pointing at a different creature than the
   * one it names.
   */
  const [tab, setTab] = useState<string | null>(null);

  // Appear the instant a battle starts, then repaint a few times a second. The simulation runs at
  // frame rate; re-rendering this panel that often would cost more than the fight does.
  useSyncExternalStore(subscribeArena, arenaVersion, arenaVersion);
  useEffect(() => {
    const id = setInterval(() => tick((n) => n + 1), 250);
    return () => clearInterval(id);
  }, []);

  if (!arenaStarted()) return null;
  const agents = getAgents();
  const events = getEvents();
  // Defaults to YOU, which is the one you want nine times out of ten, and falls back to the first
  // if the selected Kaiju is gone (a restart, or a different roster).
  const selected = agents.find((a) => a.id === tab) ?? agents.find((a) => a.isPlayer) ?? agents[0];

  const copy = () => {
    const text = arenaReport();
    navigator.clipboard?.writeText(text).then(
      () => { setCopied(true); setTimeout(() => setCopied(false), 1600); },
      () => {
        // Clipboard can be blocked; fall back to a selectable prompt rather than failing silently.
        window.prompt('Copy the tracker report:', text);
      },
    );
  };

  const btn: React.CSSProperties = {
    background: 'rgba(255,255,255,0.10)', border: '1px solid rgba(255,255,255,0.25)',
    color: 'inherit', borderRadius: 4, padding: '2px 8px', cursor: 'pointer', font: 'inherit',
  };

  return (
    <div
      // HALF the vertical size, as asked: 75vh became 37vh. That is affordable only because the
      // tabs above show one Kaiju instead of four — halving the box without halving the contents
      // would just have made it a scrollbar.
      style={panelStyle(pos.left, pos.top, 41, '37vh')}
    >
      <div {...handleProps} style={{ ...handleProps.style, display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: 6 }}>
        <strong>Kaiju tracker · {arenaClock().toFixed(0)}s</strong>
        <span style={{ display: 'flex', gap: 5 }}>
          <button style={btn} onClick={() => setOpen((o) => !o)}>{open ? '–' : '+'}</button>
          <button style={btn} onClick={copy}>{copied ? 'copied' : 'copy'}</button>
          <button style={btn} onClick={() => resetArena(17)}>restart</button>
        </span>
      </div>

      {open && (
        <>
          {/* Three kilometres by two, looking down, centred on you. */}
          <KaijuMiniMap agents={agents} selectedId={selected?.id ?? null} />

          {/* One tab per Kaiju, coloured to match its dot on the map above — which is the only
              thing that makes the dots readable without a legend. */}
          <div style={{ display: 'flex', gap: 3, marginBottom: 6, flexWrap: 'wrap' }}>
            {agents.map((a, i) => {
              const on = a.id === selected?.id;
              return (
                <button
                  key={a.id}
                  onClick={() => setTab(a.id)}
                  style={{
                    flex: 1, minWidth: 62, cursor: 'pointer', font: 'inherit',
                    fontSize: '0.86em', padding: '2px 4px', borderRadius: 4,
                    color: 'inherit', opacity: a.alive ? 1 : 0.45,
                    background: on ? 'rgba(255,255,255,0.16)' : 'rgba(255,255,255,0.05)',
                    // The colour lives in the BOTTOM border rather than the text, so a dead Kaiju
                    // greying out does not also lose the thing that identifies it.
                    border: '1px solid rgba(255,255,255,0.18)',
                    borderBottom: `2px solid ${kaijuColour(i)}`,
                  }}
                >
                  {a.name}{a.isPlayer ? '*' : ''}
                </button>
              );
            })}
          </div>

          {selected && <AgentBlock a={selected} />}

          <div style={{ opacity: 0.85, marginBottom: 3 }}>What has happened</div>
          <div style={{ opacity: 0.72, fontSize: '0.9em', maxHeight: 90, overflowY: 'auto' }}>
            {events.slice(-14).reverse().map((e, i) => (
              <div key={`${e.t}-${i}`}>{e.t.toFixed(1)}s · {e.text}</div>
            ))}
          </div>
        </>
      )}
    </div>
  );
}
