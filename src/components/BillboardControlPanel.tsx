import React, { useState } from 'react';
import { Card, CardContent } from '@/components/ui/card';
import { Tabs, TabsContent, TabsList, TabsTrigger } from '@/components/ui/tabs';
import { Input } from '@/components/ui/input';
import { Button } from '@/components/ui/button';
import { Label } from '@/components/ui/label';
import { ChevronDown, ChevronRight } from 'lucide-react';
import { useBillboardData } from '@/hooks/useBillboardData';
import { useToast } from '@/hooks/use-toast';

interface BillboardControlPanelProps {
  isVisible: boolean;
}

export const BillboardControlPanel: React.FC<BillboardControlPanelProps> = ({ isVisible }) => {
  const { walls, screenUrls, mediaItems, updateScreenUrl, updateMediaItem, updateWallPosition, uploadMedia } = useBillboardData();
  const { toast } = useToast();
  const [newUrls, setNewUrls] = useState<Record<number, string>>({});
  const [isCollapsed, setIsCollapsed] = useState(false);
  const [selectedWallForMoving, setSelectedWallForMoving] = useState<number>(1);
  const [tempPositions, setTempPositions] = useState<Record<number, {x: string, y: string, z: string}>>({});

  if (!isVisible) return null;
  
  const wall1 = walls.find(w => w.wall_number === 1);
  const wall1Urls = screenUrls.filter(url => url.wall_id === wall1?.id);

  const handleUrlUpdate = async (slotNumber: number) => {
    if (!wall1) return;
    
    const newUrl = newUrls[slotNumber];
    
    if (newUrl !== undefined) {
      await updateScreenUrl(wall1.id, slotNumber, newUrl);
      toast({
        title: "URL Updated",
        description: `Screen URL ${slotNumber} has been updated.`
      });
    }
  };

  const handleFileUpload = async (wallNumber: number, slotNumber: number, file: File) => {
    const wall = walls.find(w => w.wall_number === wallNumber);
    if (!wall) return;

    const mediaUrl = await uploadMedia(file);
    if (mediaUrl) {
      const mediaType = file.type.startsWith('image/') ? 'image' : 'video';
      await updateMediaItem(wall.id, slotNumber, mediaUrl, mediaType);
      toast({
        title: "Media Uploaded",
        description: `Media has been uploaded to Wall ${wallNumber}, Slot ${slotNumber}.`
      });
    }
  };

  const getMediaItemsForWall = (wallNumber: number) => {
    const wall = walls.find(w => w.wall_number === wallNumber);
    if (!wall) return [];
    return mediaItems
      .filter(item => item.wall_id === wall.id)
      .sort((a, b) => a.slot_number - b.slot_number);
  };

  const handlePositionChange = async (axis: 'x' | 'y' | 'z', delta: number) => {
    const wall = walls.find(w => w.wall_number === selectedWallForMoving);
    if (!wall) return;

    const currentPosition = {
      x: wall.position_x ?? 0,
      y: wall.position_y ?? 0,
      z: wall.position_z ?? 0
    };

    const currentRotation = {
      x: wall.rotation_x ?? 0,
      y: wall.rotation_y ?? 0,
      z: wall.rotation_z ?? 0
    };

    const newPosition = {
      ...currentPosition,
      [axis]: currentPosition[axis] + delta
    };

    try {
      await updateWallPosition(wall.id, newPosition, currentRotation);
      // No toast - real-time feedback through visual movement
    } catch (error) {
      console.error('Error updating wall position:', error);
    }
  };

  const handleDirectPositionChange = async (axis: 'x' | 'y' | 'z', value: number) => {
    const wall = walls.find(w => w.wall_number === selectedWallForMoving);
    if (!wall) return;

    const currentRotation = {
      x: wall.rotation_x ?? 0,
      y: wall.rotation_y ?? 0,
      z: wall.rotation_z ?? 0
    };

    const newPosition = {
      x: axis === 'x' ? value : (wall.position_x ?? 0),
      y: axis === 'y' ? value : (wall.position_y ?? 0),
      z: axis === 'z' ? value : (wall.position_z ?? 0)
    };

    try {
      await updateWallPosition(wall.id, newPosition, currentRotation);
    } catch (error) {
      console.error('Error updating wall position:', error);
    }
  };

  const handleTempPositionChange = (axis: 'x' | 'y' | 'z', value: string) => {
    setTempPositions(prev => ({
      ...prev,
      [selectedWallForMoving]: {
        ...prev[selectedWallForMoving],
        [axis]: value
      }
    }));
  };

  const handlePositionSubmit = (axis: 'x' | 'y' | 'z') => {
    const tempValue = tempPositions[selectedWallForMoving]?.[axis];
    if (tempValue !== undefined) {
      const numValue = parseFloat(tempValue);
      if (!isNaN(numValue)) {
        handleDirectPositionChange(axis, numValue);
      }
    }
  };

  const getTempOrActualPosition = (wall: any, axis: 'x' | 'y' | 'z') => {
    const tempValue = tempPositions[selectedWallForMoving]?.[axis];
    if (tempValue !== undefined) {
      return tempValue;
    }
    const actualValue = axis === 'x' ? wall.position_x : axis === 'y' ? wall.position_y : wall.position_z;
    return (actualValue ?? 0).toString();
  };

  const getWallPreview = (wallNumber: number) => {
    const wallConfigs = {
      1: { name: "Screen Wall", color: "#4f46e5", icon: "📺" },
      2: { name: "Right Wall", color: "#059669", icon: "🖼️" },
      3: { name: "Back Wall", color: "#dc2626", icon: "🖼️" },
      4: { name: "Left Wall", color: "#7c3aed", icon: "🖼️" }
    };
    
    const config = wallConfigs[wallNumber as keyof typeof wallConfigs];
    return (
      <div className="flex flex-col items-center space-y-1 ml-4">
        <div 
          className="w-12 h-8 border border-gray-400 flex items-center justify-center text-xs rounded"
          style={{ backgroundColor: config.color }}
        >
          {config.icon}
        </div>
        <span className="text-xs text-gray-300">{config.name}</span>
      </div>
    );
  };

  return (
    <Card className="waterfall-card bg-slate-800/90 border-slate-600 text-white backdrop-blur-sm">
      <div 
        className="flex items-center justify-between p-3 cursor-pointer border-b border-slate-600"
        onClick={() => setIsCollapsed(!isCollapsed)}
      >
        <h3 className="font-bold text-sm">BILLBOARD CONTROL PANEL</h3>
        {isCollapsed ? (
          <ChevronRight className="h-4 w-4" />
        ) : (
          <ChevronDown className="h-4 w-4" />
        )}
      </div>
        
        {!isCollapsed && (
          <CardContent className="p-4 animate-fade-in">
          <Tabs defaultValue="wall1" className="w-full">
            <TabsList className="grid w-full grid-cols-5">
              <TabsTrigger value="wall1">Screen (Wall 1)</TabsTrigger>
              <TabsTrigger value="wall2">Wall 2</TabsTrigger>
              <TabsTrigger value="wall3">Wall 3</TabsTrigger>
              <TabsTrigger value="wall4">Wall 4</TabsTrigger>
              <TabsTrigger value="move">MOVE</TabsTrigger>
            </TabsList>
            
            <TabsContent value="wall1" className="space-y-4">
              <div className="space-y-4">
                <h3 className="text-lg font-semibold">Screen URLs</h3>
                {wall1Urls.map((urlData) => (
                  <div key={urlData.slot_number} className="space-y-2">
                    <Label htmlFor={`url-${urlData.slot_number}`}>
                      URL Slot {urlData.slot_number}
                    </Label>
                    <div className="flex gap-2">
                      <Input
                        id={`url-${urlData.slot_number}`}
                        placeholder={urlData.url || "Enter URL..."}
                        value={newUrls[urlData.slot_number] ?? urlData.url ?? ''}
                        onChange={(e) => setNewUrls(prev => ({
                          ...prev,
                          [urlData.slot_number]: e.target.value
                        }))}
                      />
                      <Button 
                        onClick={() => handleUrlUpdate(urlData.slot_number)}
                        size="sm"
                      >
                        Update
                      </Button>
                    </div>
                  </div>
                ))}
              </div>
            </TabsContent>

            {[2, 3, 4].map(wallNumber => (
              <TabsContent key={wallNumber} value={`wall${wallNumber}`} className="space-y-4">
                <div className="space-y-4">
                  <h3 className="text-lg font-semibold">Media Grid - Wall {wallNumber}</h3>
                  <div className="grid grid-cols-2 gap-4">
                    {Array.from({ length: 6 }, (_, index) => {
                      const slotNumber = index + 1;
                      const mediaItem = getMediaItemsForWall(wallNumber).find(item => item.slot_number === slotNumber);
                      
                      return (
                        <div key={slotNumber} className="space-y-2">
                          <Label>Slot {slotNumber}</Label>
                          <div className="border-2 border-dashed border-muted rounded-lg p-4 text-center">
                            {mediaItem?.media_url ? (
                              <div className="space-y-2">
                                {mediaItem.media_type === 'image' ? (
                                  <img 
                                    src={mediaItem.media_url} 
                                    alt={`Slot ${slotNumber}`}
                                    className="max-w-full h-20 object-cover mx-auto"
                                  />
                                ) : (
                                  <video 
                                    src={mediaItem.media_url}
                                    className="max-w-full h-20 object-cover mx-auto"
                                    controls
                                  />
                                )}
                                <p className="text-xs text-muted-foreground">
                                  {mediaItem.media_type}
                                </p>
                              </div>
                            ) : (
                              <p className="text-muted-foreground">No media</p>
                            )}
                            
                            <input
                              type="file"
                              accept="image/*,video/*"
                              onChange={(e) => {
                                const file = e.target.files?.[0];
                                if (file) {
                                  handleFileUpload(wallNumber, slotNumber, file);
                                }
                              }}
                              className="mt-2 text-xs"
                            />
                          </div>
                        </div>
                      );
                    })}
                  </div>
                </div>
              </TabsContent>
            ))}

            <TabsContent value="move" className="space-y-4">
              <div className="space-y-4">
                <div className="flex items-center space-x-2">
                  <label className="text-sm font-medium">Select Wall:</label>
                  <select 
                    value={selectedWallForMoving}
                    onChange={(e) => setSelectedWallForMoving(parseInt(e.target.value))}
                    className="px-3 py-1 border rounded-md bg-slate-700 text-white border-slate-600"
                  >
                    <option value={1}>Screen (Wall 1)</option>
                    <option value={2}>Wall 2</option>
                    <option value={3}>Wall 3</option>
                    <option value={4}>Wall 4</option>
                  </select>
                </div>

                {(() => {
                  const wall = walls.find(w => w.wall_number === selectedWallForMoving);
                  return wall ? (
                    <div className="space-y-3">
                      {/* Editable Position Fields */}
                      <div className="space-y-2">
                        <Label className="text-sm font-medium text-white">Current Position (editable):</Label>
                        <div className="grid grid-cols-3 gap-2">
                          <div className="space-y-1">
                            <Label className="text-xs text-gray-300">X:</Label>
                            <Input
                              type="number"
                              step="0.1"
                              value={getTempOrActualPosition(wall, 'x')}
                              onChange={(e) => handleTempPositionChange('x', e.target.value)}
                              onBlur={() => handlePositionSubmit('x')}
                              onKeyDown={(e) => e.key === 'Enter' && handlePositionSubmit('x')}
                              className="h-8 text-xs bg-slate-700 text-white border-slate-600"
                            />
                          </div>
                          <div className="space-y-1">
                            <Label className="text-xs text-gray-300">Y:</Label>
                            <Input
                              type="number"
                              step="0.1"
                              value={getTempOrActualPosition(wall, 'y')}
                              onChange={(e) => handleTempPositionChange('y', e.target.value)}
                              onBlur={() => handlePositionSubmit('y')}
                              onKeyDown={(e) => e.key === 'Enter' && handlePositionSubmit('y')}
                              className="h-8 text-xs bg-slate-700 text-white border-slate-600"
                            />
                          </div>
                          <div className="space-y-1">
                            <Label className="text-xs text-gray-300">Z:</Label>
                            <Input
                              type="number"
                              step="0.1"
                              value={getTempOrActualPosition(wall, 'z')}
                              onChange={(e) => handleTempPositionChange('z', e.target.value)}
                              onBlur={() => handlePositionSubmit('z')}
                              onKeyDown={(e) => e.key === 'Enter' && handlePositionSubmit('z')}
                              className="h-8 text-xs bg-slate-700 text-white border-slate-600"
                            />
                          </div>
                        </div>
                      </div>
                      
                      <div className="flex items-start space-x-4">
                        <div className="space-y-3 flex-1">
                          {/* X Axis Controls - Increased increments for visibility */}
                          <div className="flex items-center space-x-2">
                            <span className="w-8 text-sm font-medium text-white">X:</span>
                            <Button
                              size="sm"
                              variant="outline"
                              className="text-slate-800 bg-white border-slate-400 hover:bg-slate-100"
                              onMouseDown={() => {
                                const interval = setInterval(() => handlePositionChange('x', -1), 50);
                                const stopInterval = () => {
                                  clearInterval(interval);
                                  document.removeEventListener('mouseup', stopInterval);
                                };
                                document.addEventListener('mouseup', stopInterval);
                              }}
                            >
                              ←
                            </Button>
                            <Button
                              size="sm"
                              variant="outline"
                              className="text-slate-800 bg-white border-slate-400 hover:bg-slate-100"
                              onClick={() => handlePositionChange('x', -5)}
                            >
                              -5
                            </Button>
                            <Button
                              size="sm"
                              variant="outline"
                              className="text-slate-800 bg-white border-slate-400 hover:bg-slate-100"
                              onClick={() => handlePositionChange('x', 5)}
                            >
                              +5
                            </Button>
                            <Button
                              size="sm"
                              variant="outline"
                              className="text-slate-800 bg-white border-slate-400 hover:bg-slate-100"
                              onMouseDown={() => {
                                const interval = setInterval(() => handlePositionChange('x', 1), 50);
                                const stopInterval = () => {
                                  clearInterval(interval);
                                  document.removeEventListener('mouseup', stopInterval);
                                };
                                document.addEventListener('mouseup', stopInterval);
                              }}
                            >
                              →
                            </Button>
                          </div>

                          {/* Y Axis Controls - Increased increments for visibility */}
                          <div className="flex items-center space-x-2">
                            <span className="w-8 text-sm font-medium text-white">Y:</span>
                            <Button
                              size="sm"
                              variant="outline"
                              className="text-slate-800 bg-white border-slate-400 hover:bg-slate-100"
                              onMouseDown={() => {
                                const interval = setInterval(() => handlePositionChange('y', -1), 50);
                                const stopInterval = () => {
                                  clearInterval(interval);
                                  document.removeEventListener('mouseup', stopInterval);
                                };
                                document.addEventListener('mouseup', stopInterval);
                              }}
                            >
                              ↓
                            </Button>
                            <Button
                              size="sm"
                              variant="outline"
                              className="text-slate-800 bg-white border-slate-400 hover:bg-slate-100"
                              onClick={() => handlePositionChange('y', -5)}
                            >
                              -5
                            </Button>
                            <Button
                              size="sm"
                              variant="outline"
                              className="text-slate-800 bg-white border-slate-400 hover:bg-slate-100"
                              onClick={() => handlePositionChange('y', 5)}
                            >
                              +5
                            </Button>
                            <Button
                              size="sm"
                              variant="outline"
                              className="text-slate-800 bg-white border-slate-400 hover:bg-slate-100"
                              onMouseDown={() => {
                                const interval = setInterval(() => handlePositionChange('y', 1), 50);
                                const stopInterval = () => {
                                  clearInterval(interval);
                                  document.removeEventListener('mouseup', stopInterval);
                                };
                                document.addEventListener('mouseup', stopInterval);
                              }}
                            >
                              ↑
                            </Button>
                          </div>

                          {/* Z Axis Controls - Increased increments for visibility */}
                          <div className="flex items-center space-x-2">
                            <span className="w-8 text-sm font-medium text-white">Z:</span>
                            <Button
                              size="sm"
                              variant="outline"
                              className="text-slate-800 bg-white border-slate-400 hover:bg-slate-100"
                              onMouseDown={() => {
                                const interval = setInterval(() => handlePositionChange('z', -1), 50);
                                const stopInterval = () => {
                                  clearInterval(interval);
                                  document.removeEventListener('mouseup', stopInterval);
                                };
                                document.addEventListener('mouseup', stopInterval);
                              }}
                            >
                              ←
                            </Button>
                            <Button
                              size="sm"
                              variant="outline"
                              className="text-slate-800 bg-white border-slate-400 hover:bg-slate-100"
                              onClick={() => handlePositionChange('z', -5)}
                            >
                              -5
                            </Button>
                            <Button
                              size="sm"
                              variant="outline"
                              className="text-slate-800 bg-white border-slate-400 hover:bg-slate-100"
                              onClick={() => handlePositionChange('z', 5)}
                            >
                              +5
                            </Button>
                            <Button
                              size="sm"
                              variant="outline"
                              className="text-slate-800 bg-white border-slate-400 hover:bg-slate-100"
                              onMouseDown={() => {
                                const interval = setInterval(() => handlePositionChange('z', 1), 50);
                                const stopInterval = () => {
                                  clearInterval(interval);
                                  document.removeEventListener('mouseup', stopInterval);
                                };
                                document.addEventListener('mouseup', stopInterval);
                              }}
                            >
                              →
                            </Button>
                          </div>
                        </div>
                        
                        {/* Wall Preview */}
                        {getWallPreview(selectedWallForMoving)}
                      </div>
                    </div>
                  ) : null;
                })()}
              </div>
            </TabsContent>
          </Tabs>
          </CardContent>
        )}
    </Card>
  );
};