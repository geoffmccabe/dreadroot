import React, { useState, useEffect, useCallback } from 'react';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import { Tabs, TabsContent, TabsList, TabsTrigger } from '@/components/ui/tabs';
import { ScrollArea } from '@/components/ui/scroll-area';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { Slider } from '@/components/ui/slider';
import { Button } from '@/components/ui/button';
import { supabase } from '@/integrations/supabase/client';
import { toast } from 'sonner';
import { Save } from 'lucide-react';

// Tier color definitions
const TIER_COLORS: Record<number, { name: string; defaultColors: string[] }> = {
  1: { name: 'Yellow', defaultColors: ['#FFFF00'] },
  2: { name: 'Green', defaultColors: ['#00FF00'] },
  3: { name: 'Blue', defaultColors: ['#0088FF'] },
  4: { name: 'Purple', defaultColors: ['#8B00FF'] },
  5: { name: 'Red', defaultColors: ['#FF0000'] },
  6: { name: 'White', defaultColors: ['#FFFFFF'] },
  7: { name: 'Pink', defaultColors: ['#FF69B4'] },
  8: { name: 'Rainbow', defaultColors: ['#FF0000', '#FF7F00', '#FFFF00', '#00FF00', '#0000FF', '#8B00FF'] },
  9: { name: 'Black', defaultColors: ['#1a1a1a'] },
  10: { name: 'Gold', defaultColors: ['#FFD700'] },
};

interface BulletDefinition {
  id?: string;
  tier: number;
  colors: string[];
  burn_time: number;
  burn_width: number;
  burn_height: number;
}

// Default values for new bullet definitions
const getDefaultBullet = (tier: number): BulletDefinition => ({
  tier,
  colors: TIER_COLORS[tier]?.defaultColors || ['#FFFFFF'],
  burn_time: 0.5 + (tier - 1) * 0.05, // T1: 0.5s, scaling up
  burn_width: 0.25 + (tier - 1) * 0.025, // T1: 0.25m, scaling up
  burn_height: 0.5 + (tier - 1) * 0.05, // T1: 0.5m, scaling up
});

interface BulletTierPanelProps {
  tier: number;
  definition: BulletDefinition;
  onChange: (def: BulletDefinition) => void;
  onSave: () => void;
  isSaving: boolean;
  hasChanges: boolean;
}

function BulletTierPanel({ tier, definition, onChange, onSave, isSaving, hasChanges }: BulletTierPanelProps) {
  const tierInfo = TIER_COLORS[tier];
  
  const updateField = <K extends keyof BulletDefinition>(field: K, value: BulletDefinition[K]) => {
    onChange({ ...definition, [field]: value });
  };

  const updateColor = (index: number, color: string) => {
    const newColors = [...definition.colors];
    newColors[index] = color;
    onChange({ ...definition, colors: newColors });
  };

  const addColor = () => {
    onChange({ ...definition, colors: [...definition.colors, '#FFFFFF'] });
  };

  const removeColor = (index: number) => {
    if (definition.colors.length > 1) {
      const newColors = definition.colors.filter((_, i) => i !== index);
      onChange({ ...definition, colors: newColors });
    }
  };

  return (
    <Card className="mb-4">
      <CardHeader className="pb-2">
        <div className="flex items-center justify-between">
          <div className="flex items-center gap-3">
            <div 
              className="w-8 h-8 rounded-full border-2 border-border"
              style={{ 
                background: tier === 8 
                  ? 'linear-gradient(90deg, #FF0000, #FF7F00, #FFFF00, #00FF00, #0000FF, #8B00FF)'
                  : definition.colors[0] 
              }}
            />
            <CardTitle className="text-lg">T{tier} - {tierInfo.name}</CardTitle>
          </div>
          <Button 
            size="sm" 
            onClick={onSave} 
            disabled={isSaving || !hasChanges}
            variant={hasChanges ? "default" : "outline"}
          >
            <Save className="w-4 h-4 mr-1" />
            {isSaving ? 'Saving...' : 'Save'}
          </Button>
        </div>
      </CardHeader>
      <CardContent className="space-y-4">
        {/* Colors */}
        <div className="space-y-2">
          <Label className="text-sm font-medium">Colors</Label>
          <div className="flex flex-wrap gap-2">
            {definition.colors.map((color, index) => (
              <div key={index} className="flex items-center gap-1">
                <Input
                  type="color"
                  value={color}
                  onChange={(e) => updateColor(index, e.target.value)}
                  className="w-12 h-8 p-0 border-0 cursor-pointer"
                />
                <Input
                  type="text"
                  value={color}
                  onChange={(e) => updateColor(index, e.target.value)}
                  className="w-24 h-8 text-xs"
                />
                {definition.colors.length > 1 && (
                  <Button
                    size="sm"
                    variant="ghost"
                    className="h-8 w-8 p-0 text-destructive hover:text-destructive"
                    onClick={() => removeColor(index)}
                  >
                    ×
                  </Button>
                )}
              </div>
            ))}
            <Button size="sm" variant="outline" className="h-8" onClick={addColor}>
              + Add Color
            </Button>
          </div>
        </div>

        {/* Burn Time */}
        <div className="space-y-2">
          <div className="flex justify-between">
            <Label className="text-sm font-medium">Burn Time</Label>
            <span className="text-sm text-muted-foreground">{definition.burn_time.toFixed(2)}s</span>
          </div>
          <Slider
            value={[definition.burn_time]}
            onValueChange={([v]) => updateField('burn_time', v)}
            min={0.1}
            max={3}
            step={0.05}
          />
        </div>

        {/* Burn Width */}
        <div className="space-y-2">
          <div className="flex justify-between">
            <Label className="text-sm font-medium">Burn Width</Label>
            <span className="text-sm text-muted-foreground">{definition.burn_width.toFixed(2)}m</span>
          </div>
          <Slider
            value={[definition.burn_width]}
            onValueChange={([v]) => updateField('burn_width', v)}
            min={0.1}
            max={2}
            step={0.025}
          />
        </div>

        {/* Burn Height */}
        <div className="space-y-2">
          <div className="flex justify-between">
            <Label className="text-sm font-medium">Burn Height</Label>
            <span className="text-sm text-muted-foreground">{definition.burn_height.toFixed(2)}m</span>
          </div>
          <Slider
            value={[definition.burn_height]}
            onValueChange={([v]) => updateField('burn_height', v)}
            min={0.1}
            max={3}
            step={0.05}
          />
        </div>

        {/* Special effects note for T6-T10 */}
        {tier >= 6 && (
          <div className="text-xs text-muted-foreground italic border-t pt-2 mt-2">
            ✨ Special effects coming soon for {tierInfo.name} bullets
          </div>
        )}
      </CardContent>
    </Card>
  );
}

export function WeaponsPanel() {
  const [activeSubTab, setActiveSubTab] = useState<'bullets' | 'weapons'>('bullets');
  const [bulletDefinitions, setBulletDefinitions] = useState<Map<number, BulletDefinition>>(new Map());
  const [originalDefinitions, setOriginalDefinitions] = useState<Map<number, BulletDefinition>>(new Map());
  const [savingTiers, setSavingTiers] = useState<Set<number>>(new Set());
  const [isLoading, setIsLoading] = useState(true);

  // Initialize with defaults for all 10 tiers
  useEffect(() => {
    const loadDefinitions = async () => {
      setIsLoading(true);
      
      // For now, initialize with defaults since we don't have a database table yet
      // TODO: Load from database when bullet_definitions table is created
      const defaults = new Map<number, BulletDefinition>();
      for (let tier = 1; tier <= 10; tier++) {
        defaults.set(tier, getDefaultBullet(tier));
      }
      setBulletDefinitions(defaults);
      setOriginalDefinitions(new Map(defaults));
      setIsLoading(false);
    };

    loadDefinitions();
  }, []);

  const updateDefinition = useCallback((tier: number, def: BulletDefinition) => {
    setBulletDefinitions(prev => {
      const updated = new Map(prev);
      updated.set(tier, def);
      return updated;
    });
  }, []);

  const saveDefinition = useCallback(async (tier: number) => {
    const def = bulletDefinitions.get(tier);
    if (!def) return;

    setSavingTiers(prev => new Set(prev).add(tier));
    
    try {
      // TODO: Save to database when bullet_definitions table is created
      // For now, just update the "original" state to mark as saved
      setOriginalDefinitions(prev => {
        const updated = new Map(prev);
        updated.set(tier, { ...def });
        return updated;
      });
      
      toast.success(`T${tier} bullet settings saved`);
    } catch (error) {
      console.error('Failed to save bullet definition:', error);
      toast.error('Failed to save bullet settings');
    } finally {
      setSavingTiers(prev => {
        const updated = new Set(prev);
        updated.delete(tier);
        return updated;
      });
    }
  }, [bulletDefinitions]);

  const hasChanges = useCallback((tier: number): boolean => {
    const current = bulletDefinitions.get(tier);
    const original = originalDefinitions.get(tier);
    if (!current || !original) return false;
    return JSON.stringify(current) !== JSON.stringify(original);
  }, [bulletDefinitions, originalDefinitions]);

  if (isLoading) {
    return <div className="p-4 text-center text-muted-foreground">Loading weapon settings...</div>;
  }

  return (
    <div className="space-y-4">
      <Tabs value={activeSubTab} onValueChange={(v) => setActiveSubTab(v as 'bullets' | 'weapons')}>
        <TabsList className="grid w-full grid-cols-2">
          <TabsTrigger value="bullets">Bullets</TabsTrigger>
          <TabsTrigger value="weapons">Weapons</TabsTrigger>
        </TabsList>

        <TabsContent value="bullets" className="mt-4">
          <ScrollArea className="h-[calc(90vh-280px)]">
            <div className="pr-4 space-y-2">
              {Array.from({ length: 10 }, (_, i) => i + 1).map(tier => {
                const def = bulletDefinitions.get(tier) || getDefaultBullet(tier);
                return (
                  <BulletTierPanel
                    key={tier}
                    tier={tier}
                    definition={def}
                    onChange={(d) => updateDefinition(tier, d)}
                    onSave={() => saveDefinition(tier)}
                    isSaving={savingTiers.has(tier)}
                    hasChanges={hasChanges(tier)}
                  />
                );
              })}
            </div>
          </ScrollArea>
        </TabsContent>

        <TabsContent value="weapons" className="mt-4">
          <Card>
            <CardHeader>
              <CardTitle>Weapons Configuration</CardTitle>
            </CardHeader>
            <CardContent>
              <p className="text-muted-foreground text-sm">
                Weapon configuration coming soon. This panel will allow you to configure different weapon types, 
                their bullet tiers, fire rates, and other properties.
              </p>
            </CardContent>
          </Card>
        </TabsContent>
      </Tabs>
    </div>
  );
}
