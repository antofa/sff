import type { Metadata } from 'next'
import { headers } from 'next/headers'
import DeckPageClient from './DeckPageClient'
import { fetchDeckDetails, normalizeDeck } from '@/lib/api'

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
    const cardNames = listDeckCards(deck)
    const description = cardNames.length > 0 ? cardNames.join(', ') : 'SolForge Fusion deck overview.'
    const title = deck?.name || titleFallback
    const baseUrl = await resolveBaseUrl()
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
