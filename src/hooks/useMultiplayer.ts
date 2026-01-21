import { useEffect, useState, useCallback, useRef } from 'react';
import { supabase } from '@/integrations/supabase/client';
import { RealtimeChannel } from '@supabase/supabase-js';
import * as THREE from 'three';

export interface PlayerState {
  userId: string;
  position: { x: number; y: number; z: number };
  rotation: { yaw: number; pitch: number };
  username?: string;
  color?: string;
  // Fire effect state
  isOnFire?: boolean;
  fireStartTime?: number;
  fireBurnTimeMs?: number;
  fireColors?: string[];
}

export interface MultiplayerState {
  players: Map<string, PlayerState>;
  broadcastPosition: (position: THREE.Vector3, yaw: number, pitch: number) => void;
  broadcastPlayerHit: (burnTimeMs: number, colors: string[]) => void;
  isConnected: boolean;
  // Local player fire state
  localPlayerOnFire: boolean;
  localFireBurnTimeMs: number;
  localFireColors: string[];
  setLocalPlayerOnFire: (burnTimeMs: number, colors: string[]) => void;
}

// Movement broadcast config - send only on meaningful change
const MOVE_SEND_INTERVAL_MS = 100;      // 10Hz max while moving
const IDLE_KEEPALIVE_MS = 5000;         // 0.2Hz while idle
const POS_EPS_SQ = 0.01 * 0.01;         // 1cm threshold (tune)
const ROT_EPS = 0.01;                   // ~0.6 degrees (tune)

// worldId parameter scopes multiplayer by world - prevents cross-world visibility
export function useMultiplayer(worldId: string | null): MultiplayerState {
  const [players, setPlayers] = useState<Map<string, PlayerState>>(new Map());
  const [isConnected, setIsConnected] = useState(false);
  
  // Local player fire state
  const [localPlayerOnFire, setLocalPlayerOnFireState] = useState(false);
  const [localFireBurnTimeMs, setLocalFireBurnTimeMs] = useState(0);
  const [localFireColors, setLocalFireColors] = useState<string[]>([]);
  const fireTimerRef = useRef<NodeJS.Timeout | null>(null);
  
  // Use ref for channel to ensure proper cleanup - fixes channel leak bug
  const channelRef = useRef<RealtimeChannel | null>(null);
  const isSettingUpRef = useRef(false);
  const currentWorldIdRef = useRef(worldId);
  const userRef = useRef<{ id: string; email?: string | null } | null>(null);

  // Track world changes
  useEffect(() => {
    currentWorldIdRef.current = worldId;
  }, [worldId]);

  useEffect(() => {
    // Always tear down any previous channel first - fixes channel leak
    if (channelRef.current) {
      supabase.removeChannel(channelRef.current);
      channelRef.current = null;
    }
    
    setIsConnected(false);
    setPlayers(new Map());
    
    if (isSettingUpRef.current || !worldId) return;
    
    const setupMultiplayer = async () => {
      isSettingUpRef.current = true;
      const { data: { user } } = await supabase.auth.getUser();
      if (!user) {
        isSettingUpRef.current = false;
        return;
      }
      
      userRef.current = { id: user.id, email: user.email };

      // Create channel scoped by world ID - prevents cross-world player visibility
      const roomId = `world:${worldId}`;
      const multiplayerChannel = supabase.channel(`room:${roomId}`, {
        config: {
          presence: {
            key: user.id,
          },
        },
      });

      channelRef.current = multiplayerChannel;

      // Presence: Only for join/leave detection (not movement)
      multiplayerChannel
        .on('presence', { event: 'sync' }, () => {
          const state = multiplayerChannel.presenceState();
          
          setPlayers(prevPlayers => {
            const newPlayers = new Map<string, PlayerState>();
            let hasChanges = false;
            
            Object.entries(state).forEach(([odUserId, presences]: [string, any[]]) => {
              if (odUserId !== user.id && presences.length > 0) {
                const presence = presences[0];
                // Initial state from presence - will be updated by broadcast
                const existing = prevPlayers.get(odUserId);
                if (existing) {
                  // Keep existing position data (from broadcast), just update metadata
                  newPlayers.set(odUserId, {
                    ...existing,
                    username: presence.username ?? existing.username,
                    color: presence.color ?? existing.color,
                  });
                } else {
                  // New player - create with presence data
                  newPlayers.set(odUserId, {
                    userId: odUserId,
                    position: presence.position || { x: 0, y: 1.7, z: 0 },
                    rotation: presence.rotation || { yaw: 0, pitch: 0 },
                    username: presence.username,
                    color: presence.color,
                  });
                  hasChanges = true;
                }
              }
            });
            
            // Check if player count changed
            if (newPlayers.size !== prevPlayers.size) {
              hasChanges = true;
            }
            
            return hasChanges ? newPlayers : prevPlayers;
          });
        })
        .on('presence', { event: 'join' }, () => {})
        .on('presence', { event: 'leave' }, ({ leftPresences }) => {
          // Remove player from map when they leave
          if (leftPresences && leftPresences.length > 0) {
            const leftUserId = leftPresences[0].presence_ref?.split(':')[0] || leftPresences[0].user_id;
            if (leftUserId) {
              setPlayers(prev => {
                const next = new Map(prev);
                next.delete(leftUserId);
                return next;
              });
            }
          }
        });
      
      // Broadcast: Listen for high-frequency movement updates
      multiplayerChannel.on('broadcast', { event: 'player_transform' }, (msg: any) => {
        const payload = msg?.payload;
        if (!payload) return;

        const { user_id, position, rotation, username, color } = payload;
        if (!user_id || user_id === user?.id) return;

        setPlayers((prev) => {
          const next = new Map(prev);
          const existing = next.get(user_id);

          if (existing) {
            // Mutate + re-set entry (keeps allocations down)
            existing.position.x = position.x;
            existing.position.y = position.y;
            existing.position.z = position.z;
            existing.rotation.yaw = rotation.yaw;
            existing.rotation.pitch = rotation.pitch;
            if (username) existing.username = username;
            if (color) existing.color = color;
            next.set(user_id, existing);
          } else {
            next.set(user_id, {
              userId: user_id,
              username: username ?? 'Player',
              color: color ?? '#ffffff',
              position: { x: position.x, y: position.y, z: position.z },
              rotation: { yaw: rotation.yaw, pitch: rotation.pitch },
            });
          }

          return next;
        });
      });

      // Listen for player hit events (fire effects on other players)
      multiplayerChannel.on('broadcast', { event: 'player_hit' }, (msg: any) => {
        const payload = msg?.payload;
        if (!payload) return;

        const { user_id, burnTimeMs, colors, hitTime } = payload;
        if (!user_id || user_id === user?.id) return;

        setPlayers((prev) => {
          const next = new Map(prev);
          const existing = next.get(user_id);
          if (existing) {
            existing.isOnFire = true;
            existing.fireStartTime = hitTime;
            existing.fireBurnTimeMs = burnTimeMs;
            existing.fireColors = colors;
            next.set(user_id, existing);
            
            // Auto-clear fire after burn time
            setTimeout(() => {
              setPlayers((p) => {
                const n = new Map(p);
                const e = n.get(user_id);
                if (e) {
                  e.isOnFire = false;
                  n.set(user_id, e);
                }
                return n;
              });
            }, burnTimeMs);
          }
          return next;
        });
      });

      await multiplayerChannel.subscribe(async (status) => {
        if (status === 'SUBSCRIBED') {
          setIsConnected(true);
          isSettingUpRef.current = false;
          
          // Track ONCE here (join), not for movement - reduces main thread load
          const randomColor = `#${Math.floor(Math.random()*16777215).toString(16).padStart(6, '0')}`;
          await multiplayerChannel.track({
            user_id: user.id,
            username: user.email?.split('@')[0] || 'Player',
            color: randomColor,
            online_at: new Date().toISOString(),
          });
        }
      });
    };

    setupMultiplayer();

    // Cleanup: Use ref to get current channel value - fixes stale closure bug
    return () => {
      isSettingUpRef.current = false;
      if (channelRef.current) {
        supabase.removeChannel(channelRef.current);
        channelRef.current = null;
      }
      setIsConnected(false);
      setPlayers(new Map());
    };
  }, [worldId]); // Re-run when world changes

  // Delta-gated broadcast: only send on meaningful position/rotation change
  const lastSentRef = useRef({
    hasSent: false,
    at: 0,
    x: 0, y: 0, z: 0,
    yaw: 0, pitch: 0
  });

  const broadcastPosition = useCallback((position: THREE.Vector3, yaw: number, pitch: number) => {
    const ch = channelRef.current;
    const user = userRef.current;
    if (!ch || !user || !isConnected) return;

    const now = performance.now();
    const last = lastSentRef.current;

    const dx = position.x - last.x;
    const dy = position.y - last.y;
    const dz = position.z - last.z;
    const moved = last.hasSent ? (dx * dx + dy * dy + dz * dz) > POS_EPS_SQ : true;

    const turned = last.hasSent
      ? (Math.abs(yaw - last.yaw) > ROT_EPS || Math.abs(pitch - last.pitch) > ROT_EPS)
      : true;

    const keepAlive = now - last.at > IDLE_KEEPALIVE_MS;

    // Skip if nothing changed and not time for keepalive
    if (!moved && !turned && !keepAlive) return;

    // Rate limit while moving
    if (!keepAlive && now - last.at < MOVE_SEND_INTERVAL_MS) return;

    // Update last sent
    last.hasSent = true;
    last.at = now;
    last.x = position.x;
    last.y = position.y;
    last.z = position.z;
    last.yaw = yaw;
    last.pitch = pitch;

    // Use broadcast instead of track for movement - much lower overhead
    ch.send({
      type: 'broadcast',
      event: 'player_transform',
      payload: {
        user_id: user.id,
        position: {
          x: Math.round(position.x * 100) / 100,
          y: Math.round(position.y * 100) / 100,
          z: Math.round(position.z * 100) / 100
        },
        rotation: {
          yaw: Math.round(yaw * 100) / 100,
          pitch: Math.round(pitch * 100) / 100
        },
      },
    });
  }, [isConnected]);

  // Set local player on fire
  const setLocalPlayerOnFire = useCallback((burnTimeMs: number, colors: string[]) => {
    setLocalPlayerOnFireState(true);
    setLocalFireBurnTimeMs(burnTimeMs);
    setLocalFireColors(colors);
    
    // Clear previous timer
    if (fireTimerRef.current) clearTimeout(fireTimerRef.current);
    
    // Auto-clear fire after burn time
    fireTimerRef.current = setTimeout(() => {
      setLocalPlayerOnFireState(false);
    }, burnTimeMs);
  }, []);
  
  // Broadcast player hit to others
  const broadcastPlayerHit = useCallback((burnTimeMs: number, colors: string[]) => {
    const ch = channelRef.current;
    const user = userRef.current;
    if (!ch || !user || !isConnected) return;
    
    ch.send({
      type: 'broadcast',
      event: 'player_hit',
      payload: {
        user_id: user.id,
        burnTimeMs,
        colors,
        hitTime: Date.now(),
      },
    });
  }, [isConnected]);

  return {
    players,
    broadcastPosition,
    broadcastPlayerHit,
    isConnected,
    localPlayerOnFire,
    localFireBurnTimeMs,
    localFireColors,
    setLocalPlayerOnFire,
  };
}
