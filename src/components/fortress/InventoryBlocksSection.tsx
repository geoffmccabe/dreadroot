/**
 * InventoryBlocksSection
 *
 * Blocks (wisp tiers, fortress stone, glowing block, etc.) live in
 * user_inventory and never appeared in the in-game inventory — the SlotGrid
 * only renders weapon/item rows (item_type='item'). This small section, shown
 * under the inventory SlotGrid, lists the OWNED placeable blocks with a
 * texture/colour swatch + count, and selects one for placement on click
 * (same selection the B-mode cycle uses).
 *
 * Kept as its own module so the large FortressHUD only gains a one-line render.
 */
import React, { useMemo } from 'react';
import { useBlocksData } from '@/hooks/useBlocksData';

interface InvRow { item_type: string; item_id: string | null; quantity: number }

interface Props {
  inventory: InvRow[];
  selectedBlockType?: string | null;
  onSelectBlock?: (blockType: string) => void;
}

// Same rule as the B-mode cycle: real placeable blocks only (not items,
// seeds, or the tree trunk/fruit types).
function isPlaceableBlock(itemType: string): boolean {
  if (!itemType || itemType === 'item') return false;
  if (itemType.startsWith('seed_tier_')) return false;
  if (itemType === 'trunk' || itemType === 'fruit') return false;
  return true;
}

export function InventoryBlocksSection({ inventory, selectedBlockType, onSelectBlock }: Props) {
  const { getBlockByKey } = useBlocksData();

  const owned = useMemo(() => {
    const qty = new Map<string, number>();
    for (const it of inventory || []) {
      if (it.quantity > 0 && isPlaceableBlock(it.item_type)) {
        qty.set(it.item_type, (qty.get(it.item_type) || 0) + it.quantity);
      }
    }
    return Array.from(qty.entries())
      .map(([blockType, quantity]) => ({ blockType, quantity }))
      .sort((a, b) => {
        const ta = getBlockByKey(a.blockType)?.tier ?? 0;
        const tb = getBlockByKey(b.blockType)?.tier ?? 0;
        return ta - tb || a.blockType.localeCompare(b.blockType);
      });
  }, [inventory, getBlockByKey]);

  if (owned.length === 0) return null;

  return (
    <div style={{ display: 'flex', flexDirection: 'column', gap: '4px', marginTop: '8px' }}>
      <span style={{
        fontSize: '11px',
        fontWeight: 700,
        color: 'hsl(var(--hud-text))',
        fontFamily: 'var(--hud-font)',
        letterSpacing: '0.05em',
      }}>
        BLOCKS
      </span>
      <div style={{ display: 'flex', flexWrap: 'wrap', gap: '6px' }}>
        {owned.map(({ blockType, quantity }) => {
          const def = getBlockByKey(blockType);
          const textureUrl = def?.texture?.diffuse;
          const color = def?.properties?.color || '#8B7355';
          const selected = selectedBlockType === blockType;
          return (
            <button
              key={blockType}
              type="button"
              title={`${def?.name || blockType} ×${quantity}`}
              onClick={() => onSelectBlock?.(blockType)}
              style={{
                position: 'relative',
                width: '40px',
                height: '40px',
                borderRadius: '6px',
                border: selected
                  ? '2px solid hsl(var(--hud-highlight))'
                  : `1px solid ${color}DD`,
                background: textureUrl
                  ? `url(${textureUrl}) center/cover`
                  : `linear-gradient(135deg, ${color}, ${color}CC)`,
                cursor: onSelectBlock ? 'pointer' : 'default',
                padding: 0,
              }}
            >
              <span style={{
                position: 'absolute',
                right: '1px',
                bottom: '0px',
                fontSize: '10px',
                fontWeight: 700,
                color: '#fff',
                textShadow: '0 0 2px #000, 0 0 2px #000',
                fontFamily: 'var(--hud-font)',
              }}>
                {quantity}
              </span>
            </button>
          );
        })}
      </div>
    </div>
  );
}

export default InventoryBlocksSection;
