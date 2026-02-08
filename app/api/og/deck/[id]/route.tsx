import { ImageResponse } from 'next/og'
import { readFile } from 'node:fs/promises'
import path from 'node:path'
import type { NextRequest } from 'next/server'
import type { ReactNode } from 'react'
import { getOgImageFromUpstashCache, isOgUpstashCacheConfigured, putOgImageToUpstashCache } from '@/lib/ogUpstashCache'
import { OG_IMAGE_VERSION } from '@/lib/ogVersion'

export const runtime = 'nodejs'

const API_BASE_URL = 'https://ul51g2rg42.execute-api.us-east-1.amazonaws.com/main'
const OG_DECK_TIMEOUT_MS = 3200
const OG_INTERNAL_DECK_TIMEOUT_MS = 1800
const OG_ICON_TIMEOUT_MS = 500
const OG_UPSTASH_IMAGE_TTL_SECONDS = 24 * 60 * 60
const OG_PAYLOAD_TTL_MS = 24 * 60 * 60 * 1000
const OG_IMAGE_CACHE_TTL_MS = 24 * 60 * 60 * 1000
const OG_ICON_CACHE_TTL_MS = 24 * 60 * 60 * 1000
const OG_PAYLOAD_CACHE_MAX_ENTRIES = 500
const OG_IMAGE_CACHE_MAX_ENTRIES = 500
const OG_ICON_CACHE_MAX_ENTRIES = 500

type OgPayload = {
  cardColumns: CardColumn[]
  forgebornName: string | null
  forgebornFaction: string | null
  secondaryForgebornName: string | null
  secondaryForgebornFaction: string | null
  deckName: string | null
  forgebornAbilities: AbilityEntry[]
  secondaryForgebornAbilities: AbilityEntry[]
}

type OgPayloadCacheEntry = {
  expiresAt: number
  payload: OgPayload
}

type OgImageCacheEntry = {
  expiresAt: number
  bytes: Uint8Array
}

type IconSrcCacheEntry = {
  expiresAt: number
  src: string | null
}

type OgTimingEntry = {
  stage: string
  durationMs: number
}

const ogPayloadCache = new Map<string, OgPayloadCacheEntry>()
const ogPayloadInFlight = new Map<string, Promise<OgPayload>>()
const ogImageCache = new Map<string, OgImageCacheEntry>()
const iconSrcCache = new Map<string, IconSrcCacheEntry>()
const iconSrcInFlight = new Map<string, Promise<string | null>>()
const localAssetDataCache = new Map<string, string>()

const nowPerfMs = () => (typeof performance !== 'undefined' && typeof performance.now === 'function' ? performance.now() : Date.now())
const roundTimingMs = (value: number) => Math.round(value * 100) / 100
const toServerTimingStage = (value: string) => value.replace(/[^a-zA-Z0-9_-]/g, '_')
const buildServerTimingHeader = (timings: OgTimingEntry[], totalMs: number) =>
  [...timings, { stage: 'total', durationMs: totalMs }]
    .map((entry) => `${toServerTimingStage(entry.stage)};dur=${roundTimingMs(entry.durationMs)}`)
    .join(', ')

const toTitleCase = (value: string) =>
  value
    .split(' ')
    .map((part) => (part ? part.charAt(0).toUpperCase() + part.slice(1) : part))
    .join(' ')

const isForgebornCard = (card: any, forgebornId?: string | null) => {
  const id = typeof card === 'string' ? card : card?.id
  if (id && forgebornId && String(id).toLowerCase() === String(forgebornId).toLowerCase()) {
    return true
  }
  const typeValue = typeof card === 'string' ? '' : card?.type || card?.cardType || ''
  const rarityValue = typeof card === 'string' ? '' : card?.rarity || ''
  const typeLower = String(typeValue).toLowerCase()
  const rarityLower = String(rarityValue).toLowerCase()
  return typeLower.includes('forgeborn') || rarityLower.includes('forgeborn')
}

const formatCardIdName = (cardId: string): string => {
  if (!cardId) return 'Unknown Card'
  if (/^[a-z0-9]{20,}$/i.test(cardId)) {
    return cardId
  }
  let name = cardId.replace(/^s\d+[a-z]*\d*[-_]?/i, '')
  if (!name || name.length < 2) {
    return cardId
  }
  name = name.replace(/[-_]/g, ' ').replace(/\s+/g, ' ').trim()
  return toTitleCase(name) || cardId
}

const getCardDisplayName = (card: any): string => {
  if (typeof card === 'string') return formatCardIdName(card)
  const name = card?.name || card?.Name || card?.cardName || card?.title || null
  if (name) return String(name).replace(/\s+/g, ' ').trim()
  const fallbackId = card?.id || card?.cardId || card?.card_id
  return fallbackId ? formatCardIdName(String(fallbackId)) : 'Unknown Card'
}

const getCardListEntry = (deck: any, card: any) => {
  const cardData = typeof card === 'object' && card ? card : null
  const cardId = cardData?.id || cardData?.cardId || cardData?.card_id || undefined
  const isBetrayer = cardData?.betrayer === true || cardData?.betrayer === 'true'
  const factionForIcon =
    (isBetrayer && cardData?.crossFaction ? cardData.crossFaction : cardData?.faction) || deck?.faction
  const factionLower = String(factionForIcon || '').toLowerCase().trim()
  const rarity = cardData?.rarity || null
  const isForgeborn =
    String(cardData?.type || cardData?.cardType || '')
      .toLowerCase()
      .includes('forgeborn') || String(cardData?.rarity || '').toLowerCase().includes('forgeborn')

  return {
    name: getCardDisplayName(card),
    factionIconPath: factionLower ? `/images/icons/${factionLower}.png` : null,
    rarityIconPath: !isForgeborn
      ? getRarityIconPath(deck?.cardSetNo, rarity, cardId ? String(cardId) : undefined, cardData)
      : null,
    factionColor: getFactionBadgeColor(
      typeof factionForIcon === 'string' ? factionForIcon : typeof deck?.faction === 'string' ? deck.faction : undefined
    ),
    factionTextColor: getFactionTextColor(
      typeof factionForIcon === 'string' ? factionForIcon : typeof deck?.faction === 'string' ? deck.faction : undefined
    ),
  }
}

const buildCardSections = (deck: any) => {
  const cards = Array.isArray(deck?.cards) ? deck.cards : []
  const forgebornId = deck?.forgeborn?.id || deck?.forgebornId
  const creatures: CardListEntry[] = []
  const spells: CardListEntry[] = []
  const solbind: CardListEntry[] = []
  const other: CardListEntry[] = []

  cards.forEach((card: any) => {
    if (isForgebornCard(card, forgebornId)) return
    const entry = getCardListEntry(deck, card)
    const typeValue = typeof card === 'string' ? '' : card?.type || card?.cardType || ''
    const rarityValue = typeof card === 'string' ? '' : card?.rarity || ''
    const typeLower = String(typeValue).toLowerCase()
    const rarityLower = String(rarityValue).toLowerCase()
    if (typeLower.includes('creature')) {
      creatures.push(entry)
      return
    }
    if (typeLower.includes('spell')) {
      spells.push(entry)
      return
    }
    if (typeLower.includes('solbind') || rarityLower.includes('solbind')) {
      solbind.push(entry)
      return
    }
    other.push(entry)
  })

  const sections: CardSection[] = []
  const hasTyped = creatures.length > 0 || spells.length > 0 || solbind.length > 0
  if (hasTyped) {
    if (creatures.length > 0) sections.push({ label: `Creatures (${creatures.length})`, items: creatures })
    if (spells.length > 0) sections.push({ label: `Spells (${spells.length})`, items: spells })
    if (solbind.length > 0) sections.push({ label: `Solbind (${solbind.length})`, items: solbind })
  } else if (other.length > 0) {
    sections.push({ label: `Cards (${other.length})`, items: other })
  }
  return sections
}

async function withTimeout<T>(promise: Promise<T>, timeoutMs: number, fallback: T): Promise<T> {
  let timeoutId: ReturnType<typeof setTimeout> | undefined
  const timeoutPromise = new Promise<T>((resolve) => {
    timeoutId = setTimeout(() => resolve(fallback), timeoutMs)
  })
  try {
    return await Promise.race([promise, timeoutPromise])
  } finally {
    if (timeoutId) clearTimeout(timeoutId)
  }
}

const fetchWithTimeout = async (url: string, init: RequestInit, timeoutMs: number) => {
  const controller = new AbortController()
  const abortLater = setTimeout(() => {
    try {
      controller.abort()
    } catch {
      // ignore
    }
  }, timeoutMs)
  try {
    const response = await withTimeout(
      fetch(url, { ...init, signal: controller.signal }).catch(() => null),
      timeoutMs,
      null
    )
    return response
  } catch {
    return null
  } finally {
    clearTimeout(abortLater)
  }
}

const toBase64 = (buffer: ArrayBuffer) => {
  const bytes = new Uint8Array(buffer)
  let binary = ''
  const chunkSize = 0x8000
  for (let i = 0; i < bytes.length; i += chunkSize) {
    binary += String.fromCharCode(...bytes.subarray(i, i + chunkSize))
  }
  return btoa(binary)
}

const getMimeTypeByPath = (assetPath: string) => {
  const lower = assetPath.toLowerCase()
  if (lower.endsWith('.png')) return 'image/png'
  if (lower.endsWith('.svg')) return 'image/svg+xml'
  if (lower.endsWith('.jpg') || lower.endsWith('.jpeg')) return 'image/jpeg'
  if (lower.endsWith('.webp')) return 'image/webp'
  if (lower.endsWith('.gif')) return 'image/gif'
  return 'application/octet-stream'
}

const getLocalAssetDataUrl = async (assetPath: string): Promise<string | null> => {
  const normalized = assetPath.replace(/^\/+/, '')
  if (!normalized || normalized.includes('..')) return null

  const cached = localAssetDataCache.get(normalized)
  if (cached) return cached

  try {
    const fullPath = path.join(process.cwd(), 'public', normalized)
    const data = await readFile(fullPath)
    const mimeType = getMimeTypeByPath(normalized)
    const encoded = data.toString('base64')
    const dataUrl = `data:${mimeType};base64,${encoded}`
    localAssetDataCache.set(normalized, dataUrl)
    return dataUrl
  } catch {
    return null
  }
}

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

const buildDeckIdCandidates = (rawId: string) => {
  const baseId = stripDeckPrefixes(rawId)
  return Array.from(
    new Set(
      [
        rawId,
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
}

const normalizeOgPayloadKey = (deckId: string) => stripDeckPrefixes(deckId).trim().toLowerCase()
const normalizeOgImageKey = (deckId: string) => `${normalizeOgPayloadKey(deckId)}|${OG_IMAGE_VERSION}`

const hasDeckCards = (deckLike: any): boolean => {
  if (!deckLike || typeof deckLike !== 'object') return false
  if (Array.isArray(deckLike?.cards) && deckLike.cards.length > 0) return true
  if (Array.isArray(deckLike?.cardList) && deckLike.cardList.length > 0) return true
  if (Array.isArray(deckLike?.cardIds) && deckLike.cardIds.length > 0) return true
  return false
}

const hasDeckForgebornData = (deckLike: any): boolean => {
  if (!deckLike || typeof deckLike !== 'object') return false
  if (deckLike?.forgeborn) return true
  if (deckLike?.forgebornId) return true
  return false
}

const hasSourceDeckCards = (deckLike: any): boolean => {
  const sourceDecks =
    (Array.isArray(deckLike?.myDecks) && deckLike.myDecks) ||
    (Array.isArray(deckLike?.decks) && deckLike.decks) ||
    []
  return sourceDecks.some((source: any) => hasDeckCards(source))
}

const hasAnyDeckCards = (deckLike: any): boolean => hasDeckCards(deckLike) || hasSourceDeckCards(deckLike)

const isUsableDeckPayload = (deckLike: any): boolean =>
  hasAnyDeckCards(deckLike) || hasDeckForgebornData(deckLike)

function trimLru<T>(cache: Map<string, T>, maxEntries: number) {
  while (cache.size > maxEntries) {
    const oldestKey = cache.keys().next().value
    if (oldestKey === undefined) break
    cache.delete(oldestKey)
  }
}

function touchEntry<T>(cache: Map<string, T>, key: string, entry: T) {
  cache.delete(key)
  cache.set(key, entry)
}

const isFullOgPayload = (payload: OgPayload) => {
  const hasCards = payload.cardColumns.some((column) =>
    column.sections.some((section) => section.items.length > 0)
  )
  const hasForgebornName = !!payload.forgebornName?.trim()
  const hasAbilities = payload.forgebornAbilities.some((ability) => !!ability?.text?.trim())
  return hasCards && hasForgebornName && hasAbilities
}

const getCachedOgPayload = (key: string): OgPayload | null => {
  const cached = ogPayloadCache.get(key)
  if (!cached) return null
  if (cached.expiresAt < Date.now()) {
    ogPayloadCache.delete(key)
    return null
  }
  touchEntry(ogPayloadCache, key, cached)
  return cached.payload
}

const setCachedOgPayload = (key: string, payload: OgPayload) => {
  if (!isFullOgPayload(payload)) return
  touchEntry(ogPayloadCache, key, { expiresAt: Date.now() + OG_PAYLOAD_TTL_MS, payload })
  trimLru(ogPayloadCache, OG_PAYLOAD_CACHE_MAX_ENTRIES)
}

const copyBytes = (bytes: Uint8Array) => {
  const copy = new Uint8Array(bytes.byteLength)
  copy.set(bytes)
  return copy
}

const toArrayBuffer = (bytes: Uint8Array) => {
  const buffer = new ArrayBuffer(bytes.byteLength)
  new Uint8Array(buffer).set(bytes)
  return buffer
}

const getCachedOgImage = (key: string): Uint8Array | null => {
  const cached = ogImageCache.get(key)
  if (!cached) return null
  if (cached.expiresAt < Date.now()) {
    ogImageCache.delete(key)
    return null
  }
  touchEntry(ogImageCache, key, cached)
  return copyBytes(cached.bytes)
}

const setCachedOgImage = (key: string, bytes: Uint8Array) => {
  if (!bytes || bytes.length === 0) return
  touchEntry(ogImageCache, key, {
    expiresAt: Date.now() + OG_IMAGE_CACHE_TTL_MS,
    bytes: copyBytes(bytes),
  })
  trimLru(ogImageCache, OG_IMAGE_CACHE_MAX_ENTRIES)
}

const extractDeckCards = (deckLike: any): any[] => {
  if (!deckLike || typeof deckLike !== 'object') return []
  if (Array.isArray(deckLike?.cards) && deckLike.cards.length > 0) return deckLike.cards
  if (Array.isArray(deckLike?.cardList) && deckLike.cardList.length > 0) return deckLike.cardList
  if (Array.isArray(deckLike?.cardIds) && deckLike.cardIds.length > 0) return deckLike.cardIds
  return []
}

const normalizeDeckForOg = (deckLike: any) => {
  if (!deckLike || typeof deckLike !== 'object') return null
  const cards = extractDeckCards(deckLike)
  if (cards.length === 0) return null
  return {
    ...deckLike,
    cards,
    forgeborn: deckLike?.forgeborn || null,
    forgebornId: deckLike?.forgebornId || deckLike?.forgeborn?.id || null,
  }
}

const getDeckFromUpstream = async (
  deckId: string,
  options?: {
    origin?: string
    bypassFetchCache?: boolean
  }
) => {
  const origin = options?.origin
  const bypassFetchCache = options?.bypassFetchCache === true
  const deckIdValue = String(deckId || '').trim()
  const isLikelyFusedId =
    /^fused[_-]/i.test(deckIdValue) ||
    /^deck[_-]?fused[_-]?/i.test(deckIdValue) ||
    /^deckfused[_-]?/i.test(deckIdValue)
  const regularCandidates = isLikelyFusedId
    ? []
    : Array.from(new Set([stripDeckPrefixes(deckIdValue), deckIdValue].filter(Boolean)))
  const requestInit: RequestInit = bypassFetchCache
    ? {
        method: 'GET',
        headers: { Accept: 'application/json' },
        cache: 'no-store',
      }
    : {
        method: 'GET',
        headers: { Accept: 'application/json' },
        cache: 'force-cache',
        next: { revalidate: 300 },
      }

  const fetchFromInternalApi = async (fast: boolean) => {
    if (!origin) return null
    const params = new URLSearchParams()
    if (fast) params.set('fast', '1')
    params.set('skipOwnerMerge', '1')
    const localUrl = `${origin}/api/deck/${encodeURIComponent(deckIdValue)}?${params.toString()}`
    const response = await fetchWithTimeout(localUrl, requestInit, OG_INTERNAL_DECK_TIMEOUT_MS)
    if (!response?.ok) return null
    const raw = await withTimeout(response.json().catch(() => null), OG_INTERNAL_DECK_TIMEOUT_MS, null)
    const deck = raw?.deck
    const rawId = deck?.id || deck?.deckId || deck?.deck_id
    if (!deck || !rawId) return null
    if (!isUsableDeckPayload(deck)) return null
    return normalizeDeckForOg(deck)
  }

  const buildDeckFetchInit = (): RequestInit => requestInit

  for (const candidate of regularCandidates) {
    const url = `${API_BASE_URL}/deck/${encodeURIComponent(stripDeckPrefixes(candidate))}?inclCards=true&inclUsers=true`
    const response = await fetchWithTimeout(url, buildDeckFetchInit(), OG_DECK_TIMEOUT_MS)
    if (!response?.ok) continue
    const raw = await withTimeout(response.json().catch(() => null), OG_DECK_TIMEOUT_MS, null)
    if (!raw) continue
    const rawId = raw?.id || raw?.deckId || raw?.deck_id
    if (!rawId) continue
    if (!isUsableDeckPayload(raw)) continue
    const normalized = normalizeDeckForOg(raw)
    if (!normalized) continue
    return normalized
  }

  const fusedCandidates = isLikelyFusedId
    ? Array.from(new Set([toFusedApiId(deckIdValue), deckIdValue].filter(Boolean)))
    : []
  for (const fusedCandidate of fusedCandidates) {
    const url = `${API_BASE_URL}/fuseddeck/${encodeURIComponent(fusedCandidate)}?inclCards=true&inclUsers=true`
    const response = await fetchWithTimeout(url, buildDeckFetchInit(), OG_DECK_TIMEOUT_MS)
    if (!response?.ok) continue
    const raw = await withTimeout(response.json().catch(() => null), OG_DECK_TIMEOUT_MS, null)
    if (!raw) continue
    const rawId = raw?.id || raw?.deckId || raw?.deck_id
    if (!rawId) continue
    if (!isUsableDeckPayload(raw)) continue

    const sourceDecks =
      (Array.isArray(raw?.myDecks) && raw.myDecks) ||
      (Array.isArray(raw?.decks) && raw.decks) ||
      []
    const mergedCardsFromSources = sourceDecks.flatMap(extractDeckCards).filter(Boolean)
    const fusedCards = extractDeckCards(raw)
    const cards = mergedCardsFromSources.length > 0 ? mergedCardsFromSources : fusedCards
    if (cards.length === 0) continue

    let sourceForgeborn: any = null
    let sourceForgebornId: string | null = null
    for (const source of sourceDecks) {
      if (!source) continue
      const fb = source?.forgeborn || null
      const fbId = source?.forgebornId || fb?.id || null
      if (fb || fbId) {
        sourceForgeborn = fb
        sourceForgebornId = fbId
        break
      }
    }

    return {
      ...raw,
      myDecks: sourceDecks,
      cards,
      forgeborn: raw?.forgeborn || sourceForgeborn || null,
      forgebornId: raw?.forgebornId || raw?.forgeborn?.id || sourceForgebornId || null,
    }
  }

  const localFastDeck = await fetchFromInternalApi(true)
  if (localFastDeck) return localFastDeck

  if (isLikelyFusedId) {
    // Avoid long fallback detail fan-out for fused IDs on cold requests.
    return null
  }

  const localFullDeck = await fetchFromInternalApi(false)
  if (localFullDeck) return localFullDeck

  return null
}

const isFusedDeck = (deck: any) => {
  const format = String(deck?.format || '').toLowerCase()
  if (format === 'fused') return true
  const idCandidates = [deck?.id, deck?.deckId, deck?.deck_id]
    .filter(Boolean)
    .map((value) => String(value).toLowerCase())
  return idCandidates.some((value) => /^fused[_-]/.test(value) || value.includes('deck_fused'))
}

const getSetLabel = (deckLike: any): string | null => {
  const setName = deckLike?.cardSetName
  if (typeof setName === 'string' && setName.trim()) return setName.trim()
  const rawSetNo = deckLike?.cardSetNo
  const normalize = (value: unknown): string | null => {
    if (value === null || value === undefined) return null
    const normalized = String(value).trim().toUpperCase()
    if (!normalized) return null
    if (/^[SB]\d+/.test(normalized)) return normalized
    if (/^\d+$/.test(normalized)) return `S${normalized}`
    return normalized
  }

  const normalizedFromDeck = normalize(rawSetNo)
  if (normalizedFromDeck) return normalizedFromDeck

  const cards =
    (Array.isArray(deckLike?.cards) && deckLike.cards) ||
    (Array.isArray(deckLike?.cardList) && deckLike.cardList) ||
    []
  const cardWithSet = cards.find((card: any) => card?.cardSetNo || card?.cardSetId || card?.SK || card?.sk)
  const normalizedFromCards = normalize(cardWithSet?.cardSetNo || cardWithSet?.cardSetId || cardWithSet?.SK || cardWithSet?.sk)
  if (normalizedFromCards) return normalizedFromCards

  return null
}

const getRoundedScore = (deckLike: any): number | null => {
  const raw =
    deckLike?.deckScore ??
    deckLike?.score ??
    deckLike?.scoreValue ??
    deckLike?.sffScore ??
    null
  const numeric = typeof raw === 'number' ? raw : Number(raw)
  if (!Number.isFinite(numeric) || numeric <= 0) return null
  return Math.round(numeric * 100)
}

const getRoundedElo = (deckLike: any): number | null => {
  const raw = deckLike?.elo ?? deckLike?.Elo ?? deckLike?.deckElo ?? null
  const numeric = typeof raw === 'number' ? raw : Number(raw)
  if (!Number.isFinite(numeric) || numeric <= 0) return null
  return Math.round(numeric)
}

const buildCardColumns = (deck: any): CardColumn[] => {
  const extractCards = (deckLike: any): any[] => {
    if (!deckLike) return []
    if (Array.isArray(deckLike.cards) && deckLike.cards.length > 0) return deckLike.cards
    if (Array.isArray(deckLike.cardList) && deckLike.cardList.length > 0) return deckLike.cardList
    if (Array.isArray(deckLike.cardIds) && deckLike.cardIds.length > 0) return deckLike.cardIds
    return []
  }

  const sourceDecks =
    (Array.isArray(deck?.myDecks) && deck.myDecks.filter(Boolean)) ||
    (Array.isArray(deck?.decks) && deck.decks.filter(Boolean)) ||
    []

  if (sourceDecks.length >= 2) {
    const columnsFromSources = sourceDecks.slice(0, 2).map((source: any, idx: number) => {
      const normalizedSource = { ...source, cards: extractCards(source) }
      return {
        title: source?.name ? String(source.name) : `Half ${idx + 1}`,
        sections: buildCardSections(normalizedSource),
        factionIconPath: source?.faction ? `/images/icons/${String(source.faction).toLowerCase().trim()}.png` : null,
        setLabel: getSetLabel(source),
        score: getRoundedScore(source),
        elo: getRoundedElo(source),
      }
    })
    const hasCardsInSources = columnsFromSources.some((column: CardColumn) =>
      column.sections.some((section: CardSection) => section.items.length > 0)
    )
    if (hasCardsInSources) {
      return columnsFromSources
    }
  }

  if (isFusedDeck(deck)) {
    const cards = Array.isArray(deck?.cards) ? deck.cards : []
    const midpoint = Math.ceil(cards.length / 2)
    const leftCards = cards.slice(0, midpoint)
    const rightCards = cards.slice(midpoint)
    return [
      {
        title: 'Half 1',
        sections: buildCardSections({ ...deck, cards: leftCards }),
        factionIconPath: null,
        setLabel: null,
        score: null,
        elo: null,
      },
      {
        title: 'Half 2',
        sections: buildCardSections({ ...deck, cards: rightCards }),
        factionIconPath: null,
        setLabel: null,
        score: null,
        elo: null,
      },
    ]
  }

  return [
    {
      title: null,
      sections: buildCardSections(deck),
      factionIconPath: null,
      setLabel: null,
      score: null,
      elo: null,
    },
  ]
}

const buildOgPayload = (deck: any): OgPayload => {
  const secondaryForgeborn = resolveSecondaryForgeborn(deck)
  return {
    cardColumns: buildCardColumns(deck),
    forgebornName: resolveForgebornName(deck),
    forgebornFaction: resolveForgebornFaction(deck),
    secondaryForgebornName: secondaryForgeborn ? resolveForgebornNameFromForgeborn(secondaryForgeborn) : null,
    secondaryForgebornFaction: secondaryForgeborn
      ? resolveForgebornFactionFromForgeborn(secondaryForgeborn, deck)
      : null,
    deckName: typeof deck?.name === 'string' && deck.name.trim() ? deck.name.trim() : null,
    forgebornAbilities: collectForgebornAbilities(deck).slice(0, 3),
    secondaryForgebornAbilities: secondaryForgeborn
      ? collectForgebornAbilitiesFromForgeborn(secondaryForgeborn).slice(0, 3)
      : [],
  }
}

const getOgPayload = async (
  deckId: string,
  options?: { forceRefresh?: boolean; origin?: string; bypassFetchCache?: boolean }
): Promise<OgPayload> => {
  const forceRefresh = options?.forceRefresh === true
  const cacheKey = normalizeOgPayloadKey(deckId)
  if (!forceRefresh) {
    const cached = getCachedOgPayload(cacheKey)
    if (cached) return cached

    const inflight = ogPayloadInFlight.get(cacheKey)
    if (inflight) return inflight
  } else {
    ogPayloadCache.delete(cacheKey)
  }

  const promise = (async () => {
    const deck = await getDeckFromUpstream(deckId, {
      origin: options?.origin,
      bypassFetchCache: options?.bypassFetchCache,
    })
    const payload = deck
      ? buildOgPayload(deck)
      : {
          cardColumns: [],
          forgebornName: null,
          forgebornFaction: null,
          secondaryForgebornName: null,
          secondaryForgebornFaction: null,
          deckName: null,
          forgebornAbilities: [],
          secondaryForgebornAbilities: [],
        }
    setCachedOgPayload(cacheKey, payload)
    return payload
  })().finally(() => {
    ogPayloadInFlight.delete(cacheKey)
  })

  ogPayloadInFlight.set(cacheKey, promise)
  return promise
}

const stripMarkup = (value: string) => {
  const withIconText = value
    .replace(/<br\s*\/?>/gi, ' ')
    .replace(/<icon[^>]*src=["']([^"']+)["'][^>]*\/?>/gi, (_full, src: string) => {
      const lower = src.toLowerCase()
      if (lower.includes('attack')) return 'A'
      if (lower.includes('health')) return 'H'
      if (lower.includes('armor') || lower.includes('defense') || lower.includes('defence')) return 'D'
      return ''
    })
    .replace(/&nbsp;/gi, ' ')
    .replace(/&amp;/gi, '&')
    .replace(/\\"/g, '"')
    .replace(/\\'/g, "'")
    .replace(/\\\\/g, '\\')

  return withIconText.replace(/<[^>]*>/g, ' ').replace(/\s+/g, ' ').trim()
}

const normalizeForgebornAbilityText = (value: string) => {
  let normalized = value
    .replace(/([^\s])([+-])(?=\d)/g, '$1 $2')
    .replace(/([.!?])([A-Za-z])/g, '$1 $2')
    .replace(/\s+([.,!?;:])/g, '$1')
    .replace(/([.!?])\s+(["'])/g, '$1$2')
    .replace(/([.!?]["'])\s*([A-Za-z])/g, '$1 $2')
    .replace(/\s+/g, ' ')
    .trim()

  // Preserve common quoted trigger phrases as one unbreakable token in OG rendering.
  normalized = normalized.replace(
    /"([^"]*?\b(?:When|After|Before)\b[^"]*?)"/gi,
    (_full, inner: string) => `"${inner.replace(/\s+/g, '\u00A0')}"`
  )

  return normalized
}

type AbilityEntry = { title: string | null; text: string | null; level?: number | null }
type CardListEntry = {
  name: string
  factionIconPath: string | null
  rarityIconPath: string | null
  factionColor: string
  factionTextColor: string
}
type CardSection = { label: string; items: CardListEntry[] }
type CardColumn = {
  title: string | null
  sections: CardSection[]
  factionIconPath: string | null
  setLabel: string | null
  score: number | null
  elo: number | null
}

const getFactionBadgeColor = (faction?: string): string => {
  switch (faction) {
    case 'Alloyin':
      return '#06b6d4'
    case 'Uterra':
      return '#14b8a6'
    case 'Tempys':
      return '#f97316'
    case 'Nekrium':
      return '#a855f7'
    default:
      return '#6b7280'
  }
}

const getFactionTextColor = (faction?: string): string => {
  switch (faction) {
    case 'Alloyin':
      return '#7dd3fc'
    case 'Uterra':
      return '#86efac'
    case 'Tempys':
      return '#fdba74'
    case 'Nekrium':
      return '#c4b5fd'
    default:
      return '#e2e8f0'
  }
}

const normalizeRarityLabel = (rarity?: string | null): string | null => {
  if (!rarity) return null
  let normalized = rarity.trim()
  const lower = normalized.toLowerCase()
  if (lower === 'common common' || lower.match(/^common\s+common$/)) {
    normalized = 'CommonCommon'
  } else if (lower === 'rare rare' || lower.match(/^rare\s+rare$/)) {
    normalized = 'RareRare'
  } else if (lower.includes('darkforge') && lower.includes('rare')) {
    normalized = 'DarkforgeRare'
  } else if (lower.match(/^rare\s+common$/i) || (lower.startsWith('rare') && lower.includes('common') && !lower.startsWith('common'))) {
    normalized = 'RareCommon'
  } else if (lower.match(/^common\s+rare$/i) || (lower.startsWith('common') && lower.includes('rare'))) {
    normalized = 'CommonRare'
  } else if (lower.includes('common') && lower.includes('rare')) {
    normalized = 'CommonRare'
  } else if (lower.includes('common') && !lower.includes('rare')) {
    normalized = 'Common'
  } else if (lower.includes('rare') && !lower.includes('common')) {
    normalized = 'Rare'
  } else if (lower.includes('darkforge')) {
    normalized = 'Darkforge'
  } else if (lower.includes('ls') || lower.includes('legendary')) {
    normalized = 'LS'
  } else if (lower.includes('solbind')) {
    normalized = 'Solbind'
  }
  return normalized
}

const getRarityIconPath = (
  cardSetNo?: string | number,
  rarity?: string,
  cardId?: string,
  cardData?: any
): string | null => {
  const normalizedRarity = normalizeRarityLabel(rarity)
  if (!normalizedRarity) return null

  let cardSet: string | undefined
  if (cardData) {
    cardSet = cardData.cardSetId || cardData.CardSetId || cardData.SK || cardData.sk
    if (cardSet) {
      cardSet = String(cardSet).toLowerCase().trim()
    }
  }
  if (!cardSet && cardSetNo) {
    cardSet = String(cardSetNo).toLowerCase().trim()
  }
  if (!cardSet && cardId) {
    if (/^b3_/i.test(cardId)) {
      cardSet = 'b3'
    } else if (/^b2_/i.test(cardId)) {
      cardSet = 'b2'
    } else if (/^b1_/i.test(cardId)) {
      cardSet = 'b1'
    } else {
      const match = cardId.match(/^s(\d+)/i)
      if (match && match[1]) {
        cardSet = `s${match[1]}`
      }
    }
  }

  const isB3Set =
    (cardSet && (cardSet.toUpperCase() === 'B3' || cardSet === 'b3')) ||
    (cardId && /^b3_/i.test(cardId))
  const isB2Set =
    (cardSet && (cardSet.toUpperCase() === 'B2' || cardSet === 'b2')) ||
    (cardId && /^b2_/i.test(cardId))
  const isB1Set =
    (cardSet && (cardSet.toUpperCase() === 'B1' || cardSet === 'b1')) ||
    (cardId && /^b1_/i.test(cardId))

  if (isB3Set) return `/images/icons/rarity/B3_${normalizedRarity}.png`
  if (isB2Set) return `/images/icons/rarity/B2_${normalizedRarity}.png`
  if (isB1Set) return `/images/icons/rarity/B1_${normalizedRarity}.png`

  let setNo = '1'
  if (cardSet) {
    const match = cardSet.match(/^s?(\d+)/i)
    if (match && match[1]) {
      setNo = match[1]
    } else {
      setNo = cardSet
    }
  }
  if (setNo === '99') setNo = '1'
  return `/images/icons/rarity/S${setNo}_${normalizedRarity}.png`
}

type AbilityRenderToken =
  | { kind: 'text'; text: string }
  | { kind: 'level'; src: string; suffix?: string }
  | { kind: 'stat'; src: string; number: string; suffix?: string }
  | { kind: 'statLetter'; src: string; suffix?: string }

const tokenizeAbilityRenderTokens = (
  normalizedText: string,
  statIconMap: Map<string, string | null>,
  levelIconMap: Map<number, string | null>
) => {
  const parts: Array<
    | { type: 'text'; value: string }
    | { type: 'stat'; src: string; number: string }
    | { type: 'statLetter'; src: string }
    | { type: 'level'; src: string }
  > = []
  const pattern = /(\[(?:l)?([1-4])\]|([+-]?\d+)\s*([ADH])\b(?![A-Za-z])|(?<![A-Za-z])([ADH])(?=[^A-Za-z]|$))/g
  let lastIndex = 0
  let match: RegExpExecArray | null

  while ((match = pattern.exec(normalizedText)) !== null) {
    const [full, _token, levelValue, numberValue, statValue, standaloneStatValue] = match
    const start = match.index
    if (start > lastIndex) {
      parts.push({ type: 'text', value: normalizedText.slice(lastIndex, start) })
    }
    if (levelValue) {
      const level = Number(levelValue)
      const iconSrc = Number.isFinite(level) ? levelIconMap.get(level) || null : null
      if (!iconSrc) {
        parts.push({ type: 'text', value: full })
      } else {
        parts.push({ type: 'level', src: iconSrc })
      }
    } else {
      const stat = (statValue || standaloneStatValue || '').toUpperCase()
      const iconSrc = statIconMap.get(stat) || null
      if (!iconSrc) {
        parts.push({ type: 'text', value: full })
      } else if (numberValue) {
        parts.push({ type: 'stat', src: iconSrc, number: numberValue })
      } else {
        parts.push({ type: 'statLetter', src: iconSrc })
      }
    }
    lastIndex = start + full.length
  }

  if (lastIndex < normalizedText.length) {
    parts.push({ type: 'text', value: normalizedText.slice(lastIndex) })
  }

  const renderTokens: AbilityRenderToken[] = []
  const appendToPreviousToken = (suffix: string) => {
    if (!suffix) return
    const lastToken = renderTokens[renderTokens.length - 1]
    if (!lastToken) {
      renderTokens.push({ kind: 'text', text: suffix })
      return
    }
    if (lastToken.kind === 'text') {
      lastToken.text += suffix
      return
    }
    lastToken.suffix = `${lastToken.suffix || ''}${suffix}`
  }

  parts.forEach((part) => {
    if (part.type === 'text') {
      const rawTokens = part.value.match(/\S+/g) || []
      rawTokens.forEach((rawToken) => {
        let token = rawToken
        if (renderTokens.length > 0) {
          const punctPrefix = token.match(/^([.,!?;:]+["')\]]*)(.+)$/)
          if (punctPrefix) {
            appendToPreviousToken(punctPrefix[1])
            token = punctPrefix[2]
          }
        }
        if (/^[.,!?;:"')\]]+$/.test(token) && renderTokens.length > 0) {
          appendToPreviousToken(token)
          return
        }
        if (token) {
          renderTokens.push({ kind: 'text', text: token })
        }
      })
      return
    }
    if (part.type === 'level') {
      renderTokens.push({ kind: 'level', src: part.src })
      return
    }
    if (part.type === 'stat') {
      renderTokens.push({ kind: 'stat', src: part.src, number: part.number })
      return
    }
    renderTokens.push({ kind: 'statLetter', src: part.src })
  })

  return renderTokens
}

const renderAbilityText = (
  text: string,
  statIconMap: Map<string, string | null>,
  levelIconMap: Map<number, string | null>,
  options?: { inline?: boolean; levelIconSize?: number; iconScale?: number }
) => {
  const normalizedText = normalizeForgebornAbilityText(String(text || ''))
  if (!normalizedText) return null
  const inlineMode = options?.inline === true
  const levelIconSize = options?.levelIconSize && options.levelIconSize > 0 ? options.levelIconSize : 18
  const iconScale = options?.iconScale && options.iconScale > 0 ? options.iconScale : 1
  const scaledLevelIconSize = levelIconSize * iconScale
  const scaledStatIconSize = 20 * iconScale
  const renderTokens = tokenizeAbilityRenderTokens(normalizedText, statIconMap, levelIconMap)

  return (
    <div
      style={{
        display: 'flex',
        flexWrap: 'wrap',
        alignItems: 'center',
        width: inlineMode ? 'auto' : '100%',
        minWidth: 0,
        maxWidth: '100%',
        flex: inlineMode ? 1 : undefined,
      }}
    >
      {renderTokens.map((token, idx) => {
        if (token.kind === 'text') {
          return (
            <span key={`text-${idx}`} style={{ whiteSpace: 'nowrap' }}>
              {`${token.text}\u00A0`}
            </span>
          )
        }
        if (token.kind === 'level') {
          return (
            <span key={`level-${idx}`} style={{ display: 'flex', alignItems: 'center', whiteSpace: 'nowrap' }}>
              <img
                src={token.src}
                style={{
                  verticalAlign: 'middle',
                  width: `${scaledLevelIconSize}px`,
                  height: `${scaledLevelIconSize}px`,
                  objectFit: 'contain',
                  margin: '0 2px 0 1px',
                  transform: 'translateY(2px)',
                }}
              />
              <span>{`${token.suffix || ''}\u00A0`}</span>
            </span>
          )
        }
        if (token.kind === 'statLetter') {
          return (
            <span
              key={`stat-letter-${idx}`}
              style={{ display: 'flex', alignItems: 'center', verticalAlign: 'middle', whiteSpace: 'nowrap' }}
            >
              <img
                src={token.src}
                style={{
                  verticalAlign: 'middle',
                  width: `${scaledStatIconSize}px`,
                  height: `${scaledStatIconSize}px`,
                  objectFit: 'contain',
                  marginLeft: '1px',
                  transform: 'translateY(1px)',
                }}
              />
              <span>{`${token.suffix || ''}\u00A0`}</span>
            </span>
          )
        }
        return (
          <span
            key={`stat-${idx}`}
            style={{ display: 'flex', alignItems: 'center', verticalAlign: 'middle', whiteSpace: 'nowrap' }}
          >
            <span>{token.number}</span>
            <img
              key={`level-${idx}`}
              src={token.src}
              style={{
                verticalAlign: 'middle',
                width: `${scaledStatIconSize}px`,
                height: `${scaledStatIconSize}px`,
                objectFit: 'contain',
                marginLeft: '2px',
                transform: 'translateY(1px)',
              }}
            />
            <span>{`${token.suffix || ''}\u00A0`}</span>
          </span>
        )
      })}
    </div>
  )
}

const resolveForgebornNameFromForgeborn = (forgeborn: any) => {
  const named =
    forgeborn?.name ||
    forgeborn?.Name ||
    forgeborn?.title ||
    forgeborn?.cardName ||
    null
  if (named) return String(named).trim()
  const fallback = forgeborn?.id || forgeborn?.cardId || forgeborn?.card_id || null
  if (!fallback) return null
  return toTitleCase(String(fallback).replace(/[_-]+/g, ' ').trim())
}

const resolveForgebornName = (deck: any) => {
  const fromForgeborn = resolveForgebornNameFromForgeborn(deck?.forgeborn)
  if (fromForgeborn) return fromForgeborn
  const fallback = deck?.forgebornName || deck?.forgebornId || deck?.forgeborn?.id || null
  if (!fallback) return null
  return toTitleCase(String(fallback).replace(/[_-]+/g, ' ').trim())
}

const resolveForgebornFactionFromForgeborn = (forgeborn: any, deck?: any): string | null => {
  const direct = forgeborn?.faction || forgeborn?.Faction || null
  if (typeof direct === 'string' && direct.trim()) {
    return direct.trim()
  }
  const fallback = deck?.faction || deck?.Faction || null
  if (typeof fallback === 'string' && fallback.trim()) {
    return fallback.trim()
  }
  return null
}

const resolveForgebornFaction = (deck: any): string | null => {
  const direct = resolveForgebornFactionFromForgeborn(deck?.forgeborn, deck)
  if (direct) return direct

  const sourceDecks = Array.isArray(deck?.myDecks) ? deck.myDecks : []
  for (const source of sourceDecks) {
    const sourceForgeborn = source?.forgeborn
    const sourceFaction =
      sourceForgeborn?.faction ||
      sourceForgeborn?.Faction ||
      source?.faction ||
      source?.Faction ||
      null
    if (typeof sourceFaction === 'string' && sourceFaction.trim()) {
      return sourceFaction.trim()
    }
  }

  return null
}

const formatAbilityEntry = (ability: any): AbilityEntry | null => {
  if (!ability) return null
  if (typeof ability === 'string') {
    const text = normalizeForgebornAbilityText(stripMarkup(ability))
    return text ? { title: null, text, level: null } : null
  }
  if (typeof ability !== 'object') return null
  const levelRaw = Number(
    ability?.level ??
      ability?.lvl ??
      ability?.levelNumber ??
      ability?.rank ??
      ability?.abilityLevel ??
      NaN
  )
  const level = Number.isFinite(levelRaw) ? levelRaw : null
  const title = ability?.name || ability?.Name || ability?.title || ability?.cardName || null
  const rawText =
    ability?.text ||
    ability?.Text ||
    ability?.description ||
    ability?.desc ||
    ability?.['1text'] ||
    ability?.['2text'] ||
    ability?.['3text'] ||
    null
  const text = rawText ? normalizeForgebornAbilityText(stripMarkup(String(rawText))) : null
  if (!title && !text) return null
  return { title: title ? String(title).trim() : null, text, level }
}

const collectForgebornAbilitiesFromForgeborn = (forgeborn: any) => {
  const entries: AbilityEntry[] = []
  const pushAbility = (ability: any, levelOverride?: number | null) => {
    const entry = formatAbilityEntry(ability)
    if (entry) {
      entries.push({
        ...entry,
        level: levelOverride ?? entry.level ?? null,
      })
    }
  }

  if (!forgeborn || typeof forgeborn !== 'object') return entries

  const levelMap = forgeborn?.levels
  if (levelMap && typeof levelMap === 'object') {
    ;[2, 3, 4].forEach((level) => {
      const levelEntry = (levelMap as any)?.[level] ?? (levelMap as any)?.[String(level)]
      if (!levelEntry) return
      const text = levelEntry?.text ?? levelEntry?.Text ?? levelEntry?.description ?? levelEntry?.desc ?? null
      if (!text) return
      const name = levelEntry?.name || levelEntry?.Name || levelEntry?.title || null
      pushAbility(
        {
          name: name ? String(name) : null,
          text,
        },
        level
      )
    })
  }

  if (entries.length === 0) {
    const a2t = forgeborn?.a2t ?? forgeborn?.a2T ?? null
    const a3t = forgeborn?.a3t ?? forgeborn?.a3T ?? null
    const a4t = forgeborn?.a4t ?? forgeborn?.a4T ?? null
    const a2n = forgeborn?.a2n ?? forgeborn?.a2N ?? null
    const a3n = forgeborn?.a3n ?? forgeborn?.a3N ?? null
    const a4n = forgeborn?.a4n ?? forgeborn?.a4N ?? null
    if (a2t) pushAbility({ name: a2n ?? null, text: a2t }, 2)
    if (a3t) pushAbility({ name: a3n ?? null, text: a3t }, 3)
    if (a4t) pushAbility({ name: a4n ?? null, text: a4t }, 4)
  }

  if (entries.length === 0) {
    const rawAbilities =
      forgeborn?.abilities ||
      forgeborn?.abilityCards ||
      forgeborn?.ability_cards ||
      forgeborn?.abilityList ||
      forgeborn?.abilitiesList ||
      null
    if (Array.isArray(rawAbilities)) {
      rawAbilities.forEach((ability, index) => pushAbility(ability, 2 + index))
    } else if (rawAbilities) {
      pushAbility(rawAbilities)
    }

    const abilityKeys: Array<[string, number | null]> = [
      ['ability1', 2],
      ['ability2', 3],
      ['ability3', 4],
      ['ability4', null],
      ['ability5', null],
    ]
    abilityKeys.forEach(([key, level]) => {
      if (forgeborn?.[key]) pushAbility(forgeborn[key], level)
    })

    if (entries.length === 0) {
      const levelKeys: Array<[string, number]> = [
        ['1text', 2],
        ['2text', 3],
        ['3text', 4],
      ]
      levelKeys.forEach(([key, level]) => {
        if (forgeborn?.[key]) pushAbility(forgeborn[key], level)
      })
    }

    if (entries.length === 0 && (forgeborn?.text || forgeborn?.Text)) {
      pushAbility(forgeborn?.text || forgeborn?.Text)
    }
  }

  return entries
}

const collectForgebornAbilities = (deck: any) => collectForgebornAbilitiesFromForgeborn(deck?.forgeborn)

const resolveSecondaryForgeborn = (deck: any) => {
  const primaryId = deck?.forgeborn?.id || deck?.forgebornId || null
  const primaryIdLower = primaryId ? String(primaryId).toLowerCase() : null
  const cardLookup = new Map<string, any>()
  const deckCards = Array.isArray(deck?.cards)
    ? deck.cards
    : Array.isArray(deck?.cardList)
      ? deck.cardList
      : Array.isArray(deck?.cardIds)
        ? deck.cardIds
        : []
  deckCards.forEach((card: any) => {
    if (!card || typeof card !== 'object') return
    const cardId = card?.id || card?.cardId || card?.card_id || null
    if (!cardId) return
    cardLookup.set(String(cardId).toLowerCase(), card)
  })
  const normalizeCandidate = (card: any) => {
    if (!card) return null
    if (typeof card === 'string') {
      return cardLookup.get(card.toLowerCase()) || null
    }
    return card
  }
  const candidateSources = [
    deck?.forgeborn?.solbindCards,
    deck?.forgeborn?.solbind_cards,
    deck?.forgeborn?.solbinds,
    deck?.solbindCards,
    deck?.solbind_cards,
    deck?.solbinds,
  ]

  for (const source of candidateSources) {
    if (!Array.isArray(source)) continue
    for (const rawCard of source) {
      const card = normalizeCandidate(rawCard)
      if (!card || typeof card !== 'object') continue
      const cardId = card?.id || card?.cardId || card?.card_id || null
      if (cardId && primaryIdLower && String(cardId).toLowerCase() === primaryIdLower) continue
      const typeValue = card?.cardType || card?.card_type || card?.type || card?.Type || ''
      const typeLower = String(typeValue).toLowerCase()
      if (!typeLower.includes('forgeborn')) continue
      const rarityValue = card?.rarity || card?.Rarity || ''
      const rarityLower = String(rarityValue).toLowerCase()
      if (rarityLower.includes('solbind')) continue
      return card
    }
  }

  return null
}

export async function GET(
  request: NextRequest,
  context: { params: Promise<{ id?: string }> }
) {
  const { id } = await context.params
  const deckId = id || ''
  const requestStartMs = nowPerfMs()
  const traceTiming = request.nextUrl.searchParams.get('trace') === '1'
  const timingEntries: OgTimingEntry[] = []
  const pushTiming = (stage: string, startMs: number) => {
    timingEntries.push({ stage, durationMs: nowPerfMs() - startMs })
  }
  const measureStage = async <T,>(stage: string, action: () => Promise<T> | T) => {
    const stageStart = nowPerfMs()
    try {
      return await action()
    } finally {
      pushTiming(stage, stageStart)
    }
  }
  let finalizedTiming: { headers: Record<string, string>; totalMs: number } | null = null
  const finalizeTiming = (outcome: string) => {
    if (finalizedTiming) return finalizedTiming
    const totalMs = nowPerfMs() - requestStartMs
    const headers = {
      'Server-Timing': buildServerTimingHeader(timingEntries, totalMs),
    }
    if (traceTiming) {
      const breakdown = timingEntries.map((entry) => `${entry.stage}=${roundTimingMs(entry.durationMs)}ms`).join(' ')
      console.info(
        `[OG Timing] deck=${deckId || 'unknown'} outcome=${outcome} total=${roundTimingMs(totalMs)}ms ${breakdown}`
      )
    }
    finalizedTiming = { headers, totalMs }
    return finalizedTiming
  }
  const hasQueryVariantBuster = !!request.nextUrl.searchParams.get('uq')
  const hardRefresh = request.nextUrl.searchParams.get('hardRefresh') === '1'
  const forceRefresh = request.nextUrl.searchParams.get('refresh') === '1' || hasQueryVariantBuster
  const origin = new URL(request.url).origin
  const imageCacheKey = normalizeOgImageKey(deckId)

  if (forceRefresh) {
    ogImageCache.delete(imageCacheKey)
  } else {
    const localCachedImage = await measureStage('cache.memory.get', () => getCachedOgImage(imageCacheKey))
    if (localCachedImage) {
      const timing = finalizeTiming('memory-hit')
      return new Response(toArrayBuffer(localCachedImage), {
        headers: {
          'Content-Type': 'image/png',
          'Cache-Control': 'public, max-age=60, s-maxage=3600, stale-while-revalidate=86400',
          'X-OG-Cache': 'memory-hit',
          ...timing.headers,
        },
      })
    }
  }

  if (!forceRefresh && isOgUpstashCacheConfigured()) {
    const cachedImage = await measureStage('cache.upstash.get', () =>
      getOgImageFromUpstashCache(deckId, { version: OG_IMAGE_VERSION })
    )
    if (cachedImage) {
      await measureStage('cache.memory.set', () => setCachedOgImage(imageCacheKey, cachedImage))
      const timing = finalizeTiming('upstash-hit')
      return new Response(toArrayBuffer(cachedImage), {
        headers: {
          'Content-Type': 'image/png',
          'Cache-Control': 'public, max-age=60, s-maxage=3600, stale-while-revalidate=86400',
          'X-OG-Cache': 'upstash-hit',
          ...timing.headers,
        },
      })
    }
  }

  const payload = await measureStage('payload.fetch', () =>
    getOgPayload(deckId, { forceRefresh, origin, bypassFetchCache: hardRefresh })
  )
  const cardColumns = payload.cardColumns
  const forgebornAbilities = payload.forgebornAbilities.map((ability, index) => ({
    ...ability,
    level: ability.level ?? (index < 3 ? index + 2 : null),
  }))
  const secondaryForgebornName = payload.secondaryForgebornName
  const secondaryForgebornAbilities = payload.secondaryForgebornAbilities.map((ability, index) => ({
    ...ability,
    level: ability.level ?? (index < 3 ? index + 2 : null),
  }))
  const hasSecondaryForgeborn =
    !!secondaryForgebornName || secondaryForgebornAbilities.some((ability) => !!ability?.text?.trim())

  const resolveAssetUrl = (url: string | null) => {
    if (!url) return null
    if (url.startsWith('http://') || url.startsWith('https://') || url.startsWith('data:')) return url
    return `${origin}${url.startsWith('/') ? '' : '/'}${url}`
  }

  const loadIconSrc = async (url: string | null) => {
    if (!url) return null
    const localPath = url.startsWith(`${origin}/images/`)
      ? new URL(url).pathname
      : url.startsWith('/images/')
        ? url
        : null
    if (localPath) {
      const localDataUrl = await getLocalAssetDataUrl(localPath)
      if (localDataUrl) return localDataUrl
    }
    const cached = iconSrcCache.get(url)
    if (cached) {
      if (cached.expiresAt >= Date.now()) {
        touchEntry(iconSrcCache, url, { ...cached, expiresAt: Date.now() + OG_ICON_CACHE_TTL_MS })
        return cached.src
      }
      iconSrcCache.delete(url)
    }
    const inflight = iconSrcInFlight.get(url)
    if (inflight) return inflight

    const promise = (async () => {
      try {
        const iconRes = await fetchWithTimeout(
          url,
          {
            cache: 'force-cache',
            next: { revalidate: 86400 },
          },
          OG_ICON_TIMEOUT_MS
        )
        if (iconRes?.ok) {
          const data = await withTimeout(iconRes.arrayBuffer().catch(() => null), OG_ICON_TIMEOUT_MS, null)
          if (data) return `data:image/png;base64,${toBase64(data)}`
        }
      } catch {
        // ignore
      }
      return url
    })().finally(() => {
      iconSrcInFlight.delete(url)
    })

    iconSrcInFlight.set(url, promise)
    const resolved = await promise
    touchEntry(iconSrcCache, url, { expiresAt: Date.now() + OG_ICON_CACHE_TTL_MS, src: resolved })
    trimLru(iconSrcCache, OG_ICON_CACHE_MAX_ENTRIES)
    return resolved
  }

  const cardIconPaths = Array.from(
    new Set(
      cardColumns.flatMap((column) => [
        ...(column.factionIconPath ? [column.factionIconPath] : []),
        ...column.sections.flatMap((section) =>
          section.items.flatMap((item) => [item.rarityIconPath]).filter(Boolean)
        ),
      ])
    )
  ) as string[]
  const cardIconMap = new Map<string, string | null>()
  if (cardIconPaths.length > 0) {
    const loaded = await measureStage('icons.cards.load', () =>
      Promise.all(cardIconPaths.map((path) => loadIconSrc(resolveAssetUrl(path))))
    )
    loaded.forEach((src, idx) => {
      const path = cardIconPaths[idx]
      cardIconMap.set(path, src || resolveAssetUrl(path))
    })
  }
  const abilityLevels = new Set<number>()
  const levelTokenPattern = /\[(?:l)?([1-4])\]/gi
  forgebornAbilities.forEach((ability) => {
    const level = ability.level
    if (level && level >= 1 && level <= 4) {
      abilityLevels.add(level)
    }
    if (ability.text) {
      let match: RegExpExecArray | null
      while ((match = levelTokenPattern.exec(ability.text)) !== null) {
        const tokenLevel = Number(match[1])
        if (Number.isFinite(tokenLevel)) {
          abilityLevels.add(tokenLevel)
        }
      }
    }
  })
  secondaryForgebornAbilities.forEach((ability) => {
    const level = ability.level
    if (level && level >= 1 && level <= 4) {
      abilityLevels.add(level)
    }
    if (ability.text) {
      let match: RegExpExecArray | null
      while ((match = levelTokenPattern.exec(ability.text)) !== null) {
        const tokenLevel = Number(match[1])
        if (Number.isFinite(tokenLevel)) {
          abilityLevels.add(tokenLevel)
        }
      }
    }
  })
  forgebornAbilities.slice(0, 3).forEach((_, idx) => abilityLevels.add(idx + 2))
  secondaryForgebornAbilities.slice(0, 3).forEach((_, idx) => abilityLevels.add(idx + 2))
  const levelIconEntries = Array.from(abilityLevels)
    .sort((a, b) => a - b)
    .map((level) => ({ level, url: `${origin}/images/icons/levels/lv${level}-icon.png` }))
  const levelIconMap = new Map<number, string | null>()
  if (levelIconEntries.length > 0) {
    const loaded = await measureStage('icons.levels.load', () =>
      Promise.all(levelIconEntries.map((entry) => loadIconSrc(entry.url)))
    )
    loaded.forEach((src, idx) => {
      const entry = levelIconEntries[idx]
      levelIconMap.set(entry.level, src || null)
    })
  }

  const statIconEntries = [
    { key: 'A', url: `${origin}/images/icons/attack.png` },
    { key: 'H', url: `${origin}/images/icons/health.png` },
    { key: 'D', url: `${origin}/images/icons/armor.png` },
  ]
  const statIconMap = new Map<string, string | null>()
  if (statIconEntries.length > 0) {
    const loaded = await measureStage('icons.stats.load', () =>
      Promise.all(statIconEntries.map((entry) => loadIconSrc(entry.url)))
    )
    loaded.forEach((src, idx) => {
      const entry = statIconEntries[idx]
      statIconMap.set(entry.key, src || null)
    })
  }
  const hasCardSections = cardColumns.some((column) => column.sections.length > 0)
  const hasRenderableCards = cardColumns.some((column) =>
    column.sections.some((section) => Array.isArray(section.items) && section.items.length > 0)
  )
  const hasRenderableAbilities =
    forgebornAbilities.some((ability) => !!ability?.text?.trim()) ||
    secondaryForgebornAbilities.some((ability) => !!ability?.text?.trim())
  if (!hasRenderableCards || !hasRenderableAbilities) {
    const timing = finalizeTiming('data-unavailable')
    return new Response('OG data unavailable', {
      status: 503,
      headers: {
        'Content-Type': 'text/plain; charset=utf-8',
        'Cache-Control': 'no-store, max-age=0',
        ...timing.headers,
      },
    })
  }

  const layoutSolveStartMs = nowPerfMs()
  const showFusedColumns = cardColumns.length > 1
  const imageWidth = 1200
  const imageHeight = 630
  const containerPaddingX = 24
  const containerPaddingY = 12
  const innerWidth = imageWidth - containerPaddingX * 2
  const innerHeight = imageHeight - containerPaddingY * 2
  const fusedColumnGap = 10
  const halfDeckColumnGap = 8
  const defaultFusedCardColumnFlexes: [number, number] = [1.02, 1.02]
  const defaultFusedForgebornColumnFlex = 0.96
  const defaultHalfDeckCardColumnFlex = 0.49
  const defaultHalfDeckForgebornColumnFlex = 0.51
  const fusedAvailableWidth = innerWidth - fusedColumnGap * 2
  const halfDeckAvailableWidth = innerWidth - halfDeckColumnGap
  const getFusedColumnWidths = (cardFlexes: [number, number], forgebornFlex: number) => {
    const totalFlex = cardFlexes[0] + cardFlexes[1] + forgebornFlex
    return {
      cardColumnWidths: [
        (fusedAvailableWidth * cardFlexes[0]) / totalFlex,
        (fusedAvailableWidth * cardFlexes[1]) / totalFlex,
      ] as [number, number],
      forgebornColumnWidth: (fusedAvailableWidth * forgebornFlex) / totalFlex,
    }
  }
  const getHalfDeckColumnWidths = (cardFlex: number, forgebornFlex: number) => {
    const totalFlex = cardFlex + forgebornFlex
    return {
      cardColumnWidth: (halfDeckAvailableWidth * cardFlex) / totalFlex,
      forgebornColumnWidth: (halfDeckAvailableWidth * forgebornFlex) / totalFlex,
    }
  }
  const globalFontScale = 1.155
  const fusedFontScale = showFusedColumns ? 1.44 : 1
  const scaleFont = (size: number) => Math.round(size * fusedFontScale * globalFontScale * 10) / 10
  const cardListFontScale = 1.1025
  const ogBodyTextWeight = 700
  const baseLabelFontSize = scaleFont(12)
  const baseNoCardsFontSize = scaleFont(18)
  const baseCardFontSize = scaleFont(20 * cardListFontScale)
  const cardRowLineHeight = showFusedColumns ? 1.19 : 1.15
  const baseForgebornAbilityFont = baseCardFontSize * (showFusedColumns ? 1 : 0.84)
  const baseForgebornAbilityLineHeight = showFusedColumns ? 1.18 : 1.22
  const primaryAbilityScale = 1
  const forgebornAbilityIconScale = 1.5
  const cardTopSafetyPx = showFusedColumns ? 3 : 3
  const cardBottomSafetyPx = showFusedColumns ? 10 : 12
  const forgebornTopSafetyPx = showFusedColumns ? 3 : 3
  const forgebornBottomSafetyPx = showFusedColumns ? 14 : 14
  const forgebornAbilityLineHeight = hasSecondaryForgeborn
    ? Math.max(1.08, baseForgebornAbilityLineHeight - 0.05)
    : baseForgebornAbilityLineHeight
  const secondaryForgebornAbilityLineHeight = Math.max(1.05, forgebornAbilityLineHeight - 0.05)
  const baseForgebornLevelIconSize = showFusedColumns ? 18 : 16
  const textWidthEstimateCache = new Map<string, number>()
  const lineEstimateCache = new Map<string, number>()

  const estimateTextWidth = (text: string, fontSize: number) => {
    const normalized = String(text || '').trim()
    if (!normalized) return 0
    const roundedSize = Math.round(fontSize * 100) / 100
    const cacheKey = `${roundedSize}|${normalized}`
    const cached = textWidthEstimateCache.get(cacheKey)
    if (cached !== undefined) return cached

    let sum = 0
    for (const ch of normalized) {
      if (/[ilI1'`|!]/.test(ch)) sum += roundedSize * 0.28
      else if (/[mwMW@#%&]/.test(ch)) sum += roundedSize * 0.78
      else if (/[A-Z]/.test(ch)) sum += roundedSize * 0.62
      else if (/[0-9]/.test(ch)) sum += roundedSize * 0.56
      else if (/[\-_,.:;()/+]/.test(ch)) sum += roundedSize * 0.34
      else if (/\s/.test(ch)) sum += roundedSize * 0.33
      else sum += roundedSize * 0.52
    }
    textWidthEstimateCache.set(cacheKey, sum)
    return sum
  }

  const estimateLinesForText = (text: string, fontSize: number, maxWidth: number) => {
    const normalized = String(text || '').trim()
    if (!normalized) return 0
    const roundedSize = Math.round(fontSize * 100) / 100
    const roundedWidth = Math.round(maxWidth * 100) / 100
    const cacheKey = `${roundedSize}|${roundedWidth}|${normalized}`
    const cached = lineEstimateCache.get(cacheKey)
    if (cached !== undefined) return cached

    const widthLimit = Math.max(1, roundedWidth * (showFusedColumns ? 0.98 : 1.0))
    const words = normalized.split(/\s+/)
    const spaceWidth = roundedSize * 0.33

    const wordWidth = (word: string) => estimateTextWidth(word, roundedSize)

    let lines = 1
    let lineWidth = 0

    for (const word of words) {
      let w = wordWidth(word)
      if (lineWidth > 0) {
        if (lineWidth + spaceWidth + w <= widthLimit) {
          lineWidth += spaceWidth + w
          continue
        }
        lines += 1
        lineWidth = 0
      }

      if (w <= widthLimit) {
        lineWidth = w
        continue
      }

      // Very long token fallback: simulate internal wrapping.
      const wrappedLines = Math.floor(w / widthLimit)
      if (wrappedLines > 0) {
        lines += wrappedLines
        w -= wrappedLines * widthLimit
      }
      lineWidth = Math.max(0, w)
      if (lineWidth === 0) {
        lineWidth = widthLimit
      }
    }

    const result = Math.max(1, lines)
    lineEstimateCache.set(cacheKey, result)
    return result
  }

  const fitScale = (minScale: number, maxScale: number, fits: (scale: number) => boolean) => {
    const fitScaleIterations = 6
    let low = minScale
    let high = maxScale
    for (let i = 0; i < fitScaleIterations; i += 1) {
      const mid = (low + high) / 2
      if (fits(mid)) {
        low = mid
      } else {
        high = mid
      }
    }
    return Math.max(minScale, Math.min(maxScale, low))
  }

  const shouldShowSectionLabel = (label: string) => !/^(creatures|spells)\b/i.test(label)

  const estimateCardColumnHeight = (
    column: CardColumn | undefined,
    scale: number,
    columnWidth: number,
    spacing?: { sectionGap?: number; listGap?: number }
  ) => {
    if (!column || column.sections.length === 0) {
      return baseNoCardsFontSize * scale * 1.2
    }
    const labelFontSize = baseLabelFontSize * scale
    const cardFontSize = baseCardFontSize * scale
    const iconSize = Math.round(cardFontSize)
    const textWidth = Math.max(40, columnWidth - iconSize - (showFusedColumns ? 14 : 12))
    const sectionGap = spacing?.sectionGap ?? 8
    const labelGap = 4
    const listGap = spacing?.listGap ?? 4
    const lineHeight = cardRowLineHeight
    const labelLineHeight = 1.1

    let totalHeight = 0
    column.sections.forEach((section, index) => {
      const showLabel = shouldShowSectionLabel(section.label)
      const labelHeight = showLabel ? labelFontSize * labelLineHeight + labelGap : 0
      const items = section.items || []
      const listHeight =
        items.length > 0
          ? items.reduce((sum, item) => {
              const lines = Math.max(1, estimateLinesForText(item.name, cardFontSize, textWidth))
              const lineBlockHeight = lines * cardFontSize * lineHeight + cardFontSize * (showFusedColumns ? 0.1 : 0.1)
              return sum + lineBlockHeight
            }, 0) +
            (items.length - 1) * listGap
          : cardFontSize * lineHeight
      const sectionHeight = labelHeight + listHeight
      totalHeight += sectionHeight
      if (index < column.sections.length - 1) {
        totalHeight += sectionGap
      }
    })
    return totalHeight + cardTopSafetyPx + cardBottomSafetyPx
  }

  const estimateCardColumnWidthUsage = (
    column: CardColumn | undefined,
    scale: number,
    columnWidth: number
  ) => {
    if (!column || column.sections.length === 0) return 0
    const cardFontSize = baseCardFontSize * scale
    const iconSize = Math.round(cardFontSize)
    const textWidth = Math.max(40, columnWidth - iconSize - 12)
    const allNames = column.sections.flatMap((section) => (section.items || []).map((item) => item.name || ''))
    if (allNames.length === 0) return 0
    const widths = allNames
      .map((name) => estimateTextWidth(name, cardFontSize))
      .filter((width) => Number.isFinite(width) && width > 0)
      .sort((a, b) => a - b)
    if (widths.length === 0) return 0
    const maxWidth = widths[widths.length - 1]
    const p75Width = widths[Math.min(widths.length - 1, Math.floor((widths.length - 1) * 0.75))]
    const avgWidth = widths.reduce((sum, width) => sum + width, 0) / widths.length
    const representativeWidth = maxWidth * 0.45 + p75Width * 0.4 + avgWidth * 0.15
    return Math.max(0, Math.min(1, representativeWidth / Math.max(1, textWidth)))
  }

  const estimateAbilityTokenWidth = (
    token: AbilityRenderToken,
    fontSize: number,
    scaledLevelIconSize: number,
    scaledStatIconSize: number
  ) => {
    const safety = showFusedColumns ? 1.03 : 1.02
    if (token.kind === 'text') {
      return estimateTextWidth(`${token.text} `, fontSize) * safety
    }
    const suffixWidth = estimateTextWidth(`${token.suffix || ''} `, fontSize)
    if (token.kind === 'level') {
      return (scaledLevelIconSize + 3 + suffixWidth) * safety
    }
    if (token.kind === 'statLetter') {
      return (scaledStatIconSize + 1 + suffixWidth) * safety
    }
    return (estimateTextWidth(token.number, fontSize) + scaledStatIconSize + 2 + suffixWidth) * safety
  }

  const estimateAbilityLinesFromRenderTokens = (
    tokens: AbilityRenderToken[],
    fontSize: number,
    maxWidth: number,
    scaledLevelIconSize: number,
    scaledStatIconSize: number
  ) => {
    if (tokens.length === 0) return 1
    const widthLimit = Math.max(1, maxWidth)
    let lines = 1
    let lineWidth = 0

    tokens.forEach((token) => {
      const tokenWidth = Math.max(
        fontSize * 0.4,
        estimateAbilityTokenWidth(token, fontSize, scaledLevelIconSize, scaledStatIconSize)
      )
      if (lineWidth > 0 && lineWidth + tokenWidth > widthLimit) {
        lines += 1
        lineWidth = tokenWidth
      } else {
        lineWidth += tokenWidth
      }
    })

    return Math.max(1, lines)
  }

  type PreparedAbilityMetrics = {
    tokens: AbilityRenderToken[]
  }

  const buildPreparedAbilityMetrics = (abilities: AbilityEntry[]): PreparedAbilityMetrics[] => {
    return abilities
      .filter((ability) => !!ability?.text?.trim())
      .map((ability, index) => {
        const level = ability.level && ability.level >= 1 && ability.level <= 4 ? ability.level : index < 3 ? index + 2 : null
        const rawText = ability.text || ''
        const hasLeadingLevelToken = /^\s*\[(?:l)?[1-4]\]/i.test(rawText)
        const textWithLevel = level !== null && !hasLeadingLevelToken ? `[l${level}] ${rawText}` : rawText
        const normalizedText = normalizeForgebornAbilityText(textWithLevel)
        return {
          tokens: tokenizeAbilityRenderTokens(normalizedText, statIconMap, levelIconMap),
        }
      })
  }

  const primaryPreparedAbilityMetrics = buildPreparedAbilityMetrics(forgebornAbilities)
  const secondaryPreparedAbilityMetrics = hasSecondaryForgeborn
    ? buildPreparedAbilityMetrics(secondaryForgebornAbilities)
    : []

  const estimateAbilityListHeight = (
    preparedAbilities: PreparedAbilityMetrics[],
    fontSize: number,
    lineHeight: number,
    levelIconSize: number,
    maxWidth: number,
    gap: number
  ) => {
    if (preparedAbilities.length === 0) {
      return fontSize * lineHeight
    }
    const scaledLevelIconSize = levelIconSize * forgebornAbilityIconScale
    const scaledStatIconSize = 20 * forgebornAbilityIconScale
    const textWidth = Math.max(40, maxWidth - (showFusedColumns ? 2 : 6))
    const total = preparedAbilities.reduce((sum, preparedAbility) => {
      const lines = estimateAbilityLinesFromRenderTokens(
        preparedAbility.tokens,
        fontSize,
        textWidth,
        scaledLevelIconSize,
        scaledStatIconSize
      )
      const lineHeightPx = fontSize * lineHeight
      const iconLineHeight = Math.max(scaledLevelIconSize, scaledStatIconSize) * 1.02
      const lineBlockHeight = lines * Math.max(lineHeightPx, iconLineHeight) + fontSize * (showFusedColumns ? 0.2 : 0.16)
      const rowHeight = lineBlockHeight
      return sum + rowHeight
    }, 0)
    return total + (preparedAbilities.length - 1) * gap + fontSize * (showFusedColumns ? 0.1 : 0.08)
  }

  type ForgebornSpacing = {
    primaryGap: number
    secondaryGap: number
    secondaryTopMargin: number
    secondaryInnerGap: number
  }

  const defaultForgebornSpacing: ForgebornSpacing = {
    primaryGap: hasSecondaryForgeborn ? 6 : 8,
    secondaryGap: 6,
    secondaryTopMargin: 4,
    secondaryInnerGap: 6,
  }

  const estimateForgebornHeight = (
    scale: number,
    forgebornWidth: number,
    spacing: ForgebornSpacing = defaultForgebornSpacing
  ) => {
    const columnWidth = Math.max(
      40,
      forgebornWidth - (showFusedColumns ? 12 : 8)
    )
    const abilityFontSize = baseForgebornAbilityFont * primaryAbilityScale * scale
    const levelIconSize = Math.round(baseForgebornLevelIconSize * (hasSecondaryForgeborn ? 0.9 : 1) * scale)
    const primaryAbilityGap = spacing.primaryGap
    const primaryAbilityHeight = estimateAbilityListHeight(
      primaryPreparedAbilityMetrics,
      abilityFontSize,
      forgebornAbilityLineHeight,
      levelIconSize,
      columnWidth,
      primaryAbilityGap
    )
    let totalHeight = primaryAbilityHeight

    if (hasSecondaryForgeborn) {
      const secondaryAbilityFontSize = abilityFontSize * 0.85
      const secondaryLevelIconSize = Math.round(baseForgebornLevelIconSize * 0.8 * scale)
      const secondaryAbilityHeight = estimateAbilityListHeight(
        secondaryPreparedAbilityMetrics,
        secondaryAbilityFontSize,
        secondaryForgebornAbilityLineHeight,
        secondaryLevelIconSize,
        columnWidth,
        spacing.secondaryGap
      )
      totalHeight += spacing.secondaryTopMargin + 1 + spacing.secondaryInnerGap + secondaryAbilityHeight
    }

    return totalHeight + forgebornTopSafetyPx + forgebornBottomSafetyPx
  }

  const estimateForgebornWidthUsage = (scale: number, forgebornWidth: number) => {
    const primaryVisible = forgebornAbilities.filter((ability) => !!ability?.text?.trim())
    const secondaryVisible = hasSecondaryForgeborn
      ? secondaryForgebornAbilities.filter((ability) => !!ability?.text?.trim())
      : []
    const visible = [...primaryVisible, ...secondaryVisible]
    if (visible.length === 0) return 0
    const columnWidth = Math.max(40, forgebornWidth - 8)
    const abilityFontSize = baseForgebornAbilityFont * primaryAbilityScale * scale
    const levelIconSize = Math.round(baseForgebornLevelIconSize * (hasSecondaryForgeborn ? 0.9 : 1) * scale)
    const scaledLevelIconSize = levelIconSize * forgebornAbilityIconScale
    const textWidth = Math.max(40, columnWidth - scaledLevelIconSize - 16)
    let widest = 0
    visible.forEach((ability) => {
      widest = Math.max(widest, estimateTextWidth(ability.text || '', abilityFontSize))
    })
    return Math.max(0, Math.min(1, widest / Math.max(1, textWidth)))
  }

  const clamp = (value: number, min: number, max: number) => Math.min(max, Math.max(min, value))

  const getCardColumnComplexity = (column: CardColumn | undefined) => {
    if (!column || column.sections.length === 0) return 1
    let complexity = 0
    column.sections.forEach((section) => {
      const items = section.items || []
      complexity += 6 + items.length * 5
      items.forEach((item) => {
        const name = String(item?.name || '').trim()
        if (!name) return
        const tokens = name.split(/\s+/).filter(Boolean)
        const longestToken = tokens.reduce((maxLen, token) => Math.max(maxLen, token.length), 0)
        complexity += name.length * 1.35 + Math.max(0, longestToken - 10) * 3
      })
    })
    return Math.max(1, complexity)
  }

  const getAbilityComplexity = (abilities: AbilityEntry[]) => {
    const visible = abilities.filter((ability) => !!ability?.text?.trim())
    if (visible.length === 0) return 1
    let complexity = 0
    visible.forEach((ability) => {
      const text = String(ability.text || '').trim()
      const tokens = text.split(/\s+/).filter(Boolean)
      const longestToken = tokens.reduce((maxLen, token) => Math.max(maxLen, token.length), 0)
      complexity += text.length * 1.25 + tokens.length * 2 + Math.max(0, longestToken - 10) * 3.2
    })
    return Math.max(1, complexity)
  }

  const fitMinScale = 0.5
  const maxVisualScale = showFusedColumns ? 2.8 : 2.5
  const safeHeightBudget = innerHeight - (showFusedColumns ? 12 : 14)
  const cardFitBudget = safeHeightBudget * (showFusedColumns ? 0.996 : 0.998)
  const forgebornFitBudget = safeHeightBudget * (showFusedColumns ? 0.99 : 0.995)

  let fusedCardColumnFlexes: [number, number] = [...defaultFusedCardColumnFlexes]
  let fusedForgebornColumnFlex = defaultFusedForgebornColumnFlex
  let halfDeckCardColumnFlex = defaultHalfDeckCardColumnFlex
  let halfDeckForgebornColumnFlex = defaultHalfDeckForgebornColumnFlex

  if (showFusedColumns) {
    const baseFusedWidths = getFusedColumnWidths(defaultFusedCardColumnFlexes, defaultFusedForgebornColumnFlex)
    const cardComplexity1 = getCardColumnComplexity(cardColumns[0])
    const cardComplexity2 = getCardColumnComplexity(cardColumns[1])
    const cardsAverageComplexity = Math.max(1, (cardComplexity1 + cardComplexity2) / 2)
    const abilityComplexity =
      getAbilityComplexity(forgebornAbilities) +
      (hasSecondaryForgeborn ? getAbilityComplexity(secondaryForgebornAbilities) * 0.86 : 0)

    const cardWidthPressure1 = estimateCardColumnWidthUsage(cardColumns[0], 1, baseFusedWidths.cardColumnWidths[0])
    const cardWidthPressure2 = estimateCardColumnWidthUsage(cardColumns[1], 1, baseFusedWidths.cardColumnWidths[1])
    const forgebornWidthPressure = estimateForgebornWidthUsage(1, baseFusedWidths.forgebornColumnWidth)

    const complexityDelta1 = clamp((cardComplexity1 - cardsAverageComplexity) / cardsAverageComplexity, -0.3, 0.3)
    const complexityDelta2 = clamp((cardComplexity2 - cardsAverageComplexity) / cardsAverageComplexity, -0.3, 0.3)
    const pressureDelta1 = clamp(cardWidthPressure1 - 0.9, -0.2, 0.2)
    const pressureDelta2 = clamp(cardWidthPressure2 - 0.9, -0.2, 0.2)
    const forgebornComplexityRatio =
      abilityComplexity / Math.max(1, abilityComplexity + cardsAverageComplexity * 1.75)
    const forgebornPressureDelta = clamp(forgebornWidthPressure - 0.85, -0.2, 0.2)

    fusedCardColumnFlexes = [
      Math.round(
        clamp(defaultFusedCardColumnFlexes[0] * (1 + complexityDelta1 * 0.25 + pressureDelta1 * 0.2), 0.82, 1.32) * 1000
      ) / 1000,
      Math.round(
        clamp(defaultFusedCardColumnFlexes[1] * (1 + complexityDelta2 * 0.25 + pressureDelta2 * 0.2), 0.82, 1.32) * 1000
      ) / 1000,
    ]
    fusedForgebornColumnFlex =
      Math.round(
        clamp(
          defaultFusedForgebornColumnFlex * (0.9 + forgebornComplexityRatio * 0.3 + forgebornPressureDelta * 0.25),
          0.78,
          1.05
        ) * 1000
      ) / 1000
  } else {
    const baseHalfDeckWidths = getHalfDeckColumnWidths(defaultHalfDeckCardColumnFlex, defaultHalfDeckForgebornColumnFlex)
    const cardComplexity = getCardColumnComplexity(cardColumns[0])
    const forgebornComplexity =
      getAbilityComplexity(forgebornAbilities) +
      (hasSecondaryForgeborn ? getAbilityComplexity(secondaryForgebornAbilities) * 0.9 : 0)
    const cardComplexityRatio = cardComplexity / Math.max(1, cardComplexity + forgebornComplexity)
    const cardWidthPressure = estimateCardColumnWidthUsage(cardColumns[0], 1, baseHalfDeckWidths.cardColumnWidth)
    const forgebornWidthPressure = estimateForgebornWidthUsage(1, baseHalfDeckWidths.forgebornColumnWidth)
    const pressureBias = clamp(cardWidthPressure - forgebornWidthPressure, -0.35, 0.35)
    const cardShare = clamp(0.49 + (cardComplexityRatio - 0.5) * 0.22 + pressureBias * 0.08, 0.42, 0.57)

    halfDeckCardColumnFlex = Math.round(cardShare * 1000) / 1000
    halfDeckForgebornColumnFlex = Math.round((1 - cardShare) * 1000) / 1000
  }

  const fusedWidths = getFusedColumnWidths(fusedCardColumnFlexes, fusedForgebornColumnFlex)
  const halfDeckWidths = getHalfDeckColumnWidths(halfDeckCardColumnFlex, halfDeckForgebornColumnFlex)
  const selectedCardColumnWidths: [number, number] = showFusedColumns
    ? fusedWidths.cardColumnWidths
    : [halfDeckWidths.cardColumnWidth, halfDeckWidths.cardColumnWidth]
  const selectedSingleCardColumnWidth = halfDeckWidths.cardColumnWidth
  const selectedForgebornColumnWidth = showFusedColumns ? fusedWidths.forgebornColumnWidth : halfDeckWidths.forgebornColumnWidth

  const getCardColumnSpacing = (column: CardColumn | undefined, scale: number, columnWidth: number) => {
    const defaults = { sectionGap: showFusedColumns ? 7 : 8, listGap: showFusedColumns ? 3 : 4 }
    if (!column || column.sections.length === 0) return defaults

    const estimatedDefault = estimateCardColumnHeight(column, scale, columnWidth, defaults)
    const targetHeight = safeHeightBudget * 0.998
    const extraHeight = targetHeight - estimatedDefault
    if (extraHeight <= 2) return defaults

    const listSlots = column.sections.reduce((sum, section) => sum + Math.max(0, (section.items?.length || 0) - 1), 0)
    const sectionSlots = Math.max(0, column.sections.length - 1)
    const weightedSlots = listSlots + sectionSlots * 0.62
    if (weightedSlots <= 0) return defaults

    const add = Math.min(showFusedColumns ? 18 : 24, extraHeight / weightedSlots)
    const candidate = {
      sectionGap: defaults.sectionGap + add * 0.62,
      listGap: defaults.listGap + add,
    }
    const estimatedCandidate = estimateCardColumnHeight(column, scale, columnWidth, candidate)
    if (estimatedCandidate <= safeHeightBudget) return candidate

    const safeHeadroom = Math.max(0, safeHeightBudget - estimatedDefault)
    const candidateDelta = Math.max(0.0001, estimatedCandidate - estimatedDefault)
    const ratio = clamp(safeHeadroom / candidateDelta, 0, 1)
    return {
      sectionGap: defaults.sectionGap + (candidate.sectionGap - defaults.sectionGap) * ratio,
      listGap: defaults.listGap + (candidate.listGap - defaults.listGap) * ratio,
    }
  }

  const getForgebornSpacing = (scale: number, forgebornWidth: number): ForgebornSpacing => {
    const defaults = defaultForgebornSpacing
    const estimatedDefault = estimateForgebornHeight(scale, forgebornWidth, defaults)
    const targetHeight = safeHeightBudget * 0.998
    const extraHeight = targetHeight - estimatedDefault
    if (extraHeight <= 2) return defaults

    const primarySlots = Math.max(0, primaryPreparedAbilityMetrics.length - 1)
    const secondarySlots = hasSecondaryForgeborn ? Math.max(0, secondaryPreparedAbilityMetrics.length - 1) : 0
    const bridgeSlots = hasSecondaryForgeborn ? 2 : 0
    const totalSlots = primarySlots + secondarySlots + bridgeSlots
    if (totalSlots <= 0) return defaults

    const add = Math.min(showFusedColumns ? 12 : 18, extraHeight / totalSlots)
    const candidate = {
      primaryGap: defaults.primaryGap + add,
      secondaryGap: defaults.secondaryGap + add * 0.8,
      secondaryTopMargin: defaults.secondaryTopMargin + add * 0.55,
      secondaryInnerGap: defaults.secondaryInnerGap + add * 0.65,
    }
    const estimatedCandidate = estimateForgebornHeight(scale, forgebornWidth, candidate)
    if (estimatedCandidate <= safeHeightBudget) return candidate

    const safeHeadroom = Math.max(0, safeHeightBudget - estimatedDefault)
    const candidateDelta = Math.max(0.0001, estimatedCandidate - estimatedDefault)
    const ratio = clamp(safeHeadroom / candidateDelta, 0, 1)
    return {
      primaryGap: defaults.primaryGap + (candidate.primaryGap - defaults.primaryGap) * ratio,
      secondaryGap: defaults.secondaryGap + (candidate.secondaryGap - defaults.secondaryGap) * ratio,
      secondaryTopMargin: defaults.secondaryTopMargin + (candidate.secondaryTopMargin - defaults.secondaryTopMargin) * ratio,
      secondaryInnerGap: defaults.secondaryInnerGap + (candidate.secondaryInnerGap - defaults.secondaryInnerGap) * ratio,
    }
  }

  const solveCardScale = (
    column: CardColumn | undefined,
    columnWidth: number,
    spacing: { sectionGap: number; listGap: number }
  ) =>
    fitScale(fitMinScale, maxVisualScale, (scale) =>
      estimateCardColumnHeight(column, scale, Math.max(40, columnWidth - 6), spacing) <= cardFitBudget
    )

  const solveForgebornScale = (forgebornWidth: number, spacing: ForgebornSpacing) =>
    fitScale(fitMinScale, maxVisualScale, (scale) =>
      estimateForgebornHeight(scale, Math.max(40, forgebornWidth - (showFusedColumns ? 18 : 24)), spacing) <=
      forgebornFitBudget
    )

  let cardColumnScales: number[] = showFusedColumns ? [1, 1] : [1]
  let forgebornColumnScale = 1
  let cardColumnSpacings = showFusedColumns
    ? [
        { sectionGap: showFusedColumns ? 7 : 8, listGap: showFusedColumns ? 3 : 4 },
        { sectionGap: showFusedColumns ? 7 : 8, listGap: showFusedColumns ? 3 : 4 },
      ]
    : [{ sectionGap: showFusedColumns ? 7 : 8, listGap: showFusedColumns ? 3 : 4 }]
  let forgebornSpacing = defaultForgebornSpacing

  if (showFusedColumns) {
    cardColumnScales = [
      solveCardScale(cardColumns[0], selectedCardColumnWidths[0], cardColumnSpacings[0]),
      solveCardScale(cardColumns[1], selectedCardColumnWidths[1], cardColumnSpacings[1]),
    ]
    forgebornColumnScale = solveForgebornScale(selectedForgebornColumnWidth, forgebornSpacing)
    cardColumnSpacings = [
      getCardColumnSpacing(cardColumns[0], cardColumnScales[0], selectedCardColumnWidths[0]),
      getCardColumnSpacing(cardColumns[1], cardColumnScales[1], selectedCardColumnWidths[1]),
    ]
    forgebornSpacing = getForgebornSpacing(forgebornColumnScale, selectedForgebornColumnWidth)
    cardColumnScales = [
      solveCardScale(cardColumns[0], selectedCardColumnWidths[0], cardColumnSpacings[0]),
      solveCardScale(cardColumns[1], selectedCardColumnWidths[1], cardColumnSpacings[1]),
    ]
    forgebornColumnScale = solveForgebornScale(selectedForgebornColumnWidth, forgebornSpacing)
  } else {
    cardColumnScales = [solveCardScale(cardColumns[0], selectedSingleCardColumnWidth, cardColumnSpacings[0])]
    forgebornColumnScale = solveForgebornScale(selectedForgebornColumnWidth, forgebornSpacing)
    cardColumnSpacings = [getCardColumnSpacing(cardColumns[0], cardColumnScales[0], selectedSingleCardColumnWidth)]
    forgebornSpacing = getForgebornSpacing(forgebornColumnScale, selectedForgebornColumnWidth)
    cardColumnScales = [solveCardScale(cardColumns[0], selectedSingleCardColumnWidth, cardColumnSpacings[0])]
    forgebornColumnScale = solveForgebornScale(selectedForgebornColumnWidth, forgebornSpacing)
  }

  const cardRenderScaleFactors: number[] = showFusedColumns ? [1, 1] : [1]
  const forgebornRenderScale = 1

  const forgebornAbilityFont =
    Math.round(baseForgebornAbilityFont * primaryAbilityScale * forgebornColumnScale * forgebornRenderScale * 10) / 10
  const forgebornLevelIconSize = `${Math.round(
    baseForgebornLevelIconSize * (hasSecondaryForgeborn ? 0.9 : 1) * forgebornColumnScale * forgebornRenderScale
  )}px`
  const secondaryForgebornAbilityFont = Math.round(forgebornAbilityFont * 0.85 * 10) / 10
  const secondaryForgebornLevelIconSize = `${Math.round(
    baseForgebornLevelIconSize * 0.8 * forgebornColumnScale * forgebornRenderScale
  )}px`

  const renderAbilityList = (
    abilities: AbilityEntry[],
    options: { fontSize: number; lineHeight: number; levelIconSize: string; gap?: string }
  ) => {
    const visibleAbilities = abilities.filter((ability) => !!ability?.text?.trim())
    return (
      <div
        style={{
          display: 'flex',
          flexDirection: 'column',
          gap: options.gap ?? '8px',
          fontSize: options.fontSize,
          lineHeight: options.lineHeight,
          fontWeight: ogBodyTextWeight,
          width: '100%',
        }}
      >
        {visibleAbilities.length > 0 ? (
          visibleAbilities.map((ability, idx) => {
            const level =
              ability.level && ability.level >= 1 && ability.level <= 4 ? ability.level : idx < 3 ? idx + 2 : null
            const rawText = ability.text || ''
            const hasLeadingLevelToken = /^\s*\[(?:l)?[1-4]\]/i.test(rawText)
            const textWithLevel =
              level !== null && !hasLeadingLevelToken ? `[l${level}] ${rawText}` : rawText
            const parsedLevelIconSize = Number.parseFloat(options.levelIconSize)
            return (
              <div
                key={`ability-${idx}`}
                style={{
                  display: 'flex',
                  width: '100%',
                  minWidth: 0,
                  maxWidth: '100%',
                }}
              >
                {renderAbilityText(textWithLevel, statIconMap, levelIconMap, {
                  inline: true,
                  levelIconSize: Number.isFinite(parsedLevelIconSize) ? parsedLevelIconSize : 18,
                  iconScale: forgebornAbilityIconScale,
                })}
              </div>
            )
          })
        ) : (
          <div style={{ color: '#94a3b8', fontSize: options.fontSize }}>Abilities unavailable</div>
        )}
      </div>
    )
  }

  const renderForgebornBlock = () => (
    <div
      style={{
        display: 'flex',
        flexDirection: 'column',
        gap: '6px',
        color: '#f8fafc',
        fontFamily: 'system-ui, -apple-system, Segoe UI, sans-serif',
        fontWeight: ogBodyTextWeight,
        minWidth: 0,
        width: '100%',
        flex: 1,
        boxSizing: 'border-box',
        paddingTop: `${forgebornTopSafetyPx}px`,
        paddingBottom: `${forgebornBottomSafetyPx}px`,
        paddingRight: showFusedColumns ? '6px' : '0',
      }}
    >
      {renderAbilityList(forgebornAbilities, {
        fontSize: forgebornAbilityFont,
        lineHeight: forgebornAbilityLineHeight,
        levelIconSize: forgebornLevelIconSize,
        gap: `${forgebornSpacing.primaryGap}px`,
      })}
      {hasSecondaryForgeborn ? (
        <div
          style={{
            display: 'flex',
            flexDirection: 'column',
            gap: `${forgebornSpacing.secondaryInnerGap}px`,
            marginTop: `${forgebornSpacing.secondaryTopMargin}px`,
          }}
        >
          <div style={{ height: '1px', backgroundColor: '#1f2937', opacity: 0.85 }} />
          {renderAbilityList(secondaryForgebornAbilities, {
            fontSize: secondaryForgebornAbilityFont,
            lineHeight: secondaryForgebornAbilityLineHeight,
            levelIconSize: secondaryForgebornLevelIconSize,
            gap: `${forgebornSpacing.secondaryGap}px`,
          })}
        </div>
      ) : null}
    </div>
  )

  const renderCardColumn = (
    column: (typeof cardColumns)[number] | undefined,
    columnIndex: number,
    columnScale = 1,
    spacing: { sectionGap: number; listGap: number } = { sectionGap: 8, listGap: 4 }
  ) => {
    const columnRenderScaleFactor = cardRenderScaleFactors[columnIndex] ?? (showFusedColumns ? 0.972 : 0.965)
    const renderScale = columnScale * columnRenderScaleFactor
    return (
    <div
      key={`column-${columnIndex}`}
      style={{
        display: 'flex',
        flexDirection: 'column',
        gap: `${spacing.sectionGap}px`,
        flex: 1,
        minWidth: 0,
        color: '#e2e8f0',
        fontFamily: 'system-ui, -apple-system, Segoe UI, sans-serif',
      }}
    >
      {column && column.sections.length > 0 ? (
        column.sections.map((section) => (
          <div
            key={`${columnIndex}-${section.label}`}
            style={{
              display: 'flex',
              flexDirection: 'column',
              gap: '4px',
            }}
          >
            {shouldShowSectionLabel(section.label) ? (
              <span
                style={{
                  color: '#94a3b8',
                  fontSize: Math.round(baseLabelFontSize * columnScale * 10) / 10,
                  fontWeight: 700,
                  letterSpacing: '0.04em',
                  textTransform: 'uppercase',
                  whiteSpace: 'nowrap',
                }}
              >
                {section.label}
              </span>
            ) : null}
            <div
              style={{
                display: 'flex',
                flexDirection: 'column',
                gap: `${spacing.listGap}px`,
                fontSize: Math.round(baseCardFontSize * renderScale * 10) / 10,
                lineHeight: cardRowLineHeight,
                fontWeight: ogBodyTextWeight,
              }}
            >
              {section.items.map((item, idx) => {
                const itemFontSize = Math.round(baseCardFontSize * renderScale * 10) / 10
                const rarityIconSrc = item.rarityIconPath
                  ? cardIconMap.get(item.rarityIconPath) || resolveAssetUrl(item.rarityIconPath)
                  : null
                const rarityIconSizePx = itemFontSize
                const rarityIconSize = `${rarityIconSizePx}px`
                return (
                  <div
                    key={`${columnIndex}-${section.label}-${idx}`}
                    style={{
                      display: 'flex',
                      alignItems: 'center',
                      gap: '6px',
                      width: '100%',
                      minWidth: 0,
                    }}
                  >
                    {rarityIconSrc ? (
                      <img
                        src={rarityIconSrc}
                        style={{
                          width: rarityIconSize,
                          height: rarityIconSize,
                          objectFit: 'contain',
                          alignSelf: 'center',
                          flexShrink: 0,
                        }}
                      />
                    ) : (
                      <span
                        style={{
                          width: rarityIconSize,
                          height: rarityIconSize,
                          borderRadius: '999px',
                          backgroundColor: item.factionColor,
                          opacity: 0.8,
                          alignSelf: 'center',
                          flexShrink: 0,
                        }}
                      />
                    )}
                    <span
                      style={{
                        display: 'block',
                        flex: 1,
                        minWidth: 0,
                        maxWidth: '100%',
                        whiteSpace: 'normal',
                        wordBreak: 'break-word',
                        overflowWrap: 'break-word',
                        lineHeight: cardRowLineHeight,
                        color: item.factionTextColor,
                      }}
                    >
                      {item.name}
                    </span>
                  </div>
                )
              })}
            </div>
          </div>
        ))
      ) : (
        <div style={{ color: '#94a3b8', fontSize: Math.round(baseNoCardsFontSize * columnScale * 10) / 10 }}>
          No cards available
        </div>
      )}
    </div>
    )
  }

  pushTiming('layout.solve', layoutSolveStartMs)
  const imageResponse = await measureStage('image.response.create', () =>
    new ImageResponse(
      (
        <div
          style={{
            width: `${imageWidth}px`,
            height: `${imageHeight}px`,
            boxSizing: 'border-box',
            display: 'flex',
            flexDirection: 'column',
            alignItems: 'stretch',
            gap: '8px',
            padding: `${containerPaddingY}px ${containerPaddingX}px`,
            backgroundColor: '#0f172a',
          }}
        >
          {showFusedColumns ? (
            <div
              style={{
                display: 'flex',
                flexDirection: 'row',
                alignItems: 'stretch',
                gap: `${halfDeckColumnGap}px`,
                width: '100%',
                height: '100%',
                minHeight: 0,
              }}
            >
              <div style={{ display: 'flex', flex: fusedCardColumnFlexes[0], minWidth: 0 }}>
                {renderCardColumn(cardColumns[0], 0, cardColumnScales[0], cardColumnSpacings[0])}
              </div>
              <div style={{ display: 'flex', flex: fusedCardColumnFlexes[1], minWidth: 0 }}>
                {renderCardColumn(cardColumns[1], 1, cardColumnScales[1], cardColumnSpacings[1])}
              </div>
              <div
                style={{
                  display: 'flex',
                  flexDirection: 'column',
                  alignItems: 'stretch',
                  flex: fusedForgebornColumnFlex,
                  minWidth: 0,
                  overflow: 'hidden',
                }}
              >
                {renderForgebornBlock()}
              </div>
            </div>
          ) : (
            <div
              style={{
                display: 'flex',
                flexDirection: 'row',
                alignItems: 'stretch',
                gap: `${fusedColumnGap}px`,
                width: '100%',
                height: '100%',
                minHeight: 0,
              }}
            >
              <div style={{ display: 'flex', flex: halfDeckCardColumnFlex, minWidth: 0 }}>
                {hasCardSections ? (
                  renderCardColumn(cardColumns[0], 0, cardColumnScales[0], cardColumnSpacings[0])
                ) : (
                  <div style={{ color: '#94a3b8', fontSize: baseNoCardsFontSize }}>No cards available</div>
                )}
              </div>
              <div
                style={{
                  display: 'flex',
                  flexDirection: 'column',
                  alignItems: 'stretch',
                  flex: halfDeckForgebornColumnFlex,
                  minWidth: 0,
                  overflow: 'hidden',
                }}
              >
                {renderForgebornBlock()}
              </div>
            </div>
          )}
        </div>
      ),
      {
        width: imageWidth,
        height: imageHeight,
        headers: {
          'Cache-Control':
            hasCardSections && forgebornAbilities.some((ability) => !!ability?.text?.trim())
              ? 'public, max-age=60, s-maxage=3600, stale-while-revalidate=86400'
              : 'no-store, max-age=0',
        },
      }
    )
  )
  const imageBuffer = await measureStage('image.png.render', () => imageResponse.arrayBuffer())
  const imageBytes = new Uint8Array(imageBuffer)
  await measureStage('cache.memory.set', () => setCachedOgImage(imageCacheKey, imageBytes))
  if (isOgUpstashCacheConfigured() && hasRenderableCards && hasRenderableAbilities) {
    void measureStage('cache.upstash.set', () =>
      putOgImageToUpstashCache(deckId, imageBytes, {
        ttlSeconds: OG_UPSTASH_IMAGE_TTL_SECONDS,
        version: OG_IMAGE_VERSION,
      }).catch(() => {
        // Best-effort write; ignore cache upload errors.
      })
    )
  }

  const timing = finalizeTiming('generated')
  return new Response(imageBuffer, {
    headers: {
      'Content-Type': 'image/png',
      'Cache-Control':
        hasRenderableCards && hasRenderableAbilities
          ? 'public, max-age=60, s-maxage=3600, stale-while-revalidate=86400'
          : 'no-store, max-age=0',
      ...timing.headers,
    },
  })
}
