// VipCornerBorder — a 2px inner L-accent in the bottom-left corner of the User
// Panel that "flexes" the player's supporter tier. Grey for basic users, then
// gold / green / blue as they rank up. Colors come from the shared --vip-* CSS
// vars (index.css), the same source the Admin → Users name colors read, so they
// always match. Decorative (pointer-events: none); only mounts with the panel.
import React from 'react';
import { useSupporterStatus } from '@/features/supporters/useSupporterStatus';
import { vipColorVar } from '@/components/admin-users/vipStyle';

export function VipCornerBorder({ userId, isSuperadmin = false }: { userId: string | null; isSuperadmin?: boolean }) {
  const { currentLevel } = useSupporterStatus(userId);
  // Superadmin is a role, not a purchasable tier — it overrides the tier color.
  const color = isSuperadmin ? 'var(--vip-super)' : vipColorVar(currentLevel);
  return (
    <div
      aria-hidden
      style={{
        position: 'absolute',
        left: 5,
        bottom: 5,
        width: 84,
        height: 84,
        borderLeft: `2px solid ${color}`,
        borderBottom: `2px solid ${color}`,
        borderBottomLeftRadius: 'var(--hud-radius)',
        pointerEvents: 'none',
        zIndex: 7,
      }}
    />
  );
}
