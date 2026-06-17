/**
 * Game audio preloader.
 *
 * After startup (at idle) this warms every sound in the canonical `game_sounds`
 * catalog into the IndexedDB audio cache, so a returning user never re-downloads
 * them. Stores BLOBS only — decoding to AudioBuffer happens on demand in
 * spatialAudio (decoded music would cost far more RAM than the compressed blobs).
 *
 * Single source of truth: the `game_sounds` table. No static manifests.
 */

import { supabase } from '@/integrations/supabase/client';
import { ensureCached } from '@/lib/audioCache';

let started = false;

/** Warm all catalog sounds into IndexedDB. Idempotent; safe to call repeatedly. */
export async function preloadGameAudio(concurrency = 4): Promise<void> {
  if (started) return;
  started = true;

  let urls: string[] = [];
  try {
    const { data } = await supabase.from('game_sounds').select('sound_url');
    urls = (data || [])
      .map((r) => r.sound_url)
      .filter((u): u is string => typeof u === 'string' && u.length > 0);
  } catch {
    return; // non-critical
  }
  if (urls.length === 0) return;

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
