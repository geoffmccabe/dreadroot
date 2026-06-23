// FlameTierCheat — superadmin flame-glove tier tester.
//
// With a flame glove equipped, type "#" then "F" then a digit (1–9, or 0 = tier 10) to override
// the flame tier LIVE (colors / range / damage) for testing. Superadmin only; no-op without a
// flame glove equipped. Renders nothing — it's a window keystroke listener like SiegeSpawner.
import { useEffect, useRef } from 'react';
import { getFlameGlove } from '@/config/flameGlove';
import { setFlameTierOverride } from '@/config/flameTierOverride';
import { suppressQA } from '@/config/qaGuard';
import { useToast } from '@/hooks/use-toast';

export function FlameTierCheat({ isSuperadmin }: { isSuperadmin: boolean }) {
  const { toast } = useToast();
  const stage = useRef<'idle' | 'hash' | 'ftier'>('idle');
  const timer = useRef<number | null>(null);

  useEffect(() => {
    if (!isSuperadmin) return;
    const reset = () => {
      stage.current = 'idle';
      if (timer.current) { clearTimeout(timer.current); timer.current = null; }
    };
    const arm = () => {
      if (timer.current) clearTimeout(timer.current);
      timer.current = window.setTimeout(reset, 2500);   // abandon a half-typed sequence
    };

    const onKey = (e: KeyboardEvent) => {
      const el = document.activeElement?.tagName;
      if (el === 'INPUT' || el === 'TEXTAREA' || el === 'SELECT') return;   // don't capture typing
      const k = e.key;

      if (stage.current === 'idle') {
        // Start the sequence on '#', but ONLY consume it when a flame glove is
        // actually equipped — otherwise '#' must keep reaching the D-Flow diagnostics
        // toggle (Fortress.tsx) and any other '#' shortcut. With a glove equipped,
        // '#' is the start of "#F<digit>", so we swallow it to stop the diagnostics
        // panel flickering open on every tier test.
        if (k === '#' && getFlameGlove()) {
          e.preventDefault(); e.stopPropagation();
          stage.current = 'hash'; arm();
        }
        return;
      }
      if (stage.current === 'hash') {
        if (k === 'f' || k === 'F') {
          if (!getFlameGlove()) { reset(); return; }   // only with a flame glove equipped
          e.preventDefault(); e.stopPropagation();
          stage.current = 'ftier'; arm();
        } else {
          reset();   // "#" + something else → not our command; let it through
        }
        return;
      }
      if (stage.current === 'ftier') {
        e.preventDefault(); e.stopPropagation();
        if (/^[0-9]$/.test(k)) {
          const tier = k === '0' ? 10 : parseInt(k, 10);
          setFlameTierOverride(tier);
          suppressQA();   // the digit must not leak into the QA number keys
          toast({ title: `🔥 Flame glove → Tier ${tier}`, duration: 1500 });
        }
        reset();
        return;
      }
    };

    window.addEventListener('keydown', onKey, true);
    return () => { window.removeEventListener('keydown', onKey, true); reset(); };
  }, [isSuperadmin, toast]);

  return null;
}
