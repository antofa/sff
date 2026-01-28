import type { Metadata } from 'next'
import DeckPageClient from './DeckPageClient'
import { fetchDeckDetails, getCardImageUrl, getForgebornAlternativeUrl, normalizeDeck } from '@/lib/api'

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

const resolveForgebornImageUrl = (forgebornId?: string | null) => {
  if (!forgebornId) return null
  const cleanId = String(forgebornId).replace(/_/g, ' ')
  if (cleanId.includes(' ')) {
    return getForgebornAlternativeUrl(cleanId)
  }
  if (forgebornId.includes('-')) {
    return getForgebornAlternativeUrl(forgebornId)
  }
  return getCardImageUrl(forgebornId, 1, true)
}

const listDeckCards = (deck: any) => {
  const cards = Array.isArray(deck?.cards) ? deck.cards : []
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
  const names: string[] = []

  const addName = (name?: string | null) => {
    const trimmed = (name || '').trim()
    if (!trimmed) return
    if (unique.has(trimmed)) return
    unique.add(trimmed)
    names.push(trimmed)
  }

  if (forgebornId) {
    addName(deck?.forgeborn?.name || forgebornId)
  }

  cards.forEach((card: any) => {
    if (isForgebornCard(card)) return
    if (typeof card === 'string') {
      addName(card)
      return
    }
    addName(card?.name || card?.id)
  })

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

    for (const candidate of candidates) {
      const raw = await fetchDeckDetails(candidate)
      if (raw) {
        rawDeck = raw
        break
      }
    }

    if (!rawDeck) {
      return { title: titleFallback, description: 'SolForge Fusion deck overview.' }
    }

    const deck = normalizeDeck(rawDeck)
    const forgebornName = rawDeck?.forgeborn?.name || deck?.forgeborn?.name || deck?.forgebornId
    const forgebornImageUrl = resolveForgebornImageUrl(rawDeck?.forgeborn?.id || deck?.forgebornId)
    const cardNames = listDeckCards(deck)
    const description = cardNames.length > 0 ? cardNames.join(', ') : 'SolForge Fusion deck overview.'
    const title = titleFallback

    return {
      title,
      description,
      openGraph: {
        title,
        description,
        type: 'website',
        images: forgebornImageUrl
          ? [{ url: forgebornImageUrl, alt: forgebornName ? `Forgeborn ${forgebornName}` : 'Forgeborn card' }]
          : undefined,
      },
      twitter: {
        card: forgebornImageUrl ? 'summary' : 'summary',
        title,
        description,
        images: forgebornImageUrl ? [forgebornImageUrl] : undefined,
      },
    }
  } catch {
    return { title: titleFallback, description: 'SolForge Fusion deck overview.' }
  }
}

export default function DeckPage() {
  return <DeckPageClient />
}
