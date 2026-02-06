/**
 * Database types for Supabase
 * Auto-generated with additional convenience types
 */

export type Json =
  | string
  | number
  | boolean
  | null
  | { [key: string]: Json | undefined }
  | Json[]

export type Database = {
  public: {
    Tables: {
      player_decks: {
        Row: {
          deck_id: string
          deck_name: string
          deck_score: number | null
          elo: number | null
          expire_date: string | null
          faction: string | null
          forgeborn_id: string | null
          owner_name: string
          set_id: string
          synced_at: string
        }
        Insert: {
          deck_id: string
          deck_name: string
          deck_score?: number | null
          elo?: number | null
          expire_date?: string | null
          faction?: string | null
          forgeborn_id?: string | null
          owner_name: string
          set_id: string
          synced_at?: string
        }
        Update: {
          deck_id?: string
          deck_name?: string
          deck_score?: number | null
          elo?: number | null
          expire_date?: string | null
          faction?: string | null
          forgeborn_id?: string | null
          owner_name?: string
          set_id?: string
          synced_at?: string
        }
        Relationships: []
      }
      player_deck_cards: {
        Row: {
          card_id: string
          deck_id: string
          id: number
        }
        Insert: {
          card_id: string
          deck_id: string
          id?: number
        }
        Update: {
          card_id?: string
          deck_id?: string
          id?: number
        }
        Relationships: []
      }
      player_fused_decks: {
        Row: {
          deck_name: string
          fused_deck_id: string
          owner_name: string
          source_deck_1_id: string
          source_deck_2_id: string
          synced_at: string
        }
        Insert: {
          deck_name: string
          fused_deck_id: string
          owner_name: string
          source_deck_1_id: string
          source_deck_2_id: string
          synced_at?: string
        }
        Update: {
          deck_name?: string
          fused_deck_id?: string
          owner_name?: string
          source_deck_1_id?: string
          source_deck_2_id?: string
          synced_at?: string
        }
        Relationships: []
      }
      player_profiles: {
        Row: {
          user_id: number
          discord_id: string
          player_name: string | null
          discord_name: string | null
          display_name: string | null
          friend_code: string | null
          updated_at: string | null
        }
        Insert: {
          user_id?: number
          discord_id: string
          player_name?: string | null
          discord_name?: string | null
          display_name?: string | null
          friend_code?: string | null
          updated_at?: string | null
        }
        Update: {
          user_id?: number
          discord_id?: string
          player_name?: string | null
          discord_name?: string | null
          display_name?: string | null
          friend_code?: string | null
          updated_at?: string | null
        }
        Relationships: []
      }
    }
    Views: {
      [_ in never]: never
    }
    Functions: {
      upsert_player_deck: {
        Args: {
          p_card_ids: string[]
          p_deck_id: string
          p_deck_name: string
          p_deck_score: number | null
          p_elo: number | null
          p_expire_date: string | null
          p_faction: string | null
          p_forgeborn_id: string | null
          p_owner_name: string
          p_set_id: string
        }
        Returns: Database['public']['Tables']['player_decks']['Row']
      }
      upsert_player_fused_deck: {
        Args: {
          p_fused_deck_id: string
          p_deck_name: string
          p_owner_name: string
          p_source_deck_1_id: string
          p_source_deck_2_id: string
        }
        Returns: Database['public']['Tables']['player_fused_decks']['Row']
      }
    }
    Enums: {
      [_ in never]: never
    }
    CompositeTypes: {
      [_ in never]: never
    }
  }
}

// Convenience type aliases
export type PlayerDeckRow = Database['public']['Tables']['player_decks']['Row']
export type PlayerDeckInsert = Database['public']['Tables']['player_decks']['Insert']
export type PlayerDeckUpdate = Database['public']['Tables']['player_decks']['Update']
export type PlayerDeckCardRow = Database['public']['Tables']['player_deck_cards']['Row']
export type PlayerDeckCardInsert = Database['public']['Tables']['player_deck_cards']['Insert']
export type PlayerDeckCardUpdate = Database['public']['Tables']['player_deck_cards']['Update']
export type PlayerFusedDeckRow = Database['public']['Tables']['player_fused_decks']['Row']
export type PlayerFusedDeckInsert = Database['public']['Tables']['player_fused_decks']['Insert']
export type PlayerFusedDeckUpdate = Database['public']['Tables']['player_fused_decks']['Update']
export type PlayerProfileRow = Database['public']['Tables']['player_profiles']['Row']
export type PlayerProfileInsert = Database['public']['Tables']['player_profiles']['Insert']
export type PlayerProfileUpdate = Database['public']['Tables']['player_profiles']['Update']

// Extended type for API responses with parsed JSON fields
export type PlayerDeck = PlayerDeckRow
