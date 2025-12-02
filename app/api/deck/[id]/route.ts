import { NextRequest, NextResponse } from 'next/server'
import { createClient } from '@supabase/supabase-js'
import { fetchDeckDetails, normalizeDeck } from '@/lib/api'
import type { Database, PlayerDeckRow } from '@/types/database'

const supabaseUrl = process.env.NEXT_PUBLIC_SUPABASE_URL!
const supabaseServiceKey = process.env.SUPABASE_SERVICE_ROLE_KEY || process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY!
const supabase = createClient<Database>(supabaseUrl, supabaseServiceKey)

const mapSupabaseRowToDeck = (row: PlayerDeckRow, profile?: { player_name?: string | null; display_name?: string | null; discord_name?: string | null }) => {
  const ownerDisplay = profile?.display_name || profile?.player_name || undefined
  return {
    id: row.deck_id,
    name: row.deck_name,
    format: row.format ?? (row.is_fused ? 'Fused' : undefined),
    faction: row.faction ?? undefined,
    forgebornId: row.forgeborn_id ?? undefined,
    created: row.deck_created_at ?? row.updated_at ?? row.created_at ?? undefined,
    deckRank: row.deck_rank ?? undefined,
    digital: row.digital ?? undefined,
    cardSetNo: row.card_set_no ?? undefined,
    cardSetId: row.card_set_id ?? undefined,
    fusedDeckIds: row.fused_deck_ids ?? undefined,
    deckScore: row.deck_score ?? undefined,
    elo: row.elo ?? undefined,
    is_fused: row.is_fused ?? undefined,
    is_for_sale: row.is_for_sale ?? undefined,
    is_nft: row.is_nft ?? undefined,
    price: row.price ?? undefined,
    playerName: ownerDisplay || row.player_name || undefined,
  }
}

export async function GET(
  _request: NextRequest,
  context: { params: Promise<{ id?: string }> }
) {
  const { id } = await context.params
  const deckId = id

  if (!deckId) {
    return NextResponse.json({ error: 'Deck id is required' }, { status: 400 })
  }

  try {
    // Support multiple id formats: Deck_..., Deck_Fused_..., Fused_...
    const candidates = Array.from(
      new Set(
        [
          deckId,
          deckId.replace(/^Deck[_-]?/i, ''),
          deckId.replace(/^Deck[_-]?Fused[_-]?/i, ''),
          deckId.replace(/^Fused[_-]?/i, ''),
        ].filter(Boolean)
      )
    )

    // 1) Try Supabase (player_decks) for each candidate
    for (const candidate of candidates) {
      const { data, error } = await supabase
        .from('player_decks')
        .select('*')
        .eq('deck_id', candidate)
        .order('updated_at', { ascending: false })
        .limit(1)

      if (error) {
        console.error('[API] /api/deck supabase error:', error)
        continue
      }

      if (data && data.length > 0) {
        const row = data[0] as PlayerDeckRow
        let profile: { player_name?: string | null; display_name?: string | null; discord_name?: string | null } | undefined
        if (row.user_id) {
          try {
            const { data: profileRow, error: profileError } = await supabase
              .from('player_profiles')
              .select('player_name, display_name, discord_name')
              .eq('user_id', row.user_id)
              .single()
            if (!profileError && profileRow) {
              profile = profileRow as any
            }
          } catch (profileErr) {
            console.warn('[API] /api/deck profile lookup failed:', profileErr)
          }
        }

        const supabaseDeck = mapSupabaseRowToDeck(row, profile)
        const needsHydration = true // We no longer store cards/tags/forgeborn in DB; always hydrate from external API

        if (needsHydration) {
          try {
            const raw = await fetchDeckDetails(candidate)
            if (raw) {
              const normalized = normalizeDeck(raw)
              const owner =
                supabaseDeck.playerName ||
                raw.playerName ||
                raw.player_name ||
                raw.username ||
                raw.userName ||
                raw.owner ||
                raw?.users?.[0]?.username ||
                raw?.users?.[0]?.user?.username ||
                raw?.Users?.[0]?.UserName ||
                undefined

              const hydratedDeck = {
                ...supabaseDeck,
                ...normalized,
                playerName: owner || supabaseDeck.playerName,
                is_for_sale: supabaseDeck.is_for_sale,
                is_nft: supabaseDeck.is_nft,
                price: supabaseDeck.price,
              }

              return NextResponse.json({ deck: hydratedDeck })
            }
          } catch (err) {
            console.warn('[API] Hydration from external API failed, using Supabase deck:', err)
          }
        }

        return NextResponse.json({ deck: supabaseDeck })
      }
    }

    // 2) Try as regular deck for each candidate via external API
    for (const candidate of candidates) {
      const raw = await fetchDeckDetails(candidate)
      if (raw) {
        try {
          const deck = normalizeDeck(raw)
          const owner =
            raw.playerName ||
            raw.player_name ||
            raw.username ||
            raw.userName ||
            raw.owner ||
            raw?.users?.[0]?.username ||
            raw?.users?.[0]?.user?.username ||
            raw?.Users?.[0]?.UserName ||
            undefined
          if (owner && !(deck as any).playerName) {
            ;(deck as any).playerName = owner
          }
          return NextResponse.json({ deck })
        } catch (e) {
          console.warn('[API] normalizeDeck failed, will try fused fallback:', e)
        }
      }
    }

    // 3) Fallback for fused decks
    const API_BASE_URL = 'https://ul51g2rg42.execute-api.us-east-1.amazonaws.com/main'
    for (const candidate of candidates) {
      const fusedRes = await fetch(`${API_BASE_URL}/fuseddeck/${candidate}?inclCards=true&inclUsers=true`, {
        method: 'GET',
        headers: { Accept: 'application/json' },
        signal: AbortSignal.timeout(15000),
      })

      if (!fusedRes.ok) {
        continue
      }

      const fusedRaw = await fusedRes.json()
      const owner =
        fusedRaw.playerName ||
        fusedRaw.player_name ||
        fusedRaw.username ||
        fusedRaw.userName ||
        fusedRaw.owner ||
        fusedRaw?.users?.[0]?.username ||
        fusedRaw?.users?.[0]?.user?.username ||
        fusedRaw?.Users?.[0]?.UserName ||
        undefined

      // Try to build full cards list from source decks if fused cards are empty
      const sourceDecks: any[] =
        (Array.isArray(fusedRaw.myDecks) && fusedRaw.myDecks) ||
        (Array.isArray(fusedRaw.decks) && fusedRaw.decks) ||
        []

      const extractCards = (d: any): any[] => {
        if (!d) return []
        if (Array.isArray(d.cardList) && d.cardList.length > 0) return d.cardList
        if (Array.isArray(d.cards) && d.cards.length > 0) return d.cards
        if (Array.isArray(d.cardIds) && d.cardIds.length > 0) return d.cardIds
        return []
      }

      const mergedCardsFromSources = sourceDecks.flatMap(extractCards).filter((c) => !!c)
      const fusedCards =
        (Array.isArray(fusedRaw.cardList) && fusedRaw.cardList.length > 0
          ? fusedRaw.cardList
          : Array.isArray(fusedRaw.cards) && fusedRaw.cards.length > 0
            ? fusedRaw.cards
            : []) as any[]

      const cards = mergedCardsFromSources.length > 0 ? mergedCardsFromSources : fusedCards

      const myDecksNormalized = sourceDecks.map((d) => ({
        ...d,
        cards: extractCards(d),
      }))

      const fusedDeck = {
        id: fusedRaw.id || candidate,
        name: fusedRaw.name || 'Fused Deck',
        format: 'Fused',
        cards,
        myDecks: myDecksNormalized,
        fusedDeckIds: sourceDecks.map((d: any) => d?.id || d?.deckId || d?.deck_id).filter(Boolean),
        created: fusedRaw.created || fusedRaw.CreatedAt || fusedRaw.createdAt || null,
        updatedAt: fusedRaw.updated || fusedRaw.UpdatedAt || fusedRaw.updatedAt || null,
        forgeborn: fusedRaw.forgeborn || null,
        forgebornId: fusedRaw.forgeborn?.id || fusedRaw.forgebornId || null,
        deckRank: fusedRaw.deckRank || fusedRaw.rank || null,
        cardSetNo: fusedRaw.cardSetNo || null,
        cardSetId: fusedRaw.cardSetId || null,
        faction: fusedRaw.faction || null,
        tags: fusedRaw.tags || null,
        deckScore: fusedRaw.deckScore || null,
        elo: fusedRaw.elo || null,
        digital: fusedRaw.digital ?? null,
        playerName: owner,
      }

      return NextResponse.json({ deck: fusedDeck })
    }

    return NextResponse.json({ error: 'Deck not found' }, { status: 404 })
  } catch (error) {
    console.error('[API] /api/deck/[id] error:', error)
    return NextResponse.json(
      { error: 'Failed to load deck' },
      { status: 500 }
    )
  }
}
