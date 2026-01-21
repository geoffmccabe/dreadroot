import React, { useRef, useState, useEffect, useCallback, useMemo } from 'react';
import { Canvas } from '@react-three/fiber';
import { Perf } from 'r3f-perf';
import * as THREE from 'three';
import { Button } from '@/components/ui/button';
import { Eye } from 'lucide-react';
import { BlockPreview } from '@/components/BlockPreview';
import { SeedPreview } from '@/features/trees/components/SeedPreview';
import { UserPanel } from '@/components/UserPanel';
import { AdminPanel } from '@/components/AdminPanel';
import { FPSDisplay, DFlowOutputPanel } from '@/components/FPSCounter';
import { PerformanceOverlay } from '@/components/PerformanceOverlay';
import { useUserData } from '@/hooks/useUserData';
import { useBlocks } from '@/contexts/BlocksContext';
import { useBulletDefinitions } from '@/contexts/BulletDefinitionsContext';
import { useAuth } from '@/contexts/AuthContext';
import { useUserPanel } from '@/contexts/UserPanelContext';
import { useAdminPanel } from '@/contexts/AdminPanelContext';
import { useCoinTheme } from '@/contexts/CoinThemeContext';
import { useToast } from '@/hooks/use-toast';
import { Toaster } from '@/components/ui/toaster';
import { findInventoryItem, getInventoryQuantity } from '@/lib/inventoryHelpers';
import { heightMap, fallingBlocksState } from '@/components/PlacedBlocks';
import { clearBlocksCache } from '@/hooks/useBlocksData';
import { useTreeData } from '@/features/trees/hooks/useTreeData';
import { PlantedTree } from '@/features/trees/types';
import { useSeedPlanting } from '@/features/trees/hooks/useSeedPlanting';
import { useLocalGrowth } from '@/features/trees/hooks/useLocalGrowth';
import { useTreeChopping } from '@/features/trees/hooks/useTreeChopping';
import { TreeChopConfirmModal } from '@/features/trees/components/TreeChopConfirmModal';
import { supabase } from '@/integrations/supabase/client';
import { isTreeBlockType, getBaseTreeBlockType } from '@/features/trees/lib/blockTypeEncoder';

import { TREE_CONFIG } from '@/features/trees/constants';
import { usePlayerHealth, HealthBar, DeathOverlay, useShwarmDefinitions } from '@/features/shwarm';
import { useShnakeDefinitions } from '@/features/shnake';

import { FortressScene } from './FortressScene';
import { createMainAudioRefs, preloadRejectionSound, playReversedAudio } from './FortressAudio';
import { FlyingCoin, GameSettings, WeatherSettings } from './FortressTypes';
import { PentabulletCrosshair } from './PentabulletCrosshair';
import { diagnostics } from '@/lib/diagnosticsLogger';


// Main Fortress orchestrator component
export function Fortress() {
  const { currentTheme, isLoading: themeLoading } = useCoinTheme();
  
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
  const [selectedSeedTier, setSelectedSeedTier] = useState<number | null>(null);
  const [blockPlacementMode, setBlockPlacementMode] = useState(false);
  const [treePlacementMode, setTreePlacementMode] = useState(false);
  const [showOwnershipOutline, setShowOwnershipOutline] = useState(false);
  const [showPerfMonitor, setShowPerfMonitor] = useState(false);
  const [hoveredBlockId, setHoveredBlockId] = useState<string | null>(null);
  const [wallPositions, setWallPositions] = useState<Record<number, {x: number, y: number, z: number, rotX: number, rotY: number, rotZ: number}>>({});
  const [isMoveMode, setIsMoveMode] = useState(false);
  const [flyingCoins, setFlyingCoins] = useState<FlyingCoin[]>([]);
  const [godMode, setGodMode] = useState(false);
  const [performanceMode, setPerformanceMode] = useState(false);
  const [selectedBulletTier, setSelectedBulletTier] = useState(1);
  const [pentabulletCharge, setPentabulletCharge] = useState(0);
  
  // Get bullet color for crosshair
  const { getDefinition } = useBulletDefinitions();
  const bulletColor = getDefinition(selectedBulletTier).colors[0] || '#FFFF00';
  
  // Tree chopping modal state
  const [treeChopModalOpen, setTreeChopModalOpen] = useState(false);
  const [pendingChopPosition, setPendingChopPosition] = useState<{ x: number; y: number; z: number } | null>(null);
  const [chopProgress, setChopProgress] = useState(0);
  
  // Waterfall disabled for performance testing (Phase 1)
  const waterfallEnabled = false;
  
  // Hooks
  const { profile, tokenBalance, inventory, userRoles, addCoins, addPoints, useBlock, refreshData, collectWispBlock, returnSeed } = useUserData();
  const { blocks, placeBlock, placeBlocksBatch, removeBlock, setBlockMode, currentWorld, navigateWorld, worldIndex, currentWorldId, refreshBlocks } = useBlocks();
  const { user, signOut } = useAuth();
  const { toast } = useToast();
  const { isOpen: panelOpen, openPanel } = useUserPanel();
  const { openPanel: openAdminPanel } = useAdminPanel();
  
  // Player health system
  const { 
    currentHealth, 
    maxHealth, 
    isDead, 
    takeDamage, 
    respawn,
    healthRef 
  } = usePlayerHealth();
  
  // Shwarm definitions
  const { data: shwarmDefinitions } = useShwarmDefinitions();
  
  // Shnake definitions
  const { data: shnakeDefinitions } = useShnakeDefinitions();

  const [respawnTimer, setRespawnTimer] = useState(0);
  const [respawnPosition, setRespawnPosition] = useState<THREE.Vector3 | null>(null);
  
  // Clear block cache once on mount to ensure new block types (wood, fruit) are loaded
  useEffect(() => {
    if (TREE_CONFIG.ENABLED) {
      clearBlocksCache();
    }
  }, []);
  
  // Tree system hooks (only active if TREE_CONFIG.ENABLED)
  // Note: Tree blocks are now stored in placed_blocks and come through the regular chunk loading system
  const { seedDefinitions, plantedTrees, myIncompleteTrees } = useTreeData(
    TREE_CONFIG.ENABLED ? currentWorldId : null,
    user?.id ?? null
  );
  
  // Local growth manager - stores growing trees in refs, not React state
  const { startGrowing, updateTreeId, stopGrowing, isTreeGrowing, growingTreesRef } = useLocalGrowth({
    worldId: currentWorldId,
    userId: user?.id ?? null,
    placeBlocksBatch,
  });
  
  // Resume incomplete trees on page load
  useEffect(() => {
    if (!myIncompleteTrees.length || !TREE_CONFIG.ENABLED) return;
    
    // For each incomplete tree, check if it's already being grown locally
    for (const tree of myIncompleteTrees) {
      if (isTreeGrowing(tree.id)) continue;
      
      const seedDef = tree.seed_definition;
      if (!seedDef) continue;
      
      // Verify tree still exists in DB before resuming (prevents ghost tree growth)
      (async () => {
        // First check if the tree still exists in planted_trees
        const { data: treeExists } = await supabase
          .from('planted_trees')
          .select('id, current_block_count, target_block_count')
          .eq('id', tree.id)
          .maybeSingle();
        
        if (!treeExists) {
          // Tree no longer exists in DB, skip resume
          return;
        }
        
        // NEW ARCHITECTURE: Use current_block_count from planted_trees
        // This is updated by useLocalGrowth during growth
        // Calculate approximate growth order from block count
        // Note: Growth order != block count due to batch placement, but this is close enough
        const currentBlocks = treeExists.current_block_count ?? 0;
        
        // Resume tree growth from approximate order
        // The growth algorithm will skip already-placed positions anyway
        startGrowing(tree.id, seedDef, tree.base_x, tree.base_y, tree.base_z, tree.growth_seed, currentBlocks);
      })();
    }
  }, [myIncompleteTrees, startGrowing, isTreeGrowing]);
  
  const { plantSeed } = useSeedPlanting({
    worldId: currentWorldId,
    userId: user?.id ?? null,
    seedDefinitions,
    placeBlock,
    startGrowing,
    updateTreeId,
  });
  
  // Tree chopping - allows owner to destroy tree and get seed back
  // IMPORTANT: Combine plantedTrees + myIncompleteTrees + actively growing trees
  // This ensures user can chop trees at any stage (just planted, growing, or fully grown)
  const { refetchSingleChunk, removeBlocksByPositions } = useBlocks();
  
  // Build allTrees by merging DB trees with actively growing local trees
  // NOTE: Using a function instead of useMemo so we get fresh data from growingTreesRef on each render
  const getAllTrees = useCallback((): PlantedTree[] => {
    const treeIds = new Set<string>();
    const merged: PlantedTree[] = [];
    
    // Add planted trees from DB first
    for (const tree of plantedTrees) {
      if (!treeIds.has(tree.id)) {
        treeIds.add(tree.id);
        merged.push(tree);
      }
    }
    
    // Add my incomplete trees from DB
    for (const tree of myIncompleteTrees) {
      if (!treeIds.has(tree.id)) {
        treeIds.add(tree.id);
        merged.push(tree);
      }
    }
    
    // Add actively growing trees from local growth loop
    // These might have temp IDs or IDs not yet in the DB query results
    if (growingTreesRef.current) {
      for (const [id, growingTree] of growingTreesRef.current) {
        // Skip temp IDs - they'll be resolved to real IDs soon
        if (id.startsWith('temp_')) continue;
        
        if (!treeIds.has(id)) {
          treeIds.add(id);
          // Convert GrowingTree to PlantedTree format
          merged.push({
            id,
            world_id: growingTree.worldId,
            seed_definition_id: growingTree.seedDef.id,
            planted_by: user?.id ?? '',
            base_x: growingTree.baseX,
            base_y: growingTree.baseY,
            base_z: growingTree.baseZ,
            growth_seed: growingTree.growthSeed,
            target_block_count: growingTree.blueprint.blocks.length,
            current_block_count: growingTree.currentOrder,
            is_fully_grown: false,
            planted_at: new Date().toISOString(),
            last_growth_at: new Date().toISOString(),
            seed_definition: growingTree.seedDef,
          });
        }
      }
    }
    
    return merged;
  }, [plantedTrees, myIncompleteTrees, user?.id]);
  
  // Get all trees for chopping - computed fresh when chopTreeAtPosition is called
  const allTrees = getAllTrees();
  const { chopTreeAtPosition, isOwnedTreeAtPosition } = useTreeChopping({
    worldId: currentWorldId,
    userId: user?.id ?? null,
    plantedTrees: allTrees,  // Pass ALL trees including user's incomplete ones
    seedDefinitions,
    returnSeed,
    refetchChunk: refetchSingleChunk,
    stopGrowing,
    removeBlocksByPositions,
  });
  
  // Tree chop modal handlers
  const handleTreeChopComplete = useCallback(async (x: number, y: number, z: number) => {
    // Show confirmation modal
    setPendingChopPosition({ x, y, z });
    setTreeChopModalOpen(true);
    // Exit pointer lock so user can click modal
    document.exitPointerLock();
  }, []);
  
  const handleTreeChopConfirm = useCallback(async () => {
    if (pendingChopPosition) {
      await chopTreeAtPosition(pendingChopPosition.x, pendingChopPosition.y, pendingChopPosition.z);
    }
    setTreeChopModalOpen(false);
    setPendingChopPosition(null);
    setChopProgress(0);
  }, [pendingChopPosition, chopTreeAtPosition]);
  
  const handleTreeChopCancel = useCallback(() => {
    setTreeChopModalOpen(false);
    setPendingChopPosition(null);
    setChopProgress(0);
  }, []);
  
  const handleTreeChopProgress = useCallback((current: number, max: number) => {
    setChopProgress(current);
  }, []);
  
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
  const handleModeChangeRef = useRef<((mode: 'shooting' | 'building' | 'planting' | null) => void) | null>(null);

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

  // Death respawn timer
  useEffect(() => {
    if (isDead && respawnTimer === 0) {
      setRespawnTimer(3);
    }
  }, [isDead]);
  
  useEffect(() => {
    if (respawnTimer > 0) {
      const timer = setTimeout(() => {
        setRespawnTimer(prev => prev - 1);
      }, 1000);
      return () => clearTimeout(timer);
    } else if (respawnTimer === 0 && isDead) {
      // Auto-respawn after timer
      const spawnPos = respawn();
      setRespawnPosition(spawnPos);
    }
  }, [respawnTimer, isDead, respawn]);

  // Block removal handler - checks if block is part of a tree first
  const handleBlockRemove = useCallback(async (blockId: string) => {
    // Find the block to get its position
    const block = blocks.find(b => b.id === blockId);
    if (!block) {
      console.warn('Block not found for removal:', blockId);
      return;
    }
    
    // Check if this is a tree block and if user owns the tree
    // Uses isTreeBlockType to handle encoded block types like 'trunk_-1_5'
    const baseType = getBaseTreeBlockType(block.block_type);
    if (isTreeBlockType(block.block_type) && baseType !== 'invisiblock' && TREE_CONFIG.ENABLED) {
      const isOwned = isOwnedTreeAtPosition(block.position_x, block.position_y, block.position_z);
      if (isOwned) {
        // Chop the entire tree instead of just removing one block
        await chopTreeAtPosition(block.position_x, block.position_y, block.position_z);
        return;
      }
    }
    
    // Standard block removal
    playReversedAudio('/wooden_thud_sound.mp3');
    
    const success = await removeBlock(blockId);
    if (success) {
      toast({
        title: "Block removed",
        description: "Block returned to inventory",
        duration: 2000
      });
    }
  }, [blocks, removeBlock, toast, isOwnedTreeAtPosition, chopTreeAtPosition]);

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
  const handleModeChange = useCallback((mode: 'shooting' | 'building' | 'planting' | null) => {
    // Filter for ONLY placeable blocks (not seeds, fruits, or trunk)
    const isPlaceableBlock = (itemType: string): boolean => {
      if (itemType.startsWith('seed_tier_')) return false;
      if (itemType === 'trunk' || itemType === 'fruit') return false;
      return true;
    };
    
    const availablePlaceableBlocks = inventory.filter(item => 
      item.quantity > 0 && item.item_type && isPlaceableBlock(item.item_type)
    );
    
    if (mode === 'building') {
      setTreePlacementMode(false);
      setSelectedSeedTier(null);
      const availableItem = availablePlaceableBlocks[0];
      if (availableItem && availableItem.quantity > 0) {
        setSelectedBlockType(availableItem.item_type);
        setCrosshairsEnabled(false);
        setBlockPlacementMode(true);
        setBlockMode(true);
        toast({ title: "Block mode enabled", description: `Press left click to place. Press B to exit.`, duration: 3000 });
      } else {
        setSelectedBlockType(null);
        setCrosshairsEnabled(false);
        setBlockPlacementMode(true);
        setBlockMode(true);
        toast({ title: "No blocks available", description: "Press O to open shop", duration: 4000 });
      }
    } else if (mode === 'planting') {
      setBlockPlacementMode(false);
      setSelectedBlockType(null);
      setTreePlacementMode(true);
      setCrosshairsEnabled(false);
      setBlockMode(false);
      // Show named seeds, and for admins also include T29 (tier 29) even if unnamed
      const isAdmin = userRoles.includes('admin') || userRoles.includes('superadmin');
      const availableSeeds = seedDefinitions.filter(s => 
        (s.name && s.name.trim() !== '') || (isAdmin && s.tier === 29)
      );
      if (availableSeeds.length > 0) {
        setSelectedSeedTier(availableSeeds[0].tier);
        toast({ title: "Tree planting mode", description: `Press [ ] to cycle seeds. Click to plant.`, duration: 3000 });
      } else {
        toast({ title: "No seeds available", description: "Configure seed names in Admin Panel > Seeds", duration: 3000 });
      }
    } else if (mode === 'shooting') {
      setSelectedBlockType(null);
      setBlockPlacementMode(false);
      setTreePlacementMode(false);
      setSelectedSeedTier(null);
      setCrosshairsEnabled(true);
      setBlockMode(false);
    } else {
      setSelectedBlockType(null);
      setBlockPlacementMode(false);
      setTreePlacementMode(false);
      setSelectedSeedTier(null);
      setCrosshairsEnabled(false);
      setBlockMode(false);
      toast({ title: "Mode disabled", description: "Press B for blocks, T for trees", duration: 2000 });
    }
  }, [inventory, setBlockMode, toast, seedDefinitions]);

  useEffect(() => {
    handleModeChangeRef.current = handleModeChange;
  }, [handleModeChange]);

  // Cycle through available blocks
  const cycleSelectedBlock = useCallback((direction: 'next' | 'prev') => {
    // Filter for ONLY placeable blocks (not seeds, fruits, or trunk)
    const isPlaceableBlock = (itemType: string): boolean => {
      // Seeds are 'seed_tier_X' format
      if (itemType.startsWith('seed_tier_')) return false;
      // Exclude trunk, fruit - these are tree blocks not for manual placement
      if (itemType === 'trunk' || itemType === 'fruit') return false;
      return true;
    };
    
    const blockQuantities = new Map<string, number>();
    inventory.forEach(item => {
      if (item.quantity > 0 && item.item_type && isPlaceableBlock(item.item_type)) {
        const current = blockQuantities.get(item.item_type) || 0;
        blockQuantities.set(item.item_type, current + item.quantity);
      }
    });
    
    const availableBlocks = Array.from(blockQuantities.entries())
      .map(([blockType, quantity]) => ({ blockType, quantity }))
      .filter(item => item.quantity > 0);
    
    if (availableBlocks.length === 0) {
      toast({
        title: "No placeable blocks",
        description: "Purchase blocks from the shop (Press O)",
        duration: 2000
      });
      return;
    }
    
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

  // Cycle through available seeds - named ones for regular users, plus T29 for admins
  const cycleSelectedSeed = useCallback((direction: 'next' | 'prev') => {
    const isAdmin = userRoles.includes('admin') || userRoles.includes('superadmin');
    // Get named seeds, and for admins also include T29 (tier 29) even if unnamed
    const availableSeeds = seedDefinitions.filter(s => 
      (s.name && s.name.trim() !== '') || (isAdmin && s.tier === 29)
    );
    if (availableSeeds.length === 0) return;
    if (!selectedSeedTier) {
      setSelectedSeedTier(availableSeeds[0].tier);
      return;
    }
    const currentIndex = availableSeeds.findIndex(s => s.tier === selectedSeedTier);
    if (currentIndex === -1) {
      setSelectedSeedTier(availableSeeds[0].tier);
      return;
    }
    const nextIndex = direction === 'next'
      ? (currentIndex + 1) % availableSeeds.length
      : (currentIndex - 1 + availableSeeds.length) % availableSeeds.length;
    setSelectedSeedTier(availableSeeds[nextIndex].tier);
  }, [selectedSeedTier, seedDefinitions, userRoles]);

  // Tree placement handler with pitched-up sound
  const handleTreePlace = useCallback(async (position: THREE.Vector3) => {
    if (!selectedSeedTier) return;
    const roundedPos = { x: Math.round(position.x), y: Math.round(position.y), z: Math.round(position.z) };
    
    // Play placement sound with 2x pitch
    try {
      const audioCtx = new (window.AudioContext || (window as any).webkitAudioContext)();
      const response = await fetch('/wooden_thud_sound.mp3');
      const arrayBuffer = await response.arrayBuffer();
      const audioBuffer = await audioCtx.decodeAudioData(arrayBuffer);
      const source = audioCtx.createBufferSource();
      source.buffer = audioBuffer;
      source.playbackRate.value = 2.0; // 2x pitch
      source.connect(audioCtx.destination);
      source.start();
    } catch (e) { console.warn('Seed sound failed', e); }
    
    // Plant seed - growth starts locally via useLocalGrowth (ref-based, no flashing)
    await plantSeed(roundedPos.x, roundedPos.y, roundedPos.z, selectedSeedTier);
  }, [selectedSeedTier, plantSeed]);

  const handleOpenPanel = useCallback((tab: 'user' | 'wallet' | 'kills' | 'blocks' | 'market') => {
    openPanel(tab);
  }, [openPanel]);

  // Keyboard shortcuts
  useEffect(() => {
    const handleKeyDown = (event: KeyboardEvent) => {
      // Skip if in input fields
      if (document.activeElement?.tagName === 'INPUT' || 
          document.activeElement?.tagName === 'TEXTAREA') {
        return;
      }
      
      // D-Flow diagnostics toggle (Shift+3 = #)
      if (event.key === '#' || (event.shiftKey && event.code === 'Digit3')) {
        diagnostics.toggle();
        return;
      }
      
      // World switching with < and > (Shift+comma / Shift+period)
      if (event.key === '<') {
        event.preventDefault();
        navigateWorld('prev');
        toast({
          title: `World ${worldIndex.current > 1 ? worldIndex.current - 1 : worldIndex.total}/${worldIndex.total}`,
          description: "Switching world...",
        });
        return;
      }
      if (event.key === '>') {
        event.preventDefault();
        navigateWorld('next');
        toast({
          title: `World ${worldIndex.current < worldIndex.total ? worldIndex.current + 1 : 1}/${worldIndex.total}`,
          description: "Switching world...",
        });
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
  }, [blockPlacementMode, toast, navigateWorld, worldIndex]);

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
          treePlacementMode={treePlacementMode}
          onBlockPlace={handleBlockPlace}
          onTreePlace={handleTreePlace}
          onModeChange={handleModeChange}
          onOpenPanel={handleOpenPanel}
          crosshairsEnabled={crosshairsEnabled}
          getBlockQuantity={getBlockQuantity}
          coinImageUrl={currentTheme?.coin_image_url}
          selectedBlockType={selectedBlockType}
          selectedSeedTier={selectedSeedTier}
          panelOpen={panelOpen}
          onCycleBlock={cycleSelectedBlock}
          onCycleSeed={cycleSelectedSeed}
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
          fortressTextureUrl={currentWorld?.fortress_texture_url}
          groundTextureUrl={currentWorld?.ground_texture_url}
          skyTextureUrl={currentWorld?.sky_texture_url}
          seedDefinitions={seedDefinitions}
          plantedTrees={plantedTrees}
          healthRef={healthRef}
          takeDamage={takeDamage}
          shwarmDefinitions={shwarmDefinitions}
          shnakeDefinitions={shnakeDefinitions}
          onPointsEarned={async (points) => {
            const { newLevel } = await addPoints(points);
            if (newLevel) {
              // Play level up sound
              const audio = new Audio('/yay_sound.mp3');
              audio.volume = 0.5;
              audio.play().catch(() => {});
              // Show toast
              toast({
                title: `🎉 Level Up!`,
                description: `You reached Level ${newLevel}!`,
                duration: 4000,
              });
            }
            }}
          onShwarmGroupKilled={async (tier) => {
            console.log(`[Fortress] Shwarm group killed - tier ${tier}, user: ${user?.id}`);
            if (!user?.id) {
              console.error('[Fortress] Cannot track kill - no user ID');
              return;
            }
            
            // Increment kill count in database
            const { data: existing, error: fetchError } = await supabase
              .from('user_combat_stats')
              .select('*')
              .eq('user_id', user.id)
              .eq('enemy_type', `shwarm_t${tier}`)
              .maybeSingle();
            
            if (fetchError) {
              console.error('[Fortress] Error fetching combat stats:', fetchError);
              return;
            }
            
            if (existing) {
              const { error: updateError } = await supabase
                .from('user_combat_stats')
                .update({ kills: existing.kills + 1, updated_at: new Date().toISOString() })
                .eq('id', existing.id);
              if (updateError) {
                console.error('[Fortress] Error updating kill count:', updateError);
              }
            } else {
              const { error: insertError } = await supabase
                .from('user_combat_stats')
                .insert({ user_id: user.id, enemy_type: `shwarm_t${tier}`, kills: 1 });
              if (insertError) {
                console.error('[Fortress] Error inserting kill count:', insertError);
              }
            }
          }}
          onShnakeKilled={async (tier) => {
            console.log(`[Fortress] Shnake killed - tier ${tier}, user: ${user?.id}`);
            if (!user?.id) {
              console.error('[Fortress] Cannot track shnake kill - no user ID');
              return;
            }
            
            // Play kill sound
            const audio = new Audio('/yay_sound.mp3');
            audio.volume = 0.3;
            audio.play().catch(() => {});
            
            // Increment kill count in database
            const { data: existing, error: fetchError } = await supabase
              .from('user_combat_stats')
              .select('*')
              .eq('user_id', user.id)
              .eq('enemy_type', `shnake_t${tier}`)
              .maybeSingle();
            
            if (fetchError) {
              console.error('[Fortress] Error fetching shnake combat stats:', fetchError);
              return;
            }
            
            if (existing) {
              const { error: updateError } = await supabase
                .from('user_combat_stats')
                .update({ kills: existing.kills + 1, updated_at: new Date().toISOString() })
                .eq('id', existing.id);
              if (updateError) {
                console.error('[Fortress] Error updating shnake kill count:', updateError);
              }
            } else {
              const { error: insertError } = await supabase
                .from('user_combat_stats')
                .insert({ user_id: user.id, enemy_type: `shnake_t${tier}`, kills: 1 });
              if (insertError) {
                console.error('[Fortress] Error inserting shnake kill count:', insertError);
              }
            }
          }}
          respawnPosition={respawnPosition}
          onRespawnComplete={() => setRespawnPosition(null)}
          isOwnedTreeAtPosition={isOwnedTreeAtPosition}
          onTreeChopComplete={handleTreeChopComplete}
          onTreeChopProgress={handleTreeChopProgress}
          selectedBulletTier={selectedBulletTier}
          onBulletTierChange={setSelectedBulletTier}
          playerLevel={profile?.current_level ?? 1}
          onPentabulletChargeChange={setPentabulletCharge}
        />
        
        {selectedBlockType && getBlockQuantity(selectedBlockType) > 0 && (
          <BlockPreview 
            blockType={selectedBlockType}
            visible={true}
            existingBlocks={blocks || []}
          />
        )}
        
        {treePlacementMode && selectedSeedTier && (
          <SeedPreview
            tier={selectedSeedTier}
            visible={true}
            existingBlocks={blocks || []}
            trunkTextureUrl={seedDefinitions.find(s => s.tier === selectedSeedTier)?.trunk_texture_url}
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
            onClick={() => openPanel('blocks')}
            title="Open inventory"
          >
            <img src={currentTheme?.coin_image_url || '/waterfall_coin.png'} alt="coin" className="w-6 h-6" />
          </div>
          <div 
            className="p-2 hover:bg-black/70 transition-colors cursor-pointer rounded-r border-l border-white/20"
            onClick={() => openPanel('blocks')}
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
                openPanel('market');
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
          
          {/* Health Bar with Points - inline with block counter */}
          <HealthBar currentHealth={currentHealth} maxHealth={maxHealth} totalPoints={profile?.total_points || 0} />
          
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
      
      {/* Crosshair - Pentabullet-enabled */}
      <PentabulletCrosshair 
        chargeProgress={pentabulletCharge}
        baseMode={blockPlacementMode ? 'building' : treePlacementMode ? 'planting' : crosshairsEnabled ? 'shooting' : 'inactive'}
        bulletColor={bulletColor}
      />
      
      
      {/* Death Overlay */}
      <DeathOverlay 
        isDead={isDead} 
        respawnTimer={respawnTimer} 
        onRespawn={() => {
          const spawnPos = respawn();
          setRespawnPosition(spawnPos);
          setRespawnTimer(0);
        }} 
      />
      
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
      
      {/* Tree Chop Confirmation Modal */}
      <TreeChopConfirmModal
        isOpen={treeChopModalOpen}
        onConfirm={handleTreeChopConfirm}
        onCancel={() => {
          setTreeChopModalOpen(false);
          setPendingChopPosition(null);
          setChopProgress(0);
        }}
      />
      
      {/* Toast notifications */}
      <Toaster />
      
      {/* Performance Overlay - Toggle with Shift+P */}
      <PerformanceOverlay />
    </div>
  );
}

export default Fortress;
