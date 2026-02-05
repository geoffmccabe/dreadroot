import { useState, useEffect, useCallback, useRef } from 'react';
import { supabase } from '@/integrations/supabase/client';

export interface GameSound {
  id: string;
  sound_key: string;
  display_name: string;
  description: string | null;
  sound_url: string;
  default_url: string;
  is_3d_sound: boolean;
  volume: number;
  created_at: string;
  updated_at: string;
}

// In-memory cache for fast access during gameplay
let soundsCache: Map<string, GameSound> | null = null;
let cacheInitialized = false;

/**
 * Get a sound URL by key - uses cache for fast access
 * Falls back to default if not found
 */
export function getSoundUrl(key: string, fallbackUrl: string): string {
  if (soundsCache) {
    const sound = soundsCache.get(key);
    if (sound) return sound.sound_url;
  }
  return fallbackUrl;
}

/**
 * Get full sound config by key
 */
export function getSoundConfig(key: string): GameSound | null {
  if (soundsCache) {
    return soundsCache.get(key) || null;
  }
  return null;
}

/**
 * Check if a sound should use 3D positional audio
 */
export function isSoundPositional(key: string): boolean {
  if (soundsCache) {
    const sound = soundsCache.get(key);
    if (sound) return sound.is_3d_sound;
  }
  return false;
}

/**
 * Get sound volume multiplier
 */
export function getSoundVolume(key: string): number {
  if (soundsCache) {
    const sound = soundsCache.get(key);
    if (sound) return sound.volume;
  }
  return 1.0;
}

/**
 * Initialize the sounds cache - call early in app startup
 */
export async function initializeSoundsCache(): Promise<void> {
  if (cacheInitialized) return;

  try {
    const { data, error } = await supabase
      .from('game_sounds')
      .select('*');

    if (error) {
      console.warn('[GameSounds] Failed to load sounds, using defaults:', error.message);
      return;
    }

    soundsCache = new Map();
    for (const sound of (data || []) as GameSound[]) {
      soundsCache.set(sound.sound_key, sound);
    }
    cacheInitialized = true;
    console.log(`[GameSounds] Cached ${soundsCache.size} sounds`);
  } catch (err) {
    console.warn('[GameSounds] Failed to initialize cache:', err);
  }
}

/**
 * Refresh the sounds cache (after admin makes changes)
 */
export async function refreshSoundsCache(): Promise<void> {
  cacheInitialized = false;
  soundsCache = null;
  await initializeSoundsCache();
}

/**
 * Hook for admin UI to manage game sounds
 */
export function useGameSounds() {
  const [sounds, setSounds] = useState<GameSound[]>([]);
  const [isLoading, setIsLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const previewAudioRef = useRef<HTMLAudioElement | null>(null);

  const fetchSounds = useCallback(async () => {
    try {
      setIsLoading(true);
      setError(null);

      const { data, error: fetchError } = await supabase
        .from('game_sounds')
        .select('*')
        .order('display_name');

      if (fetchError) throw fetchError;

      setSounds((data || []) as GameSound[]);
    } catch (err) {
      console.error('[useGameSounds] Fetch error:', err);
      setError(err instanceof Error ? err.message : 'Failed to fetch sounds');
    } finally {
      setIsLoading(false);
    }
  }, []);

  useEffect(() => {
    fetchSounds();
  }, [fetchSounds]);

  /**
   * Upload a new sound file and update the sound record
   */
  const uploadSound = useCallback(async (
    soundKey: string,
    file: File
  ): Promise<string | null> => {
    try {
      const fileExt = file.name.split('.').pop()?.toLowerCase();
      if (!['mp3', 'wav', 'ogg', 'm4a'].includes(fileExt || '')) {
        throw new Error('Invalid file type. Use MP3, WAV, OGG, or M4A.');
      }

      const fileName = `${soundKey}_${Date.now()}.${fileExt}`;

      const { error: uploadError } = await supabase.storage
        .from('game-sounds')
        .upload(fileName, file, { upsert: true });

      if (uploadError) throw uploadError;

      const { data: { publicUrl } } = supabase.storage
        .from('game-sounds')
        .getPublicUrl(fileName);

      // Update the sound record
      const { error: updateError } = await supabase
        .from('game_sounds')
        .update({ sound_url: publicUrl })
        .eq('sound_key', soundKey);

      if (updateError) throw updateError;

      // Refresh local state and cache
      await fetchSounds();
      await refreshSoundsCache();

      return publicUrl;
    } catch (err) {
      console.error('[useGameSounds] Upload error:', err);
      throw err;
    }
  }, [fetchSounds]);

  /**
   * Reset a sound to its default URL
   */
  const resetSound = useCallback(async (soundKey: string): Promise<void> => {
    try {
      const sound = sounds.find(s => s.sound_key === soundKey);
      if (!sound) throw new Error('Sound not found');

      const { error } = await supabase
        .from('game_sounds')
        .update({ sound_url: sound.default_url })
        .eq('sound_key', soundKey);

      if (error) throw error;

      await fetchSounds();
      await refreshSoundsCache();
    } catch (err) {
      console.error('[useGameSounds] Reset error:', err);
      throw err;
    }
  }, [sounds, fetchSounds]);

  /**
   * Update sound settings (volume, is_3d_sound)
   */
  const updateSound = useCallback(async (
    soundKey: string,
    updates: Partial<Pick<GameSound, 'volume' | 'is_3d_sound'>>
  ): Promise<void> => {
    try {
      const { error } = await supabase
        .from('game_sounds')
        .update(updates)
        .eq('sound_key', soundKey);

      if (error) throw error;

      await fetchSounds();
      await refreshSoundsCache();
    } catch (err) {
      console.error('[useGameSounds] Update error:', err);
      throw err;
    }
  }, [fetchSounds]);

  /**
   * Preview a sound
   */
  const playPreview = useCallback((url: string, volume: number = 1.0) => {
    // Stop any currently playing preview
    if (previewAudioRef.current) {
      previewAudioRef.current.pause();
      previewAudioRef.current = null;
    }

    const audio = new Audio(url);
    audio.volume = Math.min(1, Math.max(0, volume));
    previewAudioRef.current = audio;
    audio.play().catch(err => {
      console.warn('[useGameSounds] Preview playback failed:', err);
    });
  }, []);

  /**
   * Stop preview playback
   */
  const stopPreview = useCallback(() => {
    if (previewAudioRef.current) {
      previewAudioRef.current.pause();
      previewAudioRef.current = null;
    }
  }, []);

  return {
    sounds,
    isLoading,
    error,
    fetchSounds,
    uploadSound,
    resetSound,
    updateSound,
    playPreview,
    stopPreview,
  };
}
