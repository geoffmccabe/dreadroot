import React, { useRef, useState, useEffect, useCallback } from 'react';
import { Canvas } from '@react-three/fiber';
import { Perf } from 'r3f-perf';
import * as THREE from 'three';
import { Button } from '@/components/ui/button';
import { Eye } from 'lucide-react';
import { BlockPreview } from '@/components/BlockPreview';
import { UserPanel } from '@/components/UserPanel';
import { AdminPanel } from '@/components/AdminPanel';
import { FPSDisplay, DFlowOutputPanel } from '@/components/FPSCounter';
import { PerformanceOverlay } from '@/components/PerformanceOverlay';
import { useUserData } from '@/hooks/useUserData';
import { useBlocks } from '@/contexts/BlocksContext';
import { useAuth } from '@/contexts/AuthContext';
import { useUserPanel } from '@/contexts/UserPanelContext';
import { useAdminPanel } from '@/contexts/AdminPanelContext';
import { useTokenTheme } from '@/contexts/TokenThemeContext';
import { useToast } from '@/hooks/use-toast';
import { Toaster } from '@/components/ui/toaster';
import { findInventoryItem, getInventoryQuantity } from '@/lib/inventoryHelpers';
import { heightMap, fallingBlocksState } from '@/components/PlacedBlocks';

import { FortressScene } from './FortressScene';
import { createMainAudioRefs, preloadRejectionSound, playReversedAudio } from './FortressAudio';
import { FlyingCoin, GameSettings, WeatherSettings } from './FortressTypes';
import { diagnostics } from '@/lib/diagnosticsLogger';

// Main Fortress orchestrator component
export function Fortress() {
  const { currentTheme, isLoading: themeLoading } = useTokenTheme();
  
  const defaultColorPalette = [
    { hex: '#06c8c0', weight: 10 },
    { hex: '#028eef', weight: 10 },
    { hex: '#194ca8', weight: 20 },
    { hex: '#18488a', weight: 30 },
    { hex: '#103d6a', weight: 30 },
    { hex: '#0a2847', weight: 15 }
  ];

  const [settings, setSettings] = useState<GameSettings>({
    flowSpeed: 1.2,
    msBetweeenDrops: 1,
    coinRate: 6,
    coinSize: 0.8,
    colorPalette: defaultColorPalette
  });
  
  // Load settings from current theme
  useEffect(() => {
    if (currentTheme && !themeLoading) {
      console.log('Loading theme settings:', currentTheme.display_name);
      setSettings({
        flowSpeed: currentTheme.flow_speed,
        msBetweeenDrops: currentTheme.ms_between_drops,
        coinRate: currentTheme.coin_rate,
        coinSize: currentTheme.coin_size,
        colorPalette: currentTheme.color_palette as GameSettings['colorPalette']
      });
    }
  }, [currentTheme, themeLoading]);
  
  // Weather settings state
  const [weatherSettings, setWeatherSettings] = useState<WeatherSettings>(() => {
    const stored = localStorage.getItem('weatherSettings');
    if (stored) {
      const parsed = JSON.parse(stored);
      if ('maxLighting' in parsed && 'minLighting' in parsed) {
        return {
          lightingRange: [parsed.minLighting, parsed.maxLighting] as [number, number],
          cycleDuration: parsed.cycleDuration || 5
        };
      }
      return parsed;
    }
    return {
      lightingRange: [0, 100] as [number, number],
      cycleDuration: 2
    };
  });
  
  // UI State
  const [coinScore, setCoinScore] = useState(0);
  const [crosshairsEnabled, setCrosshairsEnabled] = useState(false);
  const [selectedBlockType, setSelectedBlockType] = useState<string | null>(null);
  const [blockPlacementMode, setBlockPlacementMode] = useState(false);
  const [showOwnershipOutline, setShowOwnershipOutline] = useState(false);
  const [showPerfMonitor, setShowPerfMonitor] = useState(false);
  const [hoveredBlockId, setHoveredBlockId] = useState<string | null>(null);
  const [wallPositions, setWallPositions] = useState<Record<number, {x: number, y: number, z: number, rotX: number, rotY: number, rotZ: number}>>({});
  const [isMoveMode, setIsMoveMode] = useState(false);
  const [flyingCoins, setFlyingCoins] = useState<FlyingCoin[]>([]);
  const [godMode, setGodMode] = useState(false);
  const [performanceMode, setPerformanceMode] = useState(false);
  
  // Waterfall disabled for performance testing (Phase 1)
  const waterfallEnabled = false;
  
  // Hooks
  const { profile, tokenBalance, inventory, userRoles, addCoins, useBlock, refreshData, collectWispBlock } = useUserData();
  const { blocks, placeBlock, removeBlock, setBlockMode } = useBlocks();
  const { user, signOut } = useAuth();
  const { toast } = useToast();
  const { isOpen: panelOpen, openPanel } = useUserPanel();
  const { openPanel: openAdminPanel } = useAdminPanel();
  
  // Audio refs
  const mainAudioRefs = useRef(createMainAudioRefs());
  const rejectionSoundRef = useRef<{ audioContext: AudioContext | null; buffer: AudioBuffer | null }>({
    audioContext: null,
    buffer: null
  });
  
  // Inventory ref for fresh values in callbacks
  const inventoryRef = useRef(inventory);
  useEffect(() => {
    inventoryRef.current = inventory;
  }, [inventory]);
  
  // Mode change ref to avoid circular dependency
  const handleModeChangeRef = useRef<((mode: 'shooting' | 'building' | null) => void) | null>(null);

  // Initialize audio
  useEffect(() => {
    mainAudioRefs.current.woodenThud.preload = 'auto';
    mainAudioRefs.current.woodenThud.load();
    
    preloadRejectionSound().then(data => {
      rejectionSoundRef.current = data;
      (window as any).__rejectionSound = data;
      console.log('Rejection sound preloaded');
    });
    
    return () => {
      if (rejectionSoundRef.current.audioContext) {
        rejectionSoundRef.current.audioContext.close();
      }
    };
  }, []);

  // Block removal handler
  const handleBlockRemove = useCallback(async (blockId: string) => {
    playReversedAudio('/wooden_thud_sound.mp3');
    
    const success = await removeBlock(blockId);
    if (success) {
      toast({
        title: "Block removed",
        description: "Block returned to inventory",
        duration: 2000
      });
    }
  }, [removeBlock, toast]);

  // Settings handlers
  const handleSettingsChange = (key: string, value: any) => {
    setSettings(prev => ({ ...prev, [key]: value }));
  };
  
  const handleWeatherSettingsChange = (key: string, value: number | [number, number]) => {
    setWeatherSettings(prev => {
      const newSettings = { ...prev, [key]: value };
      localStorage.setItem('weatherSettings', JSON.stringify(newSettings));
      return newSettings;
    });
  };

  // Coin hit handler
  const handleCoinHit = useCallback(async (position: THREE.Vector3, screenPosition?: { x: number; y: number }) => {
    const coinId = Math.random().toString(36).substr(2, 9);
    const startTime = Date.now();
    let startX = screenPosition?.x || window.innerWidth / 2;
    let startY = screenPosition?.y || window.innerHeight / 2;
    
    setFlyingCoins(prev => [...prev, { id: coinId, startX, startY, startTime }]);

    const audio = new Audio('/coin_hit_sound.mp3');
    audio.volume = 0.3;
    audio.play();

    setTimeout(async () => {
      const success = await addCoins(1);
      if (success) {
        setCoinScore(prev => prev + 1);
      }
      setFlyingCoins(prev => prev.filter(coin => coin.id !== coinId));
    }, 600);
  }, [addCoins]);

  // Block rain batch handler - non-blocking, uses requestAnimationFrame for smooth placement
  const handleBlockRainBatch = useCallback((
    positions: Array<{ x: number; y: number; z: number; type: string }>,
    rainSettings?: { blocksPerSecond?: number; blockLifeMinutes?: number; totalBlocks?: number; spreadRadius?: number }
  ) => {
    if (!placeBlock) {
      console.error('placeBlock is not available');
      return;
    }
    
    const isInForbiddenZone = (x: number, z: number): boolean => {
      const position = new THREE.Vector3(x, 0, z);
      const fortressCenter = new THREE.Vector3(0, 0, -20);
      const fortressMinDistance = 30;
      const waterfallZ = -6;
      const waterfallBlockingWidth = 4;
      
      if (position.distanceTo(fortressCenter) < fortressMinDistance) return true;
      if (Math.abs(x) < waterfallBlockingWidth / 2 && z > waterfallZ) return true;
      return false;
    };
    
    const blockLifeMinutes = rainSettings?.blockLifeMinutes || 10;
    const blocksPerSecond = rainSettings?.blocksPerSecond || 10;
    const msPerBlock = 1000 / blocksPerSecond;
    
    // Use imported heightMap and fallingBlocksState
    const localHeightMap = new Map<string, number>(heightMap);
    
    let placedCount = 0;
    let currentIndex = 0;
    const startTime = Date.now();
    let nextPlaceTime = startTime;
    
    console.log('Block rain starting:', positions.length, 'positions, rate:', blocksPerSecond, '/sec');
    
    // Non-blocking placement loop using setTimeout for precise timing
    const placeNextBlock = () => {
      if (currentIndex >= positions.length) {
        // All blocks placed - show completion toast
        const duration = ((Date.now() - startTime) / 1000).toFixed(1);
        const actualRate = placedCount > 0 ? (placedCount / parseFloat(duration)).toFixed(1) : '0';
        console.log('Block rain complete:', placedCount, 'blocks in', duration, 's');
        toast({
          title: "Block Rain Complete!",
          description: `${placedCount} blocks placed in ${duration}s (${actualRate}/sec)`,
          duration: 3000
        });
        return;
      }
      
      const pos = positions[currentIndex];
      const key = `${pos.x},${pos.z}`;
      const targetY = localHeightMap.get(key) || 0;
      const inForbiddenZone = isInForbiddenZone(pos.x, pos.z);
      const expiresAt = inForbiddenZone 
        ? new Date(Date.now()).toISOString()
        : new Date(Date.now() + blockLifeMinutes * 60 * 1000).toISOString();
      
      const placedBlock = placeBlock(pos.x, targetY, pos.z, pos.type, expiresAt);
      console.log('Placed block', currentIndex, ':', placedBlock?.id, 'at', pos.x, targetY, pos.z);
      
      if (placedBlock) {
        // Set falling state - blocks will fall from sky
        fallingBlocksState.set(placedBlock.id, { currentY: 50, velocity: 0, targetY });
        placedCount++;
      }
      localHeightMap.set(key, targetY + 1);
      currentIndex++;
      
      // Schedule next block
      nextPlaceTime += msPerBlock;
      const delay = Math.max(0, nextPlaceTime - Date.now());
      setTimeout(placeNextBlock, delay);
    };
    
    // Start the placement loop
    placeNextBlock();
  }, [toast, placeBlock]);

  // Block rain trigger
  const handleBlockRain = useCallback(() => {
    let blockTypes = ['fortress_block', 'grass_block', 'crystal_block'];
    let rainSettings = {
      blocksPerSecond: 10,
      totalBlocks: 100,
      blockLifeMinutes: 10,
      spreadRadius: 5
    };
    
    try {
      const adminSettings = localStorage.getItem('adminBlockRainSettings');
      if (adminSettings) {
        const parsed = JSON.parse(adminSettings);
        if (parsed.selectedBlocks?.length > 0) blockTypes = parsed.selectedBlocks;
        rainSettings = {
          blocksPerSecond: parsed.blocksPerSecond || 10,
          totalBlocks: parsed.totalBlocks || 100,
          blockLifeMinutes: parsed.blockLifeMinutes || 10,
          spreadRadius: parsed.spreadRadius || 5
        };
      }
    } catch (error) {
      console.error('Failed to load admin block rain settings:', error);
    }
    
    // Generate random positions directly
    const positions: Array<{ x: number; y: number; z: number; type: string }> = [];
    const spreadRadius = rainSettings.spreadRadius || 5;
    
    for (let i = 0; i < rainSettings.totalBlocks; i++) {
      const x = Math.floor((Math.random() - 0.5) * spreadRadius * 2);
      const z = Math.floor((Math.random() - 0.5) * spreadRadius * 2);
      const type = blockTypes[Math.floor(Math.random() * blockTypes.length)];
      positions.push({ x, y: 0, z, type });
    }
    
    // Call batch handler directly (now synchronous, uses rAF internally)
    handleBlockRainBatch(positions, rainSettings);
    
    toast({
      title: "Block Rain!",
      description: `Spawning ${rainSettings.totalBlocks} random blocks...`,
      duration: 1000
    });
  }, [toast, handleBlockRainBatch]);

  // Block placement handler
  const handleBlockPlace = useCallback((position: THREE.Vector3) => {
    if (!selectedBlockType) return;
    
    const currentInventory = inventoryRef.current;
    const hasBlocks = findInventoryItem(currentInventory, selectedBlockType) !== undefined && 
                      getInventoryQuantity(currentInventory, selectedBlockType) > 0;
    
    if (!hasBlocks) {
      toast({
        title: "No blocks available",
        description: `You don't have any ${selectedBlockType} blocks in your inventory`,
        variant: "destructive"
      });
      return;
    }
    
    // Play placement sound
    try {
      mainAudioRefs.current.woodenThud.currentTime = 0;
      mainAudioRefs.current.woodenThud.play().catch(() => {});
    } catch (audioError) {}
    
    const roundedPos = {
      x: Math.round(position.x),
      y: Math.round(position.y),
      z: Math.round(position.z)
    };
    
    useBlock(selectedBlockType);
    const placedBlock = placeBlock(roundedPos.x, roundedPos.y, roundedPos.z, selectedBlockType);
    
    if (placedBlock) {
      toast({
        title: "✓ Block placed!",
        description: `${selectedBlockType} placed at (${roundedPos.x}, ${roundedPos.y}, ${roundedPos.z})`,
      });
      
      setTimeout(() => {
        const freshInventory = inventoryRef.current;
        const stillHasBlocks = getInventoryQuantity(freshInventory, selectedBlockType) > 0;
        
        if (!stillHasBlocks) {
          const availableBlocks = freshInventory.filter(item => item.quantity > 0 && 
            (item.item_type !== selectedBlockType && item.item_id !== selectedBlockType));
          
          if (availableBlocks.length > 0) {
            const nextBlock = availableBlocks[0];
            const nextItemKey = nextBlock.item_id || nextBlock.item_type;
            setSelectedBlockType(nextItemKey);
            toast({
              title: "Auto-switched block type",
              description: `Switched to ${nextItemKey} (${nextBlock.quantity} available)`,
              duration: 2000
            });
          } else {
            handleModeChangeRef.current?.(null);
            toast({
              title: "No more blocks",
              description: "All blocks used! Purchase more from the shop.",
              duration: 3000
            });
          }
        }
      }, 50);
    }
  }, [selectedBlockType, useBlock, placeBlock, toast]);

  const handleBlockPurchased = useCallback(async () => {
    await refreshData();
  }, [refreshData]);

  const getBlockQuantity = (itemKey: string) => {
    return getInventoryQuantity(inventory, itemKey);
  };

  // Mode change handler
  const handleModeChange = useCallback((mode: 'shooting' | 'building' | null) => {
    const availableItems = inventory.filter(item => item.quantity > 0);
    
    if (mode === 'building') {
      const availableItem = availableItems[0];
      if (availableItem && availableItem.quantity > 0) {
        // IMPORTANT: Use item_type (block key like 'grass_block') NOT item_id (UUID)
        // item_id is a database UUID, item_type is the block type key used for rendering
        setSelectedBlockType(availableItem.item_type);
        setCrosshairsEnabled(false);
        setBlockPlacementMode(true);
        setBlockMode(true);
        
        toast({
          title: "Block mode enabled",
          description: `Press left click to place ${availableItem.item_type}. Press B to exit.`,
          duration: 3000
        });
      } else {
        setSelectedBlockType(null);
        setCrosshairsEnabled(false);
        setBlockPlacementMode(true);
        setBlockMode(true);
        
        toast({
          title: "You don't have any blocks to place",
          description: "Press letter O to Open the Shop and purchase blocks",
          duration: 4000
        });
      }
    } else if (mode === 'shooting') {
      setSelectedBlockType(null);
      setBlockPlacementMode(false);
      setCrosshairsEnabled(true);
      setBlockMode(false);
    } else {
      setSelectedBlockType(null);
      setBlockPlacementMode(false);
      setCrosshairsEnabled(false);
      setBlockMode(false);
      
      toast({
        title: "Block mode disabled",
        description: "Press B to re-enter block placement mode",
        duration: 2000
      });
    }
  }, [inventory, setBlockMode, toast]);

  useEffect(() => {
    handleModeChangeRef.current = handleModeChange;
  }, [handleModeChange]);

  // Cycle through available blocks
  const cycleSelectedBlock = useCallback((direction: 'next' | 'prev') => {
    const blockQuantities = new Map<string, number>();
    inventory.forEach(item => {
      if (item.quantity > 0 && item.item_type) {
        const current = blockQuantities.get(item.item_type) || 0;
        blockQuantities.set(item.item_type, current + item.quantity);
      }
    });
    
    const availableBlocks = Array.from(blockQuantities.entries())
      .map(([blockType, quantity]) => ({ blockType, quantity }))
      .filter(item => item.quantity > 0);
    
    if (availableBlocks.length === 0) return;
    
    if (!selectedBlockType) {
      const firstBlock = availableBlocks[0];
      setSelectedBlockType(firstBlock.blockType);
      toast({
        title: "Block selected",
        description: `Selected ${firstBlock.blockType} (${firstBlock.quantity} available)`,
        duration: 1000
      });
      return;
    }
    
    if (availableBlocks.length <= 1) return;
    
    const currentIndex = availableBlocks.findIndex(item => item.blockType === selectedBlockType);
    if (currentIndex === -1) {
      const firstBlock = availableBlocks[0];
      setSelectedBlockType(firstBlock.blockType);
      return;
    }
    
    const nextIndex = direction === 'next'
      ? (currentIndex + 1) % availableBlocks.length
      : (currentIndex - 1 + availableBlocks.length) % availableBlocks.length;
    
    const nextBlock = availableBlocks[nextIndex];
    setSelectedBlockType(nextBlock.blockType);
    
    toast({
      title: "Block selected",
      description: `Selected ${nextBlock.blockType} (${nextBlock.quantity} available)`,
      duration: 1000
    });
  }, [selectedBlockType, inventory, toast]);

  const handleOpenPanel = useCallback((tab: 'user' | 'wallet' | 'inventory' | 'store') => {
    openPanel(tab);
  }, [openPanel]);

  // Keyboard shortcuts
  useEffect(() => {
    const handleKeyDown = (event: KeyboardEvent) => {
      // D-Flow diagnostics toggle (Shift+3 = #)
      if (event.key === '#' || (event.shiftKey && event.code === 'Digit3')) {
        diagnostics.toggle();
        return;
      }
      
      if ((event.metaKey || event.ctrlKey) && event.key === 'p') {
        event.preventDefault();
        setShowPerfMonitor(prev => !prev);
      }
      
      if (event.key === 'Tab' && blockPlacementMode) {
        event.preventDefault();
        setShowOwnershipOutline(prev => !prev);
      }
      
      // Performance mode toggle (0 key)
      if (event.key === '0' && !event.repeat && !event.metaKey && !event.ctrlKey) {
        setPerformanceMode(prev => {
          const newValue = !prev;
          toast({
            title: newValue ? "Performance Mode ON" : "Performance Mode OFF",
            description: newValue 
              ? "Outlines, shadows, and glow disabled for testing"
              : "Full visual quality restored",
          });
          return newValue;
        });
      }
    };

    window.addEventListener('keydown', handleKeyDown);
    return () => window.removeEventListener('keydown', handleKeyDown);
  }, [blockPlacementMode, toast]);

  // Crosshair state sync
  useEffect(() => {
    const handleCrosshairChange = (event: CustomEvent) => {
      setCrosshairsEnabled(event.detail.enabled);
    };
    window.addEventListener('crosshairChange', handleCrosshairChange as EventListener);
    return () => window.removeEventListener('crosshairChange', handleCrosshairChange as EventListener);
  }, []);

  return (
    <div className="w-full h-screen relative overflow-hidden bg-background">
      <Canvas
        camera={{ position: [-8, 1.8, 22], fov: 70, near: 0.1, far: 1200 }}
        shadows={false}
        gl={{ antialias: false, powerPreference: 'high-performance' }}
        dpr={1}
      >
        {showPerfMonitor && <Perf position="top-left" minimal={true} />}
        <FortressScene
          settings={settings}
          onCoinHit={handleCoinHit}
          wallPositions={wallPositions}
          blockPlacementMode={blockPlacementMode}
          onBlockPlace={handleBlockPlace}
          onModeChange={handleModeChange}
          onOpenPanel={handleOpenPanel}
          crosshairsEnabled={crosshairsEnabled}
          getBlockQuantity={getBlockQuantity}
          coinImageUrl={currentTheme?.coin_image_url}
          selectedBlockType={selectedBlockType}
          panelOpen={panelOpen}
          onCycleBlock={cycleSelectedBlock}
          blocks={blocks}
          weatherSettings={weatherSettings}
          onBlockRain={handleBlockRain}
          userRoles={userRoles}
          isMoveMode={isMoveMode}
          onBlockRemove={handleBlockRemove}
          showOwnershipOutline={showOwnershipOutline}
          currentUserId={user?.id}
          hoveredBlockId={hoveredBlockId}
          setHoveredBlockId={setHoveredBlockId}
          collectWispBlock={collectWispBlock}
          toast={toast}
          waterfallEnabled={waterfallEnabled}
          onGodModeChange={setGodMode}
          performanceMode={performanceMode}
        />
        
        {selectedBlockType && getBlockQuantity(selectedBlockType) > 0 && (
          <BlockPreview 
            blockType={selectedBlockType}
            visible={true}
            existingBlocks={blocks || []}
          />
        )}
      </Canvas>

      {/* Flying coin animations */}
      {flyingCoins.map(coin => (
        <div
          key={coin.id}
          className="fixed pointer-events-none z-50"
          style={{
            left: coin.startX,
            top: coin.startY,
            animation: 'flyToCoin 0.6s cubic-bezier(0.25, 0.46, 0.45, 0.94) forwards'
          }}
        >
          <img src="/waterfall_coin.png" alt="coin" className="w-8 h-8 animate-spin" />
        </div>
      ))}

      {/* FPS Display */}
      <FPSDisplay isAdmin={userRoles.includes('admin') || userRoles.includes('superadmin')} />
      
      {/* D-Flow Output Panel */}
      <DFlowOutputPanel />

      {/* Top right controls */}
      <div className="fixed top-4 right-4 z-30 flex items-center gap-2">
        {user?.email && (
          <div className="bg-black/70 text-white px-3 py-2 rounded text-sm font-medium border border-white/20">
            {user.email}
          </div>
        )}
        
        <Button
          className="waterfall-button bg-red-500/80 hover:bg-red-600/80 text-white border-red-400/50"
          size="sm"
          onClick={signOut}
          title="Sign out"
        >
          Sign Out
        </Button>
        
        {(userRoles.includes('admin') || userRoles.includes('superadmin')) && (
          <Button
            className="waterfall-button"
            size="sm"
            onClick={() => openAdminPanel('coins')}
            title="Admin Panel"
          >
            <Eye className="h-4 w-4" />
          </Button>
        )}
      </div>
      
      {/* Admin Panel */}
      <AdminPanel 
        waterfallSettings={settings}
        onWaterfallSettingsChange={handleSettingsChange}
        onWallPositionsChange={setWallPositions}
        onMoveModeChange={setIsMoveMode}
        weatherSettings={weatherSettings}
        onWeatherSettingsChange={handleWeatherSettingsChange}
      />
      
      {/* Score display and block inventory */}
      <div className="fixed bottom-4 left-4 z-20 flex items-center gap-2">
        <div className="flex items-center gap-0 bg-black/50 text-white rounded">
          <div 
            className="p-2 hover:bg-black/70 transition-colors cursor-pointer rounded-l"
            onClick={() => openPanel('inventory')}
            title="Open inventory"
          >
            <img src={currentTheme?.coin_image_url || '/waterfall_coin.png'} alt="coin" className="w-6 h-6" />
          </div>
          <div 
            className="p-2 hover:bg-black/70 transition-colors cursor-pointer rounded-r border-l border-white/20"
            onClick={() => openPanel('inventory')}
            title="Open inventory"
          >
            <span className="font-bold">x{tokenBalance?.coins || 0}</span>
          </div>
        </div>
        
        <div className="flex items-center gap-2">
          <div 
            className={`flex items-center gap-2 bg-black/50 text-white p-2 rounded cursor-pointer transition-colors ${
              blockPlacementMode ? 'bg-blue-500/70' : 'hover:bg-black/70'
            }`}
            onClick={() => {
              const availableBlocks = inventory.filter(item => item.quantity > 0);
              const totalBlocks = availableBlocks.reduce((total, item) => total + item.quantity, 0);
              
              if (totalBlocks > 0) {
                handleModeChange(selectedBlockType ? null : 'building');
              } else {
                openPanel('store');
              }
            }}
            title={(() => {
              const totalBlocks = inventory.filter(item => item.quantity > 0).reduce((total, item) => total + item.quantity, 0);
              return totalBlocks > 0 ? (selectedBlockType ? "Exit block mode" : "Enter block mode") : "Buy blocks from shop";
            })()}
          >
            <div className="w-6 h-6 bg-gradient-to-br from-stone-400 to-stone-600 rounded border border-stone-300 flex items-center justify-center">
              <div className="w-4 h-4 bg-gradient-to-br from-stone-300 to-stone-500 rounded-sm border border-stone-400"></div>
            </div>
            <span className="font-bold">x{inventory.filter(item => item.quantity > 0).reduce((total, item) => total + item.quantity, 0)}</span>
          </div>
          
          {blockPlacementMode && selectedBlockType && (
            <div className="bg-blue-500/70 text-white px-2 py-1 rounded text-xs">
              BLOCK MODE: {selectedBlockType}
            </div>
          )}
        </div>
      </div>
      
      {/* Instructions */}
      <div className="fixed bottom-4 right-4 z-20 text-white text-sm bg-black/50 p-2 rounded">
        <div>{blockPlacementMode ? (selectedBlockType ? 'Click to place block • Tab to see placed blocks' : 'Tab to see placed blocks • O to buy blocks') : 'R for crosshairs • Click to shoot'}</div>
        <div className="text-xs opacity-75 mt-1">
          B = Block mode • O = Open Shop • I = Inventory
        </div>
      </div>
      
      {/* User Panel */}
      <UserPanel onBlockPurchased={handleBlockPurchased} />
      
      {/* Crosshair */}
      <div className={`waterfall-crosshair ${
        blockPlacementMode ? 'block-mode' : 
        crosshairsEnabled ? 'active' : ''
      }`} />
      
      {/* God Mode HUD Indicator */}
      {godMode && (
        <div className="fixed top-4 left-1/2 -translate-x-1/2 z-50 bg-purple-600/90 text-white px-6 py-2 rounded-lg font-bold text-lg border border-purple-400/50 shadow-lg shadow-purple-500/30">
          GOD MODE (~)
        </div>
      )}
      
      {/* Performance Mode HUD Indicator */}
      {performanceMode && (
        <div className="fixed top-16 left-1/2 -translate-x-1/2 z-50 bg-green-600/90 text-white px-6 py-2 rounded-lg font-bold text-lg border border-green-400/50 shadow-lg shadow-green-500/30">
          PERF MODE (0)
        </div>
      )}
      
      {/* Toast notifications */}
      <Toaster />
      
      {/* Performance Overlay - Toggle with Shift+P */}
      <PerformanceOverlay />
    </div>
  );
}

export default Fortress;
