// Runtime active-world-id holder. Fortress owns currentWorldId (from useBlocks); it mirrors it
// here so non-React / deep-scene code (e.g. siege coin drops fired from MonsterEnemy) can read the
// world the player is currently in without threading the id down through every component.
let worldId: string | null = null;

export function getActiveWorldId(): string | null { return worldId; }
export function setActiveWorldId(id: string | null | undefined): void { worldId = id ?? null; }
