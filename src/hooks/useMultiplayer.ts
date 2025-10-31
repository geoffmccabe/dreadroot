import { useEffect, useState, useCallback } from 'react';
import { supabase } from '@/integrations/supabase/client';
import { RealtimeChannel } from '@supabase/supabase-js';
import * as THREE from 'three';

export interface PlayerState {
  userId: string;
  position: { x: number; y: number; z: number };
  rotation: { yaw: number; pitch: number };
  username?: string;
  color?: string;
}

export interface MultiplayerState {
  players: Map<string, PlayerState>;
  broadcastPosition: (position: THREE.Vector3, yaw: number, pitch: number) => void;
  isConnected: boolean;
}

export function useMultiplayer(roomId: string = 'fortress-main'): MultiplayerState {
  const [players, setPlayers] = useState<Map<string, PlayerState>>(new Map());
  const [channel, setChannel] = useState<RealtimeChannel | null>(null);
  const [isConnected, setIsConnected] = useState(false);

  useEffect(() => {
    const setupMultiplayer = async () => {
      // Get current user
      const { data: { user } } = await supabase.auth.getUser();
      if (!user) {
        console.log('[Multiplayer] No user logged in');
        return;
      }

      console.log('[Multiplayer] Setting up room:', roomId);

      // Create channel for this room
      const multiplayerChannel = supabase.channel(`room:${roomId}`, {
        config: {
          presence: {
            key: user.id,
          },
        },
      });

      // Track sync events
      multiplayerChannel
        .on('presence', { event: 'sync' }, () => {
          const state = multiplayerChannel.presenceState();
          console.log('[Multiplayer] Presence sync:', Object.keys(state).length, 'players');
          
          const newPlayers = new Map<string, PlayerState>();
          
          Object.entries(state).forEach(([userId, presences]: [string, any[]]) => {
            if (userId !== user.id && presences.length > 0) {
              const presence = presences[0];
              newPlayers.set(userId, {
                userId,
                position: presence.position || { x: 0, y: 1.7, z: 0 },
                rotation: presence.rotation || { yaw: 0, pitch: 0 },
                username: presence.username,
                color: presence.color,
              });
            }
          });
          
          setPlayers(newPlayers);
        })
        .on('presence', { event: 'join' }, ({ key, newPresences }) => {
          console.log('[Multiplayer] Player joined:', key);
        })
        .on('presence', { event: 'leave' }, ({ key, leftPresences }) => {
          console.log('[Multiplayer] Player left:', key);
        });

      // Subscribe and set initial presence
      await multiplayerChannel.subscribe(async (status) => {
        if (status === 'SUBSCRIBED') {
          console.log('[Multiplayer] Connected to room');
          setIsConnected(true);
          
          // Set initial presence with a random color for this player
          const randomColor = `#${Math.floor(Math.random()*16777215).toString(16)}`;
          await multiplayerChannel.track({
            position: { x: 0, y: 1.7, z: 0 },
            rotation: { yaw: 0, pitch: 0 },
            username: user.email?.split('@')[0] || 'Player',
            color: randomColor,
            online_at: new Date().toISOString(),
          });
        }
      });

      setChannel(multiplayerChannel);
    };

    setupMultiplayer();

    // Cleanup
    return () => {
      if (channel) {
        console.log('[Multiplayer] Cleaning up channel');
        supabase.removeChannel(channel);
      }
    };
  }, [roomId]);

  const broadcastPosition = useCallback((position: THREE.Vector3, yaw: number, pitch: number) => {
    if (!channel || !isConnected) return;
    
    // Throttle updates - only send every 50ms
    const now = Date.now();
    const lastUpdate = (channel as any)._lastPositionUpdate || 0;
    
    if (now - lastUpdate < 50) return;
    (channel as any)._lastPositionUpdate = now;

    channel.track({
      position: {
        x: Math.round(position.x * 100) / 100, // Round to 2 decimals
        y: Math.round(position.y * 100) / 100,
        z: Math.round(position.z * 100) / 100,
      },
      rotation: {
        yaw: Math.round(yaw * 100) / 100,
        pitch: Math.round(pitch * 100) / 100,
      },
      online_at: new Date().toISOString(),
    });
  }, [channel, isConnected]);

  return {
    players,
    broadcastPosition,
    isConnected,
  };
}
