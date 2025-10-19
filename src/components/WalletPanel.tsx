import { Dialog, DialogContent, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";
import { Input } from "@/components/ui/input";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { ScrollArea } from "@/components/ui/scroll-area";
import { useUserData } from "@/hooks/useUserData";
import { BLOCK_REGISTRY } from "@/data/blockRegistry";
import { BlockType } from "@/types/blocks";
import { Coins, Wallet } from "lucide-react";
import { useState, useRef, useEffect } from "react";
import { toast } from "@/hooks/use-toast";

interface WalletPanelProps {
  isOpen: boolean;
  onClose: () => void;
  defaultTab?: 'inventory' | 'store' | 'wallet';
  onBlockPurchased?: () => void;
}

const getRarityColor = (rarity: BlockType['rarity']) => {
  switch (rarity) {
    case 'common': return 'bg-muted text-muted-foreground';
    case 'rare': return 'bg-blue-500 text-white';
    case 'epic': return 'bg-purple-500 text-white';
    case 'legendary': return 'bg-amber-500 text-white';
  }
};

const BlockIcon = ({ block }: { block: BlockType }) => {
  const color = block.properties?.color || '#808080';
  const isEmissive = block.properties?.emissive || false;
  const isTransparent = block.properties?.transparent || false;

  return (
    <div 
      className="w-16 h-16 rounded-md border-2 border-border flex items-center justify-center relative overflow-hidden"
      style={{ 
        backgroundColor: color,
        boxShadow: isEmissive ? `0 0 20px ${color}` : 'none',
        opacity: isTransparent ? 0.6 : 1
      }}
    >
      <div 
        className="absolute inset-0"
        style={{
          background: isEmissive ? `radial-gradient(circle, ${color} 0%, transparent 70%)` : 'none'
        }}
      />
    </div>
  );
};

export function WalletPanel({ isOpen, onClose, defaultTab = 'inventory', onBlockPurchased }: WalletPanelProps) {
  const { profile, inventory, isLoading, buyBlock, updateBlockchainAddress } = useUserData();
  const [blockchainAddressInput, setBlockchainAddressInput] = useState('');
  const [purchasingBlock, setPurchasingBlock] = useState<string | null>(null);
  const audioRef = useRef<HTMLAudioElement | null>(null);

  useEffect(() => {
    audioRef.current = new Audio('/coin_hit_sound.mp3');
  }, []);

  useEffect(() => {
    if (profile?.blockchain_address) {
      setBlockchainAddressInput(profile.blockchain_address);
    }
  }, [profile]);

  const handleUpdateBlockchainAddress = async () => {
    if (!blockchainAddressInput.trim()) {
      toast({
        title: "Invalid Address",
        description: "Please enter a valid blockchain address",
        variant: "destructive"
      });
      return;
    }

    const success = await updateBlockchainAddress(blockchainAddressInput);
    if (success) {
      toast({
        title: "Success",
        description: "Blockchain address updated"
      });
    }
  };

  const handleBuyBlock = async (blockKey: string, cost: number) => {
    setPurchasingBlock(blockKey);
    const success = await buyBlock(blockKey, cost);
    
    if (success) {
      audioRef.current?.play();
      toast({
        title: "Purchase Successful",
        description: `You bought a ${BLOCK_REGISTRY[blockKey].name}!`
      });
      onBlockPurchased?.();
    }
    
    setPurchasingBlock(null);
  };

  const availableBlocks: BlockType[] = Object.values(BLOCK_REGISTRY);

  if (isLoading) {
    return (
      <Dialog open={isOpen} onOpenChange={onClose}>
        <DialogContent className="max-w-2xl">
          <DialogHeader>
            <DialogTitle>Wallet</DialogTitle>
          </DialogHeader>
          <div className="flex items-center justify-center p-8">
            <p className="text-muted-foreground">Loading...</p>
          </div>
        </DialogContent>
      </Dialog>
    );
  }

  return (
    <Dialog open={isOpen} onOpenChange={onClose}>
      <DialogContent className="max-w-2xl max-h-[80vh] overflow-hidden">
        <DialogHeader>
          <DialogTitle className="flex items-center gap-2">
            <Wallet className="w-5 h-5" />
            Wallet
          </DialogTitle>
        </DialogHeader>

        <Tabs defaultValue={defaultTab} className="w-full">
          <TabsList className="grid w-full grid-cols-3">
            <TabsTrigger value="inventory">Inventory</TabsTrigger>
            <TabsTrigger value="store">Store</TabsTrigger>
            <TabsTrigger value="wallet">Wallet</TabsTrigger>
          </TabsList>

          <TabsContent value="inventory" className="mt-4">
            <ScrollArea className="h-[50vh] pr-4">
              <div className="space-y-4">
                <div className="flex items-center justify-between p-4 bg-primary/10 rounded-lg">
                  <div className="flex items-center gap-2">
                    <Coins className="w-6 h-6 text-primary" />
                    <span className="text-2xl font-bold">{profile?.coins || 0}</span>
                  </div>
                  <span className="text-sm text-muted-foreground">Coins</span>
                </div>

                <div className="space-y-3">
                  <h3 className="font-semibold">Blocks</h3>
                  {inventory
                    ?.filter(item => item.quantity > 0)
                    .map(item => {
                      const block = BLOCK_REGISTRY[item.item_type];
                      if (!block) return null;
                      
                      return (
                        <Card key={item.id}>
                          <CardHeader className="pb-3">
                            <div className="flex items-start justify-between">
                              <div className="flex gap-3">
                                <BlockIcon block={block} />
                                <div>
                                  <CardTitle className="text-lg">{block.name}</CardTitle>
                                  <CardDescription className="text-sm mt-1">
                                    {block.description}
                                  </CardDescription>
                                </div>
                              </div>
                              <div className="text-right">
                                <div className="text-2xl font-bold">{item.quantity}</div>
                                <div className="text-xs text-muted-foreground">owned</div>
                              </div>
                            </div>
                          </CardHeader>
                        </Card>
                      );
                    })}
                  
                  {(!inventory || inventory.filter(item => item.quantity > 0).length === 0) && (
                    <p className="text-muted-foreground text-center py-8">
                      No blocks in inventory. Visit the Store to purchase some!
                    </p>
                  )}
                </div>
              </div>
            </ScrollArea>
          </TabsContent>

          <TabsContent value="store" className="mt-4">
            <div className="flex items-center justify-between mb-4 p-3 bg-primary/10 rounded-lg">
              <span className="text-sm font-medium">Your Balance:</span>
              <div className="flex items-center gap-2">
                <Coins className="w-5 h-5 text-primary" />
                <span className="text-xl font-bold">{profile?.coins || 0}</span>
              </div>
            </div>

            <ScrollArea className="h-[45vh] pr-4">
              <div className="space-y-3">
                {availableBlocks.map(block => {
                  const userInventory = inventory?.find(item => item.item_type === block.key);
                  const canAfford = (profile?.coins || 0) >= block.cost;
                  const isPurchasing = purchasingBlock === block.key;

                  return (
                    <Card key={block.id}>
                      <CardHeader>
                        <div className="flex items-start gap-4">
                          <BlockIcon block={block} />
                          
                          <div className="flex-1">
                            <div className="flex items-start justify-between mb-2">
                              <div>
                                <CardTitle className="text-lg">{block.name}</CardTitle>
                                <CardDescription className="text-sm mt-1">
                                  {block.description}
                                </CardDescription>
                              </div>
                              <Badge className={getRarityColor(block.rarity)}>
                                {block.rarity}
                              </Badge>
                            </div>

                            <div className="flex items-center justify-between mt-3">
                              <div className="flex items-center gap-4">
                                <div className="flex items-center gap-2">
                                  <Coins className="w-4 h-4 text-primary" />
                                  <span className="font-bold">{block.cost}</span>
                                </div>
                                <div className="text-sm text-muted-foreground">
                                  Category: {block.category}
                                </div>
                                {userInventory && userInventory.quantity > 0 && (
                                  <div className="text-sm font-medium">
                                    Owned: {userInventory.quantity}
                                  </div>
                                )}
                              </div>

                              <Button
                                onClick={() => handleBuyBlock(block.key, block.cost)}
                                disabled={!canAfford || isPurchasing}
                                size="sm"
                              >
                                {isPurchasing ? "Buying..." : "Buy"}
                              </Button>
                            </div>
                          </div>
                        </div>
                      </CardHeader>
                    </Card>
                  );
                })}
              </div>
            </ScrollArea>
          </TabsContent>

          <TabsContent value="wallet" className="mt-4">
            <ScrollArea className="h-[50vh] pr-4">
              <div className="space-y-4">
                <Card>
                  <CardHeader>
                    <CardTitle>Balance</CardTitle>
                  </CardHeader>
                  <CardContent>
                    <div className="flex items-center gap-3 p-4 bg-primary/10 rounded-lg">
                      <Coins className="w-8 h-8 text-primary" />
                      <div>
                        <div className="text-3xl font-bold">{profile?.coins || 0}</div>
                        <div className="text-sm text-muted-foreground">Coins Available</div>
                      </div>
                    </div>
                  </CardContent>
                </Card>

                <Card>
                  <CardHeader>
                    <CardTitle>Blockchain Address</CardTitle>
                    <CardDescription>
                      Your Waterfall Network address for future integrations
                    </CardDescription>
                  </CardHeader>
                  <CardContent className="space-y-3">
                    <Input
                      placeholder="Enter your blockchain address"
                      value={blockchainAddressInput}
                      onChange={(e) => setBlockchainAddressInput(e.target.value)}
                      onBlur={handleUpdateBlockchainAddress}
                      onKeyDown={(e) => {
                        if (e.key === 'Enter') {
                          handleUpdateBlockchainAddress();
                        }
                      }}
                    />
                    <p className="text-xs text-muted-foreground">
                      Press Enter or click away to save
                    </p>
                  </CardContent>
                </Card>

                <Card>
                  <CardHeader>
                    <CardTitle>Network Information</CardTitle>
                  </CardHeader>
                  <CardContent className="space-y-2">
                    <div className="flex justify-between">
                      <span className="text-sm text-muted-foreground">Network:</span>
                      <span className="text-sm font-medium">Waterfall Network</span>
                    </div>
                    <div className="flex justify-between">
                      <span className="text-sm text-muted-foreground">Chain ID:</span>
                      <span className="text-sm font-medium">181</span>
                    </div>
                    <div className="flex justify-between">
                      <span className="text-sm text-muted-foreground">Native Token:</span>
                      <span className="text-sm font-medium">WATER</span>
                    </div>
                    <div className="flex justify-between">
                      <span className="text-sm text-muted-foreground">RPC Endpoint:</span>
                      <span className="text-sm font-mono text-xs">https://181.rpc.thirdweb.com</span>
                    </div>
                  </CardContent>
                </Card>

                <Card className="border-dashed">
                  <CardHeader>
                    <CardTitle>Web3 Wallet Connection</CardTitle>
                    <CardDescription>
                      Connect your wallet for on-chain interactions
                    </CardDescription>
                  </CardHeader>
                  <CardContent>
                    <Button variant="outline" disabled className="w-full">
                      Connect Wallet (Coming Soon)
                    </Button>
                  </CardContent>
                </Card>
              </div>
            </ScrollArea>
          </TabsContent>
        </Tabs>
      </DialogContent>
    </Dialog>
  );
}
