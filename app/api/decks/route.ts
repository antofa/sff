import { NextRequest, NextResponse } from 'next/server'
import { getPlayerDecks, fetchFusedDecksFromAPI } from '@/lib/api'
import { logWithTimestamp } from '@/lib/logger'
import { syncDeckSearchToSupabase } from '@/lib/supabaseDeckSync'
import { putDeckOwnersToUpstashCache } from '@/lib/deckOwnerUpstashCache'

const syncBestEffort = async (playerName: string, regularDecks: any[], fusedDecks: any[]) => {
  try {
    const summary = await syncDeckSearchToSupabase(playerName, regularDecks, fusedDecks)
    if (summary.enabled) {
      if (summary.writeBlocked) {
        logWithTimestamp(
          `[API Route] Supabase sync write-blocked for ${playerName} until ${summary.writeBlockedUntil || 'unknown'}: regular ${summary.persistedRegular}/${regularDecks.length}, fused ${summary.persistedFused}/${fusedDecks.length}`
        )
      } else {
        logWithTimestamp(
          `[API Route] Supabase sync complete for ${playerName}: regular ${summary.persistedRegular}/${regularDecks.length}, fused ${summary.persistedFused}/${fusedDecks.length}`
        )
      }
    } else {
      logWithTimestamp(`[API Route] Supabase sync skipped for ${playerName}: missing env`)
    }
  } catch (error) {
    console.warn('[API Route] Supabase sync failed:', error)
  }
}

const resolveDeckId = (deck: any): string | null => {
  const raw = deck?.id ?? deck?.deckId ?? deck?.deck_id ?? null
  if (!raw) return null
  const normalized = String(raw).trim()
  return normalized || null
}

const resolveOwnerName = (deck: any, fallbackOwnerName: string): string => {
  const candidate =
    deck?.playerName ??
    deck?.player_name ??
    deck?.ownerName ??
    deck?.owner ??
    deck?.username ??
    deck?.userName ??
    deck?.myUser?.username ??
    deck?.users?.[0]?.username ??
    deck?.users?.[0]?.user?.username ??
    fallbackOwnerName
  return String(candidate || fallbackOwnerName).trim()
}

const cacheDeckOwnersBestEffort = async (playerName: string, decks: any[]) => {
  const entries = decks
    .map((deck) => {
      const deckId = resolveDeckId(deck)
      if (!deckId) return null
      return {
        deckId,
        ownerName: resolveOwnerName(deck, playerName),
      }
    })
    .filter((entry): entry is { deckId: string; ownerName: string } => !!entry)

  if (entries.length === 0) return

  await putDeckOwnersToUpstashCache(entries).catch((error) => {
    console.warn('[API Route] Failed to cache deck owners in Upstash:', error)
  })
}

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
      await cacheDeckOwnersBestEffort(playerName, fusedDecks)
      await syncBestEffort(playerName, [], fusedDecks)
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
      await cacheDeckOwnersBestEffort(playerName, decks)
      await syncBestEffort(playerName, decks, [])
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
      const { decks: regularDecks, meta } = await getPlayerDecks(playerName, { force })
      const fusedDecks = await fetchFusedDecksFromAPI(playerName, { force })
      await cacheDeckOwnersBestEffort(playerName, regularDecks)
      await cacheDeckOwnersBestEffort(playerName, fusedDecks)
      await syncBestEffort(playerName, regularDecks, fusedDecks)
      
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
