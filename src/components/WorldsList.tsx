import React, { useState, useRef } from 'react';
import { Card } from '@/components/ui/card';
import { Label } from '@/components/ui/label';
import { Input } from '@/components/ui/input';
import { Button } from '@/components/ui/button';
import { useWorlds, World, AmbientMusicTrack } from '@/hooks/useWorlds';
import { supabase } from '@/integrations/supabase/client';
import { useToast } from '@/hooks/use-toast';
import { Dialog, DialogContent, DialogHeader, DialogTitle, DialogFooter } from '@/components/ui/dialog';
import { Tabs, TabsContent, TabsList, TabsTrigger } from '@/components/ui/tabs';
import { Plus, Trash2, Check, Globe, Upload, Star, TreeDeciduous, RefreshCw, Music, Volume2 } from 'lucide-react';
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select';
import { Slider } from '@/components/ui/slider';
import { Badge } from '@/components/ui/badge';
import { DEFAULT_TEXTURES } from '@/hooks/useCurrentWorldId';
import { cn } from '@/lib/utils';
import { blockDB } from '@/hooks/useIndexedDB';
import { RarityTiersPanel } from './AdminPanel.RarityTiersPanel';

const LOCAL_STORAGE_KEY = 'currentWorldId';

type WorldsSubtab = 'settings' | 'worlds' | 'fix';

interface WorldsListProps {
  currentWorldId: string | null;
  onWorldChange: (worldId: string) => void;
  subtab: WorldsSubtab;
}

export function WorldsList({ currentWorldId, onWorldChange, subtab }: WorldsListProps) {
  const { worlds, ambientTracks, isLoading, createWorld, updateWorld, setDefaultWorld, deleteWorld, uploadAmbientTrack } = useWorlds();
  const { toast } = useToast();
  
  const [showCreateDialog, setShowCreateDialog] = useState(false);
  const [showDeleteDialog, setShowDeleteDialog] = useState(false);
  const [worldToDelete, setWorldToDelete] = useState<World | null>(null);
  const [isCreating, setIsCreating] = useState(false);
  const [uploadingFor, setUploadingFor] = useState<{ worldId: string; type: 'fortress' | 'ground' | 'sky' } | null>(null);
  
  const [newWorld, setNewWorld] = useState({
    name: ''
  });
  const [isCleaningGhostTrees, setIsCleaningGhostTrees] = useState(false);
  const [isClearingCache, setIsClearingCache] = useState(false);
  const [isRestoringTrees, setIsRestoringTrees] = useState(false);
  const [isGrowingTrees, setIsGrowingTrees] = useState(false);
  const [uploadingAmbient, setUploadingAmbient] = useState(false);
  const [newTrackName, setNewTrackName] = useState('');
  const [showUploadTrackDialog, setShowUploadTrackDialog] = useState(false);
  const [pendingAmbientFile, setPendingAmbientFile] = useState<File | null>(null);

  const fileInputRef = useRef<HTMLInputElement>(null);
  const ambientFileInputRef = useRef<HTMLInputElement>(null);

  // Clear ghost trees from ALL persistence layers using edge function (bypasses RLS)
  const handleClearGhostTrees = async () => {
    setIsCleaningGhostTrees(true);
    try {
      // Note: TREE_BLOCK_TYPES constant no longer needed here
      // IndexedDB now uses isTreeBlockType() which handles both legacy and encoded formats
      
      console.log('[GhostTreeCleanup] ========== STARTING COMPREHENSIVE CLEANUP ==========');
      
      // STEP 0: CRITICAL - Clear in-memory growing trees AND pending flush buffer
      const { clearGrowingTrees, clearAllPendingBlocks, markAllTreesDeleted } = await import('@/features/trees/hooks/useLocalGrowth');
      
      // Mark all current trees as deleted first (prevents regrowth)
      if (typeof markAllTreesDeleted === 'function') {
        markAllTreesDeleted();
        console.log('[GhostTreeCleanup] ✓ Marked all in-memory trees as deleted');
      }
      
      // Clear the growing trees map
      if (typeof clearGrowingTrees === 'function') {
        clearGrowingTrees();
        console.log('[GhostTreeCleanup] ✓ Cleared in-memory growing trees map');
      }
      
      // Clear pending DB flush buffer
      if (typeof clearAllPendingBlocks === 'function') {
        clearAllPendingBlocks();
        console.log('[GhostTreeCleanup] ✓ Cleared pending DB flush buffer');
      }
      
      // STEP 1: Clear ENTIRE IndexedDB chunk cache (nuclear option)
      await blockDB.clearAllChunkCache();
      console.log('[GhostTreeCleanup] ✓ Cleared entire IndexedDB chunk cache');
      
      // STEP 2: Clear tree blocks from the main 'blocks' store
      // The function now uses isTreeBlockType internally to handle both legacy and encoded formats
      const blocksStoreCount = await blockDB.clearTreeBlocksFromBlocksStore([]);
      console.log(`[GhostTreeCleanup] ✓ Removed ${blocksStoreCount} tree blocks from blocks store`);
      
      // STEP 3: Also run clearTreeBlocksFromCache (in case any survive)
      const cacheCount = await blockDB.clearTreeBlocksFromCache();
      console.log(`[GhostTreeCleanup] ✓ Removed ${cacheCount} tree blocks from chunk cache`);
      
      // STEP 4: Clear collision grid to remove ghost colliders
      const { worldCollisionGrid, entityCollisionGrid } = await import('@/lib/spatialHashGrid');
      worldCollisionGrid.clear();
      entityCollisionGrid.clear();
      console.log('[GhostTreeCleanup] ✓ Cleared collision grid');
      
      // STEP 5: Call edge function to delete from DB (bypasses RLS with service role)
      const { data: session } = await supabase.auth.getSession();
      if (!session?.session?.access_token) {
        throw new Error('Not authenticated - please log in');
      }
      
      const response = await fetch(
        `https://ditecxjpkgbqkeckebzb.supabase.co/functions/v1/cleanup-ghost-trees`,
        {
          method: 'POST',
          headers: {
            'Authorization': `Bearer ${session.session.access_token}`,
            'Content-Type': 'application/json'
          }
        }
      );
      
      const result = await response.json();
      
      if (!response.ok) {
        throw new Error(result.error || `Edge function failed: ${response.status}`);
      }
      
      console.log('[GhostTreeCleanup] ✓ Edge function result:', result);
      console.log('[GhostTreeCleanup] ========== CLEANUP COMPLETE - RELOADING ==========');
      
      toast({
        title: 'Ghost trees completely cleared',
        description: `Deleted ${result.deleted.orphan_placed_blocks} blocks, ${result.deleted.orphan_tree_blocks} tree_blocks, ${result.deleted.orphan_tree_fruits || 0} tree_fruits. Page will reload...`
      });
      
      // STEP 6: Force page reload to get fresh state
      setTimeout(() => {
        window.location.reload();
      }, 1500);
    } catch (err) {
      console.error('[GhostTreeCleanup] Error:', err);
      toast({
        title: 'Cleanup failed',
        description: err instanceof Error ? err.message : 'Unknown error',
        variant: 'destructive'
      });
    } finally {
      setIsCleaningGhostTrees(false);
    }
  };

  // Trigger server-side tree growth processing
  const handleGrowTrees = async () => {
    setIsGrowingTrees(true);
    try {
      console.log('[TreeGrowth] Triggering server-side tree growth...');

      const { data, error } = await supabase.rpc('trigger_tree_growth');

      if (error) {
        if (error.code === 'PGRST202') {
          throw new Error('Migration not deployed. Run the server_side_tree_growth migration first.');
        }
        throw error;
      }

      console.log('[TreeGrowth] Result:', data);

      const blocksInserted = data?.total_blocks_inserted || 0;
      const treesProcessed = data?.trees_processed || 0;
      const treesCompleted = data?.trees_completed || 0;

      if (blocksInserted > 0) {
        toast({
          title: 'Trees grown',
          description: `Inserted ${blocksInserted} blocks across ${treesProcessed} trees. ${treesCompleted} trees completed.`
        });
      } else if (treesProcessed > 0) {
        toast({
          title: 'Trees up to date',
          description: `Checked ${treesProcessed} trees - all blocks already placed.`
        });
      } else {
        toast({
          title: 'No growing trees',
          description: 'No trees currently need growth processing.'
        });
      }
    } catch (err) {
      console.error('[TreeGrowth] Error:', err);
      toast({
        title: 'Growth failed',
        description: err instanceof Error ? err.message : 'Unknown error',
        variant: 'destructive'
      });
    } finally {
      setIsGrowingTrees(false);
    }
  };

  // Restore missing tree blocks from blueprints
  const handleRestoreTrees = async () => {
    if (!currentWorldId) {
      toast({ title: 'No world selected', description: 'Please select a world first', variant: 'destructive' });
      return;
    }

    setIsRestoringTrees(true);
    try {
      console.log('[TreeRestore] Starting tree block restoration...');

      const { data, error } = await supabase.rpc('sync_all_missing_tree_blocks', {
        p_world_id: currentWorldId
      });

      if (error) {
        // Check if the function doesn't exist
        if (error.code === 'PGRST202') {
          throw new Error('Migration not deployed. Run the sync_missing_tree_blocks migration in Supabase first.');
        }
        throw error;
      }

      console.log('[TreeRestore] Result:', data);

      if (data.total_blocks_inserted > 0) {
        toast({
          title: 'Trees restored',
          description: `Restored ${data.total_blocks_inserted} blocks from ${data.trees_processed} trees. Reloading...`
        });

        // Clear cache and reload to see restored trees
        await blockDB.clearAllChunkCache();
        setTimeout(() => window.location.reload(), 1000);
      } else {
        toast({
          title: 'No missing blocks',
          description: `Checked ${data.trees_processed} trees - all blocks already exist.`
        });
      }
    } catch (err) {
      console.error('[TreeRestore] Error:', err);
      toast({
        title: 'Restore failed',
        description: err instanceof Error ? err.message : 'Unknown error',
        variant: 'destructive'
      });
    } finally {
      setIsRestoringTrees(false);
    }
  };

  // Clear IndexedDB cache for current world and reload
  const handleClearCache = async () => {
    if (!currentWorldId) {
      toast({ title: 'No world selected', description: 'Please select a world first', variant: 'destructive' });
      return;
    }
    
    setIsClearingCache(true);
    try {
      console.log('[CacheClear] Starting NUCLEAR cache clear...');
      
      // NUCLEAR: Clear ALL chunk cache (not just current world)
      // This fixes issues where worldId in cache doesn't match expected worldId
      await blockDB.clearAllChunkCache();
      console.log('[CacheClear] ✓ Cleared ALL chunk cache (nuclear)');
      
      // Also clear the main blocks store to ensure fresh data
      await blockDB.clearAllBlocks();
      console.log('[CacheClear] ✓ Cleared blocks store');
      
      // Wait for IndexedDB writes to complete before reload
      await new Promise(resolve => setTimeout(resolve, 100));
      
      toast({
        title: 'Cache cleared',
        description: 'Reloading to fetch fresh data from server...'
      });
      
      // Force page reload after delay (ensure toast is visible)
      setTimeout(() => {
        window.location.reload();
      }, 500);
    } catch (err) {
      console.error('[CacheClear] Error:', err);
      toast({
        title: 'Cache clear failed',
        description: err instanceof Error ? err.message : 'Unknown error',
        variant: 'destructive'
      });
      setIsClearingCache(false);
    }
  };

  const handleCreateWorld = async () => {
    if (!newWorld.name.trim()) {
      toast({ title: 'Name required', description: 'Please enter a world name', variant: 'destructive' });
      return;
    }

    setIsCreating(true);
    try {
      // New worlds start with null textures (will use defaults)
      await createWorld({
        name: newWorld.name.trim(),
        fortress_texture_url: null,
        ground_texture_url: null,
        sky_texture_url: null
      });
      toast({ title: 'World created', description: `"${newWorld.name}" has been created with default textures` });
      setShowCreateDialog(false);
      setNewWorld({ name: '' });
    } catch (err) {
      toast({ title: 'Error', description: err instanceof Error ? err.message : 'Failed to create world', variant: 'destructive' });
    } finally {
      setIsCreating(false);
    }
  };

  const handleSetDefault = async (world: World) => {
    try {
      await setDefaultWorld(world.id);
      toast({ title: 'Default updated', description: `"${world.name}" is now the default world` });
    } catch (err) {
      toast({ title: 'Error', description: 'Failed to set default world', variant: 'destructive' });
    }
  };

  const handleUseWorld = (world: World) => {
    onWorldChange(world.id);
    toast({ title: 'World changed', description: `Now using "${world.name}"` });
  };

  const handleDeleteClick = (world: World) => {
    if (world.is_default) {
      toast({ title: 'Cannot delete', description: 'Cannot delete the default world', variant: 'destructive' });
      return;
    }
    setWorldToDelete(world);
    setShowDeleteDialog(true);
  };

  const handleConfirmDelete = async () => {
    if (!worldToDelete) return;
    try {
      await deleteWorld(worldToDelete.id);
      toast({ title: 'World deleted', description: `"${worldToDelete.name}" has been deleted` });
      setShowDeleteDialog(false);
      setWorldToDelete(null);
    } catch (err) {
      toast({ title: 'Error', description: err instanceof Error ? err.message : 'Failed to delete world', variant: 'destructive' });
    }
  };

  const handleTextureUpload = async (worldId: string, type: 'fortress' | 'ground' | 'sky', file: File) => {
    try {
      setUploadingFor({ worldId, type });
      
      const fileExt = file.name.split('.').pop()?.toLowerCase();
      if (!['png', 'jpg', 'jpeg', 'webp'].includes(fileExt || '')) {
        throw new Error('Invalid file type. Use PNG, JPG, or WebP.');
      }

      const fileName = `${worldId}/${type}_${Date.now()}.${fileExt}`;
      
      const { error: uploadError } = await supabase.storage
        .from('world-textures')
        .upload(fileName, file, { upsert: true });

      if (uploadError) throw uploadError;

      const { data: { publicUrl } } = supabase.storage
        .from('world-textures')
        .getPublicUrl(fileName);

      const updateField = type === 'fortress' ? 'fortress_texture_url' 
        : type === 'ground' ? 'ground_texture_url' 
        : 'sky_texture_url';

      await updateWorld(worldId, { [updateField]: publicUrl });
      toast({ title: 'Texture uploaded', description: `${type} texture updated` });
    } catch (err) {
      toast({ title: 'Upload failed', description: err instanceof Error ? err.message : 'Failed to upload texture', variant: 'destructive' });
    } finally {
      setUploadingFor(null);
    }
  };

  const handleFileSelect = (e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0];
    if (file && uploadingFor) {
      handleTextureUpload(uploadingFor.worldId, uploadingFor.type, file);
    }
    if (fileInputRef.current) {
      fileInputRef.current.value = '';
    }
  };

  const triggerUpload = (worldId: string, type: 'fortress' | 'ground' | 'sky') => {
    setUploadingFor({ worldId, type });
    fileInputRef.current?.click();
  };

  // Ambient music handlers
  const handleAmbientFileSelect = (e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0];
    if (file) {
      setPendingAmbientFile(file);
      setNewTrackName(file.name.replace(/\.[^/.]+$/, '')); // Default name from filename
      setShowUploadTrackDialog(true);
    }
    if (ambientFileInputRef.current) {
      ambientFileInputRef.current.value = '';
    }
  };

  const handleUploadAmbientTrack = async () => {
    if (!pendingAmbientFile || !newTrackName.trim()) return;

    setUploadingAmbient(true);
    try {
      await uploadAmbientTrack(newTrackName.trim(), pendingAmbientFile);
      toast({ title: 'Track uploaded', description: `"${newTrackName}" is now available` });
      setShowUploadTrackDialog(false);
      setPendingAmbientFile(null);
      setNewTrackName('');
    } catch (err) {
      toast({ title: 'Upload failed', description: err instanceof Error ? err.message : 'Failed to upload track', variant: 'destructive' });
    } finally {
      setUploadingAmbient(false);
    }
  };

  const handleAmbientMusicChange = async (worldId: string, url: string) => {
    try {
      await updateWorld(worldId, { ambient_music_url: url || null });
      toast({ title: 'Music updated', description: 'Ambient music changed for this world' });
    } catch (err) {
      console.error('Failed to update ambient music:', err);
      toast({
        title: 'Error',
        description: err instanceof Error ? err.message : 'Failed to update ambient music. Run the migration first.',
        variant: 'destructive'
      });
    }
  };

  const handleAmbientVolumeChange = async (worldId: string, volume: number) => {
    try {
      await updateWorld(worldId, { ambient_music_volume: volume });
    } catch (err) {
      // Silent fail for volume changes to avoid spamming toasts
      console.error('Failed to update volume:', err);
    }
  };

  // Helper to get display texture (actual or default)
  const getDisplayTexture = (url: string | null, type: 'fortress' | 'ground' | 'sky') => {
    if (url) return { url, isDefault: false };
    return { url: DEFAULT_TEXTURES[type], isDefault: true };
  };

  if (isLoading) {
    return <div className="p-4 text-muted-foreground">Loading worlds...</div>;
  }

  const fixPanel = (
    <div className="space-y-4">
      <h3 className="text-lg font-semibold">Fix / Maintenance</h3>
      <div className="flex flex-wrap gap-2">
        <Button
          onClick={handleClearCache}
          size="sm"
          variant="outline"
          disabled={isClearingCache}
        >
          <RefreshCw className={cn("h-4 w-4 mr-1", isClearingCache && "animate-spin")} />
          {isClearingCache ? 'Clearing...' : 'Clear Cache'}
        </Button>
        <Button
          onClick={handleGrowTrees}
          size="sm"
          variant="outline"
          disabled={isGrowingTrees}
          className="text-emerald-600 border-emerald-600 hover:bg-emerald-50"
        >
          <TreeDeciduous className={cn("h-4 w-4 mr-1", isGrowingTrees && "animate-spin")} />
          {isGrowingTrees ? 'Growing...' : 'Grow Trees'}
        </Button>
        <Button
          onClick={handleRestoreTrees}
          size="sm"
          variant="outline"
          disabled={isRestoringTrees}
          className="text-green-600 border-green-600 hover:bg-green-50"
        >
          <TreeDeciduous className={cn("h-4 w-4 mr-1", isRestoringTrees && "animate-pulse")} />
          {isRestoringTrees ? 'Restoring...' : 'Restore Trees'}
        </Button>
        <Button
          onClick={handleClearGhostTrees}
          size="sm"
          variant="destructive"
          disabled={isCleaningGhostTrees}
        >
          <TreeDeciduous className="h-4 w-4 mr-1" />
          {isCleaningGhostTrees ? 'Clearing...' : 'Clear Ghost Trees'}
        </Button>
      </div>
    </div>
  );

  const worldsPanel = (
    <div className="space-y-4">
      <div className="flex justify-between items-center">
        <h3 className="text-lg font-semibold">Worlds</h3>
        <Button onClick={() => setShowCreateDialog(true)} size="sm">
          <Plus className="h-4 w-4 mr-1" /> Add World
        </Button>
      </div>

      <p className="text-xs text-muted-foreground">
        Use <kbd className="px-1 py-0.5 bg-muted rounded text-xs">&lt;</kbd> and <kbd className="px-1 py-0.5 bg-muted rounded text-xs">&gt;</kbd> keys (Shift+comma/period) to switch worlds in-game.
      </p>

      <input
        ref={fileInputRef}
        type="file"
        accept="image/png,image/jpeg,image/webp"
        className="hidden"
        onChange={handleFileSelect}
      />

      <input
        ref={ambientFileInputRef}
        type="file"
        accept="audio/mpeg,audio/wav,audio/ogg,audio/mp4"
        className="hidden"
        onChange={handleAmbientFileSelect}
      />

      <div className="grid gap-4">
        {worlds.map(world => {
          const isInUse = currentWorldId === world.id;
          const fortressTex = getDisplayTexture(world.fortress_texture_url, 'fortress');
          const groundTex = getDisplayTexture(world.ground_texture_url, 'ground');
          const skyTex = getDisplayTexture(world.sky_texture_url, 'sky');

          return (
            <Card
              key={world.id}
              className={cn(
                "p-4 transition-all",
                isInUse && "bg-muted/50 ring-2 ring-blue-400/60"
              )}
            >
              <div className="flex items-start justify-between mb-3">
                <div className="flex items-center gap-2">
                  <Globe className="h-5 w-5 text-muted-foreground" />
                  <span className="font-medium">{world.name}</span>
                  {world.is_default && (
                    <Badge variant="secondary" className="text-xs">
                      <Star className="h-3 w-3 mr-1" /> Default
                    </Badge>
                  )}
                </div>
                <div className="flex gap-2">
                  {!world.is_default && (
                    <Button variant="outline" size="sm" onClick={() => handleSetDefault(world)}>
                      Set Default
                    </Button>
                  )}
                  {isInUse ? (
                    <Button variant="default" size="sm" disabled className="bg-blue-600 hover:bg-blue-600">
                      <Check className="h-4 w-4 mr-1" /> IN USE
                    </Button>
                  ) : (
                    <Button variant="outline" size="sm" onClick={() => handleUseWorld(world)}>
                      Use
                    </Button>
                  )}
                  {!world.is_default && (
                    <Button variant="destructive" size="sm" onClick={() => handleDeleteClick(world)}>
                      <Trash2 className="h-4 w-4" />
                    </Button>
                  )}
                </div>
              </div>

              <div className="grid grid-cols-3 gap-3 mt-3">
                {/* Fortress Texture */}
                <div className="space-y-1">
                  <Label className="text-xs text-muted-foreground">Fortress</Label>
                  <div className="flex items-center gap-2">
                    <div className="relative">
                      <img
                        src={fortressTex.url}
                        className={cn(
                          "w-12 h-12 object-cover rounded border",
                          fortressTex.isDefault && "opacity-60"
                        )}
                        alt="Fortress"
                      />
                      {fortressTex.isDefault && (
                        <span className="absolute bottom-0 left-0 right-0 text-[8px] text-center bg-black/60 text-white rounded-b">
                          default
                        </span>
                      )}
                    </div>
                    <Button
                      variant="outline"
                      size="sm"
                      disabled={uploadingFor?.worldId === world.id && uploadingFor?.type === 'fortress'}
                      onClick={() => triggerUpload(world.id, 'fortress')}
                    >
                      <Upload className="h-3 w-3" />
                    </Button>
                  </div>
                </div>

                {/* Ground Texture */}
                <div className="space-y-1">
                  <Label className="text-xs text-muted-foreground">Ground</Label>
                  <div className="flex items-center gap-2">
                    <div className="relative">
                      <img
                        src={groundTex.url}
                        className={cn(
                          "w-12 h-12 object-cover rounded border",
                          groundTex.isDefault && "opacity-60"
                        )}
                        alt="Ground"
                      />
                      {groundTex.isDefault && (
                        <span className="absolute bottom-0 left-0 right-0 text-[8px] text-center bg-black/60 text-white rounded-b">
                          default
                        </span>
                      )}
                    </div>
                    <Button
                      variant="outline"
                      size="sm"
                      disabled={uploadingFor?.worldId === world.id && uploadingFor?.type === 'ground'}
                      onClick={() => triggerUpload(world.id, 'ground')}
                    >
                      <Upload className="h-3 w-3" />
                    </Button>
                  </div>
                </div>

                {/* Sky Texture */}
                <div className="space-y-1">
                  <Label className="text-xs text-muted-foreground">Sky</Label>
                  <div className="flex items-center gap-2">
                    <div className="relative">
                      <img
                        src={skyTex.url}
                        className={cn(
                          "w-12 h-12 object-cover rounded border",
                          skyTex.isDefault && "opacity-60"
                        )}
                        alt="Sky"
                      />
                      {skyTex.isDefault && (
                        <span className="absolute bottom-0 left-0 right-0 text-[8px] text-center bg-black/60 text-white rounded-b">
                          default
                        </span>
                      )}
                    </div>
                    <Button
                      variant="outline"
                      size="sm"
                      disabled={uploadingFor?.worldId === world.id && uploadingFor?.type === 'sky'}
                      onClick={() => triggerUpload(world.id, 'sky')}
                    >
                      <Upload className="h-3 w-3" />
                    </Button>
                  </div>
                </div>
              </div>

              {/* Ambient Music Section */}
              <div className="mt-4 pt-3 border-t border-border/50">
                <div className="flex items-center gap-2 mb-2">
                  <Music className="h-4 w-4 text-muted-foreground" />
                  <Label className="text-xs text-muted-foreground">Ambient Music</Label>
                </div>
                <div className="flex items-center gap-3">
                  <Select
                    value={world.ambient_music_url || '__none__'}
                    onValueChange={(value) => handleAmbientMusicChange(world.id, value === '__none__' ? '' : value)}
                  >
                    <SelectTrigger className="w-[200px] h-8 text-xs">
                      <SelectValue placeholder="Select track..." />
                    </SelectTrigger>
                    <SelectContent>
                      <SelectItem value="__none__">None</SelectItem>
                      {(ambientTracks || []).map(track => (
                        <SelectItem key={track.id} value={track.url}>
                          {track.name}
                        </SelectItem>
                      ))}
                    </SelectContent>
                  </Select>

                  <Button
                    variant="outline"
                    size="sm"
                    onClick={() => ambientFileInputRef.current?.click()}
                  >
                    <Upload className="h-3 w-3 mr-1" /> Upload New
                  </Button>

                  <div className="flex items-center gap-2 flex-1 min-w-[150px]">
                    <Volume2 className="h-4 w-4 text-muted-foreground" />
                    <Slider
                      value={[world.ambient_music_volume ?? 100]}
                      min={0}
                      max={200}
                      step={5}
                      className="flex-1"
                      onValueChange={([value]) => handleAmbientVolumeChange(world.id, value)}
                    />
                    <span className="text-xs text-muted-foreground w-10 text-right">
                      {world.ambient_music_volume ?? 100}%
                    </span>
                  </div>
                </div>
              </div>
            </Card>
          );
        })}

        {worlds.length === 0 && (
          <div className="text-center py-8 text-muted-foreground">
            No worlds found. Create one to get started.
          </div>
        )}
      </div>

      {/* Create World Dialog */}
      <Dialog open={showCreateDialog} onOpenChange={setShowCreateDialog}>
        <DialogContent>
          <DialogHeader>
            <DialogTitle>Create New World</DialogTitle>
          </DialogHeader>
          <div className="space-y-4 py-4">
            <div className="space-y-2">
              <Label htmlFor="world-name">World Name</Label>
              <Input
                id="world-name"
                placeholder="My World"
                value={newWorld.name}
                onChange={(e) => setNewWorld(prev => ({ ...prev, name: e.target.value }))}
              />
            </div>
            <p className="text-sm text-muted-foreground">
              New worlds use default textures. Upload custom textures after creation.
            </p>
          </div>
          <DialogFooter>
            <Button variant="outline" onClick={() => setShowCreateDialog(false)}>Cancel</Button>
            <Button onClick={handleCreateWorld} disabled={isCreating}>
              {isCreating ? 'Creating...' : 'Create World'}
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>

      {/* Delete Confirmation Dialog */}
      <Dialog open={showDeleteDialog} onOpenChange={setShowDeleteDialog}>
        <DialogContent>
          <DialogHeader>
            <DialogTitle>Delete World</DialogTitle>
          </DialogHeader>
          <p className="py-4">
            Are you sure you want to delete "{worldToDelete?.name}"? This will also delete all blocks placed in this world.
          </p>
          <DialogFooter>
            <Button variant="outline" onClick={() => setShowDeleteDialog(false)}>Cancel</Button>
            <Button variant="destructive" onClick={handleConfirmDelete}>Delete</Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>

      {/* Upload Ambient Track Dialog */}
      <Dialog open={showUploadTrackDialog} onOpenChange={setShowUploadTrackDialog}>
        <DialogContent>
          <DialogHeader>
            <DialogTitle>Upload Ambient Track</DialogTitle>
          </DialogHeader>
          <div className="space-y-4 py-4">
            <div className="space-y-2">
              <Label htmlFor="track-name">Track Name</Label>
              <Input
                id="track-name"
                placeholder="Alien Planet Ambient"
                value={newTrackName}
                onChange={(e) => setNewTrackName(e.target.value)}
              />
            </div>
            {pendingAmbientFile && (
              <p className="text-sm text-muted-foreground">
                File: {pendingAmbientFile.name} ({(pendingAmbientFile.size / 1024 / 1024).toFixed(2)} MB)
              </p>
            )}
          </div>
          <DialogFooter>
            <Button variant="outline" onClick={() => {
              setShowUploadTrackDialog(false);
              setPendingAmbientFile(null);
              setNewTrackName('');
            }}>Cancel</Button>
            <Button onClick={handleUploadAmbientTrack} disabled={uploadingAmbient || !newTrackName.trim()}>
              {uploadingAmbient ? 'Uploading...' : 'Upload'}
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </div>
  );

  const settingsPanel = (
    <div className="space-y-4">
      <h3 className="text-lg font-semibold">World Settings</h3>
      <Tabs defaultValue="sounds" className="flex flex-col">
        <TabsList className="grid w-full grid-cols-3 flex-shrink-0 mb-4">
          <TabsTrigger value="sounds">Sounds</TabsTrigger>
          <TabsTrigger value="css">CSS</TabsTrigger>
          <TabsTrigger value="rarity-tiers">Rarity Tiers</TabsTrigger>
        </TabsList>

        <TabsContent value="sounds" className="mt-0">
          <Card className="p-4">
            <p className="text-muted-foreground text-sm">Sound settings coming soon.</p>
          </Card>
        </TabsContent>

        <TabsContent value="css" className="mt-0">
          <Card className="p-4">
            <p className="text-muted-foreground text-sm">CSS settings coming soon.</p>
          </Card>
        </TabsContent>

        <TabsContent value="rarity-tiers" className="mt-0">
          <RarityTiersPanel />
        </TabsContent>
      </Tabs>
    </div>
  );

  if (subtab === 'settings') return settingsPanel;
  if (subtab === 'fix') return fixPanel;
  return worldsPanel;
}
