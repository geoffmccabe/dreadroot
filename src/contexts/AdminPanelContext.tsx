import React, { createContext, useContext, useState, useRef, ReactNode } from 'react';
import type { FlameDemoHandle } from '@/components/fortress/FlameDemoSpawner';

type AdminTab = 'coins' | 'billboards' | 'weather' | 'models' | 'users' | 'blocks' | 'seeds' | 'worlds' | 'npcs' | 'items' | 'effects';

// Subtab types for NPCs panel
export type NPCSubtab = 'enemies' | 'friends' | 'pathfinding';

// Subtab types for Seeds panel
export type SeedSubtab = 'ordinary' | 'wide' | 'fungal';

// Subtab types for Items panel
export type ItemsSubtab = 'all-items' | 'weapons-items' | 'bullets' | 'drop-tables';

// Subtab types for Worlds panel
export type WorldsSubtab = 'settings' | 'worlds' | 'fix' | 'atlas' | 'view';

interface AdminPanelContextType {
  isOpen: boolean;
  activeTab: AdminTab;
  openPanel: (tab?: AdminTab) => void;
  closePanel: () => void;
  setActiveTab: (tab: AdminTab) => void;
  flameDemoRef: React.MutableRefObject<FlameDemoHandle | null>;
  fruitVisibility: boolean;
  setFruitVisibility: (v: boolean) => void;
}

const AdminPanelContext = createContext<AdminPanelContextType | undefined>(undefined);

export const AdminPanelProvider: React.FC<{ children: ReactNode }> = ({ children }) => {
  const [isOpen, setIsOpen] = useState(false);
  const [activeTab, setActiveTab] = useState<AdminTab>('coins');
  const flameDemoRef = useRef<FlameDemoHandle | null>(null);
  const [fruitVisibility, setFruitVisibility] = useState(true);

  const openPanel = (tab: AdminTab = 'coins') => {
    setActiveTab(tab);
    setIsOpen(true);
    // Exit pointer lock when opening panel so user can interact with it
    if (document.pointerLockElement) {
      document.exitPointerLock();
    }
  };

  const closePanel = () => {
    setIsOpen(false);
  };

  return (
    <AdminPanelContext.Provider value={{ isOpen, activeTab, openPanel, closePanel, setActiveTab, flameDemoRef, fruitVisibility, setFruitVisibility }}>
      {children}
    </AdminPanelContext.Provider>
  );
};

export const useAdminPanel = () => {
  const context = useContext(AdminPanelContext);
  if (!context) {
    throw new Error('useAdminPanel must be used within AdminPanelProvider');
  }
  return context;
};
