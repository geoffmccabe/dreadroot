/**
 * Audio Cache (IndexedDB)
 *
 * Persists fetched sound files (weapon / monster / music / enemy SFX) as blobs
 * so returning users don't re-download them. Tier 2 of the audio cache:
 *   Tier 1 (memory)    : decoded AudioBuffer map in spatialAudio.ts
 *   Tier 2 (IndexedDB) : this module  ← blobs survive across sessions
 *   Tier 3 (network)   : /public/*-sounds, /music, etc.
 *
 * Deliberately a SEPARATE database from blockDB (same pattern as atlasStorage),
 * so adding audio never disturbs the block/chunk/texture schema or its version.
 */

const DB_NAME = 'fortress_audio';
const DB_VERSION = 1;
const STORE = 'audio_blobs';

interface AudioBlobRecord {
  url: string;      // primary key, e.g. "/weapon-sounds/shotgun.mp3"
  blob: Blob;       // raw audio bytes
  size: number;     // bytes
  cachedAt: number; // epoch ms
}

let db: IDBDatabase | null = null;
let initPromise: Promise<IDBDatabase | null> | null = null;

function openDB(): Promise<IDBDatabase | null> {
  if (db) return Promise.resolve(db);
  if (initPromise) return initPromise;
  if (typeof indexedDB === 'undefined') return Promise.resolve(null);

  initPromise = new Promise((resolve) => {
    const request = indexedDB.open(DB_NAME, DB_VERSION);
    request.onerror = () => {
      console.warn('[AudioCache] Failed to open database:', request.error);
      resolve(null);
    };
    request.onsuccess = () => {
      db = request.result;
      resolve(db);
    };
    request.onupgradeneeded = (event) => {
      const database = (event.target as IDBOpenDBRequest).result;
      if (!database.objectStoreNames.contains(STORE)) {
        database.createObjectStore(STORE, { keyPath: 'url' });
      }
    };
  });
  return initPromise;
}

/** Return the cached blob for a url, or null if not cached / unavailable. */
export async function getAudioBlob(url: string): Promise<Blob | null> {
  const database = await openDB();
  if (!database) return null;
  return new Promise((resolve) => {
    const tx = database.transaction(STORE, 'readonly');
    const request = tx.objectStore(STORE).get(url);
    request.onerror = () => resolve(null);
    request.onsuccess = () => resolve((request.result as AudioBlobRecord | undefined)?.blob ?? null);
  });
}

/** Persist a blob for a url (overwrites). Best-effort — never throws. */
export async function saveAudioBlob(url: string, blob: Blob): Promise<void> {
  const database = await openDB();
  if (!database) return;
  return new Promise((resolve) => {
    const tx = database.transaction(STORE, 'readwrite');
    tx.objectStore(STORE).put({ url, blob, size: blob.size, cachedAt: Date.now() } as AudioBlobRecord);
    tx.oncomplete = () => resolve();
    tx.onerror = () => resolve();
  });
}

/** True if a blob for this url is already persisted. */
export async function hasAudio(url: string): Promise<boolean> {
  const database = await openDB();
  if (!database) return false;
  return new Promise((resolve) => {
    const tx = database.transaction(STORE, 'readonly');
    const request = tx.objectStore(STORE).getKey(url);
    request.onerror = () => resolve(false);
    request.onsuccess = () => resolve(request.result != null);
  });
}

/** Fetch + persist a url if not already cached. Returns true if bytes are in IDB after. */
export async function ensureCached(url: string): Promise<boolean> {
  try {
    if (await hasAudio(url)) return true;
    const response = await fetch(url);
    if (!response.ok) return false;
    const blob = await response.blob();
    await saveAudioBlob(url, blob);
    return true;
  } catch {
    return false;
  }
}
