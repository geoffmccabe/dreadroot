import React, { useState, useCallback, useRef, useEffect } from 'react';
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
  onWallPositionsChange?: (positions: Record<number, {x: number, y: number, z: number, rotX: number, rotY: number, rotZ: number}>) => void;
}

export const BillboardControlPanel: React.FC<BillboardControlPanelProps> = ({ isVisible, onWallPositionsChange }) => {
  const { walls, screenUrls, mediaItems, updateScreenUrl, updateMediaItem, updateWallPosition, uploadMedia, savePendingChanges } = useBillboardData();
  const { toast } = useToast();
  const [newUrls, setNewUrls] = useState<Record<number, string>>({});
  const [isCollapsed, setIsCollapsed] = useState(false);
  const [selectedWallForMoving, setSelectedWallForMoving] = useState<number>(1);
  const [tempPositions, setTempPositions] = useState<Record<number, {x: string, y: string, z: string}>>({});
  const [isUpdatingPosition, setIsUpdatingPosition] = useState(false);
  
  // Local wall positions (override database positions for real-time control)
  const [localWallPositions, setLocalWallPositions] = useState<Record<number, {x: number, y: number, z: number}>>({});
  
  // Ref to track active intervals for cleanup
  const activeIntervals = useRef<Set<NodeJS.Timeout>>(new Set());

  if (!isVisible) return null;
  
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
  }, [wall1, newUrls, updateScreenUrl, toast, isUpdatingPosition]);

  const handleFileUpload = async (wallNumber: number, slotNumber: number, file: File) => {
    const wall = walls.find(w => w.wall_number === wallNumber);
    if (!wall) {
      console.error('Wall not found:', wallNumber);
      return;
    }

    console.log('Starting file upload for wall', wallNumber, 'slot', slotNumber);
    
    try {
      const mediaUrl = await uploadMedia(file);
      console.log('Upload result:', mediaUrl);
      
      if (mediaUrl) {
        const mediaType = file.type.startsWith('image/') ? 'image' : 'video';
        console.log('Updating media item with:', { wallId: wall.id, slotNumber, mediaUrl, mediaType });
        
        await updateMediaItem(wall.id, slotNumber, mediaUrl, mediaType);
        
        toast({
          title: "Media Uploaded",
          description: `Media has been uploaded to Wall ${wallNumber}, Slot ${slotNumber}.`
        });
      } else {
        console.error('Upload failed - no URL returned');
        toast({
          title: "Upload Failed",
          description: "Failed to upload media file.",
          variant: "destructive"
        });
      }
    } catch (error) {
      console.error('File upload error:', error);
      toast({
        title: "Upload Error", 
        description: "An error occurred during upload.",
        variant: "destructive"
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

  // Optimized position change handler - immediate UI feedback, debounced database updates
  const handlePositionChange = useCallback((axis: 'x' | 'y' | 'z', delta: number) => {
    console.log('handlePositionChange called:', { axis, delta, selectedWallForMoving });
    
    const wall = walls.find(w => w.wall_number === selectedWallForMoving);
    if (!wall || isUpdatingPosition) {
      console.log('handlePositionChange early return:', { wall: !!wall, isUpdatingPosition });
      return;
    }

    // Use local position if available, otherwise fall back to database position
    const currentLocalPos = localWallPositions[selectedWallForMoving];
    const currentPosition = currentLocalPos || {
      x: wall.position_x ?? 0,
      y: wall.position_y ?? 0,
      z: wall.position_z ?? 0
    };

    console.log('Current position before change:', currentPosition);

    const newPosition = {
      ...currentPosition,
      [axis]: currentPosition[axis] + delta
    };

    console.log('New position after change:', newPosition);

    // Update local position immediately for real-time feedback (synchronous)
    setLocalWallPositions(prev => {
      const updated = {
        ...prev,
        [selectedWallForMoving]: newPosition
      };
      console.log('Updating localWallPositions:', updated);
      return updated;
    });

    // Notify parent component about position changes (synchronous)
    if (onWallPositionsChange) {
      const allPositions: Record<number, {x: number, y: number, z: number, rotX: number, rotY: number, rotZ: number}> = {};
      walls.forEach(w => {
        const localPos = selectedWallForMoving === w.wall_number ? newPosition : localWallPositions[w.wall_number];
        const pos = localPos || {
          x: w.position_x ?? 0,
          y: w.position_y ?? 0,
          z: w.position_z ?? 0
        };
        allPositions[w.wall_number] = {
          ...pos,
          rotX: w.rotation_x ?? 0,
          rotY: w.rotation_y ?? 0,
          rotZ: w.rotation_z ?? 0
        };
      });
      onWallPositionsChange(allPositions);
    }

    // Queue database update (non-blocking)
    updateDatabasePosition(wall, newPosition);
  }, [walls, selectedWallForMoving, localWallPositions, onWallPositionsChange, isUpdatingPosition]);

  // Separate function for database updates to prevent UI blocking
  const updateDatabasePosition = useCallback(async (wall: any, newPosition: {x: number, y: number, z: number}) => {
    try {
      const currentRotation = {
        x: wall.rotation_x ?? 0,
        y: wall.rotation_y ?? 0,
        z: wall.rotation_z ?? 0
      };
      
      // This runs in background and doesn't block UI
      await updateWallPosition(wall.id, newPosition, currentRotation);
    } catch (error) {
      console.error('Error updating wall position:', error);
    }
  }, [updateWallPosition]);

  // Cleanup function for intervals
  const cleanupIntervals = useCallback(() => {
    activeIntervals.current.forEach(interval => clearInterval(interval));
    activeIntervals.current.clear();
  }, []);

  // Improved mouse handlers with proper cleanup
  const createMouseHandler = useCallback((axis: 'x' | 'y' | 'z', delta: number) => {
    return () => {
      if (isUpdatingPosition) return;
      
      cleanupIntervals(); // Clear any existing intervals
      
      const interval = setInterval(() => {
        handlePositionChange(axis, delta);
      }, 100); // Slower interval for better control
      
      activeIntervals.current.add(interval);
      
      const cleanup = () => {
        clearInterval(interval);
        activeIntervals.current.delete(interval);
        document.removeEventListener('mouseup', cleanup);
        document.removeEventListener('mouseleave', cleanup);
      };
      
      document.addEventListener('mouseup', cleanup);
      document.addEventListener('mouseleave', cleanup);
    };
  }, [handlePositionChange, isUpdatingPosition, cleanupIntervals]);

  // Single click handler
  const handleSingleClick = useCallback((axis: 'x' | 'y' | 'z', delta: number) => {
    if (isUpdatingPosition) return;
    handlePositionChange(axis, delta);
  }, [handlePositionChange, isUpdatingPosition]);

  const handleDirectPositionChange = async (axis: 'x' | 'y' | 'z', value: number) => {
    const wall = walls.find(w => w.wall_number === selectedWallForMoving);
    if (!wall) return;

    // Use local position if available, otherwise fall back to database position
    const currentLocalPos = localWallPositions[selectedWallForMoving];
    const currentPosition = currentLocalPos || {
      x: wall.position_x ?? 0,
      y: wall.position_y ?? 0,
      z: wall.position_z ?? 0
    };

    const newPosition = {
      ...currentPosition,
      [axis]: value
    };

    // Update local position immediately for real-time feedback
    setLocalWallPositions(prev => ({
      ...prev,
      [selectedWallForMoving]: newPosition
    }));

    // Notify parent component about position changes
    if (onWallPositionsChange) {
      const allPositions: Record<number, {x: number, y: number, z: number, rotX: number, rotY: number, rotZ: number}> = {};
      walls.forEach(w => {
        const localPos = selectedWallForMoving === w.wall_number ? newPosition : localWallPositions[w.wall_number];
        const pos = localPos || {
          x: w.position_x ?? 0,
          y: w.position_y ?? 0,
          z: w.position_z ?? 0
        };
        allPositions[w.wall_number] = {
          ...pos,
          rotX: w.rotation_x ?? 0,
          rotY: w.rotation_y ?? 0,
          rotZ: w.rotation_z ?? 0
        };
      });
      onWallPositionsChange(allPositions);
    }

    const currentRotation = {
      x: wall.rotation_x ?? 0,
      y: wall.rotation_y ?? 0,
      z: wall.rotation_z ?? 0
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
    
    // Use local position if available, otherwise fall back to database position
    const localPos = localWallPositions[selectedWallForMoving];
    console.log('getTempOrActualPosition:', { 
      selectedWallForMoving, 
      axis, 
      localPos, 
      localWallPositions,
      wallDbPos: { x: wall.position_x, y: wall.position_y, z: wall.position_z }
    });
    
    if (localPos) {
      console.log('Using local position:', localPos[axis]);
      return localPos[axis].toString();
    }
    
    const actualValue = axis === 'x' ? wall.position_x : axis === 'y' ? wall.position_y : wall.position_z;
    console.log('Using database position:', actualValue);
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

  // Cleanup intervals on unmount
  useEffect(() => {
    return () => {
      cleanupIntervals();
    };
  }, [cleanupIntervals]);

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
                         disabled={isUpdatingPosition}
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
                 <div className="flex items-center justify-between">
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
                   
                   <Button 
                     onClick={async () => {
                       console.log('💾 Save button clicked');
                       const result = await savePendingChanges();
                       if (result.success) {
                         if (result.count > 0) {
                           toast({
                             title: "Positions Saved",
                             description: `Successfully saved ${result.count} wall position(s).`
                           });
                         } else {
                           toast({
                             title: "No Changes",
                             description: "No position changes to save."
                           });
                         }
                       } else {
                         toast({
                           title: "Save Failed",
                           description: "Failed to save wall positions.",
                           variant: "destructive"
                         });
                       }
                     }}
                     size="sm"
                     variant="outline"
                     className="border-slate-600 bg-slate-700 text-slate-300 hover:bg-slate-600 hover:text-white"
                   >
                     💾 Save Positions
                   </Button>
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
                               onClick={() => handleSingleClick('x', -1)}
                               disabled={isUpdatingPosition}
                             >
                               ←
                             </Button>
                             <Button
                               size="sm"
                               variant="outline"
                               className="text-slate-800 bg-white border-slate-400 hover:bg-slate-100"
                               onClick={() => handleSingleClick('x', -5)}
                               disabled={isUpdatingPosition}
                             >
                               -5
                             </Button>
                             <Button
                               size="sm"
                               variant="outline"
                               className="text-slate-800 bg-white border-slate-400 hover:bg-slate-100"
                               onClick={() => handleSingleClick('x', 5)}
                               disabled={isUpdatingPosition}
                             >
                               +5
                             </Button>
                             <Button
                               size="sm"
                               variant="outline"
                               className="text-slate-800 bg-white border-slate-400 hover:bg-slate-100"
                               onClick={() => handleSingleClick('x', 1)}
                               disabled={isUpdatingPosition}
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
                               onClick={() => handleSingleClick('y', -1)}
                               disabled={isUpdatingPosition}
                             >
                               ↓
                             </Button>
                             <Button
                               size="sm"
                               variant="outline"
                               className="text-slate-800 bg-white border-slate-400 hover:bg-slate-100"
                               onClick={() => handleSingleClick('y', -5)}
                               disabled={isUpdatingPosition}
                             >
                               -5
                             </Button>
                             <Button
                               size="sm"
                               variant="outline"
                               className="text-slate-800 bg-white border-slate-400 hover:bg-slate-100"
                               onClick={() => handleSingleClick('y', 5)}
                               disabled={isUpdatingPosition}
                             >
                               +5
                             </Button>
                             <Button
                               size="sm"
                               variant="outline"
                               className="text-slate-800 bg-white border-slate-400 hover:bg-slate-100"
                               onClick={() => handleSingleClick('y', 1)}
                               disabled={isUpdatingPosition}
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
                               onClick={() => handleSingleClick('z', -1)}
                               disabled={isUpdatingPosition}
                             >
                               ←
                             </Button>
                             <Button
                               size="sm"
                               variant="outline"
                               className="text-slate-800 bg-white border-slate-400 hover:bg-slate-100"
                               onClick={() => handleSingleClick('z', -5)}
                               disabled={isUpdatingPosition}
                             >
                               -5
                             </Button>
                             <Button
                               size="sm"
                               variant="outline"
                               className="text-slate-800 bg-white border-slate-400 hover:bg-slate-100"
                               onClick={() => handleSingleClick('z', 5)}
                               disabled={isUpdatingPosition}
                             >
                               +5
                             </Button>
                             <Button
                               size="sm"
                               variant="outline"
                               className="text-slate-800 bg-white border-slate-400 hover:bg-slate-100"
                               onClick={() => handleSingleClick('z', 1)}
                               disabled={isUpdatingPosition}
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