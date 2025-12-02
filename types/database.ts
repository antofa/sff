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
          card_set_id: string | null
          card_set_no: string | null
          created_at: string | null
          deck_created_at: string | null
          deck_id: string
          deck_name: string
          deck_rank: string | null
          deck_score: number | null
          digital: boolean | null
          discord_username: string | null
          display_name: string | null
          elo: number | null
          faction: string | null
          forgeborn_id: string | null
          format: string | null
          fused_deck_ids: string[] | null
          id: string
          is_for_sale: boolean | null
          is_fused: boolean | null
          is_nft: boolean | null
          player_name: string
          price: number | null
          updated_at: string | null
          user_id: number
        }
        Insert: {
          card_set_id?: string | null
          card_set_no?: string | null
          created_at?: string | null
          deck_created_at?: string | null
          deck_id: string
          deck_name: string
          deck_rank?: string | null
          deck_score?: number | null
          digital?: boolean | null
          discord_username?: string | null
          display_name?: string | null
          elo?: number | null
          faction?: string | null
          forgeborn_id?: string | null
          format?: string | null
          fused_deck_ids?: string[] | null
          id?: string
          is_for_sale?: boolean | null
          is_fused?: boolean | null
          is_nft?: boolean | null
          player_name: string
          price?: number | null
          updated_at?: string | null
          user_id: number
        }
        Update: {
          card_set_id?: string | null
          card_set_no?: string | null
          created_at?: string | null
          deck_created_at?: string | null
          deck_id?: string
          deck_name?: string
          deck_rank?: string | null
          deck_score?: number | null
          digital?: boolean | null
          discord_username?: string | null
          display_name?: string | null
          elo?: number | null
          faction?: string | null
          forgeborn_id?: string | null
          format?: string | null
          fused_deck_ids?: string[] | null
          id?: string
          is_for_sale?: boolean | null
          is_fused?: boolean | null
          is_nft?: boolean | null
          player_name?: string
          price?: number | null
          updated_at?: string | null
          user_id?: number
        }
        Relationships: []
      }
    }
    player_profiles: {
      Row: {
        user_id: number
        discord_id: number
        player_name: string | null
        discord_name: string | null
        display_name: string | null
        friend_code: string | null
        updated_at: string | null
      }
      Insert: {
        user_id?: number
        discord_id: number
        player_name?: string | null
        discord_name?: string | null
        display_name?: string | null
        friend_code?: string | null
        updated_at?: string | null
      }
      Update: {
        user_id?: number
        discord_id?: number
        player_name?: string | null
        discord_name?: string | null
        display_name?: string | null
        friend_code?: string | null
        updated_at?: string | null
      }
      Relationships: []
    }
    Views: {
      [_ in never]: never
    }
    Functions: {
      [_ in never]: never
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
export type PlayerProfileRow = Database['public']['Tables']['player_profiles']['Row']
export type PlayerProfileInsert = Database['public']['Tables']['player_profiles']['Insert']
export type PlayerProfileUpdate = Database['public']['Tables']['player_profiles']['Update']

// Extended type for API responses with parsed JSON fields
export type PlayerDeck = PlayerDeckRow
