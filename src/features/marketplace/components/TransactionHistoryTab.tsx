// TransactionHistoryTab - View buy/sell transaction history

import React, { useState, useEffect } from 'react';
import { ScrollArea } from '@/components/ui/scroll-area';
import { Tabs, TabsContent, TabsList, TabsTrigger } from '@/components/ui/tabs';
import { Badge } from '@/components/ui/badge';
import { supabase } from '@/integrations/supabase/client';
import type { MarketplaceTransaction } from '../types';
import { formatDivi } from '../types';
import { CATEGORY_LABELS, getFruitTierName } from '../constants';

interface TransactionHistoryTabProps {
  userId: string | null;
}

export function TransactionHistoryTab({ userId }: TransactionHistoryTabProps) {
  const [transactions, setTransactions] = useState<MarketplaceTransaction[]>([]);
  const [isLoading, setIsLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [viewMode, setViewMode] = useState<'all' | 'purchases' | 'sales'>('all');

  useEffect(() => {
    if (!userId) {
      setTransactions([]);
      setIsLoading(false);
      return;
    }

    const fetchTransactions = async () => {
      setIsLoading(true);
      setError(null);

      try {
        const { data, error: fetchError } = await supabase
          .from('marketplace_transactions')
          .select(`
            *,
            seller_profile:profiles!seller_id(display_name, avatar_url),
            buyer_profile:profiles!buyer_id(display_name, avatar_url)
          `)
          .or(`seller_id.eq.${userId},buyer_id.eq.${userId}`)
          .order('completed_at', { ascending: false })
          .limit(100);

        if (fetchError) {
          console.error('[TransactionHistoryTab] Fetch error:', fetchError);
          setError(fetchError.message);
          return;
        }

        setTransactions(data as MarketplaceTransaction[]);
      } catch (err) {
        console.error('[TransactionHistoryTab] Error:', err);
        setError(err instanceof Error ? err.message : 'Unknown error');
      } finally {
        setIsLoading(false);
      }
    };

    fetchTransactions();
  }, [userId]);

  if (!userId) {
    return (
      <div className="h-full flex items-center justify-center text-muted-foreground">
        Please log in to view transaction history.
      </div>
    );
  }

  // Filter transactions based on view mode
  const filteredTransactions = transactions.filter(t => {
    if (viewMode === 'purchases') return t.buyer_id === userId;
    if (viewMode === 'sales') return t.seller_id === userId;
    return true;
  });

  // Calculate totals
  const totals = {
    spent: transactions
      .filter(t => t.buyer_id === userId)
      .reduce((sum, t) => sum + t.total_divi, 0),
    earned: transactions
      .filter(t => t.seller_id === userId)
      .reduce((sum, t) => sum + t.total_divi, 0),
  };

  return (
    <div className="h-full flex flex-col gap-4">
      {/* Summary cards */}
      <div className="grid grid-cols-2 gap-4">
        <div className="p-4 rounded-lg" style={{ background: 'hsla(var(--hud-bg), 0.4)' }}>
          <div className="text-sm text-muted-foreground">Total Spent</div>
          <div className="text-xl font-bold" style={{ color: '#ff6b6b' }}>
            -{formatDivi(totals.spent)} DIVI
          </div>
        </div>
        <div className="p-4 rounded-lg" style={{ background: 'hsla(var(--hud-bg), 0.4)' }}>
          <div className="text-sm text-muted-foreground">Total Earned</div>
          <div className="text-xl font-bold" style={{ color: '#51cf66' }}>
            +{formatDivi(totals.earned)} DIVI
          </div>
        </div>
      </div>

      {/* View mode tabs */}
      <Tabs value={viewMode} onValueChange={(v) => setViewMode(v as any)}>
        <TabsList className="grid w-full grid-cols-3">
          <TabsTrigger value="all">All ({transactions.length})</TabsTrigger>
          <TabsTrigger value="purchases">
            Purchases ({transactions.filter(t => t.buyer_id === userId).length})
          </TabsTrigger>
          <TabsTrigger value="sales">
            Sales ({transactions.filter(t => t.seller_id === userId).length})
          </TabsTrigger>
        </TabsList>
      </Tabs>

      {/* Transaction list */}
      <ScrollArea className="flex-1">
        {isLoading ? (
          <div className="text-center py-8 text-muted-foreground">Loading transactions...</div>
        ) : error ? (
          <div className="text-center py-8 text-red-400">Error: {error}</div>
        ) : filteredTransactions.length === 0 ? (
          <div className="text-center py-8 text-muted-foreground">
            No transactions found.
          </div>
        ) : (
          <div className="space-y-2 pr-4">
            {filteredTransactions.map((tx) => {
              const isBuyer = tx.buyer_id === userId;
              const otherParty = isBuyer ? tx.seller_profile : tx.buyer_profile;
              const otherName = otherParty?.display_name || 'Anonymous';

              // Get item display name
              let itemName = 'Unknown Item';
              if (tx.item_category === 'block' && tx.item_type) {
                itemName = tx.item_type;
              } else if (tx.item_category === 'seed' && tx.seed_tier) {
                itemName = `Tier ${tx.seed_tier} Seed`;
              } else if (tx.item_category === 'fruit' && tx.fruit_tier) {
                itemName = `${getFruitTierName(tx.fruit_tier)} Fruit`;
              }

              return (
                <div
                  key={tx.id}
                  className="p-3 rounded-lg flex items-center justify-between"
                  style={{ background: 'hsla(var(--hud-bg), 0.4)' }}
                >
                  <div className="flex items-center gap-3">
                    <div
                      className={`w-8 h-8 rounded-full flex items-center justify-center text-sm font-bold ${
                        isBuyer ? 'bg-red-500/20 text-red-400' : 'bg-green-500/20 text-green-400'
                      }`}
                    >
                      {isBuyer ? '-' : '+'}
                    </div>
                    <div>
                      <div className="font-medium">
                        {itemName}
                        {tx.quantity > 1 && <span className="text-muted-foreground"> x{tx.quantity}</span>}
                      </div>
                      <div className="text-xs text-muted-foreground">
                        {isBuyer ? 'Bought from' : 'Sold to'} {otherName}
                      </div>
                    </div>
                  </div>

                  <div className="text-right">
                    <div
                      className="font-bold"
                      style={{ color: isBuyer ? '#ff6b6b' : '#51cf66' }}
                    >
                      {isBuyer ? '-' : '+'}{formatDivi(tx.total_divi)} DIVI
                    </div>
                    <div className="text-xs text-muted-foreground">
                      {new Date(tx.completed_at).toLocaleDateString()}
                    </div>
                  </div>
                </div>
              );
            })}
          </div>
        )}
      </ScrollArea>
    </div>
  );
}
