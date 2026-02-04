import { NextRequest, NextResponse } from 'next/server'
import { fetchDeckDetails, normalizeDeck, getPlayerDecks } from '@/lib/api'

const DECK_RESPONSE_CACHE_TTL_MS = 24 * 60 * 60 * 1000
type DeckResponseCacheEntry = { expiresAt: number; data: { deck: any } }
const deckResponseCache = new Map<string, DeckResponseCacheEntry>()

const getDeckResponseCached = (key: string) => {
  const entry = deckResponseCache.get(key)
  if (!entry) return null
  if (entry.expiresAt < Date.now()) {
    deckResponseCache.delete(key)
    return null
  }
  return entry.data
}

const setDeckResponseCached = (key: string, data: { deck: any }) => {
  deckResponseCache.set(key, { expiresAt: Date.now() + DECK_RESPONSE_CACHE_TTL_MS, data })
}

const stripDeckPrefixes = (value: string) =>
  value
    .toString()
    .replace(/^deck[_-]?fused[_-]?/i, '')
    .replace(/^deck[_-]?/i, '')
    .replace(/^fused[_-]?/i, '')

const normalizeDeckCacheBase = (value: string) => {
  const raw = value.toString().trim().toLowerCase()
  return stripDeckPrefixes(raw) || raw
}

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

    const deckCards = Array.isArray(deck?.cards) ? deck.cards : []
    const matchedCards = Array.isArray(matched?.cards) ? matched.cards : []
    const useMatchedCards = deckCards.length === 0 && matchedCards.length > 0

    const merged = {
      ...deck,
      ...matched,
      cards: useMatchedCards ? matchedCards : deck.cards,
      tags: matched.tags ?? deck.tags,
      expireAt: pickExpire,
    }
    return merged
  } catch (err) {
    console.warn('[API] /api/deck enrich from player decks failed:', err)
    return deck
  }
}

export async function GET(
  request: NextRequest,
  context: { params: Promise<{ id?: string }> }
) {
  const { id } = await context.params
  const deckId = id
  const fast = request.nextUrl.searchParams.get('fast') === '1'
  const skipOwnerMerge = request.nextUrl.searchParams.get('skipOwnerMerge') === '1' || fast

  if (!deckId) {
    return NextResponse.json({ error: 'Deck id is required' }, { status: 400 })
  }

  const cacheBase = normalizeDeckCacheBase(deckId)
  const cacheSuffix = `fast:${fast ? 1 : 0}|skip:${skipOwnerMerge ? 1 : 0}`
  const regularCacheKey = `regular:${cacheBase}|${cacheSuffix}`
  const fusedCacheKey = `fused:${cacheBase}|${cacheSuffix}`
  const isFusedHint = /^fused[_-]?/i.test(deckId) || /^deck[_-]?fused[_-]?/i.test(deckId)
  const cached =
    getDeckResponseCached(isFusedHint ? fusedCacheKey : regularCacheKey) ??
    getDeckResponseCached(isFusedHint ? regularCacheKey : fusedCacheKey)
  if (cached) {
    return NextResponse.json(cached)
  }

  try {
    // Support multiple id formats: Deck_..., Deck_Fused_..., Fused_...
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
    const regularCandidates = fast
      ? Array.from(new Set([baseId, deckId].filter(Boolean)))
      : candidates
    const fusedCandidates = fast
      ? Array.from(new Set([toFusedApiId(deckId), `Fused_${baseId}`].filter(Boolean)))
      : candidates.map((candidate) => toFusedApiId(candidate))

    // 1) Try as regular deck for each candidate via external API
    for (const candidate of regularCandidates) {
      const raw = await fetchDeckDetails(
        stripDeckPrefixes(candidate),
        fast ? { timeoutMs: 4000, revalidateSeconds: 300 } : undefined
      )
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
          const enriched = skipOwnerMerge ? deck : await mergeFromPlayerDecks(deck)
          const responseData = { deck: enriched }
          setDeckResponseCached(regularCacheKey, responseData)
          return NextResponse.json(responseData)
        } catch (e) {
          console.warn('[API] normalizeDeck failed, will try fused fallback:', e)
        }
      }
    }

    // 2) Fallback for fused decks
    const API_BASE_URL = 'https://ul51g2rg42.execute-api.us-east-1.amazonaws.com/main'
    for (const fusedCandidate of fusedCandidates) {
      const fusedRes = await fetch(`${API_BASE_URL}/fuseddeck/${fusedCandidate}?inclCards=true&inclUsers=true`, {
        method: 'GET',
        headers: { Accept: 'application/json' },
        signal: AbortSignal.timeout(fast ? 5000 : 15000),
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
      if (!fast && usernameForMeta) {
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
            const targetNorm = normalizeId(fusedCandidate)
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
      const sourcesWithMeta = fast
        ? myDecksNormalized
        : (
            await Promise.all(
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
          ).map((src) => {
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

      const resolveFusedForgeborn = (sources: any[]) => {
        for (const src of sources) {
          if (!src) continue
          const forgeborn = (src as any)?.forgeborn || null
          const forgebornId = (src as any)?.forgebornId || (forgeborn && (forgeborn as any)?.id) || null
          if (forgeborn || forgebornId) {
            return { forgeborn, forgebornId }
          }
        }
        return { forgeborn: null, forgebornId: null }
      }

      const sourceForgeborn = resolveFusedForgeborn(sourcesWithMeta)

      const deckRankResolved: string | null | undefined = deckRankFromListing ?? null

      const fusedDeck = {
        id: fusedRaw.id || fusedCandidate,
        name: fusedRaw.name || 'Fused Deck',
        format: 'Fused',
        cards,
        myDecks: sourcesWithMeta,
        fusedDeckIds: sourceDecks.map((d: any) => d?.id || d?.deckId || d?.deck_id).filter(Boolean),
        created: fusedRaw.created || fusedRaw.CreatedAt || fusedRaw.createdAt || null,
        updatedAt: fusedRaw.updated || fusedRaw.UpdatedAt || fusedRaw.updatedAt || null,
        forgeborn: fusedRaw.forgeborn || sourceForgeborn.forgeborn || null,
        forgebornId: fusedRaw.forgeborn?.id || fusedRaw.forgebornId || sourceForgeborn.forgebornId || null,
        deckRank: deckRankResolved ?? null,
        cardSetNo: fusedRaw.cardSetNo ?? null,
        cardSetId: fusedRaw.cardSetId ?? null,
        faction: fusedRaw.faction || null,
        tags: fusedRaw.tags || null,
        deckScore: fusedRaw.deckScore ?? null,
        elo: fusedRaw.elo ?? null,
        digital: fusedRaw.digital ?? null,
        playerName: owner,
        username: username,
      }

      let enrichedFused = fusedDeck
      if (!fast) {
        try {
          enrichedFused = await mergeFromPlayerDecks(fusedDeck)
        } catch (err) {
          console.warn('[API] Failed to enrich fused deck from player decks:', err)
        }
      }

      const responseData = { deck: enrichedFused }
      setDeckResponseCached(fusedCacheKey, responseData)
      return NextResponse.json(responseData)
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
