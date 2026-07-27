// kaijuOrders — telling a Kaiju what to do, in words, and letting it decide whether to.
//
// The design decision everything here rests on (see docs/KAIJU_SEMI_CONTROLLER.md): AN ORDER IS A
// THUMB ON THE SCALE, NOT A COMMAND. It adds a large bonus to the score of the matching action and
// then the Kaiju's normal decision runs as usual. If it is hurt and outgunned, self-preservation
// still outscores your order and it refuses — not because a rule says "refuse when weak", but
// because it genuinely weighed the order against staying alive and staying alive won.
//
// That gives refusal for free, and — because every consideration's score is already recorded — it
// gives us the REASON for the refusal in the Kaiju's own terms rather than a canned line.
//
// How obedient it is decides how heavy the thumb is. That is the Obedience stat, which refunds
// points precisely because a Kaiju that does what it is told holds ground it should have left.
//
// PARSING IS TWO-TIER, and the fast tier does almost all the work:
//   1. A local grammar, here, handling the couple of dozen phrasings people actually use under
//      pressure. Zero latency, zero cost, works offline, and it is the one that matters because
//      "attack that" and "back off" are what you shout in a fight.
//   2. An LLM for anything it does not recognise, via the existing gateway at ai.divi.love. Rare,
//      so the cost is negligible and the round trip is affordable.
// Speech recognition sits IN FRONT of both and only ever produces text, so voice and typing go
// down exactly the same path and neither needs to know the other exists.

import * as THREE from 'three';

export type OrderType =
  | 'attack'      // go for a specific enemy
  | 'backOff'     // break contact but keep fighting
  | 'retreat'     // leave the fight
  | 'takeCover'   // get behind something
  | 'hold'        // stand your ground here
  | 'goTo'        // walk to a place
  | 'follow'      // stay near me
  | 'free';       // forget everything, use your own judgement

export interface Order {
  type: OrderType;
  /** Which enemy, for `attack`. Null means "whatever is nearest". */
  targetId: string | null;
  /** Where, for `goTo`. A unit direction from the planet centre. */
  destination: THREE.Vector3 | null;
  /** What the player actually said, kept so the tracker can show it verbatim. */
  said: string;
  /** Seconds since the order was given. */
  age: number;
  /**
   * Standing orders persist until replaced; immediate ones expire.
   *
   * Both are needed. "Guard the miners" should survive a whole battle, but a stale "attack that"
   * firing thirty seconds later — when the situation has completely changed — is exactly the kind
   * of thing that makes an AI look broken.
   */
  standing: boolean;
}

/** How long an immediate order stays live if the Kaiju has not acted on it. */
export const ORDER_TTL_SECONDS = 12;

/** Which utility action each order is pushing for. */
export const ORDER_ACTION: Record<OrderType, string | null> = {
  attack: 'engage',
  backOff: 'circle',
  retreat: 'flee',
  takeCover: 'takeCover',
  hold: 'hold',
  goTo: 'goTo',
  follow: 'goTo',
  free: null,
};

/** How the Kaiju acknowledges, in plain words, for the subtitle line. */
export const ORDER_ACK: Record<OrderType, string> = {
  attack: 'Going for it.',
  backOff: 'Backing off.',
  retreat: 'Falling back.',
  takeCover: 'Finding cover.',
  hold: 'Holding here.',
  goTo: 'On my way.',
  follow: 'With you.',
  free: 'My call, then.',
};

// --- the local grammar ---------------------------------------------------------------------------
//
// Deliberately generous about phrasing and deliberately small. These are ordered most-specific
// first, because "don't attack" must not match the "attack" rule.

interface Rule { type: OrderType; patterns: RegExp[] }

const RULES: Rule[] = [
  // Negations and stand-downs first, or they get swallowed by the positive rules below.
  { type: 'free', patterns: [
    /\b(do what you want|your call|free|on your own|stop taking orders|as you like|use your judg)/i,
  ] },
  { type: 'hold', patterns: [
    /\b(hold|stop|wait|stay|stand (your )?ground|don'?t move|halt|freeze)\b/i,
    /\b(leave (it|that|them) alone|don'?t attack|stand down|back off and wait)\b/i,
  ] },
  { type: 'retreat', patterns: [
    /\b(retreat|run( away)?|flee|get out|withdraw|disengage|leave|escape|bail)\b/i,
  ] },
  { type: 'takeCover', patterns: [
    /\b(cover|hide|take cover|get behind|shelter|duck)\b/i,
  ] },
  { type: 'backOff', patterns: [
    /\b(back off|back up|keep (your )?distance|give ground|pull back|not so close|circle)\b/i,
  ] },
  { type: 'follow', patterns: [
    /\b(follow|come (here|with)|stay (with|near) me|on me|heel|with me)\b/i,
  ] },
  { type: 'goTo', patterns: [
    /\b(go (to|there|over)|move (to|there|over)|head (to|over)|walk (to|there|over)|over there|get (to|over) there)\b/i,
  ] },
  { type: 'attack', patterns: [
    /\b(attack|kill|fight|charge|get (him|her|it|them)|go for|engage|hit|take (him|her|it|them) (out|down)|destroy)\b/i,
  ] },
];

/**
 * Turn a sentence into an order, or null if the grammar does not recognise it.
 *
 * Null is a useful answer, not a failure: it is the signal to escalate to the LLM. It is also why
 * the rules stay narrow — a grammar that guesses is worse than one that admits it does not know,
 * because a wrong order is acted on silently and a missing one can be asked about.
 */
export function parseOrder(text: string): Order | null {
  const said = text.trim();
  if (!said) return null;
  for (const rule of RULES) {
    for (const p of rule.patterns) {
      if (p.test(said)) {
        return {
          type: rule.type, targetId: null, destination: null,
          said, age: 0, standing: rule.type === 'follow' || rule.type === 'hold',
        };
      }
    }
  }
  return null;
}

/**
 * The prompt for the LLM fallback, when the grammar draws a blank.
 *
 * It returns ONE of a closed set of order types, never free-form behaviour. That is the whole
 * point: the model's output is a data structure we can validate and reject, and it never sits in
 * the per-frame loop. See the VLM-behaviour-tree note in docs/KAIJU_AI_RESEARCH.md.
 */
export function orderPrompt(text: string): string {
  return [
    'You translate a player\'s instruction to their giant monster into ONE command word.',
    `Reply with exactly one of: ${Object.keys(ORDER_ACTION).join(', ')}.`,
    'No punctuation, no explanation, no other words.',
    'If the instruction does not fit any of them, reply: none',
    '',
    `Instruction: ${text}`,
  ].join('\n');
}

/** Validate an LLM reply back into an order, or null. Never trust the model's output shape. */
export function orderFromModel(reply: string, said: string): Order | null {
  const word = reply.trim().toLowerCase().replace(/[^a-z]/g, '');
  const match = (Object.keys(ORDER_ACTION) as OrderType[])
    .find((t) => t.toLowerCase() === word);
  if (!match) return null;
  return {
    type: match, targetId: null, destination: null, said, age: 0,
    standing: match === 'follow' || match === 'hold',
  };
}

// --- how much an order is worth ------------------------------------------------------------------

/**
 * The bonus an order adds to its action's utility score.
 *
 * At obedience 0 this is small enough that the order only wins when the Kaiju already half-agreed.
 * At obedience 100 it is large enough to override almost anything short of imminent death — which
 * is what makes a very obedient Kaiju genuinely more likely to die, and therefore worth points.
 */
export function orderWeight(obedience01: number): number {
  return 0.15 + 0.75 * obedience01;
}

/** Has an immediate order gone stale? */
export function orderExpired(o: Order): boolean {
  return !o.standing && o.age > ORDER_TTL_SECONDS;
}
