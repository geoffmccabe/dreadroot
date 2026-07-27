// KaijuCommandPanel — tell your Kaiju what to do, by typing or by speaking.
//
// The whole point is that this is NOT a control pad. You say what you want; the Kaiju decides
// whether it agrees, and tells you. Its answer is the most important thing on the panel, which is
// why the reply line sits directly under the box and is coloured by whether it complied.
//
// VOICE goes through the browser's own speech recognition, which needs no key, no server and no
// account, and covers a long list of languages. It is deliberately the FIRST implementation rather
// than the best one: everything downstream takes text, so swapping in a faster hosted recogniser
// later changes this file and nothing else. See docs/KAIJU_VOICE.md for the comparison.
//
// Push-to-talk, not always-listening: better accuracy on short shouted commands, and nobody wants
// a hot microphone in a game.

import { useEffect, useRef, useState, useSyncExternalStore } from 'react';
import { useDraggablePanel } from '../useDraggablePanel';
import {
  commandKaiju, playerOrderState, arenaStarted, subscribeArena, arenaVersion, getAgents,
} from './kaijuArena';
import { ORDER_ACTION } from './kaijuOrders';
import { flashIntensity } from './kaijuFlash';

/** Minimal typing for the browser speech API, which TypeScript's DOM lib still does not ship. */
interface SpeechRecognitionLike {
  lang: string;
  continuous: boolean;
  interimResults: boolean;
  maxAlternatives: number;
  start(): void;
  stop(): void;
  onresult: ((e: { results: { [i: number]: { [j: number]: { transcript: string } } }; resultIndex: number }) => void) | null;
  onerror: ((e: { error: string }) => void) | null;
  onend: (() => void) | null;
}

function makeRecogniser(lang: string): SpeechRecognitionLike | null {
  const w = window as unknown as {
    SpeechRecognition?: new () => SpeechRecognitionLike;
    webkitSpeechRecognition?: new () => SpeechRecognitionLike;
  };
  const Ctor = w.SpeechRecognition ?? w.webkitSpeechRecognition;
  if (!Ctor) return null;
  const r = new Ctor();
  r.lang = lang;
  r.continuous = false;
  r.interimResults = false;
  r.maxAlternatives = 1;
  return r;
}

/** A few languages up front; the recogniser itself supports far more. */
const LANGS: [string, string][] = [
  ['en-US', 'English'], ['es-ES', 'Español'], ['fr-FR', 'Français'], ['de-DE', 'Deutsch'],
  ['pt-BR', 'Português'], ['ja-JP', '日本語'], ['ko-KR', '한국어'], ['zh-CN', '中文'],
];

/** Things worth trying, shown when the box is empty. */
const SUGGESTIONS = ['attack it', 'back off', 'take cover', 'hold', 'follow me', 'do what you want'];

/**
 * Starting x for a panel docked to the RIGHT edge.
 *
 * The Kaiju panels used to open on the left, where they formed a second column on top of the
 * game's own HUD and covered the view. They are still draggable; this only changes where they
 * start. Falls back to a sane left position if there is no window (SSR) or the screen is narrow.
 */
function rightEdge(width: number, margin = 16): number {
  if (typeof window === 'undefined') return margin;
  return Math.max(margin, window.innerWidth - width - margin);
}

export function KaijuCommandPanel() {
  const { pos, handleProps } = useDraggablePanel({ left: rightEdge(320), top: 90 });
  useSyncExternalStore(subscribeArena, arenaVersion, arenaVersion);
  const [text, setText] = useState('');
  const [lang, setLang] = useState('en-US');
  const [listening, setListening] = useState(false);
  const [note, setNote] = useState('');
  const [, tick] = useState(0);
  const rec = useRef<SpeechRecognitionLike | null>(null);
  const voiceSupported = useRef<boolean>(false);

  useEffect(() => { voiceSupported.current = makeRecogniser('en-US') != null; }, []);
  // 20 Hz, not 5 Hz. The acknowledgement is three pulses inside one second, so sampling it five
  // times would render it as a couple of arbitrary brightness steps rather than as three flashes —
  // the signal would be there and unreadable. A small panel at 20 Hz costs nothing next to the
  // scene, and it is still far below frame rate.
  useEffect(() => {
    const id = setInterval(() => tick((n) => n + 1), 50);
    return () => clearInterval(id);
  }, []);

  const send = (raw: string) => {
    const t = raw.trim();
    if (!t) return;
    const r = commandKaiju(t);
    if (r.understood) {
      setNote('');
      setText('');
    } else {
      // The grammar drew a blank. This is where the language model would take over — see
      // orderPrompt() in kaijuOrders.ts and the gateway at ai.divi.love. Until that is wired up,
      // say so plainly rather than silently doing nothing.
      setNote(`It did not understand "${t}". Try: ${SUGGESTIONS.slice(0, 3).join(', ')}.`);
    }
  };

  const talk = () => {
    if (listening) { rec.current?.stop(); return; }
    const r = makeRecogniser(lang);
    if (!r) { setNote('This browser has no speech recognition. Typing works.'); return; }
    rec.current = r;
    r.onresult = (e) => {
      const said = e.results[e.resultIndex]?.[0]?.transcript ?? '';
      if (said) send(said);
    };
    r.onerror = (e) => {
      setNote(e.error === 'not-allowed'
        ? 'Microphone permission was refused.'
        : `Speech recognition problem: ${e.error}`);
      setListening(false);
    };
    r.onend = () => setListening(false);
    try { r.start(); setListening(true); setNote(''); }
    catch { setNote('Could not start the microphone.'); }
  };

  if (!arenaStarted()) return null;
  const { order, label, flash, refusing, refusalNote } = playerOrderState();
  const me = getAgents().find((a) => a.isPlayer);
  // Same three-pulses-in-one-second curve the Kaiju itself uses, so the word on the panel and the
  // creature in the world flash together rather than as two unrelated effects.
  const pulse = flashIntensity(flash);

  const btn: React.CSSProperties = {
    background: 'rgba(255,255,255,0.10)', border: '1px solid rgba(255,255,255,0.25)',
    color: 'inherit', borderRadius: 4, padding: '3px 9px', cursor: 'pointer', font: 'inherit',
  };

  return (
    <div
      style={{
        position: 'fixed', left: pos.left, top: pos.top, width: 320,
        color: 'var(--pt-debug-body-color)', font: 'var(--pt-debug-body-size) var(--pt-debug-body-family)',
        background: 'var(--pt-debug-bg)', border: 'var(--pt-debug-border-w) solid var(--pt-debug-border)',
        borderRadius: 'var(--pt-debug-radius)', padding: '8px 10px', pointerEvents: 'auto',
        boxShadow: '0 2px 10px rgba(0,0,0,0.5)', zIndex: 42,
      }}
    >
      <div {...handleProps} style={{ ...handleProps.style, marginBottom: 6 }}>
        <strong>Tell your Kaiju</strong>
        {me && <span style={{ opacity: 0.6 }}> · obedience {me.build.obedience}</span>}
      </div>

      <div style={{ display: 'flex', gap: 5 }}>
        <input
          value={text}
          onChange={(e) => setText(e.target.value)}
          onKeyDown={(e) => {
            // Stop the game's movement keys firing while typing, or "attack" walks you into a wall.
            e.stopPropagation();
            if (e.key === 'Enter') send(text);
          }}
          placeholder={SUGGESTIONS[0]}
          style={{
            flex: 1, background: 'rgba(0,0,0,0.35)', border: '1px solid rgba(255,255,255,0.20)',
            borderRadius: 4, color: 'inherit', font: 'inherit', padding: '3px 6px', minWidth: 0,
          }}
        />
        <button style={{ ...btn, background: listening ? 'rgba(224,90,74,0.45)' : btn.background }}
                onClick={talk} title="Hold a conversation with it out loud">
          {listening ? '● listening' : '🎤'}
        </button>
      </div>

      <div style={{ display: 'flex', gap: 5, marginTop: 5, alignItems: 'center' }}>
        <select
          value={lang}
          onChange={(e) => setLang(e.target.value)}
          onKeyDown={(e) => e.stopPropagation()}
          style={{
            background: 'rgba(0,0,0,0.35)', border: '1px solid rgba(255,255,255,0.20)',
            borderRadius: 4, color: 'inherit', font: 'inherit', padding: '2px 4px',
          }}
        >
          {LANGS.map(([code, name]) => <option key={code} value={code}>{name}</option>)}
        </select>
        <span style={{ opacity: 0.55, fontSize: '0.88em' }}>
          {order ? `told to: ${order.type}` : 'no orders — its own judgement'}
        </span>
      </div>

      {/* THE PARSED COMMAND, in words, flashing.
          This is the confirmation that matters. Not "did the creature reply" — it is a monster and
          it does not talk — but "did my words become a specific command the system knows". Seeing
          the right word appear is the whole answer, and seeing the WRONG word appear is far more
          useful than a generic acknowledgement would have been. Pulses in step with the Kaiju's
          own flash, so the panel and the creature are visibly saying the same thing. */}
      {label && (
        <div style={{
          marginTop: 7, padding: '7px 9px', borderRadius: 5, textAlign: 'center',
          background: `rgba(110,170,255,${0.10 + 0.42 * pulse})`,
          border: `1px solid rgba(140,190,255,${0.30 + 0.60 * pulse})`,
          transition: 'none',
        }}>
          <div style={{
            fontSize: '1.45em', fontWeight: 700, letterSpacing: '0.09em', lineHeight: 1.15,
            color: `rgb(${210 + 45 * pulse}, ${228 + 27 * pulse}, 255)`,
          }}>
            {label}
          </div>
          {/* Whether it is actually doing it — a state, not a sentence. */}
          <div style={{ fontSize: '0.86em', opacity: 0.8, marginTop: 2 }}>
            {refusing ? `refusing — ${refusalNote}` : 'carrying it out'}
          </div>
        </div>
      )}

      {note && <div style={{ marginTop: 5, opacity: 0.75, fontSize: '0.9em' }}>{note}</div>}

      {!text && (
        <div style={{ marginTop: 6, display: 'flex', flexWrap: 'wrap', gap: 4 }}>
          {SUGGESTIONS.map((s) => (
            <button key={s} style={{ ...btn, padding: '1px 6px', fontSize: '0.88em', opacity: 0.8 }}
                    onClick={() => send(s)}>{s}</button>
          ))}
        </div>
      )}
    </div>
  );
}

/** Exported for the tracker, so both panels agree on what each order is asking for. */
export { ORDER_ACTION };
