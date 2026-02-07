import type { Metadata } from 'next'
import { headers } from 'next/headers'
import DeckPageClient from './DeckPageClient'
import { fetchDeckDetails, normalizeDeck } from '@/lib/api'

export const dynamic = 'force-dynamic'

const DECK_PREVIEW_CACHE_TTL_MS = 24 * 60 * 60 * 1000
const DECK_PREVIEW_CACHE_MAX_ENTRIES = 500

type DeckPreviewCore = {
  title: string
  description: string
  imageAlt: string
}

type DeckPreviewCacheEntry = {
  expiresAt: number
  data: DeckPreviewCore
}

const deckPreviewCache = new Map<string, DeckPreviewCacheEntry>()
const deckPreviewInFlight = new Map<string, Promise<DeckPreviewCore | null>>()

const stripDeckPrefixes = (value: string) =>
  value
    .toString()
    .replace(/^deck[_-]?fused[_-]?/i, '')
    .replace(/^deck[_-]?/i, '')
    .replace(/^fused[_-]?/i, '')

const normalizeDeckPreviewKey = (deckId: string) => stripDeckPrefixes(deckId).trim().toLowerCase()

const trimLru = (cache: Map<string, DeckPreviewCacheEntry>, maxEntries: number) => {
  while (cache.size > maxEntries) {
    const oldest = cache.keys().next().value
    if (oldest === undefined) break
    cache.delete(oldest)
  }
}

const touchDeckPreviewCache = (key: string, entry: DeckPreviewCacheEntry) => {
  deckPreviewCache.delete(key)
  deckPreviewCache.set(key, entry)
}

const getCachedDeckPreview = (key: string): DeckPreviewCore | null => {
  const cached = deckPreviewCache.get(key)
  if (!cached) return null
  if (cached.expiresAt < Date.now()) {
    deckPreviewCache.delete(key)
    return null
  }
  touchDeckPreviewCache(key, cached)
  return cached.data
}

const setCachedDeckPreview = (key: string, data: DeckPreviewCore) => {
  touchDeckPreviewCache(key, {
    expiresAt: Date.now() + DECK_PREVIEW_CACHE_TTL_MS,
    data,
  })
  trimLru(deckPreviewCache, DECK_PREVIEW_CACHE_MAX_ENTRIES)
}

const buildCandidates = (rawId: string) => {
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

const resolveBaseUrl = async () => {
  const headersList = await headers()
  const host = headersList.get('host')
  if (!host) return null
  const proto = headersList.get('x-forwarded-proto') || 'http'
  return `${proto}://${host}`
}

const hasValue = (value: unknown) => {
  if (value === null || value === undefined) return false
  if (typeof value === 'string') return value.trim().length > 0
  if (Array.isArray(value)) return value.length > 0
  return true
}

const isFusedDeckLike = (deck: any) => {
  const format = String(deck?.format || deck?.gameFormat || '').toLowerCase()
  if (format === 'fused') return true
  const idCandidates = [deck?.id, deck?.deckId, deck?.deck_id]
    .filter(Boolean)
    .map((value) => String(value).toLowerCase())
  return idCandidates.some((value) => /^fused[_-]/.test(value) || value.includes('deck_fused'))
}

const normalizeSetLabel = (value: unknown): string | null => {
  if (!hasValue(value)) return null
  const normalized = String(value).trim().toUpperCase()
  if (!normalized) return null
  if (normalized === 'B1' || normalized === 'B2' || normalized === 'B3') return normalized
  if (/^\d+$/.test(normalized)) return `S${normalized}`
  if (/^S\d+$/.test(normalized)) return normalized
  if (/^B\d+$/.test(normalized)) return normalized
  return null
}

const inferSetFromCardId = (cardId: string): string | null => {
  if (!cardId) return null
  if (/^b3_/i.test(cardId)) return 'B3'
  if (/^b2_/i.test(cardId)) return 'B2'
  if (/^b1_/i.test(cardId)) return 'B1'
  const match = cardId.match(/^s(\d+)/i)
  if (match?.[1]) return `S${match[1]}`
  return null
}

const getSetLabel = (deckLike: any): string | null => {
  const fromDeck =
    normalizeSetLabel(deckLike?.cardSetNo ?? deckLike?.card_set_no) ||
    normalizeSetLabel(deckLike?.cardSetId ?? deckLike?.card_set_id)
  if (fromDeck) return fromDeck

  const cards =
    (Array.isArray(deckLike?.cards) && deckLike.cards) ||
    (Array.isArray(deckLike?.cardList) && deckLike.cardList) ||
    []
  for (const card of cards) {
    const fromCard =
      normalizeSetLabel(card?.cardSetNo ?? card?.card_set_no) ||
      normalizeSetLabel(card?.cardSetId ?? card?.card_set_id ?? card?.SK ?? card?.sk)
    if (fromCard) return fromCard
    const cardId = card?.id || card?.cardId || card?.card_id
    if (typeof cardId === 'string') {
      const fromCardId = inferSetFromCardId(cardId)
      if (fromCardId) return fromCardId
    }
  }
  return null
}

const getExpireLabel = (deckLike: any): string | null => {
  const raw =
    deckLike?.expireAt ??
    deckLike?.expire_at ??
    deckLike?.expireDate ??
    deckLike?.expire_date ??
    deckLike?.pExpiry ??
    deckLike?.expire ??
    deckLike?.expiry ??
    null
  if (!hasValue(raw)) return null
  const ts = Date.parse(String(raw))
  if (!Number.isFinite(ts)) return null
  return new Date(ts).toLocaleDateString('en-GB', {
    day: 'numeric',
    month: 'short',
    year: 'numeric',
    timeZone: 'UTC',
  })
}

const getRoundedScore = (deckLike: any): number | null => {
  const raw = deckLike?.deckScore ?? deckLike?.score ?? deckLike?.scoreValue ?? deckLike?.sffScore ?? null
  const numeric = typeof raw === 'number' ? raw : Number(raw)
  if (!Number.isFinite(numeric)) return null
  return Math.round(numeric * 100)
}

const getRoundedElo = (deckLike: any): number | null => {
  const raw = deckLike?.elo ?? deckLike?.Elo ?? deckLike?.deckElo ?? null
  const numeric = typeof raw === 'number' ? raw : Number(raw)
  if (!Number.isFinite(numeric)) return null
  return Math.round(numeric)
}

const getHalfDeckId = (deckLike: any): string | null => {
  const raw = deckLike?.id ?? deckLike?.deckId ?? deckLike?.deck_id ?? null
  if (!hasValue(raw)) return null
  const id = String(raw).trim()
  return id || null
}

const getHalfDeckName = (deckLike: any): string | null => {
  const raw = deckLike?.name ?? deckLike?.deckName ?? null
  if (!hasValue(raw)) return null
  const name = String(raw).trim()
  return name || null
}

const extractDeckCards = (deckLike: any): any[] => {
  if (!deckLike || typeof deckLike !== 'object') return []
  const cards =
    (Array.isArray(deckLike?.cards) && deckLike.cards) ||
    (deckLike?.cards && typeof deckLike.cards === 'object' ? Object.values(deckLike.cards) : null) ||
    (Array.isArray(deckLike?.cardList) && deckLike.cardList) ||
    (Array.isArray(deckLike?.cardIds) && deckLike.cardIds) ||
    []

  const solbinds =
    (Array.isArray(deckLike?.solbinds) && deckLike.solbinds) ||
    (Array.isArray(deckLike?.forgeborn?.solbindCards) && deckLike.forgeborn.solbindCards) ||
    []

  return [...cards, ...solbinds].filter(Boolean)
}

const getDeckOwnerName = (deckLike: any): string | null => {
  const direct =
    deckLike?.username ??
    deckLike?.playerName ??
    deckLike?.owner ??
    deckLike?.ownerName ??
    deckLike?.userName ??
    deckLike?.createdBy ??
    deckLike?.pUsername ??
    null
  if (hasValue(direct)) return String(direct).trim()

  const nestedUser = deckLike?.user
  const nestedName =
    nestedUser?.username ??
    nestedUser?.playerName ??
    nestedUser?.owner ??
    nestedUser?.name ??
    null
  if (hasValue(nestedName)) return String(nestedName).trim()

  const firstUser = Array.isArray(deckLike?.users) ? deckLike.users[0] : null
  const firstUserName =
    firstUser?.username ??
    firstUser?.playerName ??
    firstUser?.owner ??
    firstUser?.name ??
    null
  if (hasValue(firstUserName)) return String(firstUserName).trim()

  return null
}

const extractFusedHalfCandidates = (deckLike: any): any[] => {
  const candidates: any[] = []
  if (Array.isArray(deckLike?.myDecks)) {
    candidates.push(...deckLike.myDecks)
  }
  if (Array.isArray(deckLike?.decks)) {
    candidates.push(...deckLike.decks)
  }
  if (Array.isArray(deckLike?.fusedDeckIds)) {
    deckLike.fusedDeckIds.forEach((id: any) => {
      if (!hasValue(id)) return
      candidates.push({ id: String(id) })
    })
  }

  const deduped: any[] = []
  const seen = new Set<string>()
  candidates.forEach((candidate, index) => {
    if (!candidate || typeof candidate !== 'object') return
    const id = getHalfDeckId(candidate)
    const name = getHalfDeckName(candidate)
    const key = id ? `id:${id.toLowerCase()}` : name ? `name:${name.toLowerCase()}` : `idx:${index}`
    if (seen.has(key)) return
    seen.add(key)
    deduped.push(candidate)
  })
  return deduped.slice(0, 2)
}

const mergeDeckLike = (primary: any, fallback: any) => {
  const merged = { ...(fallback && typeof fallback === 'object' ? fallback : {}) }
  if (primary && typeof primary === 'object') {
    Object.entries(primary).forEach(([key, value]) => {
      if (hasValue(value)) {
        ;(merged as any)[key] = value
      }
    })
  }
  return merged
}

const normalizeRarityLabel = (value: unknown): string | null => {
  if (!hasValue(value)) return null
  const raw = String(value).replace(/\s+/g, ' ').trim()
  if (!raw) return null
  return raw
}

const abbreviateRarityLabel = (label: string): string => {
  const tokens = label
    .split(/[^a-zA-Z0-9]+/)
    .map((token) => token.trim())
    .filter(Boolean)

  if (tokens.length === 0) return label

  return tokens
    .map((token) => token.charAt(0).toUpperCase())
    .join('')
}

const extractCreatureTypes = (card: any): string[] => {
  if (!card || typeof card !== 'object') return []
  const rawValue =
    card?.cardSubType ??
    card?.card_sub_type ??
    card?.cardSubtype ??
    card?.card_subtype ??
    card?.subType ??
    card?.subtype ??
    card?.creatureType ??
    card?.creatureTypes ??
    null

  if (!hasValue(rawValue)) return []

  const rawText = Array.isArray(rawValue) ? rawValue.join(',') : String(rawValue)
  const parts = rawText
    .split(/[\/|,&]+/)
    .map((part) => part.trim())
    .filter(Boolean)
  return Array.from(new Set(parts))
}

const buildDeckSummaryLine = (deckLike: any, enrichedHalves: any[]) => {
  const primaryCards = extractDeckCards(deckLike)
  const fallbackCards = enrichedHalves.flatMap((half) => extractDeckCards(half))
  const mergedCards = [...primaryCards, ...fallbackCards].filter(Boolean)
  const forgebornId = deckLike?.forgeborn?.id || deckLike?.forgebornId || null

  let creatures = 0
  let spells = 0
  let solbind = 0
  const rarityCounts = new Map<string, number>()
  const creatureTypeCounts = new Map<string, number>()

  const solbindIdSet = new Set<string>()
  const addSolbindId = (value?: string | null) => {
    if (!hasValue(value)) return
    solbindIdSet.add(String(value).trim().toLowerCase())
  }

  const addSolbindIdsFromDeck = (source: any) => {
    if (!source || typeof source !== 'object') return
    const directSolbinds = Array.isArray(source?.solbinds) ? source.solbinds : []
    directSolbinds.forEach((solbindCard: any) => {
      const id =
        typeof solbindCard === 'string'
          ? solbindCard
          : solbindCard?.id || solbindCard?.cardId || solbindCard?.card_id || solbindCard?.name
      addSolbindId(id)
    })

    const fb = source?.forgeborn
    if (!fb || typeof fb !== 'object') return
    if (Array.isArray(fb.solbindCards)) {
      fb.solbindCards.forEach((solbindCard: any) => {
        const id = solbindCard?.id || solbindCard?.cardId || solbindCard?.card_id || solbindCard?.name
        addSolbindId(id)
      })
    }
    addSolbindId(fb.solbindId1 || fb.solbindid1)
    addSolbindId(fb.solbindId2 || fb.solbindid2)
  }

  const addSolbindIdsFromCard = (card: any) => {
    if (!card || typeof card !== 'object') return

    if (Array.isArray(card.solbindCards)) {
      card.solbindCards.forEach((solbindCard: any) => {
        const id = solbindCard?.id || solbindCard?.cardId || solbindCard?.card_id || solbindCard?.name
        addSolbindId(id)
      })
    }

    if (typeof card.solbind === 'string') {
      card.solbind
        .split(',')
        .map((value: string) => value.trim())
        .filter(Boolean)
        .forEach((value: string) => addSolbindId(value))
    }

    addSolbindId(card.solbindId1 || card.solbindid1)
    addSolbindId(card.solbindId2 || card.solbindid2)
  }

  addSolbindIdsFromDeck(deckLike)
  enrichedHalves.forEach((half) => addSolbindIdsFromDeck(half))
  mergedCards.forEach((card) => addSolbindIdsFromCard(card))

  const uniqueCards: any[] = []
  const seenCards = new Set<string>()
  mergedCards.forEach((card, index) => {
    const id =
      typeof card === 'string'
        ? card
        : card?.id || card?.cardId || card?.card_id || card?.name || card?.title || null
    const key = hasValue(id) ? String(id).trim().toLowerCase() : `idx:${index}`
    if (seenCards.has(key)) return
    seenCards.add(key)
    uniqueCards.push(card)
  })

  uniqueCards.forEach((card: any) => {
    const id = typeof card === 'string' ? card : card?.id || card?.cardId || card?.card_id || card?.name
    const idKey = hasValue(id) ? String(id).trim().toLowerCase() : ''
    const typeValue = typeof card === 'string' ? '' : card?.type || card?.cardType || ''
    const rarityValue = typeof card === 'string' ? '' : card?.rarity || ''
    const typeLower = String(typeValue).toLowerCase()
    const rarityLower = String(rarityValue).toLowerCase()
    const hasSolbindChildren =
      !!(
        typeof card === 'object' &&
        card !== null &&
        (
          (Array.isArray(card.solbindCards) && card.solbindCards.length > 0) ||
          (typeof card.solbind === 'string' && card.solbind.trim().length > 0) ||
          hasValue(card.solbindId1 || card.solbindid1 || card.solbindId2 || card.solbindid2)
        )
      )

    const isForgeborn =
      (!!id && !!forgebornId && String(id).toLowerCase() === String(forgebornId).toLowerCase()) ||
      typeLower.includes('forgeborn') ||
      rarityLower.includes('forgeborn')
    if (isForgeborn) return

    if (hasSolbindChildren) {
      const isSpellParent = typeLower.includes('spell') && !typeLower.includes('creature')
      if (isSpellParent) spells += 1
      else creatures += 1

      const rarity = normalizeRarityLabel(rarityValue)
      if (rarity) {
        rarityCounts.set(rarity, (rarityCounts.get(rarity) || 0) + 1)
      }
      return
    }

    const isSolbindById = idKey && solbindIdSet.has(idKey)
    const isSolbindByTag = rarityLower.includes('solbind') || typeLower.includes('solbind')
    if (isSolbindById || isSolbindByTag) {
      solbind += 1
    } else if (typeLower.includes('spell')) {
      spells += 1
    } else if (typeLower.includes('creature')) {
      creatures += 1
      const creatureTypes = extractCreatureTypes(card)
      creatureTypes.forEach((creatureType) => {
        creatureTypeCounts.set(creatureType, (creatureTypeCounts.get(creatureType) || 0) + 1)
      })
    }

    const rarity = normalizeRarityLabel(rarityValue)
    if (rarity) {
      rarityCounts.set(rarity, (rarityCounts.get(rarity) || 0) + 1)
    }
  })

  if (solbindIdSet.size > solbind) {
    solbind = solbindIdSet.size
  }

  const formatCounts = (counts: Map<string, number>, fallback: string) => {
    if (counts.size === 0) return fallback

    return Array.from(counts.entries())
      .sort((a, b) => (b[1] - a[1]) || a[0].localeCompare(b[0]))
      .map(([label, count]) => `${label} ${count}`)
      .join(', ')
  }

  const formatRarityCounts = (counts: Map<string, number>, fallback: string) =>
    Array.from(
      Array.from(counts.entries()).reduce((acc, [label, count]) => {
        const shortLabel = abbreviateRarityLabel(label)
        acc.set(shortLabel, (acc.get(shortLabel) || 0) + count)
        return acc
      }, new Map<string, number>()).entries()
    )
      .sort((a, b) => (b[1] - a[1]) || a[0].localeCompare(b[0]))
      .map(([label, count]) => `${label} ${count}`)
      .join(', ') || fallback

  const countParts = [`Creatures: ${creatures}`, `Spells: ${spells}`]
  if (solbind > 0) {
    countParts.push(`Solbind: ${solbind}`)
  }
  const countsPart = countParts.join(', ')
  const rarityPart = `Rarities: ${formatRarityCounts(rarityCounts, 'none')}`
  const creatureTypesPart = `Creature Types: ${formatCounts(creatureTypeCounts, 'none')}`
  return `${countsPart}\n${rarityPart}\n${creatureTypesPart}`
}

const buildHalfSummary = (halfDeck: any): string | null => {
  const faction = hasValue(halfDeck?.faction) ? String(halfDeck.faction).trim() : null
  const setLabel = getSetLabel(halfDeck)
  const score = getRoundedScore(halfDeck)
  const elo = getRoundedElo(halfDeck)
  const expireLabel = getExpireLabel(halfDeck)
  const details: string[] = []
  if (faction) details.push(faction)
  if (setLabel) details.push(`Set: ${setLabel}`)
  if (score !== null) details.push(`Score: ${score}`)
  if (elo !== null) details.push(`ELO: ${elo}`)
  if (expireLabel) details.push(`Expire date: ${expireLabel}`)
  if (details.length === 0) return null
  return details.join(', ')
}

const fetchHalfDeckFromInternalApi = async (halfId: string, baseUrl: string): Promise<any | null> => {
  try {
    const response = await fetch(`${baseUrl}/api/deck/${encodeURIComponent(halfId)}`, {
      headers: { Accept: 'application/json' },
      cache: 'force-cache',
      next: { revalidate: 86400 },
    })
    if (!response.ok) return null
    const json = await response.json()
    return json?.deck ?? null
  } catch {
    return null
  }
}

const buildFusedDescription = async (deckLike: any, normalizedDeck: any, baseUrl: string | null) => {
  const halfCandidates = extractFusedHalfCandidates(deckLike)
  if (halfCandidates.length === 0) return 'SolForge Fusion fused deck overview.'

  const enrichedHalves = await Promise.all(
    halfCandidates.map(async (halfDeck) => {
      const halfId = getHalfDeckId(halfDeck)
      const hasCards = extractDeckCards(halfDeck).length > 0
      const needsEnrichment =
        !hasCards ||
        !hasValue(halfDeck?.faction) ||
        !hasValue(getSetLabel(halfDeck)) ||
        getRoundedScore(halfDeck) === null ||
        getRoundedElo(halfDeck) === null ||
        !hasValue(getExpireLabel(halfDeck))
      let mergedHalf = halfDeck

      if (halfId && needsEnrichment) {
        const details = await fetchDeckDetails(halfId, { timeoutMs: 2500, revalidateSeconds: 86400 })
        if (details && typeof details === 'object') {
          mergedHalf = mergeDeckLike(mergedHalf, details)
        }
      }

      if (baseUrl && halfId && !hasValue(getExpireLabel(mergedHalf))) {
        const internalDetails = await fetchHalfDeckFromInternalApi(halfId, baseUrl)
        if (internalDetails && typeof internalDetails === 'object') {
          mergedHalf = mergeDeckLike(mergedHalf, internalDetails)
        }
      }

      return mergedHalf
    })
  )

  const summaries = enrichedHalves
    .map((halfDeck) => buildHalfSummary(halfDeck))
    .filter((value): value is string => !!value)

  const deckSummaryLine = buildDeckSummaryLine(normalizedDeck, enrichedHalves)
  if (summaries.length === 0) return deckSummaryLine || 'SolForge Fusion fused deck overview.'
  // Newline is intentionally included to encourage two-line previews where supported.
  return [...summaries, deckSummaryLine].filter(Boolean).join('\n')
}

const buildRegularDescription = (deckLike: any, normalizedDeck: any) => {
  const mergedDeck = mergeDeckLike(deckLike, normalizedDeck)
  const details = buildHalfSummary(mergedDeck)
  const deckSummaryLine = buildDeckSummaryLine(mergedDeck, [])
  if (details && deckSummaryLine) return `${details}\n${deckSummaryLine}`
  return details || deckSummaryLine || 'SolForge Fusion deck overview.'
}

const buildFusedTitle = (baseTitle: string, forgebornName?: string | null, ownerName?: string | null) => {
  const parts: string[] = []
  if (hasValue(forgebornName)) {
    parts.push(String(forgebornName).trim())
  }
  if (hasValue(ownerName)) {
    const normalizedOwner = String(ownerName).trim()
    const ownerLabel = `owner: ${normalizedOwner}`
    const alreadyIncluded = parts.some(
      (part) => part.toLowerCase() === normalizedOwner.toLowerCase() || part.toLowerCase() === ownerLabel.toLowerCase()
    )
    if (!alreadyIncluded) {
      parts.push(ownerLabel)
    }
  }
  if (parts.length === 0) return baseTitle
  return `${baseTitle} (${parts.join(', ')})`
}

const fetchRawDeckForPreview = async (deckId: string, baseUrl: string | null) => {
  const candidates = buildCandidates(deckId)
  let rawDeck: any = null

  for (const candidate of candidates) {
    const raw = await fetchDeckDetails(candidate)
    if (!raw) continue
    const rawId = raw?.id || raw?.deckId || raw?.deck_id
    if (!rawId) continue
    rawDeck = raw
    break
  }

  if (!rawDeck && baseUrl) {
    try {
      const res = await fetch(`${baseUrl}/api/deck/${encodeURIComponent(deckId)}?skipOwnerMerge=1`, {
        headers: { Accept: 'application/json' },
        cache: 'no-store',
      })
      if (res.ok) {
        const json = await res.json()
        rawDeck = json?.deck || null
      }
    } catch {
      rawDeck = null
    }
  }

  return rawDeck
}

const buildDeckPreviewCore = async (
  deckId: string,
  titleFallback: string,
  baseUrl: string | null
): Promise<DeckPreviewCore | null> => {
  const rawDeck = await fetchRawDeckForPreview(deckId, baseUrl)
  if (!rawDeck) return null

  const deck = normalizeDeck(rawDeck)
  const forgebornName = rawDeck?.forgeborn?.name || deck?.forgeborn?.name || deck?.forgebornId
  const isFusedDeck = isFusedDeckLike(rawDeck) || isFusedDeckLike(deck)
  const description = isFusedDeck
    ? await buildFusedDescription(rawDeck, deck, baseUrl)
    : buildRegularDescription(rawDeck, deck)
  const baseTitle = deck?.name || titleFallback
  const ownerName = getDeckOwnerName(rawDeck) || getDeckOwnerName(deck)
  const title = buildFusedTitle(baseTitle, forgebornName, ownerName)

  return {
    title,
    description,
    imageAlt: forgebornName ? `Forgeborn ${forgebornName}` : 'Forgeborn card',
  }
}

const getDeckPreviewCore = async (
  deckId: string,
  titleFallback: string,
  baseUrl: string | null
): Promise<DeckPreviewCore | null> => {
  const cacheKey = normalizeDeckPreviewKey(deckId)
  const cached = getCachedDeckPreview(cacheKey)
  if (cached) return cached

  const inflight = deckPreviewInFlight.get(cacheKey)
  if (inflight) return inflight

  const promise = buildDeckPreviewCore(deckId, titleFallback, baseUrl)
    .then((core) => {
      if (core) {
        setCachedDeckPreview(cacheKey, core)
      }
      return core
    })
    .finally(() => {
      deckPreviewInFlight.delete(cacheKey)
    })

  deckPreviewInFlight.set(cacheKey, promise)
  return promise
}

export async function generateMetadata(
  { params }: { params: Promise<{ id: string }> }
): Promise<Metadata> {
  const deckId = (await params).id
  const titleFallback = `Deck ${deckId}`

  try {
    const baseUrl = await resolveBaseUrl()
    const previewCore = await getDeckPreviewCore(deckId, titleFallback, baseUrl)
    if (!previewCore) {
      return { title: titleFallback, description: 'SolForge Fusion deck overview.' }
    }

    const { title, description, imageAlt } = previewCore
    const ogImageUrl = baseUrl ? `${baseUrl}/api/og/deck/${encodeURIComponent(deckId)}` : undefined

    return {
      title,
      description,
      openGraph: {
        title,
        description,
        type: 'website',
        images: ogImageUrl
          ? [
              {
                url: ogImageUrl,
                width: 1200,
                height: 630,
                alt: imageAlt,
              },
            ]
          : undefined,
      },
      twitter: {
        card: ogImageUrl ? 'summary_large_image' : 'summary',
        title,
        description,
        images: ogImageUrl ? [ogImageUrl] : undefined,
      },
    }
  } catch {
    return { title: titleFallback, description: 'SolForge Fusion deck overview.' }
  }
}

export default function DeckPage() {
  return <DeckPageClient />
}
