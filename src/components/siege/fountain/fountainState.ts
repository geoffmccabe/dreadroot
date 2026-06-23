// fountainState — the GLOBAL double-drops buff + Fountainhead leaderboard, shared by all players.
// Read from the server (get_fountain_state) and polled, so everyone sees the same active window.
// The drop system reads getFountainDoubleDrops() live; the HUD reads useFountain() for the modal.
import { useSyncExternalStore } from 'react';
import { supabase } from '@/integrations/supabase/client';

export interface FountainLeader { name: string; total_divi: number; }

let endsAt = 0;            // ms epoch when double-drops end (0 = inactive)
let lastDonor = '';
let leaders: FountainLeader[] = [];
const subs = new Set<() => void>();
const emit = () => subs.forEach((f) => f());

export const getFountainDoubleDrops = (): boolean => endsAt > Date.now();
export const getFountainEndsAt = (): number => endsAt;
export const getFountainLeaders = (): FountainLeader[] => leaders;
export const getFountainDonor = (): string => lastDonor;

export function setFountainState(endsAtMs: number, donor: string, lb: FountainLeader[]): void {
  endsAt = endsAtMs; lastDonor = donor; leaders = lb; emit();
}

export async function refreshFountain(): Promise<void> {
  try {
    const { data } = await supabase.rpc('get_fountain_state');
    const r = data as { ends_at?: string | null; last_donor?: string | null; leaders?: FountainLeader[] } | null;
    if (r) setFountainState(r.ends_at ? Date.parse(r.ends_at) : 0, r.last_donor ?? '', r.leaders ?? []);
  } catch { /* RPC not deployed yet — stays inactive */ }
}

let started = false;
export function startFountainPolling(): void {
  if (started) return; started = true;
  void refreshFountain();
  setInterval(() => void refreshFountain(), 30000);
}

const snap = () => (endsAt | 0) ^ leaders.length ^ (lastDonor.length << 8);
export function useFountain(): { active: boolean; endsAt: number; leaders: FountainLeader[]; donor: string } {
  useSyncExternalStore((cb) => { subs.add(cb); return () => subs.delete(cb); }, snap, snap);
  return { active: getFountainDoubleDrops(), endsAt, leaders, donor: lastDonor };
}
