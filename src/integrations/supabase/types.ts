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
      placed_blocks: {
        Row: {
          block_type: string
          created_at: string
          expires_at: string | null
          id: string
          position_x: number
          position_y: number
          position_z: number
          updated_at: string
          user_id: string
        }
        Insert: {
          block_type?: string
          created_at?: string
          expires_at?: string | null
          id?: string
          position_x: number
          position_y: number
          position_z: number
          updated_at?: string
          user_id: string
        }
        Update: {
          block_type?: string
          created_at?: string
          expires_at?: string | null
          id?: string
          position_x?: number
          position_y?: number
          position_z?: number
          updated_at?: string
          user_id?: string
        }
        Relationships: []
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
      user_inventory: {
        Row: {
          created_at: string
          id: string
          item_type: string
          quantity: number
          updated_at: string
          user_id: string
        }
        Insert: {
          created_at?: string
          id?: string
          item_type?: string
          quantity?: number
          updated_at?: string
          user_id: string
        }
        Update: {
          created_at?: string
          id?: string
          item_type?: string
          quantity?: number
          updated_at?: string
          user_id?: string
        }
        Relationships: []
      }
      user_profiles: {
        Row: {
          blockchain_address: string | null
          coins: number
          created_at: string
          id: string
          updated_at: string
          user_id: string
          visual_distance: number
        }
        Insert: {
          blockchain_address?: string | null
          coins?: number
          created_at?: string
          id?: string
          updated_at?: string
          user_id: string
          visual_distance?: number
        }
        Update: {
          blockchain_address?: string | null
          coins?: number
          created_at?: string
          id?: string
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
    }
    Views: {
      [_ in never]: never
    }
    Functions: {
      delete_expired_blocks: { Args: never; Returns: number }
      has_role: {
        Args: {
          _role: Database["public"]["Enums"]["app_role"]
          _user_id: string
        }
        Returns: boolean
      }
      remove_sky_blocks: { Args: never; Returns: number }
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
