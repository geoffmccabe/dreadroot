import { Dialog, DialogContent, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { ScrollArea } from "@/components/ui/scroll-area";
import { Badge } from "@/components/ui/badge";
import { useUserData } from "@/hooks/useUserData";
import { BLOCK_REGISTRY, getAllBlocks } from "@/data/blockRegistry";
import { BlockType } from "@/types/blocks";
import { supabase } from "@/integrations/supabase/client";
import { useState, useRef, useCallback, useEffect } from "react";
import { useToast } from "@/hooks/use-toast";
import { useBillboardData } from "@/hooks/useBillboardData";
import { Coins, Upload, ChevronDown, ChevronRight } from "lucide-react";

interface AdminPanelProps {
  isOpen: boolean;
  onClose: () => void;
  defaultTab?: 'coins' | 'billboards' | 'blocks';
  onWallPositionsChange?: (positions: Record<number, {x: number, y: number, z: number, rotX: number, rotY: number, rotZ: number}>) => void;
}

export function AdminPanel({ isOpen, onClose, defaultTab = 'coins', onWallPositionsChange }: AdminPanelProps) {
  const { profile, refreshData, isAdmin } = useUserData();
  const { toast } = useToast();
  const [coinAmount, setCoinAmount] = useState('');
  const [isUpdating, setIsUpdating] = useState(false);

  // Check if user has admin role
  if (!isAdmin) {
    return null;
  }

  const handleAddCoins = async () => {
    if (!profile || !coinAmount) return;

    setIsUpdating(true);
    try {
      const amount = parseInt(coinAmount);
      if (isNaN(amount)) {
        toast({
          title: "Invalid Amount",
          description: "Please enter a valid number",
          variant: "destructive"
        });
        return;
      }

      const newTotal = profile.coins + amount;
      
      const { error } = await supabase
        .from('user_profiles')
        .update({ coins: newTotal })
        .eq('user_id', profile.user_id);

      if (error) throw error;

      await refreshData();
      setCoinAmount('');
      toast({
        title: "Coins Updated",
        description: `Added ${amount} coins. New balance: ${newTotal}`
      });
    } catch (error) {
      console.error('Error adding coins:', error);
      toast({
        title: "Update Failed",
        description: "Failed to update coins",
        variant: "destructive"
      });
    } finally {
      setIsUpdating(false);
    }
  };

  return (
    <Dialog open={isOpen} onOpenChange={onClose}>
      <DialogContent className="max-w-4xl h-[90vh] flex flex-col gap-4 p-6">
        <DialogHeader className="pb-2 border-b">
          <DialogTitle>Admin Panel</DialogTitle>
        </DialogHeader>

        <Tabs defaultValue={defaultTab} className="flex-1 flex flex-col gap-4">
          <TabsList className="grid w-full grid-cols-3 h-12 bg-secondary/50 p-1 rounded-lg border-2 border-primary/20">
            <TabsTrigger 
              value="coins" 
              className="text-sm font-semibold data-[state=active]:bg-background data-[state=active]:shadow-sm"
            >
              Coins
            </TabsTrigger>
            <TabsTrigger 
              value="billboards"
              className="text-sm font-semibold data-[state=active]:bg-background data-[state=active]:shadow-sm"
            >
              Billboards
            </TabsTrigger>
            <TabsTrigger 
              value="blocks"
              className="text-sm font-semibold data-[state=active]:bg-background data-[state=active]:shadow-sm"
            >
              Blocks
            </TabsTrigger>
          </TabsList>


          {/* Coins Tab */}
          <TabsContent value="coins" className="flex-1 overflow-auto data-[state=active]:flex data-[state=active]:flex-col">
            <Card>
              <CardHeader>
                <CardTitle>Waterfall & Coins Management</CardTitle>
                <CardDescription>Manage your coin balance and resources</CardDescription>
              </CardHeader>
              <CardContent className="space-y-4">
                <div className="flex items-center gap-2 p-4 bg-muted rounded-lg">
                  <Coins className="h-6 w-6 text-primary" />
                  <div>
                    <p className="text-sm text-muted-foreground">Current Balance</p>
                    <p className="text-2xl font-bold">{profile?.coins || 0} coins</p>
                  </div>
                </div>

                <div className="space-y-2">
                  <Label htmlFor="coinAmount">Add Coins</Label>
                  <div className="flex gap-2">
                    <Input
                      id="coinAmount"
                      type="number"
                      placeholder="Enter amount..."
                      value={coinAmount}
                      onChange={(e) => setCoinAmount(e.target.value)}
                    />
                    <Button onClick={handleAddCoins} disabled={isUpdating || !coinAmount}>
                      Add Coins
                    </Button>
                  </div>
                </div>
              </CardContent>
            </Card>
          </TabsContent>

          {/* Billboards Tab */}
          <TabsContent value="billboards" className="flex-1 overflow-auto data-[state=active]:flex data-[state=active]:flex-col">
            <BillboardsTabContent onWallPositionsChange={onWallPositionsChange} />
          </TabsContent>

          {/* Blocks Tab */}
          <TabsContent value="blocks" className="flex-1 overflow-auto data-[state=active]:flex data-[state=active]:flex-col">
            <BlocksTabContent />
          </TabsContent>
        </Tabs>
      </DialogContent>
    </Dialog>
  );
}

// Billboard Tab Content Component
function BillboardsTabContent({ onWallPositionsChange }: { onWallPositionsChange?: (positions: Record<number, {x: number, y: number, z: number, rotX: number, rotY: number, rotZ: number}>) => void }) {
  const { walls, screenUrls, mediaItems, updateScreenUrl, updateMediaItem, updateWallPosition, uploadMedia } = useBillboardData();
  const { toast } = useToast();
  const [newUrls, setNewUrls] = useState<Record<number, string>>({});
  const [isCollapsed, setIsCollapsed] = useState(false);
  const [selectedWallForMoving, setSelectedWallForMoving] = useState<number>(1);
  const [tempPositions, setTempPositions] = useState<Record<number, {x: string, y: string, z: string}>>({});
  const [isUpdatingPosition, setIsUpdatingPosition] = useState(false);
  const [localWallPositions, setLocalWallPositions] = useState<Record<number, {x: number, y: number, z: number}>>({});
  const activeIntervals = useRef<Set<NodeJS.Timeout>>(new Set());

  const wall1 = walls.find(w => w.wall_number === 1);
  const wall1Urls = screenUrls.filter(url => url.wall_id === wall1?.id);

  const handleUrlUpdate = useCallback(async (slotNumber: number) => {
    if (!wall1 || isUpdatingPosition) return;
    
    setIsUpdatingPosition(true);
    try {
      const newUrl = newUrls[slotNumber];
      
      if (newUrl !== undefined) {
        await updateScreenUrl(wall1.id, slotNumber, newUrl);
        toast({
          title: "URL Updated",
          description: `Screen URL ${slotNumber} has been updated.`
        });
      }
    } catch (error) {
      console.error('Error updating URL:', error);
      toast({
        title: "Update Failed",
        description: "Failed to update screen URL.",
        variant: "destructive"
      });
    } finally {
      setIsUpdatingPosition(false);
    }
  }, [wall1, newUrls, updateScreenUrl, isUpdatingPosition, toast]);

  const handleFileUpload = async (wallNumber: number, slotNumber: number, file: File) => {
    const wall = walls.find(w => w.wall_number === wallNumber);
    if (!wall) {
      toast({
        title: "Upload Failed",
        description: `Wall ${wallNumber} not found.`,
        variant: "destructive"
      });
      return;
    }

    try {
      const mediaUrl = await uploadMedia(file);
      
      if (mediaUrl) {
        const mediaType = file.type.startsWith('image/') ? 'image' : 'video';
        const updateSuccess = await updateMediaItem(wall.id, slotNumber, mediaUrl, mediaType);
        
        if (updateSuccess) {
          toast({
            title: "Media Uploaded",
            description: `Media has been uploaded to Wall ${wallNumber}, Slot ${slotNumber}.`
          });
        }
      }
    } catch (error) {
      console.error('Error uploading:', error);
      toast({
        title: "Upload Failed",
        description: "Failed to upload media.",
        variant: "destructive"
      });
    }
  };

  const handlePositionChange = useCallback((wallNumber: number, axis: 'x' | 'y' | 'z', delta: number) => {
    const wall = walls.find(w => w.wall_number === wallNumber);
    if (!wall || isUpdatingPosition) return;

    const currentPos = localWallPositions[wallNumber] || {
      x: wall.position_x || 0,
      y: wall.position_y || 0,
      z: wall.position_z || 0
    };

    const newPos = { ...currentPos, [axis]: currentPos[axis] + delta };
    setLocalWallPositions(prev => ({ ...prev, [wallNumber]: newPos }));

    if (onWallPositionsChange) {
      onWallPositionsChange({
        [wallNumber]: {
          x: newPos.x,
          y: newPos.y,
          z: newPos.z,
          rotX: wall.rotation_x || 0,
          rotY: wall.rotation_y || 0,
          rotZ: wall.rotation_z || 0
        }
      });
    }

    // Debounced database update
    const updateDatabase = async () => {
      await updateWallPosition(
        wall.id,
        { x: newPos.x, y: newPos.y, z: newPos.z },
        { x: wall.rotation_x || 0, y: wall.rotation_y || 0, z: wall.rotation_z || 0 }
      );
    };

    setTimeout(updateDatabase, 500);
  }, [walls, localWallPositions, isUpdatingPosition, onWallPositionsChange, updateWallPosition]);

  return (
    <Card>
      <CardHeader>
        <div className="flex items-center justify-between">
          <CardTitle>Billboard Control Panel</CardTitle>
          <Button
            variant="ghost"
            size="sm"
            onClick={() => setIsCollapsed(!isCollapsed)}
          >
            {isCollapsed ? <ChevronRight /> : <ChevronDown />}
          </Button>
        </div>
      </CardHeader>
      {!isCollapsed && (
        <CardContent>
          <Tabs defaultValue="wall1">
            <TabsList className="grid w-full grid-cols-5">
              <TabsTrigger value="wall1">Screen (Wall 1)</TabsTrigger>
              <TabsTrigger value="wall2">Wall 2</TabsTrigger>
              <TabsTrigger value="wall3">Wall 3</TabsTrigger>
              <TabsTrigger value="wall4">Wall 4</TabsTrigger>
              <TabsTrigger value="move">MOVE</TabsTrigger>
            </TabsList>

            {/* Wall 1 - Screen URLs */}
            <TabsContent value="wall1" className="space-y-4">
              <ScrollArea className="h-[400px] pr-4">
                {[1, 2, 3, 4, 5, 6, 7, 8, 9].map((slot) => {
                  const existingUrl = wall1Urls.find(u => u.slot_number === slot);
                  return (
                    <div key={slot} className="mb-4 p-4 border rounded-lg">
                      <Label>Screen URL {slot}</Label>
                      <div className="flex gap-2 mt-2">
                        <Input
                          placeholder={existingUrl?.url || "Enter URL..."}
                          value={newUrls[slot] || ''}
                          onChange={(e) => setNewUrls(prev => ({ ...prev, [slot]: e.target.value }))}
                        />
                        <Button onClick={() => handleUrlUpdate(slot)} size="sm">
                          Update
                        </Button>
                      </div>
                    </div>
                  );
                })}
              </ScrollArea>
            </TabsContent>

            {/* Walls 2-4 - Media Upload */}
            {[2, 3, 4].map(wallNum => (
              <TabsContent key={wallNum} value={`wall${wallNum}`} className="space-y-4">
                <div className="grid grid-cols-2 gap-4">
                  {[1, 2, 3, 4].map(slot => (
                    <div key={slot} className="p-4 border rounded-lg">
                      <Label>Slot {slot}</Label>
                      <Input
                        type="file"
                        accept="image/*,video/*"
                        onChange={(e) => {
                          const file = e.target.files?.[0];
                          if (file) handleFileUpload(wallNum, slot, file);
                        }}
                        className="mt-2"
                      />
                    </div>
                  ))}
                </div>
              </TabsContent>
            ))}

            {/* Move Tab */}
            <TabsContent value="move" className="space-y-4">
              <div className="space-y-2">
                <Label>Select Wall to Move</Label>
                <select
                  value={selectedWallForMoving}
                  onChange={(e) => setSelectedWallForMoving(parseInt(e.target.value))}
                  className="w-full p-2 border rounded"
                >
                  {[1, 2, 3, 4].map(num => (
                    <option key={num} value={num}>Wall {num}</option>
                  ))}
                </select>
              </div>

              <div className="grid grid-cols-3 gap-4">
                {(['x', 'y', 'z'] as const).map(axis => (
                  <div key={axis} className="space-y-2">
                    <Label className="uppercase">{axis} Position</Label>
                    <div className="flex flex-col gap-2">
                      <Button
                        size="sm"
                        onClick={() => handlePositionChange(selectedWallForMoving, axis, 0.1)}
                      >
                        +0.1
                      </Button>
                      <Button
                        size="sm"
                        variant="secondary"
                        onClick={() => handlePositionChange(selectedWallForMoving, axis, -0.1)}
                      >
                        -0.1
                      </Button>
                    </div>
                  </div>
                ))}
              </div>
            </TabsContent>
          </Tabs>
        </CardContent>
      )}
    </Card>
  );
}

// Blocks Tab Content Component
function BlocksTabContent() {
  const { toast } = useToast();
  const [uploadingBlock, setUploadingBlock] = useState<string | null>(null);
  const [blockTextures, setBlockTextures] = useState<Record<string, string>>({});
  const fileInputRefs = useRef<Record<string, HTMLInputElement | null>>({});

  // Sort blocks alphabetically by name
  const sortedBlocks = getAllBlocks().sort((a, b) => a.name.localeCompare(b.name));

  // Load existing textures from storage
  useEffect(() => {
    const loadTextures = async () => {
      const textures: Record<string, string> = {};
      
      for (const block of sortedBlocks) {
        const { data } = await supabase.storage
          .from('block-textures')
          .list('', {
            search: `${block.key}`
          });

        if (data && data.length > 0) {
          const { data: { publicUrl } } = supabase.storage
            .from('block-textures')
            .getPublicUrl(data[0].name);
          
          textures[block.key] = publicUrl;
        }
      }
      
      setBlockTextures(textures);
    };

    loadTextures();
  }, []);

  const handleTextureUpload = async (blockKey: string, file: File) => {
    setUploadingBlock(blockKey);

    try {
      // Upload to Supabase storage
      const fileExt = file.name.split('.').pop();
      const fileName = `${blockKey}.${fileExt}`;
      
      const { error: uploadError } = await supabase.storage
        .from('block-textures')
        .upload(fileName, file, {
          upsert: true,
          contentType: file.type
        });

      if (uploadError) throw uploadError;

      // Get public URL
      const { data: { publicUrl } } = supabase.storage
        .from('block-textures')
        .getPublicUrl(fileName);

      setBlockTextures(prev => ({ ...prev, [blockKey]: publicUrl }));

      toast({
        title: "Texture Uploaded",
        description: `Texture for ${BLOCK_REGISTRY[blockKey].name} has been uploaded.`
      });

      // Clear file input
      if (fileInputRefs.current[blockKey]) {
        fileInputRefs.current[blockKey]!.value = '';
      }
    } catch (error) {
      console.error('Error uploading texture:', error);
      toast({
        title: "Upload Failed",
        description: "Failed to upload texture",
        variant: "destructive"
      });
    } finally {
      setUploadingBlock(null);
    }
  };

  return (
    <Card>
      <CardHeader>
        <CardTitle>Block Texture Management</CardTitle>
        <CardDescription>Upload textures for each block type (admin only)</CardDescription>
      </CardHeader>
      <CardContent>
        <ScrollArea className="h-[500px] pr-4">
          <div className="space-y-4">
            {sortedBlocks.map((block) => (
              <div key={block.key} className="p-4 border rounded-lg">
                <div className="flex items-center gap-4">
                  {/* Block Preview */}
                  <div 
                    className="w-16 h-16 rounded border-2 border-border flex-shrink-0"
                    style={{ 
                      backgroundColor: block.properties?.color || '#808080',
                      backgroundImage: blockTextures[block.key] ? `url(${blockTextures[block.key]})` : 'none',
                      backgroundSize: 'cover',
                      backgroundPosition: 'center'
                    }}
                  />

                  {/* Block Info */}
                  <div className="flex-1">
                    <div className="flex items-center gap-2">
                      <h3 className="font-semibold">{block.name}</h3>
                      <Badge variant="outline" className={getRarityColor(block.rarity)}>
                        {block.rarity}
                      </Badge>
                    </div>
                    <p className="text-sm text-muted-foreground">{block.description}</p>
                    {blockTextures[block.key] && (
                      <p className="text-xs text-primary mt-1">✓ Texture uploaded</p>
                    )}
                  </div>

                  {/* Upload Button */}
                  <div className="flex-shrink-0">
                    <input
                      ref={(el) => fileInputRefs.current[block.key] = el}
                      type="file"
                      accept="image/*"
                      onChange={(e) => {
                        const file = e.target.files?.[0];
                        if (file) handleTextureUpload(block.key, file);
                      }}
                      className="hidden"
                      id={`texture-upload-${block.key}`}
                    />
                    <Button
                      size="sm"
                      variant="outline"
                      onClick={() => document.getElementById(`texture-upload-${block.key}`)?.click()}
                      disabled={uploadingBlock === block.key}
                    >
                      <Upload className="h-4 w-4 mr-2" />
                      {uploadingBlock === block.key ? 'Uploading...' : 'Upload'}
                    </Button>
                  </div>
                </div>
              </div>
            ))}
          </div>
        </ScrollArea>
      </CardContent>
    </Card>
  );
}

const getRarityColor = (rarity: BlockType['rarity']) => {
  switch (rarity) {
    case 'common': return 'bg-muted text-muted-foreground';
    case 'rare': return 'bg-blue-500 text-white';
    case 'epic': return 'bg-purple-500 text-white';
    case 'legendary': return 'bg-amber-500 text-white';
  }
};
