/**
 * Game audio preloader.
 *
 * After startup (at idle, so it doesn't compete with first paint) this warms
 * every weapon / monster / music sound into the IndexedDB audio cache, so a
 * returning user never re-downloads them. It stores BLOBS only — decoding to
 * AudioBuffer happens on demand in spatialAudio (decoded music would cost far
 * more RAM than the ~10MB of compressed blobs).
 */

import { WEAPON_SOUNDS } from '@/config/weaponSounds';
import { MONSTER_SOUNDS, MUSIC_TRACKS } from '@/config/gameSounds';
import { ensureCached } from '@/lib/audioCache';

function allSoundUrls(): string[] {
  const urls: string[] = [];
  for (const s of Object.values(WEAPON_SOUNDS)) urls.push(s.file);
  for (const s of Object.values(MONSTER_SOUNDS)) urls.push(s.file);
  for (const s of Object.values(MUSIC_TRACKS)) urls.push(s.file);
  return urls;
}

let started = false;

/** Warm all game sounds into IndexedDB. Idempotent; safe to call repeatedly. */
export async function preloadGameAudio(concurrency = 4): Promise<void> {
  if (started) return;
  started = true;

  const urls = allSoundUrls();
  let index = 0;
  let cached = 0;

  async function worker() {
    while (index < urls.length) {
      const url = urls[index++];
      if (await ensureCached(url)) cached++;
    }
  }

  await Promise.all(
    Array.from({ length: Math.min(concurrency, urls.length) }, worker),
  );
  console.log(`[AudioPreload] ${cached}/${urls.length} game sounds cached in IndexedDB`);
}

// Self-schedule on the client, at idle, after the app has settled.
if (typeof window !== 'undefined') {
  const start = () => { preloadGameAudio().catch(() => { /* non-critical */ }); };
  const ric = (window as unknown as {
    requestIdleCallback?: (cb: () => void, opts?: { timeout?: number }) => void;
  }).requestIdleCallback;
  if (ric) ric(start, { timeout: 8000 });
  else setTimeout(start, 4000);
}
