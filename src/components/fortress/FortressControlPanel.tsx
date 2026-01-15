import React, { useState, useEffect } from 'react';
import { Card } from '@/components/ui/card';
import { Label } from '@/components/ui/label';
import { Slider } from '@/components/ui/slider';
import { Input } from '@/components/ui/input';
import { ChevronDown, ChevronRight } from 'lucide-react';
import { GameSettings } from './FortressTypes';

interface ControlPanelProps {
  settings: GameSettings;
  onSettingsChange: (key: string, value: any) => void;
  isVisible: boolean;
}

export function ControlPanel({ settings, onSettingsChange, isVisible }: ControlPanelProps) {
  const [isCollapsed, setIsCollapsed] = useState(true);

  useEffect(() => {
    if (isVisible) {
      setIsCollapsed(false);
    }
  }, [isVisible]);

  if (!isVisible) return null;

  return (
    <div className="fixed top-4 left-4 z-20 w-[28rem]">
      <Card className="waterfall-card w-full">
        <div
          className="flex items-center justify-between mb-3 cursor-pointer"
          onClick={() => setIsCollapsed(!isCollapsed)}
        >
          <h3 className="font-bold text-sm">WATERFALL & COINS</h3>
          {isCollapsed ? (
            <ChevronRight className="h-4 w-4" />
          ) : (
            <ChevronDown className="h-4 w-4" />
          )}
        </div>

        {!isCollapsed && (
          <div className="space-y-3 animate-fade-in">
            <div className="grid grid-cols-[100px_1fr_40px] gap-2 items-center">
              <Label className="text-xs opacity-85">Flow speed</Label>
              <Slider
                value={[settings.flowSpeed]}
                onValueChange={([value]) => onSettingsChange('flowSpeed', value)}
                min={0.2}
                max={3}
                step={0.01}
                className="flex-1"
              />
              <span className="text-xs opacity-75">{settings.flowSpeed.toFixed(2)}</span>
            </div>
            <div className="grid grid-cols-[100px_1fr_40px] gap-2 items-center">
              <Label className="text-xs opacity-85">MS between drops</Label>
              <Slider
                value={[settings.msBetweeenDrops]}
                onValueChange={([value]) => onSettingsChange('msBetweeenDrops', value)}
                min={0.1}
                max={5}
                step={0.1}
                className="flex-1"
              />
              <span className="text-xs opacity-75">{settings.msBetweeenDrops.toFixed(1)}ms</span>
            </div>
            <div className="grid grid-cols-[100px_1fr_40px] gap-2 items-center">
              <Label className="text-xs opacity-85">Coin rate (ps)</Label>
              <Slider
                value={[settings.coinRate]}
                onValueChange={([value]) => onSettingsChange('coinRate', value)}
                min={0}
                max={10}
                step={1}
                className="flex-1"
              />
              <span className="text-xs opacity-75">{settings.coinRate}</span>
            </div>
            <div className="grid grid-cols-[100px_1fr_40px] gap-2 items-center">
              <Label className="text-xs opacity-85">Coin size</Label>
              <Slider
                value={[settings.coinSize]}
                onValueChange={([value]) => onSettingsChange('coinSize', value)}
                min={0.2}
                max={1}
                step={0.01}
                className="flex-1"
              />
              <span className="text-xs opacity-75">{settings.coinSize.toFixed(2)}</span>
            </div>

            {/* Color/Weight Controls */}
            <div className="mt-4 space-y-2">
              <Label className="text-xs opacity-85 font-semibold">Drop Colors & Weights</Label>
              <div className="grid grid-cols-3 gap-2">
                {settings.colorPalette.map((colorWeight, index) => (
                  <div key={index} className="flex items-center gap-1 text-xs">
                    <div
                      className="w-4 h-4 rounded border border-gray-300 flex-shrink-0"
                      style={{ backgroundColor: colorWeight.hex }}
                    />
                    <Input
                      type="color"
                      value={colorWeight.hex}
                      onChange={(e) => {
                        const newPalette = [...settings.colorPalette];
                        newPalette[index] = { ...newPalette[index], hex: e.target.value };
                        onSettingsChange('colorPalette', newPalette);
                      }}
                      className="w-6 h-6 p-0 border-0 cursor-pointer flex-shrink-0"
                    />
                    <Input
                      type="number"
                      value={colorWeight.weight}
                      onChange={(e) => {
                        const newPalette = [...settings.colorPalette];
                        newPalette[index] = { ...newPalette[index], weight: parseInt(e.target.value) || 0 };
                        onSettingsChange('colorPalette', newPalette);
                      }}
                      className="w-12 h-6 text-xs p-1 flex-1"
                      min="0"
                      max="100"
                    />
                  </div>
                ))}
              </div>
            </div>

            <div className="mt-3 text-xs opacity-75">
              Click to lock mouse • WASD move • Shift run • Space jump • Ctrl crawl • ESC unlock
            </div>
          </div>
        )}
      </Card>
    </div>
  );
}
