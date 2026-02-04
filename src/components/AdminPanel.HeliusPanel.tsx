import React, { useState, useEffect, useCallback } from 'react';
import { Card } from '@/components/ui/card';
import { Badge } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Textarea } from '@/components/ui/textarea';
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select';
import { Switch } from '@/components/ui/switch';
import { ChevronDown, ChevronRight, Eye, EyeOff, Copy, Check, Loader2 } from 'lucide-react';
import { supabase } from '@/integrations/supabase/client';
import { useToast } from '@/hooks/use-toast';

// --- Helpers ---

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

function CollapsibleSection({ title, badge, defaultOpen = false, children }: {
  title: string;
  badge?: string;
  defaultOpen?: boolean;
  children: React.ReactNode;
}) {
  const [open, setOpen] = useState(defaultOpen);
  return (
    <Card className="p-3">
      <button
        className="flex items-center gap-2 w-full text-left font-medium"
        onClick={() => setOpen(!open)}
      >
        {open ? <ChevronDown className="w-4 h-4" /> : <ChevronRight className="w-4 h-4" />}
        {title}
        {badge && <Badge variant="secondary" className="text-xs ml-auto">{badge}</Badge>}
      </button>
      {open && <div className="mt-3 space-y-3">{children}</div>}
    </Card>
  );
}

function EndpointBlock({ name, description, children }: {
  name: string;
  description: string;
  children: React.ReactNode;
}) {
  return (
    <div className="border rounded p-3 space-y-2">
      <div>
        <span className="font-mono text-sm font-semibold">{name}</span>
        <p className="text-xs text-muted-foreground mt-0.5">{description}</p>
      </div>
      {children}
    </div>
  );
}

function JsonViewer({ data }: { data: unknown }) {
  if (!data) return null;
  return (
    <pre className="bg-black/30 rounded p-2 text-xs font-mono overflow-auto max-h-60 whitespace-pre-wrap">
      {JSON.stringify(data, null, 2)}
    </pre>
  );
}

// --- Main Panel ---

export function HeliusPanel() {
  const { toast } = useToast();
  const [network, setNetwork] = useState<'mainnet' | 'devnet'>('mainnet');

  // API Key state
  const [apiKeyInput, setApiKeyInput] = useState('');
  const [showKey, setShowKey] = useState(false);
  const [keyStatus, setKeyStatus] = useState<{ configured: boolean; lastFour: string | null }>({ configured: false, lastFour: null });
  const [savingKey, setSavingKey] = useState(false);

  // Test query state — keyed by endpoint name
  const [testInputs, setTestInputs] = useState<Record<string, Record<string, string>>>({});
  const [testResults, setTestResults] = useState<Record<string, unknown>>({});
  const [testLoading, setTestLoading] = useState<Record<string, boolean>>({});
  const [testToggles, setTestToggles] = useState<Record<string, Record<string, boolean>>>({});

  // Load key status on mount
  useEffect(() => {
    checkKeyStatus();
  }, []);

  const checkKeyStatus = useCallback(async () => {
    try {
      const { data, error } = await supabase.functions.invoke('helius-proxy', {
        body: { action: 'getKeyStatus' },
      });
      if (!error && data) {
        setKeyStatus({ configured: data.configured, lastFour: data.lastFour });
      }
    } catch {
      // Edge function not deployed yet — ignore
    }
  }, []);

  const handleSaveKey = useCallback(async () => {
    if (!apiKeyInput || apiKeyInput.length < 10) {
      toast({ title: 'Invalid API key', description: 'Key must be at least 10 characters', duration: 3000 });
      return;
    }
    setSavingKey(true);
    try {
      const { data, error } = await supabase.functions.invoke('helius-proxy', {
        body: { action: 'saveKey', apiKey: apiKeyInput },
      });
      if (error) throw error;
      if (data?.success) {
        setKeyStatus({ configured: true, lastFour: data.lastFour });
        setApiKeyInput('');
        toast({ title: 'API key saved', duration: 2000 });
      }
    } catch (err: any) {
      toast({ title: 'Failed to save key', description: err.message, duration: 3000 });
    } finally {
      setSavingKey(false);
    }
  }, [apiKeyInput, toast]);

  // Generic test query via edge function
  const runTest = useCallback(async (endpointKey: string, action: string, method?: string, params?: unknown) => {
    setTestLoading(prev => ({ ...prev, [endpointKey]: true }));
    setTestResults(prev => ({ ...prev, [endpointKey]: null }));
    try {
      const { data, error } = await supabase.functions.invoke('helius-proxy', {
        body: { action, method, params, network },
      });
      if (error) throw error;
      setTestResults(prev => ({ ...prev, [endpointKey]: data }));
    } catch (err: any) {
      setTestResults(prev => ({ ...prev, [endpointKey]: { error: err.message } }));
    } finally {
      setTestLoading(prev => ({ ...prev, [endpointKey]: false }));
    }
  }, [network]);

  const getInput = (endpoint: string, field: string) => testInputs[endpoint]?.[field] || '';
  const setInput = (endpoint: string, field: string, value: string) => {
    setTestInputs(prev => ({ ...prev, [endpoint]: { ...prev[endpoint], [field]: value } }));
  };
  const getToggle = (endpoint: string, field: string) => testToggles[endpoint]?.[field] || false;
  const setToggle = (endpoint: string, field: string, value: boolean) => {
    setTestToggles(prev => ({ ...prev, [endpoint]: { ...prev[endpoint], [field]: value } }));
  };

  const rpcHost = network === 'devnet' ? 'devnet.helius-rpc.com' : 'mainnet.helius-rpc.com';

  return (
    <div className="space-y-4">
      {/* Header */}
      <div className="flex items-center gap-2">
        <h3 className="text-lg font-semibold">Helius</h3>
        <Badge variant="secondary">Data Supplier</Badge>
      </div>

      {/* Section 1: API Key Configuration */}
      <Card className="p-4 space-y-3">
        <div className="flex items-center justify-between">
          <span className="font-medium">API Key</span>
          <Badge variant={keyStatus.configured ? 'default' : 'destructive'}>
            {keyStatus.configured ? `Configured (…${keyStatus.lastFour})` : 'Not Set'}
          </Badge>
        </div>

        <div className="flex gap-2">
          <div className="relative flex-1">
            <Input
              type={showKey ? 'text' : 'password'}
              placeholder="Enter Helius API key"
              value={apiKeyInput}
              onChange={e => setApiKeyInput(e.target.value)}
            />
            <button
              className="absolute right-2 top-1/2 -translate-y-1/2 text-muted-foreground"
              onClick={() => setShowKey(!showKey)}
            >
              {showKey ? <EyeOff className="w-4 h-4" /> : <Eye className="w-4 h-4" />}
            </button>
          </div>
          <Button onClick={handleSaveKey} disabled={savingKey || !apiKeyInput}>
            {savingKey ? <Loader2 className="w-4 h-4 animate-spin" /> : 'Save'}
          </Button>
        </div>

        <div className="flex items-center justify-between">
          <span className="text-sm font-medium">Network</span>
          <Select value={network} onValueChange={v => setNetwork(v as 'mainnet' | 'devnet')}>
            <SelectTrigger className="w-40">
              <SelectValue />
            </SelectTrigger>
            <SelectContent>
              <SelectItem value="mainnet">Mainnet</SelectItem>
              <SelectItem value="devnet">Devnet</SelectItem>
            </SelectContent>
          </Select>
        </div>
      </Card>

      {/* Section 2: RPC Endpoints */}
      <CollapsibleSection title="RPC Endpoints" badge="URLs">
        <div className="space-y-2">
          <div className="flex items-center gap-2">
            <Badge variant="outline" className="text-xs">Mainnet</Badge>
            <code className="text-xs bg-black/30 px-2 py-1 rounded flex-1 truncate">
              https://mainnet.helius-rpc.com/?api-key=YOUR_KEY
            </code>
            <CopyButton text={`https://mainnet.helius-rpc.com/?api-key=YOUR_KEY`} />
          </div>
          <div className="flex items-center gap-2">
            <Badge variant="outline" className="text-xs">Devnet</Badge>
            <code className="text-xs bg-black/30 px-2 py-1 rounded flex-1 truncate">
              https://devnet.helius-rpc.com/?api-key=YOUR_KEY
            </code>
            <CopyButton text={`https://devnet.helius-rpc.com/?api-key=YOUR_KEY`} />
          </div>
        </div>
      </CollapsibleSection>

      {/* Section 3: DAS API — NFTs & cNFTs */}
      <CollapsibleSection title="DAS API — NFTs & cNFTs" badge="Compressed NFTs">
        <EndpointBlock name="getAsset" description="Get a single asset (NFT, cNFT, or token) by its ID">
          <Input
            placeholder="Asset ID"
            value={getInput('getAsset', 'id')}
            onChange={e => setInput('getAsset', 'id', e.target.value)}
          />
          <Button
            size="sm"
            disabled={!getInput('getAsset', 'id') || testLoading['getAsset']}
            onClick={() => runTest('getAsset', 'dasQuery', 'getAsset', { id: getInput('getAsset', 'id') })}
          >
            {testLoading['getAsset'] ? <Loader2 className="w-3 h-3 animate-spin mr-1" /> : null} Test
          </Button>
          <JsonViewer data={testResults['getAsset']} />
        </EndpointBlock>

        <EndpointBlock name="getAssetsByOwner" description="Get all assets owned by a wallet — supports cNFTs, NFTs, and tokens">
          <Input
            placeholder="Owner wallet address"
            value={getInput('getAssetsByOwner', 'owner')}
            onChange={e => setInput('getAssetsByOwner', 'owner', e.target.value)}
          />
          <div className="flex items-center gap-4 text-sm">
            <label className="flex items-center gap-1.5">
              <Switch checked={getToggle('getAssetsByOwner', 'showFungible')} onCheckedChange={v => setToggle('getAssetsByOwner', 'showFungible', v)} />
              Show Fungible
            </label>
            <label className="flex items-center gap-1.5">
              <Switch checked={getToggle('getAssetsByOwner', 'showNative')} onCheckedChange={v => setToggle('getAssetsByOwner', 'showNative', v)} />
              Show Native Balance
            </label>
          </div>
          <Button
            size="sm"
            disabled={!getInput('getAssetsByOwner', 'owner') || testLoading['getAssetsByOwner']}
            onClick={() => runTest('getAssetsByOwner', 'dasQuery', 'getAssetsByOwner', {
              ownerAddress: getInput('getAssetsByOwner', 'owner'),
              displayOptions: {
                showFungible: getToggle('getAssetsByOwner', 'showFungible'),
                showNativeBalance: getToggle('getAssetsByOwner', 'showNative'),
              },
            })}
          >
            {testLoading['getAssetsByOwner'] ? <Loader2 className="w-3 h-3 animate-spin mr-1" /> : null} Test
          </Button>
          <JsonViewer data={testResults['getAssetsByOwner']} />
        </EndpointBlock>

        <EndpointBlock name="getAssetProof" description="Get Merkle proof for a compressed NFT — required for transfers and burns">
          <Input
            placeholder="cNFT Asset ID"
            value={getInput('getAssetProof', 'id')}
            onChange={e => setInput('getAssetProof', 'id', e.target.value)}
          />
          <Button
            size="sm"
            disabled={!getInput('getAssetProof', 'id') || testLoading['getAssetProof']}
            onClick={() => runTest('getAssetProof', 'dasQuery', 'getAssetProof', { id: getInput('getAssetProof', 'id') })}
          >
            {testLoading['getAssetProof'] ? <Loader2 className="w-3 h-3 animate-spin mr-1" /> : null} Test
          </Button>
          <JsonViewer data={testResults['getAssetProof']} />
        </EndpointBlock>

        <EndpointBlock name="searchAssets" description="Search assets by collection, owner, or compression status">
          <Input
            placeholder="Owner address (optional)"
            value={getInput('searchAssets', 'owner')}
            onChange={e => setInput('searchAssets', 'owner', e.target.value)}
          />
          <Input
            placeholder="Collection ID (optional)"
            value={getInput('searchAssets', 'collection')}
            onChange={e => setInput('searchAssets', 'collection', e.target.value)}
          />
          <label className="flex items-center gap-1.5 text-sm">
            <Switch checked={getToggle('searchAssets', 'compressed')} onCheckedChange={v => setToggle('searchAssets', 'compressed', v)} />
            Compressed only (cNFTs)
          </label>
          <Button
            size="sm"
            disabled={testLoading['searchAssets']}
            onClick={() => {
              const p: Record<string, unknown> = {};
              if (getInput('searchAssets', 'owner')) p.ownerAddress = getInput('searchAssets', 'owner');
              if (getInput('searchAssets', 'collection')) p.grouping = ['collection', getInput('searchAssets', 'collection')];
              if (getToggle('searchAssets', 'compressed')) p.compressed = true;
              runTest('searchAssets', 'dasQuery', 'searchAssets', p);
            }}
          >
            {testLoading['searchAssets'] ? <Loader2 className="w-3 h-3 animate-spin mr-1" /> : null} Test
          </Button>
          <JsonViewer data={testResults['searchAssets']} />
        </EndpointBlock>

        <EndpointBlock name="getAssetProofBatch" description="Batch Merkle proofs for multiple compressed NFTs">
          <Textarea
            placeholder="Asset IDs (one per line)"
            value={getInput('getAssetProofBatch', 'ids')}
            onChange={e => setInput('getAssetProofBatch', 'ids', e.target.value)}
            rows={3}
          />
          <Button
            size="sm"
            disabled={!getInput('getAssetProofBatch', 'ids') || testLoading['getAssetProofBatch']}
            onClick={() => {
              const ids = getInput('getAssetProofBatch', 'ids').split('\n').map(s => s.trim()).filter(Boolean);
              runTest('getAssetProofBatch', 'dasQuery', 'getAssetProofBatch', { ids });
            }}
          >
            {testLoading['getAssetProofBatch'] ? <Loader2 className="w-3 h-3 animate-spin mr-1" /> : null} Test
          </Button>
          <JsonViewer data={testResults['getAssetProofBatch']} />
        </EndpointBlock>
      </CollapsibleSection>

      {/* Section 4: DAS API — Tokens */}
      <CollapsibleSection title="DAS API — Tokens" badge="Fungible">
        <EndpointBlock name="getAssetsByOwner (fungible)" description="Get all fungible token balances for a wallet">
          <Input
            placeholder="Owner wallet address"
            value={getInput('tokensByOwner', 'owner')}
            onChange={e => setInput('tokensByOwner', 'owner', e.target.value)}
          />
          <Button
            size="sm"
            disabled={!getInput('tokensByOwner', 'owner') || testLoading['tokensByOwner']}
            onClick={() => runTest('tokensByOwner', 'dasQuery', 'getAssetsByOwner', {
              ownerAddress: getInput('tokensByOwner', 'owner'),
              displayOptions: { showFungible: true, showNativeBalance: true },
            })}
          >
            {testLoading['tokensByOwner'] ? <Loader2 className="w-3 h-3 animate-spin mr-1" /> : null} Test
          </Button>
          <JsonViewer data={testResults['tokensByOwner']} />
        </EndpointBlock>

        <EndpointBlock name="getTokenAccounts" description="Get token accounts for an owner or mint address">
          <Input
            placeholder="Owner or mint address"
            value={getInput('getTokenAccounts', 'address')}
            onChange={e => setInput('getTokenAccounts', 'address', e.target.value)}
          />
          <Button
            size="sm"
            disabled={!getInput('getTokenAccounts', 'address') || testLoading['getTokenAccounts']}
            onClick={() => runTest('getTokenAccounts', 'dasQuery', 'getTokenAccounts', {
              owner: getInput('getTokenAccounts', 'address'),
            })}
          >
            {testLoading['getTokenAccounts'] ? <Loader2 className="w-3 h-3 animate-spin mr-1" /> : null} Test
          </Button>
          <JsonViewer data={testResults['getTokenAccounts']} />
        </EndpointBlock>
      </CollapsibleSection>

      {/* Section 5: Enhanced Transactions */}
      <CollapsibleSection title="Enhanced Transactions" badge="Decoded">
        <EndpointBlock name="getTransactions" description="Get enriched transaction data by signature(s)">
          <Textarea
            placeholder="Transaction signatures (one per line)"
            value={getInput('getTransactions', 'sigs')}
            onChange={e => setInput('getTransactions', 'sigs', e.target.value)}
            rows={3}
          />
          <Button
            size="sm"
            disabled={!getInput('getTransactions', 'sigs') || testLoading['getTransactions']}
            onClick={() => {
              const sigs = getInput('getTransactions', 'sigs').split('\n').map(s => s.trim()).filter(Boolean);
              runTest('getTransactions', 'enhancedTransactions', undefined, undefined);
              // Use the enhanced transactions endpoint
              supabase.functions.invoke('helius-proxy', {
                body: {
                  action: 'enhancedTransactions',
                  endpoint: 'transactions',
                  network,
                  requestBody: { transactions: sigs },
                },
              }).then(({ data }) => {
                setTestResults(prev => ({ ...prev, getTransactions: data }));
                setTestLoading(prev => ({ ...prev, getTransactions: false }));
              });
            }}
          >
            {testLoading['getTransactions'] ? <Loader2 className="w-3 h-3 animate-spin mr-1" /> : null} Test
          </Button>
          <JsonViewer data={testResults['getTransactions']} />
        </EndpointBlock>

        <EndpointBlock name="getTransactionsByAddress" description="Get decoded transaction history for a wallet address">
          <Input
            placeholder="Wallet address"
            value={getInput('txByAddress', 'address')}
            onChange={e => setInput('txByAddress', 'address', e.target.value)}
          />
          <Button
            size="sm"
            disabled={!getInput('txByAddress', 'address') || testLoading['txByAddress']}
            onClick={async () => {
              setTestLoading(prev => ({ ...prev, txByAddress: true }));
              try {
                const { data } = await supabase.functions.invoke('helius-proxy', {
                  body: {
                    action: 'enhancedTransactions',
                    endpoint: `addresses/${getInput('txByAddress', 'address')}/transactions`,
                    network,
                  },
                });
                setTestResults(prev => ({ ...prev, txByAddress: data }));
              } finally {
                setTestLoading(prev => ({ ...prev, txByAddress: false }));
              }
            }}
          >
            {testLoading['txByAddress'] ? <Loader2 className="w-3 h-3 animate-spin mr-1" /> : null} Test
          </Button>
          <JsonViewer data={testResults['txByAddress']} />
        </EndpointBlock>
      </CollapsibleSection>

      {/* Section 6: Webhooks */}
      <CollapsibleSection title="Webhooks" badge="Events">
        <p className="text-xs text-muted-foreground">
          Webhooks let you receive real-time notifications for on-chain events like token transfers,
          NFT sales, and cNFT changes. Each webhook can monitor up to 100,000 addresses.
        </p>
        <Button
          size="sm"
          disabled={testLoading['webhookList']}
          onClick={async () => {
            setTestLoading(prev => ({ ...prev, webhookList: true }));
            try {
              const { data } = await supabase.functions.invoke('helius-proxy', {
                body: { action: 'webhooks', webhookAction: 'list', network },
              });
              setTestResults(prev => ({ ...prev, webhookList: data }));
            } finally {
              setTestLoading(prev => ({ ...prev, webhookList: false }));
            }
          }}
        >
          {testLoading['webhookList'] ? <Loader2 className="w-3 h-3 animate-spin mr-1" /> : null} List Webhooks
        </Button>
        <JsonViewer data={testResults['webhookList']} />
      </CollapsibleSection>

      {/* Section 7: Priority Fees */}
      <CollapsibleSection title="Priority Fees" badge="Gas">
        <EndpointBlock name="getPriorityFeeEstimate" description="Get recommended priority fees based on current network congestion">
          <Textarea
            placeholder="Account keys (one per line)"
            value={getInput('priorityFees', 'keys')}
            onChange={e => setInput('priorityFees', 'keys', e.target.value)}
            rows={2}
          />
          <Select
            value={getInput('priorityFees', 'level') || 'Medium'}
            onValueChange={v => setInput('priorityFees', 'level', v)}
          >
            <SelectTrigger className="w-40">
              <SelectValue />
            </SelectTrigger>
            <SelectContent>
              <SelectItem value="Min">Min</SelectItem>
              <SelectItem value="Low">Low</SelectItem>
              <SelectItem value="Medium">Medium</SelectItem>
              <SelectItem value="High">High</SelectItem>
              <SelectItem value="VeryHigh">Very High</SelectItem>
            </SelectContent>
          </Select>
          <Button
            size="sm"
            disabled={testLoading['priorityFees']}
            onClick={() => {
              const keys = getInput('priorityFees', 'keys').split('\n').map(s => s.trim()).filter(Boolean);
              runTest('priorityFees', 'priorityFees', undefined, {
                accountKeys: keys.length > 0 ? keys : undefined,
                options: { priorityLevel: getInput('priorityFees', 'level') || 'Medium' },
              });
            }}
          >
            {testLoading['priorityFees'] ? <Loader2 className="w-3 h-3 animate-spin mr-1" /> : null} Estimate
          </Button>
          <JsonViewer data={testResults['priorityFees']} />
        </EndpointBlock>
      </CollapsibleSection>
    </div>
  );
}
