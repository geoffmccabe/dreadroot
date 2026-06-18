// SiegeStartModal — shown once when the world loads. Lets the player pick Challenge (opens the
// Challenge Browser to choose which authored challenge to play) or Open World (free roam).
import { useState } from 'react';
import { Button } from '@/components/ui/button';
import { Card } from '@/components/ui/card';
import { setBrowserOpen } from './challenge/challengeBrowserStore';

let shownThisSession = false;

export function SiegeStartModal() {
  const [open, setOpen] = useState(!shownThisSession);
  if (!open) return null;

  const choose = (challenge: boolean) => {
    shownThisSession = true;
    setOpen(false);
    // Challenge Mode → open the Browser so the player chooses which challenge to play.
    if (challenge) setBrowserOpen(true);
  };

  return (
    <div className="fixed inset-0 z-[120] flex items-center justify-center"
         style={{ background: 'rgba(0,0,0,0.65)', backdropFilter: 'blur(2px)' }}>
      <Card className="p-6 w-[340px] text-center space-y-4">
        <h2 className="text-xl font-bold">Choose a Mode</h2>
        <p className="text-sm text-muted-foreground">
          Pick a Challenge to fight, or roam the Open World.
        </p>
        <div className="flex flex-col gap-3 pt-1">
          <Button size="lg" onClick={() => choose(true)}>⚔️ Challenge</Button>
          <Button size="lg" variant="secondary" onClick={() => choose(false)}>🌍 Open World</Button>
        </div>
      </Card>
    </div>
  );
}
