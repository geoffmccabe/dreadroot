import { useState, useEffect } from 'react';
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

  const fetchData = async () => {
    try {
      setLoading(true);
      
      const { data: wallsData } = await supabase
        .from('billboard_walls')
        .select('*')
        .order('wall_number');

      const { data: urlsData } = await supabase
        .from('screen_urls')
        .select('*')
        .order('slot_number');

      const { data: mediaData } = await supabase
        .from('media_grid_items')
        .select('*')
        .order('wall_id, slot_number');

      if (wallsData) setWalls(wallsData as BillboardWall[]);
      if (urlsData) setScreenUrls(urlsData as ScreenUrl[]);
      if (mediaData) setMediaItems(mediaData as MediaGridItem[]);
    } catch (error) {
      console.error('Error fetching billboard data:', error);
    } finally {
      setLoading(false);
    }
  };

  const updateScreenUrl = async (wallId: string, slotNumber: number, url: string) => {
    try {
      const { error } = await supabase
        .from('screen_urls')
        .update({ url })
        .eq('wall_id', wallId)
        .eq('slot_number', slotNumber);

      if (error) throw error;
      await fetchData();
    } catch (error) {
      console.error('Error updating screen URL:', error);
    }
  };

  const updateMediaItem = async (wallId: string, slotNumber: number, mediaUrl: string | null, mediaType: 'image' | 'video' | null) => {
    try {
      const { error } = await supabase
        .from('media_grid_items')
        .update({ media_url: mediaUrl, media_type: mediaType })
        .eq('wall_id', wallId)
        .eq('slot_number', slotNumber);

      if (error) throw error;
      await fetchData();
    } catch (error) {
      console.error('Error updating media item:', error);
    }
  };

  const updateWallPosition = async (wallId: string, position: { x: number; y: number; z: number }, rotation: { x: number; y: number; z: number }) => {
    try {
      const { error } = await supabase
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

      if (error) throw error;
      await fetchData();
    } catch (error) {
      console.error('Error updating wall position:', error);
    }
  };

  const uploadMedia = async (file: File): Promise<string | null> => {
    try {
      const fileExt = file.name.split('.').pop();
      const fileName = `${Math.random()}.${fileExt}`;
      const filePath = `${fileName}`;

      const { error: uploadError } = await supabase.storage
        .from('billboard-media')
        .upload(filePath, file);

      if (uploadError) throw uploadError;

      const { data } = supabase.storage
        .from('billboard-media')
        .getPublicUrl(filePath);

      return data.publicUrl;
    } catch (error) {
      console.error('Error uploading media:', error);
      return null;
    }
  };

  useEffect(() => {
    fetchData();
  }, []);

  return {
    walls,
    screenUrls,
    mediaItems,
    loading,
    updateScreenUrl,
    updateMediaItem,
    updateWallPosition,
    uploadMedia,
    refetch: fetchData
  };
};