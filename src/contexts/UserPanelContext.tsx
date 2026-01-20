import React, { createContext, useContext, useState, ReactNode } from 'react';

type PanelTab = 'user' | 'level' | 'wallet' | 'kills' | 'blocks' | 'market' | 'trees';

interface UserPanelContextType {
  isOpen: boolean;
  activeTab: PanelTab;
  openPanel: (tab?: PanelTab) => void;
  closePanel: () => void;
  setActiveTab: (tab: PanelTab) => void;
}

const UserPanelContext = createContext<UserPanelContextType | undefined>(undefined);

export const UserPanelProvider: React.FC<{ children: ReactNode }> = ({ children }) => {
  const [isOpen, setIsOpen] = useState(false);
  const [activeTab, setActiveTab] = useState<PanelTab>('user');

  const openPanel = (tab: PanelTab = 'user') => {
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
    <UserPanelContext.Provider value={{ isOpen, activeTab, openPanel, closePanel, setActiveTab }}>
      {children}
    </UserPanelContext.Provider>
  );
};

export const useUserPanel = () => {
  const context = useContext(UserPanelContext);
  if (!context) {
    throw new Error('useUserPanel must be used within UserPanelProvider');
  }
  return context;
};
