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
import { useGlowPanel } from '@/hooks/useGlowPanel';
import { usePanelDrag } from '@/hooks/usePanelDrag';
import { Tabs, TabsContent, TabsList, TabsTrigger } from '@/components/ui/tabs';
import { useAdminPanel, type NPCSubtab, type SeedSubtab, type ItemsSubtab, type WorldsSubtab } from '@/contexts/AdminPanelContext';
import { useBlocks } from '@/contexts/BlocksContext';
import { ShnakeDesignPanel } from '@/features/shnake';
import { ShombieDesignPanel } from '@/features/shombie';
import { ShroomerDesignPanel } from '@/features/shroomer';
import { VortaxDesignPanel } from '@/features/vortax';
import { ShwarmDesignPanel } from '@/features/shwarm';
import { WalapaDesignPanel } from '@/features/walapa';
import { ShtickmanDesignPanel } from '@/features/shtickman';
import { ShpiderDesignPanel } from '@/features/shpider';
import { SeedDesignPanel } from '@/features/trees';

// Build-side capability map: which creature slugs THIS build can render, their
// design panel, and which NPC tab they belong in. The registry decides WHICH of
// these appear + their order (blocking a creature there removes its panel here);
// this map just supplies the actual component a slug maps to. Pinkland ships its
// own map for its creatures.
const CREATURE_DESIGN_PANELS: Record<string, { Component: React.ComponentType; category: 'enemy' | 'friend' }> = {
  shwarm: { Component: ShwarmDesignPanel, category: 'enemy' },
  shnake: { Component: ShnakeDesignPanel, category: 'enemy' },
  shombie: { Component: ShombieDesignPanel, category: 'enemy' },
  shroomer: { Component: ShroomerDesignPanel, category: 'enemy' },
  vortax: { Component: VortaxDesignPanel, category: 'enemy' },
  shtickman: { Component: ShtickmanDesignPanel, category: 'enemy' },
  shpider: { Component: ShpiderDesignPanel, category: 'enemy' },
  walapa: { Component: WalapaDesignPanel, category: 'friend' },
};
import { AllItemsPanel } from './AdminPanel.AllItemsPanel';
import { DropTablesPanel } from './AdminPanel.DropTablesPanel';
import { PathfindingConfigPanel } from '@/features/pathfinding/components/PathfindingConfigPanel';
import { SwEnemiesPanel } from './siege/SwEnemiesPanel';
import { useUserData } from '@/hooks/useUserData';
import { useCreatureRegistry } from '@/hooks/useCreatureRegistry';
import { WaterfallControls } from './AdminPanel.WaterfallControls';
import { WeatherControls } from './AdminPanel.WeatherControls';
import { UsersList } from './AdminPanel.UsersList';
import { BlocksList } from './AdminPanel.BlocksList';
import { FlameEffectsPanel } from './AdminPanel.FlameEffectsPanel';
import { SmokeEffectsPanel } from './AdminPanel.SmokeEffectsPanel';
import { LightsEffectsPanel } from './AdminPanel.LightsEffectsPanel';
import { SolanaPanel } from './AdminPanel.SolanaPanel';
import { PoolManager } from '@/features/wallet/PoolManager';
import { GatesManager } from '@/features/tokenGates/GatesManager';
import { AtlasDebugPanel } from './AdminPanel.AtlasDebugPanel';
import { ViewSettingsPanel } from './AdminPanel.ViewSettings';
import { GifMigrationPanel } from './AdminPanel.GifMigration';
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
  // This game's creature roster from the registry (enabled + ordered), limited
  // to slugs this build can actually render.
  const { data: creatureRoster = [] } = useCreatureRegistry();
  const enemyCreatures = creatureRoster.filter(
    (c) => CREATURE_DESIGN_PANELS[c.slug]?.category === 'enemy',
  );
  const friendCreatures = creatureRoster.filter(
    (c) => CREATURE_DESIGN_PANELS[c.slug]?.category === 'friend',
  );
  const [npcSubtab, setNpcSubtab] = useState<NPCSubtab>('enemies');
  const [seedSubtab, setSeedSubtab] = useState<SeedSubtab>('ordinary');
  const [itemsSubtab, setItemsSubtab] = useState<ItemsSubtab>('all-items');
  const [coinsSubtab, setCoinsSubtab] = useState<'pools' | 'gates' | 'divi' | 'waterfall' | 'solana'>('pools');
  const [worldsSubtab, setWorldsSubtab] = useState<WorldsSubtab>('worlds');

  // Resizable dialog width — drag the left edge to widen
  const [panelWidth, setPanelWidth] = useState<number | null>(null);
  const resizingRef = useRef(false);
  const dialogRef = useRef<HTMLDivElement | null>(null);

  // When atlas tab is active and no custom width set, use wider default
  const isAtlasTab = activeTab === 'worlds' && worldsSubtab === 'atlas';
  const effectiveWidth = panelWidth ?? (isAtlasTab ? 1200 : undefined);
  const [panelHeight, setPanelHeight] = useState<number | null>(null);
  const glow = useGlowPanel();
  const drag = usePanelDrag(glow.trigger);
  useEffect(() => { if (isOpen) glow.trigger(); }, [isOpen]); // eslint-disable-line react-hooks/exhaustive-deps
  // Bottom-right corner resize (width + height), rAF-throttled like the user panel.
  const handleCornerResizeStart = useCallback((e: React.MouseEvent) => {
    e.preventDefault(); e.stopPropagation();
    glow.trigger();
    const sx = e.clientX, sy = e.clientY;
    const sw = dialogRef.current?.offsetWidth ?? 896;
    const sh = dialogRef.current?.offsetHeight ?? 600;
    let raf = false, nw = sw, nh = sh;
    const onMove = (ev: MouseEvent) => {
      nw = Math.max(600, Math.min(window.innerWidth - 40, sw + (ev.clientX - sx)));
      nh = Math.max(400, Math.min(window.innerHeight - 40, sh + (ev.clientY - sy)));
      if (raf) return; raf = true;
      requestAnimationFrame(() => { raf = false; setPanelWidth(nw); setPanelHeight(nh); });
    };
    const onUp = () => { document.removeEventListener('mousemove', onMove); document.removeEventListener('mouseup', onUp); };
    document.addEventListener('mousemove', onMove);
    document.addEventListener('mouseup', onUp);
  }, [glow]);

  const handleResizeStart = useCallback((e: React.MouseEvent) => {
    e.preventDefault();
    e.stopPropagation();
    resizingRef.current = true;
    glow.trigger();
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
          drag.panelRef.current = node;
          if (node) {
            node.style.setProperty('background', 'hsla(var(--hud-bg))', 'important');
            node.style.setProperty('border', '1px solid hsla(var(--hud-border))', 'important');
            node.style.setProperty('border-radius', '6px', 'important');
          }
        }}
        className={cn(
          "admin-panel-dialog w-full max-h-[90vh] overflow-hidden flex flex-col",
          !effectiveWidth && "max-w-4xl",
          activeTab === 'effects' && "!left-auto !right-4 !translate-x-0"
        )}
        style={{
          ...(effectiveWidth ? { maxWidth: effectiveWidth, width: effectiveWidth } : {}),
          ...(panelHeight ? { height: panelHeight, maxHeight: '95vh' } : {}),
          boxShadow: glow.boxShadow,
          transition: drag.moved ? 'none' : glow.glowTransition,
          ...drag.dragStyle,
        }}
        overlayClassName={activeTab === 'effects' ? 'bg-transparent' : undefined}
      >
        {/* Left-edge resize handle */}
        <div
          className="absolute left-0 top-0 bottom-0 w-2 cursor-ew-resize hover:bg-white/10 z-50"
          onMouseDown={handleResizeStart}
        />
        {/* Bottom-right corner resize */}
        <div
          className="absolute right-0 bottom-0 w-4 h-4 cursor-nwse-resize hover:bg-white/10 z-50"
          onMouseDown={handleCornerResizeStart}
        />
        <DialogHeader style={{ cursor: 'move' }} onMouseDown={drag.onHeaderMouseDown}>
          <DialogTitle>Admin Panel</DialogTitle>
        </DialogHeader>
        <Tabs value={activeTab} onValueChange={(value) => setActiveTab(value as any)} className="flex-1 flex flex-col overflow-hidden">
          <TabsList className="grid w-full grid-cols-12 flex-shrink-0">
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
            <TabsTrigger value="migrate">Migrate</TabsTrigger>
          </TabsList>

          <TabsContent value="coins" className="mt-4 flex-1 overflow-hidden">
            <Tabs value={coinsSubtab} onValueChange={(v) => setCoinsSubtab(v as typeof coinsSubtab)} className="flex flex-col h-full">
              <TabsList className="grid w-full grid-cols-5 flex-shrink-0 mb-4">
                <TabsTrigger value="pools">Pools</TabsTrigger>
                <TabsTrigger value="gates">Gates</TabsTrigger>
                <TabsTrigger value="divi">Divi</TabsTrigger>
                <TabsTrigger value="waterfall">Waterfall</TabsTrigger>
                <TabsTrigger value="solana">Solana</TabsTrigger>
              </TabsList>

              <TabsContent value="pools" className="flex-1 overflow-hidden mt-0">
                <ScrollArea className="h-[calc(90vh-240px)] pr-4">
                  <PoolManager />
                </ScrollArea>
              </TabsContent>

              <TabsContent value="gates" className="flex-1 overflow-hidden mt-0">
                <ScrollArea className="h-[calc(90vh-240px)] pr-4">
                  <GatesManager />
                </ScrollArea>
              </TabsContent>

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
              <TabsList className="grid w-full grid-cols-4 flex-shrink-0 mb-4">
                <TabsTrigger value="enemies">Enemies EMS</TabsTrigger>
                <TabsTrigger value="enemies-sw">Enemies SW</TabsTrigger>
                <TabsTrigger value="friends">Friends</TabsTrigger>
                <TabsTrigger value="pathfinding">Pathfinding</TabsTrigger>
              </TabsList>

              <TabsContent value="enemies" className="flex-1 overflow-hidden mt-0">
                <ScrollArea className="h-[calc(90vh-240px)] pr-4">
                  <div className="space-y-6">
                    {enemyCreatures.map((c) => {
                      const Panel = CREATURE_DESIGN_PANELS[c.slug].Component;
                      return <Panel key={c.slug} />;
                    })}
                  </div>
                </ScrollArea>
              </TabsContent>

              <TabsContent value="enemies-sw" className="flex-1 overflow-hidden mt-0">
                <ScrollArea className="h-[calc(90vh-240px)] pr-4">
                  <SwEnemiesPanel />
                </ScrollArea>
              </TabsContent>

              <TabsContent value="friends" className="flex-1 overflow-hidden mt-0">
                <ScrollArea className="h-[calc(90vh-240px)] pr-4">
                  <div className="space-y-6">
                    {friendCreatures.map((c) => {
                      const Panel = CREATURE_DESIGN_PANELS[c.slug].Component;
                      return <Panel key={c.slug} />;
                    })}
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
            <Tabs defaultValue="flame" className="flex flex-col h-full">
              <TabsList className="grid w-full grid-cols-3 flex-shrink-0 mb-4">
                <TabsTrigger value="flame">Flame</TabsTrigger>
                <TabsTrigger value="smoke">Smoke / VFX</TabsTrigger>
                <TabsTrigger value="lights">Lights</TabsTrigger>
              </TabsList>
              <TabsContent value="flame" className="flex-1 overflow-hidden mt-0">
                <ScrollArea className="h-full pr-4">
                  <FlameEffectsPanel />
                </ScrollArea>
              </TabsContent>
              <TabsContent value="smoke" className="flex-1 overflow-hidden mt-0">
                <ScrollArea className="h-full pr-4">
                  <SmokeEffectsPanel />
                </ScrollArea>
              </TabsContent>
              <TabsContent value="lights" className="flex-1 overflow-hidden mt-0">
                <ScrollArea className="h-full pr-4">
                  <LightsEffectsPanel />
                </ScrollArea>
              </TabsContent>
            </Tabs>
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

          <TabsContent value="migrate" className="mt-4 flex-1 overflow-hidden">
            <GifMigrationPanel />
          </TabsContent>
        </Tabs>
      </DialogContent>
    </Dialog>
  );
}
