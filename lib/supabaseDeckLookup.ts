import { createClient, type SupabaseClient } from '@supabase/supabase-js'
import type { Database } from '@/types/database'

type RegularDeckFallback = {
  id: string
  name: string
  playerName: string
  username: string
  faction: string | null
  forgebornId: string | null
  cardSetId: string
  cardSetNo: string | number
  deckScore: number | null
  elo: number | null
  expireAt: string | null
  cards: Array<{ id: string; cardId: string; name: string }>
}

type FusedDeckFallback = {
  id: string
  name: string
  format: 'Fused'
  playerName: string
  username: string
  fusedDeckIds: string[]
  myDecks: Array<Record<string, unknown>>
  cards: Array<{ id: string; cardId: string; name: string }>
}

let supabaseClient: SupabaseClient<Database> | null | undefined

const getSupabaseClient = (): SupabaseClient<Database> | null => {
  if (supabaseClient !== undefined) {
    return supabaseClient
  }

  const url = process.env.NEXT_PUBLIC_SUPABASE_URL
  const key = process.env.SUPABASE_SERVICE_ROLE_KEY || process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY

  if (!url || !key) {
    supabaseClient = null
    return supabaseClient
  }

  supabaseClient = createClient<Database>(url, key, {
    auth: {
      persistSession: false,
      autoRefreshToken: false,
      detectSessionInUrl: false,
    },
  })

  return supabaseClient
}

const toStringOrNull = (value: unknown): string | null => {
  if (value === undefined || value === null) return null
  const normalized = String(value).trim()
  return normalized ? normalized : null
}

const normalizeDeckIdBase = (value: string) =>
  value
    .toString()
    .trim()
    .replace(/^deck[_-]?fused[_-]?/i, '')
    .replace(/^deck[_-]?/i, '')
    .replace(/^fused[_-]?/i, '')

const unique = (values: string[]) => Array.from(new Set(values.filter((value) => value.trim().length > 0)))

const buildRegularDeckIdCandidates = (deckId: string): string[] => {
  const raw = toStringOrNull(deckId) || ''
  const base = normalizeDeckIdBase(raw)
  return unique([
    raw,
    base,
    `Deck_${base}`,
    `Deck-${base}`,
  ])
}

const buildFusedDeckIdCandidates = (deckId: string): string[] => {
  const raw = toStringOrNull(deckId) || ''
  const base = normalizeDeckIdBase(raw)
  return unique([
    raw,
    base,
    `Fused_${base}`,
    `Fused-${base}`,
    `Deck_Fused_${base}`,
    `Deck-Fused-${base}`,
  ])
}

const mapSetIdToCardSetNo = (setId: string): string | number => {
  const normalized = setId.trim().toUpperCase()
  if (normalized === 'D0') return 99
  return normalized
}

const fetchCardNameMap = async (
  client: SupabaseClient<Database>,
  cardIds: string[]
): Promise<Map<string, string>> => {
  const idList = unique(cardIds)
  if (idList.length === 0) return new Map()

  const { data, error } = await client
    .from('cards')
    .select('card_id, card_name')
    .in('card_id', idList)

  if (error || !data) {
    return new Map()
  }

  const result = new Map<string, string>()
  data.forEach((row) => {
    result.set(row.card_id, row.card_name || row.card_id)
  })
  return result
}

const buildDeckCards = (
  cardIds: string[],
  cardNameMap: Map<string, string>,
  forgebornId?: string | null
): Array<{ id: string; cardId: string; name: string }> => {
  const cards = unique(cardIds).map((cardId) => ({
    id: cardId,
    cardId,
    name: cardNameMap.get(cardId) || cardId,
  }))

  if (forgebornId && !cards.some((card) => card.id === forgebornId)) {
    cards.unshift({
      id: forgebornId,
      cardId: forgebornId,
      name: forgebornId,
    })
  }

  return cards
}

export const getRegularDeckFromSupabaseById = async (
  deckId: string
): Promise<RegularDeckFallback | null> => {
  const client = getSupabaseClient()
  if (!client) return null

  const deckIdCandidates = buildRegularDeckIdCandidates(deckId)
  if (deckIdCandidates.length === 0) return null

  try {
    const { data: deckRows, error: deckError } = await client
      .from('player_decks')
      .select(
        'deck_id, deck_name, owner_name, faction, forgeborn_id, set_id, deck_score, elo, expire_date'
      )
      .in('deck_id', deckIdCandidates)
      .limit(1)

    if (deckError || !deckRows || deckRows.length === 0) return null

    const row = deckRows[0]
    const { data: cardRows, error: cardError } = await client
      .from('player_deck_cards')
      .select('deck_id, card_id')
      .eq('deck_id', row.deck_id)
      .order('id', { ascending: true })

    const cardIds = cardError || !cardRows ? [] : cardRows.map((card) => card.card_id)
    const cardNameMap = await fetchCardNameMap(client, cardIds)

    return {
      id: row.deck_id,
      name: row.deck_name,
      playerName: row.owner_name,
      username: row.owner_name,
      faction: row.faction,
      forgebornId: row.forgeborn_id,
      cardSetId: row.set_id,
      cardSetNo: mapSetIdToCardSetNo(row.set_id),
      deckScore: row.deck_score,
      elo: row.elo,
      expireAt: row.expire_date,
      cards: buildDeckCards(cardIds, cardNameMap, row.forgeborn_id),
    }
  } catch (error) {
    console.warn('[Supabase lookup] failed regular deck lookup:', error)
    return null
  }
}

export const getFusedDeckFromSupabaseById = async (
  deckId: string
): Promise<FusedDeckFallback | null> => {
  const client = getSupabaseClient()
  if (!client) return null

  const deckIdCandidates = buildFusedDeckIdCandidates(deckId)
  if (deckIdCandidates.length === 0) return null

  try {
    const { data: fusedRows, error: fusedError } = await client
      .from('player_fused_decks')
      .select('fused_deck_id, deck_name, owner_name, source_deck_1_id, source_deck_2_id')
      .in('fused_deck_id', deckIdCandidates)
      .limit(1)

    if (fusedError || !fusedRows || fusedRows.length === 0) return null

    const fusedRow = fusedRows[0]
    const sourceDeckIds = unique([fusedRow.source_deck_1_id, fusedRow.source_deck_2_id])
    if (sourceDeckIds.length === 0) {
      return {
        id: fusedRow.fused_deck_id,
        name: fusedRow.deck_name,
        format: 'Fused',
        playerName: fusedRow.owner_name,
        username: fusedRow.owner_name,
        fusedDeckIds: [],
        myDecks: [],
        cards: [],
      }
    }

    const [sourceDecksResult, sourceCardsResult] = await Promise.all([
      client
        .from('player_decks')
        .select(
          'deck_id, deck_name, owner_name, faction, forgeborn_id, set_id, deck_score, elo, expire_date'
        )
        .in('deck_id', sourceDeckIds),
      client
        .from('player_deck_cards')
        .select('deck_id, card_id')
        .in('deck_id', sourceDeckIds),
    ])

    const sourceDeckRows = sourceDecksResult.error || !sourceDecksResult.data ? [] : sourceDecksResult.data
    const sourceCardRows = sourceCardsResult.error || !sourceCardsResult.data ? [] : sourceCardsResult.data
    const sourceDeckById = new Map(sourceDeckRows.map((row) => [row.deck_id, row]))

    const cardIdsByDeck = new Map<string, string[]>()
    sourceCardRows.forEach((row) => {
      const list = cardIdsByDeck.get(row.deck_id) || []
      list.push(row.card_id)
      cardIdsByDeck.set(row.deck_id, list)
    })

    const cardNameMap = await fetchCardNameMap(
      client,
      sourceCardRows.map((row) => row.card_id)
    )

    const myDecks = sourceDeckIds.map((sourceDeckId) => {
      const sourceRow = sourceDeckById.get(sourceDeckId)
      const cardIds = cardIdsByDeck.get(sourceDeckId) || []
      const cards = buildDeckCards(cardIds, cardNameMap, sourceRow?.forgeborn_id || null)
      if (!sourceRow) {
        return {
          id: sourceDeckId,
          cards,
        }
      }

      return {
        id: sourceRow.deck_id,
        name: sourceRow.deck_name,
        playerName: sourceRow.owner_name,
        username: sourceRow.owner_name,
        faction: sourceRow.faction,
        forgebornId: sourceRow.forgeborn_id,
        cardSetId: sourceRow.set_id,
        cardSetNo: mapSetIdToCardSetNo(sourceRow.set_id),
        deckScore: sourceRow.deck_score,
        elo: sourceRow.elo,
        expireAt: sourceRow.expire_date,
        cards,
      }
    })

    const mergedCardsById = new Map<string, { id: string; cardId: string; name: string }>()
    myDecks.forEach((deck) => {
      const cards = Array.isArray(deck.cards) ? deck.cards : []
      cards.forEach((card) => {
        const cardId = toStringOrNull((card as Record<string, unknown>).id)
        if (!cardId || mergedCardsById.has(cardId)) return
        const name = toStringOrNull((card as Record<string, unknown>).name) || cardId
        mergedCardsById.set(cardId, {
          id: cardId,
          cardId,
          name,
        })
      })
    })

    return {
      id: fusedRow.fused_deck_id,
      name: fusedRow.deck_name,
      format: 'Fused',
      playerName: fusedRow.owner_name,
      username: fusedRow.owner_name,
      fusedDeckIds: sourceDeckIds,
      myDecks,
      cards: Array.from(mergedCardsById.values()),
    }
  } catch (error) {
    console.warn('[Supabase lookup] failed fused deck lookup:', error)
    return null
  }
}
