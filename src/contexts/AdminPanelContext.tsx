import React, { createContext, useContext, useState, ReactNode } from 'react';

type AdminTab = 'coins' | 'billboards' | 'weather' | 'models' | 'users' | 'blocks' | 'worlds';

interface AdminPanelContextType {
  isOpen: boolean;
  activeTab: AdminTab;
  openPanel: (tab?: AdminTab) => void;
  closePanel: () => void;
  setActiveTab: (tab: AdminTab) => void;
}

const AdminPanelContext = createContext<AdminPanelContextType | undefined>(undefined);

export const AdminPanelProvider: React.FC<{ children: ReactNode }> = ({ children }) => {
  const [isOpen, setIsOpen] = useState(false);
  const [activeTab, setActiveTab] = useState<AdminTab>('coins');

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
    <AdminPanelContext.Provider value={{ isOpen, activeTab, openPanel, closePanel, setActiveTab }}>
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
