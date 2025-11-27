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
          cards: Json | null
          created_at: string | null
          deck_created_at: string | null
          deck_id: string
          deck_name: string
          deck_rank: string | null
          deck_score: number | null
          digital: boolean | null
          discord_username: string | null
          elo: number | null
          faction: string | null
          forgeborn: Json | null
          forgeborn_id: string | null
          format: string | null
          fused_deck_ids: string[] | null
          id: string
          is_for_sale: boolean | null
          is_fused: boolean | null
          is_nft: boolean | null
          my_decks: Json | null
          player_name: string
          price: number | null
          tags: Json | null
          updated_at: string | null
        }
        Insert: {
          card_set_id?: string | null
          card_set_no?: string | null
          cards?: Json | null
          created_at?: string | null
          deck_created_at?: string | null
          deck_id: string
          deck_name: string
          deck_rank?: string | null
          deck_score?: number | null
          digital?: boolean | null
          discord_username?: string | null
          elo?: number | null
          faction?: string | null
          forgeborn?: Json | null
          forgeborn_id?: string | null
          format?: string | null
          fused_deck_ids?: string[] | null
          id?: string
          is_for_sale?: boolean | null
          is_fused?: boolean | null
          is_nft?: boolean | null
          my_decks?: Json | null
          player_name: string
          price?: number | null
          tags?: Json | null
          updated_at?: string | null
        }
        Update: {
          card_set_id?: string | null
          card_set_no?: string | null
          cards?: Json | null
          created_at?: string | null
          deck_created_at?: string | null
          deck_id?: string
          deck_name?: string
          deck_rank?: string | null
          deck_score?: number | null
          digital?: boolean | null
          discord_username?: string | null
          elo?: number | null
          faction?: string | null
          forgeborn?: Json | null
          forgeborn_id?: string | null
          format?: string | null
          fused_deck_ids?: string[] | null
          id?: string
          is_for_sale?: boolean | null
          is_fused?: boolean | null
          is_nft?: boolean | null
          my_decks?: Json | null
          player_name?: string
          price?: number | null
          tags?: Json | null
          updated_at?: string | null
        }
        Relationships: []
      }
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

// Extended type for API responses with parsed JSON fields
export interface PlayerDeck extends Omit<PlayerDeckRow, 'cards' | 'forgeborn' | 'tags' | 'my_decks'> {
  cards: Array<{
    id: string
    name: string
    cardType?: string
    faction?: string
    rarity?: string
    [key: string]: unknown
  }> | null
  forgeborn: {
    id: string
    name?: string
    title?: string
    abilities?: unknown[]
    [key: string]: unknown
  } | null
  tags: Record<string, string> | null
  my_decks: Array<{
    id: string
    name: string
    faction?: string
    forgeborn?: unknown
    [key: string]: unknown
  }> | null
}

