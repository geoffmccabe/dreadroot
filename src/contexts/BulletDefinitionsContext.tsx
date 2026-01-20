import React, { createContext, useContext, useState, useCallback, ReactNode } from 'react';

// Tier color definitions with defaults
const TIER_DEFAULTS: Record<number, { name: string; colors: string[] }> = {
  1: { name: 'Yellow', colors: ['#FFFF00'] },
  2: { name: 'Green', colors: ['#00FF00'] },
  3: { name: 'Blue', colors: ['#0088FF'] },
  4: { name: 'Purple', colors: ['#8B00FF'] },
  5: { name: 'Red', colors: ['#FF0000'] },
  6: { name: 'White', colors: ['#FFFFFF'] },
  7: { name: 'Pink', colors: ['#FF69B4'] },
  8: { name: 'Rainbow', colors: ['#FF0000', '#FF7F00', '#FFFF00', '#00FF00', '#0000FF', '#8B00FF'] },
  9: { name: 'Black', colors: ['#1a1a1a'] },
  10: { name: 'Gold', colors: ['#FFD700'] },
};

export interface BulletDefinition {
  tier: number;
  colors: string[];
  burn_time: number;
  burn_width: number;
  burn_height: number;
}

// Get default bullet definition for a tier
export const getDefaultBullet = (tier: number): BulletDefinition => ({
  tier,
  colors: TIER_DEFAULTS[tier]?.colors || ['#FFFFFF'],
  burn_time: 0.5 + (tier - 1) * 0.05,
  burn_width: 0.25 + (tier - 1) * 0.025,
  burn_height: 0.5 + (tier - 1) * 0.05,
});

interface BulletDefinitionsContextType {
  definitions: Map<number, BulletDefinition>;
  getDefinition: (tier: number) => BulletDefinition;
  updateDefinition: (tier: number, def: BulletDefinition) => void;
  tierDefaults: typeof TIER_DEFAULTS;
}

const BulletDefinitionsContext = createContext<BulletDefinitionsContextType | undefined>(undefined);

export const BulletDefinitionsProvider: React.FC<{ children: ReactNode }> = ({ children }) => {
  // Initialize with defaults for all 10 tiers
  const [definitions, setDefinitions] = useState<Map<number, BulletDefinition>>(() => {
    const map = new Map<number, BulletDefinition>();
    for (let tier = 1; tier <= 10; tier++) {
      map.set(tier, getDefaultBullet(tier));
    }
    return map;
  });

  const getDefinition = useCallback((tier: number): BulletDefinition => {
    return definitions.get(tier) || getDefaultBullet(tier);
  }, [definitions]);

  const updateDefinition = useCallback((tier: number, def: BulletDefinition) => {
    setDefinitions(prev => {
      const updated = new Map(prev);
      updated.set(tier, def);
      return updated;
    });
  }, []);

  return (
    <BulletDefinitionsContext.Provider value={{ 
      definitions, 
      getDefinition, 
      updateDefinition,
      tierDefaults: TIER_DEFAULTS 
    }}>
      {children}
    </BulletDefinitionsContext.Provider>
  );
};

export const useBulletDefinitions = () => {
  const context = useContext(BulletDefinitionsContext);
  if (!context) {
    throw new Error('useBulletDefinitions must be used within BulletDefinitionsProvider');
  }
  return context;
};

// Utility: Blend multiple hex colors into one (averaged RGB)
export function blendColors(colors: string[]): string {
  if (colors.length === 0) return '#FFFFFF';
  if (colors.length === 1) return colors[0];
  
  let r = 0, g = 0, b = 0;
  for (const hex of colors) {
    const cleaned = hex.replace('#', '');
    r += parseInt(cleaned.substring(0, 2), 16);
    g += parseInt(cleaned.substring(2, 4), 16);
    b += parseInt(cleaned.substring(4, 6), 16);
  }
  
  const count = colors.length;
  const avgR = Math.round(r / count);
  const avgG = Math.round(g / count);
  const avgB = Math.round(b / count);
  
  return `#${avgR.toString(16).padStart(2, '0')}${avgG.toString(16).padStart(2, '0')}${avgB.toString(16).padStart(2, '0')}`;
}
