import { useState, useEffect, useCallback } from 'react';
import { supabase } from '@/integrations/supabase/client';
import { generatePondsForWorld, type WorldPondSettings, type PondSettings } from '@/lib/pondGenerator';

export interface World {
  id: string;
  name: string;
  fortress_texture_url: string | null;
  ground_texture_url: string | null;
  sky_texture_url: string | null;
  ambient_music_url: string | null;
  ambient_music_volume: number;
  view_settings: Record<string, unknown> | null;
  is_default: boolean;
  created_at: string;
  updated_at: string;
  // Pond settings - water
  water_pond_chance: number;
  water_pond_min_width: number;
  water_pond_max_width: number;
  water_pond_min_height: number;
  water_pond_max_height: number;
  water_pond_min_depth: number;
  water_pond_max_depth: number;
  water_surface_texture_url: string | null;
  water_tint_color: string;
  // Pond settings - lava
  lava_pond_chance: number;
  lava_pond_min_width: number;
  lava_pond_max_width: number;
  lava_pond_min_height: number;
  lava_pond_max_height: number;
  lava_pond_min_depth: number;
  lava_pond_max_depth: number;
  lava_surface_texture_url: string | null;
  lava_tint_color: string;
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
    // Pond settings
    water_pond_chance?: number;
    water_pond_min_width?: number;
    water_pond_max_width?: number;
    water_pond_min_height?: number;
    water_pond_max_height?: number;
    water_pond_min_depth?: number;
    water_pond_max_depth?: number;
    water_surface_texture_url?: string | null;
    water_tint_color?: string;
    lava_pond_chance?: number;
    lava_pond_min_width?: number;
    lava_pond_max_width?: number;
    lava_pond_min_height?: number;
    lava_pond_max_height?: number;
    lava_pond_min_depth?: number;
    lava_pond_max_depth?: number;
    lava_surface_texture_url?: string | null;
    lava_tint_color?: string;
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
          is_default: false,
          // Water pond settings
          water_pond_chance: worldData.water_pond_chance ?? 0,
          water_pond_min_width: worldData.water_pond_min_width ?? 5,
          water_pond_max_width: worldData.water_pond_max_width ?? 20,
          water_pond_min_height: worldData.water_pond_min_height ?? 5,
          water_pond_max_height: worldData.water_pond_max_height ?? 20,
          water_pond_min_depth: worldData.water_pond_min_depth ?? 3,
          water_pond_max_depth: worldData.water_pond_max_depth ?? 10,
          water_surface_texture_url: worldData.water_surface_texture_url || null,
          water_tint_color: worldData.water_tint_color ?? '#88ddff',
          // Lava pond settings
          lava_pond_chance: worldData.lava_pond_chance ?? 0,
          lava_pond_min_width: worldData.lava_pond_min_width ?? 3,
          lava_pond_max_width: worldData.lava_pond_max_width ?? 15,
          lava_pond_min_height: worldData.lava_pond_min_height ?? 3,
          lava_pond_max_height: worldData.lava_pond_max_height ?? 15,
          lava_pond_min_depth: worldData.lava_pond_min_depth ?? 3,
          lava_pond_max_depth: worldData.lava_pond_max_depth ?? 8,
          lava_surface_texture_url: worldData.lava_surface_texture_url || null,
          lava_tint_color: worldData.lava_tint_color ?? '#ff6622',
        })
        .select()
        .single();

      if (error) throw error;

      const newWorld = data as unknown as World;

      // Generate ponds if any pond chance is set
      if ((worldData.water_pond_chance ?? 0) > 0 || (worldData.lava_pond_chance ?? 0) > 0) {
        const pondSettings: WorldPondSettings = {
          water: {
            chance: worldData.water_pond_chance ?? 0,
            minWidth: worldData.water_pond_min_width ?? 5,
            maxWidth: worldData.water_pond_max_width ?? 20,
            minHeight: worldData.water_pond_min_height ?? 5,
            maxHeight: worldData.water_pond_max_height ?? 20,
            minDepth: worldData.water_pond_min_depth ?? 3,
            maxDepth: worldData.water_pond_max_depth ?? 10,
          },
          lava: {
            chance: worldData.lava_pond_chance ?? 0,
            minWidth: worldData.lava_pond_min_width ?? 3,
            maxWidth: worldData.lava_pond_max_width ?? 15,
            minHeight: worldData.lava_pond_min_height ?? 3,
            maxHeight: worldData.lava_pond_max_height ?? 15,
            minDepth: worldData.lava_pond_min_depth ?? 3,
            maxDepth: worldData.lava_pond_max_depth ?? 8,
          },
          seed: Date.now(), // Use current time as seed for randomness
        };

        try {
          await generatePondsForWorld(newWorld.id, pondSettings);
          console.log('[useWorlds] Generated ponds for world:', newWorld.id);
        } catch (pondError) {
          console.error('[useWorlds] Failed to generate ponds:', pondError);
          // Don't fail world creation if pond generation fails
        }
      }

      await fetchWorlds();
      return newWorld;
    } catch (err) {
      console.error('Error creating world:', err);
      throw err;
    }
  }, [fetchWorlds]);

  const updateWorld = useCallback(async (
    worldId: string,
    updates: Partial<Pick<World, 'name' | 'fortress_texture_url' | 'ground_texture_url' | 'sky_texture_url' | 'ambient_music_url' | 'ambient_music_volume' | 'view_settings'>>
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
