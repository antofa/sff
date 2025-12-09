import { NextRequest, NextResponse } from 'next/server'
import { getPlayerDecks, fetchFusedDecksFromAPI } from '@/lib/api'
import { logWithTimestamp } from '@/lib/logger'

export async function GET(request: NextRequest) {
  try {
    const searchParams = request.nextUrl.searchParams
    const playerName = searchParams.get('player')
    const type = searchParams.get('type') // 'regular', 'fused', or undefined (both)
    const force = searchParams.get('force') === '1' || searchParams.get('force') === 'true'

    if (!playerName) {
      return NextResponse.json(
        { error: 'Player parameter is required' },
        { status: 400 }
      )
    }

    logWithTimestamp(`[API Route] Requesting decks for player: ${playerName}, type: ${type || 'all'}`)

    if (type === 'fused') {
      // Fetch only fused decks
      const fusedDecks = await fetchFusedDecksFromAPI(playerName, { force })
      logWithTimestamp(`[API Route] Received ${fusedDecks.length} fused decks for player: ${playerName}`)
      return NextResponse.json({
        fused: fusedDecks,
        meta: {
          fusedCount: fusedDecks.length,
          fusedPages: fusedDecks.length > 0 ? 1 : 0,
        },
      })
    } else if (type === 'regular') {
      // Fetch only regular decks
      const { decks, meta } = await getPlayerDecks(playerName, { force })
      logWithTimestamp(`[API Route] Received ${decks.length} regular decks for player: ${playerName}`)
      return NextResponse.json({
        regular: decks,
        meta: {
          regularCount: decks.length,
          regularPages: meta.pages,
          total: decks.length,
        },
      })
    } else {
      // Fetch both regular and fused decks
      const [{ decks: regularDecks, meta }, fusedDecks] = await Promise.all([
        getPlayerDecks(playerName, { force }),
        fetchFusedDecksFromAPI(playerName, { force })
      ])
      
      logWithTimestamp(`[API Route] Received ${regularDecks.length} regular and ${fusedDecks.length} fused decks for player: ${playerName}`)
      
      return NextResponse.json({
        regular: regularDecks,
        fused: fusedDecks,
        total: regularDecks.length + fusedDecks.length,
        meta: {
          regularCount: regularDecks.length,
          fusedCount: fusedDecks.length,
          total: regularDecks.length + fusedDecks.length,
          regularPages: meta.pages,
          fusedPages: fusedDecks.length > 0 ? 1 : 0,
        },
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
