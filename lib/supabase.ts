/**
 * Supabase client and database operations for player decks
 */

import { createClient } from '@supabase/supabase-js'
import type { Database, PlayerDeckInsert, PlayerDeckUpdate, PlayerDeck } from '@/types/database'
import type { Deck } from '@/store/deckStore'

// Environment variables for Supabase connection
const supabaseUrl = process.env.NEXT_PUBLIC_SUPABASE_URL!
const supabaseAnonKey = process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY!
const supabaseServiceKey = process.env.SUPABASE_SERVICE_ROLE_KEY || supabaseAnonKey

// Create Supabase client (anon by default; API routes can override with service key)
export const supabase = createClient<Database>(supabaseUrl, supabaseAnonKey)

const normalizeDiscord = (value?: string | null) => {
  if (!value) return null
  return value.trim().toLowerCase()
}

/**
 * Convert a Deck from the store/API to a PlayerDeckInsert for database
 */
export function deckToInsert(
  deck: Deck,
  playerName: string,
  options?: {
    discordUsername?: string
    isNft?: boolean
    price?: number
    isForSale?: boolean
    userId?: number
  }
): PlayerDeckInsert {
  const trimmedName = playerName.trim()
  const normalizedName = trimmedName.toLowerCase()

  return {
    deck_id: deck.id,
    deck_name: deck.name,
    player_name: normalizedName,
    display_name: trimmedName || playerName,
    discord_username: normalizeDiscord(options?.discordUsername) ?? null,
    format: deck.format ?? null,
    faction: deck.faction ?? null,
    forgeborn_id: deck.forgebornId ?? null,
    deck_rank: deck.deckRank ?? null,
    digital: typeof deck.digital === 'boolean' ? deck.digital : (deck.digital === 1),
    card_set_no: deck.cardSetNo ?? null,
    card_set_id: deck.cardSetId ?? null,
    deck_score: (deck as Record<string, unknown>).deckScore as number ?? null,
    elo: (deck as Record<string, unknown>).elo as number ?? null,
    is_nft: options?.isNft ?? false,
    price: options?.price ?? null,
    is_for_sale: options?.isForSale ?? false,
    is_fused: Boolean(deck.fusedDeckIds && deck.fusedDeckIds.length > 0),
    fused_deck_ids: deck.fusedDeckIds ?? null,
    deck_created_at: deck.created ?? null,
    user_id: options?.userId ?? 0,
  }
}

/**
 * Save a single deck to the database
 * Uses upsert to handle duplicates based on deck_id + player_name
 */
export async function saveDeck(
  deck: Deck,
  playerName: string,
  options?: {
    discordUsername?: string
    isNft?: boolean
    price?: number
    isForSale?: boolean
    userId?: number
  }
): Promise<{ data: PlayerDeck | null; error: Error | null }> {
  const insertData = deckToInsert(deck, playerName, options)
  
  const { data, error } = await supabase
    .from('player_decks')
    .upsert(insertData, {
      onConflict: 'deck_id,player_name',
      ignoreDuplicates: false,
    })
    .select()
    .single()
  
  if (error) {
    console.error('[Supabase] Error saving deck:', error)
    return { data: null, error: new Error(error.message) }
  }
  
  return { data: data as unknown as PlayerDeck, error: null }
}

/**
 * Save multiple decks to the database
 */
export async function saveDecks(
  decks: Deck[],
  playerName: string,
  options?: {
    discordUsername?: string
    isNft?: boolean
    price?: number
    isForSale?: boolean
    userId?: number
  }
): Promise<{ data: PlayerDeck[]; errors: Error[] }> {
  const results: PlayerDeck[] = []
  const errors: Error[] = []
  
  // Process in batches of 50 to avoid payload size limits
  const batchSize = 50
  for (let i = 0; i < decks.length; i += batchSize) {
    const batch = decks.slice(i, i + batchSize)
    const insertData = batch.map(deck => deckToInsert(deck, playerName, options))
    
    const { data, error } = await supabase
      .from('player_decks')
      .upsert(insertData, {
        onConflict: 'deck_id,player_name',
        ignoreDuplicates: false,
      })
      .select()
    
    if (error) {
      console.error(`[Supabase] Error saving batch ${i / batchSize + 1}:`, error)
      errors.push(new Error(error.message))
    } else if (data) {
      results.push(...(data as unknown as PlayerDeck[]))
    }
  }
  
  return { data: results, errors }
}

/**
 * Get all decks for a player
 */
export async function getPlayerDecks(playerName: string): Promise<{
  data: PlayerDeck[]
  error: Error | null
}> {
  const { data, error } = await supabase
    .from('player_decks')
    .select('*')
    .eq('player_name', playerName.toLowerCase())
    .order('deck_created_at', { ascending: false })
    .order('created_at', { ascending: false })
  
  if (error) {
    console.error('[Supabase] Error fetching player decks:', error)
    return { data: [], error: new Error(error.message) }
  }
  
  return { data: (data as unknown as PlayerDeck[]) ?? [], error: null }
}

/**
 * Get a single deck by deck_id and player_name
 */
export async function getDeck(
  deckId: string,
  playerName: string
): Promise<{ data: PlayerDeck | null; error: Error | null }> {
  const { data, error } = await supabase
    .from('player_decks')
    .select('*')
    .eq('deck_id', deckId)
    .eq('player_name', playerName.toLowerCase())
    .single()
  
  if (error) {
    if (error.code === 'PGRST116') {
      // No rows returned - not an error, just not found
      return { data: null, error: null }
    }
    console.error('[Supabase] Error fetching deck:', error)
    return { data: null, error: new Error(error.message) }
  }
  
  return { data: data as unknown as PlayerDeck, error: null }
}

/**
 * Get all decks that are for sale
 */
export async function getDecksForSale(options?: {
  faction?: string
  format?: string
  isNft?: boolean
  minPrice?: number
  maxPrice?: number
  limit?: number
  offset?: number
}): Promise<{ data: PlayerDeck[]; error: Error | null; count: number }> {
  let query = supabase
    .from('player_decks')
    .select('*', { count: 'exact' })
    .eq('is_for_sale', true)
  
  if (options?.faction) {
    query = query.eq('faction', options.faction)
  }
  if (options?.format) {
    query = query.eq('format', options.format)
  }
  if (options?.isNft !== undefined) {
    query = query.eq('is_nft', options.isNft)
  }
  if (options?.minPrice !== undefined) {
    query = query.gte('price', options.minPrice)
  }
  if (options?.maxPrice !== undefined) {
    query = query.lte('price', options.maxPrice)
  }
  
  query = query
    .order('deck_created_at', { ascending: false })
    .order('created_at', { ascending: false })
  
  if (options?.limit) {
    query = query.limit(options.limit)
  }
  if (options?.offset) {
    query = query.range(options.offset, options.offset + (options.limit ?? 10) - 1)
  }
  
  const { data, error, count } = await query
  
  if (error) {
    console.error('[Supabase] Error fetching decks for sale:', error)
    return { data: [], error: new Error(error.message), count: 0 }
  }
  
  return { data: (data as unknown as PlayerDeck[]) ?? [], error: null, count: count ?? 0 }
}

/**
 * Update a deck (e.g., to change price or for_sale status)
 */
export async function updateDeck(
  id: string,
  updates: PlayerDeckUpdate
): Promise<{ data: PlayerDeck | null; error: Error | null }> {
  const { data, error } = await supabase
    .from('player_decks')
    .update(updates)
    .eq('id', id)
    .select()
    .single()
  
  if (error) {
    console.error('[Supabase] Error updating deck:', error)
    return { data: null, error: new Error(error.message) }
  }
  
  return { data: data as unknown as PlayerDeck, error: null }
}

/**
 * Update deck marketplace settings
 */
export async function updateDeckMarketplace(
  deckId: string,
  playerName: string,
  settings: {
    isNft?: boolean
    price?: number
    isForSale?: boolean
    discordUsername?: string
  }
): Promise<{ data: PlayerDeck | null; error: Error | null }> {
  const updates: PlayerDeckUpdate = {}
  
  if (settings.isNft !== undefined) updates.is_nft = settings.isNft
  if (settings.price !== undefined) updates.price = settings.price
  if (settings.isForSale !== undefined) updates.is_for_sale = settings.isForSale
  if (settings.discordUsername !== undefined) updates.discord_username = settings.discordUsername
  
  const { data, error } = await supabase
    .from('player_decks')
    .update(updates)
    .eq('deck_id', deckId)
    .eq('player_name', playerName.toLowerCase())
    .select()
    .single()
  
  if (error) {
    console.error('[Supabase] Error updating deck marketplace settings:', error)
    return { data: null, error: new Error(error.message) }
  }
  
  return { data: data as unknown as PlayerDeck, error: null }
}

/**
 * Delete a deck from the database
 */
export async function deleteDeck(
  deckId: string,
  playerName: string
): Promise<{ error: Error | null }> {
  const { error } = await supabase
    .from('player_decks')
    .delete()
    .eq('deck_id', deckId)
    .eq('player_name', playerName.toLowerCase())
  
  if (error) {
    console.error('[Supabase] Error deleting deck:', error)
    return { error: new Error(error.message) }
  }
  
  return { error: null }
}

/**
 * Search decks by various criteria
 */
export async function searchDecks(criteria: {
  playerName?: string
  discordUsername?: string
  faction?: string
  format?: string
  isNft?: boolean
  isForSale?: boolean
  searchQuery?: string
  limit?: number
  offset?: number
}): Promise<{ data: PlayerDeck[]; error: Error | null; count: number }> {
  let query = supabase
    .from('player_decks')
    .select('*', { count: 'exact' })
  
  if (criteria.playerName) {
    query = query.ilike('player_name', `%${criteria.playerName}%`)
  }
  if (criteria.discordUsername) {
    query = query.ilike('discord_username', `%${criteria.discordUsername}%`)
  }
  if (criteria.faction) {
    query = query.eq('faction', criteria.faction)
  }
  if (criteria.format) {
    query = query.eq('format', criteria.format)
  }
  if (criteria.isNft !== undefined) {
    query = query.eq('is_nft', criteria.isNft)
  }
  if (criteria.isForSale !== undefined) {
    query = query.eq('is_for_sale', criteria.isForSale)
  }
  if (criteria.searchQuery) {
    query = query.ilike('deck_name', `%${criteria.searchQuery}%`)
  }
  
  query = query
    .order('deck_created_at', { ascending: false })
    .order('created_at', { ascending: false })
  
  if (criteria.limit) {
    query = query.limit(criteria.limit)
  }
  if (criteria.offset) {
    query = query.range(criteria.offset, criteria.offset + (criteria.limit ?? 10) - 1)
  }
  
  const { data, error, count } = await query
  
  if (error) {
    console.error('[Supabase] Error searching decks:', error)
    return { data: [], error: new Error(error.message), count: 0 }
  }
  
  return { data: (data as unknown as PlayerDeck[]) ?? [], error: null, count: count ?? 0 }
}
