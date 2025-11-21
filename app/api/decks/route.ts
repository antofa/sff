import { NextRequest, NextResponse } from 'next/server'
import { getPlayerDecks } from '@/lib/api'

export async function GET(request: NextRequest) {
  try {
    const searchParams = request.nextUrl.searchParams
    const playerName = searchParams.get('player')

    if (!playerName) {
      return NextResponse.json(
        { error: 'Player parameter is required' },
        { status: 400 }
      )
    }

    console.log(`[API Route] Requesting decks for player: ${playerName}`)

    // Use real API
    const decks = await getPlayerDecks(playerName)

    console.log(`[API Route] Received ${decks.length} decks for player: ${playerName}`)

    // If no decks are found, return an empty array (not an error)
    // This is a normal situation if the player has no decks or the nickname is incorrect
    return NextResponse.json(decks)
  } catch (error) {
    console.error('[API Route] Error fetching decks:', error)
    console.error('[API Route] Stack trace:', error instanceof Error ? error.stack : 'No stack')
    
    const errorMessage = error instanceof Error ? error.message : 'Unknown error'
    
    // If it's a validation error (empty nickname), return 400
    if (errorMessage.includes('cannot be empty')) {
      return NextResponse.json(
        { error: errorMessage },
        { status: 400 }
      )
    }

    // For other errors return 500 with more detailed information
    return NextResponse.json(
      { 
        error: 'Failed to get decks. Please check the player nickname and try again.',
        details: process.env.NODE_ENV === 'development' ? errorMessage : undefined
      },
      { status: 500 }
    )
  }
}

