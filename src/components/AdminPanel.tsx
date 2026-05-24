import React, { useState, useRef, useCallback, useEffect } from 'react';
import { AvatarPanel } from '@/components/AvatarPanel';
import { BillboardControlPanel } from '@/components/BillboardControlPanel';
import { BulletsPanel } from '@/components/WeaponsPanel';
import { WorldsList } from '@/components/WorldsList';
import { Badge } from '@/components/ui/badge';
import { Card, CardContent } from '@/components/ui/card';
import { cn } from '@/lib/utils';
import { Dialog, DialogContent, DialogHeader, DialogTitle } from '@/components/ui/dialog';
import { ScrollArea } from '@/components/ui/scroll-area';
import { Tabs, TabsContent, TabsList, TabsTrigger } from '@/components/ui/tabs';
import { useAdminPanel, type NPCSubtab, type SeedSubtab, type ItemsSubtab, type WorldsSubtab } from '@/contexts/AdminPanelContext';
import { useBlocks } from '@/contexts/BlocksContext';
import { ShnakeDesignPanel } from '@/features/shnake';
import { ShombieDesignPanel } from '@/features/shombie';
import { ShwarmDesignPanel } from '@/features/shwarm';
import { WalapaDesignPanel } from '@/features/walapa';
import { ShtickmanDesignPanel } from '@/features/shtickman';
import { ShpiderDesignPanel } from '@/features/shpider';
import { SeedDesignPanel } from '@/features/trees';
import { AllItemsPanel } from './AdminPanel.AllItemsPanel';
import { DropTablesPanel } from './AdminPanel.DropTablesPanel';
import { PathfindingConfigPanel } from '@/features/pathfinding/components/PathfindingConfigPanel';
import { useUserData } from '@/hooks/useUserData';
import { WaterfallControls } from './AdminPanel.WaterfallControls';
import { WeatherControls } from './AdminPanel.WeatherControls';
import { UsersList } from './AdminPanel.UsersList';
import { BlocksList } from './AdminPanel.BlocksList';
import { FlameEffectsPanel } from './AdminPanel.FlameEffectsPanel';
import { SolanaPanel } from './AdminPanel.SolanaPanel';
import { AtlasDebugPanel } from './AdminPanel.AtlasDebugPanel';
import { ViewSettingsPanel } from './AdminPanel.ViewSettings';
import type { AdminPanelProps } from './adminPanel.types';

export function AdminPanel({
  waterfallSettings,
  onWaterfallSettingsChange,
  onWallPositionsChange,
  onMoveModeChange,
  weatherSettings,
  onWeatherSettingsChange,
  viewSettings,
  onViewSettingsChange
}: AdminPanelProps) {
  const { isOpen, activeTab, closePanel, setActiveTab } = useAdminPanel();
  const { userRoles } = useUserData();
  const { currentWorldId, setCurrentWorldId } = useBlocks();
  const [npcSubtab, setNpcSubtab] = useState<NPCSubtab>('enemies');
  const [seedSubtab, setSeedSubtab] = useState<SeedSubtab>('ordinary');
  const [itemsSubtab, setItemsSubtab] = useState<ItemsSubtab>('all-items');
  const [coinsSubtab, setCoinsSubtab] = useState<'divi' | 'waterfall' | 'solana'>('divi');
  const [worldsSubtab, setWorldsSubtab] = useState<WorldsSubtab>('worlds');

  // Resizable dialog width — drag the left edge to widen
  const [panelWidth, setPanelWidth] = useState<number | null>(null);
  const resizingRef = useRef(false);
  const dialogRef = useRef<HTMLDivElement | null>(null);

  // When atlas tab is active and no custom width set, use wider default
  const isAtlasTab = activeTab === 'worlds' && worldsSubtab === 'atlas';
  const effectiveWidth = panelWidth ?? (isAtlasTab ? 1200 : undefined);

  const handleResizeStart = useCallback((e: React.MouseEvent) => {
    e.preventDefault();
    e.stopPropagation();
    resizingRef.current = true;
    const startX = e.clientX;
    const startWidth = dialogRef.current?.offsetWidth ?? 896;

    const onMouseMove = (ev: MouseEvent) => {
      if (!resizingRef.current) return;
      // Dragging left edge leftward increases width
      const delta = startX - ev.clientX;
      const newWidth = Math.max(600, Math.min(window.innerWidth - 40, startWidth + delta * 2));
      setPanelWidth(newWidth);
    };

    const onMouseUp = () => {
      resizingRef.current = false;
      document.removeEventListener('mousemove', onMouseMove);
      document.removeEventListener('mouseup', onMouseUp);
    };

    document.addEventListener('mousemove', onMouseMove);
    document.addEventListener('mouseup', onMouseUp);
  }, []);

  return (
    <Dialog open={isOpen} onOpenChange={(open) => !open && closePanel()}>
      <DialogContent
        ref={(node: HTMLDivElement | null) => {
          dialogRef.current = node;
          if (node) {
            node.style.setProperty('background', 'hsla(211, 30%, 51%, 0.35)', 'important');
            node.style.setProperty('border', '1px solid hsla(211, 34%, 73%, 0.8)', 'important');
            node.style.setProperty('border-radius', '6px', 'important');
          }
        }}
        className={cn(
          "admin-panel-dialog w-full max-h-[90vh] overflow-hidden flex flex-col",
          !effectiveWidth && "max-w-4xl",
          activeTab === 'effects' && "!left-auto !right-4 !translate-x-0"
        )}
        style={effectiveWidth ? { maxWidth: effectiveWidth, width: effectiveWidth } : undefined}
        overlayClassName={activeTab === 'effects' ? 'bg-transparent' : undefined}
      >
        {/* Left-edge resize handle */}
        <div
          className="absolute left-0 top-0 bottom-0 w-2 cursor-ew-resize hover:bg-white/10 z-50"
          onMouseDown={handleResizeStart}
        />
        <DialogHeader>
          <DialogTitle>Admin Panel</DialogTitle>
        </DialogHeader>
        <Tabs value={activeTab} onValueChange={(value) => setActiveTab(value as any)} className="flex-1 flex flex-col overflow-hidden">
          <TabsList className="grid w-full grid-cols-11 flex-shrink-0">
            <TabsTrigger value="coins">Coins</TabsTrigger>
            <TabsTrigger value="billboards">Billboards</TabsTrigger>
            <TabsTrigger value="weather">Weather</TabsTrigger>
            <TabsTrigger value="models">Models</TabsTrigger>
            <TabsTrigger value="users">Users</TabsTrigger>
            <TabsTrigger value="blocks">Blocks</TabsTrigger>
            <TabsTrigger value="seeds">Seeds</TabsTrigger>
            <TabsTrigger value="npcs">NPCs</TabsTrigger>
            <TabsTrigger value="items">Items</TabsTrigger>
            <TabsTrigger value="effects">Effects</TabsTrigger>
            <TabsTrigger value="worlds">Worlds</TabsTrigger>
          </TabsList>

          <TabsContent value="coins" className="mt-4 flex-1 overflow-hidden">
            <Tabs value={coinsSubtab} onValueChange={(v) => setCoinsSubtab(v as typeof coinsSubtab)} className="flex flex-col h-full">
              <TabsList className="grid w-full grid-cols-3 flex-shrink-0 mb-4">
                <TabsTrigger value="divi">Divi</TabsTrigger>
                <TabsTrigger value="waterfall">Waterfall</TabsTrigger>
                <TabsTrigger value="solana">Solana</TabsTrigger>
              </TabsList>

              <TabsContent value="divi" className="flex-1 overflow-hidden mt-0">
                <ScrollArea className="h-[calc(90vh-240px)] pr-4">
                  <div className="space-y-4">
                    <div className="flex items-center gap-2">
                      <h3 className="text-lg font-semibold">Divi</h3>
                      <Badge variant="secondary">DIVI</Badge>
                    </div>
                    <Card><CardContent className="p-4">
                      <p className="text-muted-foreground text-sm">Divi configuration coming soon.</p>
                    </CardContent></Card>
                  </div>
                </ScrollArea>
              </TabsContent>

              <TabsContent value="waterfall" className="flex-1 overflow-hidden mt-0">
                <ScrollArea className="h-[calc(90vh-240px)] pr-4">
                  {waterfallSettings && onWaterfallSettingsChange && (
                    <WaterfallControls
                      settings={waterfallSettings}
                      onSettingsChange={onWaterfallSettingsChange}
                    />
                  )}
                </ScrollArea>
              </TabsContent>

              <TabsContent value="solana" className="flex-1 overflow-hidden mt-0">
                <SolanaPanel />
              </TabsContent>
            </Tabs>
          </TabsContent>

          <TabsContent value="billboards" className="mt-4 flex-1 overflow-hidden">
            <ScrollArea className="h-full pr-4">
              <BillboardControlPanel 
                isVisible={true}
                onWallPositionsChange={onWallPositionsChange}
                onMoveModeChange={onMoveModeChange}
              />
            </ScrollArea>
          </TabsContent>

          <TabsContent value="weather" className="mt-4 flex-1 overflow-hidden">
            <ScrollArea className="h-[calc(90vh-180px)] pr-4">
              {weatherSettings && onWeatherSettingsChange && (
                <WeatherControls 
                  settings={weatherSettings}
                  onSettingsChange={onWeatherSettingsChange}
                />
              )}
            </ScrollArea>
          </TabsContent>

          <TabsContent value="models" className="mt-4 flex-1 overflow-hidden">
            <ScrollArea className="h-full pr-4">
              <AvatarPanel />
            </ScrollArea>
          </TabsContent>

          <TabsContent value="users" className="mt-4 flex-1 overflow-hidden">
            <ScrollArea className="h-full pr-4">
              <UsersList />
            </ScrollArea>
          </TabsContent>

          <TabsContent value="blocks" className="mt-4 flex-1 overflow-hidden">
            <ScrollArea className="h-full pr-4">
              <BlocksList userRoles={userRoles} />
            </ScrollArea>
          </TabsContent>

          <TabsContent value="seeds" className="mt-4 flex-1 overflow-hidden">
            <Tabs value={seedSubtab} onValueChange={(v) => setSeedSubtab(v as SeedSubtab)} className="flex flex-col h-full">
              <TabsList className="grid w-full grid-cols-3 flex-shrink-0 mb-4">
                <TabsTrigger value="ordinary">Ordinary Trees</TabsTrigger>
                <TabsTrigger value="wide">Wide Trees</TabsTrigger>
                <TabsTrigger value="fungal">Fungal Trees</TabsTrigger>
              </TabsList>

              <TabsContent value="ordinary" className="flex-1 overflow-hidden mt-0">
                <ScrollArea className="h-[calc(90vh-240px)] pr-4">
                  <SeedDesignPanel treeType="original" />
                </ScrollArea>
              </TabsContent>

              <TabsContent value="wide" className="flex-1 overflow-hidden mt-0">
                <ScrollArea className="h-[calc(90vh-240px)] pr-4">
                  <SeedDesignPanel treeType="wide" />
                </ScrollArea>
              </TabsContent>

              <TabsContent value="fungal" className="flex-1 overflow-hidden mt-0">
                <ScrollArea className="h-[calc(90vh-240px)] pr-4">
                  <SeedDesignPanel treeType="fungal" />
                </ScrollArea>
              </TabsContent>
            </Tabs>
          </TabsContent>

          <TabsContent value="npcs" className="mt-4 flex-1 overflow-hidden">
            <Tabs value={npcSubtab} onValueChange={(v) => setNpcSubtab(v as NPCSubtab)} className="flex flex-col h-full">
              <TabsList className="grid w-full grid-cols-3 flex-shrink-0 mb-4">
                <TabsTrigger value="enemies">Enemies</TabsTrigger>
                <TabsTrigger value="friends">Friends</TabsTrigger>
                <TabsTrigger value="pathfinding">Pathfinding</TabsTrigger>
              </TabsList>

              <TabsContent value="enemies" className="flex-1 overflow-hidden mt-0">
                <ScrollArea className="h-[calc(90vh-240px)] pr-4">
                  <div className="space-y-6">
                    <ShwarmDesignPanel />
                    <ShnakeDesignPanel />
                    <ShombieDesignPanel />
                    <ShtickmanDesignPanel />
                    <ShpiderDesignPanel />
                  </div>
                </ScrollArea>
              </TabsContent>

              <TabsContent value="friends" className="flex-1 overflow-hidden mt-0">
                <ScrollArea className="h-[calc(90vh-240px)] pr-4">
                  <div className="space-y-6">
                    <WalapaDesignPanel />
                  </div>
                </ScrollArea>
              </TabsContent>

              <TabsContent value="pathfinding" className="flex-1 overflow-hidden mt-0">
                <ScrollArea className="h-[calc(90vh-240px)] pr-4">
                  <PathfindingConfigPanel />
                </ScrollArea>
              </TabsContent>
            </Tabs>
          </TabsContent>

          <TabsContent value="items" className="mt-4 flex-1 overflow-hidden">
            <Tabs value={itemsSubtab} onValueChange={(v) => setItemsSubtab(v as ItemsSubtab)} className="flex flex-col h-full">
              <TabsList className="grid w-full grid-cols-4 flex-shrink-0 mb-4">
                <TabsTrigger value="all-items">All Items</TabsTrigger>
                <TabsTrigger value="weapons-items">Weapons</TabsTrigger>
                <TabsTrigger value="bullets">Bullets</TabsTrigger>
                <TabsTrigger value="drop-tables">Drop Tables</TabsTrigger>
              </TabsList>

              <TabsContent value="all-items" className="flex-1 overflow-hidden mt-0">
                <ScrollArea className="h-[calc(90vh-240px)] pr-4">
                  <AllItemsPanel />
                </ScrollArea>
              </TabsContent>

              <TabsContent value="weapons-items" className="flex-1 overflow-hidden mt-0">
                <ScrollArea className="h-[calc(90vh-240px)] pr-4">
                  <Card><CardContent className="p-4">
                    <p className="text-muted-foreground text-sm">Weapons configuration coming soon.</p>
                  </CardContent></Card>
                </ScrollArea>
              </TabsContent>

              <TabsContent value="bullets" className="flex-1 overflow-hidden mt-0">
                <ScrollArea className="h-[calc(90vh-240px)] pr-4">
                  <BulletsPanel />
                </ScrollArea>
              </TabsContent>

              <TabsContent value="drop-tables" className="flex-1 overflow-hidden mt-0">
                <ScrollArea className="h-[calc(90vh-240px)] pr-4">
                  <DropTablesPanel />
                </ScrollArea>
              </TabsContent>
            </Tabs>
          </TabsContent>

          <TabsContent value="effects" className="mt-4 flex-1 overflow-hidden">
            <ScrollArea className="h-full pr-4">
              <FlameEffectsPanel />
            </ScrollArea>
          </TabsContent>

          <TabsContent value="worlds" className="mt-4 flex-1 overflow-hidden">
            <Tabs value={worldsSubtab} onValueChange={(v) => setWorldsSubtab(v as WorldsSubtab)} className="flex flex-col h-full">
              <TabsList className="grid w-full grid-cols-5 flex-shrink-0 mb-4">
                <TabsTrigger value="settings">Settings</TabsTrigger>
                <TabsTrigger value="worlds">Worlds</TabsTrigger>
                <TabsTrigger value="view">View</TabsTrigger>
                <TabsTrigger value="fix">Fix</TabsTrigger>
                <TabsTrigger value="atlas">Atlas</TabsTrigger>
              </TabsList>

              <TabsContent value="settings" className="flex-1 overflow-hidden mt-0">
                <ScrollArea className="h-[calc(90vh-240px)] pr-4">
                  <WorldsList currentWorldId={currentWorldId} onWorldChange={setCurrentWorldId} subtab="settings" />
                </ScrollArea>
              </TabsContent>

              <TabsContent value="worlds" className="flex-1 overflow-hidden mt-0">
                <ScrollArea className="h-[calc(90vh-240px)] pr-4">
                  <WorldsList currentWorldId={currentWorldId} onWorldChange={setCurrentWorldId} subtab="worlds" />
                </ScrollArea>
              </TabsContent>

              <TabsContent value="view" className="flex-1 overflow-hidden mt-0">
                <ScrollArea className="h-[calc(90vh-240px)] pr-4">
                  {viewSettings && onViewSettingsChange ? (
                    <ViewSettingsPanel viewSettings={viewSettings} onUpdate={onViewSettingsChange} />
                  ) : (
                    <p className="text-sm text-muted-foreground p-4">View settings not available.</p>
                  )}
                </ScrollArea>
              </TabsContent>

              <TabsContent value="fix" className="flex-1 overflow-hidden mt-0">
                <ScrollArea className="h-[calc(90vh-240px)] pr-4">
                  <WorldsList currentWorldId={currentWorldId} onWorldChange={setCurrentWorldId} subtab="fix" />
                </ScrollArea>
              </TabsContent>

              <TabsContent value="atlas" className="flex-1 overflow-hidden mt-0">
                <ScrollArea className="h-[calc(90vh-240px)] pr-4">
                  <AtlasDebugPanel />
                </ScrollArea>
              </TabsContent>
            </Tabs>
          </TabsContent>
        </Tabs>
      </DialogContent>
    </Dialog>
  );
}
