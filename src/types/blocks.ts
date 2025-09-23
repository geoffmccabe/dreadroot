export interface PlacedBlock {
  id: string;
  user_id: string | null;
  position_x: number;
  position_y: number;
  position_z: number;
  block_type: string;
  created_at: string;
  updated_at: string;
}