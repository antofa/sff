import { NextRequest, NextResponse } from 'next/server'
import { createClient } from '@supabase/supabase-js'
import { fetchDeckDetails, normalizeDeck, getPlayerDecks } from '@/lib/api'
import type { Database, PlayerDeckRow } from '@/types/database'

const supabaseUrl = process.env.NEXT_PUBLIC_SUPABASE_URL
const supabaseServiceKey = process.env.SUPABASE_SERVICE_ROLE_KEY || process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY
const supabase =
  supabaseUrl && supabaseServiceKey
    ? createClient<Database>(supabaseUrl, supabaseServiceKey)
    : null

const mergeFromPlayerDecks = async (deck: any) => {
  const owner =
    deck?.playerName ||
    deck?.username ||
    deck?.userName ||
    deck?.owner ||
    deck?.users?.[0]?.username ||
    deck?.Users?.[0]?.UserName ||
    undefined

  if (!owner) return deck

  try {
    const { decks: ownerDecks } = await getPlayerDecks(owner, { force: false })
    const normalizeId = (val?: string | null) =>
      (val || '')
        .toString()
        .toLowerCase()
        .replace(/^deck[_-]?/i, '')
        .replace(/^deck[_-]?fused[_-]?/i, '')
        .replace(/^fused[_-]?/i, '')

    const targetId = normalizeId(deck.id)
    const matched = ownerDecks.find((d: any) => normalizeId(d.id) === targetId)
    if (!matched) return deck

    const pickExpire =
      matched.expireAt ??
      matched.expire ??
      matched.expire_date ??
      matched.expireDate ??
      matched.pExpiry ??
      deck.expireAt ??
      deck.expire ??
      deck.expire_date ??
      deck.expireDate ??
      deck.pExpiry ??
      undefined

    const merged = {
      ...deck,
      ...matched,
      cards: Array.isArray(matched.cards) && matched.cards.length > 0 ? matched.cards : deck.cards,
      tags: matched.tags ?? deck.tags,
      expireAt: pickExpire,
    }
    return merged
  } catch (err) {
    console.warn('[API] /api/deck enrich from player decks failed:', err)
    return deck
  }
}

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
    const stripDeckPrefixes = (value: string) =>
      value
        .toString()
        .replace(/^deck[_-]?fused[_-]?/i, '')
        .replace(/^deck[_-]?/i, '')
        .replace(/^fused[_-]?/i, '')

    const toFusedApiId = (value: string) => {
      const raw = value.toString().trim()
      if (!raw) return raw
      if (/^fused[_-]/i.test(raw)) {
        return raw.replace(/^fused[-_]/i, 'Fused_')
      }
      if (/^deck[_-]?fused[_-]?/i.test(raw)) {
        const stripped = raw.replace(/^deck[_-]?/i, '')
        return stripped.replace(/^fused[-_]/i, 'Fused_')
      }
      const base = stripDeckPrefixes(raw)
      return `Fused_${base}`
    }

    const baseId = stripDeckPrefixes(deckId)
    const candidates = Array.from(
      new Set(
        [
          deckId,
          baseId,
          `Deck_${baseId}`,
          `Deck-${baseId}`,
          `Deck_Fused_${baseId}`,
          `Deck-Fused-${baseId}`,
          `Fused_${baseId}`,
          `Fused-${baseId}`,
        ].filter(Boolean)
      )
    )

    // 1) Try Supabase (player_decks) for each candidate
    if (supabase) {
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
              const raw = await fetchDeckDetails(stripDeckPrefixes(candidate))
              if (raw) {
                const normalized = normalizeDeck(raw)
                const owner =
                  supabaseDeck.playerName ||
                  raw.playerName ||
                  raw.player_name ||
                  raw.username ||
                  raw.userName ||
                  raw.owner ||
                  raw?.myUser?.username ||
                  raw?.users?.[0]?.username ||
                  raw?.users?.[0]?.user?.username ||
                  raw?.Users?.[0]?.UserName ||
                  undefined
                const username = raw?.myUser?.username || raw?.username || raw?.userName || owner

                const hydratedDeck = {
                  ...supabaseDeck,
                  ...normalized,
                  playerName: owner || supabaseDeck.playerName,
                  username: username || supabaseDeck.playerName,
                  is_for_sale: supabaseDeck.is_for_sale,
                  is_nft: supabaseDeck.is_nft,
                  price: supabaseDeck.price,
                }

                const enriched = await mergeFromPlayerDecks(hydratedDeck)
                return NextResponse.json({ deck: enriched })
              }
            } catch (err) {
              console.warn('[API] Hydration from external API failed, using Supabase deck:', err)
            }
          }

          return NextResponse.json({ deck: supabaseDeck })
        }
      }
    }

    // 2) Try as regular deck for each candidate via external API
    for (const candidate of candidates) {
      const raw = await fetchDeckDetails(stripDeckPrefixes(candidate))
      if (raw) {
        const rawId = raw?.id || raw?.deckId || raw?.deck_id
        if (!rawId) {
          continue
        }
        try {
          const deck = normalizeDeck(raw)
          const owner =
            raw.playerName ||
            raw.player_name ||
            raw.username ||
            raw.userName ||
            raw.owner ||
            raw?.myUser?.username ||
            raw?.users?.[0]?.username ||
            raw?.users?.[0]?.user?.username ||
            raw?.Users?.[0]?.UserName ||
            undefined
          const username = raw?.myUser?.username || raw?.username || raw?.userName || owner
          if (owner && !(deck as any).playerName) {
            ;(deck as any).playerName = owner
          }
          if (username && !(deck as any).username) {
            ;(deck as any).username = username
          }
          const enriched = await mergeFromPlayerDecks(deck)
          return NextResponse.json({ deck: enriched })
        } catch (e) {
          console.warn('[API] normalizeDeck failed, will try fused fallback:', e)
        }
      }
    }

    // 3) Fallback for fused decks
    const API_BASE_URL = 'https://ul51g2rg42.execute-api.us-east-1.amazonaws.com/main'
    for (const candidate of candidates) {
      const fusedCandidate = toFusedApiId(candidate)
      const fusedRes = await fetch(`${API_BASE_URL}/fuseddeck/${fusedCandidate}?inclCards=true&inclUsers=true`, {
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
        fusedRaw?.myUser?.username ||
        fusedRaw?.users?.[0]?.username ||
        fusedRaw?.users?.[0]?.user?.username ||
        fusedRaw?.Users?.[0]?.UserName ||
        undefined
      const username = fusedRaw?.myUser?.username || fusedRaw?.username || fusedRaw?.userName || owner

      const normalizeId = (val?: string | null) =>
        (val || '')
          .toString()
          .toLowerCase()
          .replace(/^deck[_-]?/i, '')
          .replace(/^deck[_-]?fused[_-]?/i, '')
          .replace(/^fused[_-]?/i, '')

      // Fused deck meta (rank) from listing API
      let deckRankFromListing: string | null | undefined = fusedRaw.deckRank || fusedRaw.rank || null
      const metaSourceMap = new Map<string, any>()
      const usernameForMeta = username || owner
      if (usernameForMeta) {
        try {
          const metaRes = await fetch(
            `${API_BASE_URL}/fuseddeck/app?pageSize=200&username=${encodeURIComponent(usernameForMeta)}`,
            {
              method: 'GET',
              headers: { Accept: 'application/json' },
              signal: AbortSignal.timeout(15000),
            }
          )
          if (metaRes.ok) {
            const metaJson = await metaRes.json()
            const items = Array.isArray(metaJson?.Items) ? metaJson.Items : []
            const targetNorm = normalizeId(candidate)
            const matched = items.find((item: any) => normalizeId(item?.id) === targetNorm)
            if (matched) {
              deckRankFromListing = deckRankFromListing ?? matched.deckRank ?? matched.rank ?? null
              if (Array.isArray(matched.myDecks)) {
                matched.myDecks.forEach((md: any) => {
                  const key = normalizeId(md?.id || md?.deckId || md?.deck_id)
                  if (!key) return
                  metaSourceMap.set(key, md)
                })
              }
            }
          }
        } catch (err) {
          console.warn('[API] Failed to fetch fused deck meta listing:', err)
        }
      }

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

      const resolveCardSetNo = (setNo: unknown, setId: unknown) => {
        if (setNo !== undefined && setNo !== null && String(setNo).trim() !== '') return setNo
        if (setId === undefined || setId === null) return setId
        const setIdStr = String(setId).trim()
        if (!setIdStr) return setId
        if (setIdStr.toLowerCase() === 'd0') return 99
        return setId
      }

      // Normalize source decks (keep whatever data we already have)
      const myDecksNormalized = sourceDecks.map((d) => ({
        ...d,
        cards: extractCards(d),
      }))

      // Try to hydrate source halves with full data (to get deckRank/elo/score/set info)
      const hydratedSources = await Promise.all(
        myDecksNormalized.map(async (src) => {
          const srcId = (src as any)?.id || (src as any)?.deckId || (src as any)?.deck_id
          if (!srcId) return src

          // Skip fetch if we already have meta fields
          const hasMeta =
            (src as any)?.deckRank ||
            (src as any)?.deckScore !== undefined ||
            (src as any)?.elo !== undefined
          if (hasMeta) return src

          try {
            const full = await fetchDeckDetails(srcId)
            if (!full) return src
            const normalized = normalizeDeck(full)
            const resolvedCardSetNo = resolveCardSetNo(
              (src as any)?.cardSetNo ?? (normalized as any)?.cardSetNo,
              (src as any)?.cardSetId ?? (normalized as any)?.cardSetId
            )
            return {
              ...src,
              ...normalized,
              cards: Array.isArray(src.cards) && src.cards.length > 0 ? src.cards : normalized.cards,
              cardSetNo: resolvedCardSetNo,
              cardSetId: (src as any)?.cardSetId ?? (normalized as any)?.cardSetId ?? (normalized as any)?.cardSetNo,
              forgeborn: (src as any)?.forgeborn || (normalized as any)?.forgeborn,
              forgebornId: (src as any)?.forgebornId || (normalized as any)?.forgebornId,
            }
          } catch (err) {
            console.warn('[API] Failed to hydrate fused source deck', srcId, err)
            return src
          }
        })
      )

      const sourcesWithMeta = hydratedSources.map((src) => {
        if (!src) return src
        const key = normalizeId((src as any)?.id || (src as any)?.deckId || (src as any)?.deck_id)
        const meta = key ? metaSourceMap.get(key) : undefined
        if (!meta) return src
        return {
          ...src,
          deckRank: (src as any)?.deckRank ?? meta.deckRank ?? meta.rank ?? null,
          faction: (src as any)?.faction ?? meta.faction ?? null,
        }
      })

      // Try to hydrate meta (deckRank/score/elo/set) from Supabase if present
      let deckRankFromDb: string | null | undefined = fusedRaw.deckRank || fusedRaw.rank || null
      let deckScoreFromDb: number | null | undefined = fusedRaw.deckScore ?? null
      let eloFromDb: number | null | undefined = fusedRaw.elo ?? null
      let cardSetNoFromDb: string | null | undefined = fusedRaw.cardSetNo ?? null
      let cardSetIdFromDb: string | null | undefined = fusedRaw.cardSetId ?? null

      try {
        const altIds = Array.from(
          new Set(
            [
              candidate,
              candidate.toLowerCase(),
              candidate.replace(/^Fused[_-]?/i, ''),
              candidate.replace(/^Fused[_-]?/i, '').toLowerCase(),
            ].filter(Boolean)
          )
        )

        const { data: metaRows, error: metaError } = await supabase
          .from('player_decks')
          .select('deck_rank, deck_score, elo, card_set_no, card_set_id')
          .in('deck_id', altIds)
          .limit(1)

        if (!metaError && metaRows && metaRows.length > 0) {
          const meta = metaRows[0]
          deckRankFromDb = deckRankFromDb ?? meta.deck_rank ?? null
          deckScoreFromDb = deckScoreFromDb ?? (meta.deck_score as any as number | null) ?? null
          eloFromDb = eloFromDb ?? (meta.elo as any as number | null) ?? null
          cardSetNoFromDb = cardSetNoFromDb ?? (meta.card_set_no as any as string | null) ?? null
          cardSetIdFromDb = cardSetIdFromDb ?? (meta.card_set_id as any as string | null) ?? null
        }
      } catch (err) {
        console.warn('[API] Failed to load fused deck meta from Supabase:', err)
      }

      const deckRankResolved: string | null | undefined = deckRankFromDb ?? deckRankFromListing ?? null

      const fusedDeck = {
        id: fusedRaw.id || candidate,
        name: fusedRaw.name || 'Fused Deck',
        format: 'Fused',
        cards,
        myDecks: sourcesWithMeta,
        fusedDeckIds: sourceDecks.map((d: any) => d?.id || d?.deckId || d?.deck_id).filter(Boolean),
        created: fusedRaw.created || fusedRaw.CreatedAt || fusedRaw.createdAt || null,
        updatedAt: fusedRaw.updated || fusedRaw.UpdatedAt || fusedRaw.updatedAt || null,
        forgeborn: fusedRaw.forgeborn || null,
        forgebornId: fusedRaw.forgeborn?.id || fusedRaw.forgebornId || null,
        deckRank: deckRankResolved ?? null,
        cardSetNo: cardSetNoFromDb ?? null,
        cardSetId: cardSetIdFromDb ?? null,
        faction: fusedRaw.faction || null,
        tags: fusedRaw.tags || null,
        deckScore: deckScoreFromDb ?? null,
        elo: eloFromDb ?? null,
        digital: fusedRaw.digital ?? null,
        playerName: owner,
        username: username,
      }

      let enrichedFused = fusedDeck
      try {
        enrichedFused = await mergeFromPlayerDecks(fusedDeck)
      } catch (err) {
        console.warn('[API] Failed to enrich fused deck from player decks:', err)
      }

      return NextResponse.json({ deck: enrichedFused })
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
