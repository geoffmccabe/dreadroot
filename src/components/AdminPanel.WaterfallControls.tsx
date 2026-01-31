import { Button } from '@/components/ui/button';
import { Card } from '@/components/ui/card';
import { Dialog, DialogContent, DialogHeader, DialogTitle } from '@/components/ui/dialog';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select';
import { Slider } from '@/components/ui/slider';
import { Textarea } from '@/components/ui/textarea';
import { useCoinTheme } from '@/contexts/CoinThemeContext';
import { useToast } from '@/hooks/use-toast';
import { supabase } from '@/integrations/supabase/client';
import { ChevronDown, ChevronRight, Plus, Upload } from 'lucide-react';
import React, { useEffect, useRef, useState } from 'react';
import type { WaterfallControlsProps } from './adminPanel.types';

export function WaterfallControls({ settings, onSettingsChange }: WaterfallControlsProps) {
  const [isCollapsed, setIsCollapsed] = useState(false);
  const [isCoinDetailsCollapsed, setIsCoinDetailsCollapsed] = useState(false);
  const [showAddCoinDialog, setShowAddCoinDialog] = useState(false);
  const { currentTheme, availableThemes, setActiveTheme, updateThemeSettings, refreshThemes } = useCoinTheme();
  const [saveTimeout, setSaveTimeout] = useState<NodeJS.Timeout | null>(null);
  const [coinDetailsTimeout, setCoinDetailsTimeout] = useState<NodeJS.Timeout | null>(null);
  const [uploadingImage, setUploadingImage] = useState(false);
  const [creatingCoin, setCreatingCoin] = useState(false);
  const { toast } = useToast();
  const fileInputRef = useRef<HTMLInputElement>(null);
  const newCoinImageRef = useRef<HTMLInputElement>(null);
  
  const [newCoin, setNewCoin] = useState({
    displayName: '',
    name: '',
    coinName: '',
    tickerSymbol: '',
    coinImageUrl: '',
    blockchain: '',
    contractAddress: '',
    rpcUrl: '',
    chainId: '',
    blockExplorerUrl: '',
    websiteUrl: '',
    description: '',
    flowSpeed: 1.2,
    msBetweeenDrops: 1,
    coinRate: 6,
    coinSize: 0.8,
  });
  
  const [coinDetails, setCoinDetails] = useState({
    coinImageUrl: currentTheme?.coin_image_url || '',
    coinName: currentTheme?.coin_name || '',
    blockchain: currentTheme?.blockchain || '',
    contractAddress: currentTheme?.contract_address || '',
    rpcUrl: currentTheme?.rpc_url || '',
    chainId: currentTheme?.chain_id || '',
    blockExplorerUrl: currentTheme?.block_explorer_url || '',
    tickerSymbol: currentTheme?.ticker_symbol || '',
    websiteUrl: currentTheme?.website_url || '',
    description: currentTheme?.description || '',
  });

  // Update coin details when theme changes
  useEffect(() => {
    if (currentTheme) {
      setCoinDetails({
        coinImageUrl: currentTheme.coin_image_url || '',
        coinName: currentTheme.coin_name || '',
        blockchain: currentTheme.blockchain || '',
        contractAddress: currentTheme.contract_address || '',
        rpcUrl: currentTheme.rpc_url || '',
        chainId: currentTheme.chain_id || '',
        blockExplorerUrl: currentTheme.block_explorer_url || '',
        tickerSymbol: currentTheme.ticker_symbol || '',
        websiteUrl: currentTheme.website_url || '',
        description: currentTheme.description || '',
      });
    }
  }, [currentTheme]);

  // Debounced save to database
  const handleSettingChange = (key: string, value: any) => {
    // Update local state immediately
    onSettingsChange(key, value);
    
    // Clear existing timeout
    if (saveTimeout) {
      clearTimeout(saveTimeout);
    }
    
    // Set new timeout to save to database
    const timeout = setTimeout(() => {
      const dbKey = key === 'flowSpeed' ? 'flow_speed' 
        : key === 'msBetweeenDrops' ? 'ms_between_drops'
        : key === 'coinRate' ? 'coin_rate'
        : key === 'coinSize' ? 'coin_size'
        : key === 'colorPalette' ? 'color_palette'
        : key;
      
      updateThemeSettings({ [dbKey]: value });
    }, 500);
    
    setSaveTimeout(timeout);
  };

  // Debounced coin details save
  const handleCoinDetailsChange = (field: string, value: string) => {
    setCoinDetails(prev => ({ ...prev, [field]: value }));
    
    if (coinDetailsTimeout) {
      clearTimeout(coinDetailsTimeout);
    }
    
    const timeout = setTimeout(() => {
      const dbField = field === 'coinImageUrl' ? 'coin_image_url'
        : field === 'coinName' ? 'coin_name'
        : field === 'contractAddress' ? 'contract_address'
        : field === 'rpcUrl' ? 'rpc_url'
        : field === 'chainId' ? 'chain_id'
        : field === 'blockExplorerUrl' ? 'block_explorer_url'
        : field === 'tickerSymbol' ? 'ticker_symbol'
        : field === 'websiteUrl' ? 'website_url'
        : field;
      
      updateThemeSettings({ [dbField]: value });
    }, 500);
    
    setCoinDetailsTimeout(timeout);
  };

  // Handle coin image upload
  const handleImageUpload = async (event: React.ChangeEvent<HTMLInputElement>) => {
    const file = event.target.files?.[0];
    if (!file) return;

    // Validate file type
    if (!file.type.match(/^image\/(png|webp)$/)) {
      toast({
        title: "Invalid file type",
        description: "Please upload a PNG or WebP image",
        variant: "destructive"
      });
      return;
    }

    setUploadingImage(true);
    try {
      const fileExt = file.name.split('.').pop();
      const fileName = `${currentTheme?.name}_${Date.now()}.${fileExt}`;
      const filePath = `${fileName}`;

      const { error: uploadError } = await supabase.storage
        .from('coin-images')
        .upload(filePath, file, { upsert: true });

      if (uploadError) throw uploadError;

      const { data: { publicUrl } } = supabase.storage
        .from('coin-images')
        .getPublicUrl(filePath);

      handleCoinDetailsChange('coinImageUrl', publicUrl);
      
      toast({
        title: "Image uploaded",
        description: "Coin image has been updated successfully"
      });
    } catch (error) {
      console.error('Failed to upload image:', error);
      toast({
        title: "Upload failed",
        description: "Failed to upload coin image",
        variant: "destructive"
      });
    } finally {
      setUploadingImage(false);
    }
  };

  // Handle new coin image upload
  const handleNewCoinImageUpload = async (event: React.ChangeEvent<HTMLInputElement>) => {
    const file = event.target.files?.[0];
    if (!file) return;

    if (!file.type.match(/^image\/(png|webp)$/)) {
      toast({
        title: "Invalid file type",
        description: "Please upload a PNG or WebP image",
        variant: "destructive"
      });
      return;
    }

    try {
      const fileExt = file.name.split('.').pop();
      const fileName = `${newCoin.name || 'new'}_${Date.now()}.${fileExt}`;
      const filePath = `${fileName}`;

      const { error: uploadError } = await supabase.storage
        .from('coin-images')
        .upload(filePath, file, { upsert: true });

      if (uploadError) throw uploadError;

      const { data: { publicUrl } } = supabase.storage
        .from('coin-images')
        .getPublicUrl(filePath);

      setNewCoin(prev => ({ ...prev, coinImageUrl: publicUrl }));
      
      toast({
        title: "Image uploaded",
        description: "Coin image ready for new token"
      });
    } catch (error) {
      console.error('Failed to upload image:', error);
      toast({
        title: "Upload failed",
        description: "Failed to upload coin image",
        variant: "destructive"
      });
    }
  };

  // Create new coin
  const handleCreateCoin = async () => {
    // Validation
    if (!newCoin.displayName.trim() || !newCoin.name.trim() || !newCoin.coinName.trim() || !newCoin.tickerSymbol.trim()) {
      toast({
        title: "Missing required fields",
        description: "Display Name, Internal Name, Coin Name, and Ticker Symbol are required",
        variant: "destructive"
      });
      return;
    }

    if (!newCoin.coinImageUrl) {
      toast({
        title: "Missing coin image",
        description: "Please upload a coin image before creating the token",
        variant: "destructive"
      });
      return;
    }

    setCreatingCoin(true);
    try {
      // Check if name already exists
      const { data: existingThemes } = await supabase
        .from('token_themes')
        .select('name, display_name')
        .or(`name.eq.${newCoin.name},display_name.eq.${newCoin.displayName}`);

      if (existingThemes && existingThemes.length > 0) {
        toast({
          title: "Name already exists",
          description: "A token with this name or display name already exists",
          variant: "destructive"
        });
        return;
      }

      // Default color palette
      const defaultColorPalette = [
        { hex: '#06c8c0', weight: 10 },
        { hex: '#028eef', weight: 10 },
        { hex: '#194ca8', weight: 20 },
        { hex: '#18488a', weight: 30 },
        { hex: '#103d6a', weight: 30 },
        { hex: '#0a2847', weight: 15 }
      ];

      // Insert new token theme
      const { data: newTheme, error: insertError } = await supabase
        .from('token_themes')
        .insert({
          name: newCoin.name.trim(),
          display_name: newCoin.displayName.trim(),
          coin_name: newCoin.coinName.trim(),
          ticker_symbol: newCoin.tickerSymbol.trim(),
          coin_image_url: newCoin.coinImageUrl,
          blockchain: newCoin.blockchain.trim() || null,
          contract_address: newCoin.contractAddress.trim() || null,
          rpc_url: newCoin.rpcUrl.trim() || null,
          chain_id: newCoin.chainId.trim() || null,
          block_explorer_url: newCoin.blockExplorerUrl.trim() || null,
          website_url: newCoin.websiteUrl.trim() || null,
          description: newCoin.description.trim() || null,
          flow_speed: newCoin.flowSpeed,
          ms_between_drops: newCoin.msBetweeenDrops,
          coin_rate: newCoin.coinRate,
          coin_size: newCoin.coinSize,
          color_palette: defaultColorPalette,
          is_active: false
        })
        .select()
        .single();

      if (insertError) throw insertError;

      // Get all existing users
      const { data: users, error: usersError } = await supabase
        .from('user_profiles')
        .select('user_id');

      if (usersError) throw usersError;

      // Create token balances for all existing users
      if (users && users.length > 0) {
        const balances = users.map(user => ({
          user_id: user.user_id,
          token_theme_id: newTheme.id,
          coins: 100
        }));

        const { error: balancesError } = await supabase
          .from('user_token_balances')
          .insert(balances);

        if (balancesError) throw balancesError;
      }

      toast({
        title: "Coin created successfully",
        description: `${newCoin.displayName} has been created and is ready to use`
      });

      // Reset form
      setNewCoin({
        displayName: '',
        name: '',
        coinName: '',
        tickerSymbol: '',
        coinImageUrl: '',
        blockchain: '',
        contractAddress: '',
        rpcUrl: '',
        chainId: '',
        blockExplorerUrl: '',
        websiteUrl: '',
        description: '',
        flowSpeed: 1.2,
        msBetweeenDrops: 1,
        coinRate: 6,
        coinSize: 0.8,
      });

      // Refresh themes and close dialog
      await refreshThemes();
      setShowAddCoinDialog(false);

      // Auto-select the new theme
      if (newTheme?.id) {
        await setActiveTheme(newTheme.id);
      }
    } catch (error) {
      console.error('Failed to create coin:', error);
      toast({
        title: "Failed to create coin",
        description: "Please try again",
        variant: "destructive"
      });
    } finally {
      setCreatingCoin(false);
    }
  };

  return (
    <Card className="waterfall-card w-full">
      {/* Coin Theme Selector */}
      <div className="mb-4 pb-3 border-b border-border">
        <div className="flex items-center justify-between mb-2">
          <Label className="text-xs opacity-85">Active Coin</Label>
          <Button
            variant="outline"
            size="sm"
            onClick={() => setShowAddCoinDialog(true)}
            className="h-7 px-2"
          >
            <Plus className="h-4 w-4 mr-1" />
            Add Coin
          </Button>
        </div>
        <Select 
          value={currentTheme?.id || ''} 
          onValueChange={setActiveTheme}
        >
          <SelectTrigger className="w-full">
            <SelectValue placeholder="Select coin theme" />
          </SelectTrigger>
          <SelectContent>
            {availableThemes.map(theme => (
              <SelectItem key={theme.id} value={theme.id}>
                {theme.display_name}
              </SelectItem>
            ))}
          </SelectContent>
        </Select>
      </div>

      {/* Coin Details Section */}
      <div className="mb-4 pb-3 border-b border-border">
        <div 
          className="flex items-center justify-between mb-3 cursor-pointer"
          onClick={() => setIsCoinDetailsCollapsed(!isCoinDetailsCollapsed)}
        >
          <h3 className="font-bold text-sm">COIN DETAILS</h3>
          {isCoinDetailsCollapsed ? (
            <ChevronRight className="h-4 w-4" />
          ) : (
            <ChevronDown className="h-4 w-4" />
          )}
        </div>

        {!isCoinDetailsCollapsed && (
          <div className="space-y-3 animate-fade-in">
            {/* Coin Image Upload */}
            <div className="space-y-2">
              <Label className="text-xs opacity-85">Coin Image</Label>
              <div className="flex items-center gap-3">
                {coinDetails.coinImageUrl && (
                  <img 
                    src={coinDetails.coinImageUrl} 
                    alt="Coin" 
                    className="w-12 h-12 rounded-full object-cover border border-border"
                  />
                )}
                <input
                  ref={fileInputRef}
                  type="file"
                  accept="image/png,image/webp"
                  onChange={handleImageUpload}
                  className="hidden"
                />
                <Button
                  variant="outline"
                  size="sm"
                  onClick={() => fileInputRef.current?.click()}
                  disabled={uploadingImage}
                  className="flex-1"
                >
                  <Upload className="w-4 h-4 mr-2" />
                  {uploadingImage ? 'Uploading...' : 'Upload Image'}
                </Button>
              </div>
              <p className="text-xs opacity-60">PNG or WebP format recommended</p>
            </div>

            {/* Coin Name */}
            <div className="space-y-1">
              <Label className="text-xs opacity-85">Coin Name</Label>
              <Input
                value={coinDetails.coinName}
                onChange={(e) => handleCoinDetailsChange('coinName', e.target.value)}
                placeholder="e.g., Waterfall Coin"
                className="text-sm"
              />
            </div>

            {/* Ticker Symbol */}
            <div className="space-y-1">
              <Label className="text-xs opacity-85">Ticker Symbol</Label>
              <Input
                value={coinDetails.tickerSymbol}
                onChange={(e) => handleCoinDetailsChange('tickerSymbol', e.target.value)}
                placeholder="e.g., WATER"
                className="text-sm"
              />
            </div>

            {/* Blockchain */}
            <div className="space-y-1">
              <Label className="text-xs opacity-85">Blockchain</Label>
              <Input
                value={coinDetails.blockchain}
                onChange={(e) => handleCoinDetailsChange('blockchain', e.target.value)}
                placeholder="e.g., Ethereum, Solana"
                className="text-sm"
              />
            </div>

            {/* Contract Address */}
            <div className="space-y-1">
              <Label className="text-xs opacity-85">Contract Address</Label>
              <Input
                value={coinDetails.contractAddress}
                onChange={(e) => handleCoinDetailsChange('contractAddress', e.target.value)}
                placeholder="0x..."
                className="text-sm font-mono"
              />
            </div>

            {/* RPC URL */}
            <div className="space-y-1">
              <Label className="text-xs opacity-85">RPC URL</Label>
              <Input
                value={coinDetails.rpcUrl}
                onChange={(e) => handleCoinDetailsChange('rpcUrl', e.target.value)}
                placeholder="https://..."
                className="text-sm"
              />
            </div>

            {/* Chain ID */}
            <div className="space-y-1">
              <Label className="text-xs opacity-85">Chain ID</Label>
              <Input
                value={coinDetails.chainId}
                onChange={(e) => handleCoinDetailsChange('chainId', e.target.value)}
                placeholder="e.g., 1, 56, 137"
                className="text-sm"
              />
            </div>

            {/* Block Explorer URL */}
            <div className="space-y-1">
              <Label className="text-xs opacity-85">Block Explorer URL</Label>
              <Input
                value={coinDetails.blockExplorerUrl}
                onChange={(e) => handleCoinDetailsChange('blockExplorerUrl', e.target.value)}
                placeholder="https://etherscan.io"
                className="text-sm"
              />
            </div>

            {/* Website URL */}
            <div className="space-y-1">
              <Label className="text-xs opacity-85">Website URL</Label>
              <Input
                value={coinDetails.websiteUrl}
                onChange={(e) => handleCoinDetailsChange('websiteUrl', e.target.value)}
                placeholder="https://..."
                className="text-sm"
              />
            </div>

            {/* Description */}
            <div className="space-y-1">
              <Label className="text-xs opacity-85">Description</Label>
              <Textarea
                value={coinDetails.description}
                onChange={(e) => handleCoinDetailsChange('description', e.target.value)}
                placeholder="Brief description of the coin..."
                className="text-sm min-h-[60px]"
              />
            </div>
          </div>
        )}
      </div>

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
              onValueChange={([value]) => handleSettingChange('flowSpeed', value)}
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
              onValueChange={([value]) => handleSettingChange('msBetweeenDrops', value)}
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
              onValueChange={([value]) => handleSettingChange('coinRate', value)}
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
              onValueChange={([value]) => handleSettingChange('coinSize', value)}
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
                      handleSettingChange('colorPalette', newPalette);
                    }}
                    className="w-6 h-6 p-0 border-0 cursor-pointer flex-shrink-0"
                  />
                  <Input
                    type="number"
                    value={colorWeight.weight}
                    onChange={(e) => {
                      const newPalette = [...settings.colorPalette];
                      newPalette[index] = { ...newPalette[index], weight: parseInt(e.target.value) || 0 };
                      handleSettingChange('colorPalette', newPalette);
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

      {/* Add Coin Dialog */}
      <Dialog open={showAddCoinDialog} onOpenChange={setShowAddCoinDialog}>
        <DialogContent className="max-w-2xl max-h-[90vh] overflow-y-auto">
          <DialogHeader>
            <DialogTitle>Create New Token</DialogTitle>
          </DialogHeader>
          
          <div className="space-y-4">
            {/* Display Name */}
            <div className="space-y-1">
              <Label>Display Name *</Label>
              <Input
                value={newCoin.displayName}
                onChange={(e) => setNewCoin({ ...newCoin, displayName: e.target.value })}
                placeholder="e.g., Bitcoin"
              />
            </div>

            {/* Internal Name */}
            <div className="space-y-1">
              <Label>Internal Name *</Label>
              <Input
                value={newCoin.name}
                onChange={(e) => setNewCoin({ ...newCoin, name: e.target.value.toLowerCase().replace(/\s+/g, '_') })}
                placeholder="e.g., bitcoin (lowercase, no spaces)"
              />
              <p className="text-xs text-muted-foreground">Used internally, must be unique</p>
            </div>

            {/* Coin Name */}
            <div className="space-y-1">
              <Label>Coin Name *</Label>
              <Input
                value={newCoin.coinName}
                onChange={(e) => setNewCoin({ ...newCoin, coinName: e.target.value })}
                placeholder="e.g., Bitcoin Coin"
              />
            </div>

            {/* Ticker Symbol */}
            <div className="space-y-1">
              <Label>Ticker Symbol *</Label>
              <Input
                value={newCoin.tickerSymbol}
                onChange={(e) => setNewCoin({ ...newCoin, tickerSymbol: e.target.value.toUpperCase() })}
                placeholder="e.g., BTC"
                maxLength={10}
              />
            </div>

            {/* Coin Image Upload */}
            <div className="space-y-2">
              <Label>Coin Image *</Label>
              <div className="flex items-center gap-3">
                {newCoin.coinImageUrl && (
                  <img 
                    src={newCoin.coinImageUrl} 
                    alt="Coin" 
                    className="w-12 h-12 rounded-full object-cover border border-border"
                  />
                )}
                <input
                  ref={newCoinImageRef}
                  type="file"
                  accept="image/png,image/webp"
                  onChange={handleNewCoinImageUpload}
                  className="hidden"
                />
                <Button
                  variant="outline"
                  size="sm"
                  onClick={() => newCoinImageRef.current?.click()}
                  className="flex-1"
                >
                  <Upload className="w-4 h-4 mr-2" />
                  Upload Image
                </Button>
              </div>
              <p className="text-xs text-muted-foreground">PNG or WebP format recommended</p>
            </div>

            {/* Blockchain */}
            <div className="space-y-1">
              <Label>Blockchain</Label>
              <Input
                value={newCoin.blockchain}
                onChange={(e) => setNewCoin({ ...newCoin, blockchain: e.target.value })}
                placeholder="e.g., Ethereum, Solana, BSC"
              />
            </div>

            {/* Contract Address */}
            <div className="space-y-1">
              <Label>Contract Address</Label>
              <Input
                value={newCoin.contractAddress}
                onChange={(e) => setNewCoin({ ...newCoin, contractAddress: e.target.value })}
                placeholder="0x..."
                className="font-mono text-sm"
              />
            </div>

            {/* RPC URL */}
            <div className="space-y-1">
              <Label>RPC URL</Label>
              <Input
                value={newCoin.rpcUrl}
                onChange={(e) => setNewCoin({ ...newCoin, rpcUrl: e.target.value })}
                placeholder="https://..."
              />
            </div>

            {/* Chain ID */}
            <div className="space-y-1">
              <Label>Chain ID</Label>
              <Input
                value={newCoin.chainId}
                onChange={(e) => setNewCoin({ ...newCoin, chainId: e.target.value })}
                placeholder="e.g., 1, 56, 137"
              />
            </div>

            {/* Block Explorer URL */}
            <div className="space-y-1">
              <Label>Block Explorer URL</Label>
              <Input
                value={newCoin.blockExplorerUrl}
                onChange={(e) => setNewCoin({ ...newCoin, blockExplorerUrl: e.target.value })}
                placeholder="https://etherscan.io"
              />
            </div>

            {/* Website URL */}
            <div className="space-y-1">
              <Label>Website URL</Label>
              <Input
                value={newCoin.websiteUrl}
                onChange={(e) => setNewCoin({ ...newCoin, websiteUrl: e.target.value })}
                placeholder="https://..."
              />
            </div>

            {/* Description */}
            <div className="space-y-1">
              <Label>Description</Label>
              <Textarea
                value={newCoin.description}
                onChange={(e) => setNewCoin({ ...newCoin, description: e.target.value })}
                placeholder="Brief description of the token..."
                className="min-h-[60px]"
              />
            </div>

            {/* Initial Visual Settings */}
            <div className="pt-4 border-t space-y-3">
              <h4 className="font-semibold text-sm">Initial Visual Settings</h4>
              
              <div className="grid grid-cols-2 gap-4">
                <div className="space-y-1">
                  <Label className="text-xs">Flow Speed</Label>
                  <Input
                    type="number"
                    step="0.1"
                    value={newCoin.flowSpeed}
                    onChange={(e) => setNewCoin({ ...newCoin, flowSpeed: parseFloat(e.target.value) || 1.2 })}
                  />
                </div>
                
                <div className="space-y-1">
                  <Label className="text-xs">MS Between Drops</Label>
                  <Input
                    type="number"
                    step="0.1"
                    value={newCoin.msBetweeenDrops}
                    onChange={(e) => setNewCoin({ ...newCoin, msBetweeenDrops: parseFloat(e.target.value) || 1 })}
                  />
                </div>
                
                <div className="space-y-1">
                  <Label className="text-xs">Coin Rate</Label>
                  <Input
                    type="number"
                    value={newCoin.coinRate}
                    onChange={(e) => setNewCoin({ ...newCoin, coinRate: parseInt(e.target.value) || 6 })}
                  />
                </div>
                
                <div className="space-y-1">
                  <Label className="text-xs">Coin Size</Label>
                  <Input
                    type="number"
                    step="0.1"
                    value={newCoin.coinSize}
                    onChange={(e) => setNewCoin({ ...newCoin, coinSize: parseFloat(e.target.value) || 0.8 })}
                  />
                </div>
              </div>
            </div>

            {/* Actions */}
            <div className="flex gap-2 justify-end pt-4 border-t">
              <Button
                variant="outline"
                onClick={() => setShowAddCoinDialog(false)}
                disabled={creatingCoin}
              >
                Cancel
              </Button>
              <Button
                onClick={handleCreateCoin}
                disabled={creatingCoin}
              >
                {creatingCoin ? 'Creating...' : 'Create Token'}
              </Button>
            </div>
          </div>
        </DialogContent>
      </Dialog>
    </Card>
  );
}
