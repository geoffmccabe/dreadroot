import { useState, useEffect, useRef, useMemo, useCallback } from 'react';
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
  const [wallsState, setWallsState] = useState<BillboardWall[]>([]);
  const [screenUrlsState, setScreenUrlsState] = useState<ScreenUrl[]>([]);
  const [mediaItemsState, setMediaItemsState] = useState<MediaGridItem[]>([]);
  const [loading, setLoading] = useState(true);
  
  // Debounce refs for real-time updates
  const debounceTimeouts = useRef<{
    walls: NodeJS.Timeout | null;
    screenUrls: NodeJS.Timeout | null;
    mediaItems: NodeJS.Timeout | null;
  }>({
    walls: null,
    screenUrls: null,
    mediaItems: null
  });
  
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

  // Use refs to track last content for deep comparison
  const lastContent = useRef<{
    walls: string;
    screenUrls: string;
    mediaItems: string;
  }>({
    walls: '',
    screenUrls: '',
    mediaItems: ''
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

  // Stable refs for arrays to prevent reference changes
  const wallsRef = useRef<BillboardWall[]>([]);
  const screenUrlsRef = useRef<ScreenUrl[]>([]);
  const mediaItemsRef = useRef<MediaGridItem[]>([]);

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

      if (wallsData) {
        
        const typedWalls = wallsData.map(wall => ({
          ...wall,
          wall_type: wall.wall_type as 'screen' | 'media-grid'
        }));
        setWallsState(typedWalls);
        // Update original data reference
        originalData.current.walls.clear();
        typedWalls.forEach(wall => {
          originalData.current.walls.set(wall.id, { ...wall });
        });
      }
      
      if (urlsData) {
        
        setScreenUrlsState(urlsData as ScreenUrl[]);
        originalData.current.screenUrls.clear();
        urlsData.forEach(url => {
          originalData.current.screenUrls.set(url.id, { ...url });
        });
      }
      
      if (mediaData) {
        
        const typedMedia = mediaData.map(item => ({
          ...item,
          media_type: item.media_type as 'image' | 'video' | null
        }));
        setMediaItemsState(typedMedia);
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
    console.log('💾 savePendingChanges called. Pending changes:', {
      walls: pendingChanges.current.walls.size,
      screenUrls: pendingChanges.current.screenUrls.size,
      mediaItems: pendingChanges.current.mediaItems.size
    });
    
    try {
      const promises: Promise<any>[] = [];
      let savedCount = 0;

      // Save changed walls
      if (pendingChanges.current.walls.size > 0) {
        console.log(`💾 Saving ${pendingChanges.current.walls.size} wall position changes...`);
        const wallsToUpdate = wallsState.filter(wall => 
          pendingChanges.current.walls.has(wall.id)
        );

        for (const wall of wallsToUpdate) {
          const original = originalData.current.walls.get(wall.id);
          console.log('🔍 Checking wall', wall.wall_number, 'for changes:', {
            wallId: wall.id,
            original: original ? { x: original.position_x, y: original.position_y, z: original.position_z } : 'NOT_FOUND',
            current: { x: wall.position_x, y: wall.position_y, z: wall.position_z },
            hasChanged: original && (
              original.position_x !== wall.position_x ||
              original.position_y !== wall.position_y ||
              original.position_z !== wall.position_z ||
              original.rotation_x !== wall.rotation_x ||
              original.rotation_y !== wall.rotation_y ||
              original.rotation_z !== wall.rotation_z
            )
          });
          
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
                    savedCount++;
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
        const urlsToUpdate = screenUrlsState.filter(url => 
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
                    savedCount++;
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
        const itemsToUpdate = mediaItemsState.filter(item => 
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
                    savedCount++;
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
        console.log(`✅ Saved ${savedCount} changes to database`);
        return { success: true, count: savedCount };
      } else {
        console.log('No pending changes to save');
        return { success: true, count: 0 };
      }
    } catch (error) {
      console.error('Error saving pending changes:', error);
      return { success: false, error };
    }
  };

  const updateScreenUrl = useCallback(async (wallId: string, slotNumber: number, url: string) => {
    // Find the screen URL record
    const screenUrl = screenUrlsState.find(s => s.wall_id === wallId && s.slot_number === slotNumber);
    if (!screenUrl) return;

    // Update local state immediately
    setScreenUrlsState(prev => 
      prev.map(s => 
        s.id === screenUrl.id ? { ...s, url } : s
      )
    );

    // Mark as pending change
    pendingChanges.current.screenUrls.add(screenUrl.id);
  }, [screenUrlsState]);

  const updateMediaItem = useCallback(async (wallId: string, slotNumber: number, mediaUrl: string | null, mediaType: 'image' | 'video' | null) => {
    console.log('🖼️ updateMediaItem called with:', { wallId, slotNumber, mediaUrl, mediaType });
    console.log('🖼️ Current mediaItems:', mediaItemsState.length, 'items');
    
    // Find the media item record
    let mediaItem = mediaItemsState.find(m => m.wall_id === wallId && m.slot_number === slotNumber);
    console.log('🖼️ Found mediaItem:', mediaItem);
    
    if (!mediaItem) {
      console.error('❌ Media item not found for wallId:', wallId, 'slotNumber:', slotNumber);
      console.log('🖼️ Available media items:', mediaItemsState.map(m => ({ 
        id: m.id.substring(0, 8) + '...', 
        wall_id: m.wall_id.substring(0, 8) + '...', 
        slot_number: m.slot_number 
      })));
      return false;
    }

    // Update local state immediately  
    setMediaItemsState(prev => {
      const updated = prev.map(m => 
        m.id === mediaItem.id ? { ...m, media_url: mediaUrl, media_type: mediaType } : m
      );
      console.log('✅ Updated local mediaItems state for slot', slotNumber);
      return updated;
    });

    // Mark as pending change
    pendingChanges.current.mediaItems.add(mediaItem.id);
    console.log('📝 Added to pending changes:', mediaItem.id.substring(0, 8) + '...');
    
    // Immediately save the media item change
    try {
      console.log('💾 Immediately saving media item change...');
      const { error } = await supabase
        .from('media_grid_items')
        .update({ 
          media_url: mediaUrl, 
          media_type: mediaType 
        })
        .eq('id', mediaItem.id);
        
      if (error) {
        console.error('❌ Error saving media item:', error);
        return false;
      } else {
        console.log('✅ Media item saved successfully to database');
        // Update original data
        originalData.current.mediaItems.set(mediaItem.id, { ...mediaItem, media_url: mediaUrl, media_type: mediaType });
        // Remove from pending since it's saved
        pendingChanges.current.mediaItems.delete(mediaItem.id);
        return true;
      }
    } catch (error) {
      console.error('❌ Exception saving media item:', error);
      return false;
    }
  }, [mediaItemsState]);

  const updateWallPosition = useCallback(async (wallId: string, position: { x: number; y: number; z: number }, rotation: { x: number; y: number; z: number }) => {
    console.log('🎯 updateWallPosition called:', { wallId, position, rotation });
    console.log('🎯 Walls before update:', wallsState.map(w => ({ id: w.id, number: w.wall_number, pos: { x: w.position_x, y: w.position_y, z: w.position_z }})));
    
    // Update local state immediately
    setWallsState(prevWalls => {
      const updated = prevWalls.map(wall => 
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
      );
      console.log('🎯 Walls after update:', updated.map(w => ({ id: w.id, number: w.wall_number, pos: { x: w.position_x, y: w.position_y, z: w.position_z }})));
      return updated;
    });

    // Mark as pending change
    pendingChanges.current.walls.add(wallId);
    console.log('📝 Added wall to pending changes. Pending walls:', Array.from(pendingChanges.current.walls));
    console.log('📝 Total pending changes:', {
      walls: pendingChanges.current.walls.size,
      screenUrls: pendingChanges.current.screenUrls.size,
      mediaItems: pendingChanges.current.mediaItems.size
    });
  }, [wallsState]);

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

    // Set up real-time subscriptions with debouncing to prevent flashing
    const wallsChannel = supabase
      .channel('billboard_walls_changes')
      .on('postgres_changes', 
        { event: '*', schema: 'public', table: 'billboard_walls' },
        (payload) => {
          if (payload.eventType === 'UPDATE') {
            const updatedWall = payload.new as BillboardWall;
            console.log('📡 Real-time wall update received:', updatedWall.wall_number, {
              position: { x: updatedWall.position_x, y: updatedWall.position_y, z: updatedWall.position_z }
            });
            
            // Debounce wall updates to prevent flashing
            if (debounceTimeouts.current.walls) {
              clearTimeout(debounceTimeouts.current.walls);
            }
            
            debounceTimeouts.current.walls = setTimeout(() => {
              const currentWall = wallsState.find(w => w.id === updatedWall.id);
              const positionChanged = !currentWall || 
                currentWall.position_x !== updatedWall.position_x ||
                currentWall.position_y !== updatedWall.position_y ||
                currentWall.position_z !== updatedWall.position_z ||
                currentWall.rotation_x !== updatedWall.rotation_x ||
                currentWall.rotation_y !== updatedWall.rotation_y ||
                currentWall.rotation_z !== updatedWall.rotation_z;
              
              if (!pendingChanges.current.walls.has(updatedWall.id) && positionChanged) {
                setWallsState(prev => prev.map(wall => 
                  wall.id === updatedWall.id ? updatedWall : wall
                ));
                originalData.current.walls.set(updatedWall.id, { ...updatedWall });
              }
            }, 1000);
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
            
            // Debounce URL updates
            if (debounceTimeouts.current.screenUrls) {
              clearTimeout(debounceTimeouts.current.screenUrls);
            }
            
            debounceTimeouts.current.screenUrls = setTimeout(() => {
              setScreenUrlsState(prev => prev.map(url => 
                url.id === updatedUrl.id ? updatedUrl : url
              ));
              originalData.current.screenUrls.set(updatedUrl.id, { ...updatedUrl });
            }, 100);
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
            
            // Debounce media updates to prevent flashing
            if (debounceTimeouts.current.mediaItems) {
              clearTimeout(debounceTimeouts.current.mediaItems);
            }
            
            debounceTimeouts.current.mediaItems = setTimeout(() => {
              const currentItem = mediaItemsState.find(item => item.id === updatedItem.id);
              const contentChanged = !currentItem || 
                currentItem.media_url !== updatedItem.media_url ||
                currentItem.media_type !== updatedItem.media_type;
              
              if (!pendingChanges.current.mediaItems.has(updatedItem.id) && contentChanged) {
                setMediaItemsState(prev => prev.map(item => 
                  item.id === updatedItem.id ? updatedItem : item
                ));
                originalData.current.mediaItems.set(updatedItem.id, { ...updatedItem });
                console.log('📡 Applied debounced media update for item:', updatedItem.id.substring(0, 8));
              }
            }, 100);
          }
        }
      )
      .subscribe();

    // Set up batch saving every 30 seconds
    console.log('⏰ Setting up auto-save interval (30 seconds)');
    const saveInterval = setInterval(() => {
      console.log('⏰ Auto-save triggered by interval');
      savePendingChanges();
    }, 30000);

    return () => {
      // Clear any pending debounce timeouts
      Object.values(debounceTimeouts.current).forEach(timeout => {
        if (timeout) clearTimeout(timeout);
      });
      
      supabase.removeChannel(wallsChannel);
      supabase.removeChannel(urlsChannel);
      supabase.removeChannel(mediaChannel);
      clearInterval(saveInterval);
      // Save any pending changes on cleanup
      savePendingChanges();
    };
  }, []);

  // Stabilized arrays with deep content comparison to prevent constant re-renders
  const walls = useMemo(() => {
    const sorted = wallsState.slice().sort((a, b) => a.wall_number - b.wall_number);
    const contentHash = JSON.stringify(sorted.map(w => ({
      id: w.id,
      wall_number: w.wall_number,
      wall_type: w.wall_type,
      position_x: w.position_x,
      position_y: w.position_y,
      position_z: w.position_z,
      rotation_x: w.rotation_x,
      rotation_y: w.rotation_y,
      rotation_z: w.rotation_z
    })));
    
    if (lastContent.current.walls === contentHash) {
      return wallsRef.current || sorted;
    }
    
    lastContent.current.walls = contentHash;
    wallsRef.current = sorted;
    return sorted;
  }, [wallsState]);

  const screenUrls = useMemo(() => {
    const sorted = screenUrlsState.slice().sort((a, b) => a.slot_number - b.slot_number);
    const contentHash = JSON.stringify(sorted.map(s => ({
      id: s.id,
      wall_id: s.wall_id,
      slot_number: s.slot_number,
      url: s.url
    })));
    
    if (lastContent.current.screenUrls === contentHash) {
      return screenUrlsRef.current || sorted;
    }
    
    lastContent.current.screenUrls = contentHash;
    screenUrlsRef.current = sorted;
    return sorted;
  }, [screenUrlsState]);

  const mediaItems = useMemo(() => {
    const sorted = mediaItemsState.slice().sort((a, b) => {
      if (a.wall_id !== b.wall_id) return a.wall_id.localeCompare(b.wall_id);
      return a.slot_number - b.slot_number;
    });
    const contentHash = JSON.stringify(sorted.map(m => ({
      id: m.id,
      wall_id: m.wall_id,
      slot_number: m.slot_number,
      media_url: m.media_url,
      media_type: m.media_type
    })));
    
    if (lastContent.current.mediaItems === contentHash) {
      return mediaItemsRef.current || sorted;
    }
    
    lastContent.current.mediaItems = contentHash;
    mediaItemsRef.current = sorted;
    return sorted;
  }, [mediaItemsState]);

  return {
    walls,
    screenUrls,
    mediaItems,
    loading,
    updateScreenUrl,
    updateMediaItem,
    updateWallPosition,
    uploadMedia,
    savePendingChanges, // Add manual save function
    refetch: fetchData
  };
};