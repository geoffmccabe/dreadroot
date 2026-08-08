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
  if (n.includes('mixamo.com') || n.includes('|layer')) return true;
  // WHAT COMES AFTER THE LAST BAR IS THE ANIMATION'S REAL NAME.
  //
  // This used to reject anything containing "armature|" outright, which was right for Mixamo's
  // "Armature|Armature|Armature|mixamo.com|Layer0" and catastrophically wrong for the Quaternius
  // packs, where EVERY clip is named "CharacterArmature|Run", "CharacterArmature|Walk" and so on.
  // On that convention the old test threw away the entire animation list and left the model frozen
  // in its bind pose, with no error anywhere — caught by check-kaiju-clips before it ever shipped,
  // which is the only reason the soldiers are not standing rigid right now.
  const tail = n.slice(n.lastIndexOf('|') + 1).trim();
  return tail.length === 0;
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
  // 'idle' BEFORE 'breathidle', and that order is measured rather than a matter of taste.
  //
  // Geoff: "It looks fine until it starts to walk, then the hips swivel in a weird way... the hips
  // swivel around 45-60 degrees just as it starts to walk."
  //
  // The golems' clips do not all live in the same pose space. Averaged over each clip, here is how
  // far the leg bones sit from their rest pose on the Fort Golem:
  //
  //                    idle     walk      run   breathidle
  //     Thigh_L       124.9    141.4    141.4      42.9
  //     Foot_L        162.4    170.0    168.5      18.4
  //
  // idle, walk and run agree with each other. breathidle is somewhere else entirely — a hundred
  // degrees away at the thigh. These monsters had their animation sets retargeted from more than one
  // source rig, and breathidle plainly did not come from the same one as the walk.
  //
  // The renderer stands still on the idle clip and moves on the walk clip, so with breathidle chosen
  // first EVERY transition from standing to walking crossed about a hundred degrees of hip and thigh
  // rotation in a quarter-second blend. That is the swivel — and it is why standing looks correct
  // and the first step does not.
  //
  // Preferring 'idle' keeps standing and walking in one pose space, so the blend between them is a
  // few degrees instead of a hundred. Models that only ship breathidle are unaffected: it is still
  // in the list, just second.
  idle:   ['idle', 'breathidle', 'breath'],
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

/**
 * Remove baked-in root translation from a clip, so the game's physics owns where the body IS.
 *
 * Mixamo exports carry locomotion in the hips. Measured on the models here:
 *
 *   reddemon "Two Handed Sword Death"    75.0 units of hip travel
 *   reddemon "Standing Melee Attack..."  20.3
 *   fortgolem "jumpattack"              198.1
 *
 * At the scale these are drawn, that is hundreds of metres of the model sliding away from its own
 * collider — and on a death clip, which clamps on its last frame, it simply stops there. That is
 * Geoff's "their bodies float up in the air instead of falling onto the terrain".
 *
 * Only the ROOT-most animated position track is dropped. Everything else — the actual animation —
 * is untouched, so the pose still plays; it just plays in place, where the body says it is.
 *
 * Deliberately NOT applied to walk and run: their hip travel measures 0.04-0.06 of body height,
 * which is ordinary cycle sway rather than locomotion, and Geoff has said the walk looks right.
 * Changing what is already good to fix something else is how regressions happen.
 */
export function stripRootMotion(clip: { tracks: Array<{ name: string }> }): void {
  const posTracks = clip.tracks.filter(t => t.name.endsWith('.position'));
  if (posTracks.length === 0) return;
  // The root is the shortest bone path — hips/pelvis sit above every other animated node.
  let root = posTracks[0];
  for (const t of posTracks) if (t.name.length < root.name.length) root = t;
  const i = clip.tracks.indexOf(root);
  if (i >= 0) clip.tracks.splice(i, 1);
}
