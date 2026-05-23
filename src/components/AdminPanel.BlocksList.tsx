import { Button } from '@/components/ui/button';
import { Card } from '@/components/ui/card';
import { Dialog, DialogContent, DialogHeader, DialogTitle } from '@/components/ui/dialog';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { ScrollArea } from '@/components/ui/scroll-area';
import { Select } from '@/components/ui/select';
import { Slider } from '@/components/ui/slider';
import { Tabs, TabsList, TabsTrigger } from '@/components/ui/tabs';
import { useToast } from '@/hooks/use-toast';
import { supabase } from '@/integrations/supabase/client';
import { convertTextureToKtx2 } from '@/lib/ktx2';
import { KtxBackfillButton } from './KtxBackfillButton';
import { ChevronDown, ChevronRight, Plus, Upload } from 'lucide-react';
import { useEffect, useState } from 'react';
import type { AdminBlock, BlocksListProps } from './adminPanel.types';

export function BlocksList({ userRoles }: BlocksListProps) {
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
  
  // Block Rain settings
  const [blockRainSettings, setBlockRainSettings] = useState({
    blocksPerSecond: 10,
    totalBlocks: 100,
    blockLifeMinutes: 10,
    spreadRadius: 5
  });
  const [selectedRainBlocks, setSelectedRainBlocks] = useState<Set<string>>(new Set());
  const [blockRainCollapsed, setBlockRainCollapsed] = useState(false);
  
  const { toast } = useToast();

  const isSuperAdmin = userRoles.includes('superadmin');
  const isAdmin = userRoles.includes('admin') || isSuperAdmin;
  
  // Load admin block rain settings from localStorage when component mounts or tab changes to BASIC
  useEffect(() => {
    if (isAdmin && activeClass === 'basic') {
      try {
        const saved = localStorage.getItem('adminBlockRainSettings');
        if (saved) {
          const parsed = JSON.parse(saved);
          console.log('Loading saved block rain settings:', parsed);
          setBlockRainSettings({
            blocksPerSecond: parsed.blocksPerSecond || 10,
            totalBlocks: parsed.totalBlocks || 100,
            blockLifeMinutes: parsed.blockLifeMinutes || 10,
            spreadRadius: parsed.spreadRadius || 5
          });
          if (parsed.selectedBlocks && Array.isArray(parsed.selectedBlocks)) {
            setSelectedRainBlocks(new Set(parsed.selectedBlocks));
          }
        }
      } catch (error) {
        console.error('Failed to load admin block rain settings:', error);
      }
    }
  }, [isAdmin, activeClass]);
  
  
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

      // Fire-and-forget KTX2 conversion (don't block UI).
      void convertTextureToKtx2(urlData.publicUrl, 'standard').then((ktx2Url) => {
        if (ktx2Url) {
          void supabase.from('blocks').update({ texture_url_ktx2: ktx2Url }).eq('id', blockId);
        }
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

      // Insert into blocks table
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

      // Fire-and-forget KTX2 conversion for the new block.
      const newBlockId = data?.[0]?.id;
      if (textureUrl && newBlockId) {
        void convertTextureToKtx2(textureUrl, 'standard').then((ktx2Url) => {
          if (ktx2Url) {
            void supabase.from('blocks').update({ texture_url_ktx2: ktx2Url }).eq('id', newBlockId);
          }
        });
      }

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
  
  const toggleBlockRainSelection = (blockKey: string) => {
    setSelectedRainBlocks(prev => {
      const newSet = new Set(prev);
      if (newSet.has(blockKey)) {
        newSet.delete(blockKey);
      } else {
        newSet.add(blockKey);
      }
      return newSet;
    });
  };
  
  // Save admin block rain settings to localStorage whenever they change
  useEffect(() => {
    if (isAdmin && activeClass === 'basic') {
      const settingsToSave = {
        blocksPerSecond: blockRainSettings.blocksPerSecond,
        totalBlocks: blockRainSettings.totalBlocks,
        blockLifeMinutes: blockRainSettings.blockLifeMinutes,
        spreadRadius: blockRainSettings.spreadRadius,
        selectedBlocks: Array.from(selectedRainBlocks)
      };
      console.log('Saving block rain settings:', settingsToSave);
      localStorage.setItem('adminBlockRainSettings', JSON.stringify(settingsToSave));
    }
  }, [blockRainSettings, selectedRainBlocks, isAdmin, activeClass]);

  // Show loading only if we have no blocks yet (initial load)
  // This prevents showing loading during block rain when blocks are already loaded
  if (loading && blocks.length === 0) {
    return <div className="text-sm opacity-75">Loading blocks...</div>;
  }

  return (
    <>
      <div className="flex justify-between items-center mb-4">
        <h3 className="text-sm font-semibold">Blocks Registry</h3>
        <div className="flex gap-2">
          {isSuperAdmin && <KtxBackfillButton />}
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
        {/* Block Rain Controls - Only for BASIC class and Admins */}
        {activeClass === 'basic' && isAdmin && (
          <Card className="mb-4 p-4">
            <div 
              className="flex items-center justify-between mb-3 cursor-pointer"
              onClick={() => setBlockRainCollapsed(!blockRainCollapsed)}
            >
              <h3 className="font-bold text-sm">BLOCK RAIN (Admin Only)</h3>
              {blockRainCollapsed ? (
                <ChevronRight className="h-4 w-4" />
              ) : (
                <ChevronDown className="h-4 w-4" />
              )}
            </div>
            
            {!blockRainCollapsed && (
              <div className="space-y-4 animate-fade-in">
                {/* Sliders */}
                <div className="space-y-3">
                  <div className="grid grid-cols-[140px_1fr_60px] gap-2 items-center">
                    <Label className="text-xs opacity-85">Blocks per second</Label>
                    <Slider
                      value={[blockRainSettings.blocksPerSecond]}
                      onValueChange={([value]) => setBlockRainSettings({ ...blockRainSettings, blocksPerSecond: value })}
                      min={1}
                      max={50}
                      step={1}
                      className="flex-1"
                    />
                    <span className="text-xs opacity-75">{blockRainSettings.blocksPerSecond}</span>
                  </div>
                  
                  <div className="grid grid-cols-[140px_1fr_60px] gap-2 items-center">
                    <Label className="text-xs opacity-85">Total Block Rain</Label>
                    <Slider
                      value={[blockRainSettings.totalBlocks]}
                      onValueChange={([value]) => setBlockRainSettings({ ...blockRainSettings, totalBlocks: value })}
                      min={50}
                      max={500}
                      step={10}
                      className="flex-1"
                    />
                    <span className="text-xs opacity-75">{blockRainSettings.totalBlocks}</span>
                  </div>
                  
                  <div className="grid grid-cols-[140px_1fr_60px] gap-2 items-center">
                    <Label className="text-xs opacity-85">Block Life (min)</Label>
                    <Slider
                      value={[blockRainSettings.blockLifeMinutes]}
                      onValueChange={([value]) => setBlockRainSettings({ ...blockRainSettings, blockLifeMinutes: value })}
                      min={1}
                      max={1440}
                      step={1}
                      className="flex-1"
                    />
                    <span className="text-xs opacity-75">{blockRainSettings.blockLifeMinutes}</span>
                  </div>
                  
                  <div className="grid grid-cols-[140px_1fr_60px] gap-2 items-center">
                    <Label className="text-xs opacity-85">Spread Radius</Label>
                    <Slider
                      value={[blockRainSettings.spreadRadius]}
                      onValueChange={([value]) => setBlockRainSettings({ ...blockRainSettings, spreadRadius: value })}
                      min={5}
                      max={50}
                      step={1}
                      className="flex-1"
                    />
                    <span className="text-xs opacity-75">{blockRainSettings.spreadRadius} blocks</span>
                  </div>
                </div>

                {/* Block Selection Checkboxes */}
                <div>
                  <Label className="text-xs opacity-85 font-semibold mb-2 block">Select Blocks for Rain:</Label>
                  <div className="grid grid-cols-2 gap-2 max-h-[150px] overflow-y-auto">
                    {filteredBlocks.map((block) => (
                      <div key={block.id} className="flex items-center gap-2 text-xs">
                        <input
                          type="checkbox"
                          id={`rain-block-${block.id}`}
                          checked={selectedRainBlocks.has(block.key)}
                          onChange={() => toggleBlockRainSelection(block.key)}
                          className="w-4 h-4 cursor-pointer"
                        />
                        <label htmlFor={`rain-block-${block.id}`} className="cursor-pointer flex-1">
                          {block.name}
                        </label>
                      </div>
                    ))}
                  </div>
                </div>
              </div>
            )}
          </Card>
        )}
        
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
                  <option value="decoration">Decoration</option>
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
