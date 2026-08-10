// kaijuShoutLang — the army speaks the local language.
//
// Geoff: "take the 100 words of the soldiers and create a system to translate them all into any
// language... when we are in Dubai they can be speaking arabic if I want, or if in Paris it can be
// French, Tokyo will be Japanese. Or, each city can be a mix because multiple languages make sense,
// and I can define that in an admin panel."
//
// TRANSLATED, NOT CONVERTED. Every line here was rewritten for the language rather than run through
// a dictionary, because the source lines are almost entirely idiom — "SUCK IT UP, BUTTERCUP",
// "SEMPER FI", "PAIN IS WEAKNESS LEAVING THE BODY". Word-for-word those come out as nonsense in any
// of the four; what carries across is the BEAT, so each one is the thing a soldier of that army
// would actually shout at a three-hundred-metre monster. Unit names go with it: the US Marine Corps
// lines become the Emirati forces in Arabic, the Legion in French, the JSDF in Japanese.
//
// INDEX-ALIGNED. Entry 40 is the same shout in all five languages, so a soldier's chosen line
// survives him changing language and the whole set can be diffed against English at a glance.
//
// EACH LANGUAGE CARRIES ITS OWN TYPESETTING, which is the part that is easy to miss: Comic Sans has
// no Arabic, no Devanagari and no kana, so a language that only supplied words would render as a
// row of empty boxes. So a language is words PLUS the font stack that contains its script, PLUS
// which way it runs, PLUS where its lines may be broken — Japanese has no spaces, so a
// wrap-at-spaces routine would refuse to break a whole sentence and shrink it to nothing.

import { fxRand } from './kaijuRandom';
import { SHOUTS } from './kaijuShouts';
import { AR_SHOUTS } from './shouts/ar';
import { FR_SHOUTS } from './shouts/fr';
import { HI_SHOUTS } from './shouts/hi';
import { JA_SHOUTS } from './shouts/ja';

export type LangId = 'en' | 'ar' | 'hi' | 'fr' | 'ja';

export interface ShoutLanguage {
  id: LangId;
  /** English name, for the panel. */
  name: string;
  /** What the language calls itself. */
  native: string;
  /** Right to left. Arabic only, so far. */
  rtl: boolean;
  /**
   * Where a line may be broken.
   *
   * 'space' is the usual rule. 'char' is for Japanese, which has no spaces at all — the wrapper
   * would find no break point, decide the line does not fit at any size, and drop the whole shout to
   * the minimum font. Breaking between characters is also simply how Japanese is set.
   */
  wrap: 'space' | 'char';
  /**
   * A canvas font stack that actually CONTAINS this script.
   *
   * Not decoration. A browser asked for Comic Sans and given Arabic falls back per glyph, and what
   * it falls back to is undefined — on a machine without a matching face the result is tofu boxes.
   * Naming the real faces first, then a generic that every OS ships, is what makes the bubble
   * readable on a machine we have never seen.
   */
  font: string;
  lines: string[];
}

/** Informal, comic-book, and available on both Mac and Windows. The original stack. */
const LATIN_FONT = '"Comic Sans MS", "Chalkboard SE", "Comic Neue", cursive';

export const LANGUAGES: Record<LangId, ShoutLanguage> = {
  en: {
    id: 'en', name: 'English', native: 'English', rtl: false, wrap: 'space',
    font: LATIN_FONT, lines: SHOUTS,
  },
  ar: {
    id: 'ar', name: 'Arabic', native: 'العربية', rtl: true, wrap: 'space',
    // Geeza Pro ships with macOS, Tahoma with Windows, Noto with most Linux and Android.
    font: '"Noto Sans Arabic", "Geeza Pro", "Tahoma", "Arial", sans-serif',
    lines: AR_SHOUTS,
  },
  hi: {
    id: 'hi', name: 'Hindi', native: 'हिन्दी', rtl: false, wrap: 'space',
    font: '"Noto Sans Devanagari", "Kohinoor Devanagari", "Devanagari Sangam MN", "Mangal", sans-serif',
    lines: HI_SHOUTS,
  },
  fr: {
    id: 'fr', name: 'French', native: 'Français', rtl: false, wrap: 'space',
    // Latin script, so the comic face works and French keeps the same look as English.
    font: LATIN_FONT, lines: FR_SHOUTS,
  },
  ja: {
    id: 'ja', name: 'Japanese', native: '日本語', rtl: false, wrap: 'char',
    // Maru Gothic is the rounded one, which is as close to a comic face as Japanese gets.
    font: '"Hiragino Maru Gothic ProN", "Hiragino Sans", "Yu Gothic", "Meiryo", sans-serif',
    lines: JA_SHOUTS,
  },
};

export const LANG_IDS: LangId[] = ['en', 'ar', 'hi', 'fr', 'ja'];

/** Weights per language. Relative, not percentages — 3 and 1 means three quarters and one quarter. */
export type LangMix = Partial<Record<LangId, number>>;

/**
 * What each city sounds like by default.
 *
 * DUBAI IS A MIX BECAUSE DUBAI IS A MIX. Roughly nine in ten residents are expatriates, English is
 * the working language of most of the private sector, and Hindi and Urdu are spoken by the largest
 * single community in the country. An all-Arabic Dubai would be the wrong answer even though Arabic
 * is the official language, so the default here is what you would actually hear on a street in
 * Marina — Arabic and English roughly level, with a strong third of South Asian languages.
 *
 * Paris and Tokyo are seeded ready for the day those cities exist, mixed the same way: mostly the
 * local language, with the English an international emergency response would bring with it.
 */
export const DEFAULT_MIXES: Record<string, LangMix> = {
  Dubai: { ar: 4, en: 4, hi: 2 },
  Paris: { fr: 8, en: 2 },
  Tokyo: { ja: 8, en: 2 },
  Default: { en: 10 },
};

const STORE_KEY = 'kaiju.shoutMix.v1';

let site = 'Dubai';
let mix: LangMix = { ...DEFAULT_MIXES.Dubai };
const listeners = new Set<() => void>();
let version = 0;

function emit(): void { version++; for (const fn of listeners) fn(); }

/** Remember the admin's choice across reloads. Failure here is never fatal — it is a preference. */
function persist(): void {
  try {
    localStorage.setItem(STORE_KEY, JSON.stringify({ site, mix }));
  } catch { /* private browsing, quota, or no localStorage at all */ }
}

function restore(): void {
  try {
    const raw = localStorage.getItem(STORE_KEY);
    if (!raw) return;
    const saved = JSON.parse(raw) as { site?: string; mix?: LangMix };
    if (saved.site) site = saved.site;
    // Filtered rather than trusted: a stored language that no longer exists would otherwise be
    // drawn and produce empty bubbles.
    if (saved.mix) {
      const clean: LangMix = {};
      for (const id of LANG_IDS) {
        const w = saved.mix[id];
        if (typeof w === 'number' && w > 0) clean[id] = w;
      }
      if (Object.keys(clean).length) mix = clean;
    }
  } catch { /* corrupt entry: fall back to the default mix */ }
}
if (typeof localStorage !== 'undefined') restore();

export function subscribeShoutLang(fn: () => void): () => void {
  listeners.add(fn); return () => { listeners.delete(fn); };
}
export function shoutLangVersion(): number { return version; }

export function getShoutSite(): string { return site; }
export function getShoutMix(): LangMix { return mix; }

/**
 * Move to a city, taking its default mix — UNLESS the admin has already set one for this session.
 *
 * The distinction matters: arriving at Dubai should not silently undo a mix Geoff just dialled in
 * on the panel, but it also should not leave Tokyo speaking Arabic because that is where he was
 * last. So a site change adopts the new city's default only when the mix is still the previous
 * city's untouched default.
 */
export function setShoutSite(next: string, force = false): void {
  if (next === site && !force) return;
  const wasDefault = sameMix(mix, DEFAULT_MIXES[site] ?? DEFAULT_MIXES.Default);
  site = next;
  if (force || wasDefault) mix = { ...(DEFAULT_MIXES[next] ?? DEFAULT_MIXES.Default) };
  persist();
  emit();
}

function sameMix(a: LangMix, b: LangMix): boolean {
  for (const id of LANG_IDS) if ((a[id] ?? 0) !== (b[id] ?? 0)) return false;
  return true;
}

/** Set one language's share. Zero removes it. */
export function setLangWeight(id: LangId, weight: number): void {
  const w = Math.max(0, Math.round(weight));
  if (w === 0) delete mix[id]; else mix[id] = w;
  persist();
  emit();
}

/** Back to whatever this city's default is. */
export function resetShoutMix(): void {
  mix = { ...(DEFAULT_MIXES[site] ?? DEFAULT_MIXES.Default) };
  persist();
  emit();
}

/** Everything in one language, which is the common thing to want from the panel. */
export function setSingleLang(id: LangId): void {
  mix = { [id]: 10 };
  persist();
  emit();
}

/**
 * Draw a language for one soldier.
 *
 * Called ONCE, when he is created, and kept: a man who switches language between sentences reads as
 * a bug rather than as a multilingual city. Uses the cosmetic random stream, so an army that talks
 * cannot change which Kaiju wins.
 */
export function pickLang(): LangId {
  let total = 0;
  for (const id of LANG_IDS) total += mix[id] ?? 0;
  if (total <= 0) return 'en';
  let r = fxRand() * total;
  for (const id of LANG_IDS) {
    r -= mix[id] ?? 0;
    if (r < 0) return id;
  }
  return 'en';
}

/**
 * The actual words, for a language and a line number.
 *
 * Falls back to English per LINE rather than per language, so a half-finished translation shows the
 * lines it has and English for the rest instead of failing whole or showing a blank bubble.
 */
export function shoutLine(lang: LangId, index: number): string {
  const l = LANGUAGES[lang] ?? LANGUAGES.en;
  return l.lines[index] || SHOUTS[index] || '';
}

export function langOf(lang: LangId): ShoutLanguage {
  return LANGUAGES[lang] ?? LANGUAGES.en;
}

/** For the HUD: "Arabic 40% · English 40% · Hindi 20%". */
export function describeMix(): string {
  let total = 0;
  for (const id of LANG_IDS) total += mix[id] ?? 0;
  if (total <= 0) return 'silent';
  return LANG_IDS
    .filter((id) => (mix[id] ?? 0) > 0)
    .map((id) => `${LANGUAGES[id].name} ${Math.round(((mix[id] ?? 0) / total) * 100)}%`)
    .join(' · ');
}
