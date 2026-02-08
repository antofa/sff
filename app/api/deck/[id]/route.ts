import { NextRequest, NextResponse } from 'next/server'
import { fetchDeckDetails, normalizeDeck } from '@/lib/api'
import { getDeckOwnerFromUpstashCache, putDeckOwnerToUpstashCache } from '@/lib/deckOwnerUpstashCache'
import { getDeckFallbackFromUpstashCache, putDeckFallbackToUpstashCache } from '@/lib/deckFallbackUpstashCache'
import { getFusedDeckFromSupabaseById, getRegularDeckFromSupabaseById } from '@/lib/supabaseDeckLookup'

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

const toNonEmptyString = (value: unknown): string | null => {
  if (value === null || value === undefined) return null
  const normalized = String(value).trim()
  return normalized ? normalized : null
}

const hasMeaningfulValue = (value: unknown): boolean => {
  if (value === null || value === undefined) return false
  if (typeof value === 'string') return value.trim().length > 0
  if (Array.isArray(value)) return value.length > 0
  if (typeof value === 'object') return Object.keys(value as Record<string, unknown>).length > 0
  return true
}

const hasPopulatedArray = (value: unknown): boolean => Array.isArray(value) && value.length > 0

const resolveDeckId = (deck: any): string | null =>
  toNonEmptyString(deck?.id ?? deck?.deckId ?? deck?.deck_id)

const resolveOwner = (deck: any): string | null =>
  toNonEmptyString(
    deck?.playerName ??
      deck?.player_name ??
      deck?.ownerName ??
      deck?.owner ??
      deck?.username ??
      deck?.userName ??
      deck?.myUser?.username ??
      deck?.users?.[0]?.username ??
      deck?.users?.[0]?.user?.username ??
      deck?.Users?.[0]?.UserName
  )

const resolveUsername = (deck: any): string | null =>
  toNonEmptyString(deck?.username ?? deck?.userName ?? deck?.myUser?.username)

const resolveExpireAt = (deck: any): string | null =>
  toNonEmptyString(
    deck?.expireAt ??
      deck?.expire ??
      deck?.expire_at ??
      deck?.expireDate ??
      deck?.expire_date ??
      deck?.pExpiry
  )

const applyOwnerFields = (deck: any, owner: string | null, usernameHint?: string | null) => {
  if (!owner && !usernameHint) return deck
  const next = { ...(deck || {}) }
  const username = usernameHint || resolveUsername(next) || owner

  if (owner && !hasMeaningfulValue(next.playerName)) {
    next.playerName = owner
  }
  if (owner && !hasMeaningfulValue(next.owner)) {
    next.owner = owner
  }
  if (username && !hasMeaningfulValue(next.username)) {
    next.username = username
  }

  return next
}

const mergeDeckMissingFields = (primary: any, fallback: any) => {
  if (!fallback || typeof fallback !== 'object') return primary
  const merged = { ...(primary || {}) }

  const fill = (field: string) => {
    if (!hasMeaningfulValue(merged[field]) && hasMeaningfulValue(fallback[field])) {
      merged[field] = fallback[field]
    }
  }

  ;[
    'id',
    'name',
    'format',
    'created',
    'updatedAt',
    'faction',
    'forgeborn',
    'forgebornId',
    'cardSetNo',
    'cardSetId',
    'deckRank',
    'deckScore',
    'elo',
    'digital',
    'expireAt',
  ].forEach(fill)

  if (!hasPopulatedArray(merged.cards) && hasPopulatedArray(fallback.cards)) {
    merged.cards = fallback.cards
  }
  if (!hasPopulatedArray(merged.myDecks) && hasPopulatedArray(fallback.myDecks)) {
    merged.myDecks = fallback.myDecks
  }
  if (!hasPopulatedArray(merged.fusedDeckIds) && hasPopulatedArray(fallback.fusedDeckIds)) {
    merged.fusedDeckIds = fallback.fusedDeckIds
  }
  if (!hasMeaningfulValue(merged.tags) && hasMeaningfulValue(fallback.tags)) {
    merged.tags = fallback.tags
  }
  if (!hasMeaningfulValue(merged.expireAt)) {
    const fallbackExpire = resolveExpireAt(fallback)
    if (fallbackExpire) {
      merged.expireAt = fallbackExpire
    }
  }

  const owner = resolveOwner(merged) || resolveOwner(fallback)
  const username = resolveUsername(merged) || resolveUsername(fallback) || owner
  return applyOwnerFields(merged, owner, username)
}

const needsRegularSupabaseFallback = (deck: any): boolean =>
  !resolveOwner(deck) ||
  !hasPopulatedArray(deck?.cards) ||
  !hasMeaningfulValue(resolveExpireAt(deck)) ||
  !hasMeaningfulValue(deck?.deckScore) ||
  !hasMeaningfulValue(deck?.elo) ||
  !hasMeaningfulValue(deck?.faction) ||
  (!hasMeaningfulValue(deck?.forgebornId) && !hasMeaningfulValue(deck?.forgeborn?.id)) ||
  (!hasMeaningfulValue(deck?.cardSetId) && !hasMeaningfulValue(deck?.cardSetNo))

const needsFusedSupabaseFallback = (deck: any): boolean =>
  !resolveOwner(deck) ||
  !hasPopulatedArray(deck?.cards) ||
  (!hasPopulatedArray(deck?.myDecks) && !hasPopulatedArray(deck?.fusedDeckIds))

const writeFallbackCachesBestEffort = (deck: any, deckIds: Array<string | null | undefined>) => {
  const normalizedIds = Array.from(
    new Set(deckIds.map((value) => toNonEmptyString(value)).filter((value): value is string => !!value))
  )
  if (normalizedIds.length === 0) return

  const deckId = resolveDeckId(deck) || normalizedIds[0]
  if (!deckId) return

  const owner = resolveOwner(deck)
  const payload = { ...(deck || {}), id: deckId }

  normalizedIds.forEach((cacheDeckId) => {
    if (owner) {
      void putDeckOwnerToUpstashCache(cacheDeckId, owner).catch(() => {
        // Best-effort cache write; ignore errors.
      })
    }
    void putDeckFallbackToUpstashCache(cacheDeckId, payload).catch(() => {
      // Best-effort cache write; ignore errors.
    })
  })
}

const enrichDeckFromFallbacks = async (
  deck: any,
  options: { requestedDeckId: string; isFused: boolean }
) => {
  const resolvedDeckId = resolveDeckId(deck) || options.requestedDeckId
  let enriched = deck

  const [upstashDeckPrimary, upstashDeckRequested, upstashOwnerPrimary, upstashOwnerRequested] = await Promise.all([
    getDeckFallbackFromUpstashCache(resolvedDeckId),
    resolvedDeckId === options.requestedDeckId
      ? Promise.resolve(null)
      : getDeckFallbackFromUpstashCache(options.requestedDeckId),
    getDeckOwnerFromUpstashCache(resolvedDeckId),
    resolvedDeckId === options.requestedDeckId
      ? Promise.resolve(null)
      : getDeckOwnerFromUpstashCache(options.requestedDeckId),
  ])

  const upstashDeck = upstashDeckPrimary || upstashDeckRequested
  const upstashOwner = upstashOwnerPrimary || upstashOwnerRequested
  if (upstashDeck || upstashOwner) {
    const upstashFallback = applyOwnerFields(upstashDeck || {}, upstashOwner, upstashOwner)
    enriched = mergeDeckMissingFields(enriched, upstashFallback)
  }

  const shouldCheckSupabase = options.isFused
    ? needsFusedSupabaseFallback(enriched)
    : needsRegularSupabaseFallback(enriched)

  if (shouldCheckSupabase) {
    const supabasePrimary = options.isFused
      ? await getFusedDeckFromSupabaseById(resolvedDeckId)
      : await getRegularDeckFromSupabaseById(resolvedDeckId)
    const supabaseRequested =
      supabasePrimary || resolvedDeckId === options.requestedDeckId
        ? null
        : options.isFused
          ? await getFusedDeckFromSupabaseById(options.requestedDeckId)
          : await getRegularDeckFromSupabaseById(options.requestedDeckId)

    const supabaseFallback = supabasePrimary || supabaseRequested
    if (supabaseFallback) {
      enriched = mergeDeckMissingFields(enriched, supabaseFallback)
    }
  }

  writeFallbackCachesBestEffort(enriched, [resolvedDeckId, options.requestedDeckId])
  return enriched
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
      if (!raw) continue

      const rawId = resolveDeckId(raw)
      if (!rawId) continue

      try {
        const normalizedDeck = normalizeDeck(raw)
        const owner = resolveOwner(raw) || resolveOwner(normalizedDeck)
        const username = resolveUsername(raw) || resolveUsername(normalizedDeck) || owner
        let deck = applyOwnerFields(normalizedDeck, owner, username)

        if (!skipOwnerMerge) {
          deck = await enrichDeckFromFallbacks(deck, { requestedDeckId: deckId, isFused: false })
        } else {
          writeFallbackCachesBestEffort(deck, [rawId, deckId])
        }

        const responseData = { deck }
        setDeckResponseCached(regularCacheKey, responseData)
        return NextResponse.json(responseData)
      } catch (error) {
        console.warn('[API] normalizeDeck failed, will try fused fallback:', error)
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
      const owner = resolveOwner(fusedRaw)
      const username = resolveUsername(fusedRaw) || owner

      // Try to build full cards list from source decks if fused cards are empty
      const sourceDecks: any[] =
        (Array.isArray(fusedRaw.myDecks) && fusedRaw.myDecks) ||
        (Array.isArray(fusedRaw.decks) && fusedRaw.decks) ||
        []

      const extractCards = (deckLike: any): any[] => {
        if (!deckLike) return []
        if (Array.isArray(deckLike.cardList) && deckLike.cardList.length > 0) return deckLike.cardList
        if (Array.isArray(deckLike.cards) && deckLike.cards.length > 0) return deckLike.cards
        if (Array.isArray(deckLike.cardIds) && deckLike.cardIds.length > 0) return deckLike.cardIds
        return []
      }

      const mergedCardsFromSources = sourceDecks.flatMap(extractCards).filter((card) => !!card)
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
      const myDecksNormalized = sourceDecks.map((deckLike) => ({
        ...deckLike,
        cards: extractCards(deckLike),
      }))

      // Hydrate source halves by direct ID lookups only (no owner-wide listing search).
      const sourcesWithMeta = fast
        ? myDecksNormalized
        : await Promise.all(
            myDecksNormalized.map(async (src) => {
              const srcId = resolveDeckId(src)
              if (!srcId) return src

              let hydratedSource = src
              const hasMeta =
                (src as any)?.deckRank ||
                (src as any)?.deckScore !== undefined ||
                (src as any)?.elo !== undefined
              const hasExpire = hasMeaningfulValue(resolveExpireAt(src))
              if (!hasMeta || !hasExpire) {
                try {
                  const full = await fetchDeckDetails(srcId)
                  if (full) {
                    const normalized = normalizeDeck(full)
                    const resolvedCardSetNo = resolveCardSetNo(
                      (src as any)?.cardSetNo ?? (normalized as any)?.cardSetNo,
                      (src as any)?.cardSetId ?? (normalized as any)?.cardSetId
                    )
                    hydratedSource = {
                      ...src,
                      ...normalized,
                      cards: Array.isArray(src.cards) && src.cards.length > 0 ? src.cards : normalized.cards,
                      cardSetNo: resolvedCardSetNo,
                      cardSetId: (src as any)?.cardSetId ?? (normalized as any)?.cardSetId ?? (normalized as any)?.cardSetNo,
                      forgeborn: (src as any)?.forgeborn || (normalized as any)?.forgeborn,
                      forgebornId: (src as any)?.forgebornId || (normalized as any)?.forgebornId,
                    }
                  }
                } catch (error) {
                  console.warn('[API] Failed to hydrate fused source deck', srcId, error)
                }
              }

              try {
                hydratedSource = await enrichDeckFromFallbacks(hydratedSource, {
                  requestedDeckId: srcId,
                  isFused: false,
                })
              } catch (error) {
                console.warn('[API] Failed to enrich fused source deck from fallback chain', srcId, error)
              }

              return hydratedSource
            })
          )

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
      const deckRankResolved = fusedRaw.deckRank ?? fusedRaw.rank ?? null

      const fusedDeckId = resolveDeckId(fusedRaw) || fusedCandidate
      let fusedDeck = {
        id: fusedDeckId,
        name: fusedRaw.name || 'Fused Deck',
        format: 'Fused',
        cards,
        myDecks: sourcesWithMeta,
        fusedDeckIds: sourceDecks.map((deckLike: any) => resolveDeckId(deckLike)).filter(Boolean),
        created: fusedRaw.created || fusedRaw.CreatedAt || fusedRaw.createdAt || null,
        updatedAt: fusedRaw.updated || fusedRaw.UpdatedAt || fusedRaw.updatedAt || null,
        forgeborn: fusedRaw.forgeborn || sourceForgeborn.forgeborn || null,
        forgebornId: fusedRaw.forgeborn?.id || fusedRaw.forgebornId || sourceForgeborn.forgebornId || null,
        deckRank: deckRankResolved,
        cardSetNo: fusedRaw.cardSetNo ?? null,
        cardSetId: fusedRaw.cardSetId ?? null,
        faction: fusedRaw.faction || null,
        tags: fusedRaw.tags || null,
        deckScore: fusedRaw.deckScore ?? null,
        elo: fusedRaw.elo ?? null,
        digital: fusedRaw.digital ?? null,
      }

      fusedDeck = applyOwnerFields(fusedDeck, owner, username)

      if (!skipOwnerMerge) {
        fusedDeck = await enrichDeckFromFallbacks(fusedDeck, { requestedDeckId: deckId, isFused: true })
      } else {
        writeFallbackCachesBestEffort(fusedDeck, [fusedDeckId, deckId])
      }

      const responseData = { deck: fusedDeck }
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
