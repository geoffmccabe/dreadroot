import React, { useState, useEffect, useRef } from 'react';
import { Dialog, DialogContent, DialogHeader, DialogTitle } from '@/components/ui/dialog';
import { Tabs, TabsContent, TabsList, TabsTrigger } from '@/components/ui/tabs';
import { Card } from '@/components/ui/card';
import { Label } from '@/components/ui/label';
import { Slider } from '@/components/ui/slider';
import { Input } from '@/components/ui/input';
import { Button } from '@/components/ui/button';
import { ChevronDown, ChevronRight, Upload, Plus } from 'lucide-react';
import { BillboardControlPanel } from '@/components/BillboardControlPanel';
import { useAdminPanel } from '@/contexts/AdminPanelContext';
import { supabase } from '@/integrations/supabase/client';
import { ScrollArea } from '@/components/ui/scroll-area';
import { useToast } from '@/hooks/use-toast';
import { useUserData } from '@/hooks/useUserData';
import { useBlocksData } from '@/hooks/useBlocksData';

interface WaterfallControlsProps {
  settings: any;
  onSettingsChange: (key: string, value: any) => void;
}

function WaterfallControls({ settings, onSettingsChange }: WaterfallControlsProps) {
  const [isCollapsed, setIsCollapsed] = useState(false);

  return (
    <Card className="waterfall-card w-full">
      <div 
        className="flex items-center justify-between mb-3 cursor-pointer"
        onClick={() => setIsCollapsed(!isCollapsed)}
      >
        <h3 className="font-bold text-sm">WATERFALL & COINS</h3>
        {isCollapsed ? (
          <ChevronRight className="h-4 w-4" />
        ) : (
          <ChevronDown className="h-4 w-4" />
        )}
      </div>
      
      {!isCollapsed && (
        <div className="space-y-3 animate-fade-in">
          <div className="grid grid-cols-[100px_1fr_40px] gap-2 items-center">
            <Label className="text-xs opacity-85">Flow speed</Label>
            <Slider
              value={[settings.flowSpeed]}
              onValueChange={([value]) => onSettingsChange('flowSpeed', value)}
              min={0.2}
              max={3}
              step={0.01}
              className="flex-1"
            />
            <span className="text-xs opacity-75">{settings.flowSpeed.toFixed(2)}</span>
          </div>
          <div className="grid grid-cols-[100px_1fr_40px] gap-2 items-center">
            <Label className="text-xs opacity-85">MS between drops</Label>
            <Slider
              value={[settings.msBetweeenDrops]}
              onValueChange={([value]) => onSettingsChange('msBetweeenDrops', value)}
              min={0.1}
              max={5}
              step={0.1}
              className="flex-1"
            />
            <span className="text-xs opacity-75">{settings.msBetweeenDrops.toFixed(1)}ms</span>
          </div>
          <div className="grid grid-cols-[100px_1fr_40px] gap-2 items-center">
            <Label className="text-xs opacity-85">Coin rate (ps)</Label>
            <Slider
              value={[settings.coinRate]}
              onValueChange={([value]) => onSettingsChange('coinRate', value)}
              min={0}
              max={10}
              step={1}
              className="flex-1"
            />
            <span className="text-xs opacity-75">{settings.coinRate}</span>
          </div>
          <div className="grid grid-cols-[100px_1fr_40px] gap-2 items-center">
            <Label className="text-xs opacity-85">Coin size</Label>
            <Slider
              value={[settings.coinSize]}
              onValueChange={([value]) => onSettingsChange('coinSize', value)}
              min={0.2}
              max={1}
              step={0.01}
              className="flex-1"
            />
            <span className="text-xs opacity-75">{settings.coinSize.toFixed(2)}</span>
          </div>
          
          {/* Color/Weight Controls */}
          <div className="mt-4 space-y-2">
            <Label className="text-xs opacity-85 font-semibold">Drop Colors & Weights</Label>
            <div className="grid grid-cols-3 gap-2">
              {settings.colorPalette.map((colorWeight: any, index: number) => (
                <div key={index} className="flex items-center gap-1 text-xs">
                  <div 
                    className="w-4 h-4 rounded border border-gray-300 flex-shrink-0"
                    style={{ backgroundColor: colorWeight.hex }}
                  />
                  <Input
                    type="color"
                    value={colorWeight.hex}
                    onChange={(e) => {
                      const newPalette = [...settings.colorPalette];
                      newPalette[index] = { ...newPalette[index], hex: e.target.value };
                      onSettingsChange('colorPalette', newPalette);
                    }}
                    className="w-6 h-6 p-0 border-0 cursor-pointer flex-shrink-0"
                  />
                  <Input
                    type="number"
                    value={colorWeight.weight}
                    onChange={(e) => {
                      const newPalette = [...settings.colorPalette];
                      newPalette[index] = { ...newPalette[index], weight: parseInt(e.target.value) || 0 };
                      onSettingsChange('colorPalette', newPalette);
                    }}
                    className="w-12 h-6 text-xs p-1 flex-1"
                    min="0"
                    max="100"
                  />
                </div>
              ))}
            </div>
          </div>
        </div>
      )}
    </Card>
  );
}

interface UsersListProps {}

function UsersList({}: UsersListProps) {
  const [users, setUsers] = useState<any[]>([]);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    loadUsers();
  }, []);

  const loadUsers = async () => {
    try {
      // Query user profiles with roles
      const { data, error } = await supabase
        .from('user_profiles')
        .select(`
          user_id,
          coins,
          blockchain_address,
          user_roles (role)
        `)
        .order('user_id');

      if (error) throw error;

      setUsers(data || []);
    } catch (error) {
      console.error('Failed to load users:', error);
    } finally {
      setLoading(false);
    }
  };

  if (loading) {
    return <div className="text-sm opacity-75">Loading users...</div>;
  }

  return (
    <ScrollArea className="h-[500px] w-full">
      <div className="space-y-2">
        {users.map((user) => (
          <Card key={user.user_id} className="p-3">
            <div className="text-xs space-y-1">
              <div className="font-mono text-[10px] opacity-50">{user.user_id}</div>
              <div className="flex items-center justify-between">
                <span className="font-semibold">Coins:</span>
                <span>{user.coins}</span>
              </div>
              {user.blockchain_address && (
                <div className="flex items-center justify-between">
                  <span className="font-semibold">Wallet:</span>
                  <span className="font-mono text-[10px]">{user.blockchain_address.slice(0, 8)}...</span>
                </div>
              )}
              <div className="flex items-center justify-between">
                <span className="font-semibold">Roles:</span>
                <span className="text-brand-1">
                  {user.user_roles?.map((r: any) => r.role).join(', ') || 'user'}
                </span>
              </div>
            </div>
          </Card>
        ))}
      </div>
    </ScrollArea>
  );
}

// AdminPanel uses database field names directly (texture_url, glow_factor)
// This differs from BlockType which uses nested structure (texture.diffuse, properties.glowFactor)
interface AdminBlock {
  id: number;
  key: string;
  name: string;
  description: string;
  cost: number;
  category: string;
  rarity: 'common' | 'uncommon' | 'rare' | 'epic' | 'legendary' | 'divine' | 'mystic' | 'rainbow' | 'apocalyptic' | 'infinite';
  class: 'basic' | 'magic' | 'mystery' | 'iconic';
  tier: number;
  texture_url: string | null;
  glow_factor?: number | null;
  properties: {
    size: [number, number, number];
    color: string;
    emissive: boolean;
    transparent: boolean;
  };
}

interface BlocksListProps {
  userRoles: string[];
}

function BlocksList({ userRoles }: BlocksListProps) {
  const [blocks, setBlocks] = useState<AdminBlock[]>([]);
  const [loading, setLoading] = useState(true);
  const [activeClass, setActiveClass] = useState<'basic' | 'magic' | 'mystery' | 'iconic'>('basic');
  const [showNewBlockDialog, setShowNewBlockDialog] = useState(false);
  const [editingBlock, setEditingBlock] = useState<AdminBlock | null>(null);
  const [newBlockData, setNewBlockData] = useState({
    name: '',
    description: '',
    cost: 10,
    key: '',
    tier: 0,
    rarity: 'common' as AdminBlock['rarity'],
    texture: null as File | null
  });
  const [uploadingBlockId, setUploadingBlockId] = useState<number | null>(null);
  const { toast } = useToast();

  const isSuperAdmin = userRoles.includes('superadmin');
  
  // Filter blocks by active class and sort mystery blocks by tier
  const filteredBlocks = blocks
    .filter(block => block.class === activeClass)
    .sort((a, b) => {
      if (activeClass === 'mystery') {
        return a.tier - b.tier;
      }
      return 0;
    });

  useEffect(() => {
    loadBlocks();
  }, []);

  const loadBlocks = async () => {
    try {
      const { data, error } = await supabase
        .from('blocks')
        .select('*')
        .order('cost', { ascending: true })
        .order('name', { ascending: true });

      if (error) throw error;

      // Cast properties, class, rarity, and tier from database types
      const typedBlocks = (data || []).map(block => ({
        ...block,
        class: block.class as AdminBlock['class'],
        rarity: block.rarity as AdminBlock['rarity'],
        tier: block.tier || 0,
        properties: block.properties as AdminBlock['properties']
      }));

      setBlocks(typedBlocks);
    } catch (error) {
      console.error('Failed to load blocks:', error);
      toast({
        title: "Error",
        description: "Failed to load blocks",
        variant: "destructive"
      });
    } finally {
      setLoading(false);
    }
  };

  const handleTextureUpload = async (blockId: number, file: File) => {
    if (!isSuperAdmin) {
      toast({
        title: "Access Denied",
        description: "Only superadmins can change block textures",
        variant: "destructive"
      });
      return;
    }

    setUploadingBlockId(blockId);

    try {
      const fileExt = file.name.split('.').pop();
      const fileName = `${blockId}-${Date.now()}.${fileExt}`;
      const filePath = `${fileName}`;

      // Upload to storage
      const { error: uploadError } = await supabase.storage
        .from('block-textures')
        .upload(filePath, file, { upsert: true });

      if (uploadError) throw uploadError;

      // Get public URL
      const { data: urlData } = supabase.storage
        .from('block-textures')
        .getPublicUrl(filePath);

      // Update block record
      const { error: updateError } = await supabase
        .from('blocks')
        .update({ texture_url: urlData.publicUrl })
        .eq('id', blockId);

      if (updateError) throw updateError;

      toast({
        title: "Success",
        description: "Texture uploaded successfully"
      });

      loadBlocks();
    } catch (error: any) {
      console.error('Failed to upload texture:', error);
      toast({
        title: "Error",
        description: error.message || "Failed to upload texture",
        variant: "destructive"
      });
    } finally {
      setUploadingBlockId(null);
    }
  };

  const handleCreateBlock = async () => {
    if (!isSuperAdmin) {
      toast({
        title: "Access Denied",
        description: "Only superadmins can create blocks",
        variant: "destructive"
      });
      return;
    }

    if (!newBlockData.name || !newBlockData.key) {
      toast({
        title: "Validation Error",
        description: "Name and key are required",
        variant: "destructive"
      });
      return;
    }

    try {
      // CRITICAL: Check auth session FIRST before anything else
      const { data: { session: currentSession } } = await supabase.auth.getSession();
      if (!currentSession) {
        toast({
          title: "Authentication Error",
          description: "You must be logged in. Please refresh and sign in again.",
          variant: "destructive"
        });
        return;
      }
      console.log('✅ Active session found for user:', currentSession.user.id);

      let textureUrl = null;

      // Upload texture if provided
      if (newBlockData.texture) {
        const fileExt = newBlockData.texture.name.split('.').pop();
        const fileName = `${newBlockData.key}-${Date.now()}.${fileExt}`;
        
        const { error: uploadError } = await supabase.storage
          .from('block-textures')
          .upload(fileName, newBlockData.texture);

        if (uploadError) throw uploadError;

        const { data: urlData } = supabase.storage
          .from('block-textures')
          .getPublicUrl(fileName);

        textureUrl = urlData.publicUrl;
      }

      // Don't specify ID, let database auto-increment
      const { error, data } = await supabase
        .from('blocks')
        .insert([{
          key: newBlockData.key,
          name: newBlockData.name,
          description: newBlockData.description,
          cost: newBlockData.cost,
          category: 'building',
          rarity: newBlockData.rarity,
          class: activeClass, // Automatically assign to the active class tab
          tier: newBlockData.tier,
          texture_url: textureUrl,
          properties: {
            size: [1, 1, 1],
            color: '#808080',
            emissive: false,
            transparent: false
          }
        }])
        .select();

      console.log('Insert result:', { error, data });
      if (error) {
        console.error('Insert error details:', error);
        throw error;
      }

      toast({
        title: "Success",
        description: "Block created successfully"
      });

      setShowNewBlockDialog(false);
      setNewBlockData({ name: '', description: '', cost: 10, key: '', tier: 0, rarity: 'common', texture: null });
      loadBlocks();
    } catch (error: any) {
      console.error('Failed to create block:', error);
      toast({
        title: "Error",
        description: error.message || "Failed to create block",
        variant: "destructive"
      });
    }
  };

  const handleUpdateBlock = async () => {
    if (!isSuperAdmin || !editingBlock) {
      return;
    }

    try {
      const { error } = await supabase
        .from('blocks')
        .update({
          key: editingBlock.key,
          name: editingBlock.name,
          description: editingBlock.description,
          cost: editingBlock.cost,
          category: editingBlock.category,
          rarity: editingBlock.rarity,
          class: editingBlock.class,
          tier: editingBlock.tier,
          properties: editingBlock.properties,
          glow_factor: editingBlock.glow_factor
        })
        .eq('id', editingBlock.id);

      if (error) throw error;

      toast({
        title: "Success",
        description: "Block updated successfully"
      });

      setEditingBlock(null);
      loadBlocks();
      
      // Refresh global blocks data so all components get updated
      if (typeof window !== 'undefined') {
        window.dispatchEvent(new CustomEvent('blocksUpdated'));
      }
    } catch (error: any) {
      console.error('Failed to update block:', error);
      toast({
        title: "Error",
        description: error.message || "Failed to update block",
        variant: "destructive"
      });
    }
  };

  if (loading) {
    return <div className="text-sm opacity-75">Loading blocks...</div>;
  }

  return (
    <>
      <div className="flex justify-between items-center mb-4">
        <h3 className="text-sm font-semibold">Blocks Registry</h3>
        {isSuperAdmin && (
          <Button 
            size="sm" 
            onClick={() => setShowNewBlockDialog(true)}
            className="gap-2"
          >
            <Plus className="h-4 w-4" />
            New Block
          </Button>
        )}
      </div>

      {/* Class Tabs */}
      <Tabs value={activeClass} onValueChange={(value) => setActiveClass(value as typeof activeClass)} className="mb-4">
        <TabsList className="grid w-full grid-cols-4">
          <TabsTrigger value="basic">BASIC</TabsTrigger>
          <TabsTrigger value="magic">MAGIC</TabsTrigger>
          <TabsTrigger value="mystery">MYSTERY</TabsTrigger>
          <TabsTrigger value="iconic">ICONIC</TabsTrigger>
        </TabsList>
      </Tabs>

      <ScrollArea className="h-[500px] w-full pr-4">
        <div className="space-y-2">
          {filteredBlocks.map((block) => (
            <Card key={block.id} className="p-3">
              <div className="flex items-start gap-3">
                {/* Texture Preview */}
                <div className="relative w-20 h-20 rounded border-2 flex-shrink-0 overflow-hidden bg-muted">
                  {block.texture_url ? (
                    <img 
                      src={block.texture_url} 
                      alt={block.name}
                      className="w-full h-full object-cover"
                    />
                  ) : (
                    <div 
                      className="w-full h-full"
                      style={{ backgroundColor: block.properties.color }}
                    />
                  )}
                  {isSuperAdmin && (
                    <label className="absolute inset-0 flex items-center justify-center bg-black/50 opacity-0 hover:opacity-100 transition-opacity cursor-pointer">
                      <input
                        type="file"
                        accept="image/*"
                        className="hidden"
                        onChange={(e) => {
                          const file = e.target.files?.[0];
                          if (file) handleTextureUpload(block.id, file);
                        }}
                        disabled={uploadingBlockId === block.id}
                      />
                      <Upload className="h-5 w-5 text-white" />
                    </label>
                  )}
                  {uploadingBlockId === block.id && (
                    <div className="absolute inset-0 flex items-center justify-center bg-black/70">
                      <div className="text-white text-xs">Uploading...</div>
                    </div>
                  )}
                </div>

                {/* Block Info */}
                <div className="flex-1 min-w-0 text-xs space-y-1">
                  <div className="font-bold truncate">{block.name}</div>
                  <div className="opacity-75 line-clamp-2">{block.description || 'No description'}</div>
                  <div className="flex items-center gap-2 mt-1 flex-wrap">
                    <span className="px-2 py-0.5 rounded bg-secondary text-secondary-foreground text-[10px]">
                      {block.category}
                    </span>
                    <span className="px-2 py-0.5 rounded bg-accent text-accent-foreground text-[10px]">
                      {block.rarity}
                    </span>
                    <span className="px-2 py-0.5 rounded bg-primary text-primary-foreground text-[10px]">
                      Tier {block.tier}
                    </span>
                    <span className="opacity-50 text-[10px]">{block.cost} coins</span>
                  </div>
                  <div className="text-[10px] opacity-50 font-mono mt-1 truncate">
                    Key: {block.key}
                  </div>
                  {block.texture_url && (
                    <div className="text-[10px] opacity-50 font-mono mt-1 truncate">
                      Texture: {block.texture_url.split('/').pop()}
                    </div>
                  )}
                </div>

                {/* Edit Button */}
                {isSuperAdmin && (
                  <Button 
                    size="sm" 
                    variant="outline"
                    onClick={() => setEditingBlock(block)}
                    className="flex-shrink-0 h-8"
                  >
                    Edit
                  </Button>
                )}
              </div>
            </Card>
          ))}
        </div>
      </ScrollArea>

      {/* New Block Dialog */}
      {showNewBlockDialog && (
        <Dialog open={showNewBlockDialog} onOpenChange={setShowNewBlockDialog}>
          <DialogContent className="max-w-md">
            <DialogHeader>
              <DialogTitle>Create New Block - {activeClass.toUpperCase()}</DialogTitle>
            </DialogHeader>
            <div className="space-y-4 mt-4">
              <div className="p-3 bg-muted rounded-md">
                <p className="text-sm text-muted-foreground">
                  This block will be created in the <span className="font-semibold text-foreground">{activeClass.toUpperCase()}</span> class
                </p>
              </div>
              <div>
                <Label htmlFor="block-name">Block Name</Label>
                <Input
                  id="block-name"
                  value={newBlockData.name}
                  onChange={(e) => setNewBlockData({ ...newBlockData, name: e.target.value })}
                  placeholder="e.g., Diamond Block"
                />
              </div>
              <div>
                <Label htmlFor="block-key">Block Key (unique identifier)</Label>
                <Input
                  id="block-key"
                  value={newBlockData.key}
                  onChange={(e) => setNewBlockData({ ...newBlockData, key: e.target.value.toLowerCase().replace(/\s+/g, '_') })}
                  placeholder="e.g., diamond_block"
                />
              </div>
              <div>
                <Label htmlFor="block-description">Description</Label>
                <Input
                  id="block-description"
                  value={newBlockData.description}
                  onChange={(e) => setNewBlockData({ ...newBlockData, description: e.target.value })}
                  placeholder="Brief description of the block"
                />
              </div>
              <div>
                <Label htmlFor="block-cost">Cost (coins)</Label>
                <Input
                  id="block-cost"
                  type="number"
                  value={newBlockData.cost}
                  onChange={(e) => setNewBlockData({ ...newBlockData, cost: parseInt(e.target.value) || 10 })}
                  min="1"
                />
              </div>
              <div>
                <Label htmlFor="block-tier">Tier (0-30)</Label>
                <select
                  id="block-tier"
                  value={newBlockData.tier}
                  onChange={(e) => setNewBlockData({ ...newBlockData, tier: parseInt(e.target.value) || 0 })}
                  className="flex h-10 w-full rounded-md border border-input bg-background px-3 py-2 text-sm ring-offset-background focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring z-50"
                >
                  {Array.from({ length: 31 }, (_, i) => (
                    <option key={i} value={i}>Tier {i}</option>
                  ))}
                </select>
              </div>
              <div>
                <Label htmlFor="block-rarity">Rarity</Label>
                <select
                  id="block-rarity"
                  value={newBlockData.rarity || 'common'}
                  onChange={(e) => setNewBlockData({ ...newBlockData, rarity: e.target.value as AdminBlock['rarity'] })}
                  className="flex h-10 w-full rounded-md border border-input bg-background px-3 py-2 text-sm ring-offset-background focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring z-50"
                >
                  <option value="common">Common</option>
                  <option value="uncommon">Uncommon</option>
                  <option value="rare">Rare</option>
                  <option value="epic">Epic</option>
                  <option value="legendary">Legendary</option>
                  <option value="divine">Divine</option>
                  <option value="mystic">Mystic</option>
                  <option value="rainbow">Rainbow</option>
                  <option value="apocalyptic">Apocalyptic</option>
                  <option value="infinite">Infinite</option>
                </select>
              </div>
              <div>
                <Label htmlFor="block-texture">Texture Image</Label>
                <Input
                  id="block-texture"
                  type="file"
                  accept="image/*"
                  onChange={(e) => setNewBlockData({ ...newBlockData, texture: e.target.files?.[0] || null })}
                />
                {newBlockData.texture && (
                  <div className="text-xs text-muted-foreground mt-1">
                    Selected: {newBlockData.texture.name}
                  </div>
                )}
              </div>
              <div className="flex gap-2 justify-end">
                <Button variant="outline" onClick={() => setShowNewBlockDialog(false)}>
                  Cancel
                </Button>
                <Button onClick={handleCreateBlock}>
                  Create Block
                </Button>
              </div>
            </div>
          </DialogContent>
        </Dialog>
      )}

      {/* Edit Block Dialog */}
      {editingBlock && (
        <Dialog open={!!editingBlock} onOpenChange={(open) => !open && setEditingBlock(null)}>
          <DialogContent className="max-w-md max-h-[90vh] overflow-y-auto">
            <DialogHeader>
              <DialogTitle>Edit Block: {editingBlock.name}</DialogTitle>
            </DialogHeader>
            <div className="space-y-4 mt-4">
              {/* Class */}
              <div>
                <Label htmlFor="edit-block-class">Block Class</Label>
                <select
                  id="edit-block-class"
                  value={editingBlock.class}
                  onChange={(e) => setEditingBlock({ ...editingBlock, class: e.target.value as AdminBlock['class'] })}
                  className="flex h-10 w-full rounded-md border border-input bg-background px-3 py-2 text-sm ring-offset-background focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring"
                >
                  <option value="basic">BASIC</option>
                  <option value="magic">MAGIC</option>
                  <option value="mystery">MYSTERY</option>
                  <option value="iconic">ICONIC</option>
                </select>
              </div>
              {/* Texture Upload */}
              <div>
                <Label>Current Texture</Label>
                <div className="relative w-24 h-24 rounded border-2 overflow-hidden bg-muted mb-2">
                  {editingBlock.texture_url ? (
                    <img 
                      src={editingBlock.texture_url} 
                      alt={editingBlock.name}
                      className="w-full h-full object-cover"
                      key={editingBlock.texture_url}
                    />
                  ) : (
                    <div 
                      className="w-full h-full"
                      style={{ backgroundColor: editingBlock.properties?.color || '#808080' }}
                    />
                  )}
                </div>
                <input
                  id="edit-block-texture-input"
                  type="file"
                  accept="image/*"
                  className="hidden"
                  onChange={async (e) => {
                    const file = e.target.files?.[0];
                    if (file) {
                      await handleTextureUpload(editingBlock.id, file);
                      // Reload blocks to get the new texture URL
                      await loadBlocks();
                      // Update the editingBlock state with the new texture URL
                      const { data: updatedBlock } = await supabase
                        .from('blocks')
                        .select('*')
                        .eq('id', editingBlock.id)
                        .single();
                      if (updatedBlock) {
                        setEditingBlock(updatedBlock as unknown as AdminBlock);
                      }
                    }
                  }}
                />
                <Button 
                  variant="outline" 
                  className="w-full mb-2"
                  onClick={() => document.getElementById('edit-block-texture-input')?.click()}
                >
                  Upload New Texture
                </Button>
                {editingBlock.texture_url && (
                  <p className="text-xs text-muted-foreground">
                    Current: {editingBlock.texture_url.split('/').pop()}
                  </p>
                )}
              </div>

              {/* Name */}
              <div>
                <Label htmlFor="edit-block-name">Block Name</Label>
                <Input
                  id="edit-block-name"
                  value={editingBlock.name}
                  onChange={(e) => setEditingBlock({ ...editingBlock, name: e.target.value })}
                />
              </div>

              {/* Key */}
              <div>
                <Label htmlFor="edit-block-key">Block Key (unique identifier)</Label>
                <Input
                  id="edit-block-key"
                  value={editingBlock.key}
                  onChange={(e) => setEditingBlock({ ...editingBlock, key: e.target.value.toLowerCase().replace(/\s+/g, '_') })}
                  className="font-mono"
                />
                <p className="text-xs text-muted-foreground mt-1">
                  ⚠️ Changing the key may break existing references
                </p>
              </div>

              {/* Description */}
              <div>
                <Label htmlFor="edit-block-description">Description</Label>
                <Input
                  id="edit-block-description"
                  value={editingBlock.description || ''}
                  onChange={(e) => setEditingBlock({ ...editingBlock, description: e.target.value })}
                />
              </div>

              {/* Cost */}
              <div>
                <Label htmlFor="edit-block-cost">Cost (coins)</Label>
                <Input
                  id="edit-block-cost"
                  type="number"
                  value={editingBlock.cost}
                  onChange={(e) => setEditingBlock({ ...editingBlock, cost: parseInt(e.target.value) || 10 })}
                  min="1"
                />
              </div>

              {/* Tier */}
              <div>
                <Label htmlFor="edit-block-tier">Tier (0-30)</Label>
                <select
                  id="edit-block-tier"
                  value={editingBlock.tier}
                  onChange={(e) => setEditingBlock({ ...editingBlock, tier: parseInt(e.target.value) || 0 })}
                  className="flex h-10 w-full rounded-md border border-input bg-background px-3 py-2 text-sm ring-offset-background focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring z-50"
                >
                  {Array.from({ length: 31 }, (_, i) => (
                    <option key={i} value={i}>Tier {i}</option>
                  ))}
                </select>
              </div>

              {/* Category */}
              <div>
                <Label htmlFor="edit-block-category">Category</Label>
                <select
                  id="edit-block-category"
                  value={editingBlock.category}
                  onChange={(e) => setEditingBlock({ ...editingBlock, category: e.target.value })}
                  className="flex h-10 w-full rounded-md border border-input bg-background px-3 py-2 text-sm ring-offset-background focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring mb-2"
                >
                  <option value="building">Building</option>
                  <option value="decorative">Decorative</option>
                  <option value="special">Special</option>
                </select>
                <Button 
                  variant="outline" 
                  size="sm"
                  className="w-full"
                  onClick={() => {
                    const newCategory = prompt("Enter new category name:");
                    if (newCategory && newCategory.trim()) {
                      setEditingBlock({ ...editingBlock, category: newCategory.trim().toLowerCase() });
                    }
                  }}
                >
                  Add New Category
                </Button>
              </div>

              {/* Rarity */}
              <div>
                <Label htmlFor="edit-block-rarity">Rarity</Label>
                <select
                  id="edit-block-rarity"
                  value={editingBlock.rarity}
                  onChange={(e) => setEditingBlock({ ...editingBlock, rarity: e.target.value as AdminBlock['rarity'] })}
                  className="flex h-10 w-full rounded-md border border-input bg-background px-3 py-2 text-sm ring-offset-background focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring z-50"
                >
                  <option value="common">Common</option>
                  <option value="uncommon">Uncommon</option>
                  <option value="rare">Rare</option>
                  <option value="epic">Epic</option>
                  <option value="legendary">Legendary</option>
                  <option value="divine">Divine</option>
                  <option value="mystic">Mystic</option>
                  <option value="rainbow">Rainbow</option>
                  <option value="apocalyptic">Apocalyptic</option>
                  <option value="infinite">Infinite</option>
                </select>
              </div>

              {/* Properties */}
              <div className="space-y-3 border-t pt-3">
                <Label className="text-sm font-semibold">Properties</Label>
                
                {/* Color */}
                <div>
                  <Label htmlFor="edit-block-color">Block Color</Label>
                  <div className="flex gap-2 items-center">
                    <Input
                      id="edit-block-color"
                      type="color"
                      value={editingBlock.properties.color}
                      onChange={(e) => setEditingBlock({ 
                        ...editingBlock, 
                        properties: { ...editingBlock.properties, color: e.target.value }
                      })}
                      className="w-20 h-10"
                    />
                    <span className="text-xs text-muted-foreground">{editingBlock.properties.color}</span>
                  </div>
                </div>

                {/* Emissive */}
                <div className="flex items-center gap-2">
                  <input
                    type="checkbox"
                    id="edit-block-emissive"
                    checked={editingBlock.properties.emissive}
                    onChange={(e) => setEditingBlock({
                      ...editingBlock,
                      properties: { ...editingBlock.properties, emissive: e.target.checked }
                    })}
                    className="w-4 h-4"
                  />
                  <Label htmlFor="edit-block-emissive" className="cursor-pointer">
                    Emissive (glowing)
                  </Label>
                </div>

                {/* Glow Factor - only show when emissive is checked */}
                {editingBlock.properties.emissive && (
                  <div>
                    <Label htmlFor="edit-block-glow-factor">Glow Factor (0-10)</Label>
                    <Input
                      id="edit-block-glow-factor"
                      type="number"
                      step="0.1"
                      min="0"
                      max="10"
                      value={editingBlock.glow_factor || 3.0}
                      onChange={(e) => setEditingBlock({
                        ...editingBlock,
                        glow_factor: parseFloat(e.target.value) || 3.0
                      })}
                    />
                    <p className="text-xs text-muted-foreground mt-1">
                      Controls emissive intensity and light brightness (0 = no glow, 10 = maximum)
                    </p>
                  </div>
                )}

                {/* Transparent */}
                <div className="flex items-center gap-2">
                  <input
                    type="checkbox"
                    id="edit-block-transparent"
                    checked={editingBlock.properties.transparent}
                    onChange={(e) => setEditingBlock({
                      ...editingBlock,
                      properties: { ...editingBlock.properties, transparent: e.target.checked }
                    })}
                    className="w-4 h-4"
                  />
                  <Label htmlFor="edit-block-transparent" className="cursor-pointer">
                    Transparent (glass-like)
                  </Label>
                </div>
              </div>

              {/* Actions */}
              <div className="flex gap-2 justify-end border-t pt-4">
                <Button variant="outline" onClick={() => setEditingBlock(null)}>
                  Cancel
                </Button>
                <Button onClick={handleUpdateBlock}>
                  Save Changes
                </Button>
              </div>
            </div>
          </DialogContent>
        </Dialog>
      )}
    </>
  );
}

interface WeatherControlsProps {
  settings: {
    lightingRange: [number, number];
    cycleDuration: number;
  };
  onSettingsChange: (key: string, value: number | [number, number]) => void;
}

function WeatherControls({ settings, onSettingsChange }: WeatherControlsProps) {
  return (
    <Card className="w-full p-6">
      <h3 className="font-bold text-sm mb-4">DAY/NIGHT CYCLE</h3>
      <div className="space-y-6">
        <div className="space-y-2">
          <div className="flex items-center justify-between">
            <Label className="text-sm">Day/Night Range</Label>
            <span className="text-sm font-mono opacity-75">
              {settings.lightingRange[0]}% (Day) - {settings.lightingRange[1]}% (Night)
            </span>
          </div>
          <Slider
            value={settings.lightingRange}
            onValueChange={(value) => onSettingsChange('lightingRange', value as [number, number])}
            min={0}
            max={100}
            step={1}
            minStepsBetweenThumbs={10}
            className="w-full"
          />
          <div className="flex justify-between text-xs text-muted-foreground mt-2">
            <span>0% = Pure Day (Bright Blue, No Stars)</span>
            <span>100% = Pure Night (Black, Full Stars)</span>
          </div>
        </div>

        <div className="space-y-2">
          <div className="flex items-center justify-between">
            <Label className="text-sm">Cycle Duration</Label>
            <span className="text-sm font-mono opacity-75">{settings.cycleDuration} min</span>
          </div>
          <Slider
            value={[settings.cycleDuration]}
            onValueChange={([value]) => onSettingsChange('cycleDuration', value)}
            min={1}
            max={60}
            step={1}
            className="w-full"
          />
        </div>

        <div className="text-xs text-muted-foreground mt-4 p-3 bg-muted/50 rounded">
          <p className="mb-1">
            <strong>Current behavior:</strong> Day/night will cycle between {settings.lightingRange[0]}% and {settings.lightingRange[1]}% over {settings.cycleDuration} minutes.
          </p>
          <p>
            Sky transitions from bright blue with no stars (low %) to pure black with bright stars (high %).
          </p>
        </div>
      </div>
    </Card>
  );
}

interface AdminPanelProps {
  waterfallSettings?: any;
  onWaterfallSettingsChange?: (key: string, value: any) => void;
  onWallPositionsChange?: (positions: Record<number, {x: number, y: number, z: number, rotX: number, rotY: number, rotZ: number}>) => void;
  weatherSettings?: {
    lightingRange: [number, number];
    cycleDuration: number;
  };
  onWeatherSettingsChange?: (key: string, value: number | [number, number]) => void;
}

export function AdminPanel({ 
  waterfallSettings, 
  onWaterfallSettingsChange,
  onWallPositionsChange,
  weatherSettings,
  onWeatherSettingsChange
}: AdminPanelProps) {
  const { isOpen, activeTab, closePanel, setActiveTab } = useAdminPanel();
  const { userRoles } = useUserData();

  return (
    <Dialog open={isOpen} onOpenChange={(open) => !open && closePanel()}>
      <DialogContent className="admin-panel-dialog w-full max-w-4xl max-h-[90vh] overflow-hidden flex flex-col">
        <DialogHeader>
          <DialogTitle>Admin Panel</DialogTitle>
        </DialogHeader>
        <Tabs value={activeTab} onValueChange={(value) => setActiveTab(value as any)} className="flex-1 flex flex-col overflow-hidden">
          <TabsList className="grid w-full grid-cols-5 flex-shrink-0">
            <TabsTrigger value="coins">Coins</TabsTrigger>
            <TabsTrigger value="billboards">Billboards</TabsTrigger>
            <TabsTrigger value="weather">Weather</TabsTrigger>
            <TabsTrigger value="users">Users</TabsTrigger>
            <TabsTrigger value="blocks">Blocks</TabsTrigger>
          </TabsList>

          <TabsContent value="coins" className="mt-4">
            {waterfallSettings && onWaterfallSettingsChange && (
              <WaterfallControls 
                settings={waterfallSettings}
                onSettingsChange={onWaterfallSettingsChange}
              />
            )}
          </TabsContent>

          <TabsContent value="billboards" className="mt-4">
            <BillboardControlPanel 
              isVisible={true}
              onWallPositionsChange={onWallPositionsChange}
            />
          </TabsContent>

          <TabsContent value="weather" className="mt-4">
            {weatherSettings && onWeatherSettingsChange && (
              <WeatherControls 
                settings={weatherSettings}
                onSettingsChange={onWeatherSettingsChange}
              />
            )}
          </TabsContent>

          <TabsContent value="users" className="mt-4">
            <UsersList />
          </TabsContent>

          <TabsContent value="blocks" className="mt-4">
            <BlocksList userRoles={userRoles} />
          </TabsContent>
        </Tabs>
      </DialogContent>
    </Dialog>
  );
}
