// Fruit Physics System
// Self-contained physics for falling fruits

import { TreeFruit, FallingFruitState } from '../types';
import { TREE_CONFIG } from '../constants';

export class FruitPhysicsSystem {
  private fallingFruits: Map<string, FallingFruitState> = new Map();
  private groundLevel: number = 0;
  
  /**
   * Set the ground level for landing calculations
   */
  setGroundLevel(y: number): void {
    this.groundLevel = y;
  }
  
  /**
   * Start a fruit falling from its current position
   */
  startFalling(fruit: TreeFruit, targetY?: number): void {
    this.fallingFruits.set(fruit.id, {
      fruitId: fruit.id,
      currentY: fruit.position_y,
      velocity: 0,
      targetY: targetY ?? this.groundLevel,
    });
  }
  
  /**
   * Apply knockback to a fruit (when shot)
   * Returns the new position after knockback
   */
  applyKnockback(
    fruit: TreeFruit,
    bulletDirectionX: number,
    bulletDirectionZ: number
  ): { newX: number; newZ: number } {
    // Move 1 block in bullet direction
    const knockX = Math.round(bulletDirectionX) * TREE_CONFIG.FRUIT_KNOCKBACK_DISTANCE;
    const knockZ = Math.round(bulletDirectionZ) * TREE_CONFIG.FRUIT_KNOCKBACK_DISTANCE;
    
    return {
      newX: fruit.position_x + knockX,
      newZ: fruit.position_z + knockZ,
    };
  }
  
  /**
   * Update all falling fruits
   * Returns list of fruits that have landed
   */
  update(delta: number): { landed: string[]; positions: Map<string, number> } {
    const landed: string[] = [];
    const positions = new Map<string, number>();
    
    for (const [fruitId, state] of this.fallingFruits) {
      // Apply gravity
      state.velocity += TREE_CONFIG.GRAVITY * delta;
      state.currentY -= state.velocity * delta;
      
      // Check if landed
      if (state.currentY <= state.targetY) {
        state.currentY = state.targetY;
        landed.push(fruitId);
        this.fallingFruits.delete(fruitId);
      }
      
      positions.set(fruitId, state.currentY);
    }
    
    return { landed, positions };
  }
  
  /**
   * Check if a fruit is currently falling
   */
  isFalling(fruitId: string): boolean {
    return this.fallingFruits.has(fruitId);
  }
  
  /**
   * Get current Y position of a falling fruit
   */
  getCurrentY(fruitId: string): number | null {
    return this.fallingFruits.get(fruitId)?.currentY ?? null;
  }
  
  /**
   * Stop tracking a fruit (when collected or removed)
   */
  removeFruit(fruitId: string): void {
    this.fallingFruits.delete(fruitId);
  }
  
  /**
   * Clear all falling fruits
   */
  clear(): void {
    this.fallingFruits.clear();
  }
  
  /**
   * Get count of currently falling fruits
   */
  get fallingCount(): number {
    return this.fallingFruits.size;
  }
}

// Singleton instance for the tree system
export const fruitPhysics = new FruitPhysicsSystem();
