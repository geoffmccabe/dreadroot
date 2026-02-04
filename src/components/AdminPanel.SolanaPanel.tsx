import React, { useState, useMemo, useCallback } from 'react';
import { Card } from '@/components/ui/card';
import { Badge } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select';
import { Tabs, TabsContent, TabsList, TabsTrigger } from '@/components/ui/tabs';
import { ScrollArea } from '@/components/ui/scroll-area';
import { useCoinTheme } from '@/contexts/CoinThemeContext';
import { ChevronDown, ChevronRight, ExternalLink, Copy, Check, Plus, Loader2, Upload, Pencil, Save } from 'lucide-react';
import { supabase } from '@/integrations/supabase/client';
import { useToast } from '@/hooks/use-toast';
import { HeliusPanel } from './AdminPanel.HeliusPanel';

function CopyButton({ text }: { text: string }) {
  const [copied, setCopied] = useState(false);
  return (
    <Button
      variant="ghost"
      size="sm"
      className="h-6 w-6 p-0"
      onClick={() => {
        navigator.clipboard.writeText(text);
        setCopied(true);
        setTimeout(() => setCopied(false), 1500);
      }}
    >
      {copied ? <Check className="w-3 h-3" /> : <Copy className="w-3 h-3" />}
    </Button>
  );
}

// --- Solana Coin Sub-tab ---

function SolanaCoinPanel() {
  const [network, setNetwork] = useState('mainnet-beta');
  const [linksOpen, setLinksOpen] = useState(true);

  const explorerBase = network === 'devnet'
    ? 'https://explorer.solana.com/?cluster=devnet'
    : 'https://explorer.solana.com';

  const solscanBase = network === 'devnet'
    ? 'https://solscan.io/?cluster=devnet'
    : 'https://solscan.io';

  return (
    <div className="space-y-4">
      <div className="flex items-center gap-2">
        <h3 className="text-lg font-semibold">Solana (SOL)</h3>
        <Badge variant="secondary">Native Coin</Badge>
      </div>

      {/* Network Selector */}
      <Card className="p-3">
        <div className="flex items-center justify-between">
          <span className="text-sm font-medium">Network</span>
          <Select value={network} onValueChange={setNetwork}>
            <SelectTrigger className="w-48">
              <SelectValue />
            </SelectTrigger>
            <SelectContent>
              <SelectItem value="mainnet-beta">Mainnet Beta</SelectItem>
              <SelectItem value="devnet">Devnet</SelectItem>
              <SelectItem value="testnet">Testnet</SelectItem>
            </SelectContent>
          </Select>
        </div>
      </Card>

      {/* SOL Info */}
      <Card className="p-3 space-y-2 bg-muted/30">
        <div className="grid grid-cols-[100px_1fr] gap-y-2 gap-x-3 text-sm">
          <span className="text-muted-foreground">Coin</span>
          <span className="font-medium">Solana</span>

          <span className="text-muted-foreground">Ticker</span>
          <span className="font-mono">SOL</span>

          <span className="text-muted-foreground">Blockchain</span>
          <Badge variant="outline" className="w-fit text-xs">Solana</Badge>

          <span className="text-muted-foreground">Type</span>
          <span className="text-xs">Native L1 coin</span>
        </div>
      </Card>

      {/* Quick Links */}
      <Card className="p-3">
        <button
          className="flex items-center gap-2 w-full text-left font-medium mb-2"
          onClick={() => setLinksOpen(!linksOpen)}
        >
          {linksOpen ? <ChevronDown className="w-4 h-4" /> : <ChevronRight className="w-4 h-4" />}
          Quick Links
        </button>

        {linksOpen && (
          <div className="space-y-2 mt-2">
            <a
              href={explorerBase}
              target="_blank"
              rel="noopener noreferrer"
              className="flex items-center gap-2 text-sm text-blue-400 hover:underline"
            >
              <ExternalLink className="w-3 h-3" /> Solana Explorer ({network})
            </a>
            <a
              href={solscanBase}
              target="_blank"
              rel="noopener noreferrer"
              className="flex items-center gap-2 text-sm text-blue-400 hover:underline"
            >
              <ExternalLink className="w-3 h-3" /> Solscan ({network})
            </a>
          </div>
        )}
      </Card>
    </div>
  );
}

// --- Tokens Sub-tab ---

function TokensPanel() {
  const { availableThemes, refreshThemes } = useCoinTheme();
  const { toast } = useToast();
  const [selectedTokenId, setSelectedTokenId] = useState<string | null>(null);
  const [addOpen, setAddOpen] = useState(false);
  const [saving, setSaving] = useState(false);
  const [editing, setEditing] = useState(false);
  const [uploadingImage, setUploadingImage] = useState(false);

  // Add token form state
  const [newName, setNewName] = useState('');
  const [newTicker, setNewTicker] = useState('');
  const [newAddress, setNewAddress] = useState('');
  const [newLogoUrl, setNewLogoUrl] = useState('');

  // Edit form state
  const [editName, setEditName] = useState('');
  const [editTicker, setEditTicker] = useState('');
  const [editAddress, setEditAddress] = useState('');
  const [editRpcUrl, setEditRpcUrl] = useState('');
  const [editExplorerUrl, setEditExplorerUrl] = useState('');

  const solanaTokens = useMemo(
    () => availableThemes.filter(t => t.blockchain?.toLowerCase() === 'solana'),
    [availableThemes]
  );

  const selectedToken = solanaTokens.find(t => t.id === selectedTokenId) || solanaTokens[0] || null;

  // Populate edit fields when selecting a token or entering edit mode
  const startEditing = useCallback(() => {
    if (!selectedToken) return;
    setEditName(selectedToken.display_name || '');
    setEditTicker(selectedToken.ticker_symbol || '');
    setEditAddress(selectedToken.contract_address || '');
    setEditRpcUrl(selectedToken.rpc_url || '');
    setEditExplorerUrl(selectedToken.block_explorer_url || '');
    setEditing(true);
  }, [selectedToken]);

  const handleSaveEdit = useCallback(async () => {
    if (!selectedToken) return;
    setSaving(true);
    try {
      const { error } = await supabase.from('token_themes').update({
        display_name: editName.trim() || selectedToken.display_name,
        ticker_symbol: editTicker.trim() || null,
        contract_address: editAddress.trim() || null,
        rpc_url: editRpcUrl.trim() || null,
        block_explorer_url: editExplorerUrl.trim() || null,
      }).eq('id', selectedToken.id);

      if (error) throw error;
      toast({ title: 'Token updated', duration: 2000 });
      setEditing(false);
      refreshThemes?.();
    } catch (err: any) {
      toast({ title: 'Failed to update token', description: err.message, duration: 3000 });
    } finally {
      setSaving(false);
    }
  }, [selectedToken, editName, editTicker, editAddress, editRpcUrl, editExplorerUrl, toast, refreshThemes]);

  const handleImageUpload = useCallback(async (e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0];
    if (!file || !selectedToken) return;

    if (!file.type.startsWith('image/')) {
      toast({ title: 'Please select an image file', duration: 2000 });
      return;
    }

    setUploadingImage(true);
    try {
      const fileExt = file.name.split('.').pop();
      const fileName = `${selectedToken.name}_${Date.now()}.${fileExt}`;

      const { error: uploadError } = await supabase.storage
        .from('coin-images')
        .upload(fileName, file, { upsert: true });

      if (uploadError) throw uploadError;

      const { data: { publicUrl } } = supabase.storage
        .from('coin-images')
        .getPublicUrl(fileName);

      const { error: updateError } = await supabase.from('token_themes')
        .update({ coin_image_url: publicUrl })
        .eq('id', selectedToken.id);

      if (updateError) throw updateError;

      toast({ title: 'Image uploaded', duration: 2000 });
      refreshThemes?.();
    } catch (err: any) {
      toast({ title: 'Upload failed', description: err.message, duration: 3000 });
    } finally {
      setUploadingImage(false);
    }
  }, [selectedToken, toast, refreshThemes]);

  const handleAddToken = useCallback(async () => {
    if (!newName.trim()) {
      toast({ title: 'Name is required', duration: 2000 });
      return;
    }
    if (!newAddress.trim()) {
      toast({ title: 'Token address is required', duration: 2000 });
      return;
    }

    setSaving(true);
    try {
      const slug = newName.trim().toLowerCase().replace(/[^a-z0-9]+/g, '-');
      const { error } = await supabase.from('token_themes').insert({
        name: slug,
        display_name: newName.trim(),
        ticker_symbol: newTicker.trim() || null,
        contract_address: newAddress.trim(),
        coin_image_url: newLogoUrl.trim() || null,
        blockchain: 'Solana',
        is_active: true,
        color_palette: [{ hex: '#9945FF', weight: 1 }],
      });

      if (error) throw error;

      toast({ title: 'Token added', duration: 2000 });
      setNewName('');
      setNewTicker('');
      setNewAddress('');
      setNewLogoUrl('');
      setAddOpen(false);
      refreshThemes?.();
    } catch (err: any) {
      toast({ title: 'Failed to add token', description: err.message, duration: 3000 });
    } finally {
      setSaving(false);
    }
  }, [newName, newTicker, newAddress, newLogoUrl, toast, refreshThemes]);

  return (
    <div className="space-y-4">
      <div className="flex items-center justify-between">
        <div className="flex items-center gap-2">
          <h3 className="text-lg font-semibold">Solana Tokens</h3>
          <Badge variant="secondary">{solanaTokens.length}</Badge>
        </div>
      </div>

      {/* Token List */}
      {solanaTokens.length === 0 ? (
        <Card className="p-3">
          <p className="text-sm text-muted-foreground">No Solana tokens configured yet.</p>
        </Card>
      ) : (
        <Card className="p-3 space-y-3">
          <Select
            value={selectedToken?.id || ''}
            onValueChange={(id) => { setSelectedTokenId(id); setEditing(false); }}
          >
            <SelectTrigger>
              <SelectValue placeholder="Select token" />
            </SelectTrigger>
            <SelectContent>
              {solanaTokens.map(t => (
                <SelectItem key={t.id} value={t.id}>
                  {t.display_name} ({t.ticker_symbol || '—'})
                </SelectItem>
              ))}
            </SelectContent>
          </Select>

          {selectedToken && !editing && (
            <Card className="p-3 space-y-2 bg-muted/30">
              <div className="grid grid-cols-[100px_1fr] gap-y-2 gap-x-3 text-sm">
                <span className="text-muted-foreground">Name</span>
                <span className="font-medium">{selectedToken.display_name}</span>

                <span className="text-muted-foreground">Ticker</span>
                <span className="font-mono">{selectedToken.ticker_symbol || '—'}</span>

                <span className="text-muted-foreground">Contract</span>
                <div className="flex items-center gap-1">
                  <span className="font-mono text-xs truncate">{selectedToken.contract_address || '—'}</span>
                  {selectedToken.contract_address && <CopyButton text={selectedToken.contract_address} />}
                </div>

                <span className="text-muted-foreground">Logo</span>
                <div className="flex items-center gap-2">
                  {selectedToken.coin_image_url ? (
                    <img src={selectedToken.coin_image_url} alt="" className="w-8 h-8 rounded" />
                  ) : (
                    <span className="text-xs text-muted-foreground">—</span>
                  )}
                  <label className="cursor-pointer">
                    <input type="file" accept="image/*" className="hidden" onChange={handleImageUpload} />
                    <Button variant="ghost" size="sm" className="h-7 px-2" asChild disabled={uploadingImage}>
                      <span>
                        {uploadingImage ? <Loader2 className="w-3 h-3 animate-spin" /> : <Upload className="w-3 h-3" />}
                      </span>
                    </Button>
                  </label>
                </div>

                <span className="text-muted-foreground">RPC URL</span>
                <div className="flex items-center gap-1">
                  <span className="font-mono text-xs truncate">{selectedToken.rpc_url || '—'}</span>
                  {selectedToken.rpc_url && <CopyButton text={selectedToken.rpc_url} />}
                </div>

                <span className="text-muted-foreground">Explorer</span>
                {selectedToken.block_explorer_url ? (
                  <a
                    href={selectedToken.block_explorer_url}
                    target="_blank"
                    rel="noopener noreferrer"
                    className="text-xs text-blue-400 hover:underline flex items-center gap-1"
                  >
                    {selectedToken.block_explorer_url} <ExternalLink className="w-3 h-3" />
                  </a>
                ) : (
                  <span className="text-xs text-muted-foreground">—</span>
                )}
              </div>

              <Button variant="outline" size="sm" className="mt-2" onClick={startEditing}>
                <Pencil className="w-3 h-3 mr-1" /> Edit
              </Button>
            </Card>
          )}

          {selectedToken && editing && (
            <Card className="p-3 space-y-3 bg-muted/30">
              <div>
                <label className="text-xs text-muted-foreground mb-1 block">Display Name</label>
                <Input value={editName} onChange={e => setEditName(e.target.value)} />
              </div>
              <div>
                <label className="text-xs text-muted-foreground mb-1 block">Ticker Symbol</label>
                <Input value={editTicker} onChange={e => setEditTicker(e.target.value)} />
              </div>
              <div>
                <label className="text-xs text-muted-foreground mb-1 block">Contract Address</label>
                <Input value={editAddress} onChange={e => setEditAddress(e.target.value)} className="font-mono text-xs" />
              </div>
              <div>
                <label className="text-xs text-muted-foreground mb-1 block">RPC URL</label>
                <Input value={editRpcUrl} onChange={e => setEditRpcUrl(e.target.value)} className="font-mono text-xs" />
              </div>
              <div>
                <label className="text-xs text-muted-foreground mb-1 block">Block Explorer URL</label>
                <Input value={editExplorerUrl} onChange={e => setEditExplorerUrl(e.target.value)} className="font-mono text-xs" />
              </div>
              <div className="flex gap-2">
                <Button size="sm" onClick={handleSaveEdit} disabled={saving}>
                  {saving ? <Loader2 className="w-3 h-3 animate-spin mr-1" /> : <Save className="w-3 h-3 mr-1" />}
                  Save
                </Button>
                <Button variant="outline" size="sm" onClick={() => setEditing(false)}>Cancel</Button>
              </div>
            </Card>
          )}
        </Card>
      )}

      {/* Add Token */}
      <Card className="p-3">
        <button
          className="flex items-center gap-2 w-full text-left font-medium"
          onClick={() => setAddOpen(!addOpen)}
        >
          {addOpen ? <ChevronDown className="w-4 h-4" /> : <Plus className="w-4 h-4" />}
          Add Token
        </button>

        {addOpen && (
          <div className="mt-3 space-y-3">
            <div>
              <label className="text-xs text-muted-foreground mb-1 block">Display Name *</label>
              <Input
                placeholder="e.g. Harold"
                value={newName}
                onChange={e => setNewName(e.target.value)}
              />
            </div>
            <div>
              <label className="text-xs text-muted-foreground mb-1 block">Ticker Symbol</label>
              <Input
                placeholder="e.g. HAROLD"
                value={newTicker}
                onChange={e => setNewTicker(e.target.value)}
              />
            </div>
            <div>
              <label className="text-xs text-muted-foreground mb-1 block">Token Address (Contract) *</label>
              <Input
                placeholder="Solana token mint address"
                value={newAddress}
                onChange={e => setNewAddress(e.target.value)}
                className="font-mono text-xs"
              />
            </div>
            <div>
              <label className="text-xs text-muted-foreground mb-1 block">Coin Logo URL</label>
              <Input
                placeholder="https://..."
                value={newLogoUrl}
                onChange={e => setNewLogoUrl(e.target.value)}
              />
            </div>
            <Button onClick={handleAddToken} disabled={saving}>
              {saving ? <Loader2 className="w-4 h-4 animate-spin mr-1" /> : null}
              Add Solana Token
            </Button>
          </div>
        )}
      </Card>
    </div>
  );
}

// --- Main SolanaPanel with 3 sub-tabs ---

export function SolanaPanel() {
  const [subtab, setSubtab] = useState<'solana-coin' | 'tokens' | 'data-providers'>('solana-coin');

  return (
    <Tabs value={subtab} onValueChange={v => setSubtab(v as typeof subtab)} className="flex flex-col h-full">
      <TabsList className="grid w-full grid-cols-3 flex-shrink-0 mb-4">
        <TabsTrigger value="solana-coin">Solana Coin</TabsTrigger>
        <TabsTrigger value="tokens">Tokens</TabsTrigger>
        <TabsTrigger value="data-providers">Data Providers</TabsTrigger>
      </TabsList>

      <TabsContent value="solana-coin" className="flex-1 overflow-hidden mt-0">
        <ScrollArea className="h-[calc(90vh-290px)] pr-4">
          <SolanaCoinPanel />
        </ScrollArea>
      </TabsContent>

      <TabsContent value="tokens" className="flex-1 overflow-hidden mt-0">
        <ScrollArea className="h-[calc(90vh-290px)] pr-4">
          <TokensPanel />
        </ScrollArea>
      </TabsContent>

      <TabsContent value="data-providers" className="flex-1 overflow-hidden mt-0">
        <ScrollArea className="h-[calc(90vh-290px)] pr-4">
          <HeliusPanel />
        </ScrollArea>
      </TabsContent>
    </Tabs>
  );
}
