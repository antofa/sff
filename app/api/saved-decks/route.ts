/**
 * API routes for managing saved player decks in Supabase
 */

import { NextRequest, NextResponse } from 'next/server'
import { createClient } from '@supabase/supabase-js'
import { 
  saveDecks, 
  getPlayerDecks, 
  getDecksForSale, 
  searchDecks 
} from '@/lib/supabase'
import type { Deck } from '@/store/deckStore'
import type { Database } from '@/types/database'

const supabaseUrl = process.env.NEXT_PUBLIC_SUPABASE_URL!
const supabaseServiceKey = process.env.SUPABASE_SERVICE_ROLE_KEY || process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY!
const supabaseServer = createClient<Database>(supabaseUrl, supabaseServiceKey)

/**
 * GET /api/saved-decks
 * Get saved decks with optional filtering
 * 
 * Query params:
 * - player: player name (returns all decks for this player)
 * - forSale: if "true", returns only decks for sale
 * - faction: filter by faction
 * - format: filter by format
 * - isNft: filter by NFT status
 * - search: search query for deck name
 * - limit: max number of results
 * - offset: pagination offset
 */
export async function GET(request: NextRequest) {
  try {
    const searchParams = request.nextUrl.searchParams
    const playerName = searchParams.get('player')
    const forSale = searchParams.get('forSale') === 'true'
    const faction = searchParams.get('faction')
    const format = searchParams.get('format')
    const isNft = searchParams.get('isNft')
    const searchQuery = searchParams.get('search')
    const limit = searchParams.get('limit')
    const offset = searchParams.get('offset')
    
    // If player is specified and not looking for marketplace
    if (playerName && !forSale) {
      const { data, error } = await getPlayerDecks(playerName)
      
      if (error) {
        return NextResponse.json(
          { error: error.message },
          { status: 500 }
        )
      }
      
      return NextResponse.json({ decks: data, count: data.length })
    }
    
    // If looking for decks for sale
    if (forSale) {
      const { data, error, count } = await getDecksForSale({
        faction: faction ?? undefined,
        format: format ?? undefined,
        isNft: isNft !== null ? isNft === 'true' : undefined,
        limit: limit ? parseInt(limit, 10) : undefined,
        offset: offset ? parseInt(offset, 10) : undefined,
      })
      
      if (error) {
        return NextResponse.json(
          { error: error.message },
          { status: 500 }
        )
      }
      
      return NextResponse.json({ decks: data, count })
    }
    
    // General search
    const { data, error, count } = await searchDecks({
      playerName: playerName ?? undefined,
      faction: faction ?? undefined,
      format: format ?? undefined,
      isNft: isNft !== null ? isNft === 'true' : undefined,
      searchQuery: searchQuery ?? undefined,
      limit: limit ? parseInt(limit, 10) : undefined,
      offset: offset ? parseInt(offset, 10) : undefined,
    })
    
    if (error) {
      return NextResponse.json(
        { error: error.message },
        { status: 500 }
      )
    }
    
    return NextResponse.json({ decks: data, count })
  } catch (error) {
    console.error('[API] Error in GET /api/saved-decks:', error)
    return NextResponse.json(
      { error: error instanceof Error ? error.message : 'Unknown error' },
      { status: 500 }
    )
  }
}

/**
 * POST /api/saved-decks
 * Save one or more decks to the database
 * 
 * Body:
 * {
 *   decks: Deck[] - array of decks to save
 *   playerName: string - player name
 *   discordUsername?: string - discord username
 *   isNft?: boolean - whether decks are NFTs
 *   price?: number - price if for sale
 *   isForSale?: boolean - whether decks are for sale
 * }
 */
export async function POST(request: NextRequest) {
  try {
    const body = await request.json()
    
    const { 
      decks, 
      playerName, 
      discordUsername, 
      isNft, 
      price, 
      isForSale 
    } = body as {
      decks: Deck[]
      playerName: string
      discordUsername?: string
      isNft?: boolean
      price?: number
      isForSale?: boolean
    }
    
    if (!decks || !Array.isArray(decks) || decks.length === 0) {
      return NextResponse.json(
        { error: 'No decks provided' },
        { status: 400 }
      )
    }
    
    if (!playerName) {
      return NextResponse.json(
        { error: 'Player name is required' },
        { status: 400 }
      )
    }

    const normalizedDiscord = typeof discordUsername === 'string'
      ? discordUsername.trim()
      : undefined

    // Ensure user profile exists for this playerName
    const normalizedPlayer = playerName.trim()
    let userId: number | null = null
    try {
      // Try to find existing profile by player_name (case-insensitive)
      const { data: existingProfiles, error: profileLookupError } = await supabaseServer
        .from('player_profiles')
        .select('user_id, player_name')
        .ilike('player_name', normalizedPlayer)
        .limit(1)

      if (profileLookupError) {
        console.error('[API] /api/saved-decks profile lookup error:', profileLookupError)
      }

      if (existingProfiles && existingProfiles.length > 0) {
        userId = existingProfiles[0].user_id
      } else {
        // Create new profile
        const { data: inserted, error: insertError } = await supabaseServer
          .from('player_profiles')
          .insert({
            discord_id: '',
            player_name: normalizedPlayer,
            display_name: normalizedPlayer,
            discord_name: normalizedDiscord ?? null,
          })
          .select('user_id')
          .single()

        if (insertError) {
          console.error('[API] /api/saved-decks profile insert error:', insertError)
        } else {
          userId = inserted?.user_id ?? null
        }
      }
    } catch (profileError) {
      console.error('[API] /api/saved-decks profile ensure error:', profileError)
    }
    
    if (!userId) {
      return NextResponse.json(
        { error: 'Failed to ensure user profile for this player' },
        { status: 500 }
      )
    }
    
    const { data, errors } = await saveDecks(decks, playerName, {
      discordUsername: normalizedDiscord,
      isNft,
      price,
      isForSale,
      userId,
    })
    
    if (errors.length > 0) {
      console.error('[API] Errors saving decks:', errors)
    }
    
    return NextResponse.json({
      saved: data.length,
      errors: errors.length,
      decks: data,
    })
  } catch (error) {
    console.error('[API] Error in POST /api/saved-decks:', error)
    return NextResponse.json(
      { error: error instanceof Error ? error.message : 'Unknown error' },
      { status: 500 }
    )
  }
}
