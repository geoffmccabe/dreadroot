import React, { createContext, useContext, useState, useCallback, ReactNode, useEffect } from 'react';
import { AnimationConfig } from '@/types/models';
import { useModelsData } from '@/hooks/useModelsData';

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

const AvatarContext = createContext<AvatarContextType | undefined>(undefined);

export function AvatarProvider({ children }: { children: React.ReactNode }) {
  const { getModelByKey, isLoading } = useModelsData();
  
  const [avatarConfig, setAvatarConfig] = useState<AvatarConfig>({
    model: '/y-bot.fbx',
    scale: 0.01,
    scaleX: 1.0,
    scaleY: 1.0,
    scaleZ: 1.0,
    color: '#4a9eff',
    animations: [],
  });
  const [currentAnimation, setCurrentAnimation] = useState<string>('Idle');

  // Load default model from database
  useEffect(() => {
    if (!isLoading) {
      const yBotModel = getModelByKey('y-bot');
      if (yBotModel) {
        setAvatarConfig({
          model: yBotModel.model_url,
          scale: yBotModel.default_scale,
          scaleX: yBotModel.default_scale_x,
          scaleY: yBotModel.default_scale_y,
          scaleZ: yBotModel.default_scale_z,
          color: yBotModel.default_color,
          animations: yBotModel.animations,
        });
      }
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [isLoading]);

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
