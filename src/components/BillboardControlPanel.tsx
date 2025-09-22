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
      toast({
        title: "Position updated",
        description: `Wall ${selectedWallForMoving} moved along ${axis.toUpperCase()} axis`,
      });
    } catch (error) {
      toast({
        title: "Error updating position",
        description: "Failed to update wall position",
        variant: "destructive",
      });
    }
  };

  return (
    <div className="absolute top-[120px] left-4 z-50">
      <Card className="w-96 bg-slate-800/90 border-slate-600 text-white backdrop-blur-sm">
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
                      <div className="text-xs text-gray-300">
                        Current Position: X:{wall.position_x?.toFixed(1) ?? 0}, Y:{wall.position_y?.toFixed(1) ?? 0}, Z:{wall.position_z?.toFixed(1) ?? 0}
                      </div>
                      
                      {/* X Axis Controls */}
                      <div className="flex items-center space-x-2">
                        <span className="w-8 text-sm font-medium">X:</span>
                        <Button
                          size="sm"
                          variant="outline"
                          onMouseDown={() => {
                            const interval = setInterval(() => handlePositionChange('x', -0.1), 50);
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
                          onClick={() => handlePositionChange('x', -1)}
                        >
                          -1
                        </Button>
                        <Button
                          size="sm"
                          variant="outline"
                          onClick={() => handlePositionChange('x', 1)}
                        >
                          +1
                        </Button>
                        <Button
                          size="sm"
                          variant="outline"
                          onMouseDown={() => {
                            const interval = setInterval(() => handlePositionChange('x', 0.1), 50);
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

                      {/* Y Axis Controls */}
                      <div className="flex items-center space-x-2">
                        <span className="w-8 text-sm font-medium">Y:</span>
                        <Button
                          size="sm"
                          variant="outline"
                          onMouseDown={() => {
                            const interval = setInterval(() => handlePositionChange('y', -0.1), 50);
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
                          onClick={() => handlePositionChange('y', -1)}
                        >
                          -1
                        </Button>
                        <Button
                          size="sm"
                          variant="outline"
                          onClick={() => handlePositionChange('y', 1)}
                        >
                          +1
                        </Button>
                        <Button
                          size="sm"
                          variant="outline"
                          onMouseDown={() => {
                            const interval = setInterval(() => handlePositionChange('y', 0.1), 50);
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

                      {/* Z Axis Controls */}
                      <div className="flex items-center space-x-2">
                        <span className="w-8 text-sm font-medium">Z:</span>
                        <Button
                          size="sm"
                          variant="outline"
                          onMouseDown={() => {
                            const interval = setInterval(() => handlePositionChange('z', -0.1), 50);
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
                          onClick={() => handlePositionChange('z', -1)}
                        >
                          -1
                        </Button>
                        <Button
                          size="sm"
                          variant="outline"
                          onClick={() => handlePositionChange('z', 1)}
                        >
                          +1
                        </Button>
                        <Button
                          size="sm"
                          variant="outline"
                          onMouseDown={() => {
                            const interval = setInterval(() => handlePositionChange('z', 0.1), 50);
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
                  ) : null;
                })()}
              </div>
            </TabsContent>
          </Tabs>
          </CardContent>
        )}
      </Card>
    </div>
  );
};