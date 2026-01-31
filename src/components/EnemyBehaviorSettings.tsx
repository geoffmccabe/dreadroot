// EnemyBehaviorSettings - Collapsible AI behavior configuration panel
// Allows toggling behaviors and tuning AI parameters per enemy tier

import React, { useState } from 'react';
import { Card } from '@/components/ui/card';
import { Label } from '@/components/ui/label';
import { Slider } from '@/components/ui/slider';
import { Checkbox } from '@/components/ui/checkbox';
import { Textarea } from '@/components/ui/textarea';
import { Collapsible, CollapsibleContent, CollapsibleTrigger } from '@/components/ui/collapsible';
import { Brain, ChevronDown, ChevronUp } from 'lucide-react';

// All available behavior modules with detailed default descriptions
const ALL_BEHAVIORS = [
  { id: 'sleep', label: 'Sleep' },
  { id: 'wander', label: 'Wander' },
  { id: 'patrol', label: 'Patrol' },
  { id: 'chase', label: 'Chase' },
  { id: 'attack', label: 'Attack' },
  { id: 'angry', label: 'Angry' },
  { id: 'revenge', label: 'Revenge' },
  { id: 'returnHome', label: 'Return Home' },
  { id: 'indignant', label: 'Indignant' },
] as const;

// Default behavior descriptions - editable per enemy type
const DEFAULT_BEHAVIOR_DESCRIPTIONS: Record<string, Record<string, string>> = {
  shnake: {
    sleep: 'Not used by shnakes - they patrol instead.',
    wander: 'Not used by shnakes - they patrol instead.',
    patrol: "Shnake actively moves around its home tree, picking random positions within tree bounds to travel to. Moves at 50% speed. Occasionally (every 10 seconds) pauses for 1-3 seconds to \"look around\" by turning the head in different directions. Stops patrolling to chase if player is detected. Shnakes LoS (Line of Sight) is only 90 degrees, so players can avoid detection by staying out of its view. During Patrol, it heals one block every 2 minutes, if it has been damaged.",
    chase: "When player is within detection range and visible, but hasn't been hit by a player's bullet within the last 5 minutes, shnake pursues the player at full speed by descending the tree. It will make noise and appear to threaten the player as a warning, but will not attack unless damaged by the player. Gives up chase if player escapes detection range for 5+ seconds. If the player is in the tree (standing upon one of its blocks), it will always chase and attack.",
    attack: "When player is within attack range and cooldown has passed, shnake strikes. Deals damage and applies knockback in the direction of its attack vector. Returns to PATROL if the player moves out of its LoS (Line of Sight) for 5 seconds or more.",
    angry: 'Not used by shnakes - they use revenge instead.',
    revenge: "RELENTLESS pursuit triggered when shnake takes damage. It will move straight towards the player, extending itself in a line and wiggling, moving in a direct line towards the player. It will fall out of the tree and continue dropping from branch to branch, moving in a straight line to chase the player. During REVENGE it moves at 2x speed, and also wiggles and roars continually. Attacks until 3 minutes pass without being damaged again. It will stop attacking also if it has done damage to players equal or more to what it has received itself. During revenge, if another player does damage to it, the snake will change its revenge target, and pursue the player that damaged it. It will pursue any player damaging it, switching to new players, and keeping a tally of all damage done to it by the total players, and attempt to extract equal or more damage from the last player that damaged it. Headshots stun for 0.5 second per 20pt damage done in a single shot. After timeout expires, returns to its home tree and begins patrol again.",
    returnHome: 'After revenge timeout expires, shnake navigates back to its home tree. Moves at normal speed toward tree base. Once within 5 blocks and touching tree, clears revenge state and resumes patrol.',
    indignant: 'When bullet ricochets off body (not head), shnake rears up and performs S-wiggle animation for 2 seconds while roaring at normal volume. Does NOT interrupt revenge mode - ignored during active pursuit.',
  },
  shwarm: {
    sleep: 'When player is far away, shwarm floats dormant. Minimal processing. Wakes when player enters detection range or when damaged.',
    wander: 'Shwarm picks random positions within 8 blocks and floats toward them at 50% speed. Randomly pauses between movements. Active when player is at medium distance.',
    patrol: 'Not used by shwarms - they wander instead.',
    chase: 'When player is within detection range and visible, shwarm pursues at full speed. Prioritizes chase over wander.',
    attack: 'When player is within attack range and cooldown passed, shwarm attacks. Deals damage with knockback toward player.',
    angry: 'Triggered when damaged or player invades personal space (within 3 blocks). Chases at increased speed (1.5x default). Lasts for configured angry duration. Higher priority than normal chase.',
    revenge: 'Not used by shwarms.',
    returnHome: 'Not used by shwarms.',
    indignant: 'Not used by shwarms.',
  },
  shombie: {
    sleep: 'Not used by shombies - they are always active.',
    wander: 'Not used by shombies.',
    patrol: 'Not used by shombies.',
    chase: 'Shombie relentlessly pursues player when within detection range (50 blocks default). Does not require line of sight. Chases until player is in attack range.',
    attack: 'When player is within attack range, shombie attacks with configured damage and knockback. 1 second default cooldown between attacks.',
    angry: 'Not used by shombies - they are always aggressive.',
    revenge: 'Not used by shombies.',
    returnHome: 'Not used by shombies.',
    indignant: 'Not used by shombies.',
  },
  walapa: {
    sleep: 'Not used by walapas - they travel between trees.',
    wander: 'Not used by walapas - they travel between trees.',
    patrol: 'Walapa travels from treetop to treetop, visiting trees of minimum tier. Waits at each tree for configured time before moving to next.',
    chase: 'Not used by walapas - they are passive creatures.',
    attack: 'Not used by walapas - they do not attack players.',
    angry: 'Not used by walapas - they are always docile.',
    revenge: 'Not used by walapas.',
    returnHome: 'Not used by walapas.',
    indignant: 'When damaged, walapa emits a sad call and continues its journey. Does not change behavior when attacked.',
  },
};

// Default behaviors per enemy type
const DEFAULT_BEHAVIORS: Record<string, string[]> = {
  shnake: ['patrol', 'chase', 'attack', 'revenge', 'returnHome', 'indignant'],
  shwarm: ['sleep', 'wander', 'chase', 'attack', 'angry'],
  shombie: ['chase', 'attack'],
  walapa: ['patrol', 'indignant'],
  shtickman: ['wander', 'patrol'],
};

// Default AI config per enemy type
const DEFAULT_AI_CONFIG: Record<string, AIConfig> = {
  shnake: {
    behaviors: DEFAULT_BEHAVIORS.shnake,
    detectionRange: 16,
    attackRange: 1.5,
    attackCooldownMs: 1000,
    angrySpeedMultiplier: 2,
    angryDurationMs: 30000,
    gravityMultiplier: 1,
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
  walapa: {
    behaviors: DEFAULT_BEHAVIORS.walapa,
    detectionRange: 0, // Not applicable
    attackRange: 0, // Not applicable
    attackCooldownMs: 0, // Not applicable
    angrySpeedMultiplier: 1.0,
    angryDurationMs: 0,
  },
  shtickman: {
    behaviors: DEFAULT_BEHAVIORS.shtickman,
    detectionRange: 50,
    attackRange: 2.0,
    attackCooldownMs: 1000,
    angrySpeedMultiplier: 1.0,
    angryDurationMs: 0,
  },
};

export interface AIConfig {
  behaviors?: string[];
  behaviorDescriptions?: Record<string, string>;
  detectionRange?: number;
  attackRange?: number;
  attackCooldownMs?: number;
  angrySpeedMultiplier?: number;
  angryDurationMs?: number;
  gravityMultiplier?: number;
  custom?: Record<string, unknown>;
}

interface EnemyBehaviorSettingsProps {
  enemyType?: 'shwarm' | 'shnake' | 'shombie' | 'walapa' | 'shtickman';
  aiConfig: AIConfig | null | undefined;
  onConfigChange: (config: AIConfig) => void;
  className?: string;
}

export function EnemyBehaviorSettings({
  enemyType = 'shtickman',
  aiConfig,
  onConfigChange,
  className,
}: EnemyBehaviorSettingsProps) {
  const [isOpen, setIsOpen] = useState(false);

  // Merge with defaults
  const defaults = DEFAULT_AI_CONFIG[enemyType] || DEFAULT_AI_CONFIG.shtickman;
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

  const getBehaviorDescription = (behaviorId: string) => {
    return config.behaviorDescriptions?.[behaviorId]
      ?? (enemyType && DEFAULT_BEHAVIOR_DESCRIPTIONS[enemyType]?.[behaviorId])
      ?? '';
  };

  const updateBehaviorDescription = (behaviorId: string, description: string) => {
    const currentDescriptions = config.behaviorDescriptions || {};
    onConfigChange({
      ...config,
      behaviorDescriptions: {
        ...currentDescriptions,
        [behaviorId]: description,
      },
    });
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
            <div className="grid grid-cols-3 gap-2 mb-4">
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
                  >
                    {behavior.label}
                  </label>
                </div>
              ))}
            </div>
          </div>

          {/* Behavior Descriptions - editable for each enabled behavior */}
          <div className="space-y-3">
            <Label className="text-xs text-muted-foreground block">Behavior Descriptions (AI Reference)</Label>
            {ALL_BEHAVIORS.filter(b => isBehaviorEnabled(b.id)).map(behavior => (
              <div key={behavior.id} className="space-y-1">
                <Label className="text-xs font-medium">{behavior.label}</Label>
                <Textarea
                  value={getBehaviorDescription(behavior.id)}
                  onChange={(e) => updateBehaviorDescription(behavior.id, e.target.value)}
                  className="text-xs min-h-[60px] resize-y"
                  placeholder={`Describe how ${behavior.label} should work...`}
                />
              </div>
            ))}
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
