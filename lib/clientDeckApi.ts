type DeckFetchOptions = {
  fast?: boolean
  skipOwnerMerge?: boolean
  timeoutMs?: number
  ttlMs?: number
}

type DeckCacheEntry = {
  expiresAt: number
  deck: any
}

const DEFAULT_TIMEOUT_MS = 12_000
const DEFAULT_TTL_MS = 6_000
const deckInFlight = new Map<string, Promise<any | null>>()
const deckResolvedCache = new Map<string, DeckCacheEntry>()

const normalizeDeckId = (deckId: string) => deckId.toString().trim().toLowerCase()

const buildDeckCacheKey = (deckId: string, options: DeckFetchOptions) => {
  const normalized = normalizeDeckId(deckId)
  const fastFlag = options.fast ? '1' : '0'
  const skipOwnerMergeFlag = options.skipOwnerMerge ? '1' : '0'
  return `${normalized}|f=${fastFlag}|s=${skipOwnerMergeFlag}`
}

const buildDeckApiUrl = (deckId: string, options: DeckFetchOptions) => {
  const search = new URLSearchParams()
  if (options.fast) search.set('fast', '1')
  if (options.skipOwnerMerge) search.set('skipOwnerMerge', '1')
  const query = search.toString()
  return `/api/deck/${encodeURIComponent(deckId)}${query ? `?${query}` : ''}`
}

const readCachedDeck = (cacheKey: string) => {
  const cached = deckResolvedCache.get(cacheKey)
  if (!cached) return null
  if (cached.expiresAt <= Date.now()) {
    deckResolvedCache.delete(cacheKey)
    return null
  }
  return cached.deck
}

const writeCachedDeck = (cacheKey: string, deck: any, ttlMs: number) => {
  deckResolvedCache.set(cacheKey, {
    deck,
    expiresAt: Date.now() + Math.max(0, ttlMs),
  })
}

export async function tryFetchDeckFromApiCached(deckId: string, options: DeckFetchOptions = {}): Promise<any | null> {
  if (!deckId) return null

  const timeoutMs = Number(options.timeoutMs) > 0 ? Number(options.timeoutMs) : DEFAULT_TIMEOUT_MS
  const ttlMs = Number(options.ttlMs) >= 0 ? Number(options.ttlMs) : DEFAULT_TTL_MS
  const cacheKey = buildDeckCacheKey(deckId, options)
  const fromCache = readCachedDeck(cacheKey)
  if (fromCache) return fromCache

  const inFlight = deckInFlight.get(cacheKey)
  if (inFlight) return inFlight

  const requestPromise = (async () => {
    try {
      const response = await fetch(buildDeckApiUrl(deckId, options), {
        method: 'GET',
        headers: { Accept: 'application/json' },
        signal: AbortSignal.timeout(timeoutMs),
      })
      if (!response.ok) return null

      const payload = await response.json().catch(() => null)
      const deck = payload?.deck || null
      if (deck && ttlMs > 0) writeCachedDeck(cacheKey, deck, ttlMs)
      return deck
    } catch {
      return null
    } finally {
      deckInFlight.delete(cacheKey)
    }
  })()

  deckInFlight.set(cacheKey, requestPromise)
  return requestPromise
}

export async function fetchDeckFromApiCached(deckId: string, options: DeckFetchOptions = {}): Promise<any> {
  const deck = await tryFetchDeckFromApiCached(deckId, options)
  if (!deck) throw new Error('Failed to load deck')
  return deck
}
