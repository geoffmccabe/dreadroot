// isTypingTarget — true when a keyboard event is headed into an editable field (input,
// textarea, select, or contentEditable). Global game/debug key handlers call this FIRST and
// bail, so they never hijack the user's typing in a panel's text boxes.
export function isTypingTarget(e?: { target?: EventTarget | null } | null): boolean {
  const el =
    ((e?.target as HTMLElement | null) ??
      (typeof document !== 'undefined' ? (document.activeElement as HTMLElement | null) : null));
  if (!el) return false;
  const tag = el.tagName;
  return tag === 'INPUT' || tag === 'TEXTAREA' || tag === 'SELECT' || el.isContentEditable === true;
}
