import { ImageResponse } from 'next/og'
import { readFile } from 'node:fs/promises'
import path from 'node:path'
import type { NextRequest } from 'next/server'
import type { ReactNode } from 'react'
import { getOgImageFromUpstashCache, isOgUpstashCacheConfigured, putOgImageToUpstashCache } from '@/lib/ogUpstashCache'

export const runtime = 'nodejs'

const API_BASE_URL = 'https://ul51g2rg42.execute-api.us-east-1.amazonaws.com/main'
const OG_DECK_TIMEOUT_MS = 1200
const OG_SOURCE_DECK_TIMEOUT_MS = 2200
const OG_ICON_TIMEOUT_MS = 500
const OG_UPSTASH_IMAGE_TTL_SECONDS = 24 * 60 * 60
const OG_PAYLOAD_TTL_MS = 24 * 60 * 60 * 1000
const OG_ICON_CACHE_TTL_MS = 24 * 60 * 60 * 1000
const OG_PAYLOAD_CACHE_MAX_ENTRIES = 500
const OG_ICON_CACHE_MAX_ENTRIES = 500

type OgPayload = {
  cardColumns: CardColumn[]
  forgebornName: string | null
  forgebornFaction: string | null
  deckName: string | null
  forgebornAbilities: AbilityEntry[]
}

type OgPayloadCacheEntry = {
  expiresAt: number
  payload: OgPayload
}

type IconSrcCacheEntry = {
  expiresAt: number
  src: string | null
}

const ogPayloadCache = new Map<string, OgPayloadCacheEntry>()
const ogPayloadInFlight = new Map<string, Promise<OgPayload>>()
const iconSrcCache = new Map<string, IconSrcCacheEntry>()
const iconSrcInFlight = new Map<string, Promise<string | null>>()
const localAssetDataCache = new Map<string, string>()

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

const normalizeOgPayloadKey = (deckId: string) => stripDeckPrefixes(deckId).trim().toLowerCase()

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

const getDeckFromUpstream = async (deckId: string) => {
  const baseId = stripDeckPrefixes(deckId)
  const regularCandidates = Array.from(new Set([baseId, deckId].filter(Boolean)))

  for (const candidate of regularCandidates) {
    const url = `${API_BASE_URL}/deck/${encodeURIComponent(stripDeckPrefixes(candidate))}?inclCards=true&inclUsers=true`
    const response = await fetchWithTimeout(
      url,
      {
        method: 'GET',
        headers: { Accept: 'application/json' },
        cache: 'force-cache',
        next: { revalidate: 300 },
      },
      OG_DECK_TIMEOUT_MS
    )
    if (!response?.ok) continue
    const raw = await withTimeout(response.json().catch(() => null), OG_DECK_TIMEOUT_MS, null)
    if (!raw) continue
    const rawId = raw?.id || raw?.deckId || raw?.deck_id
    if (!rawId) continue
    const cards =
      Array.isArray(raw?.cards) && raw.cards.length > 0
        ? raw.cards
        : Array.isArray(raw?.cardList) && raw.cardList.length > 0
          ? raw.cardList
          : []
    return {
      ...raw,
      cards,
      forgeborn: raw?.forgeborn || null,
      forgebornId: raw?.forgebornId || raw?.forgeborn?.id || null,
    }
  }

  const fusedCandidates = Array.from(new Set([toFusedApiId(deckId), `Fused_${baseId}`].filter(Boolean)))
  for (const fusedCandidate of fusedCandidates) {
    const url = `${API_BASE_URL}/fuseddeck/${encodeURIComponent(fusedCandidate)}?inclCards=true&inclUsers=true`
    const response = await fetchWithTimeout(
      url,
      {
        method: 'GET',
        headers: { Accept: 'application/json' },
        cache: 'force-cache',
        next: { revalidate: 300 },
      },
      OG_DECK_TIMEOUT_MS
    )
    if (!response?.ok) continue
    const raw = await withTimeout(response.json().catch(() => null), OG_DECK_TIMEOUT_MS, null)
    if (!raw) continue
    const rawId = raw?.id || raw?.deckId || raw?.deck_id
    if (!rawId) continue

    const sourceDecksRaw =
      (Array.isArray(raw?.myDecks) && raw.myDecks) ||
      (Array.isArray(raw?.decks) && raw.decks) ||
      []
    const sourceDecks = await Promise.all(
      sourceDecksRaw.map(async (source: any) => {
        const sourceId = source?.id || source?.deckId || source?.deck_id
        if (!sourceId) return source

        const detailUrl = `${API_BASE_URL}/deck/${encodeURIComponent(stripDeckPrefixes(String(sourceId)))}?inclCards=true&inclUsers=true`
        const detailRes = await fetchWithTimeout(
          detailUrl,
          {
            method: 'GET',
            headers: { Accept: 'application/json' },
            cache: 'force-cache',
            next: { revalidate: 300 },
          },
          OG_SOURCE_DECK_TIMEOUT_MS
        )
        if (!detailRes?.ok) return source
        const detailRaw = await withTimeout(detailRes.json().catch(() => null), OG_SOURCE_DECK_TIMEOUT_MS, null)
        if (!detailRaw || typeof detailRaw !== 'object') return source

        return {
          ...source,
          // Prefer source fields when present, but fill missing metadata from half-deck detail.
          cardSetNo: source?.cardSetNo ?? detailRaw?.cardSetNo ?? null,
          cardSetName: source?.cardSetName ?? detailRaw?.cardSetName ?? null,
          deckScore: source?.deckScore ?? detailRaw?.deckScore ?? detailRaw?.score ?? null,
          elo: source?.elo ?? detailRaw?.elo ?? null,
          cards:
            (Array.isArray(source?.cards) && source.cards.length > 0 && source.cards) ||
            (Array.isArray(detailRaw?.cards) && detailRaw.cards.length > 0 && detailRaw.cards) ||
            source?.cards ||
            [],
        }
      })
    )
    const extractCards = (deckLike: any): any[] => {
      if (!deckLike) return []
      if (Array.isArray(deckLike.cardList) && deckLike.cardList.length > 0) return deckLike.cardList
      if (Array.isArray(deckLike.cards) && deckLike.cards.length > 0) return deckLike.cards
      if (Array.isArray(deckLike.cardIds) && deckLike.cardIds.length > 0) return deckLike.cardIds
      return []
    }
    const mergedCardsFromSources = sourceDecks.flatMap(extractCards).filter(Boolean)
    const fusedCards =
      Array.isArray(raw?.cardList) && raw.cardList.length > 0
        ? raw.cardList
        : Array.isArray(raw?.cards) && raw.cards.length > 0
          ? raw.cards
          : []
    const cards = mergedCardsFromSources.length > 0 ? mergedCardsFromSources : fusedCards

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

const buildOgPayload = (deck: any): OgPayload => ({
  cardColumns: buildCardColumns(deck),
  forgebornName: resolveForgebornName(deck),
  forgebornFaction: resolveForgebornFaction(deck),
  deckName: typeof deck?.name === 'string' && deck.name.trim() ? deck.name.trim() : null,
  forgebornAbilities: collectForgebornAbilities(deck).slice(0, 3),
})

const getOgPayload = async (deckId: string, options?: { forceRefresh?: boolean }): Promise<OgPayload> => {
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
    const deck = await getDeckFromUpstream(deckId)
    const payload = deck
      ? buildOgPayload(deck)
      : { cardColumns: [], forgebornName: null, forgebornFaction: null, deckName: null, forgebornAbilities: [] }
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

const normalizeForgebornAbilityText = (value: string) =>
  value
    .replace(/\[(?:l)?[1-4]\]/gi, '')
    .replace(/([^\s])([+-])(?=\d)/g, '$1 $2')
    .replace(/([.!?])([A-Za-z])/g, '$1 $2')
    .replace(/\s+/g, ' ')
    .trim()

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

const renderAbilityText = (
  text: string,
  statIconMap: Map<string, string | null>,
  _levelIconMap: Map<number, string | null>
) => {
  const normalizedText = normalizeForgebornAbilityText(String(text || ''))
  if (!normalizedText) return null
  const parts: Array<
    | { type: 'text'; value: string }
    | { type: 'stat'; src: string; number: string }
  > = []
  const pattern = /([+-]?\d+)\s*([ADH])/gi
  let lastIndex = 0
  let match: RegExpExecArray | null

  while ((match = pattern.exec(normalizedText)) !== null) {
    const [full, numberValue, statValue] = match
    const start = match.index
    if (start > lastIndex) {
      parts.push({ type: 'text', value: normalizedText.slice(lastIndex, start) })
    }
    const number = numberValue || ''
    const stat = (statValue || '').toUpperCase()
    const iconSrc = statIconMap.get(stat) || null
    if (!iconSrc || !number) {
      parts.push({ type: 'text', value: full })
    } else {
      parts.push({ type: 'stat', src: iconSrc, number })
    }
    lastIndex = start + full.length
  }

  if (lastIndex < normalizedText.length) {
    parts.push({ type: 'text', value: normalizedText.slice(lastIndex) })
  }

  return (
    <div style={{ display: 'flex', flexWrap: 'wrap', alignItems: 'flex-start', width: '100%', minWidth: 0, maxWidth: '100%' }}>
      {parts.map((part, idx) => {
        if (part.type === 'text') {
          return (
            <span key={`text-${idx}`} style={{ whiteSpace: 'pre-wrap', wordBreak: 'break-word' }}>
              {part.value}
            </span>
          )
        }
        return (
          <div key={`stat-${idx}`} style={{ display: 'flex', alignItems: 'center', marginRight: '4px' }}>
            <span>{part.number}</span>
            <img
              src={part.src}
              style={{
                width: '20px',
                height: '20px',
                objectFit: 'contain',
                marginLeft: '2px',
                transform: 'translateY(1px)',
              }}
            />
          </div>
        )
      })}
    </div>
  )
}

const resolveForgebornName = (deck: any) => {
  const forgeborn = deck?.forgeborn
  const named =
    forgeborn?.name ||
    forgeborn?.Name ||
    forgeborn?.title ||
    forgeborn?.cardName ||
    null
  if (named) return String(named).trim()
  const fallback = deck?.forgebornName || deck?.forgebornId || forgeborn?.id || null
  if (!fallback) return null
  return toTitleCase(String(fallback).replace(/[_-]+/g, ' ').trim())
}

const resolveForgebornFaction = (deck: any): string | null => {
  const forgeborn = deck?.forgeborn
  const direct =
    forgeborn?.faction ||
    forgeborn?.Faction ||
    deck?.faction ||
    deck?.Faction ||
    null
  if (typeof direct === 'string' && direct.trim()) {
    return direct.trim()
  }

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

const collectForgebornAbilities = (deck: any) => {
  const forgeborn = deck?.forgeborn
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

export async function GET(
  request: NextRequest,
  context: { params: Promise<{ id?: string }> }
) {
  const { id } = await context.params
  const deckId = id || ''
  const forceRefresh = request.nextUrl.searchParams.get('refresh') === '1'
  const origin = new URL(request.url).origin

  if (!forceRefresh && isOgUpstashCacheConfigured()) {
    const cachedImage = await getOgImageFromUpstashCache(deckId)
    if (cachedImage) {
      const cachedBuffer = new ArrayBuffer(cachedImage.byteLength)
      new Uint8Array(cachedBuffer).set(cachedImage)
      return new Response(cachedBuffer, {
        headers: {
          'Content-Type': 'image/png',
          'Cache-Control': 'public, max-age=60, s-maxage=3600, stale-while-revalidate=86400',
          'X-OG-Cache': 'upstash-hit',
        },
      })
    }
  }

  const payload = await getOgPayload(deckId, { forceRefresh })
  const cardColumns = payload.cardColumns
  const forgebornName = payload.forgebornName
  const forgebornTitleColor = getFactionTextColor(payload.forgebornFaction || undefined)
  const forgebornAbilities = payload.forgebornAbilities.map((ability, index) => ({
    ...ability,
    level: ability.level ?? (index < 3 ? index + 2 : null),
  }))

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
    if (!forceRefresh) {
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
    } else {
      iconSrcCache.delete(url)
    }

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
    const loaded = await Promise.all(cardIconPaths.map((path) => loadIconSrc(resolveAssetUrl(path))))
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
  forgebornAbilities.slice(0, 3).forEach((_, idx) => abilityLevels.add(idx + 2))
  const levelIconEntries = Array.from(abilityLevels)
    .sort((a, b) => a - b)
    .map((level) => ({ level, url: `${origin}/images/icons/levels/lv${level}-icon.png` }))
  const levelIconMap = new Map<number, string | null>()
  if (levelIconEntries.length > 0) {
    const loaded = await Promise.all(levelIconEntries.map((entry) => loadIconSrc(entry.url)))
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
    const loaded = await Promise.all(statIconEntries.map((entry) => loadIconSrc(entry.url)))
    loaded.forEach((src, idx) => {
      const entry = statIconEntries[idx]
      statIconMap.set(entry.key, src || null)
    })
  }
  const hasCardSections = cardColumns.some((column) => column.sections.length > 0)
  const showFusedColumns = cardColumns.length > 1
  const globalFontScale = 1.1
  const fusedFontScale = showFusedColumns ? 1.44 : 1
  const scaleFont = (size: number) => Math.round(size * fusedFontScale * globalFontScale * 10) / 10
  const forgebornTitleFont = showFusedColumns ? scaleFont(26) : scaleFont(40)
  const forgebornAbilityFont = showFusedColumns ? scaleFont(14) : scaleFont(20)
  const forgebornAbilityLineHeight = showFusedColumns ? 1.18 : 1.25
  const forgebornLevelIconSize = showFusedColumns ? '18px' : '20px'

  const renderForgebornBlock = () => (
    <div
      style={{
        display: 'flex',
        flexDirection: 'column',
        gap: '6px',
        color: '#e2e8f0',
        fontFamily: 'system-ui, -apple-system, Segoe UI, sans-serif',
        minWidth: 0,
        width: '100%',
        flex: 1,
        paddingRight: showFusedColumns ? '6px' : '0',
      }}
    >
      <div style={{ fontSize: forgebornTitleFont, fontWeight: 700, lineHeight: 1.1, color: forgebornTitleColor }}>
        {forgebornName || 'Forgeborn'}
      </div>
      <div
        style={{
          display: 'flex',
          flexDirection: 'column',
          gap: '8px',
          fontSize: forgebornAbilityFont,
          lineHeight: forgebornAbilityLineHeight,
          width: '100%',
        }}
      >
        {forgebornAbilities.length > 0 ? (
          forgebornAbilities.map((ability, idx) => {
            const level =
              ability.level && ability.level >= 1 && ability.level <= 4 ? ability.level : idx < 3 ? idx + 2 : null
            const levelIconSrc =
              level !== null ? levelIconMap.get(level) || resolveAssetUrl(`/images/icons/levels/lv${level}-icon.png`) : null
            return (
              <div key={`ability-${idx}`} style={{ display: 'flex', width: '100%', alignItems: 'flex-start', gap: '8px' }}>
                {levelIconSrc ? (
                  <img
                    src={levelIconSrc}
                    style={{
                      width: forgebornLevelIconSize,
                      height: forgebornLevelIconSize,
                      objectFit: 'contain',
                      transform: 'translateY(3px)',
                    }}
                  />
                ) : null}
                {ability.text ? (
                  <div
                    style={{
                      display: 'flex',
                      flex: 1,
                      minWidth: 0,
                      maxWidth: '100%',
                      overflow: 'hidden',
                    }}
                  >
                    {renderAbilityText(ability.text, statIconMap, levelIconMap)}
                  </div>
                ) : null}
              </div>
            )
          })
        ) : (
          <div style={{ color: '#94a3b8', fontSize: scaleFont(20) }}>Abilities unavailable</div>
        )}
      </div>
    </div>
  )

  const renderCardColumn = (column: (typeof cardColumns)[number] | undefined, columnIndex: number) => (
    <div
      key={`column-${columnIndex}`}
      style={{
        display: 'flex',
        flexDirection: 'column',
        gap: '8px',
        flex: 1,
        minWidth: 0,
        color: '#e2e8f0',
        fontFamily: 'system-ui, -apple-system, Segoe UI, sans-serif',
      }}
    >
      {showFusedColumns && column ? (
        <div style={{ display: 'flex', alignItems: 'center', gap: '6px', minWidth: 0 }}>
          {column.factionIconPath ? (
            <img
              src={cardIconMap.get(column.factionIconPath) || resolveAssetUrl(column.factionIconPath) || ''}
              style={{ width: '16px', height: '16px', objectFit: 'contain' }}
            />
          ) : null}
          <span
            style={{
              color: '#94a3b8',
              fontSize: scaleFont(13),
              fontWeight: 700,
              letterSpacing: '0.04em',
              textTransform: 'uppercase',
              whiteSpace: 'nowrap',
            }}
          >
            {[
              column.setLabel || 'Unknown Set',
              column.score !== null ? `Score ${column.score}` : null,
              column.elo !== null ? `ELO ${column.elo}` : null,
            ]
              .filter(Boolean)
              .join(' · ')}
          </span>
        </div>
      ) : null}
      {column && column.sections.length > 0 ? (
        column.sections.map((section) => (
          <div key={`${columnIndex}-${section.label}`} style={{ display: 'flex', flexDirection: 'column', gap: '4px' }}>
            <span
              style={{
                color: '#94a3b8',
                fontSize: scaleFont(12),
                fontWeight: 700,
                letterSpacing: '0.04em',
                textTransform: 'uppercase',
                whiteSpace: 'nowrap',
              }}
            >
              {section.label}
            </span>
            <div
              style={{
                display: 'flex',
                flexDirection: 'column',
                gap: '4px',
                fontSize: scaleFont(20),
                lineHeight: 1.15,
              }}
            >
              {section.items.map((item, idx) => {
                const rarityIconSrc = item.rarityIconPath
                  ? cardIconMap.get(item.rarityIconPath) || resolveAssetUrl(item.rarityIconPath)
                  : null
                return (
                  <div
                    key={`${columnIndex}-${section.label}-${idx}`}
                    style={{ display: 'flex', alignItems: 'center', gap: '6px', width: '100%', minWidth: 0 }}
                  >
                    {rarityIconSrc ? (
                      <img src={rarityIconSrc} style={{ width: '18px', height: '18px', objectFit: 'contain' }} />
                    ) : (
                      <span
                        style={{
                          width: '18px',
                          height: '18px',
                          borderRadius: '999px',
                          backgroundColor: item.factionColor,
                          opacity: 0.8,
                        }}
                      />
                    )}
                    <span
                      style={{
                        display: 'block',
                        whiteSpace: 'normal',
                        wordBreak: 'break-word',
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
        <div style={{ color: '#94a3b8', fontSize: scaleFont(18) }}>No cards available</div>
      )}
    </div>
  )

  const imageResponse = new ImageResponse(
    (
      <div
        style={{
          width: '1200px',
          height: '630px',
          display: 'flex',
          flexDirection: 'column',
          alignItems: 'stretch',
          gap: '8px',
          padding: '20px 24px',
          backgroundColor: '#0f172a',
        }}
      >
        {showFusedColumns ? (
          <div
            style={{
              display: 'flex',
              flexDirection: 'row',
              alignItems: 'stretch',
              gap: '18px',
              width: '100%',
              height: '100%',
              minHeight: 0,
            }}
          >
            <div style={{ display: 'flex', flex: 1.1, minWidth: 0 }}>
              {renderCardColumn(cardColumns[0], 0)}
            </div>
            <div style={{ display: 'flex', flex: 1.1, minWidth: 0 }}>
              {renderCardColumn(cardColumns[1], 1)}
            </div>
            <div
              style={{
                display: 'flex',
                flexDirection: 'column',
                alignItems: 'stretch',
                flex: 1.0,
                minWidth: 0,
                overflow: 'hidden',
              }}
            >
              {renderForgebornBlock()}
            </div>
          </div>
        ) : (
          <>
            {renderForgebornBlock()}
            <div
              style={{
                display: 'flex',
                alignItems: 'stretch',
                gap: '18px',
                flex: 1,
                minHeight: 0,
              }}
            >
              {hasCardSections ? renderCardColumn(cardColumns[0], 0) : <div style={{ color: '#94a3b8', fontSize: scaleFont(18) }}>No cards available</div>}
            </div>
          </>
        )}
      </div>
    ),
    {
      width: 1200,
      height: 630,
      headers: {
        'Cache-Control': 'public, max-age=60, s-maxage=3600, stale-while-revalidate=86400',
      },
    }
  )
  const imageBuffer = await imageResponse.arrayBuffer()
  if (isOgUpstashCacheConfigured()) {
    void putOgImageToUpstashCache(deckId, new Uint8Array(imageBuffer), {
      ttlSeconds: OG_UPSTASH_IMAGE_TTL_SECONDS,
    }).catch(() => {
      // Best-effort write; ignore cache upload errors.
    })
  }

  return new Response(imageBuffer, {
    headers: {
      'Content-Type': 'image/png',
      'Cache-Control': 'public, max-age=60, s-maxage=3600, stale-while-revalidate=86400',
    },
  })
}
