import React, { useState, useCallback } from 'react';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import { Tabs, TabsContent, TabsList, TabsTrigger } from '@/components/ui/tabs';
import { ScrollArea } from '@/components/ui/scroll-area';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { Slider } from '@/components/ui/slider';
import { Button } from '@/components/ui/button';
import { toast } from 'sonner';
import { useBulletDefinitions, blendColors, BulletDefinition } from '@/contexts/BulletDefinitionsContext';

// Tier color definitions (display names only)
const TIER_NAMES: Record<number, string> = {
  1: 'Yellow',
  2: 'Green',
  3: 'Blue',
  4: 'Purple',
  5: 'Red',
  6: 'White',
  7: 'Pink',
  8: 'Rainbow',
  9: 'Black',
  10: 'Gold',
};

interface BulletTierPanelProps {
  tier: number;
  definition: BulletDefinition;
  onChange: (def: BulletDefinition) => void;
}

function BulletShape({ colors, isRainbow }: { colors: string[]; isRainbow: boolean }) {
  const blended = isRainbow 
    ? 'linear-gradient(90deg, #FF0000, #FF7F00, #FFFF00, #00FF00, #0000FF, #8B00FF)'
    : colors.length > 1 
      ? blendColors(colors)
      : colors[0];
  
  const bgStyle = isRainbow 
    ? { background: blended }
    : { background: colors.length > 1 ? blended : colors[0] };
  
  return (
    <div className="flex items-center h-5" title={colors.length > 1 ? `Colors: ${colors.join(', ')}` : colors[0]}>
      <div className="w-6 h-4 rounded-l-sm" style={bgStyle} />
      <div className="w-2 h-4 rounded-r-full" style={bgStyle} />
    </div>
  );
}

function BulletTierPanel({ tier, definition, onChange }: BulletTierPanelProps) {
  const tierName = TIER_NAMES[tier];
  
  const updateField = <K extends keyof BulletDefinition>(field: K, value: BulletDefinition[K]) => {
    onChange({ ...definition, [field]: value });
  };

  const updateColor = (index: number, color: string) => {
    const newColors = [...definition.colors];
    newColors[index] = color;
    onChange({ ...definition, colors: newColors });
  };

  const addColor = () => {
    if (definition.colors.length < 3) {
      onChange({ ...definition, colors: [...definition.colors, '#FFFFFF'] });
    }
  };

  const removeColor = (index: number) => {
    if (definition.colors.length > 1) {
      const newColors = definition.colors.filter((_, i) => i !== index);
      onChange({ ...definition, colors: newColors });
    }
  };

  return (
    <Card className="mb-2 p-3">
      {/* Row 1: Bullet shape, colors */}
      <div className="flex items-center gap-3 mb-2">
        <div className="flex items-center gap-2 min-w-[100px]">
          <BulletShape colors={definition.colors} isRainbow={tier === 8} />
          <span className="text-sm font-medium">T{tier}</span>
          {definition.colors.length > 1 && (
            <span className="text-xs text-muted-foreground">({definition.colors.length} colors)</span>
          )}
        </div>
        
        <div className="flex items-center gap-1 flex-1 flex-wrap">
          {definition.colors.map((color, index) => (
            <div key={index} className="flex items-center gap-1">
              <Input
                type="color"
                value={color}
                onChange={(e) => updateColor(index, e.target.value)}
                className="w-8 h-6 p-0 border-0 cursor-pointer"
              />
              <Input
                type="text"
                value={color}
                onChange={(e) => updateColor(index, e.target.value)}
                className="w-20 h-6 text-xs px-1"
              />
              {definition.colors.length > 1 && (
                <Button
                  size="sm"
                  variant="ghost"
                  className="h-6 w-6 p-0 text-destructive hover:text-destructive"
                  onClick={() => removeColor(index)}
                >
                  ×
                </Button>
              )}
            </div>
          ))}
          {definition.colors.length < 3 && (
            <Button size="sm" variant="outline" className="h-6 text-xs px-2" onClick={addColor}>
              + Add
            </Button>
          )}
        </div>
      </div>

      {/* Row 2: Burn sliders */}
      <div className="flex items-center gap-4">
        <div className="flex items-center gap-2 flex-1">
          <Label className="text-xs w-16 shrink-0">Time</Label>
          <Slider
            value={[definition.burn_time]}
            onValueChange={([v]) => updateField('burn_time', v)}
            min={0.1}
            max={6}
            step={0.05}
            className="flex-1"
          />
          <span className="text-xs text-muted-foreground w-10">{definition.burn_time.toFixed(2)}s</span>
        </div>
        
        <div className="flex items-center gap-2 flex-1">
          <Label className="text-xs w-16 shrink-0">Width</Label>
          <Slider
            value={[definition.burn_width]}
            onValueChange={([v]) => updateField('burn_width', v)}
            min={0.1}
            max={4}
            step={0.025}
            className="flex-1"
          />
          <span className="text-xs text-muted-foreground w-10">{definition.burn_width.toFixed(2)}m</span>
        </div>
        
        <div className="flex items-center gap-2 flex-1">
          <Label className="text-xs w-16 shrink-0">Height</Label>
          <Slider
            value={[definition.burn_height]}
            onValueChange={([v]) => updateField('burn_height', v)}
            min={0.1}
            max={6}
            step={0.05}
            className="flex-1"
          />
          <span className="text-xs text-muted-foreground w-10">{definition.burn_height.toFixed(2)}m</span>
        </div>
      </div>

      {definition.colors.length > 1 && (
        <div className="text-xs text-muted-foreground mt-1">
          🔥 Multi-color hex fire pattern: center + 6 surrounding flames
        </div>
      )}
    </Card>
  );
}

export function WeaponsPanel() {
  const [activeSubTab, setActiveSubTab] = useState<'bullets' | 'weapons'>('bullets');
  const { definitions, getDefinition, updateDefinition } = useBulletDefinitions();

  const handleChange = useCallback((tier: number, def: BulletDefinition) => {
    updateDefinition(tier, def);
  }, [updateDefinition]);

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
                const def = getDefinition(tier);
                return (
                  <BulletTierPanel
                    key={tier}
                    tier={tier}
                    definition={def}
                    onChange={(d) => handleChange(tier, d)}
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
