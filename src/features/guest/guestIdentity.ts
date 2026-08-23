/**
 * Guest identity: one guest account per device, remembered locally.
 *
 * WHAT IS STORED, and why each piece exists:
 *   deviceId      a random value this browser generated ABOUT ITSELF. It is
 *                 not a fingerprint and reveals nothing about the machine; it
 *                 exists only so the server can enforce one guest per device.
 *   guestUserId   which anonymous account this device belongs to.
 *   refreshToken  what actually lets a guest come back days or weeks later.
 *                 Supabase already persists its session in localStorage; this
 *                 is a second copy in a place site-data cleanup treats
 *                 differently, so the account survives more often. Same
 *                 exposure as the copy Supabase keeps, not a new one.
 *
 * If all of it is gone, the guest is gone: there is no email to recover it
 * with. That is accepted and by design -- the player is told they can keep
 * their progress by signing in, which converts the guest into a real account.
 *
 * Deliberately its OWN IndexedDB database rather than a new store inside
 * blockDB: adding a store there needs a schema version bump, and getting that
 * wrong would take the whole chunk cache with it. This is isolated.
 */

const DB_NAME = 'dreadroot-guest';
const DB_VERSION = 1;
const STORE = 'identity';
const RECORD_KEY = 'guest';
/** Mirror, for private windows and browsers where IndexedDB is unavailable. */
const LS_KEY = 'dreadroot.guest.identity';

export interface GuestIdentity {
  deviceId: string;
  guestUserId?: string;
  refreshToken?: string;
  updatedAt: number;
}

function openDb(): Promise<IDBDatabase | null> {
  return new Promise((resolve) => {
    try {
      const req = indexedDB.open(DB_NAME, DB_VERSION);
      req.onupgradeneeded = () => {
        const db = req.result;
        if (!db.objectStoreNames.contains(STORE)) db.createObjectStore(STORE);
      };
      req.onsuccess = () => resolve(req.result);
      req.onerror = () => resolve(null);
      // Private-mode browsers can hang here rather than failing outright.
      setTimeout(() => resolve(null), 3000);
    } catch {
      resolve(null);
    }
  });
}

function readLocal(): GuestIdentity | null {
  try {
    const raw = localStorage.getItem(LS_KEY);
    return raw ? (JSON.parse(raw) as GuestIdentity) : null;
  } catch {
    return null;
  }
}

function writeLocal(id: GuestIdentity): void {
  try { localStorage.setItem(LS_KEY, JSON.stringify(id)); } catch { /* full or blocked */ }
}

export async function loadGuestIdentity(): Promise<GuestIdentity | null> {
  const db = await openDb();
  if (db) {
    const fromDb = await new Promise<GuestIdentity | null>((resolve) => {
      try {
        const req = db.transaction(STORE, 'readonly').objectStore(STORE).get(RECORD_KEY);
        req.onsuccess = () => resolve((req.result as GuestIdentity) ?? null);
        req.onerror = () => resolve(null);
      } catch { resolve(null); }
    });
    if (fromDb) return fromDb;
  }
  // IndexedDB missing or empty: fall back to the mirror, and if that has
  // something, treat it as the truth.
  return readLocal();
}

export async function saveGuestIdentity(patch: Partial<GuestIdentity>): Promise<GuestIdentity> {
  const current = (await loadGuestIdentity()) ?? { deviceId: newDeviceId(), updatedAt: 0 };
  const next: GuestIdentity = { ...current, ...patch, updatedAt: Date.now() };
  writeLocal(next);
  const db = await openDb();
  if (db) {
    await new Promise<void>((resolve) => {
      try {
        const tx = db.transaction(STORE, 'readwrite');
        tx.objectStore(STORE).put(next, RECORD_KEY);
        tx.oncomplete = () => resolve();
        tx.onerror = () => resolve();
        tx.onabort = () => resolve();
      } catch { resolve(); }
    });
  }
  return next;
}

/** Forget this device's guest. Used once the guest has been converted. */
export async function clearGuestIdentity(): Promise<void> {
  try { localStorage.removeItem(LS_KEY); } catch { /* ignore */ }
  const db = await openDb();
  if (!db) return;
  await new Promise<void>((resolve) => {
    try {
      const tx = db.transaction(STORE, 'readwrite');
      tx.objectStore(STORE).delete(RECORD_KEY);
      tx.oncomplete = () => resolve();
      tx.onerror = () => resolve();
      tx.onabort = () => resolve();
    } catch { resolve(); }
  });
}

/** 32 hex chars: satisfies the server's ^[A-Za-z0-9_-]{8,64}$ device id rule. */
export function newDeviceId(): string {
  try {
    return crypto.randomUUID().replace(/-/g, '');
  } catch {
    let s = '';
    for (let i = 0; i < 32; i++) s += Math.floor(Math.random() * 16).toString(16);
    return s;
  }
}

/** The device id for this browser, creating and persisting one on first use. */
export async function getOrCreateDeviceId(): Promise<string> {
  const existing = await loadGuestIdentity();
  if (existing?.deviceId) return existing.deviceId;
  const created = await saveGuestIdentity({ deviceId: newDeviceId() });
  return created.deviceId;
}
