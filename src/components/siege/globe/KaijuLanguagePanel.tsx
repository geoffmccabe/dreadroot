// KaijuLanguagePanel — decide what the army sounds like.
//
// Geoff: "each city can be a mix because multiple languages make sense, and I can define that in an
// admin panel."
//
// WEIGHTS, NOT PERCENTAGES. A percentage box that has to add up to a hundred is a box that fights
// you: nudge one and every other one has to be corrected before the numbers are legal again. Shares
// have no such rule — set Arabic to 4 and English to 4 and they split evenly; set English to 8 and
// it takes two thirds. The percentage is shown next to each slider so the effect is still readable,
// but nothing has to be balanced by hand.
//
// The change is LIVE for men created after it, and existing soldiers keep the language they were
// born with. Press Respawn (or leave and come back to the city) to re-roll the whole crowd — which
// is also why the panel says so rather than leaving Geoff wondering why the field did not change.
//
// The choice is remembered across reloads, per the store in kaijuShoutLang.

import { useEffect, useMemo, useState } from 'react';
import { useDraggablePanel } from '../useDraggablePanel';
import { panelLeft, panelStyle, PANEL_W, TALK_TOP } from './kaijuPanelLayout';
import {
  LANGUAGES, LANG_IDS, DEFAULT_MIXES,
  getShoutMix, getShoutSite, setLangWeight, resetShoutMix, setSingleLang,
  subscribeShoutLang, shoutLine, type LangId,
} from './kaijuShoutLang';
import { setCrowd, isCrowdOn } from './KaijuCrowd';

/** A colour per language, so the bars are tellable apart at a glance. */
const LANG_COLOUR: Record<LangId, string> = {
  en: '#6fa8ff',
  ar: '#5fd35f',
  hi: '#e0c04a',
  fr: '#c77dff',
  ja: '#e05a4a',
};

export function KaijuLanguagePanel({ onClose }: { onClose?: () => void }) {
  const { pos, handleProps } = useDraggablePanel({
    // Opens above the rest of the column: it is set once and then left alone, unlike the tracker.
    left: panelLeft(),
    top: Math.max(16, TALK_TOP - 250),
  });

  // The store is a module singleton shared with the simulation, so the panel subscribes rather than
  // owning the state. Anything else and the crowd and the panel would disagree the moment the mix
  // was changed from somewhere that is not this component.
  const [, bump] = useState(0);
  useEffect(() => subscribeShoutLang(() => bump((n) => n + 1)), []);

  const mix = getShoutMix();
  const site = getShoutSite();
  const total = useMemo(
    () => LANG_IDS.reduce((sum, id) => sum + (mix[id] ?? 0), 0),
    // Recomputed on every render on purpose: `mix` is a mutable singleton, so a dependency on it
    // would compare equal after a change and never update.
    // eslint-disable-next-line react-hooks/exhaustive-deps
    [],
  );

  /** A sample line, so the effect of a font or a script problem is visible IN THE PANEL. */
  const sample = (id: LangId): string => shoutLine(id, 0);

  return (
    <div style={panelStyle(pos.left, pos.top, 46, '70vh')}>
      <div {...handleProps} style={{ ...handleProps.style, display: 'flex', justifyContent: 'space-between', alignItems: 'baseline', marginBottom: 6 }}>
        <strong>Soldier languages</strong>
        <span style={{ opacity: 0.6, fontSize: '0.85em' }}>{site}</span>
      </div>

      <div style={{ opacity: 0.72, fontSize: '0.88em', marginBottom: 8, lineHeight: 1.35 }}>
        Shares of the crowd. Each soldier picks one when he spawns and keeps it, so changes apply to
        the <em>next</em> crowd — press Respawn below to see them now.
      </div>

      {/* One stacked bar showing the whole mix, which answers "what does this city sound like"
          faster than five numbers do. */}
      <div style={{ display: 'flex', height: 8, borderRadius: 4, overflow: 'hidden', marginBottom: 10, background: 'rgba(255,255,255,0.10)' }}>
        {LANG_IDS.filter((id) => (mix[id] ?? 0) > 0).map((id) => (
          <div key={id} style={{ flex: mix[id] ?? 0, background: LANG_COLOUR[id] }} title={LANGUAGES[id].name} />
        ))}
      </div>

      {LANG_IDS.map((id) => {
        const w = mix[id] ?? 0;
        const pct = total > 0 ? Math.round((w / total) * 100) : 0;
        return (
          <div key={id} style={{ marginBottom: 9 }}>
            <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'baseline' }}>
              <span>
                <span style={{ color: LANG_COLOUR[id] }}>■</span>{' '}
                {LANGUAGES[id].name}
                <span style={{ opacity: 0.55 }}> · {LANGUAGES[id].native}</span>
              </span>
              <span style={{ opacity: w > 0 ? 0.85 : 0.35, minWidth: 38, textAlign: 'right' }}>
                {w > 0 ? `${pct}%` : 'off'}
              </span>
            </div>
            <input
              type="range" min={0} max={10} step={1} value={w}
              onChange={(e) => setLangWeight(id, Number(e.target.value))}
              style={{ width: '100%', accentColor: LANG_COLOUR[id] }}
            />
            {/* The line as it will actually be DRAWN — same font stack, same direction. If a machine
                is missing a script this shows boxes here, in the panel, instead of the first time a
                soldier opens his mouth half a mile away. */}
            <div
              dir={LANGUAGES[id].rtl ? 'rtl' : 'ltr'}
              style={{
                font: `13px ${LANGUAGES[id].font}`,
                opacity: w > 0 ? 0.8 : 0.35,
                whiteSpace: 'nowrap', overflow: 'hidden', textOverflow: 'ellipsis',
                marginTop: 1,
              }}
            >
              {sample(id)}
            </div>
          </div>
        );
      })}

      <div style={{ display: 'flex', gap: 6, flexWrap: 'wrap', marginTop: 4 }}>
        <button type="button" onClick={() => resetShoutMix()} style={btn}>
          {site} default
        </button>
        <button type="button" onClick={() => setSingleLang('en')} style={btn}>All English</button>
        <button
          type="button"
          onClick={() => { if (isCrowdOn()) setCrowd(true); }}
          style={{ ...btn, borderColor: 'rgba(120,200,120,0.5)' }}
        >
          Respawn crowd
        </button>
        {onClose && <button type="button" onClick={onClose} style={btn}>Close</button>}
      </div>

      <div style={{ opacity: 0.5, fontSize: '0.82em', marginTop: 8, lineHeight: 1.35 }}>
        Cities start from their own default mix ({Object.keys(DEFAULT_MIXES).filter((k) => k !== 'Default').join(', ')}).
        Adding a language is one run of <code>npm run translate:shouts</code>.
      </div>
    </div>
  );
}

const btn: React.CSSProperties = {
  font: 'inherit', color: 'inherit', background: 'rgba(255,255,255,0.08)',
  border: '1px solid rgba(255,255,255,0.22)', borderRadius: 4,
  padding: '3px 8px', cursor: 'pointer',
};

export { PANEL_W };
