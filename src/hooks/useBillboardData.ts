import { useState, useEffect, useMemo, useCallback, useRef } from 'react';
import { supabase } from '@/integrations/supabase/client';

export interface BillboardWall {
  id: string;
  wall_number: number;
  wall_type: 'screen' | 'media-grid';
  position_x?: number;
  position_y?: number;
  position_z?: number;
  rotation_x?: number;
  rotation_y?: number;
  rotation_z?: number;
}

export interface ScreenUrl {
  id: string;
  wall_id: string;
  slot_number: number;
  url: string | null;
}

export interface MediaGridItem {
  id: string;
  wall_id: string;
  slot_number: number;
  media_url: string | null;
  media_type: 'image' | 'video' | null;
}

export const useBillboardData = () => {
  const [walls, setWalls] = useState<BillboardWall[]>([]);
  const [screenUrls, setScreenUrls] = useState<ScreenUrl[]>([]);
  const [mediaItems, setMediaItems] = useState<MediaGridItem[]>([]);
  const [loading, setLoading] = useState(true);
  
  // Refs to access current state without creating dependencies
  const screenUrlsRef = useRef<ScreenUrl[]>([]);
  const mediaItemsRef = useRef<MediaGridItem[]>([]);
  
  // Update refs when state changes
  useEffect(() => {
    screenUrlsRef.current = screenUrls;
  }, [screenUrls]);
  
  useEffect(() => {
    mediaItemsRef.current = mediaItems;
  }, [mediaItems]);
  
  const fetchData = useCallback(async () => {
    try {
      setLoading(true);
      
      const [wallsResult, urlsResult, mediaResult] = await Promise.all([
        supabase.from('billboard_walls').select('*').order('wall_number'),
        supabase.from('screen_urls').select('*').order('slot_number'),
        supabase.from('media_grid_items').select('*').order('wall_id, slot_number')
      ]);

      if (wallsResult.data) {
        setWalls(wallsResult.data.map(wall => ({
          ...wall,
          wall_type: wall.wall_type as 'screen' | 'media-grid'
        })));
      }
      
      if (urlsResult.data) {
        setScreenUrls(urlsResult.data as ScreenUrl[]);
      }
      
      if (mediaResult.data) {
        setMediaItems(mediaResult.data.map(item => ({
          ...item,
          media_type: item.media_type as 'image' | 'video' | null
        })));
      }
    } catch (error) {
      console.error('Error fetching billboard data:', error);
    } finally {
      setLoading(false);
    }
  }, []);

  const updateScreenUrl = useCallback(async (wallId: string, slotNumber: number, url: string) => {
    const screenUrl = screenUrlsRef.current.find(s => s.wall_id === wallId && s.slot_number === slotNumber);
    if (!screenUrl) return;

    setScreenUrls(prev => prev.map(s => 
      s.id === screenUrl.id ? { ...s, url } : s
    ));

    await supabase
      .from('screen_urls')
      .update({ url })
      .eq('id', screenUrl.id);
  }, []);

  const updateMediaItem = useCallback(async (wallId: string, slotNumber: number, mediaUrl: string | null, mediaType: 'image' | 'video' | null) => {
    const mediaItem = mediaItemsRef.current.find(m => m.wall_id === wallId && m.slot_number === slotNumber);
    if (!mediaItem) return false;

    setMediaItems(prev => prev.map(m => 
      m.id === mediaItem.id ? { ...m, media_url: mediaUrl, media_type: mediaType } : m
    ));

    const { error } = await supabase
      .from('media_grid_items')
      .update({ media_url: mediaUrl, media_type: mediaType })
      .eq('id', mediaItem.id);
      
    // Trigger atlas rebuild when media item is updated
    if (!error && mediaType === 'image') {
      const wall = walls.find(w => w.id === wallId);
      if (wall) {
        console.log(`🔔 Triggering atlas rebuild for wall ${wall.wall_number}`);
        window.dispatchEvent(new CustomEvent('rebuildAtlas', { detail: { wallNumber: wall.wall_number } }));
      }
    }
      
    return !error;
  }, [walls]);

  const updateWallPosition = useCallback(async (wallId: string, position: { x: number; y: number; z: number }, rotation: { x: number; y: number; z: number }) => {
    setWalls(prevWalls => prevWalls.map(wall => 
      wall.id === wallId 
        ? {
            ...wall,
            position_x: position.x,
            position_y: position.y,
            position_z: position.z,
            rotation_x: rotation.x,
            rotation_y: rotation.y,
            rotation_z: rotation.z
          }
        : wall
    ));

    await supabase
      .from('billboard_walls')
      .update({
        position_x: position.x,
        position_y: position.y,
        position_z: position.z,
        rotation_x: rotation.x,
        rotation_y: rotation.y,
        rotation_z: rotation.z
      })
      .eq('id', wallId);
  }, []);

  const uploadMedia = useCallback(async (file: File): Promise<string | null> => {
    try {
      const fileExt = file.name.split('.').pop();
      const fileName = `${Math.random()}.${fileExt}`;
      
      const { error: uploadError } = await supabase.storage
        .from('billboard-media')
        .upload(fileName, file);

      if (uploadError) throw uploadError;
      
      const { data } = supabase.storage
        .from('billboard-media')
        .getPublicUrl(fileName);

      return data.publicUrl;
    } catch (error) {
      console.error('Error uploading media:', error);
      return null;
    }
  }, []);

  useEffect(() => {
    fetchData();
  }, [fetchData]);

  // Return stable memoized values to prevent unnecessary re-renders
  return useMemo(() => ({
    walls,
    screenUrls,
    mediaItems,
    loading,
    updateScreenUrl,
    updateMediaItem,
    updateWallPosition,
    uploadMedia,
    refetch: fetchData
  }), [walls, screenUrls, mediaItems, loading, updateScreenUrl, updateMediaItem, updateWallPosition, uploadMedia, fetchData]);
};