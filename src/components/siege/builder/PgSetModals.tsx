// PgSetModals — the Save-As and Load dialogs for the PG (procedural) set library. Styled with the
// game's Card/waterfall look, rendered as a centered overlay above the Model Placer panel.
//   • SavePgSetModal — name the set, choose Private/Public, then save to the cloud AND download a .json.gz.
//   • LoadPgSetModal — browse your own sets + everyone's Public sets and load one into the generator.
import { useEffect, useState } from 'react';
import { Card } from '@/components/ui/card';
import { Button } from '@/components/ui/button';
import {
  saveNamedSet, exportPgSet, listMySets, listPublicSets, applyPgSet, type PgSetRow,
} from './pgPersistence';

function Backdrop({ children, onClose }: { children: React.ReactNode; onClose: () => void }) {
  return (
    <div className="fixed inset-0 z-[100] flex items-center justify-center bg-black/50" onMouseDown={onClose}>
      <div onMouseDown={(e) => e.stopPropagation()}>{children}</div>
    </div>
  );
}

export function SavePgSetModal({ open, game, onClose, onDone }: { open: boolean; game: string; onClose: () => void; onDone: (msg: string) => void }) {
  const [name, setName] = useState('');
  const [isPublic, setIsPublic] = useState(false);
  const [busy, setBusy] = useState(false);
  useEffect(() => { if (open) { setName(''); setIsPublic(false); } }, [open]);
  if (!open) return null;

  const save = async () => {
    const nm = name.trim() || 'Untitled set';
    setBusy(true);
    const res = await saveNamedSet(nm, isPublic, game);   // cloud (named + private/public)
    await exportPgSet(nm);                                 // also drop a compressed .json.gz backup
    setBusy(false);
    onDone(res.cloud ? (isPublic ? 'Saved ☁ (public)' : 'Saved ☁') : 'Saved file (offline)');
    onClose();
  };

  return (
    <Backdrop onClose={onClose}>
      <Card className="waterfall-card w-80 p-4 text-xs font-mono">
        <div className="mb-3 font-bold text-primary">Save PG set</div>
        <label className="mb-1 block text-muted-foreground">Name</label>
        <input
          autoFocus value={name} onChange={(e) => setName(e.target.value)}
          onKeyDown={(e) => { if (e.key === 'Enter') save(); }}
          placeholder="e.g. Dense mushroom forest"
          className="mb-3 w-full rounded bg-background/60 px-2 py-1.5 text-[12px] outline-none focus:ring-1 focus:ring-primary"
        />
        <div className="mb-4 space-y-1">
          <label className="flex cursor-pointer items-center gap-2">
            <input type="radio" checked={!isPublic} onChange={() => setIsPublic(false)} />
            <span><b>Private</b> — only you can use it</span>
          </label>
          <label className="flex cursor-pointer items-center gap-2">
            <input type="radio" checked={isPublic} onChange={() => setIsPublic(true)} />
            <span><b>Public</b> — other players can browse &amp; generate with it</span>
          </label>
        </div>
        <div className="flex justify-end gap-2">
          <Button size="sm" variant="outline" className="h-7 text-[11px]" onClick={onClose}>Cancel</Button>
          <Button size="sm" className="h-7 text-[11px]" disabled={busy} onClick={save}>{busy ? 'Saving…' : 'Save'}</Button>
        </div>
      </Card>
    </Backdrop>
  );
}

export function LoadPgSetModal({ open, game, onClose, onDone }: { open: boolean; game: string; onClose: () => void; onDone: (msg: string) => void }) {
  const [mine, setMine] = useState<PgSetRow[]>([]);
  const [pub, setPub] = useState<PgSetRow[]>([]);
  const [loading, setLoading] = useState(false);
  useEffect(() => {
    if (!open) return;
    setLoading(true);
    Promise.all([listMySets(game), listPublicSets(game)]).then(([m, p]) => { setMine(m); setPub(p); setLoading(false); });
  }, [open, game]);
  if (!open) return null;

  const load = (row: PgSetRow) => { if (applyPgSet(row)) { onDone(`Loaded "${row.name}"`); onClose(); } };

  const List = ({ title, rows, showOwner }: { title: string; rows: PgSetRow[]; showOwner?: boolean }) => (
    <div className="mb-3">
      <div className="mb-1 font-bold text-muted-foreground">{title} ({rows.length})</div>
      <div className="max-h-40 overflow-y-auto rounded border border-border/40">
        {rows.map((r) => (
          <div key={r.id} className="flex items-center justify-between px-2 py-1 hover:bg-accent">
            <span className="flex-1 truncate">{r.name}{showOwner && <span className="ml-1 text-[9px] text-muted-foreground">· {r.owner_id.slice(0, 6)}</span>}</span>
            <Button size="sm" className="h-5 px-2 text-[10px]" onClick={() => load(r)}>Load</Button>
          </div>
        ))}
        {!rows.length && <div className="px-2 py-1 text-muted-foreground">{loading ? 'loading…' : 'none'}</div>}
      </div>
    </div>
  );

  return (
    <Backdrop onClose={onClose}>
      <Card className="waterfall-card w-80 p-4 text-xs font-mono">
        <div className="mb-3 font-bold text-primary">Load PG set</div>
        <List title="My sets" rows={mine} />
        <List title="Public sets" rows={pub} showOwner />
        <div className="flex justify-end">
          <Button size="sm" variant="outline" className="h-7 text-[11px]" onClick={onClose}>Close</Button>
        </div>
      </Card>
    </Backdrop>
  );
}
