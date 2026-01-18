import React, { useState, useRef } from 'react';
import { Card } from '@/components/ui/card';
import { Label } from '@/components/ui/label';
import { Input } from '@/components/ui/input';
import { Button } from '@/components/ui/button';
import { useWorlds, World } from '@/hooks/useWorlds';
import { supabase } from '@/integrations/supabase/client';
import { useToast } from '@/hooks/use-toast';
import { Dialog, DialogContent, DialogHeader, DialogTitle, DialogFooter } from '@/components/ui/dialog';
import { Plus, Trash2, Check, Globe, Upload, Star, TreeDeciduous } from 'lucide-react';
import { Badge } from '@/components/ui/badge';
import { DEFAULT_TEXTURES } from '@/hooks/useCurrentWorldId';
import { cn } from '@/lib/utils';
import { blockDB } from '@/hooks/useIndexedDB';

const LOCAL_STORAGE_KEY = 'currentWorldId';

interface WorldsListProps {
  currentWorldId: string | null;
  onWorldChange: (worldId: string) => void;
}

export function WorldsList({ currentWorldId, onWorldChange }: WorldsListProps) {
  const { worlds, isLoading, createWorld, updateWorld, setDefaultWorld, deleteWorld } = useWorlds();
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

  const fileInputRef = useRef<HTMLInputElement>(null);

  // Clear ghost trees from all persistence layers
  const handleClearGhostTrees = async () => {
    setIsCleaningGhostTrees(true);
    try {
      const TREE_BLOCK_TYPES = ['trunk', 'branch', 'leaf', 'fruit', 'spike', 'nob', 'cross', 'shroom'];
      
      // 1. Clear tree blocks from IndexedDB chunk cache
      const removedFromCache = await blockDB.clearTreeBlocksFromCache();
      console.log(`[GhostTreeCleanup] Removed ${removedFromCache} blocks from IndexedDB`);
      
      // 2. Delete ghost tree blocks from Supabase (null texture)
      const { error: deleteError, count: dbCount } = await supabase
        .from('placed_blocks')
        .delete({ count: 'exact' })
        .in('block_type', TREE_BLOCK_TYPES)
        .is('texture_url', null);
      
      if (deleteError) {
        console.error('[GhostTreeCleanup] DB delete error:', deleteError);
      } else {
        console.log(`[GhostTreeCleanup] Removed ${dbCount} blocks from Supabase`);
      }
      
      // 3. Force chunk version bump for all chunks to trigger refetch
      const { error: bumpError } = await supabase
        .from('chunk_versions')
        .update({ 
          version: 99999, // High version to force all clients to refetch
          updated_at: new Date().toISOString() 
        })
        .gte('chunk_x', -1000); // Match all chunks
      
      if (bumpError) {
        console.error('[GhostTreeCleanup] Version bump error:', bumpError);
      }
      
      toast({
        title: 'Ghost trees cleared',
        description: `Removed ${removedFromCache} from cache, ${dbCount || 0} from database. Refresh page to see changes.`
      });
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

  // Helper to get display texture (actual or default)
  const getDisplayTexture = (url: string | null, type: 'fortress' | 'ground' | 'sky') => {
    if (url) return { url, isDefault: false };
    return { url: DEFAULT_TEXTURES[type], isDefault: true };
  };

  if (isLoading) {
    return <div className="p-4 text-muted-foreground">Loading worlds...</div>;
  }

  return (
    <div className="space-y-4">
      <div className="flex justify-between items-center">
        <h3 className="text-lg font-semibold">Worlds</h3>
        <div className="flex gap-2">
          <Button 
            onClick={handleClearGhostTrees} 
            size="sm" 
            variant="destructive"
            disabled={isCleaningGhostTrees}
          >
            <TreeDeciduous className="h-4 w-4 mr-1" /> 
            {isCleaningGhostTrees ? 'Clearing...' : 'Clear Ghost Trees'}
          </Button>
          <Button onClick={() => setShowCreateDialog(true)} size="sm">
            <Plus className="h-4 w-4 mr-1" /> Create World
          </Button>
        </div>
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
    </div>
  );
}
