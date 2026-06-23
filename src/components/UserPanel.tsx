import React, { useState, useEffect, useMemo, useRef } from 'react';
import { Dialog, DialogContent, DialogHeader, DialogTitle } from '@/components/ui/dialog';
import { useGlowPanel } from '@/hooks/useGlowPanel';
import { usePanelDrag } from '@/hooks/usePanelDrag';
import { Tabs, TabsContent, TabsList, TabsTrigger } from '@/components/ui/tabs';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { Button } from '@/components/ui/button';
import { Card } from '@/components/ui/card';
import { Badge } from '@/components/ui/badge';
import { ScrollArea } from '@/components/ui/scroll-area';
import { Slider } from '@/components/ui/slider';
import { useBaseFov, setBaseFov, FOV_MIN, FOV_MAX, FOV_DEFAULT } from '@/config/fovSetting';
import { Switch } from '@/components/ui/switch';
import { useUserData } from '@/hooks/useUserData';
import { supabase } from '@/integrations/supabase/client';
import { useAuth } from '@/contexts/AuthContext';
import { useUserPanel } from '@/contexts/UserPanelContext';
import { BlockType } from '@/types/blocks';
import { useBlocksData } from '@/hooks/useBlocksData';
import { useCoinTheme } from '@/contexts/CoinThemeContext';
import { useBlocks } from '@/contexts/BlocksContext';
import { getInventoryQuantity } from '@/lib/inventoryHelpers';
import { LevelTab } from '@/components/LevelTab';
import { KillsTab } from '@/components/KillsTab';
import { TreesTab } from '@/components/TreesTab';
import { ItemsTab } from '@/components/ItemsTab';
import { FruitsTab } from '@/components/FruitsTab';
import { LeaderboardsPanel } from '@/components/LeaderboardsPanel';
import { useFruitData } from '@/hooks/useFruitData';
import { useTreeData } from '@/features/trees/hooks/useTreeData';
import { useCurrentWorldId } from '@/hooks/useCurrentWorldId';
// P2P Marketplace imports
import { useDivi } from '@/features/marketplace/hooks/useDivi';
import { BrowseTab } from '@/features/marketplace/components/BrowseTab';
import { MyListingsTab } from '@/features/marketplace/components/MyListingsTab';
import { MyStoreTab } from '@/features/marketplace/components/MyStoreTab';
import { TransactionHistoryTab } from '@/features/marketplace/components/TransactionHistoryTab';
import { WatchlistTab } from '@/features/marketplace/components/WatchlistTab';
import { DiviBalance } from '@/features/marketplace/components/DiviBalance';
import { WalletList } from '@/features/wallet/WalletList';
import { GameWalletPanel } from '@/features/wallet/GameWalletPanel';
import { WaxWalletPanel } from '@/features/wallet/WaxWalletPanel';
import { ExternalWalletsPanel } from '@/features/wallet/ExternalWalletsPanel';
import { SupportLevelPanel } from '@/features/supporters/SupportLevelPanel';
import type { MarketplaceTab, MarketplaceFilters, MarketplaceSortOption } from '@/features/marketplace/types';
import { getSoundUrl } from '@/hooks/useGameSounds';
import { playSound } from '@/lib/spatialAudio';
import { PanelGrabBar } from '@/components/ui/PanelGrabBar';

const getRarityColor = (rarity: BlockType['rarity']) => {
  switch (rarity) {
    case 'common': return 'bg-gray-100 text-gray-800';
    case 'rare': return 'bg-blue-100 text-blue-800';
    case 'epic': return 'bg-purple-100 text-purple-800';
    case 'legendary': return 'bg-amber-100 text-amber-800';
    default: return 'bg-gray-100 text-gray-800';
  }
};

const BlockIcon: React.FC<{ block: BlockType }> = ({ block }) => {
  const baseColor = block.properties?.color || '#8B7355';
  const isEmissive = block.properties?.emissive;
  const isTransparent = block.properties?.transparent;
  const hasTexture = block.texture?.diffuse;
  
  return (
    <div className={`w-[72px] h-[72px] rounded border flex items-center justify-center ${
      isEmissive ? 'shadow-lg' : ''
    }`}
    style={{ 
      background: hasTexture 
        ? `url(${block.texture?.diffuse}) center/cover`
        : isEmissive 
          ? `radial-gradient(circle, ${baseColor}, ${baseColor}80)` 
          : `linear-gradient(135deg, ${baseColor}, ${baseColor}CC)`,
      borderColor: isTransparent ? `${baseColor}60` : `${baseColor}DD`,
      opacity: isTransparent ? 0.8 : 1
    }}>
      {!hasTexture && (
        <div className={`w-8 h-8 rounded-sm border ${
          isEmissive ? 'animate-pulse' : ''
        }`}
        style={{
          background: `linear-gradient(135deg, ${baseColor}EE, ${baseColor}AA)`,
          borderColor: `${baseColor}FF`
        }}></div>
      )}
    </div>
  );
};

interface UserPanelProps {
  onBlockPurchased?: () => void;
}

export const UserPanel: React.FC<UserPanelProps> = ({ onBlockPurchased }) => {
  const { isOpen, activeTab, closePanel, setActiveTab } = useUserPanel();
  const { user, signOut } = useAuth();
  const { profile, tokenBalance, inventory, isLoading, buyBlock, updateBlockchainAddress, updateDisplayName, updateAvatarUrl, updateVisualDistance, updateFogEnabled, refreshData, userRoles } = useUserData();
  const { blocks: availableBlocks, isLoading: loadingBlocks } = useBlocksData();
  const { currentTheme } = useCoinTheme();
  const [blockchainAddress, setBlockchainAddress] = useState('');
  const [visualDistance, setVisualDistance] = useState(4);
  const [fogEnabled, setFogEnabled] = useState(true);
  const fov = useBaseFov();
  const [displayName, setDisplayName] = useState('');
  const avatarInputRef = useRef<HTMLInputElement>(null);
  const [avatarUploading, setAvatarUploading] = useState(false);
  // Track avatar image load failure so we fall back to the placeholder icon
  // instead of a broken-image box. Google avatar URLs (lh3.googleusercontent.com)
  // intermittently 403 — referrerPolicy=no-referrer fixes most; this catches the rest.
  const [avatarError, setAvatarError] = useState(false);
  const [storeActiveClass, setStoreActiveClass] = useState<'basic' | 'magic' | 'mystery' | 'iconic'>('basic');
  const [inventoryActiveClass, setInventoryActiveClass] = useState<'basic' | 'magic' | 'mystery' | 'iconic'>('basic');
  const [basePanelSize, setBasePanelSize] = useState({ width: 592, height: 720 }); // 538 widened 10% → 592 (extends right on open); height 600*1.2=720
  const [isResizing, setIsResizing] = useState(false);
  // Kinetik-style glow: fires on open, on drag-to-move, and on resize.
  const glow = useGlowPanel();
  const drag = usePanelDrag(glow.trigger);
  useEffect(() => { if (isOpen) glow.trigger(); }, [isOpen]); // eslint-disable-line react-hooks/exhaustive-deps

  // P2P Marketplace state
  const [p2pSubtab, setP2pSubtab] = useState<MarketplaceTab>('browse');
  const [p2pFilters, setP2pFilters] = useState<MarketplaceFilters>({});
  const [p2pSortOption, setP2pSortOption] = useState<MarketplaceSortOption>('date_desc');
  const { balance: diviBalance } = useDivi(user?.id ?? null);

  // Expand panel width when P2P tab is active
  const panelSize = {
    width: activeTab === 'p2p' ? Math.max(basePanelSize.width, 900) : basePanelSize.width,
    height: basePanelSize.height
  };
  // Usable height for tab content = panel height minus the fixed chrome above it:
  // p-6 top+bottom padding (48) + header (~28) + gap-4 (16) + TabsList h-10 (40) = 132.
  // The old hard-coded "- 104" under-counted by ~28px, so the bottom was clipped.
  const contentH = panelSize.height - 132;
  
  const coinImageUrl = currentTheme?.coin_image_url || '/waterfall_coin.png';
  const tokenDisplayName = currentTheme?.display_name || 'Waterfall';
  const { loadedChunksRef, worldRevision } = useBlocks();
  const { currentWorldId } = useCurrentWorldId();
  const { plantedTrees, myIncompleteTrees, seedDefinitions, refetch: refetchTrees } = useTreeData(currentWorldId, user?.id);
  
  // Combine all user's trees (fully grown + incomplete)
  const allUserTrees = useMemo(() => {
    const treeMap = new Map<string, typeof plantedTrees[0]>();
    plantedTrees.filter(t => t.planted_by === user?.id).forEach(t => treeMap.set(t.id, t));
    myIncompleteTrees.forEach(t => treeMap.set(t.id, t));
    return Array.from(treeMap.values());
  }, [plantedTrees, myIncompleteTrees, user?.id]);
  
  // Check if user has any seeds in inventory
  const hasSeedsInInventory = useMemo(() => {
    return seedDefinitions.some(sd => inventory.some(i => i.item_id === sd.id && i.quantity > 0));
  }, [seedDefinitions, inventory]);
  
  // Fruit data
  const { userFruits } = useFruitData(user?.id ?? null);

  // Show trees tab only if user has seeds OR planted trees
  const showTreesTab = hasSeedsInInventory || allUserTrees.length > 0;
  const showFruitsTab = true;
  
  // Track if we've loaded data at least once to avoid jarring loading screens
  const hasLoadedOnce = useRef(false);
  if (!isLoading && !loadingBlocks) {
    hasLoadedOnce.current = true;
  }
  
  // Refresh profile and tree data when panel opens to ensure data is current
  useEffect(() => {
    if (isOpen) {
      refreshData();
      refetchTrees();
    }
  }, [isOpen, refreshData, refetchTrees]);
  
  // Count placed blocks by type for current user
  // Phase 2: Iterate loadedChunksRef instead of flat blocks array
  const placedBlockCounts = useMemo(() => {
    const counts = new Map<string, number>();
    const ref = loadedChunksRef?.current;
    if (!ref) return counts;
    for (const chunkData of ref.values()) {
      for (const block of chunkData.blocks) {
        if (block.user_id === user?.id) {
          const count = counts.get(block.block_type) || 0;
          counts.set(block.block_type, count + 1);
        }
      }
    }
    return counts;
  }, [worldRevision, user?.id]);

  // Handle resize
  const handleResizeStart = (e: React.MouseEvent) => {
    e.preventDefault();
    setIsResizing(true);
    glow.trigger();

    const startX = e.clientX;
    const startY = e.clientY;
    const startWidth = basePanelSize.width;
    const startHeight = basePanelSize.height;

    // rAF-throttle so we update at most once per frame, not once per mousemove event.
    let rafPending = false;
    let curW = startWidth, curH = startHeight;
    const handleMouseMove = (moveEvent: MouseEvent) => {
      curW = Math.max(400, Math.min(1200, startWidth + (moveEvent.clientX - startX)));
      curH = Math.max(400, Math.min(900, startHeight + (moveEvent.clientY - startY)));
      if (rafPending) return;
      rafPending = true;
      requestAnimationFrame(() => {
        rafPending = false;
        setBasePanelSize({ width: curW, height: curH });
      });
    };

    const handleMouseUp = () => {
      setIsResizing(false);
      document.removeEventListener('mousemove', handleMouseMove);
      document.removeEventListener('mouseup', handleMouseUp);
    };

    document.addEventListener('mousemove', handleMouseMove);
    document.addEventListener('mouseup', handleMouseUp);
  };

  // Sync blockchain address with token balance
  useEffect(() => {
    if (tokenBalance?.blockchain_address) {
      setBlockchainAddress(tokenBalance.blockchain_address);
    } else {
      setBlockchainAddress('');
    }
  }, [tokenBalance?.blockchain_address]);

  // Reset the avatar load-error flag whenever the URL changes (new upload or backfill).
  useEffect(() => { setAvatarError(false); }, [profile?.avatar_url]);

  // Sync display name with profile
  useEffect(() => {
    if (profile?.display_name !== undefined) {
      setDisplayName(profile.display_name || '');
    }
  }, [profile?.display_name]);

  // Sync visual distance with profile
  useEffect(() => {
    if (profile?.visual_distance !== undefined) {
      setVisualDistance(profile.visual_distance);
    }
  }, [profile?.visual_distance]);

  // Sync fog enabled with profile
  useEffect(() => {
    if (profile?.fog_enabled !== undefined) {
      setFogEnabled(profile.fog_enabled);
    }
  }, [profile?.fog_enabled]);

  const handleAddressChange = (e: React.ChangeEvent<HTMLInputElement>) => {
    setBlockchainAddress(e.target.value);
  };

  const handleAddressBlur = async () => {
    if (blockchainAddress !== (tokenBalance?.blockchain_address || '')) {
      await updateBlockchainAddress(blockchainAddress);
    }
  };

  const handleVisualDistanceChange = async (value: number[]) => {
    const newDistance = value[0];
    setVisualDistance(newDistance); // Update local state immediately
    await updateVisualDistance(newDistance); // Save to database
  };

  const handleFogToggle = async (checked: boolean) => {
    setFogEnabled(checked); // Update local state immediately
    await updateFogEnabled(checked); // Save to database
  };

  const handleDisplayNameBlur = async () => {
    if (displayName !== (profile?.display_name || '')) {
      await updateDisplayName(displayName);
    }
  };

  const handleDisplayNameKeyDown = (e: React.KeyboardEvent) => {
    if (e.key === 'Enter') {
      (e.target as HTMLInputElement).blur();
    }
  };

  const handleAvatarUpload = async (e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0];
    if (!file || !user?.id) return;

    setAvatarUploading(true);
    try {
      // For animated GIFs, upload directly without canvas processing
      const isGif = file.type === 'image/gif';

      let blob: Blob;
      if (isGif) {
        blob = file;
      } else {
        // Load image into canvas, crop to square, resize to 256x256, export as webp
        const img = await new Promise<HTMLImageElement>((resolve, reject) => {
          const i = new Image();
          i.onload = () => resolve(i);
          i.onerror = reject;
          i.src = URL.createObjectURL(file);
        });

        const size = Math.min(img.width, img.height);
        const sx = (img.width - size) / 2;
        const sy = (img.height - size) / 2;

        const canvas = document.createElement('canvas');
        canvas.width = 256;
        canvas.height = 256;
        const ctx = canvas.getContext('2d')!;
        ctx.drawImage(img, sx, sy, size, size, 0, 0, 256, 256);

        blob = await new Promise<Blob>((resolve) => {
          canvas.toBlob((b) => resolve(b!), 'image/webp', 0.85);
        });
      }

      const ext = isGif ? 'gif' : 'webp';
      const path = `avatar_${user.id}_${Date.now()}.${ext}`;

      const { error: uploadError } = await supabase.storage
        .from('block-textures')
        .upload(path, blob, { upsert: true, contentType: isGif ? 'image/gif' : 'image/webp' });

      if (uploadError) throw uploadError;

      const { data: urlData } = supabase.storage
        .from('block-textures')
        .getPublicUrl(path);

      await updateAvatarUrl(urlData.publicUrl);
    } catch (err: any) {
      console.error('User image upload failed:', err);
    } finally {
      setAvatarUploading(false);
      // Reset input so same file can be re-selected
      if (avatarInputRef.current) avatarInputRef.current.value = '';
    }
  };

  const handleBuyBlock = async (itemKey: string, cost: number) => {
    const success = await buyBlock(itemKey, cost);
    if (success) {
      // Play single coin sound
      playSound(getSoundUrl('coin_hit', '/coin_hit_sound.mp3'), 0.3);

      onBlockPurchased?.();
    }
  };

  const getBlockQuantity = (itemKey: string) => {
    return getInventoryQuantity(inventory, itemKey);
  };

  // Only show loading on initial load, not during purchases/refreshes
  if ((isLoading || loadingBlocks) && !hasLoadedOnce.current) {
    return (
      <Dialog open={isOpen} onOpenChange={closePanel}>
        <DialogContent className="max-w-2xl">
          <DialogHeader>
            <DialogTitle>Loading...</DialogTitle>
          </DialogHeader>
          <div className="p-4 text-center">Loading...</div>
        </DialogContent>
      </Dialog>
    );
  }

  return (
    <Dialog open={isOpen} onOpenChange={closePanel}>
      <DialogContent
        ref={(node: HTMLDivElement | null) => {
          drag.panelRef.current = node;
          if (node) {
            node.style.setProperty('background', 'hsla(var(--hud-bg))', 'important');
            node.style.setProperty('border', '1px solid hsla(var(--hud-border))', 'important');
            node.style.setProperty('border-radius', '6px', 'important');
          }
        }}
        className="user-panel-dialog relative overflow-hidden flex flex-col"
        style={{
          width: `${panelSize.width}px`,
          height: `${panelSize.height}px`,
          maxWidth: activeTab === 'p2p' ? '1200px' : '800px',
          maxHeight: '90vh',
          // No width transition or backdrop-blur while actively resizing — both make
          // the panel lag/jitter behind the cursor; restored on release.
          transition: isResizing ? 'none' : `width 0.3s ease-out, max-width 0.3s ease-out, ${glow.glowTransition}`,
          boxShadow: glow.boxShadow,
          border: '1px solid hsla(var(--hud-border))',
          borderRadius: 'var(--hud-radius)',
          backdropFilter: isResizing ? 'none' : 'var(--hud-blur)',
          WebkitBackdropFilter: isResizing ? 'none' : 'var(--hud-blur)',
          color: 'hsl(var(--hud-text))',
          fontFamily: 'var(--hud-font)',
          ...drag.dragStyle,
        }}
      >
        <PanelGrabBar onMouseDown={drag.onHeaderMouseDown} />
        <DialogHeader className="flex-shrink-0 relative" style={{ cursor: 'move' }} onMouseDown={drag.onHeaderMouseDown}>
          <DialogTitle className="flex items-center gap-2" style={{ color: 'hsl(var(--hud-text-bright))' }}>
            <img src={coinImageUrl} alt="coin" className="w-6 h-6" />
            User Panel - {tokenDisplayName}: {tokenBalance?.coins || 0}
          </DialogTitle>
        </DialogHeader>

        <Tabs value={activeTab} onValueChange={(value) => setActiveTab(value as any)} className="relative">
          <TabsList className={`grid w-full ${showTreesTab && showFruitsTab ? 'grid-cols-11' : showTreesTab || showFruitsTab ? 'grid-cols-10' : 'grid-cols-9'}`} style={{ background: 'hsla(var(--hud-bg-dim))', borderRadius: 'var(--hud-radius)' }}>
            <TabsTrigger value="user">User</TabsTrigger>
            <TabsTrigger value="tribe">Tribe</TabsTrigger>
            <TabsTrigger value="wallet">Wallet</TabsTrigger>
            <TabsTrigger value="items">Items</TabsTrigger>
            <TabsTrigger value="kills">Kills</TabsTrigger>
            <TabsTrigger value="blocks">Blocks</TabsTrigger>
            <TabsTrigger value="market">Store</TabsTrigger>
            <TabsTrigger value="p2p">P2P</TabsTrigger>
            <TabsTrigger value="leaders">Leaders</TabsTrigger>
            {showTreesTab && <TabsTrigger value="trees">Trees</TabsTrigger>}
            {showFruitsTab && <TabsTrigger value="fruits">Fruits</TabsTrigger>}
          </TabsList>

          {/* User Tab */}
          <TabsContent 
            value="user" 
            className="space-y-4 overflow-y-auto" 
            style={{ 
              height: `${contentH}px`,
              marginTop: 0,
              paddingTop: '1rem'
            }}
          >
            <Card className="p-4">
              <div className="flex gap-4">
                {/* Left: Name + Email */}
                <div className="flex-1 space-y-3">
                  <div className="space-y-1">
                    <Label className="text-sm font-medium">User Name</Label>
                    <Input
                      value={displayName}
                      onChange={(e) => setDisplayName(e.target.value)}
                      onBlur={handleDisplayNameBlur}
                      onKeyDown={handleDisplayNameKeyDown}
                      placeholder="Enter display name..."
                      className="h-8"
                    />
                  </div>
                  <div className="space-y-1">
                    <Label className="text-sm font-medium">Email</Label>
                    <div className="flex items-center justify-between gap-2">
                      <div className="text-sm font-semibold truncate">{user?.email || 'Not logged in'}</div>
                      <Button
                        variant="outline"
                        size="sm"
                        className="h-7 shrink-0"
                        onClick={signOut}
                      >
                        Log out
                      </Button>
                    </div>
                  </div>
                </div>

                {/* Right: User Image */}
                <div className="flex flex-col items-center gap-1">
                  <div
                    onClick={() => avatarInputRef.current?.click()}
                    className="cursor-pointer relative"
                    title="Click to upload user image"
                    style={{
                      width: '80px',
                      height: '80px',
                      borderRadius: '50%',
                      overflow: 'hidden',
                      border: '2px solid hsla(var(--hud-border))',
                      background: 'hsla(var(--hud-bg-dim))',
                      display: 'flex',
                      alignItems: 'center',
                      justifyContent: 'center',
                    }}
                  >
                    {profile?.avatar_url && !avatarError ? (
                      <img
                        src={profile.avatar_url}
                        alt="User Image"
                        referrerPolicy="no-referrer"
                        onError={() => setAvatarError(true)}
                        style={{ width: '100%', height: '100%', objectFit: 'cover' }}
                      />
                    ) : (
                      <svg width="32" height="32" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round" style={{ opacity: 0.4 }}>
                        <path d="M23 19a2 2 0 0 1-2 2H3a2 2 0 0 1-2-2V8a2 2 0 0 1 2-2h4l2-3h6l2 3h4a2 2 0 0 1 2 2z"/>
                        <circle cx="12" cy="13" r="4"/>
                      </svg>
                    )}
                    {avatarUploading && (
                      <div style={{
                        position: 'absolute',
                        inset: 0,
                        background: 'hsla(var(--overlay-dark))',
                        display: 'flex',
                        alignItems: 'center',
                        justifyContent: 'center',
                        color: 'white',
                        fontSize: '11px',
                      }}>
                        Uploading...
                      </div>
                    )}
                  </div>
                  <input
                    ref={avatarInputRef}
                    type="file"
                    accept="image/jpeg,image/gif,image/webp,image/png"
                    onChange={handleAvatarUpload}
                    style={{ display: 'none' }}
                  />
                </div>
              </div>
            </Card>

            {/* Level — points + level, with a collapsible (default-collapsed) full ladder */}
            <LevelTab totalPoints={profile?.total_points || 0} />

            {/* Support Level — token/NFT-gated or subscription tiers (docs/SUPPORTER_TIERS_PLAN.md) */}
            <SupportLevelPanel userId={user?.id ?? null} />

            <Card className="p-4">
              <div className="space-y-3">
                <div className="flex items-center justify-between">
                  <Label className="text-sm font-medium">Visual Distance</Label>
                  <span className="text-sm font-semibold text-muted-foreground">
                    {visualDistance} chunks ({visualDistance * 16} blocks)
                  </span>
                </div>
                <Slider
                  value={[visualDistance]}
                  onValueChange={handleVisualDistanceChange}
                  min={1}
                  max={20}
                  step={1}
                  className="w-full"
                />
                <p className="text-xs text-muted-foreground">
                  Controls how far you can see. Lower = better performance.
                </p>
              </div>
            </Card>

            <Card className="p-4">
              <div className="space-y-3">
                <div className="flex items-center justify-between">
                  <Label className="text-sm font-medium">Field of View</Label>
                  <span className="text-sm font-semibold text-muted-foreground">
                    {fov}°{fov === FOV_DEFAULT ? ' (default)' : ''}
                  </span>
                </div>
                <Slider
                  value={[fov]}
                  onValueChange={(v) => setBaseFov(v[0])}
                  min={FOV_MIN}
                  max={FOV_MAX}
                  step={1}
                  className="w-full"
                />
                <p className="text-xs text-muted-foreground">
                  Lower = more zoomed in, less edge distortion (enemies look closer to their true distance). Higher = wider view.
                </p>
              </div>
            </Card>

            <Card className="p-4">
              <div className="flex items-center justify-between">
                <div className="space-y-1">
                  <Label htmlFor="fog-toggle" className="text-sm font-medium">
                    Distance Fog
                  </Label>
                  <p className="text-xs text-muted-foreground">
                    Gradually fade distant blocks to grey
                  </p>
                </div>
                <Switch
                  id="fog-toggle"
                  checked={fogEnabled}
                  onCheckedChange={handleFogToggle}
                />
              </div>
            </Card>
          </TabsContent>

          {/* Tribe Tab — placeholder (feature in progress) */}
          <TabsContent
            value="tribe"
            className="overflow-y-auto"
            style={{
              height: `${contentH}px`,
              marginTop: 0,
              paddingTop: '1rem'
            }}
          >
            <Card className="p-6 text-center" style={{ background: 'hsla(var(--hud-bg-dim))' }}>
              <div className="text-base font-semibold mb-1" style={{ color: 'hsl(var(--hud-text-bright))' }}>
                Tribes
              </div>
              <p className="text-sm text-muted-foreground">
                Create or join a tribe to build together. Coming soon.
              </p>
            </Card>
          </TabsContent>

          {/* Wallet Tab */}
          <TabsContent 
            value="wallet" 
            className="space-y-4 overflow-y-auto" 
            style={{ 
              height: `${contentH}px`,
              marginTop: 0,
              paddingTop: '1rem'
            }}
          >
            {/* GAME WALLET (admin/superadmin only): the game's pool reserves + deposit addresses. */}
            {(userRoles.includes('admin') || userRoles.includes('superadmin')) && <GameWalletPanel />}

            {/* Multi-coin holdings: every coin/token/points the player holds, grouped chain-first
                (docs/CURRENCY_LEDGER_PLAN.md). */}
            <WalletList userId={user?.id ?? null} />

            {/* Wax / Alien Worlds wallet, embedded from LW-SSO (docs/WAX_WALLET_IFRAME_PLAN.md).
                Per-user: loads the linked Wax account, captures it from the iframe on connect. */}
            <WaxWalletPanel userId={user?.id ?? null} />

            {/* Link Ethereum + Divi addresses so the holdings sync can verify on-chain tokens/NFTs
                for token-gating + supporter tiers (Wax is linked via the embed above). */}
            <ExternalWalletsPanel userId={user?.id ?? null} />

            <Card className="p-4">
              <div className="space-y-2">
                <Label htmlFor="blockchain-address" className="text-sm font-medium">
                  {tokenDisplayName} Blockchain Address
                </Label>
                <Input
                  id="blockchain-address"
                  type="text"
                  placeholder="0x...."
                  value={blockchainAddress}
                  onChange={handleAddressChange}
                  onBlur={handleAddressBlur}
                  onKeyDown={(e) => {
                    if (e.key === 'Enter') {
                      e.preventDefault();
                      handleAddressBlur();
                      e.currentTarget.blur();
                    }
                  }}
                  className="placeholder:text-muted-foreground/50"
                />
              </div>
            </Card>
          </TabsContent>

          {/* Items Tab */}
          <TabsContent
            value="items"
            style={{
              height: `${contentH}px`,
              marginTop: 0,
              paddingTop: '1rem'
            }}
          >
            <ItemsTab height={contentH} />
          </TabsContent>

          {/* Kills Tab */}
          <TabsContent
            value="kills"
            style={{
              height: `${contentH}px`,
              marginTop: 0,
              paddingTop: '1rem'
            }}
          >
            <KillsTab height={contentH} />
          </TabsContent>

          {/* Blocks Tab (formerly Inventory) */}
          <TabsContent 
            value="blocks"
            style={{ 
              height: `${contentH}px`,
              marginTop: 0,
              paddingTop: '1rem'
            }}
          >
            <Tabs value={inventoryActiveClass} onValueChange={(v) => setInventoryActiveClass(v as any)}>
              <TabsList className="grid w-full grid-cols-4">
                <TabsTrigger value="basic">BASIC</TabsTrigger>
                <TabsTrigger value="magic">MAGIC</TabsTrigger>
                <TabsTrigger value="mystery">MYSTERY</TabsTrigger>
                <TabsTrigger value="iconic">ICONIC</TabsTrigger>
              </TabsList>
              
              <TabsContent
                value={inventoryActiveClass}
                style={{
                  marginTop: 0,
                  paddingTop: '1rem'
                }}
              >
                <ScrollArea style={{ height: `${contentH - 56}px` }}>
                <div className="space-y-2 pr-4">
                {(() => {
                  const blocksInClass = availableBlocks
                    .filter(block => {
                      if (block.class !== inventoryActiveClass) return false;
                      const inventoryCount = getInventoryQuantity(inventory, block.key);
                      const placedCount = placedBlockCounts.get(block.key) || 0;
                      return inventoryCount > 0 || placedCount > 0;
                    })
                    .sort((a, b) => {
                      // Mystery blocks: sort by tier only
                      if (inventoryActiveClass === 'mystery') {
                        return a.tier - b.tier;
                      }
                      // Other classes: sort by cost (cheapest first), then by tier
                      if (a.cost !== b.cost) {
                        return a.cost - b.cost;
                      }
                      return a.tier - b.tier;
                    });

                  if (blocksInClass.length === 0) {
                    return (
                      <Card className="p-4 text-center text-muted-foreground">
                        No blocks in this class
                      </Card>
                    );
                  }

                  return blocksInClass.map((block) => {
                    const inventoryCount = getInventoryQuantity(inventory, block.key);
                    const placedCount = placedBlockCounts.get(block.key) || 0;

                    return (
                      <Card key={block.key} className="p-3">
                        <div className="flex items-center gap-3">
                          <BlockIcon block={block} />

                          <div className="flex-1 min-w-0">
                            <div className="flex items-center gap-2 mb-1">
                              <h3 className="font-semibold truncate">{block.name}</h3>
                              <Badge
                                variant="secondary"
                                className={`text-xs ${getRarityColor(block.rarity)}`}
                              >
                                {block.rarity}
                              </Badge>
                            </div>
                            <div className="flex items-center gap-2 flex-wrap">
                              <Badge variant="outline" className="text-xs">
                                {block.category}
                              </Badge>
                              <Badge variant="outline" className="text-xs">
                                Tier {block.tier}
                              </Badge>
                            </div>
                          </div>

                          <div className="text-right flex-shrink-0 text-xs space-y-1">
                            <div className="flex items-center gap-2">
                              <span className="text-muted-foreground">Inventory:</span>
                              <span className="font-semibold">{inventoryCount}</span>
                            </div>
                            <div className="flex items-center gap-2">
                              <span className="text-muted-foreground">Placed:</span>
                              <span className="font-semibold">{placedCount}</span>
                            </div>
                          </div>
                        </div>
                      </Card>
                    );
                  });
                })()}
                </div>
                </ScrollArea>
              </TabsContent>
            </Tabs>
          </TabsContent>

          {/* Market Tab (formerly Store) */}
          <TabsContent 
            value="market"
            style={{ 
              height: `${contentH}px`,
              marginTop: 0,
              paddingTop: '1rem'
            }}
          >
            {loadingBlocks ? (
              <Card className="p-4 text-center text-muted-foreground">
                Loading blocks...
              </Card>
            ) : availableBlocks.length === 0 ? (
              <Card className="p-4 text-center text-muted-foreground">
                No blocks available in store
              </Card>
            ) : (
              <Tabs value={storeActiveClass} onValueChange={(v) => setStoreActiveClass(v as any)}>
                <TabsList className="grid w-full grid-cols-4">
                  <TabsTrigger value="basic">BASIC</TabsTrigger>
                  <TabsTrigger value="magic">MAGIC</TabsTrigger>
                  <TabsTrigger value="mystery">MYSTERY</TabsTrigger>
                  <TabsTrigger value="iconic">ICONIC</TabsTrigger>
                </TabsList>
                
                <TabsContent
                  value={storeActiveClass}
                  style={{
                    marginTop: 0,
                    paddingTop: '1rem'
                  }}
                >
                  <ScrollArea style={{ height: `${contentH - 56}px` }}>
                  <div className="space-y-4 pr-4">
                  {availableBlocks
                    .filter(block => block.class === storeActiveClass)
                    .sort((a, b) => {
                      // Mystery blocks: sort by tier only
                      if (storeActiveClass === 'mystery') {
                        return a.tier - b.tier;
                      }
                      // Other classes: sort by cost (cheapest first), then by tier
                      if (a.cost !== b.cost) {
                        return a.cost - b.cost;
                      }
                      return a.tier - b.tier;
                    })
                    .map((block) => (
                    <Card key={block.key} className="p-4 hover:shadow-md transition-shadow">
                      <div className="flex items-center gap-3">
                        <BlockIcon block={block} />

                        <div className="flex-1 min-w-0">
                          <div className="flex items-center gap-2 mb-1">
                            <h3 className="font-semibold truncate">{block.name}</h3>
                            <Badge
                              variant="secondary"
                              className={`text-xs ${getRarityColor(block.rarity)}`}
                            >
                              {block.rarity}
                            </Badge>
                          </div>

                          <p className="text-xs text-muted-foreground mb-2 line-clamp-2">
                            {block.description}
                          </p>

                          <div className="flex items-center gap-2 flex-wrap">
                            <img src={coinImageUrl} alt="coin" className="w-4 h-4" />
                            <span className="text-sm font-medium">{block.cost} coins</span>
                            <Badge variant="outline" className="text-xs">
                              {block.category}
                            </Badge>
                            <Badge variant="outline" className="text-xs">
                              Tier {block.tier}
                            </Badge>
                            <Badge variant="outline" className="text-xs">
                              {block.class.toUpperCase()}
                            </Badge>
                          </div>
                        </div>

                        <div className="text-center flex-shrink-0">
                          <div className="text-xs text-muted-foreground mb-2">
                            Owned: {getBlockQuantity(block.key)}
                          </div>
                            <Button
                              size="sm"
                              onClick={() => handleBuyBlock(block.key, block.cost)}
                              disabled={!tokenBalance || tokenBalance.coins < block.cost}
                              className="min-w-[60px]"
                            >
                              Buy
                            </Button>
                        </div>
                      </div>
                    </Card>
                  ))}
                  </div>
                  </ScrollArea>
              </TabsContent>
            </Tabs>
          )}
        </TabsContent>

          {/* Trees Tab - Only shown if user has seeds or trees */}
          {showTreesTab && (
            <TabsContent
              value="trees"
              style={{
                height: `${contentH}px`,
                marginTop: 0,
                paddingTop: '1rem'
              }}
            >
              <TreesTab
                height={contentH}
                inventory={inventory}
                seedDefinitions={seedDefinitions}
                plantedTrees={allUserTrees}
              />
            </TabsContent>
          )}

          {/* P2P Marketplace Tab */}
          <TabsContent
            value="p2p"
            style={{
              height: `${contentH}px`,
              marginTop: 0,
              paddingTop: '1rem'
            }}
          >
            <div className="flex flex-col h-full">
              {/* DIVI Balance header */}
              <div className="flex justify-end mb-2">
                <DiviBalance balance={diviBalance} />
              </div>

              {/* P2P Sub-tabs */}
              <Tabs
                value={p2pSubtab}
                onValueChange={(v) => {
                  setP2pSubtab(v as MarketplaceTab);
                  if (v !== 'browse') setP2pFilters({});
                }}
                className="flex-1 flex flex-col overflow-hidden"
              >
                <TabsList className="grid w-full grid-cols-5" style={{ background: 'hsla(var(--hud-bg-dim))', borderRadius: 'var(--hud-radius)' }}>
                  <TabsTrigger value="browse">Browse</TabsTrigger>
                  <TabsTrigger value="my-listings">My Listings</TabsTrigger>
                  <TabsTrigger value="my-store">My Store</TabsTrigger>
                  <TabsTrigger value="history">History</TabsTrigger>
                  <TabsTrigger value="watchlist">Watchlist</TabsTrigger>
                </TabsList>

                <TabsContent value="browse" className="flex-1 overflow-hidden mt-0 pt-4" style={{ height: `${contentH - 96}px` }}>
                  <BrowseTab
                    filters={p2pFilters}
                    setFilters={setP2pFilters}
                    sortOption={p2pSortOption}
                    setSortOption={setP2pSortOption}
                    userId={user?.id ?? null}
                    userBalance={diviBalance}
                  />
                </TabsContent>

                <TabsContent value="my-listings" className="flex-1 overflow-hidden mt-0 pt-4" style={{ height: `${contentH - 96}px` }}>
                  <MyListingsTab userId={user?.id ?? null} />
                </TabsContent>

                <TabsContent value="my-store" className="flex-1 overflow-hidden mt-0 pt-4" style={{ height: `${contentH - 96}px` }}>
                  <MyStoreTab userId={user?.id ?? null} />
                </TabsContent>

                <TabsContent value="history" className="flex-1 overflow-hidden mt-0 pt-4" style={{ height: `${contentH - 96}px` }}>
                  <TransactionHistoryTab userId={user?.id ?? null} />
                </TabsContent>

                <TabsContent value="watchlist" className="flex-1 overflow-hidden mt-0 pt-4" style={{ height: `${contentH - 96}px` }}>
                  <WatchlistTab userId={user?.id ?? null} userBalance={diviBalance} />
                </TabsContent>
              </Tabs>
            </div>
          </TabsContent>

          {showFruitsTab && (
            <TabsContent
              value="fruits"
              style={{
                height: `${contentH}px`,
                marginTop: 0,
                paddingTop: '1rem'
              }}
            >
              <FruitsTab
                height={contentH}
                userFruits={userFruits}
                userId={user?.id ?? null}
                isAdmin={userRoles.includes('admin') || userRoles.includes('superadmin')}
              />
            </TabsContent>
          )}

          <TabsContent
            value="leaders"
            className="overflow-y-auto"
            style={{
              height: `${contentH}px`,
              marginTop: 0,
              paddingTop: '1rem'
            }}
          >
            <LeaderboardsPanel />
          </TabsContent>
      </Tabs>
        
        {/* Resize Handle */}
        <div
          className="absolute bottom-0 right-0 w-4 h-4 cursor-se-resize"
          onMouseDown={handleResizeStart}
          style={{
            zIndex: 3,
            background: 'linear-gradient(135deg, transparent 50%, currentColor 50%)',
            opacity: isResizing ? 0.8 : 0.3,
            transition: 'opacity 0.2s'
          }}
          onMouseEnter={(e) => e.currentTarget.style.opacity = '0.6'}
          onMouseLeave={(e) => {
            if (!isResizing) e.currentTarget.style.opacity = '0.3';
          }}
        />
      </DialogContent>
    </Dialog>
  );
};
