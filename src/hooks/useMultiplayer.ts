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
  const isSettingUpRef = useRef(false);

  useEffect(() => {
    if (isSettingUpRef.current) return;
    
    const setupMultiplayer = async () => {
      isSettingUpRef.current = true;
      const { data: { user } } = await supabase.auth.getUser();
      if (!user) {
        isSettingUpRef.current = false;
        return;
      }

      // Create channel for this room
      const multiplayerChannel = supabase.channel(`room:${roomId}`, {
        config: {
          presence: {
            key: user.id,
          },
        },
      });

      // Track sync events - compare before setting state to avoid unnecessary re-renders
      multiplayerChannel
        .on('presence', { event: 'sync' }, () => {
          const state = multiplayerChannel.presenceState();
          
          setPlayers(prevPlayers => {
            // Build new state
            const newPlayers = new Map<string, PlayerState>();
            let hasChanges = false;
            
            Object.entries(state).forEach(([userId, presences]: [string, any[]]) => {
              if (userId !== user.id && presences.length > 0) {
                const presence = presences[0];
                const newState: PlayerState = {
                  userId,
                  position: presence.position || { x: 0, y: 1.7, z: 0 },
                  rotation: presence.rotation || { yaw: 0, pitch: 0 },
                  username: presence.username,
                  color: presence.color,
                };
                newPlayers.set(userId, newState);
                
                // Check if this player changed
                const prev = prevPlayers.get(userId);
                if (!prev || 
                    prev.position.x !== newState.position.x ||
                    prev.position.y !== newState.position.y ||
                    prev.position.z !== newState.position.z ||
                    prev.rotation.yaw !== newState.rotation.yaw) {
                  hasChanges = true;
                }
              }
            });
            
            // Check if player count changed
            if (newPlayers.size !== prevPlayers.size) {
              hasChanges = true;
            }
            
            // Only return new Map if something actually changed
            return hasChanges ? newPlayers : prevPlayers;
          });
        })
        .on('presence', { event: 'join' }, () => {})
        .on('presence', { event: 'leave' }, () => {});

      // Subscribe and set initial presence
      await multiplayerChannel.subscribe(async (status) => {
        if (status === 'SUBSCRIBED') {
          setIsConnected(true);
          
          // Set initial presence with a random color for this player
          const randomColor = `#${Math.floor(Math.random()*16777215).toString(16)}`;
          await multiplayerChannel.track({
            position: { x: 0, y: 1.7, z: 0 },
            rotation: { yaw: 0, pitch: 0 },
            username: user.email?.split('@')[0] || 'Player',
            color: randomColor,
            online_at: Date.now(), // Use numeric timestamp instead of ISO string
          });
        }
      });

      setChannel(multiplayerChannel);
    };

    setupMultiplayer();

    return () => {
      isSettingUpRef.current = false;
      if (channel) {
        supabase.removeChannel(channel);
      }
    };
  }, []);

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
      // Removed online_at to avoid string allocation every 50ms
    });
  }, [channel, isConnected]);

  return {
    players,
    broadcastPosition,
    isConnected,
  };
}
