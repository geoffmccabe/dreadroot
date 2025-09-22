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
  const [loading, setLoading] = useState(true);
  const [, forceUpdate] = useState({});
  
  // Use refs to store data and only update when content actually changes
  const dataRefs = useRef({
    walls: [] as BillboardWall[],
    screenUrls: [] as ScreenUrl[],
    mediaItems: [] as MediaGridItem[],
  });

  // Track original data for change detection
  const originalData = useRef(new Map<string, any>());
  
  // Track pending changes for batch saving
  const pendingChanges = useRef(new Set<string>());
  
  // Render blocker to prevent cascading renders
  const renderInProgress = useRef(false);

  const updateData = useCallback((type: 'walls' | 'screenUrls' | 'mediaItems', data: any[]) => {
    if (renderInProgress.current) return;
    
    // Directly mutate the ref arrays to maintain stable references
    dataRefs.current[type].length = 0;
    dataRefs.current[type].push(...data);
    
    // Store original data
    data.forEach(item => {
      originalData.current.set(item.id, { ...item });
    });
    
    // Force a single re-render
    renderInProgress.current = true;
    forceUpdate({});
    setTimeout(() => {
      renderInProgress.current = false;
    }, 16); // One frame delay
  }, []);

  const fetchData = async () => {
    try {
      setLoading(true);
      
      const [wallsResult, urlsResult, mediaResult] = await Promise.all([
        supabase.from('billboard_walls').select('*').order('wall_number'),
        supabase.from('screen_urls').select('*').order('slot_number'),
        supabase.from('media_grid_items').select('*').order('wall_id, slot_number')
      ]);

      if (wallsResult.data) {
        const typedWalls = wallsResult.data.map(wall => ({
          ...wall,
          wall_type: wall.wall_type as 'screen' | 'media-grid'
        }));
        updateData('walls', typedWalls);
      }
      
      if (urlsResult.data) {
        updateData('screenUrls', urlsResult.data as ScreenUrl[]);
      }
      
      if (mediaResult.data) {
        const typedMedia = mediaResult.data.map(item => ({
          ...item,
          media_type: item.media_type as 'image' | 'video' | null
        }));
        updateData('mediaItems', typedMedia);
      }
    } catch (error) {
      console.error('Error fetching billboard data:', error);
    } finally {
      setLoading(false);
    }
  };

  // Batch save only changed data
  const savePendingChanges = async () => {
    try {
      const promises: Promise<any>[] = [];
      let savedCount = 0;

      // Save changed walls
      for (const wallId of pendingChanges.current) {
        const wall = dataRefs.current.walls.find(w => w.id === wallId);
        if (wall) {
          const original = originalData.current.get(wallId);
          if (original && (
            original.position_x !== wall.position_x ||
            original.position_y !== wall.position_y ||
            original.position_z !== wall.position_z ||
            original.rotation_x !== wall.rotation_x ||
            original.rotation_y !== wall.rotation_y ||
            original.rotation_z !== wall.rotation_z
          )) {
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
                    savedCount++;
                  }
                }))
            );
            // Update original data
            originalData.current.set(wall.id, { ...wall });
          }
        }
        
        // Check for screen URLs
        const screenUrl = dataRefs.current.screenUrls.find(s => s.id === wallId);
        if (screenUrl) {
          const original = originalData.current.get(wallId);
          if (original && original.url !== screenUrl.url) {
            promises.push(
              Promise.resolve(supabase
                .from('screen_urls')
                .update({ url: screenUrl.url })
                .eq('id', screenUrl.id)
                .then(({ error }) => {
                  if (error) {
                    console.error('Error updating screen URL:', error);
                  } else {
                    savedCount++;
                  }
                }))
            );
            originalData.current.set(screenUrl.id, { ...screenUrl });
          }
        }

        // Check for media items
        const mediaItem = dataRefs.current.mediaItems.find(m => m.id === wallId);
        if (mediaItem) {
          const original = originalData.current.get(wallId);
          if (original && (
            original.media_url !== mediaItem.media_url ||
            original.media_type !== mediaItem.media_type
          )) {
            promises.push(
              Promise.resolve(supabase
                .from('media_grid_items')
                .update({ 
                  media_url: mediaItem.media_url, 
                  media_type: mediaItem.media_type 
                })
                .eq('id', mediaItem.id)
                .then(({ error }) => {
                  if (error) {
                    console.error('Error updating media item:', error);
                  } else {
                    savedCount++;
                  }
                }))
            );
            originalData.current.set(mediaItem.id, { ...mediaItem });
          }
        }
      }

      if (promises.length > 0) {
        await Promise.all(promises);
        console.log(`Saved ${savedCount} changes to database`);
        return { success: true, count: savedCount };
      } else {
        return { success: true, count: 0 };
      }
    } catch (error) {
      console.error('Error saving pending changes:', error);
      return { success: false, error };
    } finally {
      pendingChanges.current.clear();
    }
  };

  const updateScreenUrl = useCallback(async (wallId: string, slotNumber: number, url: string) => {
    const screenUrl = dataRefs.current.screenUrls.find(s => s.wall_id === wallId && s.slot_number === slotNumber);
    if (!screenUrl) return;

    // Update in-place to maintain reference stability
    const index = dataRefs.current.screenUrls.findIndex(s => s.id === screenUrl.id);
    if (index !== -1) {
      dataRefs.current.screenUrls[index] = { ...screenUrl, url };
      pendingChanges.current.add(screenUrl.id);
    }
  }, []);

  const updateMediaItem = useCallback(async (wallId: string, slotNumber: number, mediaUrl: string | null, mediaType: 'image' | 'video' | null) => {
    const mediaItem = dataRefs.current.mediaItems.find(m => m.wall_id === wallId && m.slot_number === slotNumber);
    if (!mediaItem) return false;

    // Update in-place to maintain reference stability
    const index = dataRefs.current.mediaItems.findIndex(m => m.id === mediaItem.id);
    if (index !== -1) {
      dataRefs.current.mediaItems[index] = { ...mediaItem, media_url: mediaUrl, media_type: mediaType };
      
      // Save immediately to database
      try {
        const { error } = await supabase
          .from('media_grid_items')
          .update({ media_url: mediaUrl, media_type: mediaType })
          .eq('id', mediaItem.id);
          
        if (error) {
          console.error('Error saving media item:', error);
          return false;
        }
        
        originalData.current.set(mediaItem.id, { ...mediaItem, media_url: mediaUrl, media_type: mediaType });
        return true;
      } catch (error) {
        console.error('Exception saving media item:', error);
        return false;
      }
    }
    return false;
  }, []);

  const updateWallPosition = useCallback(async (wallId: string, position: { x: number; y: number; z: number }, rotation: { x: number; y: number; z: number }) => {
    const index = dataRefs.current.walls.findIndex(wall => wall.id === wallId);
    if (index !== -1) {
      // Update in-place to maintain reference stability
      dataRefs.current.walls[index] = {
        ...dataRefs.current.walls[index],
        position_x: position.x,
        position_y: position.y,
        position_z: position.z,
        rotation_x: rotation.x,
        rotation_y: rotation.y,
        rotation_z: rotation.z
      };
      
      pendingChanges.current.add(wallId);
    }
  }, []);

  const uploadMedia = async (file: File): Promise<string | null> => {
    try {
      const fileExt = file.name.split('.').pop();
      const fileName = `${Math.random()}.${fileExt}`;
      const filePath = `${fileName}`;

      const { error: uploadError } = await supabase.storage
        .from('billboard-media')
        .upload(filePath, file);

      if (uploadError) {
        console.error('Supabase upload error:', uploadError);
        throw uploadError;
      }
      
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

    // Minimal real-time subscriptions - no debouncing to prevent complexity
    const wallsChannel = supabase
      .channel('billboard_walls_changes')
      .on('postgres_changes', 
        { event: '*', schema: 'public', table: 'billboard_walls' },
        (payload) => {
          if (payload.eventType === 'UPDATE' && !renderInProgress.current) {
            const updatedWall = payload.new as BillboardWall;
            
            // Only update if not currently in a pending change
            if (!pendingChanges.current.has(updatedWall.id)) {
              const index = dataRefs.current.walls.findIndex(w => w.id === updatedWall.id);
              if (index !== -1) {
                dataRefs.current.walls[index] = updatedWall;
                originalData.current.set(updatedWall.id, { ...updatedWall });
                forceUpdate({});
              }
            }
          }
        }
      )
      .subscribe();

    const urlsChannel = supabase
      .channel('screen_urls_changes')
      .on('postgres_changes',
        { event: '*', schema: 'public', table: 'screen_urls' },
        (payload) => {
          if (payload.eventType === 'UPDATE' && !renderInProgress.current) {
            const updatedUrl = payload.new as ScreenUrl;
            
            if (!pendingChanges.current.has(updatedUrl.id)) {
              const index = dataRefs.current.screenUrls.findIndex(u => u.id === updatedUrl.id);
              if (index !== -1) {
                dataRefs.current.screenUrls[index] = updatedUrl;
                originalData.current.set(updatedUrl.id, { ...updatedUrl });
                forceUpdate({});
              }
            }
          }
        }
      )
      .subscribe();

    const mediaChannel = supabase
      .channel('media_items_changes')
      .on('postgres_changes',
        { event: '*', schema: 'public', table: 'media_grid_items' },
        (payload) => {
          if (payload.eventType === 'UPDATE' && !renderInProgress.current) {
            const updatedMedia = payload.new as MediaGridItem;
            
            if (!pendingChanges.current.has(updatedMedia.id)) {
              const index = dataRefs.current.mediaItems.findIndex(m => m.id === updatedMedia.id);
              if (index !== -1) {
                dataRefs.current.mediaItems[index] = { 
                  ...updatedMedia, 
                  media_type: updatedMedia.media_type as 'image' | 'video' | null 
                };
                originalData.current.set(updatedMedia.id, { ...updatedMedia });
                forceUpdate({});
              }
            }
          }
        }
      )
      .subscribe();

    // Auto-save pending changes
    const saveInterval = setInterval(() => {
      if (pendingChanges.current.size > 0) {
        savePendingChanges();
      }
    }, 2000);

    return () => {
      supabase.removeChannel(wallsChannel);
      supabase.removeChannel(urlsChannel); 
      supabase.removeChannel(mediaChannel);
      clearInterval(saveInterval);
    };
  }, []);

  return {
    walls: dataRefs.current.walls,
    screenUrls: dataRefs.current.screenUrls,
    mediaItems: dataRefs.current.mediaItems,
    loading,
    updateScreenUrl,
    updateMediaItem,
    updateWallPosition,
    uploadMedia,
    refetchData: fetchData,
    savePendingChanges
  };
};