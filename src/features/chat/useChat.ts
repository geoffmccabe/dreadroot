// useChat — transport for the shared chat module.
//
// Rides a dedicated Supabase realtime broadcast channel scoped by game + world
// (`chat:<game>:<worldId>`). No server changes, no L2 dependency: the same code
// works for every game on the shared backend. v1 is EPHEMERAL — messages are not
// persisted (Minecraft-style). A history table is a later slice.

import { useEffect, useRef, useState, useCallback } from 'react';
import { supabase } from '@/integrations/supabase/client';
import { RealtimeChannel } from '@supabase/supabase-js';
import { GAME_ID } from '@/config/game';
import type { ChatMessage } from './types';

const MAX_MESSAGES = 100;       // ring buffer of recent messages held in memory
const SEND_THROTTLE_MS = 400;   // minimum gap between sends (basic spam guard)
const MAX_BODY = 240;

export function useChat(opts: {
  worldId: string | null;
  userId: string | null;
  username: string;
  color?: string;
}) {
  const { worldId, userId, username, color } = opts;
  const [messages, setMessages] = useState<ChatMessage[]>([]);
  const channelRef = useRef<RealtimeChannel | null>(null);
  const lastSentRef = useRef(0);

  // (Re)subscribe whenever the world changes. Tear the old channel down first.
  useEffect(() => {
    if (channelRef.current) {
      supabase.removeChannel(channelRef.current);
      channelRef.current = null;
    }
    setMessages([]); // fresh log per world
    if (!worldId) return;

    const ch = supabase.channel(`chat:${GAME_ID}:${worldId}`, {
      config: { broadcast: { self: false } }, // we add our own messages optimistically
    });
    ch.on('broadcast', { event: 'msg' }, (payload) => {
      const m = payload?.payload as ChatMessage | undefined;
      if (!m || !m.body || !m.id) return;
      setMessages((prev) => (prev.some((p) => p.id === m.id) ? prev : [...prev, m].slice(-MAX_MESSAGES)));
    });
    ch.subscribe();
    channelRef.current = ch;

    return () => {
      supabase.removeChannel(ch);
      if (channelRef.current === ch) channelRef.current = null;
    };
  }, [worldId]);

  const send = useCallback((raw: string) => {
    const body = raw.trim().slice(0, MAX_BODY);
    if (!body || !channelRef.current || !userId) return;
    const now = Date.now();
    if (now - lastSentRef.current < SEND_THROTTLE_MS) return; // throttle
    lastSentRef.current = now;

    const msg: ChatMessage = {
      id: `${now}-${Math.random().toString(36).slice(2, 8)}`,
      userId,
      username,
      color,
      body,
      ts: now,
    };
    // Optimistic local echo (channel is self:false so it won't come back to us).
    setMessages((prev) => [...prev, msg].slice(-MAX_MESSAGES));
    channelRef.current.send({ type: 'broadcast', event: 'msg', payload: msg });
  }, [userId, username, color]);

  return { messages, send };
}
