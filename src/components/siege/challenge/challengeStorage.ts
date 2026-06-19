// challengeStorage — save/load Challenges to Supabase (table `challenges`, see SQL in the panel
// commit message / docs). Ownership + admin rules are enforced by Row-Level Security on the table;
// this module is just thin typed access. The `challenges` table isn't in the generated types yet,
// so we cast the query builder (kept isolated to this file).
import { supabase } from '@/integrations/supabase/client';
import type { Challenge } from './challengeTypes';

export interface ChallengeRow {
  id: string;
  user_id: string;
  name: string;
  creator_name: string | null;
  game: string | null;
  region: string | null;
  data: Challenge;
  updated_at: string;
}

const COLS = 'id,user_id,name,creator_name,game,region,data,updated_at';
// eslint-disable-next-line @typescript-eslint/no-explicit-any
const tbl = () => (supabase as any).from('challenges');

/** Insert (new) or update (existing ch.id) — returns the saved row id or an error string. */
export async function saveChallenge(ch: Challenge, userId: string, creatorName: string): Promise<{ id?: string; error?: string }> {
  const base = { name: ch.name || 'Untitled', creator_name: creatorName, game: ch.game ?? null, region: ch.region ?? null, data: ch };
  if (ch.id) {
    const { data, error } = await tbl().update({ ...base, updated_at: new Date().toISOString() }).eq('id', ch.id).select('id').maybeSingle();
    if (error) return { error: error.message };
    if (!data) return { error: "Couldn't save — not your challenge?" };
    return { id: data.id as string };
  }
  const { data, error } = await tbl().insert({ ...base, user_id: userId }).select('id').maybeSingle();
  if (error) return { error: error.message };
  return { id: data?.id as string };
}

/** Challenges owned by this user (for the creator's own "Open" list). */
export async function listMyChallenges(userId: string): Promise<ChallengeRow[]> {
  const { data } = await tbl().select(COLS).eq('user_id', userId).order('updated_at', { ascending: false });
  return (data ?? []) as ChallengeRow[];
}

/** All challenges (admins/superadmins — they can open + edit anyone's). */
export async function listAllChallenges(): Promise<ChallengeRow[]> {
  const { data } = await tbl().select(COLS).order('updated_at', { ascending: false }).limit(500);
  return (data ?? []) as ChallengeRow[];
}

/** Every playable challenge for ONE game — the Challenge Browser list (region spawners excluded).
 *  Ordered by creation (oldest first) so the Browser is stable as challenges are edited. */
export async function listGameChallenges(game: string): Promise<ChallengeRow[]> {
  const { data } = await tbl().select(COLS).eq('game', game).is('region', null).order('created_at', { ascending: true }).limit(500);
  return (data ?? []) as ChallengeRow[];
}

/** Region spawners for ONE game (region is set). Used by RegionSpawnerRunner — game-scoped. */
export async function listRegionChallenges(game: string): Promise<ChallengeRow[]> {
  const { data } = await tbl().select(COLS).eq('game', game).not('region', 'is', null);
  return (data ?? []) as ChallengeRow[];
}

/** Delete a challenge (RLS allows own + admin). Returns an error string or null. */
export async function deleteChallenge(id: string): Promise<string | null> {
  const { error } = await tbl().delete().eq('id', id);
  return error ? error.message : null;
}

// ── Leaderboards (Phase 7) — one row per completed/failed play in the `challenge_runs` table ──────
// eslint-disable-next-line @typescript-eslint/no-explicit-any
const runsTbl = () => (supabase as any).from('challenge_runs');

export interface LeaderboardEntry { player_name: string | null; score: number; completed: boolean; time_ms: number | null; }
export interface Leaderboard { top: LeaderboardEntry[]; plays: number; }

/** Top-5 + the player's 1-based RANK for a just-finished score (how many runs beat it, +1) + total plays.
 *  Rank is independent of whether the player's own run has committed yet (it counts only scores ABOVE). */
export async function challengeResultBoard(challengeId: string, score: number): Promise<{ top: LeaderboardEntry[]; rank: number; plays: number }> {
  const board = (await listLeaderboards([challengeId], 5))[challengeId] ?? { top: [], plays: 0 };
  const { count } = await runsTbl().select('id', { count: 'exact', head: true }).eq('challenge_id', challengeId).gt('score', Math.round(score));
  return { top: board.top, rank: (count ?? 0) + 1, plays: board.plays };
}

/** Record one play of a challenge. Fire-and-forget; returns an error string or null. */
export async function recordChallengeRun(run: {
  challengeId: string; userId?: string | null; playerName?: string | null; game?: string | null;
  score: number; timeMs?: number | null; waveReached?: number | null; completed: boolean;
}): Promise<string | null> {
  const { error } = await runsTbl().insert({
    challenge_id: run.challengeId, user_id: run.userId ?? null, player_name: run.playerName ?? null,
    game: run.game ?? null, score: Math.round(run.score), time_ms: run.timeMs ?? null,
    wave_reached: run.waveReached ?? null, completed: run.completed,
  });
  return error ? error.message : null;
}

/** Top-N runs (by score, desc) + total play count for a SET of challenges, in one query. */
export async function listLeaderboards(challengeIds: string[], topN = 5): Promise<Record<string, Leaderboard>> {
  const out: Record<string, Leaderboard> = {};
  if (!challengeIds.length) return out;
  const { data } = await runsTbl()
    .select('challenge_id,player_name,score,completed,time_ms')
    .in('challenge_id', challengeIds)
    .order('score', { ascending: false })
    .limit(2000);
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  for (const row of (data ?? []) as any[]) {
    const lb = out[row.challenge_id] ?? (out[row.challenge_id] = { top: [], plays: 0 });
    lb.plays++;
    if (lb.top.length < topN) lb.top.push({ player_name: row.player_name, score: row.score, completed: row.completed, time_ms: row.time_ms });
  }
  return out;
}

/** The current user's roles (lightweight — avoids the heavy useUserData hook). */
export async function fetchRoles(userId: string): Promise<string[]> {
  const { data } = await supabase.from('user_roles').select('role').eq('user_id', userId);
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  return (data ?? []).map((r: any) => r.role as string);
}
