// SiegeHUD — the Siege Worlds HUD overlay. Reuses the SAME shared HUD components as the
// Dreadroot Fortress HUD (PlayerStatusPanel, InstructionsPanel), fed from the shared data
// hooks that SW's App already provides (useUserData / useCoinTheme / useUserPanel). The
// quick-access + inventory (center) is the next piece to wire here.

import { useUserData } from '@/hooks/useUserData';
import { useCoinTheme } from '@/contexts/CoinThemeContext';
import { useUserPanel } from '@/contexts/UserPanelContext';
import { PlayerStatusPanel } from '@/components/hud/PlayerStatusPanel';
import { InstructionsPanel } from '@/components/hud/InstructionsPanel';
import { CombatTelemetryOverlay } from '@/components/siege/CombatTelemetry';

export function SiegeHUD() {
  const { profile, tokenBalance } = useUserData();
  const { currentTheme } = useCoinTheme();
  const { openPanel } = useUserPanel();

  const displayCoin = {
    imageUrl: currentTheme?.coin_image_url || '',
    coins: tokenBalance?.coins ?? 0,
    name: 'Coins',
  };

  return (
    <>
      {/* Bottom-left: player status (avatar / name / level / coins / health). Reused. */}
      <div className="fixed bottom-4 left-4 z-20" style={{ display: 'flex', alignItems: 'center', gap: '8px' }}>
        <PlayerStatusPanel
          profile={profile}
          displayCoin={displayCoin}
          currentHealth={100}
          maxHealth={100}
          showBlocks={false}             /* non-voxel game — no block counter */
          onOpenUser={() => openPanel('user')}
        />
      </div>

      {/* Bottom-right: info panel. Reused. */}
      <InstructionsPanel
        line1="Click to shoot • R for crosshairs"
        line2="WASD move • Space jump • Shift run • I = Inventory"
      />

      {/* Top-right: combat recorder (pause + copy the timing/spacing of every hit). */}
      <CombatTelemetryOverlay />
    </>
  );
}
