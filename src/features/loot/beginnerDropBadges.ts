/**
 * "Beginner's Drop: x/10" — the floating label above a new player's
 * guaranteed early loot.
 *
 * A new player's first ten kills always drop something (the server forces it,
 * see roll_shwarm_drop). The label exists so that is legible rather than just
 * lucky-feeling: without it players cannot tell they are being helped, and the
 * moment the guarantee runs out it reads as the game breaking rather than as
 * normal drop rates resuming.
 *
 * The two-second countdown starts when the item is FIRST DRAWN, not when the
 * server answered. The drop reaches the screen over realtime, which can lag,
 * and a timer started too early would show a label for whatever fraction of
 * two seconds was left — sometimes none at all.
 */

const VISIBLE_MS = 2000;
/** Guards against unbounded growth if a drop is never rendered (picked up by
 *  someone else, chunk unloaded, tab backgrounded during the round trip). */
const MAX_TRACKED = 64;

interface Badge {
  label: string;
  firstSeenAt: number | null;
}

const badges = new Map<string, Badge>();

/** Called when the server confirms a guaranteed drop. */
export function markBeginnerDrop(dropId: string, index: number, total: number): void {
  if (!dropId) return;
  if (badges.size >= MAX_TRACKED) {
    // Drop the oldest insertion; Map preserves insertion order.
    const oldest = badges.keys().next();
    if (!oldest.done) badges.delete(oldest.value);
  }
  badges.set(dropId, { label: `Beginner's Drop: ${index}/${total}`, firstSeenAt: null });
}

/**
 * The label to draw for this drop right now, or null.
 * Starts the clock on first call and forgets the badge once it has expired.
 */
export function getBeginnerBadge(dropId: string, now: number): string | null {
  const b = badges.get(dropId);
  if (b === undefined) return null;
  if (b.firstSeenAt === null) {
    b.firstSeenAt = now;
    return b.label;
  }
  if (now - b.firstSeenAt >= VISIBLE_MS) {
    badges.delete(dropId);
    return null;
  }
  return b.label;
}
