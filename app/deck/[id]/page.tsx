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
  if (forgebornId.includes('-')) {
    return getForgebornAlternativeUrl(forgebornId)
  }
  return getCardImageUrl(forgebornId, 1, true)
}

const summarizeDeck = (deck: any) => {
  const cards = Array.isArray(deck?.cards) ? deck.cards : []
  const forgebornId = deck?.forgeborn?.id || deck?.forgebornId

  let creatures = 0
  let spells = 0
  let solbind = 0
  let other = 0

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

  cards.forEach((card: any) => {
    if (isForgebornCard(card)) return
    const typeValue = typeof card === 'string' ? '' : card?.type || card?.cardType || ''
    const rarityValue = typeof card === 'string' ? '' : card?.rarity || ''
    const typeLower = String(typeValue).toLowerCase()
    const rarityLower = String(rarityValue).toLowerCase()

    if (typeLower.includes('creature')) {
      creatures += 1
      return
    }
    if (typeLower.includes('spell')) {
      spells += 1
      return
    }
    if (typeLower.includes('solbind') || rarityLower.includes('solbind')) {
      solbind += 1
      return
    }
    other += 1
  })

  return { creatures, spells, solbind, other }
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
    const counts = summarizeDeck(deck)

    const parts = [
      forgebornName ? `Forgeborn: ${forgebornName}` : null,
      `Creatures: ${counts.creatures}`,
      `Spells: ${counts.spells}`,
      counts.solbind > 0 ? `Solbind: ${counts.solbind}` : null,
      counts.other > 0 ? `Other: ${counts.other}` : null,
    ].filter(Boolean)

    const title = deck?.name ? `${deck.name} - Deck` : titleFallback
    const description = parts.length > 0 ? parts.join('. ') + '.' : 'SolForge Fusion deck overview.'

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
        card: forgebornImageUrl ? 'summary_large_image' : 'summary',
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
