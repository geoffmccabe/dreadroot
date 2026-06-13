// Shared chat module — works in any game on the engine (Pinkland, DreadRoot, …).
// Game-agnostic: the hook/overlay take worldId + identity as inputs and ride the
// shared Supabase realtime backend, scoped by game + world.

export interface ChatMessage {
  id: string;        // client-generated, unique — react key + de-dup
  userId: string;
  username: string;
  color?: string;    // sender's player colour (falls back to a theme colour)
  body: string;
  ts: number;        // sender's clock (ms) — ordering + fade-out
}
