// SiegeAnimPanel — the inspect-view animation list, in Dreadroot's CSS (waterfall-card +
// waterfall-button + theme classes), per the project rule that EVERY panel uses the game's
// style. It lives in the normal React tree (outside the Canvas) and reads the clip list +
// play() that CharacterRig publishes via the siegeCharacter bridge.
import { Card } from '@/components/ui/card';
import {
  useSiegeAnim, useSiegeCharacter, isInspectView, getSelectedCharacter,
} from '@/config/siegeCharacter';

// "Root|3D_Idle_Movement 1|Animation Base Layer" → "Idle"
const cleanAnim = (n: string) =>
  (n.split('|')[1] || n).replace(/3D_/g, '').replace(/_Movement/gi, '').replace(/\s*\d+$/, '').replace(/_/g, ' ').trim() || n;

export function SiegeAnimPanel() {
  useSiegeCharacter();               // re-render on inspect / character change
  const { names, current, play } = useSiegeAnim();
  // LookUp/LookDown are additive neck-only "look" layers (meant to stack on a base pose via a
  // vertical-look mask in-game); standalone they snap the body to T-pose, so don't list them.
  const playable = names.filter((n) => !/look\s*(up|down)/i.test(n));
  if (!isInspectView() || playable.length === 0) return null;

  return (
    <Card className="waterfall-card fixed left-3 top-[190px] z-50 flex w-44 max-h-[70vh] flex-col gap-1 overflow-y-auto">
      <div className="mb-1 text-xs font-semibold uppercase tracking-wider text-muted-foreground">
        {getSelectedCharacter()} — animations
      </div>
      {playable.map((n) => (
        <button
          key={n}
          onClick={() => play(n)}
          className={`waterfall-button w-full truncate !px-2 !py-1 text-left text-xs ${
            current === n ? '!bg-accent !text-accent-foreground' : ''
          }`}
        >
          {cleanAnim(n)}
        </button>
      ))}
    </Card>
  );
}
