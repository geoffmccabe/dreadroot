/**
 * Namespaced debug logging — OFF by default.
 *
 * The console was carrying ~390 console.log calls, many firing per spawn, per
 * chop or per sync. That buries the messages that actually matter (real errors,
 * and the render/GPU warnings that diagnose a grey screen).
 *
 * These are kept rather than deleted because they are genuinely useful when
 * debugging a specific system — just not all the time, for everyone.
 *
 *   __log.on('trees')    turn one namespace on
 *   __log.all()          everything
 *   __log.off()          silence
 *   __log.list()         what is available / currently on
 *
 * The choice persists in localStorage, so it survives a reload while you are
 * chasing something.
 */
const KEY = 'dreadroot.debugLog';

const KNOWN = [
  'trees', 'chunks', 'spawn', 'enemies', 'atlas', 'blocks', 'inventory', 'net', 'audio',
] as const;
export type LogNamespace = (typeof KNOWN)[number];

let enabled = new Set<string>();

function load(): void {
  if (typeof localStorage === 'undefined') return;
  try {
    const raw = localStorage.getItem(KEY);
    if (raw) enabled = new Set(JSON.parse(raw) as string[]);
  } catch { /* ignore malformed */ }
}
function save(): void {
  if (typeof localStorage === 'undefined') return;
  try { localStorage.setItem(KEY, JSON.stringify([...enabled])); } catch { /* ignore */ }
}
load();

/** True if this namespace is currently being logged. */
export function isLogging(ns: LogNamespace | string): boolean {
  return enabled.has('*') || enabled.has(ns);
}

/** Log only when this namespace is switched on. */
export function dlog(ns: LogNamespace | string, ...args: unknown[]): void {
  if (isLogging(ns)) console.log(...args);
}

/** Warn only when switched on. For expected, recoverable conditions — a real
 *  problem should stay an ordinary console.warn/error so it is never hidden. */
export function dwarn(ns: LogNamespace | string, ...args: unknown[]): void {
  if (isLogging(ns)) console.warn(...args);
}

if (typeof window !== 'undefined') {
  (window as unknown as { __log: unknown }).__log = {
    on: (...ns: string[]) => { ns.forEach((n) => enabled.add(n)); save(); return [...enabled]; },
    off: (...ns: string[]) => {
      if (ns.length === 0) enabled.clear(); else ns.forEach((n) => enabled.delete(n));
      save(); return [...enabled];
    },
    all: () => { enabled.add('*'); save(); return 'all debug logging on'; },
    list: () => ({ available: [...KNOWN], enabled: [...enabled] }),
  };
}
