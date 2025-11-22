import { NextRequest, NextResponse } from 'next/server'
import { getPlayerDecks, fetchFusedDecksFromAPI } from '@/lib/api'

export async function GET(request: NextRequest) {
  try {
    const searchParams = request.nextUrl.searchParams
    const playerName = searchParams.get('player')
    const type = searchParams.get('type') // 'regular', 'fused', or undefined (both)

    if (!playerName) {
      return NextResponse.json(
        { error: 'Player parameter is required' },
        { status: 400 }
      )
    }

    console.log(`[API Route] Requesting decks for player: ${playerName}, type: ${type || 'all'}`)

    if (type === 'fused') {
      // Fetch only fused decks
      const deckRank = searchParams.get('deckRank') || undefined
      const fusedDecks = await fetchFusedDecksFromAPI(playerName, deckRank)
      console.log(`[API Route] Received ${fusedDecks.length} fused decks for player: ${playerName}`)
      return NextResponse.json(fusedDecks)
    } else if (type === 'regular') {
      // Fetch only regular decks
      const decks = await getPlayerDecks(playerName)
      console.log(`[API Route] Received ${decks.length} regular decks for player: ${playerName}`)
      return NextResponse.json(decks)
    } else {
      // Fetch both regular and fused decks
      const [regularDecks, fusedDecks] = await Promise.all([
        getPlayerDecks(playerName),
        fetchFusedDecksFromAPI(playerName)
      ])
      
      console.log(`[API Route] Received ${regularDecks.length} regular and ${fusedDecks.length} fused decks for player: ${playerName}`)
      
      return NextResponse.json({
        regular: regularDecks,
        fused: fusedDecks,
        total: regularDecks.length + fusedDecks.length
      })
    }
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

