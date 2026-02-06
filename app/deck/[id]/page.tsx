import type { Metadata } from 'next'
import { headers } from 'next/headers'
import DeckPageClient from './DeckPageClient'
import { fetchDeckDetails, normalizeDeck } from '@/lib/api'

export const dynamic = 'force-dynamic'

const buildCandidates = (rawId: string) => {
  const stripDeckPrefixes = (value: string) =>
    value
      .toString()
      .replace(/^deck[_-]?fused[_-]?/i, '')
      .replace(/^deck[_-]?/i, '')
      .replace(/^fused[_-]?/i, '')

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

const hasHalfSummaryData = (deckLike: any) => {
  return (
    hasValue(getHalfDeckName(deckLike)) ||
    hasValue(deckLike?.faction) ||
    hasValue(getSetLabel(deckLike)) ||
    getRoundedScore(deckLike) !== null ||
    getRoundedElo(deckLike) !== null
  )
}

const buildHalfSummary = (halfDeck: any): string | null => {
  const halfName = getHalfDeckName(halfDeck)
  const halfId = getHalfDeckId(halfDeck)
  const faction = hasValue(halfDeck?.faction) ? String(halfDeck.faction).trim() : null
  const setLabel = getSetLabel(halfDeck)
  const score = getRoundedScore(halfDeck)
  const elo = getRoundedElo(halfDeck)
  const details: string[] = []
  if (faction) details.push(`Faction: ${faction}`)
  if (setLabel) details.push(`Set: ${setLabel}`)
  if (score !== null) details.push(`Score: ${score}`)
  if (elo !== null) details.push(`ELO: ${elo}`)

  const label = halfName || halfId
  if (!label && details.length === 0) return null
  if (!label) return details.join(', ')
  return details.length > 0 ? `${label} (${details.join(', ')})` : label
}

const buildFusedDescription = async (deckLike: any) => {
  const halfCandidates = extractFusedHalfCandidates(deckLike)
  if (halfCandidates.length === 0) return 'SolForge Fusion fused deck overview.'

  const enrichedHalves = await Promise.all(
    halfCandidates.map(async (halfDeck) => {
      const halfId = getHalfDeckId(halfDeck)
      const needsEnrichment = !hasHalfSummaryData(halfDeck)
      if (!halfId || !needsEnrichment) return halfDeck

      const details = await fetchDeckDetails(halfId, { timeoutMs: 2500, revalidateSeconds: 86400 })
      if (!details || typeof details !== 'object') return halfDeck
      return mergeDeckLike(halfDeck, details)
    })
  )

  const summaries = enrichedHalves
    .map((halfDeck) => buildHalfSummary(halfDeck))
    .filter((value): value is string => !!value)

  if (summaries.length === 0) return 'SolForge Fusion fused deck overview.'
  // Newline is intentionally included to encourage two-line previews where supported.
  return summaries.join('\n')
}

const buildFusedTitle = (baseTitle: string, forgebornName?: string | null, ownerName?: string | null) => {
  const parts: string[] = []
  if (hasValue(forgebornName)) {
    parts.push(String(forgebornName).trim())
  }
  if (hasValue(ownerName)) {
    const normalizedOwner = String(ownerName).trim()
    const alreadyIncluded = parts.some((part) => part.toLowerCase() === normalizedOwner.toLowerCase())
    if (!alreadyIncluded) {
      parts.push(normalizedOwner)
    }
  }
  if (parts.length === 0) return baseTitle
  return `${baseTitle} (${parts.join(', ')})`
}

const listDeckCards = (deck: any) => {
  const cards = Array.isArray(deck?.cards) ? deck.cards : []
  const solbindCards = Array.isArray(deck?.solbinds) ? deck.solbinds : []
  const allCards = cards.concat(solbindCards)
  const forgebornId = deck?.forgeborn?.id || deck?.forgebornId

  const isForgebornCard = (card: any) => {
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

  const unique = new Set<string>()
  const creatures: string[] = []
  const spells: string[] = []
  const solbind: string[] = []

  const addName = (name?: string | null) => {
    const trimmed = (name || '').trim()
    if (!trimmed) return
    return trimmed
  }

  const forgebornName = forgebornId ? addName(deck?.forgeborn?.name || forgebornId) : null
  if (forgebornName) {
    unique.add(forgebornName)
  }

  const pushUnique = (bucket: string[], name?: string | null) => {
    const trimmed = addName(name)
    if (!trimmed) return
    if (unique.has(trimmed)) return
    unique.add(trimmed)
    bucket.push(trimmed)
  }

  allCards.forEach((card: any) => {
    if (isForgebornCard(card)) return

    if (typeof card === 'string') {
      pushUnique(creatures, card)
      return
    }

    const name = card?.name || card?.title || card?.cardTitle || card?.cardName || card?.id || card?.cardId
    const typeValue = card?.type || card?.cardType || ''
    const rarityValue = card?.rarity || ''
    const typeLower = String(typeValue).toLowerCase()
    const rarityLower = String(rarityValue).toLowerCase()

    if (rarityLower.includes('solbind') || typeLower.includes('solbind')) {
      pushUnique(solbind, name)
      return
    }
    if (typeLower.includes('spell')) {
      pushUnique(spells, name)
      return
    }
    pushUnique(creatures, name)
  })

  const names: string[] = []
  if (forgebornName) {
    names.push(forgebornName)
  }
  names.push(...creatures, ...spells, ...solbind)
  return names
}

export async function generateMetadata(
  { params }: { params: Promise<{ id: string }> }
): Promise<Metadata> {
  const deckId = (await params).id
  const titleFallback = `Deck ${deckId}`

  try {
    const candidates = buildCandidates(deckId)
    let rawDeck: any = null
    const baseUrl = await resolveBaseUrl()

    for (const candidate of candidates) {
      const raw = await fetchDeckDetails(candidate)
      if (raw) {
        const rawId = raw?.id || raw?.deckId || raw?.deck_id
        if (!rawId) {
          continue
        }
        rawDeck = raw
        break
      }
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

    if (!rawDeck) {
      return { title: titleFallback, description: 'SolForge Fusion deck overview.' }
    }

    const deck = normalizeDeck(rawDeck)
    const forgebornName = rawDeck?.forgeborn?.name || deck?.forgeborn?.name || deck?.forgebornId
    const isFusedDeck = isFusedDeckLike(rawDeck) || isFusedDeckLike(deck)
    const cardNames = listDeckCards(deck)
    const baseDescription = cardNames.length > 0 ? cardNames.join(', ') : 'SolForge Fusion deck overview.'
    const description = isFusedDeck ? await buildFusedDescription(rawDeck) : baseDescription
    const baseTitle = deck?.name || titleFallback
    const ownerName = getDeckOwnerName(rawDeck) || getDeckOwnerName(deck)
    const title = isFusedDeck ? buildFusedTitle(baseTitle, forgebornName, ownerName) : baseTitle
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
                alt: forgebornName ? `Forgeborn ${forgebornName}` : 'Forgeborn card',
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
