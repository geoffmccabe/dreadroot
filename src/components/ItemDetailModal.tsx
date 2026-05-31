// ItemDetailModal — full-screen overlay showing one item's details.
// Opens when any QS / inventory / vault tile is right-clicked.
// Click outside or press Esc to close.

import React from 'react';
import { useItemDetail } from '@/contexts/ItemDetailContext';

function spriteFor(itemNumber: number | null, texture_url: string | null): string | null {
  if (texture_url) return texture_url;
  if (itemNumber != null && itemNumber >= 0 && itemNumber <= 228) {
    return `/item-sprites/${itemNumber}.webp`;
  }
  return null;
}

// Pretty label for an item-def field. Keys not in this map fall back
// to the raw key with underscores → spaces.
const FIELD_LABELS: Record<string, string> = {
  tier: 'Tier',
  rarity: 'Rarity',
  item_category: 'Category',
  item_number: 'Item #',
  damage_per_hit: 'Damage / hit',
  cost: 'Cost',
  forge_family: 'Forge family',
  pickup_cooldown_seconds: 'Pickup cooldown (s)',
  description: 'Description',
  key: 'Internal key',
  class: 'Class',
};
// Hide noisy / internal fields from the detail list.
const HIDDEN_FIELDS = new Set([
  'id', 'created_at', 'updated_at', 'name', 'texture_url',
]);

export function ItemDetailModal() {
  const { open, close } = useItemDetail();
  if (!open) return null;

  const sprite = open.fullDef
    ? spriteFor(open.fullDef.item_number ?? null, open.fullDef.texture_url ?? null)
    : open.sprite;
  const name = open.fullDef?.name ?? open.name ?? 'Unknown item';

  const def = open.fullDef ?? {};
  const detailRows: Array<{ label: string; value: string }> = [];
  for (const [key, value] of Object.entries(def)) {
    if (HIDDEN_FIELDS.has(key)) continue;
    if (value == null || value === '') continue;
    const label = FIELD_LABELS[key] ?? key.replace(/_/g, ' ');
    let displayValue: string;
    if (typeof value === 'boolean') displayValue = value ? 'yes' : 'no';
    else if (typeof value === 'object') displayValue = JSON.stringify(value);
    else displayValue = String(value);
    detailRows.push({ label, value: displayValue });
  }
  // Sort: known labels first (in FIELD_LABELS order), then alphabetical.
  const knownOrder = Object.keys(FIELD_LABELS);
  detailRows.sort((a, b) => {
    const aIdx = knownOrder.findIndex(k => FIELD_LABELS[k] === a.label);
    const bIdx = knownOrder.findIndex(k => FIELD_LABELS[k] === b.label);
    if (aIdx >= 0 && bIdx >= 0) return aIdx - bIdx;
    if (aIdx >= 0) return -1;
    if (bIdx >= 0) return 1;
    return a.label.localeCompare(b.label);
  });

  return (
    <div
      onClick={close}
      style={{
        position: 'fixed',
        inset: 0,
        background: 'rgba(0,0,0,0.55)',
        zIndex: 9999,
        display: 'flex',
        alignItems: 'center',
        justifyContent: 'center',
        backdropFilter: 'blur(2px)',
      }}
    >
      <div
        onClick={(e) => e.stopPropagation()}
        onContextMenu={(e) => e.preventDefault()}
        style={{
          width: 'min(540px, 92vw)',
          maxHeight: '85vh',
          background: 'hsla(211, 30%, 18%, 0.97)',
          border: '1px solid hsla(211, 34%, 73%, 0.7)',
          borderRadius: 8,
          padding: 20,
          color: 'hsl(0, 0%, 95%)',
          fontFamily: 'Inter, sans-serif',
          overflowY: 'auto',
          position: 'relative',
        }}
      >
        {/* Top-right close (X) */}
        <button
          onClick={close}
          style={{
            position: 'absolute',
            top: 8,
            right: 10,
            background: 'transparent',
            border: 'none',
            color: 'hsl(0, 0%, 80%)',
            fontSize: 22,
            cursor: 'pointer',
            lineHeight: 1,
          }}
          aria-label="Close"
        >
          ×
        </button>

        {/* Header row: name + tier on left, sprite on right */}
        <div style={{ display: 'flex', gap: 16, alignItems: 'flex-start', marginBottom: 16 }}>
          <div style={{ flex: 1, minWidth: 0 }}>
            <h2 style={{ fontSize: 22, fontWeight: 700, margin: 0, lineHeight: 1.2 }}>{name}</h2>
            {open.tier != null && (
              <div style={{ marginTop: 4, fontSize: 14, opacity: 0.85 }}>
                Tier {open.tier}
              </div>
            )}
            {open.quantity > 1 && (
              <div style={{ marginTop: 4, fontSize: 13, opacity: 0.7 }}>
                Quantity: {open.quantity}
              </div>
            )}
          </div>
          <div
            style={{
              flexShrink: 0,
              width: 128,
              height: 128,
              background: 'hsla(0,0%,0%,0.3)',
              border: '1px solid hsla(0,0%,100%,0.15)',
              borderRadius: 6,
              display: 'flex',
              alignItems: 'center',
              justifyContent: 'center',
              overflow: 'hidden',
            }}
          >
            {sprite ? (
              <img
                src={sprite}
                alt={name}
                style={{ width: '100%', height: '100%', objectFit: 'contain' }}
              />
            ) : (
              <span style={{ fontSize: 11, opacity: 0.5 }}>no sprite</span>
            )}
          </div>
        </div>

        {/* Detail rows */}
        {detailRows.length > 0 ? (
          <div style={{ borderTop: '1px solid hsla(0,0%,100%,0.1)', paddingTop: 12 }}>
            {detailRows.map(({ label, value }) => (
              <div
                key={label}
                style={{
                  display: 'flex',
                  justifyContent: 'space-between',
                  gap: 16,
                  padding: '4px 0',
                  fontSize: 13,
                  borderBottom: '1px solid hsla(0,0%,100%,0.05)',
                }}
              >
                <span style={{ opacity: 0.75, textTransform: 'capitalize' }}>{label}</span>
                <span style={{ textAlign: 'right', maxWidth: '60%', wordWrap: 'break-word' }}>
                  {value}
                </span>
              </div>
            ))}
          </div>
        ) : open.fullDef === null && open.itemId ? (
          <div style={{ opacity: 0.6, fontSize: 13 }}>Loading details…</div>
        ) : (
          <div style={{ opacity: 0.6, fontSize: 13 }}>No additional details.</div>
        )}
      </div>
    </div>
  );
}
