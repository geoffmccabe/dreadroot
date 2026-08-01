// kaijuClips — pick the right animation clip on a model whose clips we did not name.
//
// WHY THIS EXISTS
// ---------------
// Both Kaiju renderers matched clip names with `names.find(n => n.toLowerCase() === want)` — EXACT
// equality — over a hand-written list, and fell back to `names[0]` when nothing matched.
//
// The Red Demon's clips are Mixamo exports:
//
//   "Armature|Armature|Armature|mixamo.com|Layer0"   1.60s   <- names[0]
//   "crawl"                                          0.00s
//   "Idle"                                           1.60s
//   "Standing Melee Attack Horizontal"               1.93s   <- the actual attack
//   "Two Handed Sword Death"                         2.10s
//   "Walking"                                        1.13s
//   "Zombie Reaction Hit"                            1.73s
//
// A comment in KaijuArenaScene claimed "the Red Demon's [attack clip] is 'attack'". It is not, and
// nothing checked. So every attack fell through to names[0] — the Mixamo composite — which is what
// Geoff saw as "instead of doing its slow motion swipe attack, it's just twitching really fast".
//
// THE RULES HERE
//   * match on NORMALISED names, so "Standing Melee Attack Horizontal" is found by "attack"
//   * prefer a whole-word hit over a substring, so "hit" does not win over "Zombie Reaction Hit"
//     when something better exists
//   * NEVER fall back to names[0]: a Mixamo "Armature|...|Layer0" track is a container, not a pose
//   * NEVER return a zero-length clip (reddemon's "crawl" is 0.00s) — playing one leaves the model
//     frozen, or divides by zero when a playback rate is computed from its duration

/** Lower-case, strip anything that is not a letter or digit, so separators cannot matter. */
const norm = (s: string): string => s.toLowerCase().replace(/[^a-z0-9]+/g, ' ').trim();

/**
 * A clip name that is a container rather than an animation.
 *
 * Mixamo and some Blender exporters emit a track named after the armature holding the whole take.
 * It is the first clip in the file, so it is exactly what a `names[0]` fallback lands on, and it
 * looks like violent twitching when played as a pose.
 */
export function isContainerClip(name: string): boolean {
  const n = name.toLowerCase();
  return n.includes('armature|') || n.includes('mixamo.com') || n.includes('|layer');
}

export interface ClipInfo {
  name: string;
  /** Seconds. Used to reject degenerate clips and to time a swing against the real animation. */
  duration: number;
}

/**
 * Find the best clip for a set of wanted keywords.
 *
 * Keywords are tried in order, and for each one a whole-word match beats a substring match, so
 * `['swipe', 'attack']` prefers a clip actually called "swipe" over "Standing Melee Attack
 * Horizontal", but still finds the latter when no model has the former.
 *
 * Returns null when nothing sensible matches — deliberately, so the caller keeps whatever it is
 * already playing instead of switching to something arbitrary.
 */
export function pickClip(clips: ClipInfo[], wanted: string[]): string | null {
  const usable = clips.filter(c => c.duration > 0.02 && !isContainerClip(c.name));
  if (usable.length === 0) return null;

  for (const want of wanted) {
    const w = norm(want);
    if (!w) continue;
    // Whole word first.
    const exact = usable.find(c => norm(c.name).split(' ').includes(w));
    if (exact) return exact.name;
    // Then anywhere in the name.
    const partial = usable.find(c => norm(c.name).includes(w));
    if (partial) return partial.name;
  }
  return null;
}

/**
 * The keyword lists, shared by both renderers so they cannot drift apart.
 *
 * Ordered most-specific first. 'hit' sits last in `attack` because plenty of models have a
 * flinch clip called "hit" that would otherwise beat a real attack animation.
 */
export const CLIP_WANTS: Record<string, string[]> = {
  walk:   ['walk', 'walking'],
  run:    ['run', 'running', 'jog', 'walk', 'walking'],
  idle:   ['breathidle', 'idle', 'breath'],
  attack: ['swipe', 'attack', 'melee', 'punch', 'strike', 'jumpattack'],
  dead:   ['death', 'die', 'dead', 'topple'],
  glide:  ['flex', 'jumpattack', 'fall', 'idle'],
  land:   ['stand_to_crouch', 'crouch', 'land', 'hit', 'idle'],
  swim:   ['swim', 'flex', 'crawl', 'idle'],
};

/**
 * Resolve a gait to a clip name on THIS model, falling back down a chain of gaits.
 *
 * `fallbacks` lets a missing attack clip degrade to idle rather than to nothing, without any gait
 * ever landing on the container track.
 */
export function resolveGait(
  clips: ClipInfo[], gait: string, fallbacks: string[] = ['idle', 'walk'],
): string | null {
  const direct = pickClip(clips, CLIP_WANTS[gait] ?? [gait]);
  if (direct) return direct;
  for (const f of fallbacks) {
    const alt = pickClip(clips, CLIP_WANTS[f] ?? [f]);
    if (alt) return alt;
  }
  // Last resort: the longest usable clip. Still never the container track.
  const usable = clips.filter(c => c.duration > 0.02 && !isContainerClip(c.name));
  return usable.sort((a, b) => b.duration - a.duration)[0]?.name ?? null;
}
