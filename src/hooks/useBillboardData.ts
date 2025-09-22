import { useState, useEffect, useRef, useCallback } from 'react';
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
  
  // Track original data to detect changes
  const originalData = useRef<{
    walls: Map<string, BillboardWall>;
    screenUrls: Map<string, ScreenUrl>;
    mediaItems: Map<string, MediaGridItem>;
  }>({
    walls: new Map(),
    screenUrls: new Map(),
    mediaItems: new Map()
  });

  // Track pending changes for batch saving
  const pendingChanges = useRef<{
    walls: Set<string>;
    screenUrls: Set<string>;
    mediaItems: Set<string>;
  }>({
    walls: new Set(),
    screenUrls: new Set(),
    mediaItems: new Set()
  });

  const fetchData = async () => {
    try {
      console.log('🔄 Fetching billboard data from database...');
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

      if (wallsData) {
        console.log('📍 Loaded wall positions from database:', wallsData.map(w => ({
          wall: w.wall_number,
          position: { x: w.position_x, y: w.position_y, z: w.position_z },
          rotation: { x: w.rotation_x, y: w.rotation_y, z: w.rotation_z }
        })));
        
        const typedWalls = wallsData.map(wall => ({
          ...wall,
          wall_type: wall.wall_type as 'screen' | 'media-grid'
        }));
        setWalls(typedWalls);
        // Update original data reference
        originalData.current.walls.clear();
        typedWalls.forEach(wall => {
          originalData.current.walls.set(wall.id, { ...wall });
        });
      }
      
      if (urlsData) {
        console.log('🔗 Loaded screen URLs:', urlsData.length, 'records');
        setScreenUrls(urlsData as ScreenUrl[]);
        originalData.current.screenUrls.clear();
        urlsData.forEach(url => {
          originalData.current.screenUrls.set(url.id, { ...url });
        });
      }
      
      if (mediaData) {
        console.log('🖼️ Loaded media items:', mediaData.length, 'records');
        const typedMedia = mediaData.map(item => ({
          ...item,
          media_type: item.media_type as 'image' | 'video' | null
        }));
        setMediaItems(typedMedia);
        originalData.current.mediaItems.clear();
        typedMedia.forEach(item => {
          originalData.current.mediaItems.set(item.id, { ...item });
        });
      }
    } catch (error) {
      console.error('❌ Error fetching billboard data:', error);
    } finally {
      setLoading(false);
    }
  };

  // Batch save only changed data
  const savePendingChanges = async () => {
    try {
      const promises: Promise<any>[] = [];

      // Save changed walls
      if (pendingChanges.current.walls.size > 0) {
        console.log(`Saving ${pendingChanges.current.walls.size} wall position changes...`);
        const wallsToUpdate = walls.filter(wall => 
          pendingChanges.current.walls.has(wall.id)
        );

        for (const wall of wallsToUpdate) {
          const original = originalData.current.walls.get(wall.id);
          if (original && (
            original.position_x !== wall.position_x ||
            original.position_y !== wall.position_y ||
            original.position_z !== wall.position_z ||
            original.rotation_x !== wall.rotation_x ||
            original.rotation_y !== wall.rotation_y ||
            original.rotation_z !== wall.rotation_z
          )) {
            console.log(`Updating wall ${wall.wall_number} position:`, {
              from: { x: original.position_x, y: original.position_y, z: original.position_z },
              to: { x: wall.position_x, y: wall.position_y, z: wall.position_z }
            });
            
            promises.push(
              Promise.resolve(supabase
                .from('billboard_walls')
                .update({
                  position_x: wall.position_x,
                  position_y: wall.position_y,
                  position_z: wall.position_z,
                  rotation_x: wall.rotation_x,
                  rotation_y: wall.rotation_y,
                  rotation_z: wall.rotation_z
                })
                .eq('id', wall.id)
                .then(({ error }) => {
                  if (error) {
                    console.error('Error updating wall position:', error);
                  } else {
                    console.log(`Wall ${wall.wall_number} position saved successfully`);
                  }
                }))
            );
            // Update original data
            originalData.current.walls.set(wall.id, { ...wall });
          }
        }
        pendingChanges.current.walls.clear();
      }

      // Save changed screen URLs
      if (pendingChanges.current.screenUrls.size > 0) {
        console.log(`Saving ${pendingChanges.current.screenUrls.size} screen URL changes...`);
        const urlsToUpdate = screenUrls.filter(url => 
          pendingChanges.current.screenUrls.has(url.id)
        );

        for (const url of urlsToUpdate) {
          const original = originalData.current.screenUrls.get(url.id);
          if (original && original.url !== url.url) {
            promises.push(
              Promise.resolve(supabase
                .from('screen_urls')
                .update({ url: url.url })
                .eq('id', url.id)
                .then(({ error }) => {
                  if (error) {
                    console.error('Error updating screen URL:', error);
                  } else {
                    console.log('Screen URL saved successfully');
                  }
                }))
            );
            originalData.current.screenUrls.set(url.id, { ...url });
          }
        }
        pendingChanges.current.screenUrls.clear();
      }

      // Save changed media items
      if (pendingChanges.current.mediaItems.size > 0) {
        console.log(`Saving ${pendingChanges.current.mediaItems.size} media item changes...`);
        const itemsToUpdate = mediaItems.filter(item => 
          pendingChanges.current.mediaItems.has(item.id)
        );

        for (const item of itemsToUpdate) {
          const original = originalData.current.mediaItems.get(item.id);
          if (original && (
            original.media_url !== item.media_url ||
            original.media_type !== item.media_type
          )) {
            promises.push(
              Promise.resolve(supabase
                .from('media_grid_items')
                .update({ 
                  media_url: item.media_url, 
                  media_type: item.media_type 
                })
                .eq('id', item.id)
                .then(({ error }) => {
                  if (error) {
                    console.error('Error updating media item:', error);
                  } else {
                    console.log('Media item saved successfully');
                  }
                }))
            );
            originalData.current.mediaItems.set(item.id, { ...item });
          }
        }
        pendingChanges.current.mediaItems.clear();
      }

      if (promises.length > 0) {
        await Promise.all(promises);
        console.log(`✅ Saved ${promises.length} changes to database`);
      } else {
        console.log('No pending changes to save');
      }
    } catch (error) {
      console.error('Error saving pending changes:', error);
    }
  };

  const updateScreenUrl = async (wallId: string, slotNumber: number, url: string) => {
    // Find the screen URL record
    const screenUrl = screenUrls.find(s => s.wall_id === wallId && s.slot_number === slotNumber);
    if (!screenUrl) return;

    // Update local state immediately
    setScreenUrls(prev => 
      prev.map(s => 
        s.id === screenUrl.id ? { ...s, url } : s
      )
    );

    // Mark as pending change
    pendingChanges.current.screenUrls.add(screenUrl.id);
  };

  const updateMediaItem = async (wallId: string, slotNumber: number, mediaUrl: string | null, mediaType: 'image' | 'video' | null) => {
    console.log('updateMediaItem called with:', { wallId, slotNumber, mediaUrl, mediaType });
    console.log('Current mediaItems:', mediaItems.length, 'items');
    
    // Find the media item record
    let mediaItem = mediaItems.find(m => m.wall_id === wallId && m.slot_number === slotNumber);
    console.log('Found mediaItem:', mediaItem);
    
    if (!mediaItem) {
      console.error('Media item not found for wallId:', wallId, 'slotNumber:', slotNumber);
      console.log('Available media items:', mediaItems.map(m => ({ wall_id: m.wall_id, slot_number: m.slot_number })));
      return;
    }

    // Update local state immediately  
    setMediaItems(prev => {
      const updated = prev.map(m => 
        m.id === mediaItem.id ? { ...m, media_url: mediaUrl, media_type: mediaType } : m
      );
      console.log('Updated local mediaItems state');
      return updated;
    });

    // Mark as pending change
    pendingChanges.current.mediaItems.add(mediaItem.id);
    console.log('Added to pending changes:', mediaItem.id);
  };

  const updateWallPosition = async (wallId: string, position: { x: number; y: number; z: number }, rotation: { x: number; y: number; z: number }) => {
    console.log('🔄 updateWallPosition called:', { wallId, position, rotation });
    
    // Update local state immediately
    setWalls(prevWalls => 
      prevWalls.map(wall => 
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
      )
    );

    // Mark as pending change
    pendingChanges.current.walls.add(wallId);
    console.log('✅ Wall marked as pending change. Total pending walls:', pendingChanges.current.walls.size);
    
    // Also update the original data to reflect new values for comparison
    const wall = walls.find(w => w.id === wallId);
    if (wall) {
      originalData.current.walls.set(wallId, {
        ...wall,
        position_x: position.x,
        position_y: position.y,
        position_z: position.z,
        rotation_x: rotation.x,
        rotation_y: rotation.y,
        rotation_z: rotation.z
      });
    }
  };

  // Manual save function for immediate saves
  const saveChangesNow = useCallback(async () => {
    console.log('🚀 Manual save triggered');
    await savePendingChanges();
  }, []);

  const uploadMedia = async (file: File): Promise<string | null> => {
    try {
      console.log('Uploading file:', file.name, file.type, file.size, 'bytes');
      
      const fileExt = file.name.split('.').pop();
      const fileName = `${Math.random()}.${fileExt}`;
      const filePath = `${fileName}`;
      
      console.log('Upload path:', filePath);

      const { error: uploadError } = await supabase.storage
        .from('billboard-media')
        .upload(filePath, file);

      if (uploadError) {
        console.error('Supabase upload error:', uploadError);
        throw uploadError;
      }

      console.log('File uploaded successfully, getting public URL...');
      
      const { data } = supabase.storage
        .from('billboard-media')
        .getPublicUrl(filePath);

      console.log('Public URL generated:', data.publicUrl);
      return data.publicUrl;
    } catch (error) {
      console.error('Error uploading media:', error);
      return null;
    }
  };

  useEffect(() => {
    fetchData();

    // Set up real-time subscriptions
    const wallsChannel = supabase
      .channel('billboard_walls_changes')
      .on('postgres_changes', 
        { event: '*', schema: 'public', table: 'billboard_walls' },
        (payload) => {
          if (payload.eventType === 'UPDATE') {
            const updatedWall = payload.new as BillboardWall;
            setWalls(prev => prev.map(wall => 
              wall.id === updatedWall.id ? updatedWall : wall
            ));
            originalData.current.walls.set(updatedWall.id, { ...updatedWall });
          }
        }
      )
      .subscribe();

    const urlsChannel = supabase
      .channel('screen_urls_changes')
      .on('postgres_changes',
        { event: '*', schema: 'public', table: 'screen_urls' },
        (payload) => {
          if (payload.eventType === 'UPDATE') {
            const updatedUrl = payload.new as ScreenUrl;
            setScreenUrls(prev => prev.map(url => 
              url.id === updatedUrl.id ? updatedUrl : url
            ));
            originalData.current.screenUrls.set(updatedUrl.id, { ...updatedUrl });
          }
        }
      )
      .subscribe();

    const mediaChannel = supabase
      .channel('media_grid_items_changes')
      .on('postgres_changes',
        { event: '*', schema: 'public', table: 'media_grid_items' },
        (payload) => {
          if (payload.eventType === 'UPDATE') {
            const updatedItem = payload.new as MediaGridItem;
            setMediaItems(prev => prev.map(item => 
              item.id === updatedItem.id ? updatedItem : item
            ));
            originalData.current.mediaItems.set(updatedItem.id, { ...updatedItem });
          }
        }
      )
      .subscribe();

    // Set up batch saving every 30 seconds
    const saveInterval = setInterval(savePendingChanges, 30000);

    return () => {
      supabase.removeChannel(wallsChannel);
      supabase.removeChannel(urlsChannel);
      supabase.removeChannel(mediaChannel);
      clearInterval(saveInterval);
      // Save any pending changes on cleanup
      savePendingChanges();
    };
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
    saveChangesNow,
    refetch: fetchData
  };
};