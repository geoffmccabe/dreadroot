import React, { useState } from 'react';
import { Card, CardContent } from '@/components/ui/card';
import { Tabs, TabsContent, TabsList, TabsTrigger } from '@/components/ui/tabs';
import { Input } from '@/components/ui/input';
import { Button } from '@/components/ui/button';
import { Label } from '@/components/ui/label';
import { ChevronDown, ChevronRight } from 'lucide-react';
import { useBillboardData } from '@/hooks/useBillboardData';
import { useToast } from '@/hooks/use-toast';

export const BillboardControlPanel: React.FC<{ isVisible: boolean }> = ({ isVisible }) => {
  const { walls, screenUrls, mediaItems, updateScreenUrl, updateMediaItem, uploadMedia } = useBillboardData();
  const { toast } = useToast();
  const [newUrls, setNewUrls] = useState<{ [key: string]: string }>({});
  const [isCollapsed, setIsCollapsed] = useState(false);

  if (!isVisible) return null;
  
  const wall1 = walls.find(w => w.wall_number === 1);
  const wall1Urls = screenUrls.filter(url => url.wall_id === wall1?.id);

  const handleUrlUpdate = async (slotNumber: number) => {
    if (!wall1) return;
    
    const key = `url-${slotNumber}`;
    const newUrl = newUrls[key];
    
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
    return mediaItems.filter(item => item.wall_id === wall.id);
  };

  return (
    <Card className="waterfall-card max-w-2xl">
      <div 
        className="flex items-center justify-between mb-3 cursor-pointer"
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
        <CardContent className="p-0 animate-fade-in">
        <Tabs defaultValue="wall-1">
          <TabsList className="grid w-full grid-cols-4">
            <TabsTrigger value="wall-1">Wall 1 (Screen)</TabsTrigger>
            <TabsTrigger value="wall-2">Wall 2 (Media)</TabsTrigger>
            <TabsTrigger value="wall-3">Wall 3 (Media)</TabsTrigger>
            <TabsTrigger value="wall-4">Wall 4 (Media)</TabsTrigger>
          </TabsList>
          
          <TabsContent value="wall-1" className="space-y-4">
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
                      value={newUrls[`url-${urlData.slot_number}`] ?? urlData.url ?? ''}
                      onChange={(e) => setNewUrls(prev => ({
                        ...prev,
                        [`url-${urlData.slot_number}`]: e.target.value
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
            <TabsContent key={wallNumber} value={`wall-${wallNumber}`} className="space-y-4">
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
        </Tabs>
        </CardContent>
      )}
    </Card>
  );
};