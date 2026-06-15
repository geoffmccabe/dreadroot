// ControlsPanel — toggled by Ctrl+I. Lists all controls, using Dreadroot's exact
// panel styling (the `waterfall-card` class + theme variables) per the project's
// UI rule: every new SW panel matches Dreadroot's CSS.
//
// Control groups are data-driven so admin/spawn commands slot in as those systems
// land (Phase 2). Today it lists the live SW controls + a placeholder admin group.

import { useEffect, useState } from 'react';
import { Card } from '@/components/ui/card';

interface Binding { keys: string; action: string }
interface Group { title: string; bindings: Binding[]; note?: string }

const GROUPS: Group[] = [
  {
    title: 'Movement',
    bindings: [
      { keys: 'W A S D', action: 'Move' },
      { keys: 'Shift', action: 'Run' },
      { keys: 'Space', action: 'Jump' },
      { keys: '` (or F)', action: 'Toggle god mode / fly' },
      { keys: 'Q / Z', action: 'Fly up / down (god mode)' },
      { keys: 'E (hold)', action: 'Super speed (any direction)' },
    ],
  },
  {
    title: 'View',
    bindings: [
      { keys: 'Mouse', action: 'Look' },
      { keys: 'Click', action: 'Capture cursor' },
      { keys: 'Esc', action: 'Release cursor' },
    ],
  },
  {
    title: 'Interface',
    bindings: [
      { keys: 'Ctrl + I', action: 'Toggle this panel' },
      { keys: 'C', action: 'Copy position + facing to clipboard' },
    ],
  },
  {
    title: 'Admin',
    bindings: [],
    note: 'Spawn monsters & admin commands arrive with the combat/enemy systems (Phase 2).',
  },
];

export function ControlsPanel() {
  const [open, setOpen] = useState(false);

  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if (e.ctrlKey && e.code === 'KeyI') {
        e.preventDefault();
        setOpen((v) => !v);
      } else if (e.code === 'Escape' && open) {
        setOpen(false);
      }
    };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [open]);

  if (!open) return null;

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center panel-overlay" onClick={() => setOpen(false)}>
      <Card className="waterfall-card w-[28rem] max-w-[90vw] max-h-[80vh] overflow-y-auto" onClick={(e) => e.stopPropagation()}>
        <div className="flex items-center justify-between mb-3">
          <h3 className="font-bold text-sm tracking-wide">CONTROLS</h3>
          <button className="text-muted-foreground hover:text-foreground text-sm" onClick={() => setOpen(false)}>✕</button>
        </div>
        <div className="space-y-4">
          {GROUPS.map((g) => (
            <div key={g.title}>
              <h4 className="font-semibold text-xs uppercase tracking-wider text-muted-foreground mb-1.5">{g.title}</h4>
              {g.bindings.length > 0 ? (
                <ul className="space-y-1">
                  {g.bindings.map((b) => (
                    <li key={b.action} className="flex items-center justify-between text-sm">
                      <span>{b.action}</span>
                      <kbd className="ml-3 rounded bg-muted px-2 py-0.5 font-mono text-xs">{b.keys}</kbd>
                    </li>
                  ))}
                </ul>
              ) : null}
              {g.note ? <p className="text-xs text-muted-foreground italic">{g.note}</p> : null}
            </div>
          ))}
        </div>
      </Card>
    </div>
  );
}
