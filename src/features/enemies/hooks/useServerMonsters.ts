/**
 * Renders the SERVER's monsters.
 *
 * The server decides which creatures exist and where they are, but a position
 * on its own draws nothing. This creates a local stand-in for each monster the
 * server introduces, and removes it when the server takes it away. The
 * EntityFeed then drives that stand-in every frame, so what you see is the
 * server's monster wearing the game's existing artwork, animation and sound.
 *
 * Everything cosmetic stays local on purpose: twitching, body fires, the walk
 * cycle. Those never travel over the network, so two players see the same
 * creature in the same place without paying to synchronise how it wobbles.
 *
 * Off unless the feed is in 'remote' mode, so mounting this changes nothing by
 * itself.
 */
import { useEffect, useRef } from 'react';
import { shadowSession } from '@/features/netcode/shadowSession';
import { entityFeed } from '@/features/enemies/feed/entityFeed';
import type { ShombieDefinition, ShombieInstance } from '@/features/shombie/types';

interface Options {
  /** Spawns a shombie at a world position with a caller-supplied id. */
  spawnShombieAt?: (
    definition: ShombieDefinition,
    worldX: number,
    worldZ: number,
    presetId?: string,
  ) => ShombieInstance | null;
  shombieDefinitions?: ShombieDefinition[];
  shombiesRef: React.RefObject<ShombieInstance[]>;
}

export function useServerMonsters({ spawnShombieAt, shombieDefinitions, shombiesRef }: Options): void {
  // Refs so the handlers registered once always see current values.
  const spawnRef = useRef(spawnShombieAt);
  const defsRef = useRef(shombieDefinitions);
  useEffect(() => { spawnRef.current = spawnShombieAt; }, [spawnShombieAt]);
  useEffect(() => { defsRef.current = shombieDefinitions; }, [shombieDefinitions]);

  useEffect(() => {
    shadowSession.setMonsterHandlers(
      (id, x, _y, z) => {
        // Only build stand-ins when the server is actually in charge. In
        // shadow mode we are only grading it and must not touch the world.
        if (!entityFeed.isRemote()) return;
        const spawn = spawnRef.current;
        const defs = defsRef.current;
        if (!spawn || !defs || defs.length === 0) return;
        const def = defs.find((d) => d.tier === 1) ?? defs[0];
        // The stand-in takes the SERVER's id, which is what lets the feed find
        // it again every frame.
        spawn(def, x, z, id);
      },
      (id) => {
        const list = shombiesRef.current;
        if (!list) return;
        for (let i = 0; i < list.length; i++) {
          if (list[i].id !== id) continue;
          // Match the normal death path: deactivate and let the existing
          // once-per-second sweep compact the array.
          list[i].isActive = false;
          break;
        }
      },
    );
  }, [shombiesRef]);
}
