// EnemyBehaviorSettings - Collapsible AI behavior configuration panel
// Allows toggling behaviors and tuning AI parameters per enemy tier

import React, { useState } from 'react';
import { Card } from '@/components/ui/card';
import { Label } from '@/components/ui/label';
import { Slider } from '@/components/ui/slider';
import { Checkbox } from '@/components/ui/checkbox';
import { Collapsible, CollapsibleContent, CollapsibleTrigger } from '@/components/ui/collapsible';
import { Brain, ChevronDown, ChevronUp } from 'lucide-react';

// All available behavior modules
const ALL_BEHAVIORS = [
  { id: 'sleep', label: 'Sleep', description: 'Dormant until player approaches' },
  { id: 'wander', label: 'Wander', description: 'Random movement when idle' },
  { id: 'patrol', label: 'Patrol', description: 'Move along tree/patrol route' },
  { id: 'chase', label: 'Chase', description: 'Pursue player when detected' },
  { id: 'attack', label: 'Attack', description: 'Deal damage when in range' },
  { id: 'angry', label: 'Angry', description: 'Aggressive mode after damage' },
  { id: 'revenge', label: 'Revenge', description: 'Target specific attacker' },
  { id: 'returnHome', label: 'Return Home', description: 'Return to spawn point' },
  { id: 'indignant', label: 'Indignant', description: 'Brief angry reaction to hits' },
] as const;

// Default behaviors per enemy type
const DEFAULT_BEHAVIORS: Record<string, string[]> = {
  shnake: ['patrol', 'chase', 'attack', 'revenge', 'returnHome', 'indignant'],
  shwarm: ['sleep', 'wander', 'chase', 'attack', 'angry'],
  shombie: ['chase', 'attack'],
};

// Default AI config per enemy type
const DEFAULT_AI_CONFIG: Record<string, AIConfig> = {
  shnake: {
    behaviors: DEFAULT_BEHAVIORS.shnake,
    detectionRange: 32,
    attackRange: 1.5,
    attackCooldownMs: 600,
    angrySpeedMultiplier: 1.5,
    angryDurationMs: 30000,
    gravityMultiplier: 0.3,
  },
  shwarm: {
    behaviors: DEFAULT_BEHAVIORS.shwarm,
    detectionRange: 32,
    attackRange: 2.0,
    attackCooldownMs: 500,
    angrySpeedMultiplier: 1.5,
    angryDurationMs: 30000,
  },
  shombie: {
    behaviors: DEFAULT_BEHAVIORS.shombie,
    detectionRange: 50,
    attackRange: 1.2,
    attackCooldownMs: 1000,
    angrySpeedMultiplier: 1.0,
    angryDurationMs: 0,
  },
};

export interface AIConfig {
  behaviors?: string[];
  detectionRange?: number;
  attackRange?: number;
  attackCooldownMs?: number;
  angrySpeedMultiplier?: number;
  angryDurationMs?: number;
  gravityMultiplier?: number;
  custom?: Record<string, unknown>;
}

interface EnemyBehaviorSettingsProps {
  enemyType: 'shwarm' | 'shnake' | 'shombie';
  aiConfig: AIConfig | null | undefined;
  onConfigChange: (config: AIConfig) => void;
  className?: string;
}

export function EnemyBehaviorSettings({
  enemyType,
  aiConfig,
  onConfigChange,
  className,
}: EnemyBehaviorSettingsProps) {
  const [isOpen, setIsOpen] = useState(false);
  
  // Merge with defaults
  const defaults = DEFAULT_AI_CONFIG[enemyType];
  const config: AIConfig = {
    ...defaults,
    ...aiConfig,
    behaviors: aiConfig?.behaviors ?? defaults.behaviors,
  };

  const updateConfig = (field: keyof AIConfig, value: unknown) => {
    onConfigChange({ ...config, [field]: value });
  };

  const toggleBehavior = (behaviorId: string, enabled: boolean) => {
    const currentBehaviors = config.behaviors || [];
    const newBehaviors = enabled
      ? [...currentBehaviors, behaviorId]
      : currentBehaviors.filter(b => b !== behaviorId);
    updateConfig('behaviors', newBehaviors);
  };

  const isBehaviorEnabled = (behaviorId: string) => {
    return config.behaviors?.includes(behaviorId) ?? false;
  };

  return (
    <Card className={`p-4 bg-muted/30 ${className || ''}`}>
      <Collapsible open={isOpen} onOpenChange={setIsOpen}>
        <CollapsibleTrigger className="flex items-center justify-between w-full">
          <h4 className="text-sm font-semibold flex items-center gap-2">
            <Brain className="h-4 w-4" />
            AI Behavior Settings
          </h4>
          {isOpen ? (
            <ChevronUp className="h-4 w-4 text-muted-foreground" />
          ) : (
            <ChevronDown className="h-4 w-4 text-muted-foreground" />
          )}
        </CollapsibleTrigger>
        
        <CollapsibleContent className="pt-4 space-y-4">
          {/* Behavior Toggles */}
          <div>
            <Label className="text-xs text-muted-foreground mb-2 block">Enabled Behaviors</Label>
            <div className="grid grid-cols-3 gap-2">
              {ALL_BEHAVIORS.map(behavior => (
                <div key={behavior.id} className="flex items-center space-x-2">
                  <Checkbox
                    id={`behavior-${behavior.id}`}
                    checked={isBehaviorEnabled(behavior.id)}
                    onCheckedChange={(checked) => toggleBehavior(behavior.id, checked === true)}
                  />
                  <label
                    htmlFor={`behavior-${behavior.id}`}
                    className="text-xs cursor-pointer"
                    title={behavior.description}
                  >
                    {behavior.label}
                  </label>
                </div>
              ))}
            </div>
          </div>

          {/* AI Parameters */}
          <div className="grid grid-cols-2 gap-4">
            {/* Detection Range */}
            <div className="space-y-2">
              <div className="flex items-center justify-between">
                <Label className="text-xs">Detection Range</Label>
                <span className="text-xs text-muted-foreground">
                  {config.detectionRange ?? defaults.detectionRange} blocks
                </span>
              </div>
              <Slider
                value={[config.detectionRange ?? defaults.detectionRange ?? 32]}
                onValueChange={([v]) => updateConfig('detectionRange', v)}
                min={8}
                max={100}
                step={2}
              />
            </div>

            {/* Attack Range */}
            <div className="space-y-2">
              <div className="flex items-center justify-between">
                <Label className="text-xs">Attack Range</Label>
                <span className="text-xs text-muted-foreground">
                  {(config.attackRange ?? defaults.attackRange ?? 1.5).toFixed(1)} blocks
                </span>
              </div>
              <Slider
                value={[config.attackRange ?? defaults.attackRange ?? 1.5]}
                onValueChange={([v]) => updateConfig('attackRange', v)}
                min={0.5}
                max={5}
                step={0.1}
              />
            </div>

            {/* Attack Cooldown */}
            <div className="space-y-2">
              <div className="flex items-center justify-between">
                <Label className="text-xs">Attack Cooldown</Label>
                <span className="text-xs text-muted-foreground">
                  {config.attackCooldownMs ?? defaults.attackCooldownMs ?? 600}ms
                </span>
              </div>
              <Slider
                value={[config.attackCooldownMs ?? defaults.attackCooldownMs ?? 600]}
                onValueChange={([v]) => updateConfig('attackCooldownMs', v)}
                min={200}
                max={3000}
                step={100}
              />
            </div>

            {/* Angry Speed Multiplier */}
            <div className="space-y-2">
              <div className="flex items-center justify-between">
                <Label className="text-xs">Angry Speed</Label>
                <span className="text-xs text-muted-foreground">
                  {(config.angrySpeedMultiplier ?? defaults.angrySpeedMultiplier ?? 1.5).toFixed(1)}x
                </span>
              </div>
              <Slider
                value={[config.angrySpeedMultiplier ?? defaults.angrySpeedMultiplier ?? 1.5]}
                onValueChange={([v]) => updateConfig('angrySpeedMultiplier', v)}
                min={1.0}
                max={3.0}
                step={0.1}
              />
            </div>

            {/* Angry Duration - only show if angry/revenge behaviors exist */}
            {(isBehaviorEnabled('angry') || isBehaviorEnabled('revenge')) && (
              <div className="space-y-2">
                <div className="flex items-center justify-between">
                  <Label className="text-xs">Angry Duration</Label>
                  <span className="text-xs text-muted-foreground">
                    {((config.angryDurationMs ?? defaults.angryDurationMs ?? 30000) / 1000).toFixed(0)}s
                  </span>
                </div>
                <Slider
                  value={[config.angryDurationMs ?? defaults.angryDurationMs ?? 30000]}
                  onValueChange={([v]) => updateConfig('angryDurationMs', v)}
                  min={5000}
                  max={120000}
                  step={5000}
                />
              </div>
            )}

            {/* Gravity Multiplier - only for shnakes */}
            {enemyType === 'shnake' && (
              <div className="space-y-2">
                <div className="flex items-center justify-between">
                  <Label className="text-xs">Gravity</Label>
                  <span className="text-xs text-muted-foreground">
                    {(config.gravityMultiplier ?? defaults.gravityMultiplier ?? 0.3).toFixed(2)}
                    {(config.gravityMultiplier ?? 0.3) === 0 ? ' (float)' : 
                     (config.gravityMultiplier ?? 0.3) >= 1 ? ' (full)' : ' (slow fall)'}
                  </span>
                </div>
                <Slider
                  value={[config.gravityMultiplier ?? defaults.gravityMultiplier ?? 0.3]}
                  onValueChange={([v]) => updateConfig('gravityMultiplier', v)}
                  min={0}
                  max={1}
                  step={0.05}
                />
              </div>
            )}
          </div>

          {/* Active Behaviors Summary */}
          <div className="mt-3 p-2 bg-background rounded border border-border">
            <p className="text-[10px] text-muted-foreground">
              <span className="font-medium">Active:</span>{' '}
              {config.behaviors?.join(', ') || 'None'}
            </p>
          </div>
        </CollapsibleContent>
      </Collapsible>
    </Card>
  );
}
