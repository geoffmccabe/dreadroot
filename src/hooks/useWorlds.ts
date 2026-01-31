import { useState, useEffect, useCallback } from 'react';
import { supabase } from '@/integrations/supabase/client';

export interface World {
  id: string;
  name: string;
  fortress_texture_url: string | null;
  ground_texture_url: string | null;
  sky_texture_url: string | null;
  ambient_music_url: string | null;
  ambient_music_volume: number;
  is_default: boolean;
  created_at: string;
  updated_at: string;
}

export interface AmbientMusicTrack {
  id: string;
  name: string;
  url: string;
  uploaded_by: string | null;
  created_at: string;
}

// Default ambient track (always available even if not in DB)
export const DEFAULT_AMBIENT_TRACK: AmbientMusicTrack = {
  id: 'default-ambient',
  name: 'Alien Planet Ambient',
  url: '/ambient_alien_planet_bkgd_1.mp3',
  uploaded_by: null,
  created_at: new Date().toISOString(),
};

export function useWorlds() {
  const [worlds, setWorlds] = useState<World[]>([]);
  const [ambientTracks, setAmbientTracks] = useState<AmbientMusicTrack[]>([]);
  const [isLoading, setIsLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  const fetchWorlds = useCallback(async () => {
    try {
      setIsLoading(true);
      const { data, error } = await supabase
        .from('worlds')
        .select('*')
        .order('is_default', { ascending: false })
        .order('name');

      if (error) throw error;

      // Type assertion since worlds table is new
      setWorlds((data as unknown as World[]) || []);
      setError(null);
    } catch (err) {
      console.error('Error fetching worlds:', err);
      setError(err instanceof Error ? err.message : 'Failed to fetch worlds');
    } finally {
      setIsLoading(false);
    }
  }, []);

  const fetchAmbientTracks = useCallback(async () => {
    try {
      const { data, error } = await supabase
        .from('ambient_music_tracks')
        .select('*')
        .order('name');

      if (error) {
        // Table might not exist yet - just use default
        console.warn('Error fetching ambient tracks (table may not exist):', error);
        setAmbientTracks([DEFAULT_AMBIENT_TRACK]);
        return;
      }

      const tracks = (data as unknown as AmbientMusicTrack[]) || [];

      // Always include default track if not already in list
      const hasDefault = tracks.some(t => t.url === DEFAULT_AMBIENT_TRACK.url);
      if (!hasDefault) {
        tracks.unshift(DEFAULT_AMBIENT_TRACK);
      }

      setAmbientTracks(tracks);
    } catch (err) {
      console.error('Error fetching ambient tracks:', err);
      setAmbientTracks([DEFAULT_AMBIENT_TRACK]);
    }
  }, []);

  useEffect(() => {
    fetchWorlds();
    fetchAmbientTracks();
  }, [fetchWorlds, fetchAmbientTracks]);

  const getDefaultWorld = useCallback((): World | null => {
    return worlds.find(w => w.is_default) || worlds[0] || null;
  }, [worlds]);

  const createWorld = useCallback(async (worldData: {
    name: string;
    fortress_texture_url?: string | null;
    ground_texture_url?: string | null;
    sky_texture_url?: string | null;
  }): Promise<World | null> => {
    try {
      const { data, error } = await supabase
        .from('worlds')
        .insert({
          name: worldData.name,
          fortress_texture_url: worldData.fortress_texture_url || null,
          ground_texture_url: worldData.ground_texture_url || null,
          sky_texture_url: worldData.sky_texture_url || null,
          ambient_music_url: DEFAULT_AMBIENT_TRACK.url,
          ambient_music_volume: 100,
          is_default: false
        })
        .select()
        .single();

      if (error) throw error;

      await fetchWorlds();
      return data as unknown as World;
    } catch (err) {
      console.error('Error creating world:', err);
      throw err;
    }
  }, [fetchWorlds]);

  const updateWorld = useCallback(async (
    worldId: string,
    updates: Partial<Pick<World, 'name' | 'fortress_texture_url' | 'ground_texture_url' | 'sky_texture_url' | 'ambient_music_url' | 'ambient_music_volume'>>
  ): Promise<void> => {
    try {
      const { error } = await supabase
        .from('worlds')
        .update(updates)
        .eq('id', worldId);

      if (error) throw error;
      await fetchWorlds();
    } catch (err) {
      console.error('Error updating world:', err);
      throw err;
    }
  }, [fetchWorlds]);

  const setDefaultWorld = useCallback(async (worldId: string): Promise<void> => {
    try {
      // Transaction: first set all to false, then set chosen to true
      // Note: This should ideally be a database function, but we'll do it client-side
      const { error: clearError } = await supabase
        .from('worlds')
        .update({ is_default: false })
        .neq('id', worldId);

      if (clearError) throw clearError;

      const { error: setError } = await supabase
        .from('worlds')
        .update({ is_default: true })
        .eq('id', worldId);

      if (setError) throw setError;
      
      await fetchWorlds();
    } catch (err) {
      console.error('Error setting default world:', err);
      throw err;
    }
  }, [fetchWorlds]);

  const deleteWorld = useCallback(async (worldId: string): Promise<void> => {
    try {
      // Check if it's the default world
      const world = worlds.find(w => w.id === worldId);
      if (world?.is_default) {
        throw new Error('Cannot delete the default world');
      }

      const { error } = await supabase
        .from('worlds')
        .delete()
        .eq('id', worldId);

      if (error) throw error;
      await fetchWorlds();
    } catch (err) {
      console.error('Error deleting world:', err);
      throw err;
    }
  }, [worlds, fetchWorlds]);

  const uploadAmbientTrack = useCallback(async (name: string, file: File): Promise<AmbientMusicTrack | null> => {
    try {
      const fileExt = file.name.split('.').pop()?.toLowerCase();
      if (!['mp3', 'wav', 'ogg', 'm4a'].includes(fileExt || '')) {
        throw new Error('Invalid file type. Use MP3, WAV, OGG, or M4A.');
      }

      const fileName = `ambient_${Date.now()}.${fileExt}`;

      const { error: uploadError } = await supabase.storage
        .from('ambient-music')
        .upload(fileName, file, { upsert: true });

      if (uploadError) throw uploadError;

      const { data: { publicUrl } } = supabase.storage
        .from('ambient-music')
        .getPublicUrl(fileName);

      // Insert track record
      const { data, error } = await supabase
        .from('ambient_music_tracks')
        .insert({ name, url: publicUrl })
        .select()
        .single();

      if (error) throw error;

      await fetchAmbientTracks();
      return data as unknown as AmbientMusicTrack;
    } catch (err) {
      console.error('Error uploading ambient track:', err);
      throw err;
    }
  }, [fetchAmbientTracks]);

  const deleteAmbientTrack = useCallback(async (trackId: string): Promise<void> => {
    try {
      const { error } = await supabase
        .from('ambient_music_tracks')
        .delete()
        .eq('id', trackId);

      if (error) throw error;
      await fetchAmbientTracks();
    } catch (err) {
      console.error('Error deleting ambient track:', err);
      throw err;
    }
  }, [fetchAmbientTracks]);

  return {
    worlds,
    ambientTracks,
    isLoading,
    error,
    fetchWorlds,
    fetchAmbientTracks,
    getDefaultWorld,
    createWorld,
    updateWorld,
    setDefaultWorld,
    deleteWorld,
    uploadAmbientTrack,
    deleteAmbientTrack
  };
}
