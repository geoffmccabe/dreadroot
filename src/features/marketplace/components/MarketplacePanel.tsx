// MarketplacePanel - Main dialog for P2P marketplace

import React, { useState, useEffect, useRef } from 'react';
import { Dialog, DialogContent, DialogHeader, DialogTitle } from '@/components/ui/dialog';
import { Tabs, TabsContent, TabsList, TabsTrigger } from '@/components/ui/tabs';
import { useAuth } from '@/contexts/AuthContext';
import { useDivi } from '../hooks/useDivi';
import { formatDivi } from '../types';
import type { MarketplaceTab, MarketplaceFilters, MarketplaceSortOption } from '../types';
import { BrowseTab } from './BrowseTab';
import { MyListingsTab } from './MyListingsTab';
import { MyStoreTab } from './MyStoreTab';
import { TransactionHistoryTab } from './TransactionHistoryTab';
import { WatchlistTab } from './WatchlistTab';
import { DiviBalance } from './DiviBalance';

interface MarketplacePanelProps {
  isOpen: boolean;
  onClose: () => void;
}

export function MarketplacePanel({ isOpen, onClose }: MarketplacePanelProps) {
  const { user } = useAuth();
  const { balance, isLoading: diviLoading } = useDivi(user?.id ?? null);
  const [activeTab, setActiveTab] = useState<MarketplaceTab>('browse');
  const [filters, setFilters] = useState<MarketplaceFilters>({});
  const [sortOption, setSortOption] = useState<MarketplaceSortOption>('date_desc');
  const [panelSize, setPanelSize] = useState({ width: 900, height: 720 });
  const [isResizing, setIsResizing] = useState(false);
  const hasLoadedOnce = useRef(false);

  // Reset filters when tab changes
  useEffect(() => {
    if (activeTab !== 'browse') {
      setFilters({});
    }
  }, [activeTab]);

  // Handle resize
  const handleResizeStart = (e: React.MouseEvent) => {
    e.preventDefault();
    setIsResizing(true);

    const startX = e.clientX;
    const startY = e.clientY;
    const startWidth = panelSize.width;
    const startHeight = panelSize.height;

    const handleMouseMove = (moveEvent: MouseEvent) => {
      const deltaX = moveEvent.clientX - startX;
      const deltaY = moveEvent.clientY - startY;

      setPanelSize({
        width: Math.max(600, Math.min(1200, startWidth + deltaX)),
        height: Math.max(500, Math.min(900, startHeight + deltaY)),
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

  // Track if we've attempted to load at least once (don't block on errors)
  useEffect(() => {
    if (!diviLoading) {
      hasLoadedOnce.current = true;
    }
  }, [diviLoading]);


  // Only show loading screen on first load, and only briefly
  // Don't block the panel from opening if there's an error
  if (diviLoading && !hasLoadedOnce.current && isOpen) {
    // Still render the dialog but with loading state
    return (
      <Dialog open={isOpen} onOpenChange={(open) => !open && onClose()}>
        <DialogContent
          ref={(node: HTMLDivElement | null) => {
            if (node) {
              node.style.setProperty('background', 'hsla(211, 30%, 35%, 0.95)', 'important');
              node.style.setProperty('border', '1px solid hsla(211, 34%, 73%, 0.8)', 'important');
              node.style.setProperty('border-radius', '6px', 'important');
              node.style.setProperty('z-index', '99999', 'important');
            }
          }}
          onPointerDownOutside={(e) => e.preventDefault()}
          onInteractOutside={(e) => e.preventDefault()}
          className="max-w-4xl"
          style={{
            backdropFilter: 'blur(10px)',
            color: 'white',
            zIndex: 99999,
          }}
        >
          <DialogHeader>
            <DialogTitle style={{ color: 'white' }}>Loading Marketplace...</DialogTitle>
          </DialogHeader>
          <div className="p-8 text-center" style={{ color: 'rgba(255,255,255,0.7)' }}>Loading your DIVI balance...</div>
        </DialogContent>
      </Dialog>
    );
  }

  return (
    <Dialog open={isOpen} onOpenChange={(open) => !open && onClose()}>
      <DialogContent
        ref={(node: HTMLDivElement | null) => {
          if (node) {
            // Force solid background and high visibility for debugging
            node.style.setProperty('background', '#2a4a6a', 'important');
            node.style.setProperty('border', '3px solid red', 'important');
            node.style.setProperty('border-radius', '6px', 'important');
            node.style.setProperty('width', `${panelSize.width}px`, 'important');
            node.style.setProperty('max-width', '1200px', 'important');
            node.style.setProperty('height', `${panelSize.height}px`, 'important');
            node.style.setProperty('max-height', '90vh', 'important');
            node.style.setProperty('z-index', '99999', 'important');
            node.style.setProperty('position', 'fixed', 'important');
            node.style.setProperty('left', '50%', 'important');
            node.style.setProperty('top', '50%', 'important');
            node.style.setProperty('transform', 'translate(-50%, -50%)', 'important');
          }
        }}
        onPointerDownOutside={(e) => e.preventDefault()}
        onInteractOutside={(e) => e.preventDefault()}
        className="marketplace-panel-dialog relative overflow-hidden flex flex-col"
        style={{
          backdropFilter: 'blur(10px)',
          WebkitBackdropFilter: 'blur(10px)',
          color: 'white',
          fontFamily: 'var(--hud-font)',
          zIndex: 99999,
          position: 'fixed',
        }}
      >
        <DialogHeader className="flex-shrink-0 relative">
          <DialogTitle
            className="flex items-center justify-between gap-2"
            style={{ color: 'hsl(var(--hud-text-bright))' }}
          >
            <div className="flex items-center gap-2">
              <span className="text-xl">Marketplace</span>
            </div>
            <DiviBalance balance={balance} />
          </DialogTitle>
        </DialogHeader>

        <Tabs
          value={activeTab}
          onValueChange={(value) => setActiveTab(value as MarketplaceTab)}
          className="flex-1 flex flex-col overflow-hidden"
        >
          <TabsList
            className="grid w-full grid-cols-5"
            style={{
              background: 'hsla(var(--hud-bg-dim))',
              borderRadius: 'var(--hud-radius)',
            }}
          >
            <TabsTrigger value="browse">Browse</TabsTrigger>
            <TabsTrigger value="my-listings">My Listings</TabsTrigger>
            <TabsTrigger value="my-store">My Store</TabsTrigger>
            <TabsTrigger value="history">History</TabsTrigger>
            <TabsTrigger value="watchlist">Watchlist</TabsTrigger>
          </TabsList>

          <TabsContent
            value="browse"
            className="flex-1 overflow-hidden mt-0 pt-4"
            style={{ height: `${panelSize.height - 120}px` }}
          >
            <BrowseTab
              filters={filters}
              setFilters={setFilters}
              sortOption={sortOption}
              setSortOption={setSortOption}
              userId={user?.id ?? null}
              userBalance={balance}
            />
          </TabsContent>

          <TabsContent
            value="my-listings"
            className="flex-1 overflow-hidden mt-0 pt-4"
            style={{ height: `${panelSize.height - 120}px` }}
          >
            <MyListingsTab userId={user?.id ?? null} />
          </TabsContent>

          <TabsContent
            value="my-store"
            className="flex-1 overflow-hidden mt-0 pt-4"
            style={{ height: `${panelSize.height - 120}px` }}
          >
            <MyStoreTab userId={user?.id ?? null} />
          </TabsContent>

          <TabsContent
            value="history"
            className="flex-1 overflow-hidden mt-0 pt-4"
            style={{ height: `${panelSize.height - 120}px` }}
          >
            <TransactionHistoryTab userId={user?.id ?? null} />
          </TabsContent>

          <TabsContent
            value="watchlist"
            className="flex-1 overflow-hidden mt-0 pt-4"
            style={{ height: `${panelSize.height - 120}px` }}
          >
            <WatchlistTab userId={user?.id ?? null} userBalance={balance} />
          </TabsContent>
        </Tabs>

        {/* Resize handle */}
        <div
          className="absolute bottom-0 right-0 w-4 h-4 cursor-se-resize opacity-50 hover:opacity-100"
          onMouseDown={handleResizeStart}
          style={{
            background: 'linear-gradient(135deg, transparent 50%, hsl(var(--hud-text)) 50%)',
          }}
        />
      </DialogContent>
    </Dialog>
  );
}
