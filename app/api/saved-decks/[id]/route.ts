/**
 * API routes for managing individual saved decks
 */

import { NextRequest, NextResponse } from 'next/server'
import { getDeck, updateDeckMarketplace, deleteDeck } from '@/lib/supabase'

interface RouteParams {
  params: Promise<{
    id: string
  }>
}

/**
 * GET /api/saved-decks/[id]
 * Get a specific deck by deck_id
 * 
 * Query params:
 * - player: player name (required)
 */
export async function GET(
  request: NextRequest,
  { params }: RouteParams
) {
  try {
    const { id: deckId } = await params
    const playerName = request.nextUrl.searchParams.get('player')
    
    if (!playerName) {
      return NextResponse.json(
        { error: 'Player name is required' },
        { status: 400 }
      )
    }
    
    const { data, error } = await getDeck(deckId, playerName)
    
    if (error) {
      return NextResponse.json(
        { error: error.message },
        { status: 500 }
      )
    }
    
    if (!data) {
      return NextResponse.json(
        { error: 'Deck not found' },
        { status: 404 }
      )
    }
    
    return NextResponse.json({ deck: data })
  } catch (error) {
    console.error('[API] Error in GET /api/saved-decks/[id]:', error)
    return NextResponse.json(
      { error: error instanceof Error ? error.message : 'Unknown error' },
      { status: 500 }
    )
  }
}

/**
 * PATCH /api/saved-decks/[id]
 * Update a deck's marketplace settings
 * 
 * Body:
 * {
 *   playerName: string - player name (required)
 *   isNft?: boolean
 *   price?: number
 *   isForSale?: boolean
 *   discordUsername?: string
 * }
 */
export async function PATCH(
  request: NextRequest,
  { params }: RouteParams
) {
  try {
    const { id: deckId } = await params
    const body = await request.json()
    
    const { 
      playerName, 
      isNft, 
      price, 
      isForSale, 
      discordUsername 
    } = body as {
      playerName: string
      isNft?: boolean
      price?: number
      isForSale?: boolean
      discordUsername?: string
    }
    
    if (!playerName) {
      return NextResponse.json(
        { error: 'Player name is required' },
        { status: 400 }
      )
    }
    
    const { data, error } = await updateDeckMarketplace(deckId, playerName, {
      isNft,
      price,
      isForSale,
      discordUsername,
    })
    
    if (error) {
      return NextResponse.json(
        { error: error.message },
        { status: 500 }
      )
    }
    
    if (!data) {
      return NextResponse.json(
        { error: 'Deck not found' },
        { status: 404 }
      )
    }
    
    return NextResponse.json({ deck: data })
  } catch (error) {
    console.error('[API] Error in PATCH /api/saved-decks/[id]:', error)
    return NextResponse.json(
      { error: error instanceof Error ? error.message : 'Unknown error' },
      { status: 500 }
    )
  }
}

/**
 * DELETE /api/saved-decks/[id]
 * Delete a deck from the database
 * 
 * Query params:
 * - player: player name (required)
 */
export async function DELETE(
  request: NextRequest,
  { params }: RouteParams
) {
  try {
    const { id: deckId } = await params
    const playerName = request.nextUrl.searchParams.get('player')
    
    if (!playerName) {
      return NextResponse.json(
        { error: 'Player name is required' },
        { status: 400 }
      )
    }
    
    const { error } = await deleteDeck(deckId, playerName)
    
    if (error) {
      return NextResponse.json(
        { error: error.message },
        { status: 500 }
      )
    }
    
    return NextResponse.json({ success: true })
  } catch (error) {
    console.error('[API] Error in DELETE /api/saved-decks/[id]:', error)
    return NextResponse.json(
      { error: error instanceof Error ? error.message : 'Unknown error' },
      { status: 500 }
    )
  }
}

