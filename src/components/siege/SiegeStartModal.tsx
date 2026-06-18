// SiegeStartModal — shown once when the Siege world loads. Lets testers pick Challenge (auto-runs
// the wave challenge, no need to remember "!c") or Open World (free roam). Both begin at Bleakrock.
import { useState } from 'react';
import { Button } from '@/components/ui/button';
import { Card } from '@/components/ui/card';
import { fireChallengeToggle } from './challenge/challengeControl';

let shownThisSession = false;

export function SiegeStartModal() {
  const [open, setOpen] = useState(!shownThisSession);
  if (!open) return null;

  const choose = (challenge: boolean) => {
    shownThisSession = true;
    setOpen(false);
    // Give the in-Canvas ChallengeRunner a beat to have registered its handler.
    if (challenge) setTimeout(() => fireChallengeToggle(), 50);
  };

  return (
    <div className="fixed inset-0 z-[120] flex items-center justify-center"
         style={{ background: 'rgba(0,0,0,0.65)', backdropFilter: 'blur(2px)' }}>
      <Card className="p-6 w-[340px] text-center space-y-4">
        <h2 className="text-xl font-bold">Choose a Mode</h2>
        <p className="text-sm text-muted-foreground">
          Fight the wave Challenge, or roam the Open World. Both start at Bleakrock.
        </p>
        <div className="flex flex-col gap-3 pt-1">
          <Button size="lg" onClick={() => choose(true)}>⚔️ Challenge</Button>
          <Button size="lg" variant="secondary" onClick={() => choose(false)}>🌍 Open World</Button>
        </div>
      </Card>
    </div>
  );
}
