export type Json =
  | string
  | number
  | boolean
  | null
  | { [key: string]: Json | undefined }
  | Json[]

export type Database = {
  // Allows to automatically instantiate createClient with right options
  // instead of createClient<Database, { PostgrestVersion: 'XX' }>(URL, KEY)
  __InternalSupabase: {
    PostgrestVersion: "13.0.5"
  }
  public: {
    Tables: {
      active_shwarms: {
        Row: {
          authority_user_id: string | null
          definition_id: string
          id: string
          is_active: boolean
          killer_user_id: string | null
          spawned_at: string | null
          state_json: Json | null
          world_id: string
        }
        Insert: {
          authority_user_id?: string | null
          definition_id: string
          id?: string
          is_active?: boolean
          killer_user_id?: string | null
          spawned_at?: string | null
          state_json?: Json | null
          world_id: string
        }
        Update: {
          authority_user_id?: string | null
          definition_id?: string
          id?: string
          is_active?: boolean
          killer_user_id?: string | null
          spawned_at?: string | null
          state_json?: Json | null
          world_id?: string
        }
        Relationships: [
          {
            foreignKeyName: "active_shwarms_definition_id_fkey"
            columns: ["definition_id"]
            isOneToOne: false
            referencedRelation: "shwarm_definitions"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "active_shwarms_world_id_fkey"
            columns: ["world_id"]
            isOneToOne: false
            referencedRelation: "worlds"
            referencedColumns: ["id"]
          },
        ]
      }
      app_settings: {
        Row: {
          active_token_theme_id: string | null
          id: string
          updated_at: string
        }
        Insert: {
          active_token_theme_id?: string | null
          id?: string
          updated_at?: string
        }
        Update: {
          active_token_theme_id?: string | null
          id?: string
          updated_at?: string
        }
        Relationships: [
          {
            foreignKeyName: "app_settings_active_token_theme_id_fkey"
            columns: ["active_token_theme_id"]
            isOneToOne: false
            referencedRelation: "token_themes"
            referencedColumns: ["id"]
          },
        ]
      }
      billboard_walls: {
        Row: {
          created_at: string
          id: string
          position_x: number | null
          position_y: number | null
          position_z: number | null
          rotation_x: number | null
          rotation_y: number | null
          rotation_z: number | null
          updated_at: string
          wall_number: number
          wall_type: string
        }
        Insert: {
          created_at?: string
          id?: string
          position_x?: number | null
          position_y?: number | null
          position_z?: number | null
          rotation_x?: number | null
          rotation_y?: number | null
          rotation_z?: number | null
          updated_at?: string
          wall_number: number
          wall_type: string
        }
        Update: {
          created_at?: string
          id?: string
          position_x?: number | null
          position_y?: number | null
          position_z?: number | null
          rotation_x?: number | null
          rotation_y?: number | null
          rotation_z?: number | null
          updated_at?: string
          wall_number?: number
          wall_type?: string
        }
        Relationships: []
      }
      block_overlaps: {
        Row: {
          block_type: string
          created_at: string | null
          id: string
          position_x: number
          position_y: number
          position_z: number
          tree_id: string
          tree_planted_at: string
          world_id: string
        }
        Insert: {
          block_type: string
          created_at?: string | null
          id?: string
          position_x: number
          position_y: number
          position_z: number
          tree_id: string
          tree_planted_at: string
          world_id: string
        }
        Update: {
          block_type?: string
          created_at?: string | null
          id?: string
          position_x?: number
          position_y?: number
          position_z?: number
          tree_id?: string
          tree_planted_at?: string
          world_id?: string
        }
        Relationships: [
          {
            foreignKeyName: "block_overlaps_tree_id_fkey"
            columns: ["tree_id"]
            isOneToOne: false
            referencedRelation: "planted_trees"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "block_overlaps_world_id_fkey"
            columns: ["world_id"]
            isOneToOne: false
            referencedRelation: "worlds"
            referencedColumns: ["id"]
          },
        ]
      }
      blocks: {
        Row: {
          category: string
          class: string
          cost: number
          created_at: string
          description: string | null
          glow_factor: number | null
          id: number
          key: string
          name: string
          properties: Json | null
          rarity: string
          texture_url: string | null
          tier: number
          updated_at: string
        }
        Insert: {
          category?: string
          class?: string
          cost?: number
          created_at?: string
          description?: string | null
          glow_factor?: number | null
          id?: number
          key: string
          name: string
          properties?: Json | null
          rarity?: string
          texture_url?: string | null
          tier?: number
          updated_at?: string
        }
        Update: {
          category?: string
          class?: string
          cost?: number
          created_at?: string
          description?: string | null
          glow_factor?: number | null
          id?: number
          key?: string
          name?: string
          properties?: Json | null
          rarity?: string
          texture_url?: string | null
          tier?: number
          updated_at?: string
        }
        Relationships: []
      }
      bullet_definitions: {
        Row: {
          burn_height: number
          burn_time: number
          burn_width: number
          colors: string[]
          created_at: string
          id: number
          tier: number
          updated_at: string
          velocity: number
        }
        Insert: {
          burn_height?: number
          burn_time?: number
          burn_width?: number
          colors?: string[]
          created_at?: string
          id?: number
          tier: number
          updated_at?: string
          velocity?: number
        }
        Update: {
          burn_height?: number
          burn_time?: number
          burn_width?: number
          colors?: string[]
          created_at?: string
          id?: number
          tier?: number
          updated_at?: string
          velocity?: number
        }
        Relationships: []
      }
      chunk_versions: {
        Row: {
          chunk_x: number
          chunk_z: number
          updated_at: string
          version: number
          world_id: string
        }
        Insert: {
          chunk_x: number
          chunk_z: number
          updated_at?: string
          version?: number
          world_id: string
        }
        Update: {
          chunk_x?: number
          chunk_z?: number
          updated_at?: string
          version?: number
          world_id?: string
        }
        Relationships: [
          {
            foreignKeyName: "chunk_versions_world_id_fkey"
            columns: ["world_id"]
            isOneToOne: false
            referencedRelation: "worlds"
            referencedColumns: ["id"]
          },
        ]
      }
      drop_table_entries: {
        Row: {
          created_at: string
          drop_table_id: string
          id: string
          item_name: string
          item_number: number
          sort_order: number
          updated_at: string
          weight: number
        }
        Insert: {
          created_at?: string
          drop_table_id: string
          id?: string
          item_name: string
          item_number: number
          sort_order?: number
          updated_at?: string
          weight?: number
        }
        Update: {
          created_at?: string
          drop_table_id?: string
          id?: string
          item_name?: string
          item_number?: number
          sort_order?: number
          updated_at?: string
          weight?: number
        }
        Relationships: [
          {
            foreignKeyName: "drop_table_entries_drop_table_id_fkey"
            columns: ["drop_table_id"]
            isOneToOne: false
            referencedRelation: "drop_tables"
            referencedColumns: ["id"]
          },
        ]
      }
      drop_tables: {
        Row: {
          code: string
          created_at: string
          description: string | null
          id: string
          name: string
          updated_at: string
        }
        Insert: {
          code: string
          created_at?: string
          description?: string | null
          id?: string
          name?: string
          updated_at?: string
        }
        Update: {
          code?: string
          created_at?: string
          description?: string | null
          id?: string
          name?: string
          updated_at?: string
        }
        Relationships: []
      }
      enemy_sound_settings: {
        Row: {
          ambient_sound_url: string | null
          created_at: string | null
          death_sound_url: string | null
          enemy_type: string
          id: string
          updated_at: string | null
          volume: number
        }
        Insert: {
          ambient_sound_url?: string | null
          created_at?: string | null
          death_sound_url?: string | null
          enemy_type: string
          id?: string
          updated_at?: string | null
          volume?: number
        }
        Update: {
          ambient_sound_url?: string | null
          created_at?: string | null
          death_sound_url?: string | null
          enemy_type?: string
          id?: string
          updated_at?: string | null
          volume?: number
        }
        Relationships: []
      }
      flamethrower_tiers: {
        Row: {
          color1: string
          color2: string
          color3: string
          created_at: string
          distance: number
          fire_opacity: number
          id: number
          particles: number
          smoke_opacity: number
          speed: number
          tier: number
          transparency: number
          updated_at: string
          width: number
        }
        Insert: {
          color1?: string
          color2?: string
          color3?: string
          created_at?: string
          distance?: number
          fire_opacity?: number
          id?: number
          particles?: number
          smoke_opacity?: number
          speed?: number
          tier: number
          transparency?: number
          updated_at?: string
          width?: number
        }
        Update: {
          color1?: string
          color2?: string
          color3?: string
          created_at?: string
          distance?: number
          fire_opacity?: number
          id?: number
          particles?: number
          smoke_opacity?: number
          speed?: number
          tier?: number
          transparency?: number
          updated_at?: string
          width?: number
        }
        Relationships: []
      }
      items: {
        Row: {
          class: string
          cost: number
          created_at: string
          description: string | null
          glow_factor: number | null
          id: string
          item_category: string
          item_number: number | null
          key: string
          name: string
          properties: Json | null
          rarity: string
          texture_url: string | null
          tier: number
          updated_at: string
        }
        Insert: {
          class?: string
          cost?: number
          created_at?: string
          description?: string | null
          glow_factor?: number | null
          id?: string
          item_category?: string
          item_number?: number | null
          key: string
          name: string
          properties?: Json | null
          rarity?: string
          texture_url?: string | null
          tier?: number
          updated_at?: string
        }
        Update: {
          class?: string
          cost?: number
          created_at?: string
          description?: string | null
          glow_factor?: number | null
          id?: string
          item_category?: string
          item_number?: number | null
          key?: string
          name?: string
          properties?: Json | null
          rarity?: string
          texture_url?: string | null
          tier?: number
          updated_at?: string
        }
        Relationships: []
      }
      media_grid_items: {
        Row: {
          created_at: string
          id: string
          media_type: string | null
          media_url: string | null
          slot_number: number
          updated_at: string
          wall_id: string
        }
        Insert: {
          created_at?: string
          id?: string
          media_type?: string | null
          media_url?: string | null
          slot_number: number
          updated_at?: string
          wall_id: string
        }
        Update: {
          created_at?: string
          id?: string
          media_type?: string | null
          media_url?: string | null
          slot_number?: number
          updated_at?: string
          wall_id?: string
        }
        Relationships: [
          {
            foreignKeyName: "media_grid_items_wall_id_fkey"
            columns: ["wall_id"]
            isOneToOne: false
            referencedRelation: "billboard_walls"
            referencedColumns: ["id"]
          },
        ]
      }
      models: {
        Row: {
          animations: Json
          cost: number | null
          created_at: string
          default_color: string
          default_scale: number
          default_scale_x: number
          default_scale_y: number
          default_scale_z: number
          description: string | null
          file_format: string
          id: string
          is_active: boolean
          key: string
          model_type: string
          model_url: string
          name: string
          rarity: string
          updated_at: string
        }
        Insert: {
          animations?: Json
          cost?: number | null
          created_at?: string
          default_color?: string
          default_scale?: number
          default_scale_x?: number
          default_scale_y?: number
          default_scale_z?: number
          description?: string | null
          file_format: string
          id?: string
          is_active?: boolean
          key: string
          model_type: string
          model_url: string
          name: string
          rarity?: string
          updated_at?: string
        }
        Update: {
          animations?: Json
          cost?: number | null
          created_at?: string
          default_color?: string
          default_scale?: number
          default_scale_x?: number
          default_scale_y?: number
          default_scale_z?: number
          description?: string | null
          file_format?: string
          id?: string
          is_active?: boolean
          key?: string
          model_type?: string
          model_url?: string
          name?: string
          rarity?: string
          updated_at?: string
        }
        Relationships: []
      }
      overlap_check_queue: {
        Row: {
          added_by: string
          created_at: string | null
          id: string
          position_x: number
          position_y: number
          position_z: number
          world_id: string
        }
        Insert: {
          added_by?: string
          created_at?: string | null
          id?: string
          position_x: number
          position_y: number
          position_z: number
          world_id: string
        }
        Update: {
          added_by?: string
          created_at?: string | null
          id?: string
          position_x?: number
          position_y?: number
          position_z?: number
          world_id?: string
        }
        Relationships: [
          {
            foreignKeyName: "overlap_check_queue_world_id_fkey"
            columns: ["world_id"]
            isOneToOne: false
            referencedRelation: "worlds"
            referencedColumns: ["id"]
          },
        ]
      }
      pathfinding_configs: {
        Row: {
          algorithm_code: string
          algorithm_params: Json | null
          code: string
          created_at: string | null
          default_randomization: number | null
          description: string | null
          grid_size: number | null
          id: string
          is_default: boolean | null
          max_iterations: number | null
          name: string
          randomization_mode: string | null
          updated_at: string | null
        }
        Insert: {
          algorithm_code: string
          algorithm_params?: Json | null
          code: string
          created_at?: string | null
          default_randomization?: number | null
          description?: string | null
          grid_size?: number | null
          id?: string
          is_default?: boolean | null
          max_iterations?: number | null
          name: string
          randomization_mode?: string | null
          updated_at?: string | null
        }
        Update: {
          algorithm_code?: string
          algorithm_params?: Json | null
          code?: string
          created_at?: string | null
          default_randomization?: number | null
          description?: string | null
          grid_size?: number | null
          id?: string
          is_default?: boolean | null
          max_iterations?: number | null
          name?: string
          randomization_mode?: string | null
          updated_at?: string | null
        }
        Relationships: []
      }
      placed_blocks: {
        Row: {
          block_type: string
          chunk_x: number | null
          chunk_z: number | null
          created_at: string
          expires_at: string | null
          id: string
          position_x: number
          position_y: number
          position_z: number
          texture_url: string | null
          updated_at: string
          user_id: string
          world_id: string
        }
        Insert: {
          block_type?: string
          chunk_x?: number | null
          chunk_z?: number | null
          created_at?: string
          expires_at?: string | null
          id?: string
          position_x: number
          position_y: number
          position_z: number
          texture_url?: string | null
          updated_at?: string
          user_id: string
          world_id: string
        }
        Update: {
          block_type?: string
          chunk_x?: number | null
          chunk_z?: number | null
          created_at?: string
          expires_at?: string | null
          id?: string
          position_x?: number
          position_y?: number
          position_z?: number
          texture_url?: string | null
          updated_at?: string
          user_id?: string
          world_id?: string
        }
        Relationships: [
          {
            foreignKeyName: "placed_blocks_world_fk"
            columns: ["world_id"]
            isOneToOne: false
            referencedRelation: "worlds"
            referencedColumns: ["id"]
          },
        ]
      }
      planted_trees: {
        Row: {
          base_x: number
          base_y: number
          base_z: number
          current_block_count: number
          growth_seed: number
          id: string
          is_fully_grown: boolean
          last_growth_at: string
          planted_at: string
          planted_by: string
          seed_definition_id: string
          target_block_count: number
          world_id: string
        }
        Insert: {
          base_x: number
          base_y: number
          base_z: number
          current_block_count?: number
          growth_seed: number
          id?: string
          is_fully_grown?: boolean
          last_growth_at?: string
          planted_at?: string
          planted_by: string
          seed_definition_id: string
          target_block_count: number
          world_id: string
        }
        Update: {
          base_x?: number
          base_y?: number
          base_z?: number
          current_block_count?: number
          growth_seed?: number
          id?: string
          is_fully_grown?: boolean
          last_growth_at?: string
          planted_at?: string
          planted_by?: string
          seed_definition_id?: string
          target_block_count?: number
          world_id?: string
        }
        Relationships: [
          {
            foreignKeyName: "planted_trees_seed_definition_id_fkey"
            columns: ["seed_definition_id"]
            isOneToOne: false
            referencedRelation: "seed_definitions"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "planted_trees_world_id_fkey"
            columns: ["world_id"]
            isOneToOne: false
            referencedRelation: "worlds"
            referencedColumns: ["id"]
          },
        ]
      }
      screen_urls: {
        Row: {
          created_at: string
          id: string
          slot_number: number
          updated_at: string
          url: string | null
          wall_id: string
        }
        Insert: {
          created_at?: string
          id?: string
          slot_number: number
          updated_at?: string
          url?: string | null
          wall_id: string
        }
        Update: {
          created_at?: string
          id?: string
          slot_number?: number
          updated_at?: string
          url?: string | null
          wall_id?: string
        }
        Relationships: [
          {
            foreignKeyName: "screen_urls_wall_id_fkey"
            columns: ["wall_id"]
            isOneToOne: false
            referencedRelation: "billboard_walls"
            referencedColumns: ["id"]
          },
        ]
      }
      seed_definitions: {
        Row: {
          branch_texture_url: string | null
          branching_factor: number
          cost: number
          created_at: string
          cross_chance: number | null
          cross_length: number | null
          fruit_texture_url: string | null
          fruiting_factor: number
          fungal_cap_top_texture_url: string | null
          fungal_cap_underside_texture_url: string | null
          fungal_lean_angle: number | null
          fungal_max_cap_width: number | null
          fungal_max_height: number | null
          fungal_min_cap_width: number | null
          fungal_min_height: number | null
          fungal_s_curve: boolean | null
          fungal_stem_random: number | null
          fungal_stem_texture_url: string | null
          growth_factor: number
          id: string
          in_bracket_menu: boolean
          low_branch_height: number | null
          name: string | null
          nob_chance: number | null
          nob_size: number | null
          rarity: string
          shroom_cap_diameter: number | null
          shroom_chance: number | null
          shroom_length: number | null
          spike_chance: number | null
          spike_length: number | null
          symmetry: string
          tier: number
          tree_type: string | null
          trunk_texture_url: string | null
          updated_at: string
          width_factor: number
        }
        Insert: {
          branch_texture_url?: string | null
          branching_factor?: number
          cost?: number
          created_at?: string
          cross_chance?: number | null
          cross_length?: number | null
          fruit_texture_url?: string | null
          fruiting_factor?: number
          fungal_cap_top_texture_url?: string | null
          fungal_cap_underside_texture_url?: string | null
          fungal_lean_angle?: number | null
          fungal_max_cap_width?: number | null
          fungal_max_height?: number | null
          fungal_min_cap_width?: number | null
          fungal_min_height?: number | null
          fungal_s_curve?: boolean | null
          fungal_stem_random?: number | null
          fungal_stem_texture_url?: string | null
          growth_factor?: number
          id?: string
          in_bracket_menu?: boolean
          low_branch_height?: number | null
          name?: string | null
          nob_chance?: number | null
          nob_size?: number | null
          rarity?: string
          shroom_cap_diameter?: number | null
          shroom_chance?: number | null
          shroom_length?: number | null
          spike_chance?: number | null
          spike_length?: number | null
          symmetry?: string
          tier: number
          tree_type?: string | null
          trunk_texture_url?: string | null
          updated_at?: string
          width_factor?: number
        }
        Update: {
          branch_texture_url?: string | null
          branching_factor?: number
          cost?: number
          created_at?: string
          cross_chance?: number | null
          cross_length?: number | null
          fruit_texture_url?: string | null
          fruiting_factor?: number
          fungal_cap_top_texture_url?: string | null
          fungal_cap_underside_texture_url?: string | null
          fungal_lean_angle?: number | null
          fungal_max_cap_width?: number | null
          fungal_max_height?: number | null
          fungal_min_cap_width?: number | null
          fungal_min_height?: number | null
          fungal_s_curve?: boolean | null
          fungal_stem_random?: number | null
          fungal_stem_texture_url?: string | null
          growth_factor?: number
          id?: string
          in_bracket_menu?: boolean
          low_branch_height?: number | null
          name?: string | null
          nob_chance?: number | null
          nob_size?: number | null
          rarity?: string
          shroom_cap_diameter?: number | null
          shroom_chance?: number | null
          shroom_length?: number | null
          spike_chance?: number | null
          spike_length?: number | null
          symmetry?: string
          tier?: number
          tree_type?: string | null
          trunk_texture_url?: string | null
          updated_at?: string
          width_factor?: number
        }
        Relationships: []
      }
      shnake_definitions: {
        Row: {
          ai_config: Json | null
          armor: number
          body_texture_url: string | null
          created_at: string | null
          damage_per_hit: number
          face_texture_url: string | null
          head_texture_url: string | null
          health_per_segment: number
          id: string
          knockback: number
          max_spawn_per_tree: number
          name: string
          spawn_chance_per_minute: number
          speed: number
          tier: number
          updated_at: string | null
        }
        Insert: {
          ai_config?: Json | null
          armor?: number
          body_texture_url?: string | null
          created_at?: string | null
          damage_per_hit?: number
          face_texture_url?: string | null
          head_texture_url?: string | null
          health_per_segment?: number
          id?: string
          knockback?: number
          max_spawn_per_tree?: number
          name: string
          spawn_chance_per_minute?: number
          speed?: number
          tier: number
          updated_at?: string | null
        }
        Update: {
          ai_config?: Json | null
          armor?: number
          body_texture_url?: string | null
          created_at?: string | null
          damage_per_hit?: number
          face_texture_url?: string | null
          head_texture_url?: string | null
          health_per_segment?: number
          id?: string
          knockback?: number
          max_spawn_per_tree?: number
          name?: string
          spawn_chance_per_minute?: number
          speed?: number
          tier?: number
          updated_at?: string | null
        }
        Relationships: []
      }
      shombie_definitions: {
        Row: {
          ai_config: Json | null
          created_at: string | null
          damage_per_hit: number
          health: number
          id: string
          knockback_received: number
          name: string
          spawn_chance_per_minute: number
          speed: number
          texture_url: string | null
          tier: number
          updated_at: string | null
        }
        Insert: {
          ai_config?: Json | null
          created_at?: string | null
          damage_per_hit?: number
          health?: number
          id?: string
          knockback_received?: number
          name?: string
          spawn_chance_per_minute?: number
          speed?: number
          texture_url?: string | null
          tier?: number
          updated_at?: string | null
        }
        Update: {
          ai_config?: Json | null
          created_at?: string | null
          damage_per_hit?: number
          health?: number
          id?: string
          knockback_received?: number
          name?: string
          spawn_chance_per_minute?: number
          speed?: number
          texture_url?: string | null
          tier?: number
          updated_at?: string | null
        }
        Relationships: []
      }
      shtickman_definitions: {
        Row: {
          ai_config: Json | null
          body_texture_url: string | null
          created_at: string | null
          damage_per_hit: number
          death_sound_url: string | null
          face_texture_url: string | null
          head_texture_url: string | null
          health: number
          id: string
          knockback_received: number
          name: string
          proximity_sound_url: string | null
          roar_sound_url: string | null
          speed: number
          throw_sound_url: string | null
          tier: number
          updated_at: string | null
        }
        Insert: {
          ai_config?: Json | null
          body_texture_url?: string | null
          created_at?: string | null
          damage_per_hit?: number
          death_sound_url?: string | null
          face_texture_url?: string | null
          head_texture_url?: string | null
          health?: number
          id?: string
          knockback_received?: number
          name?: string
          proximity_sound_url?: string | null
          roar_sound_url?: string | null
          speed?: number
          throw_sound_url?: string | null
          tier: number
          updated_at?: string | null
        }
        Update: {
          ai_config?: Json | null
          body_texture_url?: string | null
          created_at?: string | null
          damage_per_hit?: number
          death_sound_url?: string | null
          face_texture_url?: string | null
          head_texture_url?: string | null
          health?: number
          id?: string
          knockback_received?: number
          name?: string
          proximity_sound_url?: string | null
          roar_sound_url?: string | null
          speed?: number
          throw_sound_url?: string | null
          tier?: number
          updated_at?: string | null
        }
        Relationships: []
      }
      shwarm_blocks: {
        Row: {
          block_index: number
          current_health: number
          id: string
          initial_x: number
          initial_y: number
          initial_z: number
          is_alive: boolean
          last_hit_at: string | null
          last_hit_by: string | null
          max_health: number
          shwarm_id: string
        }
        Insert: {
          block_index: number
          current_health: number
          id?: string
          initial_x: number
          initial_y: number
          initial_z: number
          is_alive?: boolean
          last_hit_at?: string | null
          last_hit_by?: string | null
          max_health: number
          shwarm_id: string
        }
        Update: {
          block_index?: number
          current_health?: number
          id?: string
          initial_x?: number
          initial_y?: number
          initial_z?: number
          is_alive?: boolean
          last_hit_at?: string | null
          last_hit_by?: string | null
          max_health?: number
          shwarm_id?: string
        }
        Relationships: [
          {
            foreignKeyName: "shwarm_blocks_shwarm_id_fkey"
            columns: ["shwarm_id"]
            isOneToOne: false
            referencedRelation: "active_shwarms"
            referencedColumns: ["id"]
          },
        ]
      }
      shwarm_definitions: {
        Row: {
          ai_config: Json | null
          created_at: string | null
          damage_per_hit: number
          drop_rate: number | null
          drop_table_code: string | null
          health_per_block: number
          id: string
          max_blocks: number
          min_blocks: number
          name: string
          spawn_chance_per_minute: number
          speed: number
          texture_url: string | null
          tier: number
          updated_at: string | null
          x_factor: number
        }
        Insert: {
          ai_config?: Json | null
          created_at?: string | null
          damage_per_hit?: number
          drop_rate?: number | null
          drop_table_code?: string | null
          health_per_block?: number
          id?: string
          max_blocks?: number
          min_blocks?: number
          name: string
          spawn_chance_per_minute?: number
          speed?: number
          texture_url?: string | null
          tier: number
          updated_at?: string | null
          x_factor?: number
        }
        Update: {
          ai_config?: Json | null
          created_at?: string | null
          damage_per_hit?: number
          drop_rate?: number | null
          drop_table_code?: string | null
          health_per_block?: number
          id?: string
          max_blocks?: number
          min_blocks?: number
          name?: string
          spawn_chance_per_minute?: number
          speed?: number
          texture_url?: string | null
          tier?: number
          updated_at?: string | null
          x_factor?: number
        }
        Relationships: []
      }
      tier_planting_limits: {
        Row: {
          max_per_chunk: number
          tier_max: number
          tier_min: number
        }
        Insert: {
          max_per_chunk: number
          tier_max: number
          tier_min: number
        }
        Update: {
          max_per_chunk?: number
          tier_max?: number
          tier_min?: number
        }
        Relationships: []
      }
      token_themes: {
        Row: {
          block_explorer_url: string | null
          blockchain: string | null
          chain_id: string | null
          coin_image_url: string | null
          coin_name: string | null
          coin_rate: number
          coin_size: number
          color_palette: Json
          contract_address: string | null
          created_at: string
          description: string | null
          display_name: string
          flow_speed: number
          id: string
          is_active: boolean
          ms_between_drops: number
          name: string
          rpc_url: string | null
          ticker_symbol: string | null
          updated_at: string
          website_url: string | null
        }
        Insert: {
          block_explorer_url?: string | null
          blockchain?: string | null
          chain_id?: string | null
          coin_image_url?: string | null
          coin_name?: string | null
          coin_rate?: number
          coin_size?: number
          color_palette?: Json
          contract_address?: string | null
          created_at?: string
          description?: string | null
          display_name: string
          flow_speed?: number
          id?: string
          is_active?: boolean
          ms_between_drops?: number
          name: string
          rpc_url?: string | null
          ticker_symbol?: string | null
          updated_at?: string
          website_url?: string | null
        }
        Update: {
          block_explorer_url?: string | null
          blockchain?: string | null
          chain_id?: string | null
          coin_image_url?: string | null
          coin_name?: string | null
          coin_rate?: number
          coin_size?: number
          color_palette?: Json
          contract_address?: string | null
          created_at?: string
          description?: string | null
          display_name?: string
          flow_speed?: number
          id?: string
          is_active?: boolean
          ms_between_drops?: number
          name?: string
          rpc_url?: string | null
          ticker_symbol?: string | null
          updated_at?: string
          website_url?: string | null
        }
        Relationships: []
      }
      tree_blocks: {
        Row: {
          block_type: string
          created_at: string
          growth_order: number
          id: string
          position_x: number
          position_y: number
          position_z: number
          tree_id: string
          world_id: string
        }
        Insert: {
          block_type: string
          created_at?: string
          growth_order: number
          id?: string
          position_x: number
          position_y: number
          position_z: number
          tree_id: string
          world_id: string
        }
        Update: {
          block_type?: string
          created_at?: string
          growth_order?: number
          id?: string
          position_x?: number
          position_y?: number
          position_z?: number
          tree_id?: string
          world_id?: string
        }
        Relationships: [
          {
            foreignKeyName: "fk_tree_blocks_planted_trees"
            columns: ["tree_id"]
            isOneToOne: false
            referencedRelation: "planted_trees"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "tree_blocks_tree_id_fkey"
            columns: ["tree_id"]
            isOneToOne: false
            referencedRelation: "planted_trees"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "tree_blocks_world_id_fkey"
            columns: ["world_id"]
            isOneToOne: false
            referencedRelation: "worlds"
            referencedColumns: ["id"]
          },
        ]
      }
      tree_blueprints: {
        Row: {
          block_count: number
          blueprint_data: Json
          created_at: string | null
          id: string
          planted_tree_id: string
          world_id: string
        }
        Insert: {
          block_count: number
          blueprint_data: Json
          created_at?: string | null
          id?: string
          planted_tree_id: string
          world_id: string
        }
        Update: {
          block_count?: number
          blueprint_data?: Json
          created_at?: string | null
          id?: string
          planted_tree_id?: string
          world_id?: string
        }
        Relationships: [
          {
            foreignKeyName: "tree_blueprints_planted_tree_id_fkey"
            columns: ["planted_tree_id"]
            isOneToOne: true
            referencedRelation: "planted_trees"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "tree_blueprints_world_id_fkey"
            columns: ["world_id"]
            isOneToOne: false
            referencedRelation: "worlds"
            referencedColumns: ["id"]
          },
        ]
      }
      tree_fruits: {
        Row: {
          created_at: string
          fruit_code: string
          id: string
          is_collectible: boolean
          is_falling: boolean
          position_x: number
          position_y: number
          position_z: number
          tier: number
          tree_id: string
          velocity_y: number
          world_id: string
        }
        Insert: {
          created_at?: string
          fruit_code?: string
          id?: string
          is_collectible?: boolean
          is_falling?: boolean
          position_x: number
          position_y: number
          position_z: number
          tier: number
          tree_id: string
          velocity_y?: number
          world_id: string
        }
        Update: {
          created_at?: string
          fruit_code?: string
          id?: string
          is_collectible?: boolean
          is_falling?: boolean
          position_x?: number
          position_y?: number
          position_z?: number
          tier?: number
          tree_id?: string
          velocity_y?: number
          world_id?: string
        }
        Relationships: [
          {
            foreignKeyName: "tree_fruits_tree_id_fkey"
            columns: ["tree_id"]
            isOneToOne: false
            referencedRelation: "planted_trees"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "tree_fruits_world_id_fkey"
            columns: ["world_id"]
            isOneToOne: false
            referencedRelation: "worlds"
            referencedColumns: ["id"]
          },
        ]
      }
      tree_growth_config: {
        Row: {
          description: string | null
          key: string
          value: number
        }
        Insert: {
          description?: string | null
          key: string
          value: number
        }
        Update: {
          description?: string | null
          key?: string
          value?: number
        }
        Relationships: []
      }
      user_combat_stats: {
        Row: {
          created_at: string | null
          enemy_type: string
          id: string
          kills: number
          updated_at: string | null
          user_id: string
        }
        Insert: {
          created_at?: string | null
          enemy_type: string
          id?: string
          kills?: number
          updated_at?: string | null
          user_id: string
        }
        Update: {
          created_at?: string | null
          enemy_type?: string
          id?: string
          kills?: number
          updated_at?: string | null
          user_id?: string
        }
        Relationships: []
      }
      user_equipped_items: {
        Row: {
          equipped_at: string
          id: string
          item_id: string
          slot_type: string
          user_id: string
        }
        Insert: {
          equipped_at?: string
          id?: string
          item_id: string
          slot_type: string
          user_id: string
        }
        Update: {
          equipped_at?: string
          id?: string
          item_id?: string
          slot_type?: string
          user_id?: string
        }
        Relationships: [
          {
            foreignKeyName: "user_equipped_items_item_id_fkey"
            columns: ["item_id"]
            isOneToOne: false
            referencedRelation: "items"
            referencedColumns: ["id"]
          },
        ]
      }
      user_fruits: {
        Row: {
          created_at: string
          fruit_code: string
          id: string
          tier: number
          user_id: string
        }
        Insert: {
          created_at?: string
          fruit_code?: string
          id?: string
          tier?: number
          user_id: string
        }
        Update: {
          created_at?: string
          fruit_code?: string
          id?: string
          tier?: number
          user_id?: string
        }
        Relationships: []
      }
      user_inventory: {
        Row: {
          created_at: string
          id: string
          item_id: string | null
          item_type: string
          quantity: number
          updated_at: string
          user_id: string
        }
        Insert: {
          created_at?: string
          id?: string
          item_id?: string | null
          item_type?: string
          quantity?: number
          updated_at?: string
          user_id: string
        }
        Update: {
          created_at?: string
          id?: string
          item_id?: string | null
          item_type?: string
          quantity?: number
          updated_at?: string
          user_id?: string
        }
        Relationships: []
      }
      user_profiles: {
        Row: {
          avatar_url: string | null
          blockchain_address: string | null
          coins: number
          created_at: string
          current_health: number
          current_level: number
          display_name: string | null
          fog_enabled: boolean
          id: string
          max_health: number
          total_points: number
          updated_at: string
          user_id: string
          visual_distance: number
        }
        Insert: {
          avatar_url?: string | null
          blockchain_address?: string | null
          coins?: number
          created_at?: string
          current_health?: number
          current_level?: number
          display_name?: string | null
          fog_enabled?: boolean
          id?: string
          max_health?: number
          total_points?: number
          updated_at?: string
          user_id: string
          visual_distance?: number
        }
        Update: {
          avatar_url?: string | null
          blockchain_address?: string | null
          coins?: number
          created_at?: string
          current_health?: number
          current_level?: number
          display_name?: string | null
          fog_enabled?: boolean
          id?: string
          max_health?: number
          total_points?: number
          updated_at?: string
          user_id?: string
          visual_distance?: number
        }
        Relationships: []
      }
      user_roles: {
        Row: {
          created_at: string | null
          id: string
          role: Database["public"]["Enums"]["app_role"]
          user_id: string
        }
        Insert: {
          created_at?: string | null
          id?: string
          role: Database["public"]["Enums"]["app_role"]
          user_id: string
        }
        Update: {
          created_at?: string | null
          id?: string
          role?: Database["public"]["Enums"]["app_role"]
          user_id?: string
        }
        Relationships: []
      }
      user_token_balances: {
        Row: {
          blockchain_address: string | null
          coins: number
          created_at: string
          id: string
          token_theme_id: string
          updated_at: string
          user_id: string
        }
        Insert: {
          blockchain_address?: string | null
          coins?: number
          created_at?: string
          id?: string
          token_theme_id: string
          updated_at?: string
          user_id: string
        }
        Update: {
          blockchain_address?: string | null
          coins?: number
          created_at?: string
          id?: string
          token_theme_id?: string
          updated_at?: string
          user_id?: string
        }
        Relationships: []
      }
      worlds: {
        Row: {
          created_at: string
          fortress_texture_url: string | null
          ground_texture_url: string | null
          id: string
          is_default: boolean
          name: string
          sky_texture_url: string | null
          updated_at: string
        }
        Insert: {
          created_at?: string
          fortress_texture_url?: string | null
          ground_texture_url?: string | null
          id?: string
          is_default?: boolean
          name: string
          sky_texture_url?: string | null
          updated_at?: string
        }
        Update: {
          created_at?: string
          fortress_texture_url?: string | null
          ground_texture_url?: string | null
          id?: string
          is_default?: boolean
          name?: string
          sky_texture_url?: string | null
          updated_at?: string
        }
        Relationships: []
      }
    }
    Views: {
      [_ in never]: never
    }
    Functions: {
      bump_chunk_version: {
        Args: { p_cx: number; p_cz: number; p_world: string }
        Returns: undefined
      }
      delete_expired_blocks: { Args: never; Returns: number }
      delete_tree_blocks: {
        Args: { p_positions: Json; p_world_id: string }
        Returns: number
      }
      delete_tree_with_blocks: {
        Args: {
          p_block_positions: Json
          p_tree_id: string
          p_user_id: string
          p_world_id: string
        }
        Returns: Json
      }
      forge_fruits: {
        Args: { fruit_id_1: string; fruit_id_2: string; new_tier: number }
        Returns: {
          created_at: string
          fruit_code: string
          id: string
          tier: number
          user_id: string
        }[]
        SetofOptions: {
          from: "*"
          to: "user_fruits"
          isOneToOne: false
          isSetofReturn: true
        }
      }
      get_growth_config: { Args: { p_key: string }; Returns: number }
      has_role: {
        Args: {
          _role: Database["public"]["Enums"]["app_role"]
          _user_id: string
        }
        Returns: boolean
      }
      process_tree_growth: { Args: never; Returns: Json }
      remove_sky_blocks: { Args: never; Returns: number }
      sync_all_missing_tree_blocks: {
        Args: { p_world_id: string }
        Returns: Json
      }
      sync_missing_tree_blocks: {
        Args: { p_tree_id: string; p_world_id: string }
        Returns: Json
      }
      trigger_tree_growth: { Args: never; Returns: Json }
      update_fungal_tree_textures: {
        Args: {
          p_cap_top_texture_url: string
          p_cap_underside_texture_url: string
          p_stem_texture_url: string
          p_tier: number
        }
        Returns: Json
      }
    }
    Enums: {
      app_role: "admin" | "moderator" | "user" | "superadmin"
    }
    CompositeTypes: {
      [_ in never]: never
    }
  }
}

type DatabaseWithoutInternals = Omit<Database, "__InternalSupabase">

type DefaultSchema = DatabaseWithoutInternals[Extract<keyof Database, "public">]

export type Tables<
  DefaultSchemaTableNameOrOptions extends
    | keyof (DefaultSchema["Tables"] & DefaultSchema["Views"])
    | { schema: keyof DatabaseWithoutInternals },
  TableName extends DefaultSchemaTableNameOrOptions extends {
    schema: keyof DatabaseWithoutInternals
  }
    ? keyof (DatabaseWithoutInternals[DefaultSchemaTableNameOrOptions["schema"]]["Tables"] &
        DatabaseWithoutInternals[DefaultSchemaTableNameOrOptions["schema"]]["Views"])
    : never = never,
> = DefaultSchemaTableNameOrOptions extends {
  schema: keyof DatabaseWithoutInternals
}
  ? (DatabaseWithoutInternals[DefaultSchemaTableNameOrOptions["schema"]]["Tables"] &
      DatabaseWithoutInternals[DefaultSchemaTableNameOrOptions["schema"]]["Views"])[TableName] extends {
      Row: infer R
    }
    ? R
    : never
  : DefaultSchemaTableNameOrOptions extends keyof (DefaultSchema["Tables"] &
        DefaultSchema["Views"])
    ? (DefaultSchema["Tables"] &
        DefaultSchema["Views"])[DefaultSchemaTableNameOrOptions] extends {
        Row: infer R
      }
      ? R
      : never
    : never

export type TablesInsert<
  DefaultSchemaTableNameOrOptions extends
    | keyof DefaultSchema["Tables"]
    | { schema: keyof DatabaseWithoutInternals },
  TableName extends DefaultSchemaTableNameOrOptions extends {
    schema: keyof DatabaseWithoutInternals
  }
    ? keyof DatabaseWithoutInternals[DefaultSchemaTableNameOrOptions["schema"]]["Tables"]
    : never = never,
> = DefaultSchemaTableNameOrOptions extends {
  schema: keyof DatabaseWithoutInternals
}
  ? DatabaseWithoutInternals[DefaultSchemaTableNameOrOptions["schema"]]["Tables"][TableName] extends {
      Insert: infer I
    }
    ? I
    : never
  : DefaultSchemaTableNameOrOptions extends keyof DefaultSchema["Tables"]
    ? DefaultSchema["Tables"][DefaultSchemaTableNameOrOptions] extends {
        Insert: infer I
      }
      ? I
      : never
    : never

export type TablesUpdate<
  DefaultSchemaTableNameOrOptions extends
    | keyof DefaultSchema["Tables"]
    | { schema: keyof DatabaseWithoutInternals },
  TableName extends DefaultSchemaTableNameOrOptions extends {
    schema: keyof DatabaseWithoutInternals
  }
    ? keyof DatabaseWithoutInternals[DefaultSchemaTableNameOrOptions["schema"]]["Tables"]
    : never = never,
> = DefaultSchemaTableNameOrOptions extends {
  schema: keyof DatabaseWithoutInternals
}
  ? DatabaseWithoutInternals[DefaultSchemaTableNameOrOptions["schema"]]["Tables"][TableName] extends {
      Update: infer U
    }
    ? U
    : never
  : DefaultSchemaTableNameOrOptions extends keyof DefaultSchema["Tables"]
    ? DefaultSchema["Tables"][DefaultSchemaTableNameOrOptions] extends {
        Update: infer U
      }
      ? U
      : never
    : never

export type Enums<
  DefaultSchemaEnumNameOrOptions extends
    | keyof DefaultSchema["Enums"]
    | { schema: keyof DatabaseWithoutInternals },
  EnumName extends DefaultSchemaEnumNameOrOptions extends {
    schema: keyof DatabaseWithoutInternals
  }
    ? keyof DatabaseWithoutInternals[DefaultSchemaEnumNameOrOptions["schema"]]["Enums"]
    : never = never,
> = DefaultSchemaEnumNameOrOptions extends {
  schema: keyof DatabaseWithoutInternals
}
  ? DatabaseWithoutInternals[DefaultSchemaEnumNameOrOptions["schema"]]["Enums"][EnumName]
  : DefaultSchemaEnumNameOrOptions extends keyof DefaultSchema["Enums"]
    ? DefaultSchema["Enums"][DefaultSchemaEnumNameOrOptions]
    : never

export type CompositeTypes<
  PublicCompositeTypeNameOrOptions extends
    | keyof DefaultSchema["CompositeTypes"]
    | { schema: keyof DatabaseWithoutInternals },
  CompositeTypeName extends PublicCompositeTypeNameOrOptions extends {
    schema: keyof DatabaseWithoutInternals
  }
    ? keyof DatabaseWithoutInternals[PublicCompositeTypeNameOrOptions["schema"]]["CompositeTypes"]
    : never = never,
> = PublicCompositeTypeNameOrOptions extends {
  schema: keyof DatabaseWithoutInternals
}
  ? DatabaseWithoutInternals[PublicCompositeTypeNameOrOptions["schema"]]["CompositeTypes"][CompositeTypeName]
  : PublicCompositeTypeNameOrOptions extends keyof DefaultSchema["CompositeTypes"]
    ? DefaultSchema["CompositeTypes"][PublicCompositeTypeNameOrOptions]
    : never

export const Constants = {
  public: {
    Enums: {
      app_role: ["admin", "moderator", "user", "superadmin"],
    },
  },
} as const
