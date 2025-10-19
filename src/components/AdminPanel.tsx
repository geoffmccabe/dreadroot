import React, { useState, useEffect } from 'react';
import { Dialog, DialogContent } from '@/components/ui/dialog';
import { Tabs, TabsContent, TabsList, TabsTrigger } from '@/components/ui/tabs';
import { Card } from '@/components/ui/card';
import { Label } from '@/components/ui/label';
import { Slider } from '@/components/ui/slider';
import { Input } from '@/components/ui/input';
import { ChevronDown, ChevronRight } from 'lucide-react';
import { BillboardControlPanel } from '@/components/BillboardControlPanel';
import { useAdminPanel } from '@/contexts/AdminPanelContext';
import { supabase } from '@/integrations/supabase/client';
import { getAllBlocks } from '@/data/blockRegistry';
import { ScrollArea } from '@/components/ui/scroll-area';

interface WaterfallControlsProps {
  settings: any;
  onSettingsChange: (key: string, value: any) => void;
}

function WaterfallControls({ settings, onSettingsChange }: WaterfallControlsProps) {
  const [isCollapsed, setIsCollapsed] = useState(false);

  return (
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
              {settings.colorPalette.map((colorWeight: any, index: number) => (
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
        </div>
      )}
    </Card>
  );
}

interface UsersListProps {}

function UsersList({}: UsersListProps) {
  const [users, setUsers] = useState<any[]>([]);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    loadUsers();
  }, []);

  const loadUsers = async () => {
    try {
      // Query user profiles with roles
      const { data, error } = await supabase
        .from('user_profiles')
        .select(`
          user_id,
          coins,
          blockchain_address,
          user_roles (role)
        `)
        .order('user_id');

      if (error) throw error;

      setUsers(data || []);
    } catch (error) {
      console.error('Failed to load users:', error);
    } finally {
      setLoading(false);
    }
  };

  if (loading) {
    return <div className="text-sm opacity-75">Loading users...</div>;
  }

  return (
    <ScrollArea className="h-[500px] w-full">
      <div className="space-y-2">
        {users.map((user) => (
          <Card key={user.user_id} className="p-3">
            <div className="text-xs space-y-1">
              <div className="font-mono text-[10px] opacity-50">{user.user_id}</div>
              <div className="flex items-center justify-between">
                <span className="font-semibold">Coins:</span>
                <span>{user.coins}</span>
              </div>
              {user.blockchain_address && (
                <div className="flex items-center justify-between">
                  <span className="font-semibold">Wallet:</span>
                  <span className="font-mono text-[10px]">{user.blockchain_address.slice(0, 8)}...</span>
                </div>
              )}
              <div className="flex items-center justify-between">
                <span className="font-semibold">Roles:</span>
                <span className="text-brand-1">
                  {user.user_roles?.map((r: any) => r.role).join(', ') || 'user'}
                </span>
              </div>
            </div>
          </Card>
        ))}
      </div>
    </ScrollArea>
  );
}

interface BlocksListProps {}

function BlocksList({}: BlocksListProps) {
  const blocks = getAllBlocks().sort((a, b) => a.name.localeCompare(b.name));

  return (
    <ScrollArea className="h-[500px] w-full">
      <div className="space-y-2">
        {blocks.map((block) => (
          <Card key={block.id} className="p-3">
            <div className="flex items-start gap-3">
              <div 
                className="w-12 h-12 rounded border-2 flex-shrink-0"
                style={{
                  backgroundColor: block.properties.color,
                  borderColor: block.properties.emissive ? '#ffd700' : '#888'
                }}
              />
              <div className="flex-1 text-xs space-y-1">
                <div className="font-bold">{block.name}</div>
                <div className="opacity-75">{block.description}</div>
                <div className="flex items-center gap-2 mt-1">
                  <span className="px-2 py-0.5 rounded bg-secondary text-secondary-foreground text-[10px]">
                    {block.category}
                  </span>
                  <span className="px-2 py-0.5 rounded bg-accent text-accent-foreground text-[10px]">
                    {block.rarity}
                  </span>
                  <span className="opacity-50 text-[10px]">{block.cost} coins</span>
                </div>
                <div className="text-[10px] opacity-50 font-mono mt-1">
                  Texture: {block.texture.diffuse}
                </div>
              </div>
            </div>
          </Card>
        ))}
      </div>
    </ScrollArea>
  );
}

interface AdminPanelProps {
  waterfallSettings?: any;
  onWaterfallSettingsChange?: (key: string, value: any) => void;
  onWallPositionsChange?: (positions: Record<number, {x: number, y: number, z: number, rotX: number, rotY: number, rotZ: number}>) => void;
}

export function AdminPanel({ 
  waterfallSettings, 
  onWaterfallSettingsChange,
  onWallPositionsChange 
}: AdminPanelProps) {
  const { isOpen, activeTab, closePanel, setActiveTab } = useAdminPanel();

  return (
    <Dialog open={isOpen} onOpenChange={(open) => !open && closePanel()}>
      <DialogContent className="admin-panel-dialog max-w-2xl max-h-[90vh] overflow-hidden">
        <Tabs value={activeTab} onValueChange={(value) => setActiveTab(value as any)}>
          <TabsList className="grid w-full grid-cols-4">
            <TabsTrigger value="coins">Coins</TabsTrigger>
            <TabsTrigger value="billboards">Billboards</TabsTrigger>
            <TabsTrigger value="users">Users</TabsTrigger>
            <TabsTrigger value="blocks">Blocks</TabsTrigger>
          </TabsList>

          <TabsContent value="coins" className="mt-4">
            {waterfallSettings && onWaterfallSettingsChange && (
              <WaterfallControls 
                settings={waterfallSettings}
                onSettingsChange={onWaterfallSettingsChange}
              />
            )}
          </TabsContent>

          <TabsContent value="billboards" className="mt-4">
            <BillboardControlPanel 
              isVisible={true}
              onWallPositionsChange={onWallPositionsChange}
            />
          </TabsContent>

          <TabsContent value="users" className="mt-4">
            <UsersList />
          </TabsContent>

          <TabsContent value="blocks" className="mt-4">
            <BlocksList />
          </TabsContent>
        </Tabs>
      </DialogContent>
    </Dialog>
  );
}
