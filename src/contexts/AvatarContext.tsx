import React, { createContext, useContext, useState, useCallback } from 'react';

export interface AnimationConfig {
  name: string;
  file: string;
  trigger: 'movement' | 'manual' | 'idle' | 'jump' | 'crouch';
  speed: number;
  loop: boolean;
  fadeInDuration: number;
  fadeOutDuration: number;
}

export interface AvatarConfig {
  model: string;
  scale: number;
  scaleX: number;
  scaleY: number;
  scaleZ: number;
  color: string;
  animations: AnimationConfig[];
}

interface AvatarContextType {
  avatarConfig: AvatarConfig;
  updateAvatarConfig: (config: Partial<AvatarConfig>) => void;
  updateAnimation: (name: string, updates: Partial<AnimationConfig>) => void;
  addAnimation: (animation: AnimationConfig) => void;
  removeAnimation: (name: string) => void;
  triggerAnimation: (name: string) => void;
  currentAnimation: string;
}

const defaultAnimations: AnimationConfig[] = [
  {
    name: 'Walk',
    file: '/Unarmed_Walk_Forward.fbx',
    trigger: 'movement',
    speed: 1.0,
    loop: true,
    fadeInDuration: 0.2,
    fadeOutDuration: 0.2,
  },
  {
    name: 'Idle',
    file: '/Sitting_Laughing.fbx',
    trigger: 'idle',
    speed: 1.0,
    loop: true,
    fadeInDuration: 0.3,
    fadeOutDuration: 0.3,
  },
];

const defaultConfig: AvatarConfig = {
  model: '/y-bot.fbx',
  scale: 0.01,
  scaleX: 1.0,
  scaleY: 1.0,
  scaleZ: 1.0,
  color: '#4a9eff',
  animations: defaultAnimations,
};

const AvatarContext = createContext<AvatarContextType | undefined>(undefined);

export function AvatarProvider({ children }: { children: React.ReactNode }) {
  const [avatarConfig, setAvatarConfig] = useState<AvatarConfig>(defaultConfig);
  const [currentAnimation, setCurrentAnimation] = useState<string>('Idle');

  const updateAvatarConfig = useCallback((updates: Partial<AvatarConfig>) => {
    setAvatarConfig(prev => ({ ...prev, ...updates }));
  }, []);

  const updateAnimation = useCallback((name: string, updates: Partial<AnimationConfig>) => {
    setAvatarConfig(prev => ({
      ...prev,
      animations: prev.animations.map(anim =>
        anim.name === name ? { ...anim, ...updates } : anim
      ),
    }));
  }, []);

  const addAnimation = useCallback((animation: AnimationConfig) => {
    setAvatarConfig(prev => ({
      ...prev,
      animations: [...prev.animations, animation],
    }));
  }, []);

  const removeAnimation = useCallback((name: string) => {
    setAvatarConfig(prev => ({
      ...prev,
      animations: prev.animations.filter(anim => anim.name !== name),
    }));
  }, []);

  const triggerAnimation = useCallback((name: string) => {
    setCurrentAnimation(name);
  }, []);

  return (
    <AvatarContext.Provider
      value={{
        avatarConfig,
        updateAvatarConfig,
        updateAnimation,
        addAnimation,
        removeAnimation,
        triggerAnimation,
        currentAnimation,
      }}
    >
      {children}
    </AvatarContext.Provider>
  );
}

export function useAvatar() {
  const context = useContext(AvatarContext);
  if (!context) {
    throw new Error('useAvatar must be used within AvatarProvider');
  }
  return context;
}
