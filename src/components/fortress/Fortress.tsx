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
import { worldStore } from '@/services/worldStore';
import { useBlocks } from '@/contexts/BlocksContext';
import { useBulletDefinitions } from '@/contexts/BulletDefinitionsContext';
import { useAuth } from '@/contexts/AuthContext';
import { useUserPanel } from '@/contexts/UserPanelContext';
import { useAdminPanel } from '@/contexts/AdminPanelContext';
import { useCoinTheme } from '@/contexts/CoinThemeContext';
import { useToast } from '@/hooks/use-toast';
import { isSpawnSequenceActive } from '@/features/enemies/hooks/useSpawnCommands';
import { Toaster } from '@/components/ui/toaster';
import { findInventoryItem, getInventoryQuantity } from '@/lib/inventoryHelpers';
import { heightMap, fallingBlocksState } from '@/components/PlacedBlocks';
import { PlacedBlock } from '@/types/blocks';
import { clearBlocksCache } from '@/hooks/useBlocksData';
import { useTreeData } from '@/features/trees/hooks/useTreeData';
import { PlantedTree } from '@/features/trees/types';
import { useSeedPlanting } from '@/features/trees/hooks/useSeedPlanting';
import { useLocalGrowth, isTreeDeleted } from '@/features/trees/hooks/useLocalGrowth';
import { useTreeGrowthPoller } from '@/features/trees/hooks/useTreeGrowthPoller';
import { useTreeChopping } from '@/features/trees/hooks/useTreeChopping';
import { TreeChopConfirmModal } from '@/features/trees/components/TreeChopConfirmModal';
import { supabase } from '@/integrations/supabase/client';
import { isTreeBlockType, getBaseTreeBlockType } from '@/features/trees/lib/blockTypeEncoder';

import { TREE_CONFIG } from '@/features/trees/constants';
import { usePlayerHealth, HealthBar, DeathOverlay, useShwarmDefinitions } from '@/features/shwarm';
import { useShnakeDefinitions } from '@/features/shnake';
import { useShombieDefinitions } from '@/features/shombie';
import { useWalapaDefinitions } from '@/features/walapa';
import { useShtickmanDefinitions } from '@/features/shtickman';
import { usePathfindingConfigs } from '@/hooks/usePathfindingConfigs';
import { EnemyManager } from '@/features/enemies/ai/EnemyManager';

import { FortressScene } from './FortressScene';
import { GodMapPanel } from '@/features/god-map';
import { FortressProviders } from './FortressProviders';
import { FortressHUD } from './FortressHUD';
import { FortressOverlays } from './FortressOverlays';
import { createMainAudioRefs, preloadRejectionSound, playReversedAudio } from './FortressAudio';
import { getSoundUrl } from '@/hooks/useGameSounds';
import { playSpatialSound, playSound } from '@/lib/spatialAudio';
import { FlyingCoin, GameSettings, WeatherSettings, SelectedItemDef, LightningSettings, CycleState, ViewSettings, DEFAULT_VIEW_SETTINGS } from './FortressTypes';
import { LightningPanel } from './LightningPanel';
import { PentabulletCrosshair } from './PentabulletCrosshair';
import { VaultPanel } from '@/features/vault';
import { playPinPullSound } from '@/features/grenades/lib/explosionSound';
import { diagnostics } from '@/lib/diagnosticsLogger';
import { getDefaultBulletTier } from '@/lib/bulletScaling';


// Main Fortress orchestrator component
export function Fortress() {
  const { currentTheme, availableThemes, isLoading: themeLoading } = useCoinTheme();
  
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
    const defaultCloud1 = { enabled: false, opacity: 0.45, coverage: 0.5, height: 300, speed: 5, direction: 45, scale: 2.0, color: '#ffffff' };
    const defaultCloud2 = { enabled: false, opacity: 0.35, coverage: 0.4, height: 450, speed: 3, direction: 120, scale: 3.0, color: '#ffffff' };
    const stored = localStorage.getItem('weatherSettings');
    if (stored) {
      const parsed = JSON.parse(stored);
      if ('maxLighting' in parsed && 'minLighting' in parsed) {
        const migrated = {
          lightingRange: [parsed.minLighting, parsed.maxLighting] as [number, number],
          cycleDuration: parsed.cycleDuration || 5,
          cloudLayer1: defaultCloud1,
          cloudLayer2: defaultCloud2,
        };
        localStorage.setItem('weatherSettings', JSON.stringify(migrated));
        return migrated;
      }
      const result = {
        ...parsed,
        cloudLayer1: parsed.cloudLayer1 ?? defaultCloud1,
        cloudLayer2: parsed.cloudLayer2 ?? defaultCloud2,
      };
      // Migrate old settings: bump low opacity, add missing direction field
      if (result.cloudLayer1) {
        if (result.cloudLayer1.opacity <= 0.25) result.cloudLayer1 = { ...result.cloudLayer1, opacity: defaultCloud1.opacity };
        if (result.cloudLayer1.direction === undefined) result.cloudLayer1 = { ...result.cloudLayer1, direction: defaultCloud1.direction };
      }
      if (result.cloudLayer2) {
        if (result.cloudLayer2.opacity <= 0.25) result.cloudLayer2 = { ...result.cloudLayer2, opacity: defaultCloud2.opacity };
        if (result.cloudLayer2.direction === undefined) result.cloudLayer2 = { ...result.cloudLayer2, direction: defaultCloud2.direction };
      }
      localStorage.setItem('weatherSettings', JSON.stringify(result));
      return result;
    }
    return {
      lightingRange: [50, 100] as [number, number],
      cycleDuration: 2,
      cloudLayer1: defaultCloud1,
      cloudLayer2: defaultCloud2,
    };
  });

  // Belt-and-suspenders persistence: write weatherSettings to
  // localStorage on every change. The setter at handleWeatherSettingsChange
  // also writes, but doing it in an effect guarantees the value on disk
  // stays in sync with whatever React last committed, even across
  // Strict-Mode double-invokes or programmatic state pushes.
  useEffect(() => {
    localStorage.setItem('weatherSettings', JSON.stringify(weatherSettings));
  }, [weatherSettings]);
  
  // Lightning Panel state
  const [lightningPanelOpen, setLightningPanelOpen] = useState(false);
  const [lightningSettings, setLightningSettings] = useState<LightningSettings>(() => {
    const stored = localStorage.getItem('lightningSettings');
    if (stored) {
      try {
        const parsed = JSON.parse(stored);
        // Migrate stale fog settings to improved defaults
        if (!parsed.settingsVersion || parsed.settingsVersion < 2) {
          parsed.fogStartPct = 50;
          parsed.fogEndPct = 95;
          parsed.settingsVersion = 2;
          localStorage.setItem('lightningSettings', JSON.stringify(parsed));
        }
        return parsed;
      } catch {}
    }
    return {
      fogStartPct: 50,
      fogEndPct: 95,
      fogDayColor: '#cccccc',
      fogNightColor: '#222233',
      fogEnabled: true,
      visualDistance: 4,
      lightingOverride: null,
      freezeCycle: false,
      settingsVersion: 2,
    };
  });
  const cycleStateRef = useRef<CycleState>({ lightingPercentage: 0, cyclePosition: 0, isNight: false });

  const handleLightningSettingsChange = useCallback(<K extends keyof LightningSettings>(key: K, value: LightningSettings[K]) => {
    setLightningSettings(prev => {
      const updated = { ...prev, [key]: value };
      localStorage.setItem('lightningSettings', JSON.stringify(updated));
      return updated;
    });
  }, []);

  // UI State
  const [coinScore, setCoinScore] = useState(0);
  const [crosshairsEnabled, setCrosshairsEnabled] = useState(false);
  const [inventoryOpen, setInventoryOpen] = useState(false);

  // Close inventory when pointer lock is re-acquired (user clicks back into game)
  useEffect(() => {
    const handlePointerLockChange = () => {
      if (document.pointerLockElement) {
        setInventoryOpen(false);
      }
    };
    document.addEventListener('pointerlockchange', handlePointerLockChange);
    return () => document.removeEventListener('pointerlockchange', handlePointerLockChange);
  }, []);

  const [selectedBlockType, setSelectedBlockType] = useState<string | null>(null);
  const [selectedSeedTier, setSelectedSeedTier] = useState<number | null>(null);
  const [blockPlacementMode, setBlockPlacementMode] = useState(false);
  const [treePlacementMode, setTreePlacementMode] = useState(false);
  // Fungal tree (giant mushroom) planting mode - activated by T then 3
  const [fungalPlacementMode, setFungalPlacementMode] = useState(false);
  const [selectedFungalTier, setSelectedFungalTier] = useState<number | null>(null);
  // Wide tree planting mode - activated by T then 2
  const [widePlacementMode, setWidePlacementMode] = useState(false);
  const [selectedWideTier, setSelectedWideTier] = useState<number | null>(null);
  const [showOwnershipOutline, setShowOwnershipOutline] = useState(false);
  const [showPerfMonitor, setShowPerfMonitor] = useState(false);
  const [hoveredBlockId, setHoveredBlockId] = useState<string | null>(null);
  const [wallPositions, setWallPositions] = useState<Record<number, {x: number, y: number, z: number, rotX: number, rotY: number, rotZ: number}>>({});
  const [isMoveMode, setIsMoveMode] = useState(false);
  const [flyingCoins, setFlyingCoins] = useState<FlyingCoin[]>([]);
  const [godMode, setGodMode] = useState(false);
  const [performanceMode, setPerformanceMode] = useState(false);
  // Admin override for bullet tier (R-mode)
  const [adminTierOverride, setAdminTierOverride] = useState<number | null>(null);
  const [pentabulletCharge, setPentabulletCharge] = useState(0);
  // Jet Boost state for HUD
  const [jetBoostState, setJetBoostState] = useState({ available: 0, max: 0, nextRefillAtMs: 0, isGliding: false });
  // Hotbar selected slot (1-6), lifted from HUD for cross-component access
  const [selectedSlot, setSelectedSlot] = useState(1);

  // Tree chopping modal state
  const [treeChopModalOpen, setTreeChopModalOpen] = useState(false);
  const [pendingChopPosition, setPendingChopPosition] = useState<{ x: number; y: number; z: number } | null>(null);
  const [chopProgress, setChopProgress] = useState(0);

  // Grenade-ready slot — the specific hotbar slot (1-6) that has a
  // pin-pulled grenade waiting for a throw click. null means not armed.
  // HUD reads this to flash ONLY this slot (not every non-stack slot).
  // The boolean flag is derived for convenience.
  const [grenadeReadySlot, setGrenadeReadySlot] = useState<number | null>(null);
  const grenadeReady = grenadeReadySlot !== null;

  // God Map (Cmd+M). Open to everyone for viewing; only superadmins
  // can paint/erase no-plant zones; only admins/superadmins see other
  // players' seed details on hover. Player position ref is populated
  // by FortressScene's per-frame loop so the map can draw the "you
  // are here" dot without a render-thrash subscription.
  const [godMapOpen, setGodMapOpen] = useState(false);
  const playerPositionRef = useRef<THREE.Vector3 | null>(null);

  // Shpider Egg ready slot — same shape as grenadeReadySlot. Armed via
  // Y, thrown on click. Eggs hatch on rest into a pet shpider.
  const [eggReadySlot, setEggReadySlot] = useState<number | null>(null);

  // Vault state — proximity flag flips when player walks into the
  // back-wall trigger zone, prompt + V keybind become active. Open
  // flag controls the modal. forceCloseToken bumps when we want the
  // VaultPanel to run its cursor-stack-return logic and then close.
  const [vaultInRange, setVaultInRange] = useState(false);
  const [vaultOpen, setVaultOpen] = useState(false);
  const [vaultForceCloseToken, setVaultForceCloseToken] = useState(0);
  const handleOpenVault = useCallback(() => {
    setVaultOpen(true);
    // Force the inventory open too — the vault renders directly above
    // the inventory grid; with inventory closed the vault would float
    // above empty space.
    setInventoryOpen(true);
  }, []);
  const handleCloseVault = useCallback(() => setVaultOpen(false), []);
  // Auto-close vault if the player walks out of range while it's open.
  // Bump the token so the panel can return any held cursor stack to
  // its origin before unmounting — otherwise the items would vanish.
  useEffect(() => {
    if (!vaultInRange && vaultOpen) {
      setVaultForceCloseToken(t => t + 1);
    }
  }, [vaultInRange, vaultOpen]);
  
  // Waterfall disabled for performance testing (Phase 1)
  const waterfallEnabled = false;
  
  // Hooks
  const { profile, tokenBalance, allTokenBalances, inventory, equippedItems, updateEquippedSlot, consumeQuickSlot, userRoles, addCoins, addPoints, useBlock, refreshData, collectWispBlock, returnSeed, addItem, removeInventoryRow, updateVisualDistance, updateFogEnabled } = useUserData();
  const { blocks, placeBlock, placeBlocksBatch, removeBlock, setBlockMode, currentWorld, navigateWorld, worldIndex, currentWorldId, refreshBlocks, loadedChunksRef, refetchSingleChunk, removeBlocksByPositions } = useBlocks();
  const { user } = useAuth();
  const { toast } = useToast();
  const { isOpen: panelOpen, openPanel, isMarketplaceOpen, openMarketplace, closeMarketplace } = useUserPanel();
  const { openPanel: openAdminPanel } = useAdminPanel();

  // View settings — local state for immediate reactivity, synced from/to Supabase
  const [viewSettings, setViewSettings] = useState<ViewSettings>(DEFAULT_VIEW_SETTINGS);
  useEffect(() => {
    const ws = currentWorld?.view_settings;
    if (ws && typeof ws === 'object') {
      setViewSettings({ ...DEFAULT_VIEW_SETTINGS, ...ws } as ViewSettings);
    }
  }, [currentWorld?.view_settings]);

  const viewSettingsDbRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  const handleViewSettingsChange = useCallback((updated: ViewSettings) => {
    setViewSettings(updated);                       // immediate state for real-time reactivity
    if (currentWorldId) {
      if (viewSettingsDbRef.current) clearTimeout(viewSettingsDbRef.current);
      viewSettingsDbRef.current = setTimeout(() => {
        supabase.from('worlds').update({ view_settings: updated as any }).eq('id', currentWorldId).then();
      }, 300);
    }
  }, [currentWorldId]);

  // Sync lightning panel visualDistance from profile
  useEffect(() => {
    if (profile?.visual_distance !== undefined) {
      setLightningSettings(prev => {
        if (prev.visualDistance === profile.visual_distance) return prev;
        return { ...prev, visualDistance: profile.visual_distance };
      });
    }
    if (profile?.fog_enabled !== undefined) {
      setLightningSettings(prev => {
        if (prev.fogEnabled === profile.fog_enabled) return prev;
        return { ...prev, fogEnabled: profile.fog_enabled };
      });
    }
  }, [profile?.visual_distance, profile?.fog_enabled]);

  // Handle visual distance change from Lightning Panel
  useEffect(() => {
    const profileDist = profile?.visual_distance || 4;
    if (lightningSettings.visualDistance !== profileDist) {
      updateVisualDistance(lightningSettings.visualDistance);
    }
  }, [lightningSettings.visualDistance]);

  // Handle fog enabled change from Lightning Panel
  useEffect(() => {
    const profileFog = profile?.fog_enabled ?? true;
    if (lightningSettings.fogEnabled !== profileFog) {
      updateFogEnabled(lightningSettings.fogEnabled);
    }
  }, [lightningSettings.fogEnabled]);

  // Derive selected item definition from hotbar slot + equipped items
  // Cache fetched item defs by itemId to avoid async lag on weapon switching
  const itemDefCacheRef = useRef<Map<string, SelectedItemDef>>(new Map());
  const [selectedItemDef, setSelectedItemDef] = useState<SelectedItemDef>({ itemNumber: null, tier: null, name: null, itemId: null });

  useEffect(() => {
    const eq = equippedItems.find((e: { slot: number; itemId: string }) => e.slot === selectedSlot);
    if (!eq) {
      setSelectedItemDef({ itemNumber: null, tier: null, name: null, itemId: null });
      return;
    }

    // Check cache first for instant switching
    const cached = itemDefCacheRef.current.get(eq.itemId);
    if (cached) {
      setSelectedItemDef(cached);
      return;
    }

    // Clear immediately so stale weapon type doesn't linger
    setSelectedItemDef({ itemNumber: null, tier: null, name: null, itemId: null });

    // Fetch the item definition from DB
    const fetchDef = async () => {
      const { data } = await supabase
        .from('items')
        .select('id, name, item_number, tier')
        .eq('id', eq.itemId)
        .maybeSingle();
      if (data) {
        const def: SelectedItemDef = {
          itemNumber: data.item_number,
          tier: data.tier,
          name: data.name,
          itemId: data.id,
        };
        itemDefCacheRef.current.set(eq.itemId, def);
        setSelectedItemDef(def);
      } else {
        setSelectedItemDef({ itemNumber: null, tier: null, name: null, itemId: null });
      }
    };
    fetchDef();
  }, [selectedSlot, equippedItems]);

  // Resolve grenade item UUIDs → tier. Forged grenades live in
  // user_inventory as { item_type: 'item', item_id: <items.id> }, so we
  // need the items table to know which UUIDs are grenades. Refetches
  // when the inventory id-set changes (covers forging a fresh tier).
  const grenadeDefsRef = useRef<Map<string, number>>(new Map());
  const healthPotionIdRef = useRef<string | null>(null);
  const grenadeT1IdRef = useRef<string | null>(null);
  useEffect(() => {
    let cancelled = false;
    (async () => {
      const { data } = await supabase
        .from('items')
        .select('id, key, tier')
        .or('key.eq.grenade,key.like.grenade_t%,key.eq.health_potion');
      if (cancelled || !data) return;
      const map = new Map<string, number>();
      for (const row of data) {
        if (row.key === 'health_potion') {
          healthPotionIdRef.current = row.id;
          continue;
        }
        const tier = row.tier ?? 1;
        map.set(row.id, tier);
        // Accept either legacy 'grenade' key OR the tiered 'grenade_t1'
        // pattern. The Ctrl+G admin grant needs the tier-1 item id so
        // it can drop one in the user's inventory.
        if (tier === 1 && (row.key === 'grenade' || row.key === 'grenade_t1')) {
          grenadeT1IdRef.current = row.id;
        }
      }
      grenadeDefsRef.current = map;
    })();
    return () => { cancelled = true; };
    // Re-run when inventory composition changes so newly-forged tiers
    // (which create a fresh items row) show up. Cheap query, rarely hit.
  }, [inventory.map(i => i.item_id || i.item_type).join(',')]);

  // QS-as-storage: throw consumes the grenade in the currently-armed
  // QS slot. Returns its tier so the throw can scale. (The legacy
  // "best-tier-in-inv" logic doesn't apply — under the new model,
  // grenades live in QS, not inv; the user explicitly chose which
  // tier to arm by equipping it.)
  const consumeGrenade = useCallback((): number | null => {
    if (grenadeReadySlot === null) return null;
    const eq = (equippedItems as Array<{ slot: number; itemId: string }>)
      .find(e => e.slot === grenadeReadySlot);
    if (!eq) { setGrenadeReadySlot(null); return null; }
    const tier = grenadeDefsRef.current.get(eq.itemId);
    if (tier == null) { setGrenadeReadySlot(null); return null; }
    const slotToConsume = grenadeReadySlot;
    setGrenadeReadySlot(null);
    void consumeQuickSlot(slotToConsume);
    return tier;
  }, [grenadeReadySlot, equippedItems, consumeQuickSlot]);

  // G key handler — only arms if a grenade is actually available.
  // Decision tree:
  //   1. Already armed → second G cancels (disarm).
  //   2. Grenade in equipped hotbar slot → arm that slot.
  //   3. Grenade in inventory + free hotbar slot → auto-equip into
  //      first free slot, arm it.
  //   4. Grenade in inventory but hotbar full → no-op (G doesn't work).
  //   5. No grenade anywhere → no-op.
  const handleGrenadeTogglePress = useCallback(() => {
    if (grenadeReadySlot !== null) {
      // Cancel arm.
      setGrenadeReadySlot(null);
      return;
    }
    const defs = grenadeDefsRef.current;
    // Step 2: any equipped slot already holding a grenade?
    const equippedSlotWithGrenade = (equippedItems as Array<{ slot: number; itemId: string }>)
      .find(eq => defs.has(eq.itemId));
    if (equippedSlotWithGrenade) {
      setGrenadeReadySlot(equippedSlotWithGrenade.slot);
      playPinPullSound();
      return;
    }
    // Step 3: inventory has a grenade and a hotbar slot is free?
    const grenadeInv = inventory.find(inv =>
      inv.quantity > 0 && inv.item_id && defs.has(inv.item_id)
    );
    if (!grenadeInv || !grenadeInv.item_id) return; // no grenade anywhere
    const usedSlots = new Set((equippedItems as Array<{ slot: number; itemId: string }>).map(e => e.slot));
    let firstEmpty: number | null = null;
    for (let i = 1; i <= 6; i++) {
      if (!usedSlots.has(i)) { firstEmpty = i; break; }
    }
    if (firstEmpty === null) return; // hotbar full — G doesn't work
    void updateEquippedSlot(firstEmpty, grenadeInv.item_id);
    setGrenadeReadySlot(firstEmpty);
    playPinPullSound();
  }, [grenadeReadySlot, equippedItems, inventory, updateEquippedSlot]);

  // Throw flow needs to clear the armed slot when the click consumes
  // the grenade. We can't modify onThrowGrenade itself (it lives in
  // FortressScene), so we listen for inventory shrink after a throw
  // via a useEffect. Simpler approach: wrap consumeGrenade so it
  // also clears state. But consumeGrenade is passed to Scene…
  //
  // Cleanest: re-use a useEffect that watches inventory + armed slot:
  // if armed AND the armed slot's item is no longer present, disarm.
  // QS-as-storage: the grenade IS in the armed QS slot (no longer a
  // reference into inv). So the only checks needed are: slot still
  // occupied, and the occupant is still a grenade. The legacy
  // "stillHaveAnyGrenade" inventory.some(...) check is wrong under
  // the new model — grenades are in QS, not inv — and would disarm
  // a valid arm whenever no extra grenades sit in inv.
  useEffect(() => {
    if (grenadeReadySlot === null) return;
    const eq = (equippedItems as Array<{ slot: number; itemId: string }>)
      .find(e => e.slot === grenadeReadySlot);
    if (!eq) { setGrenadeReadySlot(null); return; }
    const defs = grenadeDefsRef.current;
    if (!defs.has(eq.itemId)) { setGrenadeReadySlot(null); return; }
  }, [grenadeReadySlot, equippedItems]);

  // Resolve shpider egg item UUIDs → tier. Same pattern as grenades —
  // forging a new tier creates a fresh items row, so we refetch when
  // the inventory id-set changes.
  const eggDefsRef = useRef<Map<string, number>>(new Map());
  useEffect(() => {
    let cancelled = false;
    (async () => {
      const { data } = await supabase
        .from('items')
        .select('id, key, tier')
        .like('key', 'shpider_egg_t%');
      if (cancelled || !data) return;
      const map = new Map<string, number>();
      for (const row of data) {
        map.set(row.id, row.tier ?? 1);
      }
      eggDefsRef.current = map;
    })();
    return () => { cancelled = true; };
  }, [inventory.map(i => i.item_id || i.item_type).join(',')]);

  // Pull one shpider egg out of inventory. Picks HIGHEST tier the user
  // owns. Skips rows whose cooldown_until is still in the future. Eggs
  // are non-stackable — consume = delete the specific row. Caller gets
  // both the tier (for spawn) and the row id (so the pet remembers
  // which row to refund into when it dies).
  // QS-as-storage: hatch consumes the egg in the currently-armed QS
  // slot. Cooldowns are now tracked on the QS row (future work — for
  // now, no cooldown enforcement when consuming from QS).
  const consumeEgg = useCallback((): { tier: number; eggInventoryRowId: string } | null => {
    if (eggReadySlot === null) return null;
    const eq = (equippedItems as Array<{ slot: number; itemId: string }>)
      .find(e => e.slot === eggReadySlot);
    if (!eq) { setEggReadySlot(null); return null; }
    const tier = eggDefsRef.current.get(eq.itemId);
    if (tier == null) { setEggReadySlot(null); return null; }
    const slotToConsume = eggReadySlot;
    setEggReadySlot(null);
    void consumeQuickSlot(slotToConsume);
    // eggInventoryRowId is no longer meaningful (egg is in QS, not inv).
    // Callers that depended on it for "refund on death" need a future
    // QS-aware refund path; for now we return a synthetic placeholder.
    return { tier, eggInventoryRowId: eq.itemId };
  }, [eggReadySlot, equippedItems, consumeQuickSlot]);

  // Y key handler — only arms if a non-cooldown egg is available.
  const handleEggTogglePress = useCallback(() => {
    if (eggReadySlot !== null) {
      setEggReadySlot(null);
      return;
    }
    const defs = eggDefsRef.current;
    const now = Date.now();
    const rowIsUsable = (inv: any): boolean => {
      if (inv.quantity <= 0 || !inv.item_id) return false;
      if (!defs.has(inv.item_id)) return false;
      const cd = inv.cooldown_until;
      if (cd && new Date(cd).getTime() > now) return false;
      return true;
    };
    // Step 1: equipped slot already holding a usable egg? A single
    // item_id can map to multiple inventory rows (non-stackable, one
    // row per egg) — equip arms if ANY matching row is usable.
    const equippedSlotWithEgg = (equippedItems as Array<{ slot: number; itemId: string }>)
      .find(eq => defs.has(eq.itemId) && inventory.some(i => i.item_id === eq.itemId && rowIsUsable(i)));
    if (equippedSlotWithEgg) {
      setEggReadySlot(equippedSlotWithEgg.slot);
      return;
    }
    // Step 2: inventory has a usable egg + a free hotbar slot.
    const eggInv = inventory.find(inv => rowIsUsable(inv));
    if (!eggInv || !eggInv.item_id) return;
    const usedSlots = new Set((equippedItems as Array<{ slot: number; itemId: string }>).map(e => e.slot));
    let firstEmpty: number | null = null;
    for (let i = 1; i <= 6; i++) {
      if (!usedSlots.has(i)) { firstEmpty = i; break; }
    }
    if (firstEmpty === null) return;
    void updateEquippedSlot(firstEmpty, eggInv.item_id);
    setEggReadySlot(firstEmpty);
  }, [eggReadySlot, equippedItems, inventory, updateEquippedSlot]);

  // Auto-disarm if armed egg slot becomes empty or non-egg.
  // QS-as-storage: the egg IS the QS slot's occupant; no inv check
  // needed. Cooldown enforcement on QS-stored eggs is currently lost
  // (cooldown_until lived on user_inventory rows, but the egg has
  // been moved into user_equipped_items which has no cooldown
  // column). Adding cooldown to QS is a follow-up.
  useEffect(() => {
    if (eggReadySlot === null) return;
    const eq = (equippedItems as Array<{ slot: number; itemId: string }>)
      .find(e => e.slot === eggReadySlot);
    if (!eq) { setEggReadySlot(null); return; }
    const defs = eggDefsRef.current;
    if (!defs.has(eq.itemId)) { setEggReadySlot(null); return; }
  }, [eggReadySlot, equippedItems]);

  // Admin: grant 1 of an item (by items.id) and auto-equip to hotbar
  // slot 6 if it's currently empty. Used by Cmd+G (grenade) and
  // Cmd+H (health potion).
  const grantAdminItem = useCallback(async (itemId: string | null): Promise<boolean> => {
    if (!itemId) return false;
    const ok = await addItem(itemId, 1);
    if (!ok) return false;
    // Equip into the RIGHTMOST empty hotbar slot (prefer 6, then 5,
    // ..., then 1). If all six are taken, leave it in inventory only.
    const usedSlots = new Set((equippedItems as Array<{ slot: number; itemId: string }>).map(e => e.slot));
    for (let s = 6; s >= 1; s--) {
      if (!usedSlots.has(s)) {
        await updateEquippedSlot(s, itemId);
        break;
      }
    }
    return true;
  }, [addItem, equippedItems, updateEquippedSlot]);

  const grantAdminGrenade = useCallback(async (): Promise<boolean> => {
    return grantAdminItem(grenadeT1IdRef.current);
  }, [grantAdminItem]);

  const grantAdminHealthPotion = useCallback(async (): Promise<boolean> => {
    return grantAdminItem(healthPotionIdRef.current);
  }, [grantAdminItem]);

  // Compute bullet tier from player level (automatic for all players)
  // Level 1-3 → Tier 1, Level 4-6 → Tier 2, etc.
  const baseBulletTier = useMemo(() => 
    getDefaultBulletTier(profile?.current_level ?? 1), 
    [profile?.current_level]
  );
  
  // Effective tier: admin override OR level-based automatic tier
  const selectedBulletTier = adminTierOverride ?? baseBulletTier;
  
  // Get bullet color for crosshair
  const { getDefinition } = useBulletDefinitions();
  const bulletColor = getDefinition(selectedBulletTier).colors[0] || '#FFFF00';
  
  // Player health system
  const {
    currentHealth,
    maxHealth,
    isDead,
    takeDamage,
    applyDamageWithKnockback,
    respawn,
    heal,
    healthRef
  } = usePlayerHealth();

  // Hotbar quick-use: digit keys 1-6 activate the equipped slot's item.
  // Currently handles health_potion (full heal + swallow sound + consume);
  // other consumable item keys can be added below by name.
  // IMPORTANT: must be declared AFTER usePlayerHealth() because the
  // useCallback dep array references `heal` and `healthRef`. Declaring
  // it earlier puts them in the temporal dead zone — minified prod
  // builds crash with "Cannot access 'heal' before initialization" on
  // every render, which is what caused the blank-blue-screen incident
  // on 2026-May-26.
  // Pink-red flash on the slot during the drink animation. Set when
  // a potion is consumed (slot N), cleared by the timeout below.
  const [potionDrinkingSlot, setPotionDrinkingSlot] = useState<number | null>(null);

  // Internal helper used by both the slot-# handler and the H key —
  // drinks the potion in the given slot, plays SFX, runs the flash.
  // Returns true if the drink happened. Caller is responsible for
  // ensuring the slot actually holds a health potion before calling.
  // QS-as-storage: drink consumes the potion that's IN the QS slot.
  // No inv-side bookkeeping needed — the potion lives only in QS.
  const consumePotionInSlot = useCallback(async (slot: number, itemId: string): Promise<boolean> => {
    if (healthRef.current.currentHealth >= healthRef.current.maxHealth) return false;
    // Verify the QS slot actually holds this item before consuming.
    const eq = (equippedItems as Array<{ slot: number; itemId: string }>)
      .find(e => e.slot === slot && e.itemId === itemId);
    if (!eq) return false;
    heal(healthRef.current.maxHealth);
    try {
      const audio = new Audio('/swallow_potion.mp3');
      audio.volume = 0.8;
      void audio.play();
    } catch { /* sound failure shouldn't block consume */ }
    setPotionDrinkingSlot(slot);
    setTimeout(() => setPotionDrinkingSlot(s => (s === slot ? null : s)), 600);
    await consumeQuickSlot(slot);
    return true;
  }, [heal, healthRef, equippedItems, consumeQuickSlot]);

  const handleUseHotbarSlot = useCallback(async (slot: number) => {
    const eq = (equippedItems as Array<{ slot: number; itemId: string }>).find(e => e.slot === slot);
    if (!eq?.itemId) return;

    // Grenade in this slot → toggle grenade-ready for THIS specific
    // slot (digit press = same intent as G). Disarm if already armed
    // on this slot. Synchronous via grenadeDefsRef so the digit fires
    // before any DB roundtrip.
    if (grenadeDefsRef.current.has(eq.itemId)) {
      if (grenadeReadySlot === slot) {
        setGrenadeReadySlot(null);
      } else {
        setEggReadySlot(null); // mutually exclusive with egg-ready
        setGrenadeReadySlot(slot);
        playPinPullSound();
      }
      return;
    }

    // Shpider egg in this slot → same toggle pattern (Y-key equivalent).
    if (eggDefsRef.current.has(eq.itemId)) {
      if (eggReadySlot === slot) {
        setEggReadySlot(null);
      } else {
        setGrenadeReadySlot(null);
        setEggReadySlot(slot);
      }
      return;
    }

    // Anything else: fall back to the per-item-type quick-use behavior.
    const { data: itemDef } = await supabase
      .from('items')
      .select('key, item_category')
      .eq('id', eq.itemId)
      .maybeSingle();
    if (!itemDef) return;
    if (itemDef.key === 'health_potion') {
      await consumePotionInSlot(slot, eq.itemId);
    }
  }, [equippedItems, consumePotionInSlot, grenadeReadySlot, eggReadySlot]);

  // H key handler — drinks a potion if one is reachable. Same auto-
  // equip rule as G for grenades:
  //   1. Health potion already in a hotbar slot → drink that slot.
  //   2. Potion in inventory + a free hotbar slot → equip to first
  //      free slot then drink.
  //   3. No potion or hotbar full → no-op.
  const handleHealthPotionUse = useCallback(async () => {
    const potionId = healthPotionIdRef.current;
    if (!potionId) return; // potion def hasn't loaded yet
    if (healthRef.current.currentHealth >= healthRef.current.maxHealth) return; // full HP — don't waste
    // Step 1: any hotbar slot holding a potion?
    const equippedSlot = (equippedItems as Array<{ slot: number; itemId: string }>)
      .find(eq => eq.itemId === potionId);
    if (equippedSlot) {
      await consumePotionInSlot(equippedSlot.slot, potionId);
      return;
    }
    // Step 2: potion in inventory + free hotbar slot?
    const inv = inventory.find(i => i.item_id === potionId && i.quantity > 0);
    if (!inv) return;
    const usedSlots = new Set((equippedItems as Array<{ slot: number; itemId: string }>).map(e => e.slot));
    let firstEmpty: number | null = null;
    for (let i = 1; i <= 6; i++) {
      if (!usedSlots.has(i)) { firstEmpty = i; break; }
    }
    if (firstEmpty === null) return; // hotbar full
    await updateEquippedSlot(firstEmpty, potionId);
    await consumePotionInSlot(firstEmpty, potionId);
  }, [equippedItems, inventory, healthRef, consumePotionInSlot, updateEquippedSlot]);

  // Shwarm definitions
  const { data: shwarmDefinitions } = useShwarmDefinitions();

  // Shnake definitions
  const { data: shnakeDefinitions } = useShnakeDefinitions();

  // Shombie definitions
  const { data: shombieDefinitions } = useShombieDefinitions();

  // Walapa definitions
  const { definitions: walapaDefinitions } = useWalapaDefinitions();

  // Shtickman definitions
  const { data: shtickmanDefinitions } = useShtickmanDefinitions();

  // Pathfinding configurations (populates the pathfindingService cache)
  usePathfindingConfigs();

  const [respawnTimer, setRespawnTimer] = useState(0);
  const [respawnPosition, setRespawnPosition] = useState<THREE.Vector3 | null>(null);

  // Listen for admin teleport events from UI panels
  useEffect(() => {
    const handler = (e: Event) => {
      const { x, y, z } = (e as CustomEvent).detail;
      setRespawnPosition(new THREE.Vector3(x, y, z));
    };
    window.addEventListener('playerTeleport', handler);
    return () => window.removeEventListener('playerTeleport', handler);
  }, []);

  // Clear block cache once on mount to ensure new block types (wood, fruit) are loaded
  useEffect(() => {
    if (TREE_CONFIG.ENABLED) {
      clearBlocksCache();
    }
  }, []);
  
  // Tree system hooks (only active if TREE_CONFIG.ENABLED)
  // Note: Tree blocks are now stored in placed_blocks and come through the regular chunk loading system
  const { seedDefinitions, plantedTrees, myIncompleteTrees, treeFruits, refetch: refetchTrees, removeTree, removeFruit } = useTreeData(
    TREE_CONFIG.ENABLED ? currentWorldId : null,
    user?.id ?? null
  );
  
  // Local growth manager - stub for backwards compatibility
  const { stopGrowing, growingTreesRef } = useLocalGrowth();

  // Automatic server-side tree growth polling.
  //
  // CRITICAL: useTreeData splits the user's OWN in-progress trees into
  // `myIncompleteTrees` (a separate array) so that `plantedTrees`
  // returns only fully-grown trees + other users' trees. That makes
  // `plantedTrees.some(t => !t.is_fully_grown)` always false for the
  // local player's just-planted seed. If we only watched plantedTrees,
  // the poller never fired and the user's tree never grew. This was
  // the "I planted a T23 seed and it never grows" bug from 2026-May-24.
  // Include myIncompleteTrees so the poller actually runs while the
  // user's own seed is growing.
  const hasGrowingTrees =
    plantedTrees.some(t => !t.is_fully_grown) ||
    myIncompleteTrees.length > 0;
  // fastMode: poll every 1s when a growing tree is within view of
  // the camera. Drops back to 10s when player walks away. Source of
  // truth is the GrowthProximityWatcher mounted in FortressScene.
  const [growingTreeInView, setGrowingTreeInView] = useState(false);
  useTreeGrowthPoller({
    hasGrowingTrees,
    enabled: TREE_CONFIG.ENABLED && !!user?.id,
    fastMode: growingTreeInView,
    // Realtime can drop chunk_versions events (channel hiccup, etc.) so
    // when the server confirms growth happened, force-refetch every
    // currently-loaded chunk. Cheap (only fires when blocks actually
    // grew) and guarantees the player sees their tree advance.
    onBlocksInserted: useCallback(() => {
      const chunks = loadedChunksRef?.current;
      if (!chunks || !refetchSingleChunk) return;
      for (const key of chunks.keys()) {
        const m = key.match(/^chunk_(-?\d+)_(-?\d+)$/);
        if (!m) continue;
        void refetchSingleChunk(parseInt(m[1], 10), parseInt(m[2], 10));
      }
    }, [loadedChunksRef, refetchSingleChunk]),
  });

  const { plantSeed } = useSeedPlanting({
    worldId: currentWorldId,
    userId: user?.id ?? null,
    seedDefinitions,
    placeBlock,
  });
  
  // Tree chopping - allows owner to destroy tree and get seed back
  // IMPORTANT: Combine plantedTrees + myIncompleteTrees + actively growing trees
  // This ensures user can chop trees at any stage (just planted, growing, or fully grown)
  // (refetchSingleChunk + removeBlocksByPositions are destructured up top with the
  // rest of useBlocks() so the tree-growth poller callback can reach them.)
  
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
    userRoles,  // For admin/superadmin bypass
    plantedTrees: allTrees,  // Pass ALL trees including user's incomplete ones
    seedDefinitions,
    returnSeed,
    refetchChunk: refetchSingleChunk,
    refetchTrees,  // Force refresh tree labels after chopping
    removeTreeFromState: removeTree,  // Immediately remove tree from UI
    stopGrowing,
    removeBlocksByPositions,
    // onTreeChopped will be added when we implement Shnake cleanup
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
    console.log('[Fortress] handleTreeChopConfirm called, pendingChopPosition:', pendingChopPosition);
    if (pendingChopPosition) {
      console.log(`[Fortress] Calling chopTreeAtPosition at (${pendingChopPosition.x}, ${pendingChopPosition.y}, ${pendingChopPosition.z})`);
      const result = await chopTreeAtPosition(pendingChopPosition.x, pendingChopPosition.y, pendingChopPosition.z);
      console.log('[Fortress] chopTreeAtPosition result:', result);
    } else {
      console.warn('[Fortress] No pendingChopPosition set!');
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

  // Admin block mining handler - removes block and returns to owner/inventory
  const handleBlockMineComplete = useCallback(async (x: number, y: number, z: number) => {
    // Find the block at this position
    let block: PlacedBlock | undefined;
    const chunksRef = loadedChunksRef?.current;
    if (chunksRef) {
      for (const chunkData of chunksRef.values()) {
        block = chunkData.blocks.find(b =>
          Math.floor(b.position_x) === x &&
          Math.floor(b.position_y) === y &&
          Math.floor(b.position_z) === z
        );
        if (block) break;
      }
    }

    if (!block) {
      toast({ title: "No block found", duration: 2000 });
      return;
    }

    // Play removal sound
    playReversedAudio(getSoundUrl('block_remove', '/wooden_thud_sound.mp3'));

    // Remove the block from the world
    console.log(`[BlockMine] Removing block id=${block.id} type=${block.block_type} owner=${block.user_id} at (${x},${y},${z})`);
    const success = await removeBlock(block.id);
    if (!success) {
      console.error(`[BlockMine] removeBlock returned false for id=${block.id}`);
      toast({ title: "Failed to mine block", variant: "destructive", duration: 2000 });
      return;
    }

    // Handle ownership
    if (block.user_id && block.user_id === user?.id) {
      // My block — returned to my inventory
      toast({ title: "Block returned to inventory", duration: 2000 });
    } else if (block.user_id) {
      // Someone else's block. removeBlock() above already enforced
      // "owner or admin only," so this branch is only reachable when
      // the caller is admin/superadmin mining another player's block.
      // The admin grant RPC validates the role server-side.
      try {
        await worldStore.adminGrantInventoryRow(block.user_id, 'fortress_block', null, 1);
        toast({ title: "Block returned to owner", duration: 2000 });
      } catch (err) {
        console.error('[BlockMine] Failed to return block to owner:', err);
        toast({ title: "Block removed (inventory return failed)", duration: 2000 });
      }
    } else {
      // Unowned block — just removed
      toast({ title: "Block mined", duration: 2000 });
    }

    setChopProgress(0);
  }, [loadedChunksRef, removeBlock, user, toast]);

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
      
      // Reset all enemy AI states (clears revenge, stun, etc.)
      // This prevents invisible attacks from shnakes that were chasing the dead player
      EnemyManager.clearAllRevengeStates();
    }
  }, [respawnTimer, isDead, respawn]);

  // Block removal handler - only removes user-placed blocks, NOT tree blocks
  // Tree chopping requires hold-to-chop flow with confirmation modal
  const handleBlockRemove = useCallback(async (blockId: string) => {
    // Phase 2: Search loadedChunksRef instead of flat blocks array
    let block: PlacedBlock | undefined;
    const chunksRef = loadedChunksRef?.current;
    if (chunksRef) {
      for (const chunkData of chunksRef.values()) {
        block = chunkData.blocks.find(b => b.id === blockId);
        if (block) break;
      }
    }
    if (!block) {
      console.warn('Block not found for removal:', blockId);
      return;
    }

    // Don't allow single-click removal of tree blocks - must use hold-to-chop
    if (isTreeBlockType(block.block_type) && TREE_CONFIG.ENABLED) {
      toast({
        title: "Hold to chop",
        description: "Hold left mouse button on tree to chop it",
        duration: 2000
      });
      return;
    }

    // Standard block removal for user-placed blocks
    playReversedAudio(getSoundUrl('block_remove', '/wooden_thud_sound.mp3'));

    const success = await removeBlock(blockId);
    if (success) {
      toast({
        title: "Block removed",
        description: "Block returned to inventory",
        duration: 2000
      });
    }
  }, [loadedChunksRef, removeBlock, toast]);

  // Admin Block Inspector delete handler - removes block and returns to owner's inventory
  // OPTIMISTIC: Block disappears immediately with sound, server ops run in background
  const handleInspectorDeleteBlock = useCallback(async (
    blockId: string,
    blockType: string,
    ownerId: string
  ): Promise<boolean> => {
    // Find the block in loaded chunks FIRST
    let block: PlacedBlock | undefined;
    const chunksRef = loadedChunksRef?.current;
    if (chunksRef) {
      for (const chunkData of chunksRef.values()) {
        block = chunkData.blocks.find(b => b.id === blockId);
        if (block) break;
      }
    }

    if (!block) {
      console.warn('[InspectorDelete] Block not found:', blockId);
      toast({
        title: "Block not found",
        description: "Could not find this block in loaded chunks",
        variant: "destructive"
      });
      return false;
    }

    // OPTIMISTIC: Remove from view immediately and play sound
    const blockPos = { x: Math.floor(block.position_x), y: Math.floor(block.position_y), z: Math.floor(block.position_z) };
    removeBlocksByPositions([blockPos]);
    playSpatialSound(getSoundUrl('bubble_pop', '/bubble_pop.mp3'), 0, { baseVolume: 0.6 });

    // Return true immediately - server ops run in background
    // Fire off server operations without awaiting
    (async () => {
      try {
        // Delete from database
        const { error: deleteError } = await supabase
          .from('placed_blocks')
          .delete()
          .eq('id', blockId);

        if (deleteError) {
          console.error('[InspectorDelete] Database delete failed:', deleteError);
          // Block is already visually gone - just log the error
        }

        // Return block to owner's inventory (if owner exists)
        if (ownerId) {
          try {
            // Server-side admin grant. RPC enforces 'admin' role and
            // handles the stack-or-insert atomically on the owner's
            // inventory.
            await worldStore.adminGrantInventoryRow(ownerId, blockType, null, 1);
          } catch (invError) {
            console.warn('[InspectorDelete] Failed to return to inventory:', invError);
          }
        }

        console.log('[InspectorDelete] Background ops complete for block:', blockId);
      } catch (error) {
        console.error('[InspectorDelete] Background error:', error);
      }
    })();

    return true;
  }, [loadedChunksRef, removeBlocksByPositions, toast]);

  // Settings handlers
  const handleSettingsChange = (key: string, value: any) => {
    setSettings(prev => ({ ...prev, [key]: value }));
  };
  
  const handleWeatherSettingsChange = (key: string, value: any) => {
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
    // Use the current theme's coin image for the flying animation
    const imageUrl = currentTheme?.coin_image_url || '/waterfall_coin.png';

    setFlyingCoins(prev => [...prev, { id: coinId, startX, startY, startTime, imageUrl }]);

    playSound(getSoundUrl('coin_hit', '/coin_hit_sound.mp3'), 0.3);

    setTimeout(async () => {
      const success = await addCoins(1);
      if (success) {
        setCoinScore(prev => prev + 1);
      }
      setFlyingCoins(prev => prev.filter(coin => coin.id !== coinId));
    }, 600);
  }, [addCoins, currentTheme?.coin_image_url]);

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
  const handleModeChange = useCallback((mode: 'shooting' | 'building' | 'planting' | 'fungal_planting' | 'wide_planting' | null) => {
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
      setFungalPlacementMode(false);
      setWidePlacementMode(false);
      setSelectedSeedTier(null);
      setSelectedFungalTier(null);
      setSelectedWideTier(null);
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
      setFungalPlacementMode(false);
      setWidePlacementMode(false);
      setSelectedBlockType(null);
      setSelectedFungalTier(null);
      setSelectedWideTier(null);
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
    } else if (mode === 'fungal_planting') {
      // Fungal tree planting mode (giant mushrooms) - only 10 tiers
      setBlockPlacementMode(false);
      setSelectedBlockType(null);
      setTreePlacementMode(false);
      setSelectedSeedTier(null);
      setWidePlacementMode(false);
      setSelectedWideTier(null);
      setFungalPlacementMode(true);
      setCrosshairsEnabled(false);
      setBlockMode(false);
      // Filter for fungal seeds (tree_type === 'fungal') with names, max tier 10
      const availableFungalSeeds = seedDefinitions.filter(s =>
        s.tree_type === 'fungal' && s.name && s.name.trim() !== '' && s.tier <= 10
      );
      if (availableFungalSeeds.length > 0) {
        setSelectedFungalTier(availableFungalSeeds[0].tier);
        toast({ title: "Fungal tree mode", description: `Press [ ] to cycle tiers (1-10). Click to plant.`, duration: 3000 });
      } else {
        // Default to tier 1 if no fungal seeds configured
        setSelectedFungalTier(1);
        toast({ title: "Fungal tree mode", description: "No fungal seeds configured. Using default tier 1.", duration: 3000 });
      }
    } else if (mode === 'wide_planting') {
      // Wide tree planting mode - only 10 tiers
      setBlockPlacementMode(false);
      setSelectedBlockType(null);
      setTreePlacementMode(false);
      setSelectedSeedTier(null);
      setFungalPlacementMode(false);
      setSelectedFungalTier(null);
      setWidePlacementMode(true);
      setCrosshairsEnabled(false);
      setBlockMode(false);
      // Filter for wide seeds (tree_type === 'wide') with names, max tier 10
      const availableWideSeeds = seedDefinitions.filter(s =>
        s.tree_type === 'wide' && s.name && s.name.trim() !== '' && s.tier <= 10
      );
      if (availableWideSeeds.length > 0) {
        setSelectedWideTier(availableWideSeeds[0].tier);
        toast({ title: "Wide tree mode", description: `Press [ ] to cycle tiers (1-10). Click to plant.`, duration: 3000 });
      } else {
        // Default to tier 1 if no wide seeds configured
        setSelectedWideTier(1);
        toast({ title: "Wide tree mode", description: "No wide seeds configured. Using default tier 1.", duration: 3000 });
      }
    } else if (mode === 'shooting') {
      setSelectedBlockType(null);
      setBlockPlacementMode(false);
      setTreePlacementMode(false);
      setFungalPlacementMode(false);
      setWidePlacementMode(false);
      setSelectedSeedTier(null);
      setSelectedFungalTier(null);
      setSelectedWideTier(null);
      setCrosshairsEnabled(true);
      setBlockMode(false);
    } else {
      setSelectedBlockType(null);
      setBlockPlacementMode(false);
      setTreePlacementMode(false);
      setFungalPlacementMode(false);
      setWidePlacementMode(false);
      setSelectedSeedTier(null);
      setSelectedFungalTier(null);
      setSelectedWideTier(null);
      setCrosshairsEnabled(false);
      setBlockMode(false);
      toast({ title: "Mode disabled", description: "Press B for blocks, T for trees, T+2 wide, T+3 fungal", duration: 2000 });
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
      s.in_bracket_menu || (isAdmin && s.tier === 29)
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

  // Cycle through fungal tree tiers (1-10)
  const cycleFungalSeed = useCallback((direction: 'next' | 'prev') => {
    // Fungal seeds: tree_type === 'fungal', max 10 tiers
    const availableFungalSeeds = seedDefinitions.filter(s =>
      s.tree_type === 'fungal' && s.in_bracket_menu && s.tier <= 10
    );

    // If no configured fungal seeds, cycle through tiers 1-10 directly
    if (availableFungalSeeds.length === 0) {
      const currentTier = selectedFungalTier || 1;
      const nextTier = direction === 'next'
        ? (currentTier % 10) + 1
        : ((currentTier - 2 + 10) % 10) + 1;
      setSelectedFungalTier(nextTier);
      toast({ title: `Fungal Tier ${nextTier}`, duration: 1000 });
      return;
    }

    if (!selectedFungalTier) {
      setSelectedFungalTier(availableFungalSeeds[0].tier);
      return;
    }
    const currentIndex = availableFungalSeeds.findIndex(s => s.tier === selectedFungalTier);
    if (currentIndex === -1) {
      setSelectedFungalTier(availableFungalSeeds[0].tier);
      return;
    }
    const nextIndex = direction === 'next'
      ? (currentIndex + 1) % availableFungalSeeds.length
      : (currentIndex - 1 + availableFungalSeeds.length) % availableFungalSeeds.length;
    const nextSeed = availableFungalSeeds[nextIndex];
    setSelectedFungalTier(nextSeed.tier);
    toast({ title: `${nextSeed.name} (T${nextSeed.tier})`, duration: 1000 });
  }, [selectedFungalTier, seedDefinitions, toast]);

  // Cycle through wide tree tiers (1-10)
  const cycleWideSeed = useCallback((direction: 'next' | 'prev') => {
    // Wide seeds: tree_type === 'wide', max 10 tiers
    const availableWideSeeds = seedDefinitions.filter(s =>
      s.tree_type === 'wide' && s.in_bracket_menu && s.tier <= 10
    );

    // If no configured wide seeds, cycle through tiers 1-10 directly
    if (availableWideSeeds.length === 0) {
      const currentTier = selectedWideTier || 1;
      const nextTier = direction === 'next'
        ? (currentTier % 10) + 1
        : ((currentTier - 2 + 10) % 10) + 1;
      setSelectedWideTier(nextTier);
      toast({ title: `Wide Tier ${nextTier}`, duration: 1000 });
      return;
    }

    if (!selectedWideTier) {
      setSelectedWideTier(availableWideSeeds[0].tier);
      return;
    }
    const currentIndex = availableWideSeeds.findIndex(s => s.tier === selectedWideTier);
    if (currentIndex === -1) {
      setSelectedWideTier(availableWideSeeds[0].tier);
      return;
    }
    const nextIndex = direction === 'next'
      ? (currentIndex + 1) % availableWideSeeds.length
      : (currentIndex - 1 + availableWideSeeds.length) % availableWideSeeds.length;
    const nextSeed = availableWideSeeds[nextIndex];
    setSelectedWideTier(nextSeed.tier);
    toast({ title: `${nextSeed.name} (T${nextSeed.tier})`, duration: 1000 });
  }, [selectedWideTier, seedDefinitions, toast]);

  // Wide tree placement handler
  const handleWideTreePlace = useCallback(async (position: THREE.Vector3) => {
    if (!selectedWideTier) return;
    const roundedPos = { x: Math.round(position.x), y: Math.round(position.y), z: Math.round(position.z) };

    // Play planting sound
    playSpatialSound(getSoundUrl('planting_tree', '/planting_tree_sound.mp3'), 0, { baseVolume: 0.4 });

    // Plant the wide tree - force wide tree type regardless of seed definition
    const result = await plantSeed(roundedPos.x, roundedPos.y, roundedPos.z, selectedWideTier, 'wide');
    if (result.success) refetchTrees();
  }, [selectedWideTier, plantSeed, refetchTrees]);

  // Fungal tree placement handler
  const handleFungalTreePlace = useCallback(async (position: THREE.Vector3) => {
    if (!selectedFungalTier) return;
    const roundedPos = { x: Math.round(position.x), y: Math.round(position.y), z: Math.round(position.z) };

    // Play planting sound
    playSpatialSound(getSoundUrl('planting_tree', '/planting_tree_sound.mp3'), 0, { baseVolume: 0.4 });

    // Plant the fungal tree - force fungal tree type regardless of seed definition
    const result = await plantSeed(roundedPos.x, roundedPos.y, roundedPos.z, selectedFungalTier, 'fungal');
    if (result.success) refetchTrees();
  }, [selectedFungalTier, plantSeed, refetchTrees]);

  // Tree placement handler with pitched-up sound
  const handleTreePlace = useCallback(async (position: THREE.Vector3) => {
    if (!selectedSeedTier) return;
    const roundedPos = { x: Math.round(position.x), y: Math.round(position.y), z: Math.round(position.z) };
    
    // Play placement sound with 2x pitch
    try {
      const audioCtx = new (window.AudioContext || (window as any).webkitAudioContext)();
      const response = await fetch(getSoundUrl('block_place', '/wooden_thud_sound.mp3'));
      const arrayBuffer = await response.arrayBuffer();
      const audioBuffer = await audioCtx.decodeAudioData(arrayBuffer);
      const source = audioCtx.createBufferSource();
      source.buffer = audioBuffer;
      source.playbackRate.value = 2.0; // 2x pitch
      source.connect(audioCtx.destination);
      source.start();
    } catch (e) { console.warn('Seed sound failed', e); }
    
    // Plant seed - growth handled server-side
    const result = await plantSeed(roundedPos.x, roundedPos.y, roundedPos.z, selectedSeedTier);
    if (result.success) refetchTrees();
  }, [selectedSeedTier, plantSeed, refetchTrees]);

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

      // Lightning Panel toggle (Ctrl+L)
      if ((event.metaKey || event.ctrlKey) && event.key === 'l') {
        event.preventDefault();
        setLightningPanelOpen(prev => {
          if (!prev && document.pointerLockElement) {
            document.exitPointerLock();
          }
          return !prev;
        });
      }
      
      if (event.key === 'Tab' && blockPlacementMode) {
        event.preventDefault();
        setShowOwnershipOutline(prev => !prev);
      }
      
      // Performance mode toggle (0 key) - skip if spawn command sequence is active
      if (event.key === '0' && !event.repeat && !event.metaKey && !event.ctrlKey && !isSpawnSequenceActive()) {
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
      <FortressProviders>
      <Canvas
        camera={{ position: [-8, 1.8, 22], fov: 70, near: 0.1, far: 1200 }}
        shadows={false}
        gl={{ antialias: false, powerPreference: 'high-performance' }}
        dpr={1}
        onCreated={({ gl }) => {
          // Three.js calls gl.getProgramInfoLog after every shader compile, which
          // synchronously blocks the main thread until the GPU is done compiling.
          // Real-world trace 2026-May-19: ~1.6s/48s of main-thread stalls came
          // from getProgramInfoLog. Disabling shader-error checks skips it.
          gl.debug.checkShaderErrors = false;
        }}
      >
        {showPerfMonitor && <Perf position="top-left" minimal={true} />}
        <FortressScene
          settings={settings}
          onCoinHit={handleCoinHit}
          wallPositions={wallPositions}
          blockPlacementMode={blockPlacementMode}
          treePlacementMode={treePlacementMode}
          fungalPlacementMode={fungalPlacementMode}
          widePlacementMode={widePlacementMode}
          onBlockPlace={handleBlockPlace}
          onTreePlace={handleTreePlace}
          onFungalTreePlace={handleFungalTreePlace}
          onWideTreePlace={handleWideTreePlace}
          onModeChange={handleModeChange}
          onOpenPanel={handleOpenPanel}
          onOpenMarketplace={openMarketplace}
          onOpenGodMap={() => setGodMapOpen(true)}
          playerPositionRef={playerPositionRef}
          onToggleInventory={() => {
            setInventoryOpen(prev => {
              const next = !prev;
              if (next) {
                document.exitPointerLock();
              }
              return next;
            });
          }}
          crosshairsEnabled={crosshairsEnabled}
          getBlockQuantity={getBlockQuantity}
          coinImageUrl={currentTheme?.coin_image_url}
          selectedBlockType={selectedBlockType}
          selectedSeedTier={selectedSeedTier}
          selectedFungalTier={selectedFungalTier}
          selectedWideTier={selectedWideTier}
          panelOpen={panelOpen}
          onCycleBlock={cycleSelectedBlock}
          onCycleSeed={cycleSelectedSeed}
          onCycleFungalSeed={cycleFungalSeed}
          onCycleWideSeed={cycleWideSeed}
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
          lightningSettings={lightningSettings}
          viewSettings={viewSettings}
          fortressTextureUrl={currentWorld?.fortress_texture_url}
          groundTextureUrl={currentWorld?.ground_texture_url}
          skyTextureUrl={currentWorld?.sky_texture_url}
          seedDefinitions={seedDefinitions}
          plantedTrees={allTrees}
          treeFruits={treeFruits}
          onFruitRemoved={removeFruit}
          healthRef={healthRef}
          applyDamageWithKnockback={applyDamageWithKnockback}
          takeDamage={takeDamage}
          shwarmDefinitions={shwarmDefinitions}
          shnakeDefinitions={shnakeDefinitions}
          shombieDefinitions={shombieDefinitions}
          walapaDefinitions={walapaDefinitions}
          shtickmanDefinitions={shtickmanDefinitions}
          onPointsEarned={async (points) => {
            const { newLevel } = await addPoints(points);
            if (newLevel) {
              // Play level up sound
              playSound(getSoundUrl('level_up', '/yay_sound.mp3'), 0.5);
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
            playSound(getSoundUrl('level_up', '/yay_sound.mp3'), 0.3);
            
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
          onShombieKilled={async (tier) => {
            console.log(`[Fortress] Shombie killed - tier ${tier}, user: ${user?.id}`);
            if (!user?.id) {
              console.error('[Fortress] Cannot track shombie kill - no user ID');
              return;
            }
            
            // Play kill sound
            playSound(getSoundUrl('level_up', '/yay_sound.mp3'), 0.3);
            
            // Increment kill count in database
            const { data: existing, error: fetchError } = await supabase
              .from('user_combat_stats')
              .select('*')
              .eq('user_id', user.id)
              .eq('enemy_type', `shombie_t${tier}`)
              .maybeSingle();
            
            if (fetchError) {
              console.error('[Fortress] Error fetching shombie combat stats:', fetchError);
              return;
            }
            
            if (existing) {
              const { error: updateError } = await supabase
                .from('user_combat_stats')
                .update({ kills: existing.kills + 1, updated_at: new Date().toISOString() })
                .eq('id', existing.id);
              if (updateError) {
                console.error('[Fortress] Error updating shombie kill count:', updateError);
              }
            } else {
              const { error: insertError } = await supabase
                .from('user_combat_stats')
                .insert({ user_id: user.id, enemy_type: `shombie_t${tier}`, kills: 1 });
              if (insertError) {
                console.error('[Fortress] Error inserting shombie kill count:', insertError);
              }
            }
          }}
          onShpiderKilled={async ({ tier, x, y, z }) => {
            // Same pattern as the other enemy kill writers — bumps
            // user_combat_stats so the Kills panel shows shpiders
            // alongside everything else. Without this they were
            // killable but invisible in the stats screen.
            if (!user?.id) return;
            playSound(getSoundUrl('level_up', '/yay_sound.mp3'), 0.3);
            const { data: existing } = await supabase
              .from('user_combat_stats')
              .select('*')
              .eq('user_id', user.id)
              .eq('enemy_type', `shpider_t${tier}`)
              .maybeSingle();
            if (existing) {
              await supabase
                .from('user_combat_stats')
                .update({ kills: existing.kills + 1, updated_at: new Date().toISOString() })
                .eq('id', existing.id);
            } else {
              await supabase
                .from('user_combat_stats')
                .insert({ user_id: user.id, enemy_type: `shpider_t${tier}`, kills: 1 });
            }
            // 1% chance to drop a shpider egg of the killed shpider's
            // tier. Previously this added straight to inventory which
            // gave a misleading "dropped!" toast but no visible egg in
            // the world. Now we insert a world_eggs row at the kill
            // position so the killer sees a glowing egg on the ground
            // and picks it up with F — same UX as pet-death drops.
            if (Math.random() < 0.01) {
              // Resolve item_id for the egg (item_number-style lookup) so
              // the new world_eggs.item_id column gets populated. Old rows
              // without it still work via the RPC's tier-fallback.
              const { data: eggItemRow } = await supabase
                .from('items')
                .select('id')
                .eq('key', `shpider_egg_t${tier}`)
                .maybeSingle();
              const { error } = await supabase
                .from('world_eggs' as any)
                .insert({
                  tier,
                  owner_user_id: user.id,
                  position_x: x,
                  position_y: y,
                  position_z: z,
                  item_id: eggItemRow?.id ?? null,
                } as any);
              if (error) {
                // world_eggs migration not applied — fall back to direct
                // inventory grant so the drop isn't lost.
                console.warn('[ShpiderEgg] world drop insert failed:', error.message);
                const { data: eggItem } = await supabase
                  .from('items')
                  .select('id')
                  .eq('key', `shpider_egg_t${tier}`)
                  .maybeSingle();
                if (eggItem) {
                  await addItem(eggItem.id, 1);
                  toast({ title: `🥚 Shpider Egg T${tier} dropped!`, duration: 4000 });
                }
              } else {
                toast({ title: `🥚 Shpider Egg T${tier} dropped — find it on the ground!`, duration: 4000 });
              }
            }
          }}
          onPetShpiderDied={async ({ tier, petOwnerUserId, x, y, z }) => {
            // Pet shpider died — drop a world_eggs row at its position
            // so the owner can pick it back up (with a 1-hour cooldown
            // applied at pickup time). RLS should restrict pickup to
            // the owner — that's enforced by the world_eggs row's
            // owner_user_id column + table RLS policy.
            const { data: petEggItemRow } = await supabase
              .from('items')
              .select('id')
              .eq('key', `shpider_egg_t${tier}`)
              .maybeSingle();
            const { error } = await supabase
              .from('world_eggs' as any)
              .insert({
                tier,
                owner_user_id: petOwnerUserId,
                position_x: x,
                position_y: y,
                position_z: z,
                item_id: petEggItemRow?.id ?? null,
              } as any);
            if (error) {
              // Table may not be installed yet on this DB. Log but
              // don't crash — the pet just dies without a refund.
              console.warn('[ShpiderEgg] world_eggs insert failed:', error.message);
              return;
            }
            if (user?.id === petOwnerUserId) {
              toast({ title: `🥚 Your pet shpider died — egg dropped`, duration: 3500 });
            }
          }}
          onWalapaKilled={async (tier) => {
            // Walapa kill tracking — Fortress wasn't passing a
            // handler before so kills never reached the DB.
            if (!user?.id) return;
            playSound(getSoundUrl('level_up', '/yay_sound.mp3'), 0.3);
            const { data: existing } = await supabase
              .from('user_combat_stats')
              .select('*')
              .eq('user_id', user.id)
              .eq('enemy_type', `walapa_t${tier}`)
              .maybeSingle();
            if (existing) {
              await supabase
                .from('user_combat_stats')
                .update({ kills: existing.kills + 1, updated_at: new Date().toISOString() })
                .eq('id', existing.id);
            } else {
              await supabase
                .from('user_combat_stats')
                .insert({ user_id: user.id, enemy_type: `walapa_t${tier}`, kills: 1 });
            }
          }}
          onShtickmanKilled={async (tier) => {
            console.log(`[Fortress] Shtickman killed - tier ${tier}, user: ${user?.id}`);
            if (!user?.id) {
              console.error('[Fortress] Cannot track shtickman kill - no user ID');
              return;
            }

            // Play kill sound
            playSound(getSoundUrl('level_up', '/yay_sound.mp3'), 0.3);

            // Increment kill count in database
            const { data: existing, error: fetchError } = await supabase
              .from('user_combat_stats')
              .select('*')
              .eq('user_id', user.id)
              .eq('enemy_type', `shtickman_t${tier}`)
              .maybeSingle();

            if (fetchError) {
              console.error('[Fortress] Error fetching shtickman combat stats:', fetchError);
              return;
            }

            if (existing) {
              const { error: updateError } = await supabase
                .from('user_combat_stats')
                .update({ kills: existing.kills + 1, updated_at: new Date().toISOString() })
                .eq('id', existing.id);
              if (updateError) {
                console.error('[Fortress] Error updating shtickman kill count:', updateError);
              }
            } else {
              const { error: insertError } = await supabase
                .from('user_combat_stats')
                .insert({ user_id: user.id, enemy_type: `shtickman_t${tier}`, kills: 1 });
              if (insertError) {
                console.error('[Fortress] Error inserting shtickman kill count:', insertError);
              }
            }
          }}
          respawnPosition={respawnPosition}
          onRespawnComplete={() => setRespawnPosition(null)}
          isOwnedTreeAtPosition={isOwnedTreeAtPosition}
          onTreeChopComplete={handleTreeChopComplete}
          onTreeChopProgress={handleTreeChopProgress}
          onBlockMineComplete={handleBlockMineComplete}
          selectedBulletTier={selectedBulletTier}
          onBulletTierChange={setAdminTierOverride}
          playerLevel={profile?.current_level ?? 1}
          onPentabulletChargeChange={setPentabulletCharge}
          onUseHotbarSlot={handleUseHotbarSlot}
          consumeGrenade={consumeGrenade}
          onGrenadeTogglePress={handleGrenadeTogglePress}
          grenadeReady={grenadeReady}
          consumeEgg={consumeEgg}
          onEggTogglePress={handleEggTogglePress}
          eggReady={eggReadySlot !== null}
          onHealthPotionUse={handleHealthPotionUse}
          onGrowthProximityChange={setGrowingTreeInView}
          onAdminGrantGrenade={grantAdminGrenade}
          onAdminGrantHealthPotion={grantAdminHealthPotion}
          vaultInRange={vaultInRange}
          onVaultProximityChange={setVaultInRange}
          onOpenVault={handleOpenVault}
          onJetBoostStateChange={setJetBoostState}
          selectedItemDef={selectedItemDef}
          addItem={addItem}
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

        {fungalPlacementMode && selectedFungalTier && (
          <SeedPreview
            tier={selectedFungalTier}
            visible={true}
            existingBlocks={blocks || []}
            trunkTextureUrl={seedDefinitions.find(s => s.tree_type === 'fungal' && s.tier === selectedFungalTier)?.fungal_stem_texture_url}
            isFungal={true}
          />
        )}

        {widePlacementMode && selectedWideTier && (
          <SeedPreview
            tier={selectedWideTier}
            visible={true}
            existingBlocks={blocks || []}
            trunkTextureUrl={seedDefinitions.find(s => s.tree_type === 'wide' && s.tier === selectedWideTier)?.trunk_texture_url}
          />
        )}


</Canvas>

      <FortressHUD
        flyingCoins={flyingCoins}
        currentTheme={currentTheme}
        availableThemes={availableThemes}
        tokenBalance={tokenBalance}
        allTokenBalances={allTokenBalances}
        openPanel={openPanel}
        inventory={inventory}
        blockPlacementMode={blockPlacementMode}
        selectedBlockType={selectedBlockType}
        handleModeChange={handleModeChange}
        currentHealth={currentHealth}
        maxHealth={maxHealth}
        profile={profile}
        user={user}
        userRoles={userRoles}
        openAdminPanel={openAdminPanel}
        openMarketplace={openMarketplace}
        jetBoostAvailable={jetBoostState.available}
        jetBoostMax={jetBoostState.max}
        isGliding={jetBoostState.isGliding}
        equippedItems={equippedItems}
        updateEquippedSlot={updateEquippedSlot}
        addItem={addItem}
        removeInventoryRow={removeInventoryRow}
        vaultOpen={vaultOpen}
        onCloseVault={handleCloseVault}
        inventoryOpen={inventoryOpen}
        setInventoryOpen={setInventoryOpen}
        selectedSlot={selectedSlot}
        onSelectSlot={setSelectedSlot}
        onDeleteBlock={handleInspectorDeleteBlock}
        grenadeReadySlot={grenadeReadySlot}
        eggReadySlot={eggReadySlot}
        potionDrinkingSlot={potionDrinkingSlot}
      />

      <GodMapPanel
        open={godMapOpen}
        onClose={() => setGodMapOpen(false)}
        worldId={currentWorldId}
        currentUserId={user?.id ?? null}
        userRoles={userRoles}
        playerPositionRef={playerPositionRef}
      />

      <FortressOverlays
        settings={settings}
        handleSettingsChange={handleSettingsChange}
        setWallPositions={setWallPositions}
        setIsMoveMode={setIsMoveMode}
        weatherSettings={weatherSettings}
        handleWeatherSettingsChange={handleWeatherSettingsChange}
        viewSettings={viewSettings}
        handleViewSettingsChange={handleViewSettingsChange}
        handleBlockPurchased={handleBlockPurchased}
        pentabulletCharge={pentabulletCharge}
        blockPlacementMode={blockPlacementMode}
        treePlacementMode={treePlacementMode}
        crosshairsEnabled={crosshairsEnabled}
        bulletColor={bulletColor}
        grenadeReady={grenadeReady}
        eggReady={eggReadySlot !== null}
        isDead={isDead}
        respawnTimer={respawnTimer}
        respawn={respawn}
        setRespawnPosition={setRespawnPosition}
        setRespawnTimer={setRespawnTimer}
        godMode={godMode}
        treeChopModalOpen={treeChopModalOpen}
        pendingChopPosition={pendingChopPosition}
        chopProgress={chopProgress}
        setTreeChopModalOpen={setTreeChopModalOpen}
        setPendingChopPosition={setPendingChopPosition}
        setChopProgress={setChopProgress}
        handleTreeChopConfirm={handleTreeChopConfirm}
        plantedTrees={allTrees}
      />
      <LightningPanel
        open={lightningPanelOpen}
        onClose={() => setLightningPanelOpen(false)}
        settings={lightningSettings}
        onSettingsChange={handleLightningSettingsChange}
        cycleState={cycleStateRef.current}
      />

      {/* Vault is now rendered inside FortressHUD's bottom-center
          container (above the inventory grid). No separate mount here. */}

      {/* Proximity prompt — only visible when in range AND vault not
          already open. Center-bottom of the screen, HUD-style. */}
      {vaultInRange && !vaultOpen && (
        <div style={{
          position: 'fixed',
          bottom: 120,
          left: '50%',
          transform: 'translateX(-50%)',
          padding: '10px 18px',
          borderRadius: 'var(--hud-radius)',
          background: 'hsla(211, 30%, 20%, 0.7)',
          border: '1px solid hsla(211, 34%, 73%, 0.6)',
          backdropFilter: 'blur(8px) saturate(140%)',
          WebkitBackdropFilter: 'blur(8px) saturate(140%)',
          color: 'hsl(0, 0%, 95%)',
          fontSize: 14,
          fontFamily: 'var(--hud-font)',
          letterSpacing: 0.3,
          zIndex: 100,
          pointerEvents: 'none',
          textShadow: '0 1px 2px rgba(0,0,0,0.8)',
        }}>
          Press <b style={{ color: 'hsl(45, 80%, 70%)' }}>V</b> to open your <b>VAULT</b>
        </div>
      )}
      </FortressProviders>
    </div>
  );
}

export default Fortress;
