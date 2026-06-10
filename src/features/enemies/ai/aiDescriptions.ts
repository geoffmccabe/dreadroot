/**
 * aiDescriptions — plain-English, newbie-friendly explanations of every AI part:
 * the behaviors a creature can have, and the behavior-tree node types. The admin
 * panel surfaces these via an info (ⓘ) button, and the future flowchart editor
 * will use the same text for node tooltips. ONE source of truth, portable to any
 * game on this engine.
 */
export interface AiPartInfo {
  title: string;
  /** one-line gist */
  summary: string;
  /** how it actually works, written for someone who doesn't code */
  detail: string;
}

/** The behaviors a creature can be given (the "what it does" building blocks). */
export const AI_BEHAVIOR_INFO: Record<string, AiPartInfo> = {
  chase: {
    title: 'Chase',
    summary: 'Move toward its target.',
    detail:
      "Kicks in when a target is within the creature's detection range and in line of sight. " +
      'It heads straight for the target and speeds up the closer it gets, while gently steering ' +
      'around nearby allies so a crowd doesn\'t pile into one spot.',
  },
  attack: {
    title: 'Attack',
    summary: 'Strike a target that\'s in reach.',
    detail:
      'Becomes the top priority once the target is within striking distance. It strikes whenever ' +
      'its attack cooldown is ready; between strikes it holds its ground in "attack stance" rather ' +
      'than backing off, so it keeps the pressure on.',
  },
  wander: {
    title: 'Wander',
    summary: 'Roam around when nothing urgent is happening.',
    detail:
      'The relaxed default. With no target nearby, the creature picks random spots and ambles ' +
      'between them, pausing now and then. Any more urgent behavior (chase, attack) outranks it.',
  },
  patrol: {
    title: 'Patrol',
    summary: 'Walk a set route, watching for intruders.',
    detail:
      'The creature moves between patrol points on a loop. It\'s like wander but purposeful — used ' +
      'for guards that should cover an area rather than drift randomly.',
  },
  revenge: {
    title: 'Revenge',
    summary: 'Hunt down whoever hurt it.',
    detail:
      'When the creature takes damage, it remembers the attacker and prioritizes going after them ' +
      'for a while — even chasing past its normal range — before calming back down.',
  },
  angry: {
    title: 'Angry',
    summary: 'A riled-up, more aggressive state.',
    detail:
      'A temporary mood (usually after being provoked) that makes the creature more likely to ' +
      'chase and attack, and less likely to wander off, until it cools down.',
  },
  indignant: {
    title: 'Indignant',
    summary: 'A brief offended reaction.',
    detail:
      'A short-lived response to being bumped or minorly wronged — a flash of attitude before the ' +
      'creature returns to whatever it was doing.',
  },
  sleep: {
    title: 'Sleep',
    summary: 'Stay dormant until disturbed.',
    detail:
      'The creature rests and does nothing until something (a nearby target, damage) wakes it up. ' +
      'Cheap on performance and good for ambush creatures.',
  },
  returnHome: {
    title: 'Return Home',
    summary: 'Go back to where it started.',
    detail:
      'After chasing too far, the creature heads back toward its home spot so enemies don\'t get ' +
      'dragged across the whole map.',
  },
};

/** The behavior-tree node types (the "how decisions are wired together" pieces). */
export const AI_NODE_INFO: Record<string, AiPartInfo> = {
  utility: {
    title: 'Utility (pick the best)',
    summary: 'Each option rates itself; the highest score wins.',
    detail:
      'Every behavior under a Utility node scores how appropriate it is right now (0 = not at all, ' +
      '1 = perfect). The node runs the highest scorer. This is the classic "do whatever matters ' +
      'most" brain — e.g. attack (0.95) beats chase (0.7) beats wander (0.5).',
  },
  selector: {
    title: 'Selector (priority)',
    summary: 'Try options top-to-bottom; use the first that applies.',
    detail:
      'Runs down a list in order and stops at the first branch that can run. Use it for strict ' +
      'priority — "if you can attack, attack; otherwise if you can chase, chase; otherwise wander."',
  },
  sequence: {
    title: 'Sequence (in order)',
    summary: 'Do a set of steps one after another.',
    detail:
      'Runs each step in turn; if any step can\'t run, the whole sequence stops. Use it to chain ' +
      'a check and an action — "is the target in range? → then attack."',
  },
  condition: {
    title: 'Condition (a yes/no check)',
    summary: 'A gate that lets a branch run only when true.',
    detail:
      'A simple question like "is the target within range?" or "is line-of-sight clear?". Conditions ' +
      'guard actions so they only happen at the right moment.',
  },
  action: {
    title: 'Action (do something)',
    summary: 'A concrete thing the creature does this moment.',
    detail:
      'A leaf such as move, strike, or wait. Actions are where decisions turn into actual movement ' +
      'and combat.',
  },
  invert: {
    title: 'Invert (NOT)',
    summary: 'Flips a check from yes to no.',
    detail:
      'Wraps a condition and reverses it — "run this branch when the target is NOT in range."',
  },
};

/** Look up any AI part (behavior or node) by id. */
export function getAiInfo(id: string): AiPartInfo | undefined {
  return AI_BEHAVIOR_INFO[id] ?? AI_NODE_INFO[id];
}
