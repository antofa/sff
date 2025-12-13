'use client'

import { useState, useMemo, useEffect, useRef, useLayoutEffect, useTransition, useCallback, memo } from 'react'
import { pluralize } from '@/lib/pluralize'
import { Stack, Paper, Title, Text, Group, Badge, Grid, TextInput, NumberInput, Select, MultiSelect, Collapse, Button, SegmentedControl, Image } from '@mantine/core'
import { IconCards, IconCalendar, IconFilter, IconX } from '@tabler/icons-react'
import { useDebouncedValue, useResizeObserver } from '@mantine/hooks'
import type { Deck } from '@/store/deckStore'
import { DeckDetails } from './DeckDetails'
import { getCardInfo } from '@/lib/api'

// Helper function to format set name: "1" -> "S1", "2" -> "S2", "B1" -> "B1", etc.
function formatSetName(setNo: string | number | null | undefined): string | null {
  if (!setNo) return null
  
  const setStr = String(setNo).trim()
  
  // If it's already B1 or b1, return as B1
  if (setStr.toUpperCase() === 'B1' || setStr.toLowerCase() === 'b1') {
    return 'B1'
  }
  
  // For numeric sets, format as S1, S2, S3, etc.
  const numericMatch = setStr.match(/^(\d+)$/)
  if (numericMatch) {
    return `S${numericMatch[1]}`
  }
  
  // If it already starts with S, return as is (but uppercase S)
  if (/^s\d+/i.test(setStr)) {
    return setStr.toUpperCase()
  }
  
  // Otherwise return as is
  return setStr
}

// Helper function to check if a card is from B1 set
function isB1Card(card: any): boolean {
  if (!card) return false
  
  // Handle string cards
  if (typeof card === 'string') {
    return /^b1_/i.test(card)
  }
  
  // Handle object cards
  if (typeof card === 'object' && card !== null) {
    const cardSetId = card.cardSetId || card.CardSetId || card.SK || card.sk
    const cardId = card.id || card.cardId || card.name
    
    // Check cardSetId/SK for B1
    if (cardSetId && String(cardSetId).toLowerCase() === 'b1') {
      return true
    }
    
    // Check cardId for b1_ prefix
    if (cardId && /^b1_/i.test(cardId)) {
      return true
    }
  }
  
  return false
}

// Helper to resolve expiry timestamp (ms) for a deck: expireAt/expire_date/created fallback
function getExpiryTimestamp(deck: Deck): number | null {
  if ((deck as any)?.computed && (deck as any).computed.expiryTs !== undefined) {
    return (deck as any).computed.expiryTs as number | null
  }
  const deckAny = deck as any
  const expireRaw =
    deckAny?.expireAt ??
    deckAny?.expire ??
    deckAny?.expire_at ??
    deckAny?.expireDate ??
    deckAny?.expire_date ??
    deckAny?.pExpiry ??
    null
  if (!expireRaw) return null
  const ts = new Date(expireRaw).getTime()
  return Number.isNaN(ts) ? null : ts
}

// Helper to determine border colors based on expiry status
function getBorderColors(deck: Deck, now: number) {
  let borderColor = 'rgba(74, 144, 226, 0.6)'
  let hoverBorderColor = 'rgba(74, 144, 226, 0.9)'
  const expiryTs = getExpiryTimestamp(deck)
  if (expiryTs !== null) {
    if (expiryTs < now) {
      borderColor = 'rgba(0, 0, 0, 1)'
      hoverBorderColor = 'rgba(0, 0, 0, 1)'
    } else {
      borderColor = 'rgba(220, 38, 38, 0.8)'
      hoverBorderColor = 'rgba(220, 38, 38, 1)'
    }
  }
  return { borderColor, hoverBorderColor }
}

// Helper function to determine deck set: if any card is from B1, return "B1", otherwise use deck.cardSetNo
function getDeckSet(deck: Deck): string | null {
  if ((deck as any)?.computed && (deck as any).computed.deckSet !== undefined) {
    return (deck as any).computed.deckSet as string | null
  }
  if (!deck) return null
  
  const deckAny = deck as any

  const deriveSetFromId = (id?: string | null): string | null => {
    if (!id || typeof id !== 'string') return null
    const lower = id.toLowerCase()
    if (lower.startsWith('s1-')) return 'S1'
    if (lower.startsWith('s2-')) return 'S2'
    if (lower.startsWith('s3-')) return 'S3'
    if (lower.startsWith('s4-')) return 'S4'
    return null
  }
  
  // For fused decks, check cards from source decks (myDecks) if cards array is empty
  if (deckAny.format === 'Fused' && (!deck.cards || !Array.isArray(deck.cards) || deck.cards.length === 0)) {
    // Check source decks (myDecks) for explicit set first, then B1 cards
    if (deckAny.myDecks && Array.isArray(deckAny.myDecks)) {
      for (const sourceDeck of deckAny.myDecks) {
        if (!sourceDeck) continue
        const explicitSet = sourceDeck.cardSetNo || sourceDeck.cardSetId || deriveSetFromId(sourceDeck.id)
        if (explicitSet) {
          return explicitSet
        }
        if (sourceDeck.cards && Array.isArray(sourceDeck.cards)) {
          const hasB1Card = sourceDeck.cards.some((card: any) => isB1Card(card))
          if (hasB1Card) return 'B1'
        }
      }
    }
    
    // Fallback: check fused deck itself for set
    const derivedParentSet = deckAny.cardSetNo || deckAny.cardSetId || deriveSetFromId(deckAny.id)
    if (derivedParentSet) {
      return derivedParentSet
    }

    return null
  }
  
  // For regular decks or fused decks with cards
  if (!deck.cards || !Array.isArray(deck.cards) || deck.cards.length === 0) {
    return deck.cardSetNo || deriveSetFromId(deckAny.id) || null
  }
  
  // Check if any card is from B1 set
  const hasB1Card = deck.cards.some((card: any) => isB1Card(card))
  
  if (hasB1Card) {
    return 'B1'
  }
  
  // Otherwise use deck.cardSetNo
  return deck.cardSetNo || deriveSetFromId(deckAny.id) || null
}

// Helper function to count cards as sum of creatures + spells + solbind (excluding Forgeborn)
function countPlayableCards(deck: Deck): { total: number; creatures: number; spells: number; solbind: number } {
  if (deck.computed?.counts) return deck.computed.counts
  const deckAny = deck as any
  const extractCards = (d: any): any[] => {
    if (!d) return []
    if (Array.isArray(d.cardList)) return d.cardList
    if (Array.isArray(d.cards)) return d.cards
    if (Array.isArray(d.cardIds)) {
      const cardDataValues =
        d.cards && typeof d.cards === 'object' ? Object.values(d.cards) : []
      return d.cardIds.map((id: string, idx: number) => {
        const data = cardDataValues[idx] && typeof cardDataValues[idx] === 'object' ? cardDataValues[idx] : {}
        return {
          ...data,
          id,
          cardId: id,
          name: (data as any)?.name || (data as any)?.title || id,
          title: (data as any)?.title,
          _idx: idx,
        }
      })
    }
    if (d.cards && typeof d.cards === 'object') {
      const values = Object.values(d.cards)
      if (values.length > 0) return values
    }
    return []
  }

  let rawCards: any[] = extractCards(deckAny)

  // For fused decks, prefer cards from source halves when available to avoid miscounts
  if (deckAny.format === 'Fused' && Array.isArray(deckAny.myDecks) && deckAny.myDecks.length >= 2) {
    const combined: any[] = []
    const seen = new Set<string>()
    const addCards = (cardsArr: any[]) => {
      cardsArr.forEach((c, idx) => {
        const key = c?.id || c?.cardId || c?.name || `card-${combined.length + idx}`
        if (seen.has(key)) return
        seen.add(key)
        combined.push(c)
      })
    }
    deckAny.myDecks.forEach((src: any) => addCards(extractCards(src)))
    if (combined.length > 0) {
      rawCards = combined
    }
  }

  if (!rawCards || rawCards.length === 0) return { total: 0, creatures: 0, spells: 0, solbind: 0 }
  
  // Normalize cards
  const normalizedCards = rawCards.map((card: any, index: number) => {
    if (typeof card === 'string') {
      return getCardInfo(card)
    } else if (typeof card === 'object' && card !== null) {
      const cardId = card.id || card.cardId || card.name || `card-${index}`
      return getCardInfo(cardId, card)
    }
    return getCardInfo(`card-${index}`)
  })
  
  // Extract Solbind card IDs from solbindCards arrays (same logic as DeckDetails)
  const solbindCardIds = new Set<string>()
  let solbindCount = 0
  const solbindPlaceholderParents = new Set<string>()

  normalizedCards.forEach(card => {
    const cardData = card as any
    if (cardData.solbindCards && Array.isArray(cardData.solbindCards)) {
      solbindCount += cardData.solbindCards.length
      cardData.solbindCards.forEach((solbindCard: any, sbIdx: number) => {
        if (!solbindCard) return
        const sbId = solbindCard.id || solbindCard.cardId || solbindCard.name || `solbind-${card.id || 'card'}-${sbIdx}`
        if (sbId) {
          solbindCardIds.add(sbId)
        }
      })
    }
  })
  // Also add Solbind IDs from forgeborn.solbindCards if present
  if ((deck as any).forgeborn && Array.isArray((deck as any).forgeborn.solbindCards)) {
    solbindCount += (deck as any).forgeborn.solbindCards.length
    ;(deck as any).forgeborn.solbindCards.forEach((solbindCard: any, sbIdx: number) => {
      if (!solbindCard) return
      const sbId = solbindCard.id || solbindCard.cardId || solbindCard.name || `solbind-forgeborn-${sbIdx}`
      if (sbId) {
        solbindCardIds.add(sbId)
      }
    })
  }
  
  // Identify Forgeborn
  const forgebornId = deck.forgebornId
  const forgebornCards: any[] = []
  if (forgebornId) {
    const forgeborn = normalizedCards.find(card => 
      card.id === forgebornId || 
      (card.id && forgebornId && card.id.includes(forgebornId)) ||
      (forgebornId && card.id && forgebornId.includes(card.id))
    )
    if (forgeborn) {
      forgebornCards.push(forgeborn)
    }
  }
  if (forgebornCards.length === 0) {
    const forgebornByType = normalizedCards.find(card =>
      card.type?.toLowerCase().includes('forgeborn') ||
      (card as any).cardType?.toLowerCase().includes('forgeborn')
    )
    if (forgebornByType) {
      forgebornCards.push(forgebornByType)
    }
  }
  
  // Collect Solbind cards (same logic as DeckDetails)
  const solbindCardObjects: any[] = []

  // First, extract Solbind cards from solbindCards arrays
  normalizedCards.forEach(card => {
    const cardData = card as any
    if (cardData.solbindCards && Array.isArray(cardData.solbindCards)) {
      cardData.solbindCards.forEach((solbindCard: any, sbIdx: number) => {
        if (!solbindCard) return
        const sbId = solbindCard.id || solbindCard.cardId || solbindCard.name || `solbind-${card.id || 'card'}-${sbIdx}`
        if (!solbindCardObjects.some(sb => sb.id === sbId)) {
          solbindCardObjects.push(getCardInfo(sbId, { ...solbindCard, id: sbId }))
        }
      })
    }
  })

  // Also extract Solbind cards from forgeborn.solbindCards (if not already in normalizedCards)
  if ((deck as any).forgeborn && Array.isArray((deck as any).forgeborn.solbindCards)) {
    ;(deck as any).forgeborn.solbindCards.forEach((solbindCard: any, sbIdx: number) => {
      if (!solbindCard) return
      const sbId = solbindCard.id || solbindCard.cardId || solbindCard.name || `solbind-forgeborn-${sbIdx}`
      if (!sbId) return
      if (!solbindCardObjects.some(sb => sb.id === sbId)) {
        solbindCardObjects.push(getCardInfo(sbId, { ...solbindCard, id: sbId }))
      }
    })
  }
  
  // Also check for cards in normalizedCards that are solbind cards
  normalizedCards.forEach(card => {
    if (forgebornCards.includes(card)) return
    
    const cardData = card as any
    const cardId = card.id
    
    // Skip parent cards with solbindCards array - they are not Solbind cards themselves
    if (cardData.solbindCards && Array.isArray(cardData.solbindCards)) {
      return
    }
    
    // Check if this card is in any solbindCards array (already added above)
    if (solbindCardIds.has(cardId)) {
      if (!solbindCardObjects.some(sb => sb.id === cardId)) {
        solbindCardObjects.push(card)
      }
      return
    }
    
    // Check if rarity is Solbind - but only if it's NOT a parent card
    // Parent cards with solbindCards are containers, not Solbind cards themselves
    if (cardData.rarity === 'Solbind' || cardData.rarity === 'solbind') {
      if (!solbindCardObjects.some(sb => sb.id === cardId)) {
        solbindCardObjects.push(card)
      }
    }
  })
  // If a Solbind parent has no embedded solbindCards (API omitted children), assume two child cards
  const solbindFallbackIds = new Set<string>()
  normalizedCards.forEach(card => {
    const cardData = card as any
    const rarity = (cardData.rarity || '').toString().toLowerCase()
    const hasChildren = Array.isArray(cardData.solbindCards) && cardData.solbindCards.length > 0
    if (rarity.includes('solbind') && !hasChildren) {
      const baseId = card.id || card.cardId || cardData.name || 'solbind-parent'
      solbindFallbackIds.add(`${baseId}-sb1`)
      solbindFallbackIds.add(`${baseId}-sb2`)
      solbindPlaceholderParents.add(baseId)
    }
  })
  solbindFallbackIds.forEach(id => solbindCardIds.add(id))
  solbindCount += solbindFallbackIds.size

  // Deduplicate solbindCardObjects by id to avoid over-counting
  const solbindUniqueMap = new Map<string, any>()
  solbindCardObjects.forEach(sb => {
    if (sb?.id && !solbindUniqueMap.has(sb.id)) {
      solbindUniqueMap.set(sb.id, sb)
    }
  })
  const solbindCardsUnique = Array.from(solbindUniqueMap.values())

  // Categorize remaining cards
  let creatures = 0
  let spells = 0
  const forgebornIdSet = new Set<string>()
  if (deck.forgebornId) forgebornIdSet.add(deck.forgebornId)
  normalizedCards.forEach(card => {
    const cardData = card as any
    const ct = (cardData.cardType || cardData.type || '').toLowerCase()
    if (ct.includes('forgeborn') && card.id) {
      forgebornIdSet.add(card.id)
    }
  })
  
  normalizedCards.forEach(card => {
    const cardData = card as any
    // Skip forgeborn by id or type
    const isForgeborn =
      forgebornIdSet.has(card.id) ||
      cardData.type?.toLowerCase().includes('forgeborn') ||
      cardData.cardType?.toLowerCase().includes('forgeborn')
    if (isForgeborn) return

    // Detect solbind (keep counting as spell/creature too) but do not double-count parents
    const isParentSolbind =
      solbindPlaceholderParents.has(card.id || card.cardId || card.name) ||
      (Array.isArray(cardData.solbindCards) && cardData.solbindCards.length > 0) ||
      !!(cardData.solbindId1 || cardData.solbindid1 || cardData.solbindId2 || cardData.solbindid2)

    const isSolbindCard =
      !isParentSolbind &&
      (solbindCardsUnique.some(sb => sb.id === card.id) ||
        (typeof cardData.rarity === 'string' && cardData.rarity.toLowerCase().includes('solbind')))
    
    // Get original card data to check cardType properly
    const originalCard = deck.cards && Array.isArray(deck.cards)
      ? deck.cards.find((c: any, idx: number) => {
          if (typeof c === 'string') {
            return c === card.id
          }
          const cId = c?.id || c?.cardId || c?.name || `card-${idx}`
          return cId === card.id
        })
      : null
    
    // Check cardType from original data first, then normalized
    const originalCardType = originalCard && typeof originalCard === 'object'
      ? (originalCard.cardType || (originalCard as any).card_type || (originalCard as any).type || '')
      : ''
    const cardType = cardData.cardType || cardData.card_type || cardData.type || originalCardType || ''
    
    // Determine if spell based ONLY on cardType
    // If cardType is "Spell", it's a spell, otherwise it's a creature (default)
    const lowerCardType = cardType.toLowerCase()
    const isSpell = lowerCardType.includes('spell') && !lowerCardType.includes('creature')
    
    if (isSpell) spells++
    else creatures++

    // Count solbind separately (do not exclude from spell/creature counts)
    if (isSolbindCard && !solbindCardIds.has(card.id)) {
      solbindCount += 1
    }
  })
  
  const solbind = Math.max(solbindCardIds.size, solbindCardsUnique.length, solbindCount)

  // Total cards: exclude forgeborn only
  const total = normalizedCards.filter(card => {
    const cardData = card as any
    const isForgeborn =
      forgebornIdSet.has(card.id) ||
      cardData.type?.toLowerCase().includes('forgeborn') ||
      cardData.cardType?.toLowerCase().includes('forgeborn')
    return !isForgeborn
  }).length

  return { total, creatures, spells, solbind }
}

// Lightweight fallback counter for display (handles fused decks missing computed counts)
function getDisplayCounts(deck: Deck): { total: number; creatures: number; spells: number } {
  const deckAny = deck as any
  const normalizeCardsFromHalf = (half: any): any[] => {
    if (!half || typeof half !== 'object') return []
    if (Array.isArray(half.cardIds) && half.cardIds.length > 0) {
      const cardDataValues =
        half.cards && typeof half.cards === 'object' ? Object.values(half.cards) : []
      return half.cardIds.map((id: string, idx: number) => {
        const data = cardDataValues[idx] && typeof cardDataValues[idx] === 'object' ? cardDataValues[idx] : {}
        return {
          ...data,
          id,
          cardId: id,
          name: (data as any)?.name || (data as any)?.title || id,
          title: (data as any)?.title,
          _idx: idx,
        }
      })
    }
    if (half.cards && typeof half.cards === 'object' && Object.values(half.cards).length > 0) {
      return Object.values(half.cards)
    }
    if (Array.isArray(half.cardList) && half.cardList.length > 0) return half.cardList
    if (Array.isArray(half.cards) && half.cards.length > 0) return half.cards
    return []
  }

  // Prefer halves when present
  if (Array.isArray(deckAny.myDecks) && deckAny.myDecks.length > 0) {
    let total = 0
    let creatures = 0
    let spells = 0
    deckAny.myDecks.forEach((half: any) => {
      const cards = normalizeCardsFromHalf(half)
      cards.forEach((c: any) => {
        const typeRaw = (c.cardType || c.type || '').toString().toLowerCase()
        const isSpell = typeRaw.includes('spell') && !typeRaw.includes('creature')
        if (isSpell) spells += 1
        else creatures += 1
        total += 1
      })
    })
    return { total, creatures, spells }
  }

  const cards =
    (Array.isArray(deckAny.cardList) && deckAny.cardList.length > 0 && deckAny.cardList) ||
    (Array.isArray(deckAny.cards) && deckAny.cards.length > 0 && deckAny.cards) ||
    (deckAny.cards && typeof deckAny.cards === 'object' ? Object.values(deckAny.cards) : []) ||
    []

  if (!cards || cards.length === 0) return { total: 0, creatures: 0, spells: 0 }

  let creatures = 0
  let spells = 0
  cards.forEach((c: any) => {
    const typeRaw = (c.cardType || c.type || '').toString().toLowerCase()
    const isSpell = typeRaw.includes('spell') && !typeRaw.includes('creature')
    if (isSpell) spells += 1
    else creatures += 1
  })

  return { total: cards.length, creatures, spells }
}

// Shared deck card renderers (used by virtualized rows)
const RegularDeckCard = memo(function RegularDeckCard({
  deck,
  handleDeckClick,
}: {
  deck: Deck
  handleDeckClick: (deck: Deck) => void
}) {
  const [renderNow] = useState(() => Date.now())
  const computedCounts = deck.computed?.counts && deck.computed.counts.total > 0 ? deck.computed.counts : null
  const displayCounts = computedCounts || getDisplayCounts(deck)
  const expiryTs = getExpiryTimestamp(deck)
  const isExpired = expiryTs !== null && expiryTs < renderNow
  const { borderColor, hoverBorderColor } = getBorderColors(deck, renderNow)

  return (
    <Grid.Col key={deck.id} span={{ base: 12, sm: 6, md: 4 }}>
      <Paper
        data-deck-id={deck.id}
        p="lg"
        onClick={() => handleDeckClick(deck)}
        className="border rounded-xl cursor-pointer"
        style={{
          backgroundColor: 'rgba(30, 41, 59, 0.5)',
          borderColor,
          boxShadow: '0 2px 4px rgba(0, 0, 0, 0.12)',
          minHeight: 360,
          transition: 'border-color 0.1s ease',
          overflow: 'hidden',
        }}
        onMouseEnter={(e) => {
          e.currentTarget.style.borderColor = hoverBorderColor
        }}
        onMouseLeave={(e) => {
          e.currentTarget.style.borderColor = borderColor
        }}
      >
        <Stack gap="sm">
          {(deck as any).playerName && (
            <Group gap="xs" wrap="wrap">
              <Badge
                color="teal"
                variant="light"
                size="sm"
                radius="sm"
                component="a"
                href={`/player/${encodeURIComponent((deck as any).playerName)}`}
                style={{ textDecoration: 'none' }}
              >
                Owner: {(deck as any).playerName}
              </Badge>
              {expiryTs !== null && (
                <Badge
                  color={undefined}
                  variant="filled"
                  size="sm"
                  radius="sm"
                  style={
                    isExpired
                      ? {
                          backgroundColor: '#000',
                          color: '#fff',
                          border: '1px solid #000',
                        }
                      : {
                          backgroundColor: '#b32626',
                          color: '#fff',
                          border: '1px solid #b32626',
                        }
                  }
                >
                  Expire: {new Date(expiryTs).toLocaleDateString('en-GB', {
                    day: 'numeric',
                    month: 'short',
                    year: 'numeric',
                  })}
                </Badge>
              )}
            </Group>
          )}

          <Title order={4} className="text-white flex-1" lineClamp={2}>
            {deck.name || 'Untitled'}
          </Title>

          <Group gap={8}>
            <Group gap={4}>
              {deck.faction && (
                <Image
                  src={`/images/icons/${deck.faction.toLowerCase()}.png`}
                  alt={deck.faction}
                  h={20}
                  w="auto"
                  style={{ display: 'inline-block', verticalAlign: 'middle', flexShrink: 0 }}
                />
              )}
              {(() => {
                const deckSet = getDeckSet(deck)
                const formattedSet = formatSetName(deckSet)
                return formattedSet ? (
                  <Badge color="indigo" variant="light" size="sm">
                    {formattedSet}
                  </Badge>
                ) : null
              })()}
            </Group>
            {displayCounts && (
              <Badge color="blue" variant="light" size="sm" leftSection={<IconCards size={12} />}>
                {displayCounts.total} cards
              </Badge>
            )}
            {deck.deckRank && deck.deckRank !== 'Unranked' && (
              <Badge
                color={
                  deck.deckRank === 'Platinum'
                    ? 'gray'
                    : deck.deckRank === 'Gold'
                      ? 'yellow'
                      : deck.deckRank === 'Silver'
                        ? 'gray'
                        : deck.deckRank === 'Bronze'
                          ? 'orange'
                          : 'gray'
                }
                variant="light"
                size="sm"
              >
                {deck.deckRank}
              </Badge>
            )}
            {(deck as any).deckScore !== undefined && (deck as any).deckScore !== null && (
              <Badge color="grape" variant="light" size="sm">
                Score:{' '}
                {typeof (deck as any).deckScore === 'number'
                  ? Math.round((deck as any).deckScore * 100)
                  : (deck as any).deckScore}
              </Badge>
            )}
            {(deck as any).elo !== undefined && (deck as any).elo !== null && (
              <Badge color="violet" variant="light" size="sm">
                ELO:{' '}
                {typeof (deck as any).elo === 'number' ? Math.round((deck as any).elo) : (deck as any).elo}
              </Badge>
            )}
          </Group>

          {(() => {
            const counts = computedCounts || displayCounts
            const rarityEntries = deck.computed?.rarityCounts ? Object.entries(deck.computed.rarityCounts) : []
            if (!counts && rarityEntries.length === 0) return null
            return (
              <Stack gap="xs">
                <Group gap="xs">
                  {counts?.creatures ? (
                    <Badge color="green" variant="light" size="sm">
                      {pluralize(counts.creatures, 'Creature')}
                    </Badge>
                  ) : null}
                  {counts?.spells ? (
                    <Badge color="pink" variant="light" size="sm">
                      {pluralize(counts.spells, 'Spell')}
                    </Badge>
                  ) : null}
                  {((counts as any)?.solbind) ? (
                    <Badge color="orange" variant="light" size="sm">
                      {pluralize((counts as any).solbind, 'Solbind')}
                    </Badge>
                  ) : null}
                </Group>
                {rarityEntries.length > 0 && (
                  <Group gap="xs">
                    {rarityEntries
                      .sort(([a], [b]) => {
                        const order: Record<string, number> = {
                          Common: 1,
                          'Common Rare': 2,
                          Rare: 3,
                          Solbind: 4,
                          LS: 5,
                        }
                        return (order[a] || 99) - (order[b] || 99)
                      })
                      .map(([rarity, count]) => {
                        const getRarityColor = (rarityName: string): string => {
                          const normalized = rarityName.toLowerCase()
                          if (normalized.includes('common') && normalized.includes('rare')) return '#0e87cf'
                          if (normalized.includes('rare') && !normalized.includes('common')) return '#e6b70c'
                          if (normalized.includes('solbind')) return '#75cec4'
                          if (normalized.includes('common')) return '#1199e3'
                          if (normalized.includes('ls')) return '#a90100'
                          return '#1199e3'
                        }
                        return (
                          <Badge
                            key={rarity}
                            variant="light"
                            size="sm"
                            style={{ backgroundColor: getRarityColor(rarity), color: 'white', border: 'none' }}
                          >
                            {count} {rarity}
                          </Badge>
                        )
                      })}
                  </Group>
                )}
              </Stack>
            )
          })()}

          {(() => {
            const expiryDate = getExpiryTimestamp(deck)
            const isExpired = expiryDate !== null && expiryDate < renderNow
            const receiptDate = (deck as any).updatedAt

            return receiptDate ? (
              <Group gap="xs" className="text-gray-400 text-sm">
                <IconCalendar size={14} />
                <Text size="xs">
                  Updated at:{' '}
                  {new Date(receiptDate).toLocaleDateString('en-GB', {
                    day: 'numeric',
                    month: 'short',
                    year: 'numeric',
                  })}
                </Text>
              </Group>
            ) : null
          })()}

          {(() => {
            const hasTags =
              deck.tags && typeof deck.tags === 'object' && !Array.isArray(deck.tags) && Object.keys(deck.tags).length > 0
            let tagsToDisplay: string[] = []
            if (hasTags) {
              tagsToDisplay = Object.entries(deck.tags)
                .map(([key, value]) => {
                  if (value === null || value === undefined || value === '') return null
                  if (key === 'none' && (!value || value === '')) return null
                  if (typeof value === 'string' && value.trim() === '') return null
                  let tagText: string | null = null
                  if (typeof value === 'string' && value.trim() !== '') {
                    tagText = value.trim()
                  } else if (typeof value === 'number' || typeof value === 'boolean') {
                    tagText = String(value)
                  } else if (key && key !== 'none' && !key.startsWith('tag_')) {
                    tagText = key
                  } else if (key && key.startsWith('tag_')) {
                    return null
                  }
                  return tagText && tagText.trim() !== '' ? tagText.trim() : null
                })
                .filter((tag): tag is string => tag !== null)
            } else if (deck.cards && Array.isArray(deck.cards)) {
              const providesSet = new Set<string>()
              deck.cards.forEach((card: any) => {
                if (card && typeof card === 'object') {
                  const provides = card.provides || card.Provides
                  if (provides) {
                    if (typeof provides === 'string') {
                      provides.split(',').forEach((p: string) => {
                        const trimmed = p.trim()
                        if (trimmed) {
                          providesSet.add(trimmed)
                        }
                      })
                    } else if (Array.isArray(provides)) {
                      provides.forEach((p: string) => {
                        if (p && typeof p === 'string') {
                          const trimmed = p.trim()
                          if (trimmed) {
                            providesSet.add(trimmed)
                          }
                        }
                      })
                    }
                  }
                }
              })
              tagsToDisplay = Array.from(providesSet).sort()
            }
            if (tagsToDisplay.length === 0) return null
            return (
              <Group gap="xs" className="mt-2 flex-wrap">
                {tagsToDisplay.map((tagText) => (
                  <Badge key={`${deck.id}-${tagText}`} color="violet" variant="light" size="sm">
                    {tagText.toUpperCase()}
                  </Badge>
                ))}
              </Group>
            )
          })()}
        </Stack>
      </Paper>
    </Grid.Col>
  )
})

const FusedDeckCard = memo(function FusedDeckCard({
  deck,
  sourceDecks,
  handleDeckClick,
  deckTagsMap,
  allDecks,
  fusedExpiryResolver,
}: {
  deck: Deck
  sourceDecks?: [Deck | null, Deck | null]
  handleDeckClick: (deck: Deck) => void
  deckTagsMap?: Record<string, string[]>
  allDecks?: Deck[]
  fusedExpiryResolver: (deck: Deck, allDecks: Deck[]) => {
    isExpired: boolean
    isExpiring: boolean
    expireDate: string | null
    minExpiredDate: string | null
    minExpiringDate: string | null
  }
}) {
  const [renderNow] = useState(() => Date.now())
  const fusedDeckAny = deck as any
  const [deck1, deck2] = sourceDecks || [null, null]

  // Helper to pull cards from any deck-like object
  const extractCards = useCallback((d: any): any[] => {
    if (!d || typeof d !== 'object') return []
    if (Array.isArray(d.cardList) && d.cardList.length > 0) return d.cardList
    if (Array.isArray(d.cards) && d.cards.length > 0) return d.cards
    if (d.cards && typeof d.cards === 'object') {
      const values = Object.values(d.cards)
      if (values.length > 0) return values
    }
    if (Array.isArray(d.cardIds) && d.cardIds.length > 0) {
      return d.cardIds.map((id: string, idx: number) => ({ id, cardId: id, name: id, title: id, _idx: idx }))
    }
    return []
  }, [])

  // Fast lookup map for all decks by id (when provided)
  const allDecksMap = useMemo(() => {
    if (!Array.isArray(allDecks)) return new Map<string, Deck>()
    const m = new Map<string, Deck>()
    allDecks.forEach(d => {
      if (d?.id) m.set(d.id, d)
    })
    return m
  }, [allDecks])

  const pluralize = (count: number, one: string, many?: string) =>
    `${count} ${count === 1 ? one : many || `${one}s`}`

  // Pick first two available source decks: prefer myDecks, then provided sourceDecks, then fusedDeckIds from allDecks
  const sourceCandidates: Deck[] = []
  if (Array.isArray(fusedDeckAny.myDecks)) {
    fusedDeckAny.myDecks.forEach((d: any) => {
      if (d && typeof d === 'object') sourceCandidates.push(d as Deck)
    })
  }
  if (deck1) sourceCandidates.push(deck1)
  if (deck2) sourceCandidates.push(deck2)
  if (sourceCandidates.length < 2 && Array.isArray(fusedDeckAny.fusedDeckIds) && Array.isArray(allDecks)) {
    fusedDeckAny.fusedDeckIds.forEach((id: string) => {
      const found = allDecks.find(d => d.id === id)
      if (found) {
        sourceCandidates.push(found)
      }
    })
  }
  const pickedSources = sourceCandidates.slice(0, 2)

  const deriveSetFromId = useCallback((id?: string | null): string | null => {
    if (!id || typeof id !== 'string') return null
    const lower = id.toLowerCase()
    if (lower.startsWith('s1-')) return 'S1'
    if (lower.startsWith('s2-')) return 'S2'
    if (lower.startsWith('s3-')) return 'S3'
    if (lower.startsWith('s4-')) return 'S4'
    return null
  }, [])

  const factionSets: Array<{ faction: string; setNo: string | number | null }> = useMemo(() => {
    const list: Array<{ faction: string; setNo: string | number | null }> = []
    pickedSources.forEach((src) => {
      if (src?.faction) {
        let setNo = getDeckSet(src) || deriveSetFromId((src as any).id)
        if (!setNo && src.id && allDecksMap.has(src.id)) {
          const mapped = allDecksMap.get(src.id)
          if (mapped) {
            setNo = getDeckSet(mapped) || deriveSetFromId((mapped as any)?.id)
          }
        }
        list.push({ faction: src.faction, setNo: setNo || null })
      }
    })
    if (list.length === 0 && deck.faction) {
      const deckSet = getDeckSet(deck) || deriveSetFromId(deck.id)
      list.push({ faction: deck.faction, setNo: deckSet || null })
    }
    return list
  }, [pickedSources, deck, deriveSetFromId, allDecksMap])
  // Collect cards for rarity counts and tags display
  const aggregateCards = useCallback((): any[] => {
    const cards: any[] = []

    // 1) Try myDecks halves; if they lack cards, fill from allDecks by id
    if (Array.isArray(fusedDeckAny.myDecks)) {
      fusedDeckAny.myDecks.forEach((d: any) => {
        const fromSelf = extractCards(d)
        if (fromSelf.length > 0) {
          cards.push(...fromSelf)
        } else if (d?.id && allDecksMap.has(d.id)) {
          const mapped = extractCards(allDecksMap.get(d.id))
          if (mapped.length > 0) cards.push(...mapped)
        }
      })
    }

    // 2) Otherwise, use pickedSources (from props or fusedDeckIds from allDecks)
    if (cards.length === 0) {
      pickedSources.forEach(src => {
        if (!src) return
        const extracted = extractCards(src)
        if (extracted.length > 0) {
          cards.push(...extracted)
        } else if (src.id && allDecksMap.has(src.id)) {
          const mapped = extractCards(allDecksMap.get(src.id))
          if (mapped.length > 0) cards.push(...mapped)
        }
      })
    }

    // 3) If still empty, try fusedDeckIds lookup directly
    if (cards.length === 0 && Array.isArray(fusedDeckAny.fusedDeckIds)) {
      fusedDeckAny.fusedDeckIds.forEach((id: string) => {
        const mapped = id && allDecksMap.has(id) ? extractCards(allDecksMap.get(id)) : []
        if (mapped.length > 0) cards.push(...mapped)
      })
    }

    // 4) If still empty, fallback to cards on fused deck itself
    if (cards.length === 0) {
      cards.push(...extractCards(deck))
    }

    // Also add Solbind cards from solbindCards arrays and forgeborn.solbindCards
    const solbindSet = new Set<string>()
    const solbindCards: any[] = []

    const maybeAddSolbind = (sb: any) => {
      if (sb && typeof sb === 'object' && sb.id) {
        if (!solbindSet.has(sb.id)) {
          solbindSet.add(sb.id)
          solbindCards.push(getCardInfo(sb.id, sb))
        }
      }
    }

    // From cards' solbindCards
    cards.forEach((card: any, idx: number) => {
      const cardData = typeof card === 'string' ? getCardInfo(card) : getCardInfo(card.id || card.cardId || card.name || `card-${idx}`, card)
      if (cardData && (cardData as any).solbindCards && Array.isArray((cardData as any).solbindCards)) {
        ;(cardData as any).solbindCards.forEach((sb: any) => maybeAddSolbind(sb))
      }
    })

    // From deck forgeborn solbindCards
    if (deck && (deck as any).forgeborn && Array.isArray((deck as any).forgeborn.solbindCards)) {
      ;(deck as any).forgeborn.solbindCards.forEach((sb: any) => maybeAddSolbind(sb))
    }

    return [...cards, ...solbindCards]
  }, [deck, fusedDeckAny.myDecks, fusedDeckAny.fusedDeckIds, allDecksMap, pickedSources, extractCards])

  // Memoize aggregated cards to avoid recomputation across derived calculations
  const aggregatedCards = useMemo(() => aggregateCards(), [aggregateCards])

  const fusedSetLabels = useMemo(() => {
    const setLabels = new Set<string>()
    factionSets.forEach(item => {
      if (item.setNo) {
        const label = formatSetName(item.setNo)
        if (label) setLabels.add(label)
      }
    })

    if (setLabels.size === 0) {
      const hasB1 = aggregatedCards.some(card => isB1Card(card as any))
      if (hasB1) setLabels.add(formatSetName('B1') || 'B1')
      const parentSet = getDeckSet(deck)
      if (parentSet) {
        const label = formatSetName(parentSet)
        if (label) setLabels.add(label)
      }
    }

    return Array.from(setLabels)
  }, [factionSets, aggregatedCards, deck])

  const counts = useMemo(() => {
    if (deck.computed?.counts && deck.computed.counts.total > 0) return deck.computed.counts
    if (aggregatedCards.length > 0) {
      let creatures = 0
      let spells = 0
      let solbind = 0
      const solbindIds = new Set<string>()
      aggregatedCards.forEach((card: any, idx: number) => {
        const info = typeof card === 'string'
          ? getCardInfo(card)
          : getCardInfo(card.id || card.cardId || card.name || `card-${idx}`, card)
        const cardData = info as any

        const cardTypeRaw = (cardData.cardType || cardData.card_type || '').toLowerCase()
        const typeRaw = (cardData.type || '').toLowerCase()
        const isForgeborn = cardTypeRaw.includes('forgeborn') || typeRaw.includes('forgeborn')
        if (isForgeborn) return

        const isParentSolbind =
          (Array.isArray(cardData.solbindCards) && cardData.solbindCards.length > 0) ||
          !!(cardData.solbindId1 || cardData.solbindid1 || cardData.solbindId2 || cardData.solbindid2)

        const isSpell = cardTypeRaw.includes('spell') && !cardTypeRaw.includes('creature')
        const isSolbind =
          !isParentSolbind &&
          cardData.rarity &&
          String(cardData.rarity).toLowerCase().includes('solbind')

        if (isParentSolbind) {
          if (isSpell) {
            spells += 1
          } else {
            creatures += 1
          }
          if (Array.isArray(cardData.solbindCards)) {
            cardData.solbindCards.forEach((sb: any) => {
              const sid = sb?.id
              if (sid) solbindIds.add(sid)
            })
          }
          if (cardData.solbindId1) solbindIds.add(cardData.solbindId1)
          if (cardData.solbindid1) solbindIds.add(cardData.solbindid1)
          if (cardData.solbindId2) solbindIds.add(cardData.solbindId2)
          if (cardData.solbindid2) solbindIds.add(cardData.solbindid2)
          return
        }

        if (isSolbind) {
          solbindIds.add(cardData.id || cardData.cardId || cardData.name || `card-${idx}`)
          return
        }

        if (isSpell) {
          spells += 1
        } else {
          creatures += 1
        }
      })

      solbind += solbindIds.size

      if (solbind === 1) {
        solbind = 2
      }
      return { total: creatures + spells + solbind, creatures, spells, solbind }
    }

    const sources = pickedSources.filter(Boolean) as Deck[]
    if (sources.length > 0) {
      const summed = sources.reduce(
        (acc, src) => {
          const c = countPlayableCards(src)
          return {
            total: acc.total + c.total,
            creatures: acc.creatures + c.creatures,
            spells: acc.spells + c.spells,
            solbind: acc.solbind + c.solbind,
          }
        },
        { total: 0, creatures: 0, spells: 0, solbind: 0 }
      )
      if (summed.total > 0) return summed
    }
    if (deck.cards && Array.isArray(deck.cards) && deck.cards.length > 0) {
      return countPlayableCards(deck)
    }
    return { total: 0, creatures: 0, spells: 0, solbind: 0 }
  }, [aggregatedCards, deck, pickedSources])

  const rarityCounts = useMemo(() => {
    if (deck.computed?.rarityCounts) {
      return new Map(Object.entries(deck.computed.rarityCounts))
    }

    const cards = aggregatedCards
    const counts = new Map<string, number>()

    let parentSolbindCount = 0

    cards.forEach((card: any, idx: number) => {
      const info =
        typeof card === 'string'
          ? getCardInfo(card)
          : getCardInfo(card.id || card.cardId || card.name || `card-${idx}`, card)
      const rarity = (info as any)?.rarity
      const cardData = info as any
      const isParentSolbind = !!(cardData.solbindCards && Array.isArray(cardData.solbindCards) && cardData.solbindCards.length > 0)
      const isSolbindRarity = rarity && typeof rarity === 'string' && rarity.toLowerCase().includes('solbind')
      if (isParentSolbind && isSolbindRarity) {
        parentSolbindCount += 1
      }
      if (!isParentSolbind && rarity && typeof rarity === 'string') {
        let normalized = rarity.trim()
        const lower = normalized.toLowerCase()
        if (lower.includes('n/a')) return
        if (normalized.includes('Common') && normalized.includes('Rare')) normalized = 'Common Rare'
        else if (lower.includes('common')) normalized = 'Common'
        else if (lower.includes('rare')) normalized = 'Rare'
        else if (lower.includes('ls') || lower.includes('legendary'))
          normalized = 'LS'
        counts.set(normalized, (counts.get(normalized) || 0) + 1)
      }
    })
    if (parentSolbindCount > 0) {
      counts.set('Solbind', (counts.get('Solbind') || 0) + parentSolbindCount)
    }
    return counts
  }, [aggregatedCards, deck.computed])

  let { borderColor, hoverBorderColor } = getBorderColors(deck, renderNow)

  // Expire badge data (supports both regular and fused decks)
  const isFusedDeck = String((deck as any).format || '').toLowerCase() === 'fused'

  const { expireLabel, isExpired, isExpiring } = useMemo(() => {
    const allDecksArr = Array.isArray(allDecks) ? allDecks : []
    const computeFlags = (dateStr: string | null) => {
      if (!dateStr) return { label: null, expired: false, expiring: false }
      const ts = Date.parse(dateStr)
      if (!Number.isFinite(ts)) return { label: null, expired: false, expiring: false }
      const label = new Date(ts).toLocaleDateString('en-GB', {
        day: 'numeric',
        month: 'short',
        year: 'numeric',
      })
      return { label, expired: ts < renderNow, expiring: ts >= renderNow }
    }
    if (isFusedDeck) {
      const status = fusedExpiryResolver(deck, allDecksArr)
      const { label, expired, expiring } = computeFlags(status.expireDate)
      // Prioritize resolver flags (based on halves), fallback to parsed date flags
      const expiredFlag = status.isExpired || expired
      const expiringFlag = status.isExpiring || expiring
      return { expireLabel: label, isExpired: expiredFlag, isExpiring: expiringFlag }
    }
    const ts = getExpiryTimestamp(deck)
    if (ts === null) return { expireLabel: null, isExpired: false, isExpiring: false }
    const { label, expired, expiring } = computeFlags(new Date(ts).toISOString())
    return { expireLabel: label, isExpired: expired, isExpiring: expiring }
  }, [deck, allDecks, renderNow, fusedExpiryResolver, isFusedDeck])

  // Override border colors for fused decks based on expiry status
  if (isFusedDeck) {
    if (isExpired) {
      borderColor = 'rgba(0, 0, 0, 1)'
      hoverBorderColor = 'rgba(0, 0, 0, 1)'
    } else if (isExpiring) {
      borderColor = 'rgba(220, 38, 38, 0.8)'
      hoverBorderColor = 'rgba(220, 38, 38, 1)'
    }
  }
  const hasFactionSetBadges = useMemo(
    () => factionSets.some(item => !!(item.setNo && formatSetName(item.setNo))),
    [factionSets]
  )

  return (
    <Grid.Col key={deck.id} span={{ base: 12, sm: 6, md: 4 }}>
      <Paper
        data-deck-id={deck.id}
        p="lg"
        onClick={() => handleDeckClick(deck)}
        className="border border-sf-primary/20 rounded-xl cursor-pointer"
        style={{
          backgroundColor: 'rgba(30, 41, 59, 0.5)',
          borderColor,
          boxShadow: '0 2px 4px rgba(0, 0, 0, 0.12)',
          minHeight: 360,
          transition: 'border-color 0.1s ease',
          overflow: 'hidden',
        }}
        onMouseEnter={(e) => {
          e.currentTarget.style.borderColor = hoverBorderColor
        }}
        onMouseLeave={(e) => {
          e.currentTarget.style.borderColor = borderColor
        }}
      >
        <Stack gap="sm">
          <Group justify="space-between" align="flex-start" wrap="nowrap">
            <Title order={4} className="text-white flex-1" lineClamp={2}>
              {deck.name || 'Untitled'}
            </Title>
          </Group>

          <Group gap="xs" wrap="wrap" align="center">
            {factionSets.map((item, idx) => {
              const setLabel = item.setNo ? formatSetName(item.setNo) : null
              return (
                <Group key={`${deck.id}-faction-${idx}`} gap="xs" align="center">
                  <Image
                    src={`/images/icons/${item.faction.toLowerCase()}.png`}
                    alt={item.faction}
                    h={18}
                    w="auto"
                    style={{ display: 'inline-block', verticalAlign: 'middle', flexShrink: 0 }}
                  />
                  {setLabel && (
                    <Badge color="indigo" variant="light" size="sm">
                      {setLabel}
                    </Badge>
                  )}
                </Group>
              )
            })}
            {!hasFactionSetBadges &&
              fusedSetLabels.map(label => (
                <Badge key={`${deck.id}-set-fallback-${label}`} color="indigo" variant="light" size="sm">
                  {label}
                </Badge>
              ))}
            {expireLabel && (
              <Badge
                variant="filled"
                size="sm"
                radius="sm"
                style={
                  isExpired
                    ? { backgroundColor: '#000', color: '#fff', border: '1px solid #000' }
                    : { backgroundColor: '#b32626', color: '#fff', border: '1px solid #b32626' }
                }
              >
                Expire: {expireLabel}
              </Badge>
            )}
            <Badge color="blue" variant="light" size="sm" leftSection={<IconCards size={12} />}>
              {pluralize(counts.total, 'card')}
            </Badge>
            {(deck as any).deckRank && (
              <Badge color="orange" variant="light" size="sm">
                {(deck as any).deckRank}
              </Badge>
            )}
          </Group>

          <Group gap="xs" wrap="wrap">
            <Badge color="green" variant="light" size="sm">
              {pluralize(counts.creatures, 'Creature')}
            </Badge>
            <Badge color="pink" variant="light" size="sm">
              {pluralize(counts.spells, 'Spell')}
            </Badge>
            {counts.solbind > 0 && (
              <Badge color="orange" variant="light" size="sm">
                {pluralize(counts.solbind, 'Solbind')}
              </Badge>
            )}
          </Group>

          {(() => {
            if (rarityCounts.size === 0) return null
            const getRarityColor = (rarityName: string): string => {
              const normalized = rarityName.toLowerCase()
              if (normalized.includes('solbind')) return '#2dd4bf'
              if (normalized.includes('common') && normalized.includes('rare')) return '#0e87cf'
              if (normalized.includes('rare') && !normalized.includes('common')) return '#e6b70c'
              if (normalized.includes('common')) return '#1199e3'
              if (normalized.includes('ls')) return '#a90100'
              return '#1199e3'
            }
            return (
              <Group gap="xs" className="flex-wrap">
                {Array.from(rarityCounts.entries())
                  .sort(([a], [b]) => {
                    const order: Record<string, number> = {
                      Solbind: 0,
                      Common: 1,
                      'Common Rare': 2,
                      Rare: 3,
                      LS: 4,
                    }
                    return (order[a] || 99) - (order[b] || 99)
                  })
                  .map(([rarity, count]) => (
                    <Badge
                      key={`${deck.id}-${rarity}`}
                      variant="light"
                      size="sm"
                      style={{ backgroundColor: getRarityColor(rarity), color: 'white', border: 'none' }}
                    >
                      {pluralize(count, rarity)}
                    </Badge>
                  ))}
              </Group>
            )
          })()}

          {(() => {
            const receiptDate = (deck as any).updatedAt
            if (!receiptDate) return null
            return (
              <Group gap="xs" className="text-gray-400 text-sm">
                <IconCalendar size={14} />
                <Text size="xs">
                  Updated at:{' '}
                  {new Date(receiptDate).toLocaleDateString('en-GB', {
                    day: 'numeric',
                    month: 'short',
                    year: 'numeric',
                  })}
                </Text>
              </Group>
            )
          })()}

          {(() => {
            const tagSet = new Set<string>()

            // Tags on the fused deck itself
            if (deck.tags && typeof deck.tags === 'object' && !Array.isArray(deck.tags)) {
              Object.entries(deck.tags).forEach(([key, value]) => {
                if (value === null || value === undefined || value === '') return
                if (typeof value === 'string' && value.trim()) tagSet.add(value.trim())
                else if (typeof value === 'number' || typeof value === 'boolean') tagSet.add(String(value))
                else if (key && key !== 'none' && !key.startsWith('tag_')) tagSet.add(key)
              })
            }

            // Precomputed tags for fused deck id
            if (deckTagsMap && deckTagsMap[deck.id]?.length) {
              deckTagsMap[deck.id].forEach((t: string) => {
                if (t && typeof t === 'string' && t.trim()) tagSet.add(t.trim())
              })
            }

            // Tags from source halves
            pickedSources.forEach(src => {
              if (src?.tags && typeof src.tags === 'object' && !Array.isArray(src.tags)) {
                Object.entries(src.tags).forEach(([key, value]) => {
                  if (value === null || value === undefined || value === '') return
                  if (typeof value === 'string' && value.trim()) tagSet.add(value.trim())
                  else if (typeof value === 'number' || typeof value === 'boolean') tagSet.add(String(value))
                  else if (key && key !== 'none' && !key.startsWith('tag_')) tagSet.add(key)
                })
              }
              if (src?.id && deckTagsMap && deckTagsMap[src.id]?.length) {
                deckTagsMap[src.id].forEach((t: string) => {
                  if (t && typeof t === 'string' && t.trim()) tagSet.add(t.trim())
                })
              }
            })

            // Fallback: collect provides from cards
            if (tagSet.size === 0) {
              const providesSet = new Set<string>()
              aggregatedCards.forEach((card: any) => {
                if (card && typeof card === 'object') {
                  const provides = card.provides || card.Provides
                  if (provides) {
                    if (typeof provides === 'string') {
                      provides.split(',').forEach((p: string) => {
                        const trimmed = p.trim()
                        if (trimmed) providesSet.add(trimmed)
                      })
                    } else if (Array.isArray(provides)) {
                      provides.forEach((p: string) => {
                        if (p && typeof p === 'string') {
                          const trimmed = p.trim()
                          if (trimmed) providesSet.add(trimmed)
                        }
                      })
                    }
                  }
                }
              })
              providesSet.forEach(t => tagSet.add(t))
            }

            const tagsToDisplay = Array.from(tagSet)
            if (tagsToDisplay.length === 0) return null
            return (
              <Group gap="xs" className="mt-2 flex-wrap">
                {tagsToDisplay.map((tagText) => (
                  <Badge key={`${deck.id}-${tagText}`} color="violet" variant="light" size="sm">
                    {tagText.toUpperCase()}
                  </Badge>
                ))}
              </Group>
            )
          })()}
        </Stack>
      </Paper>
    </Grid.Col>
  )
})

interface DeckListProps {
  decks: Deck[]
  fusedDecks?: Deck[]
  precomputedTags?: string[]
  precomputedCardNames?: string[]
  precomputedDeckNames?: string[]
  precomputedForgebornNames?: string[]
  deckTagsMap?: Record<string, string[]>
}

interface FilterState {
  faction: string[]
  forgebornName: string[]
  cardName: string[]
  cardText: string
  tags: string[]
  rarityType: string
  rarityCount: number | null
  expiryFilter: 'all' | 'active' | 'expiring' | 'expired'
  sortBy: string
  creaturesOperator: '>=' | '<=' | '='
  creaturesValue: number | null
  freeCreaturesOperator: '>=' | '<=' | '='
  freeCreaturesValue: number | null
  creatureType: string
  creatureTypeCount: number | null
  spellsOperator: '>=' | '<=' | '='
  spellsValue: number | null
  freeSpellsOperator: '>=' | '<=' | '='
  freeSpellsValue: number | null
  spellType: string
  spellTypeCount: number | null
  deckName: string
  cardSetNo: string[]
  eloOperator: '>=' | '<=' | '='
  eloValue: number | null
  scoreOperator: '>=' | '<=' | '='
  scoreValue: number | null
}

type ViewMode = 'decks' | 'fused'

export function DeckList({ decks, fusedDecks = [], precomputedTags, precomputedCardNames, precomputedDeckNames, precomputedForgebornNames, deckTagsMap = {} }: DeckListProps) {
  const PAGE_SIZE = 300
  const [selectedDeck, setSelectedDeck] = useState<Deck | null>(null)
  const [detailsOpened, setDetailsOpened] = useState(false)
  const [parentFusedDeck, setParentFusedDeck] = useState<Deck | null>(null)
  const [filtersOpened, setFiltersOpened] = useState(false)
  const [viewMode, setViewMode] = useState<ViewMode>('decks')
  const [regularPage, setRegularPage] = useState(1)
  const [fusedPage, setFusedPage] = useState(1)
  
  const [filters, setFilters] = useState<FilterState>({
    faction: [],
    forgebornName: [],
    cardName: [],
    cardText: '',
    tags: [],
    rarityType: '',
    rarityCount: null,
    expiryFilter: 'active', // Default: show active decks (no dates + expiring)
    sortBy: 'date-desc', // Default: newest first
    creaturesOperator: '>=',
    creaturesValue: null,
    freeCreaturesOperator: '>=',
    freeCreaturesValue: null,
    creatureType: '',
    creatureTypeCount: null,
    spellsOperator: '>=',
    spellsValue: null,
    freeSpellsOperator: '>=',
    freeSpellsValue: null,
    spellType: '',
    spellTypeCount: null,
    deckName: '',
    cardSetNo: [],
    eloOperator: '>=',
    eloValue: null,
    scoreOperator: '>=',
    scoreValue: null,
  })
  
  // Debounced filters for text inputs (0.5 second delay)
  // Use Mantine's useDebouncedValue with trailing: true (default behavior)
  const [debouncedFilters] = useDebouncedValue(filters, 500)
  
  // Ref to store scroll position and first visible deck ID
  const scrollPositionRef = useRef<number>(0)
  // Track only scroll position; skip expensive DOM scans for first visible card
  const firstVisibleDeckIdRef = useRef<string | null>(null)
  const shouldRestoreScrollRef = useRef<boolean>(false)
  const gridContainerRef = useRef<HTMLDivElement>(null)
  
  // Collect all unique card names from all decks for the dropdown
  const allCardNames = useMemo(() => {
    if (precomputedCardNames && precomputedCardNames.length > 0) {
      return precomputedCardNames
    }

    const cardNamesSet = new Set<string>()
    decks.forEach(deck => {
      if (deck.cards && Array.isArray(deck.cards)) {
        deck.cards.forEach((card: any) => {
          const cardInfo = typeof card === 'string'
            ? getCardInfo(card)
            : getCardInfo(card.id || card.cardId || card.name || '', card)
          if (cardInfo.name && cardInfo.name.trim()) {
            cardNamesSet.add(cardInfo.name)
          }
        })
      }
    })
    return Array.from(cardNamesSet).sort()
  }, [decks, precomputedCardNames])
  
  // Collect all unique deck names from all decks for the dropdown
  const allDeckNames = useMemo(() => {
    if (precomputedDeckNames && precomputedDeckNames.length > 0) return precomputedDeckNames
    const deckNamesSet = new Set<string>()
    const allDecks = [...decks, ...fusedDecks]
    allDecks.forEach(deck => {
      if (deck.name && deck.name.trim()) {
        deckNamesSet.add(deck.name.trim())
      }
    })
    return Array.from(deckNamesSet).sort()
  }, [decks, fusedDecks, precomputedDeckNames])
  
  // Helper function to extract Forgeborn name from a deck
  const getForgebornNameFromDeck = (deck: Deck): string | null => {
    // Try to get Forgeborn from deck.forgeborn first (has title property)
    if (deck.forgeborn) {
      // getCardInfo will handle title vs name preference for Forgeborn
      if (typeof deck.forgeborn === 'object' && deck.forgeborn.id) {
        const forgebornInfo = getCardInfo(deck.forgeborn.id, deck.forgeborn)
        if (forgebornInfo.name) {
          return forgebornInfo.name
        }
      }
      // Fallback for direct title/name
      const name = (deck.forgeborn as any).title || (deck.forgeborn as any).name
      if (name) {
        return name
      }
    }
    
    // Also check in cards
    if (deck.cards && Array.isArray(deck.cards)) {
      const normalizedCards = deck.cards.map((card: any, index: number) => {
        if (typeof card === 'string') {
          return getCardInfo(card)
        } else if (typeof card === 'object' && card !== null) {
          const cardId = card.id || card.cardId || card.name || `card-${index}`
          return getCardInfo(cardId, card)
        }
        return getCardInfo(`card-${index}`)
      })
      
      // Find Forgeborn by forgebornId
      if (deck.forgebornId) {
        const forgeborn = normalizedCards.find(card => 
          card.id === deck.forgebornId || 
          (card.id && deck.forgebornId && card.id.includes(deck.forgebornId)) ||
          (deck.forgebornId && card.id && deck.forgebornId.includes(card.id))
        )
        if (forgeborn && forgeborn.name) {
          return forgeborn.name // getCardInfo already prefers title for Forgeborn
        }
      }
      
      // Find Forgeborn by cardType
      const forgebornByType = normalizedCards.find(card =>
        card.type?.toLowerCase().includes('forgeborn') ||
        (card as any).cardType?.toLowerCase().includes('forgeborn')
      )
      if (forgebornByType && forgebornByType.name) {
        return forgebornByType.name // getCardInfo already prefers title for Forgeborn
      }
    }
    
    return null
  }
  
  // Collect all unique Forgeborn names from all decks (regular + fused) for the dropdown
  const allForgebornNames = useMemo(() => {
    if (precomputedForgebornNames && precomputedForgebornNames.length > 0) return precomputedForgebornNames
    const forgebornNamesSet = new Set<string>()
    decks.forEach(deck => {
      const forgebornName = getForgebornNameFromDeck(deck)
      if (forgebornName) forgebornNamesSet.add(forgebornName)
    })
    fusedDecks.forEach(deck => {
      const forgebornName = getForgebornNameFromDeck(deck)
      if (forgebornName) forgebornNamesSet.add(forgebornName)
    })
    return Array.from(forgebornNamesSet).sort()
  }, [decks, fusedDecks, precomputedForgebornNames])
  
  // Collect all unique tags from all decks for the dropdown
  const allTags = useMemo(() => {
    if (precomputedTags && precomputedTags.length > 0) {
      return [...precomputedTags].sort()
    }

    const tagsSet = new Set<string>()
    
    // Process both regular decks and fused decks
    const allDecks = [...decks, ...fusedDecks]
    
    allDecks.forEach(deck => {
      // Collect tags from deck.tags
      if (deck.tags && typeof deck.tags === 'object' && !Array.isArray(deck.tags)) {
        Object.entries(deck.tags).forEach(([key, value]) => {
          // Skip empty tags and tags with empty values
          if (value === null || value === undefined || value === '') {
            return
          }
          
          // Skip tags where key is 'none' and value is empty
          if (key === 'none' && (!value || value === '')) {
            return
          }
          
          // Skip if value is a string and empty after trim
          if (typeof value === 'string' && value.trim() === '') {
            return
          }
          
          // Use value if it's a non-empty string, otherwise use key (if key is meaningful)
          let tagText: string | null = null
          
          if (typeof value === 'string' && value.trim() !== '') {
            tagText = value.trim()
          } else if (typeof value === 'number' || typeof value === 'boolean') {
            tagText = String(value)
          } else if (key && key !== 'none' && !key.startsWith('tag_')) {
            // Use key if it's meaningful (not a generated key)
            tagText = key
          }
          
          if (tagText && tagText.trim() !== '') {
            tagsSet.add(tagText.trim())
          }
        })
      }
      
      // Collect tags from card provides
      if (deck.cards && Array.isArray(deck.cards)) {
        deck.cards.forEach((card: any) => {
          if (card && typeof card === 'object') {
            const provides = card.provides || card.Provides
            if (provides) {
              if (typeof provides === 'string') {
                // Split by comma and add each value
                provides.split(',').forEach((p: string) => {
                  const trimmed = p.trim()
                  if (trimmed) {
                    tagsSet.add(trimmed)
                  }
                })
              } else if (Array.isArray(provides)) {
                provides.forEach((p: string) => {
                  if (p && typeof p === 'string') {
                    const trimmed = p.trim()
                    if (trimmed) {
                      tagsSet.add(trimmed)
                    }
                  }
                })
              }
            }
          }
        })
      }
    })
    
    return Array.from(tagsSet).sort()
  }, [decks, fusedDecks, precomputedTags])
  
  // Collect all unique creature types from all decks for the dropdown with counts
  const allCreatureTypes = useMemo(() => {
    const creatureTypesMap = new Map<string, number>() // type -> count of cards with this type
    
    // Process both regular decks and fused decks
    const allDecks = [...decks, ...fusedDecks]
    
    allDecks.forEach(deck => {
      if (!deck.cards || !Array.isArray(deck.cards)) return
      
      // Normalize cards
      const normalizedCards = deck.cards.map((card: any, index: number) => {
        if (typeof card === 'string') {
          return getCardInfo(card)
        } else if (typeof card === 'object' && card !== null) {
          const cardId = card.id || card.cardId || card.name || `card-${index}`
          return getCardInfo(cardId, card)
        }
        return getCardInfo(`card-${index}`)
      })
      
      normalizedCards.forEach(card => {
        const cardData = card as any
        const name = card.name?.toLowerCase() || ''
        
        // Check if it's a creature (not a spell) - use ONLY cardType
        const originalCardForType = deck.cards && Array.isArray(deck.cards)
          ? deck.cards.find((c: any, idx: number) => {
              if (typeof c === 'string') {
                return c === card.id
              }
              const cId = c?.id || c?.cardId || c?.name || `card-${idx}`
              return cId === card.id
            })
          : null
        const originalCardType = originalCardForType && typeof originalCardForType === 'object'
          ? (originalCardForType.cardType || originalCardForType.card_type || '')
          : ''
        const cardType = cardData.cardType || cardData.card_type || originalCardType || ''
        const lowerCardType = cardType.toLowerCase()
        const isSpell = lowerCardType.includes('spell') && !lowerCardType.includes('creature')
        
        if (!isSpell) {
          // It's a creature - collect types from cardSubType
          // cardSubType can contain multiple types separated by spaces, e.g., "Beast Warrior"
          const subType = cardData.cardSubType || cardData.CardSubType || cardData.CARDSUBTYPE || 
                          cardData.SubType || cardData.subType || cardData.SUBTYPE
          if (subType && typeof subType === 'string' && subType.trim()) {
            // Split by spaces and add each word as a separate type
            const types = subType.trim().split(/\s+/).filter(t => t.length > 0)
            types.forEach(type => {
              // Capitalize first letter for consistency
              const capitalized = type.charAt(0).toUpperCase() + type.slice(1).toLowerCase()
              
              // Count each card with this type (increment for each card)
              creatureTypesMap.set(capitalized, (creatureTypesMap.get(capitalized) || 0) + 1)
            })
          }
        }
      })
    })
    
    // Return sorted array of unique types
    return Array.from(creatureTypesMap.keys()).sort()
  }, [decks, fusedDecks])
  
  // Collect all unique spell types from all decks for the dropdown (Sub Type only)
  const allSpellTypes = useMemo(() => {
    const spellTypesSet = new Set<string>()
    
    // Process both regular decks and fused decks
    const allDecks = [...decks, ...fusedDecks]
    
    allDecks.forEach(deck => {
      if (!deck.cards || !Array.isArray(deck.cards)) return
      
      // Normalize cards
      const normalizedCards = deck.cards.map((card: any, index: number) => {
        if (typeof card === 'string') {
          return getCardInfo(card)
        } else if (typeof card === 'object' && card !== null) {
          const cardId = card.id || card.cardId || card.name || `card-${index}`
          return getCardInfo(cardId, card)
        }
        return getCardInfo(`card-${index}`)
      })
      
      normalizedCards.forEach(card => {
        const cardData = card as any
        const name = card.name?.toLowerCase() || ''
        
        // Get original card data from deck.cards by ID to ensure we have all fields
        const originalCard = deck.cards && Array.isArray(deck.cards)
          ? deck.cards.find((c: any) => {
              const cId = typeof c === 'string' ? c : (c?.id || c?.cardId)
              return cId === card.id
            })
          : null
        
        // Check if it's a spell - use ONLY cardType
        const originalCardType = originalCard && typeof originalCard === 'object' 
          ? (originalCard.cardType || originalCard.card_type || '')
          : ''
        const cardType = cardData.cardType || cardData.card_type || originalCardType || ''
        const lowerCardType = cardType.toLowerCase()
        const isSpell = lowerCardType.includes('spell') && !lowerCardType.includes('creature')
        
        if (isSpell) {
          // It's a spell - collect types from cardSubType
          // cardSubType can contain multiple types separated by spaces, e.g., "Exalt Ritual"
          // Prefer original data as it may have more complete information
          const originalSubType = originalCard && typeof originalCard === 'object'
            ? (originalCard.cardSubType || originalCard.CardSubType || originalCard.CARDSUBTYPE ||
               originalCard.SubType || originalCard.subType || originalCard.SUBTYPE)
            : null
          const normalizedSubType = cardData.cardSubType || cardData.CardSubType || cardData.CARDSUBTYPE ||
                          cardData.SubType || cardData.subType || cardData.SUBTYPE
          // Prefer original data if available, otherwise use normalized
          const subType = originalSubType || normalizedSubType
          
          if (subType && typeof subType === 'string' && subType.trim()) {
            // Split by spaces and add each word as a separate type
            const types = subType.trim().split(/\s+/).filter(t => t.length > 0)
            types.forEach(type => {
              // Capitalize first letter for consistency
              const capitalized = type.charAt(0).toUpperCase() + type.slice(1).toLowerCase()
              spellTypesSet.add(capitalized)
            })
          }
        }
      })
    })
    
    return Array.from(spellTypesSet).sort()
  }, [decks, fusedDecks])
  
  // Collect all unique card set numbers from all decks for the dropdown
  const allCardSetNos = useMemo(() => {
    const cardSetNosSet = new Set<string>()
    
    // Process both regular decks and fused decks
    const allDecks = [...decks, ...fusedDecks]
    
    allDecks.forEach(deck => {
      // Use getDeckSet to determine the actual set (B1 if any card is from B1, otherwise deck.cardSetNo)
      const deckSet = getDeckSet(deck)
      if (deckSet) {
        cardSetNosSet.add(deckSet)
      }
    })
    
    return Array.from(cardSetNosSet).sort((a, b) => {
      // Sort B1 first, then numerically for S sets
      if (a.toUpperCase() === 'B1') return -1
      if (b.toUpperCase() === 'B1') return 1
      
      // Sort numerically if both are numbers, otherwise alphabetically
      const numA = Number(a.replace(/^s/i, ''))
      const numB = Number(b.replace(/^s/i, ''))
      if (!isNaN(numA) && !isNaN(numB)) {
        return numA - numB
      }
      return a.localeCompare(b)
    })
  }, [decks, fusedDecks])
  
  // Save scroll position when debouncedFilters change (after debounce delay)
  useEffect(() => {
    // Save scroll position and first visible deck ID before filters are applied
    scrollPositionRef.current = window.scrollY || window.pageYOffset || document.documentElement.scrollTop
    
    // No DOM scans; rely only on saved scroll position
    firstVisibleDeckIdRef.current = null
    shouldRestoreScrollRef.current = true
  }, [debouncedFilters])
  
  // Disable scroll restoration on mount
  useEffect(() => {
    if (typeof window !== 'undefined' && 'scrollRestoration' in history) {
      history.scrollRestoration = 'manual'
    }
  }, [])

  // Use transition for non-blocking UI updates when opening deck details
  const [, startTransition] = useTransition()
  
  const handleDeckClick = useCallback((deck: Deck, parentFused?: Deck | null) => {
    // Set deck data first
    setSelectedDeck(deck)
    // Only set parentFusedDeck if the deck being opened is NOT the parent itself
    if (parentFused && deck.id !== parentFused.id) {
      setParentFusedDeck(parentFused)
    } else {
      setParentFusedDeck(null)
    }
    // Open modal in a transition (allows React to batch updates)
    startTransition(() => {
      setDetailsOpened(true)
    })
  }, [startTransition])
  
  const clearFilters = () => {
    const emptyFilters = {
      faction: [],
      forgebornName: [],
      cardName: [],
      cardText: '',
      tags: [],
      rarityType: '',
      rarityCount: null,
      expiryFilter: 'active' as const,
      sortBy: 'date-desc',
      creaturesOperator: '>=' as const,
      creaturesValue: null,
      freeCreaturesOperator: '>=' as const,
      freeCreaturesValue: null,
      creatureType: '',
      creatureTypeCount: null,
      spellsOperator: '>=' as const,
      spellsValue: null,
      freeSpellsOperator: '>=' as const,
      freeSpellsValue: null,
      spellType: '',
      spellTypeCount: null,
      deckName: '',
      cardSetNo: [],
      eloOperator: '>=' as const,
      eloValue: null,
      scoreOperator: '>=' as const,
      scoreValue: null,
    }
    setFilters(emptyFilters)
    // Note: debouncedFilters will update automatically after 500ms delay
    // For immediate clear, we need to update filters directly
  }
  
  const hasActiveFilters = useMemo(() => {
    return !!(
      debouncedFilters.faction.length > 0 ||
      debouncedFilters.forgebornName.length > 0 ||
      debouncedFilters.cardName.length > 0 ||
      debouncedFilters.cardText ||
      debouncedFilters.tags.length > 0 ||
      (debouncedFilters.rarityType && debouncedFilters.rarityCount !== null) ||
      debouncedFilters.creaturesValue !== null ||
      debouncedFilters.freeCreaturesValue !== null ||
      debouncedFilters.creatureType ||
      (debouncedFilters.spellType && debouncedFilters.spellTypeCount !== null) ||
      debouncedFilters.deckName ||
      debouncedFilters.cardSetNo.length > 0 ||
      debouncedFilters.eloValue !== null ||
      debouncedFilters.scoreValue !== null
    )
  }, [debouncedFilters])
  
  // Helper function to get two source decks from fused deck
  const getFusedDeckSourceDecks = useCallback((fusedDeck: Deck, allDecks: Deck[]): [Deck | null, Deck | null] => {
    const fusedDeckAny = fusedDeck as any
    
    let deck1: Deck | null = null
    let deck2: Deck | null = null
    
    if (fusedDeckAny.myDecks && Array.isArray(fusedDeckAny.myDecks) && fusedDeckAny.myDecks.length >= 2) {
      // Get decks from myDecks array (contains full deck objects)
      const myDeck1 = fusedDeckAny.myDecks[0]
      const myDeck2 = fusedDeckAny.myDecks[1]
      
      // Try to find full deck objects in allDecks by ID
      const deck1Id = myDeck1?.id || myDeck1?.deckId
      const deck2Id = myDeck2?.id || myDeck2?.deckId
      
      if (deck1Id) {
        deck1 = allDecks.find(d => d.id === deck1Id) || null
        if (!deck1 && myDeck1?.name) {
          // Use myDeck1 directly if it has name
          deck1 = myDeck1 as Deck
        }
      }
      
      if (deck2Id) {
        deck2 = allDecks.find(d => d.id === deck2Id) || null
        if (!deck2 && myDeck2?.name) {
          // Use myDeck2 directly if it has name
          deck2 = myDeck2 as Deck
        }
      }
    } else if (fusedDeckAny.fusedDeckIds && Array.isArray(fusedDeckAny.fusedDeckIds) && fusedDeckAny.fusedDeckIds.length >= 2) {
      // Get decks by IDs from allDecks
      deck1 = allDecks.find(d => d.id === fusedDeckAny.fusedDeckIds[0]) || null
      deck2 = allDecks.find(d => d.id === fusedDeckAny.fusedDeckIds[1]) || null
    }
    
    return [deck1, deck2]
  }, [])
  
  // Helper function to get expiry status for fused deck
  // Fused deck is expired if at least one of the two decks is expired
  const getFusedDeckExpiryStatus = useCallback((fusedDeck: Deck, allDecks: Deck[]): {
    isExpired: boolean
    isExpiring: boolean
    expireDate: string | null
    minExpiredDate: string | null
    minExpiringDate: string | null
  } => {
    const currentTimeUTC = Date.now()
    const [deck1, deck2] = getFusedDeckSourceDecks(fusedDeck, allDecks)
    
    const deckDates: Array<{ date: string; isExpired: boolean; isExpiring: boolean }> = []
    const addDeckDate = (d: Deck | null) => {
      if (!d) return
      const ts = getExpiryTimestamp(d)
      if (ts === null) return
      const isExpired = ts < currentTimeUTC
      const isExpiring = ts >= currentTimeUTC
      deckDates.push({ date: new Date(ts).toISOString(), isExpired, isExpiring })
    }

    addDeckDate(deck1)
    addDeckDate(deck2)

    // If source decks missing expiry, fall back to fused deck expiry (if any)
    if (deckDates.length === 0) {
      const fusedTs = getExpiryTimestamp(fusedDeck)
      if (fusedTs !== null) {
        const isExpired = fusedTs < currentTimeUTC
        const isExpiring = fusedTs >= currentTimeUTC
        deckDates.push({ date: new Date(fusedTs).toISOString(), isExpired, isExpiring })
      }
    }
    
    const isExpired = deckDates.some(d => d.isExpired)
    const isExpiring = !isExpired && deckDates.some(d => d.isExpiring)
    
    const expiredDates = deckDates.filter(d => d.isExpired).map(d => d.date)
    const minExpiredDate = expiredDates.length > 0 
      ? expiredDates.reduce((min, date) => (new Date(date).getTime() < new Date(min).getTime() ? date : min))
      : null
    
    const expiringDates = deckDates.filter(d => d.isExpiring).map(d => d.date)
    const minExpiringDate = expiringDates.length > 0 
      ? expiringDates.reduce((min, date) => (new Date(date).getTime() < new Date(min).getTime() ? date : min))
      : null
    
    return {
      isExpired,
      isExpiring,
      expireDate: minExpiredDate || minExpiringDate,
      minExpiredDate,
      minExpiringDate,
    }
  }, [getFusedDeckSourceDecks])
  
  // Regular decks are "half decks" (Decks), and we have separate fusedDecks from API
  // No need to split by card count - use the decks as-is for "Decks" section
  // Filter out expired/expiring temporary decks based on expiryFilter
  // Logic:
  // - 'all': show all decks (including expired and expiring)
  // - 'active': show decks without dates + expiring decks (default)
  // - 'expiring': show only expiring decks (with future expiry date)
  // - 'expired': show only expired decks
  const halfDecks = useMemo(() => {
    const now = Date.now()
    return decks.filter(deck => {
      const expiry = getExpiryTimestamp(deck)
      if (expiry === null) {
        // No expiry info: treat as active unless explicitly filtering only expired/expiring
        if (debouncedFilters.expiryFilter === 'expired') return false
        if (debouncedFilters.expiryFilter === 'expiring') return false
        return true
      }
      const isExpired = expiry < now
      const isExpiring = expiry >= now
      switch (debouncedFilters.expiryFilter) {
        case 'all':
          return true
        case 'active':
          return isExpiring
        case 'expiring':
          return isExpiring
        case 'expired':
          return isExpired
        default:
          return true
      }
    })
  }, [decks, debouncedFilters.expiryFilter])
  
  // Filter fused decks based on expiry status
  const filteredFusedDecksByExpiry = useMemo(() => {
    return fusedDecks.filter(fusedDeck => {
      const expiryStatus = getFusedDeckExpiryStatus(fusedDeck, decks)
      
      switch (debouncedFilters.expiryFilter) {
        case 'all':
          return true // Show all fused decks
        case 'active':
          // Show fused decks that are not expired (either no expiry or expiring)
          return !expiryStatus.isExpired
        case 'expiring':
          // Show only expiring fused decks
          return expiryStatus.isExpiring
        case 'expired':
          // Show only expired fused decks
          return expiryStatus.isExpired
        default:
          return true
      }
    })
  }, [fusedDecks, decks, debouncedFilters.expiryFilter, getFusedDeckExpiryStatus])
  
  // Calculate total decks count for display (respecting expiryFilter and viewMode)
  const totalDecksCount = useMemo(() => {
    const currentTimeUTC = new Date().getTime()
    
    // Count regular decks (respecting expiryFilter)
    let regularDecksCount = 0
    if (viewMode === 'decks') {
      regularDecksCount = decks.filter(deck => {
        const expiry = getExpiryTimestamp(deck)
        if (expiry === null) {
          if (debouncedFilters.expiryFilter === 'expired') return false
          if (debouncedFilters.expiryFilter === 'expiring') return false
          return true
        }
        const isExpired = expiry < currentTimeUTC
        const isExpiring = expiry >= currentTimeUTC
        
        switch (debouncedFilters.expiryFilter) {
          case 'all':
            return true
          case 'active':
            return isExpiring
          case 'expiring':
            return isExpiring
          case 'expired':
            return isExpired
          default:
          return true
        }
      }).length
    }
    
    // Count fused decks (respecting expiryFilter)
    let fusedDecksCount = 0
    if (viewMode === 'fused') {
      fusedDecksCount = fusedDecks.filter(fusedDeck => {
        const expiryStatus = getFusedDeckExpiryStatus(fusedDeck, decks)
        
        switch (debouncedFilters.expiryFilter) {
          case 'all':
            return true
          case 'active':
            return !expiryStatus.isExpired
          case 'expiring':
            return expiryStatus.isExpiring
          case 'expired':
            return expiryStatus.isExpired
          default:
            return true
        }
      }).length
    }
    
    return regularDecksCount + fusedDecksCount
  }, [decks, fusedDecks, viewMode, debouncedFilters.expiryFilter, getFusedDeckExpiryStatus])
  
  // Determine which decks to show based on view mode
  const showHalfDecks = viewMode === 'decks'
  const showFusedDecks = viewMode === 'fused'
  
  // Helper function to filter a deck array based on filter criteria
  const filterDeckArray = useCallback((deckArray: Deck[]) => {
    if (!hasActiveFilters) return deckArray
    
    return deckArray.filter(deck => {
      // Filter by deck name (single select)
      if (debouncedFilters.deckName) {
        if (!deck.name || deck.name.trim() !== debouncedFilters.deckName.trim()) {
          return false
        }
      }
      
      // Filter by faction first (multi-select)
      if (debouncedFilters.faction.length > 0) {
        if (!deck.faction || !debouncedFilters.faction.some(f => 
          deck.faction && deck.faction.toLowerCase() === f.toLowerCase()
        )) {
          return false
        }
      }
      
      // Normalize cards for this deck
      const normalizedCards = deck.cards && Array.isArray(deck.cards) 
        ? deck.cards.map((card: any, index: number) => {
            if (typeof card === 'string') {
              return getCardInfo(card)
            } else if (typeof card === 'object' && card !== null) {
              const cardId = card.id || card.cardId || card.name || `card-${index}`
              return getCardInfo(cardId, card)
            }
            return getCardInfo(`card-${index}`)
          })
        : []
      
      // Find Forgeborn
      let forgeborn: any = null
      if (deck.forgebornId) {
        forgeborn = normalizedCards.find(card => 
          card.id === deck.forgebornId || 
          (card.id && deck.forgebornId && card.id.includes(deck.forgebornId)) ||
          (deck.forgebornId && card.id && deck.forgebornId.includes(card.id))
        )
      }
      if (!forgeborn) {
        forgeborn = normalizedCards.find(card =>
          card.type?.toLowerCase().includes('forgeborn') ||
          (card as any).cardType?.toLowerCase().includes('forgeborn')
        )
      }
      if (!forgeborn && deck.forgeborn) {
        forgeborn = deck.forgeborn
      }
      
      // Filter by Forgeborn name (multi-select) - must match one of selected Forgeborn
      if (debouncedFilters.forgebornName.length > 0) {
        // Use helper function to get Forgeborn name (prefers title for Forgeborn)
        const forgebornName = getForgebornNameFromDeck(deck)
        if (!forgebornName || !debouncedFilters.forgebornName.includes(forgebornName)) {
          return false
        }
      }
      
      // Filter by card name (multi-select) - must contain ALL selected cards
      if (debouncedFilters.cardName.length > 0) {
        const deckCardNames = normalizedCards
          .map(card => card.name?.toLowerCase())
          .filter((name): name is string => !!name)
        
        const hasAllSelectedCards = debouncedFilters.cardName.every(selectedName => 
          deckCardNames.includes(selectedName.toLowerCase())
        )
        
        if (!hasAllSelectedCards) {
          return false
        }
      }
      
      // Filter by card text (search in abilities, text, description, etc.)
      if (debouncedFilters.cardText) {
        const searchText = debouncedFilters.cardText.toLowerCase()
        const hasMatchingText = normalizedCards.some(card => {
          const cardData = card as any
          
          // Collect all text fields from card - search in original card data too
          // Get original card from deck.cards if available
          const originalCard = deck.cards && Array.isArray(deck.cards) 
            ? deck.cards.find((c: any) => {
                const cId = typeof c === 'string' ? c : (c?.id || c?.cardId)
                return cId === card.id
              })
            : null
          
          const cardToSearch = originalCard && typeof originalCard === 'object' ? originalCard : cardData
          
          // Collect all text fields
          const textFields: string[] = []
          
          // Helper to recursively extract all string values
          const extractStrings = (obj: any, depth: number = 0): void => {
            if (depth > 4) return // Limit recursion depth
            if (!obj) return
            
            if (typeof obj === 'string' && obj.length > 0) {
              textFields.push(obj)
              return
            }
            
            if (Array.isArray(obj)) {
              obj.forEach((item: any) => {
                extractStrings(item, depth + 1)
              })
              return
            }
            
            if (typeof obj !== 'object') return
            
            for (const key in obj) {
              // Skip certain fields
              if (['id', 'name', 'imageUrl', 'image', 'cardId', 'card_id'].includes(key)) {
                continue
              }
              
              const value = obj[key]
              if (value === null || value === undefined) continue
              
              if (typeof value === 'string' && value.length > 0) {
                textFields.push(value)
              } else {
                extractStrings(value, depth + 1)
              }
            }
          }
          
          // Extract all strings from card data
          extractStrings(cardToSearch)
          
          // Also check normalized card data
          if (cardToSearch !== cardData) {
            extractStrings(cardData)
          }
          
          // Search in all collected text fields
          return textFields.some(field => {
            if (!field || typeof field !== 'string') return false
            // Remove HTML tags for better matching
            const cleanField = field.replace(/<[^>]+>/g, ' ').replace(/\s+/g, ' ').trim()
            return cleanField.toLowerCase().includes(searchText)
          })
        })
        if (!hasMatchingText) {
          return false
        }
      }
      
      // Filter by tags (must have ALL selected tags)
      if (debouncedFilters.tags.length > 0) {
        const searchTags = debouncedFilters.tags.map(t => t.trim().toLowerCase()).filter(Boolean)
        let deckTags: string[] = []

        const preTags = deckTagsMap[deck.id]
        if (preTags && Array.isArray(preTags)) {
          deckTags = preTags.map((t) => t.toLowerCase())
        } else {
          // Collect tags from deck.tags
          if (deck.tags && typeof deck.tags === 'object' && !Array.isArray(deck.tags)) {
            Object.entries(deck.tags).forEach(([key, value]) => {
              // Skip empty tags
              if (value === null || value === undefined || value === '') {
                return
              }
              
              let tagText: string | null = null
              if (typeof value === 'string' && value.trim() !== '') {
                tagText = value.trim().toLowerCase()
              } else if (typeof value === 'number' || typeof value === 'boolean') {
                tagText = String(value).toLowerCase()
              } else if (key && key !== 'none' && !key.startsWith('tag_')) {
                tagText = key.toLowerCase()
              }
              
              if (tagText) {
                deckTags.push(tagText)
              }
            })
          }
          
          // Collect tags from card provides
          normalizedCards.forEach((card: any) => {
            const provides = card.provides || card.Provides
            if (provides) {
              if (typeof provides === 'string') {
                provides.split(',').forEach((p: string) => {
                  const trimmed = p.trim().toLowerCase()
                  if (trimmed) deckTags.push(trimmed)
                })
              } else if (Array.isArray(provides)) {
                provides.forEach((p: string) => {
                  if (p && typeof p === 'string') {
                    const trimmed = p.trim().toLowerCase()
                    if (trimmed) deckTags.push(trimmed)
                  }
                })
              }
            }
          })
        }
        
        // Check if deck has ALL selected tags
        const hasAllTags = searchTags.every(searchTag => 
          deckTags.some(deckTag => deckTag === searchTag || deckTag.includes(searchTag))
        )
        if (!hasAllTags) {
          return false
        }
      }
      
      // Filter by creatures count
      if (debouncedFilters.creaturesValue !== null) {
        const counts = countPlayableCards(deck)
        const creaturesCount = counts.creatures
        
        let matches = false
        switch (debouncedFilters.creaturesOperator) {
          case '>=':
            matches = creaturesCount >= debouncedFilters.creaturesValue
            break
          case '<=':
            matches = creaturesCount <= debouncedFilters.creaturesValue
            break
          case '=':
            matches = creaturesCount === debouncedFilters.creaturesValue
            break
        }
        if (!matches) {
          return false
        }
      }
      
      // Filter by free creatures count (creatures with cost = 0 or no cost)
      if (debouncedFilters.freeCreaturesValue !== null) {
        let freeCreaturesCount = 0
        
        // Identify Forgeborn and Solbind cards (same logic as countPlayableCards)
        const forgebornId = deck.forgebornId
        const forgebornCards: any[] = []
        if (forgebornId) {
          const fb = normalizedCards.find(card => 
            card.id === forgebornId || 
            (card.id && forgebornId && card.id.includes(forgebornId)) ||
            (forgebornId && card.id && forgebornId.includes(card.id))
          )
          if (fb) forgebornCards.push(fb)
        }
        if (forgebornCards.length === 0) {
          const fb = normalizedCards.find(card =>
            card.type?.toLowerCase().includes('forgeborn') ||
            (card as any).cardType?.toLowerCase().includes('forgeborn')
          )
          if (fb) forgebornCards.push(fb)
        }
        
        // Extract Solbind card IDs
        const solbindCardIds = new Set<string>()
        normalizedCards.forEach(card => {
          const cardData = card as any
          if (cardData.solbindCards && Array.isArray(cardData.solbindCards)) {
            cardData.solbindCards.forEach((solbindCard: any) => {
              if (solbindCard && solbindCard.id) {
                solbindCardIds.add(solbindCard.id)
              }
            })
          }
        })
        const solbindCardObjects: any[] = []
        normalizedCards.forEach(card => {
          if (forgebornCards.includes(card)) return
          const cardData = card as any
          const cardId = card.id
          if (solbindCardIds.has(cardId)) {
            if (!solbindCardObjects.some((sb: any) => sb.id === cardId)) {
              solbindCardObjects.push(card)
            }
            return
          }
          if (cardData.rarity === 'Solbind' || cardData.rarity === 'solbind') {
            if (!solbindCardObjects.some((sb: any) => sb.id === cardId)) {
              solbindCardObjects.push(card)
            }
          }
        })
        
        normalizedCards.forEach(card => {
          // Skip Forgeborn and Solbind
          if (forgebornCards.includes(card)) return
          
          const cardData = card as any
          const isSolbindCard = solbindCardObjects.some((sb: any) => sb.id === card.id)
          if (isSolbindCard && !(cardData.solbindCards && Array.isArray(cardData.solbindCards))) {
            return
          }
          
          // Check if it's a creature (not a spell) - use ONLY cardType
          const originalCardForType = deck.cards && Array.isArray(deck.cards)
            ? deck.cards.find((c: any) => {
                const cId = typeof c === 'string' ? c : (c?.id || c?.cardId)
                return cId === card.id
              })
            : null
          const originalCardType = originalCardForType && typeof originalCardForType === 'object'
            ? (originalCardForType.cardType || originalCardForType.card_type || '')
            : ''
          const cardType = cardData.cardType || cardData.card_type || originalCardType || ''
          const lowerCardType = cardType.toLowerCase()
          const isSpell = lowerCardType.includes('spell') && !lowerCardType.includes('creature')
          
          if (!isSpell) {
            // It's a creature - check if it's free (has "this is free" in text)
            // Collect all text fields from card (same logic as cardText filter)
            const textFields: string[] = []
            const extractStrings = (obj: any, depth: number = 0): void => {
              if (depth > 5) return // Prevent infinite recursion
              if (obj === null || obj === undefined) return
              
              // Handle arrays
              if (Array.isArray(obj)) {
                obj.forEach(item => {
                  extractStrings(item, depth + 1)
                })
                return
              }
              
              // Handle strings
              if (typeof obj === 'string' && obj.length > 0) {
                textFields.push(obj)
                return
              }
              
              // Handle objects
              if (typeof obj !== 'object') return
              
              // Collect all string values from object
              for (const key in obj) {
                if (['id', 'name', 'imageUrl', 'image', 'cardId', 'card_id'].includes(key)) {
                  continue
                }
                
                const value = obj[key]
                if (value === null || value === undefined) continue
                
                if (typeof value === 'string' && value.length > 0) {
                  textFields.push(value)
                } else {
                  extractStrings(value, depth + 1)
                }
              }
            }
            
            // Extract all strings from card data - use original card data from deck, not normalized
            const cardToSearch = deck.cards && Array.isArray(deck.cards) 
              ? deck.cards.find((c: any) => {
                  const cId = typeof c === 'string' ? c : (c.id || c.cardId || c.name)
                  return cId === card.id || cId === cardData.id
                })
              : null
            
            if (cardToSearch) {
              extractStrings(cardToSearch)
            } else {
              // Fallback to cardData
              extractStrings(cardData)
              extractStrings(card)
            }
            
            // Check if any text field contains "this is free" (case insensitive)
            const hasFreeText = textFields.some(field => {
              if (!field || typeof field !== 'string') return false
              const cleanField = field.replace(/<[^>]+>/g, ' ').replace(/\s+/g, ' ').trim()
              return cleanField.toLowerCase().includes('this is free')
            })
            
            if (hasFreeText) {
              freeCreaturesCount++
            }
          }
        })
        
        let matches = false
        switch (debouncedFilters.freeCreaturesOperator) {
          case '>=':
            matches = freeCreaturesCount >= debouncedFilters.freeCreaturesValue
            break
          case '<=':
            matches = freeCreaturesCount <= debouncedFilters.freeCreaturesValue
            break
          case '=':
            matches = freeCreaturesCount === debouncedFilters.freeCreaturesValue
            break
        }
        if (!matches) {
          return false
        }
      }
      
      // Filter by creature type (Sub Type only)
      if (debouncedFilters.creatureType) {
        // Identify Forgeborn and Solbind cards (same logic as above)
        const forgebornId = deck.forgebornId
        const forgebornCardsForType: any[] = []
        if (forgebornId) {
          const fb = normalizedCards.find(card => 
            card.id === forgebornId || 
            (card.id && forgebornId && card.id.includes(forgebornId)) ||
            (forgebornId && card.id && forgebornId.includes(card.id))
          )
          if (fb) forgebornCardsForType.push(fb)
        }
        if (forgebornCardsForType.length === 0) {
          const fb = normalizedCards.find(card =>
            card.type?.toLowerCase().includes('forgeborn') ||
            (card as any).cardType?.toLowerCase().includes('forgeborn')
          )
          if (fb) forgebornCardsForType.push(fb)
        }
        
        // Extract Solbind card IDs
        const solbindCardIdsForType = new Set<string>()
        normalizedCards.forEach(card => {
          const cardData = card as any
          if (cardData.solbindCards && Array.isArray(cardData.solbindCards)) {
            cardData.solbindCards.forEach((solbindCard: any) => {
              if (solbindCard && solbindCard.id) {
                solbindCardIdsForType.add(solbindCard.id)
              }
            })
          }
        })
        const solbindCardObjectsForType: any[] = []
        normalizedCards.forEach(card => {
          if (forgebornCardsForType.includes(card)) return
          const cardData = card as any
          const cardId = card.id
          if (solbindCardIdsForType.has(cardId)) {
            if (!solbindCardObjectsForType.some((sb: any) => sb.id === cardId)) {
              solbindCardObjectsForType.push(card)
            }
            return
          }
          if (cardData.rarity === 'Solbind' || cardData.rarity === 'solbind') {
            if (!solbindCardObjectsForType.some((sb: any) => sb.id === cardId)) {
              solbindCardObjectsForType.push(card)
            }
          }
        })
        
        const selectedType = debouncedFilters.creatureType
        const selectedTypeLower = selectedType.toLowerCase()
        let creatureTypeCount = 0
        
        normalizedCards.forEach(card => {
          // Skip Forgeborn and Solbind
          if (forgebornCardsForType.includes(card)) return
          
          const cardData = card as any
          const isSolbindCard = solbindCardObjectsForType.some((sb: any) => sb.id === card.id)
          if (isSolbindCard && !(cardData.solbindCards && Array.isArray(cardData.solbindCards))) {
            return
          }
          
          // Check if it's a creature (not a spell) - use ONLY cardType
          const originalCardForType = deck.cards && Array.isArray(deck.cards)
            ? deck.cards.find((c: any) => {
                const cId = typeof c === 'string' ? c : (c?.id || c?.cardId)
                return cId === card.id
              })
            : null
          const originalCardType = originalCardForType && typeof originalCardForType === 'object'
            ? (originalCardForType.cardType || originalCardForType.card_type || '')
            : ''
          const cardType = cardData.cardType || cardData.card_type || originalCardType || ''
          const lowerCardType = cardType.toLowerCase()
          const isSpell = lowerCardType.includes('spell') && !lowerCardType.includes('creature')
          
          if (!isSpell) {
            // It's a creature - check if cardSubType contains the selected type
            const subType = (cardData.cardSubType || cardData.CardSubType || cardData.CARDSUBTYPE ||
                            cardData.SubType || cardData.subType || cardData.SUBTYPE || '').toString()
            if (subType) {
              // Split cardSubType by spaces and check if any word exactly matches the selected type
              // Example: "Beast Warrior" -> ["beast", "warrior"]
              // If selected type is "Beast", it should match "beast" exactly
              const types = subType.toLowerCase().split(/\s+/).filter((t: string) => t.length > 0)
              if (types.some((type: string) => type === selectedTypeLower)) {
                creatureTypeCount++
              }
            }
          }
        })
        
        // Check if deck has at least the required number of cards with this type
        if (creatureTypeCount < debouncedFilters.creatureTypeCount!) {
          return false
        }
      }
      
      // Filter by spells count
      if (debouncedFilters.spellsValue !== null) {
        const counts = countPlayableCards(deck)
        const spellsCount = counts.spells
        
        let matches = false
        switch (debouncedFilters.spellsOperator) {
          case '>=':
            matches = spellsCount >= debouncedFilters.spellsValue
            break
          case '<=':
            matches = spellsCount <= debouncedFilters.spellsValue
            break
          case '=':
            matches = spellsCount === debouncedFilters.spellsValue
            break
        }
        if (!matches) {
          return false
        }
      }
      
      // Filter by free spells count (spells with "this is free" in text)
      if (debouncedFilters.freeSpellsValue !== null) {
        let freeSpellsCount = 0
        
        // Identify Forgeborn and Solbind cards (same logic as countPlayableCards)
        const forgebornId = deck.forgebornId
        const forgebornCardsForFreeSpells: any[] = []
        if (forgebornId) {
          const fb = normalizedCards.find(card => 
            card.id === forgebornId || 
            (card.id && forgebornId && card.id.includes(forgebornId)) ||
            (forgebornId && card.id && forgebornId.includes(card.id))
          )
          if (fb) forgebornCardsForFreeSpells.push(fb)
        }
        if (forgebornCardsForFreeSpells.length === 0) {
          const fb = normalizedCards.find(card =>
            card.type?.toLowerCase().includes('forgeborn') ||
            (card as any).cardType?.toLowerCase().includes('forgeborn')
          )
          if (fb) forgebornCardsForFreeSpells.push(fb)
        }
        
        // Extract Solbind card IDs
        const solbindCardIdsForFreeSpells = new Set<string>()
        normalizedCards.forEach(card => {
          const cardData = card as any
          if (cardData.solbindCards && Array.isArray(cardData.solbindCards)) {
            cardData.solbindCards.forEach((solbindCard: any) => {
              if (solbindCard && solbindCard.id) {
                solbindCardIdsForFreeSpells.add(solbindCard.id)
              }
            })
          }
        })
        const solbindCardObjectsForFreeSpells: any[] = []
        normalizedCards.forEach(card => {
          if (forgebornCardsForFreeSpells.includes(card)) return
          const cardData = card as any
          const cardId = card.id
          if (solbindCardIdsForFreeSpells.has(cardId)) {
            if (!solbindCardObjectsForFreeSpells.some((sb: any) => sb.id === cardId)) {
              solbindCardObjectsForFreeSpells.push(card)
            }
            return
          }
          if (cardData.rarity === 'Solbind' || cardData.rarity === 'solbind') {
            if (!solbindCardObjectsForFreeSpells.some((sb: any) => sb.id === cardId)) {
              solbindCardObjectsForFreeSpells.push(card)
            }
          }
        })
        
        normalizedCards.forEach(card => {
          // Skip Forgeborn and Solbind
          if (forgebornCardsForFreeSpells.includes(card)) return
          
          const cardData = card as any
          const isSolbindCard = solbindCardObjectsForFreeSpells.some((sb: any) => sb.id === card.id)
          if (isSolbindCard && !(cardData.solbindCards && Array.isArray(cardData.solbindCards))) {
            return
          }
          
          // Check if it's a spell - use ONLY cardType
          const originalCardForType = deck.cards && Array.isArray(deck.cards)
            ? deck.cards.find((c: any) => {
                const cId = typeof c === 'string' ? c : (c?.id || c?.cardId)
                return cId === card.id
              })
            : null
          const originalCardType = originalCardForType && typeof originalCardForType === 'object'
            ? (originalCardForType.cardType || originalCardForType.card_type || '')
            : ''
          const cardType = cardData.cardType || cardData.card_type || originalCardType || ''
          const lowerCardType = cardType.toLowerCase()
          const isSpell = lowerCardType.includes('spell') && !lowerCardType.includes('creature')
          
          if (isSpell) {
            // It's a spell - check if it's free (has "this is free" in text)
            // Collect all text fields from card (same logic as cardText filter)
            const spellCardData = card as any
            
            // Get original card from deck.cards if available (same logic as cardText filter)
            const originalCard = deck.cards && Array.isArray(deck.cards) 
              ? deck.cards.find((c: any) => {
                  const cId = typeof c === 'string' ? c : (c?.id || c?.cardId)
                  return cId === card.id
                })
              : null
            
            const cardToSearch = originalCard && typeof originalCard === 'object' ? originalCard : spellCardData
            
            // Collect all text fields
            const textFields: string[] = []
            
            // Helper to recursively extract all string values (same as cardText filter)
            const extractStrings = (obj: any, depth: number = 0): void => {
              if (depth > 4) return // Limit recursion depth
              if (!obj) return
              
              if (typeof obj === 'string' && obj.length > 0) {
                textFields.push(obj)
                return
              }
              
              if (Array.isArray(obj)) {
                obj.forEach((item: any) => {
                  extractStrings(item, depth + 1)
                })
                return
              }
              
              if (typeof obj !== 'object') return
              
              for (const key in obj) {
                // Skip certain fields
                if (['id', 'name', 'imageUrl', 'image', 'cardId', 'card_id'].includes(key)) {
                  continue
                }
                
                const value = obj[key]
                if (value === null || value === undefined) continue
                
                if (typeof value === 'string' && value.length > 0) {
                  textFields.push(value)
                } else {
                  extractStrings(value, depth + 1)
                }
              }
            }
            
            // Extract all strings from card data
            extractStrings(cardToSearch)
            
            // Also check normalized card data
            if (cardToSearch !== spellCardData) {
              extractStrings(spellCardData)
            }
            
            // Check if any text field contains "this is free" (case insensitive)
            const searchText = 'this is free'
            const hasFreeText = textFields.some(field => {
              if (!field || typeof field !== 'string') return false
              // Remove HTML tags for better matching
              const cleanField = field.replace(/<[^>]+>/g, ' ').replace(/\s+/g, ' ').trim()
              return cleanField.toLowerCase().includes(searchText)
            })
            
            if (hasFreeText) {
              freeSpellsCount++
            }
          }
        })
        
        let matches = false
        switch (debouncedFilters.freeSpellsOperator) {
          case '>=':
            matches = freeSpellsCount >= debouncedFilters.freeSpellsValue
            break
          case '<=':
            matches = freeSpellsCount <= debouncedFilters.freeSpellsValue
            break
          case '=':
            matches = freeSpellsCount === debouncedFilters.freeSpellsValue
            break
        }
        if (!matches) {
          return false
        }
      }
      
      // Filter by spell type (cardSubType only) with count
      if (debouncedFilters.spellType && debouncedFilters.spellTypeCount !== null) {
        // Identify Forgeborn and Solbind cards (same logic as above)
        const forgebornId = deck.forgebornId
        const forgebornCardsForSpellType: any[] = []
        if (forgebornId) {
          const fb = normalizedCards.find(card => 
            card.id === forgebornId || 
            (card.id && forgebornId && card.id.includes(forgebornId)) ||
            (forgebornId && card.id && forgebornId.includes(card.id))
          )
          if (fb) forgebornCardsForSpellType.push(fb)
        }
        if (forgebornCardsForSpellType.length === 0) {
          const fb = normalizedCards.find(card =>
            card.type?.toLowerCase().includes('forgeborn') ||
            (card as any).cardType?.toLowerCase().includes('forgeborn')
          )
          if (fb) forgebornCardsForSpellType.push(fb)
        }
        
        // Extract Solbind card IDs
        const solbindCardIdsForSpellType = new Set<string>()
        normalizedCards.forEach(card => {
          const cardData = card as any
          if (cardData.solbindCards && Array.isArray(cardData.solbindCards)) {
            cardData.solbindCards.forEach((solbindCard: any) => {
              if (solbindCard && solbindCard.id) {
                solbindCardIdsForSpellType.add(solbindCard.id)
              }
            })
          }
        })
        const solbindCardObjectsForSpellType: any[] = []
        normalizedCards.forEach(card => {
          if (forgebornCardsForSpellType.includes(card)) return
          const cardData = card as any
          const cardId = card.id
          if (solbindCardIdsForSpellType.has(cardId)) {
            if (!solbindCardObjectsForSpellType.some((sb: any) => sb.id === cardId)) {
              solbindCardObjectsForSpellType.push(card)
            }
            return
          }
          if (cardData.rarity === 'Solbind' || cardData.rarity === 'solbind') {
            if (!solbindCardObjectsForSpellType.some((sb: any) => sb.id === cardId)) {
              solbindCardObjectsForSpellType.push(card)
            }
          }
        })
        
        const selectedType = debouncedFilters.spellType
        // Normalize selected type (same logic as allSpellTypes collection) for consistent comparison
        const normalizedSelectedType = selectedType && selectedType.trim()
          ? selectedType.trim().charAt(0).toUpperCase() + selectedType.trim().slice(1).toLowerCase()
          : ''
        
        // If no valid selected type, skip this filter
        if (!normalizedSelectedType) {
          // This shouldn't happen if spellType is set, but just in case
          return true
        }
        
        let spellTypeCount = 0
        
        normalizedCards.forEach(card => {
          // Skip Forgeborn and Solbind
          if (forgebornCardsForSpellType.includes(card)) return
          
          const cardData = card as any
          const isSolbindCard = solbindCardObjectsForSpellType.some((sb: any) => sb.id === card.id)
          if (isSolbindCard && !(cardData.solbindCards && Array.isArray(cardData.solbindCards))) {
            return
          }
          
          // Get original card data from deck.cards by ID to ensure we have all fields
          const originalCard = deck.cards && Array.isArray(deck.cards)
            ? deck.cards.find((c: any) => {
                const cId = typeof c === 'string' ? c : (c?.id || c?.cardId)
                return cId === card.id
              })
            : null
          
          // Check if it's a spell - use ONLY cardType
          const originalCardType = originalCard && typeof originalCard === 'object' 
            ? (originalCard.cardType || originalCard.card_type || '')
            : ''
          const cardType = cardData.cardType || cardData.card_type || originalCardType || ''
          const lowerCardType = cardType.toLowerCase()
          const isSpell = lowerCardType.includes('spell') && !lowerCardType.includes('creature')
          
          if (isSpell) {
            // It's a spell - check if cardSubType contains the selected type
            // Check both normalized card data and original card data
            // Prefer original data as it may have more complete information
            const originalSubType = originalCard && typeof originalCard === 'object'
              ? (originalCard.cardSubType || originalCard.CardSubType || originalCard.CARDSUBTYPE ||
                 originalCard.SubType || originalCard.subType || originalCard.SUBTYPE || '')
              : ''
            const normalizedSubType = cardData.cardSubType || cardData.CardSubType || cardData.CARDSUBTYPE ||
                                      cardData.SubType || cardData.subType || cardData.SUBTYPE || ''
            // Prefer original data if available, otherwise use normalized
            const subType = (originalSubType || normalizedSubType || '').toString()
            
            if (subType && subType.trim()) {
              // Split cardSubType by spaces and normalize each type (same logic as allSpellTypes collection)
              // Normalize: first char uppercase, rest lowercase (e.g., "Exalt" from "exalt" or "EXALT")
              const types = subType.trim().split(/\s+/).filter((t: string) => t.length > 0)
              const normalizedTypes = types.map((type: string) => 
                type.charAt(0).toUpperCase() + type.slice(1).toLowerCase()
              )
              // Compare normalized selected type with normalized card types
              if (normalizedTypes.includes(normalizedSelectedType)) {
                spellTypeCount++
              }
            }
          }
        })
        
        // Check if deck has at least the required number of cards with this type
        // Allow spellTypeCount to be 0 (show all decks if count is 0)
        if (debouncedFilters.spellTypeCount! > 0 && spellTypeCount < debouncedFilters.spellTypeCount!) {
          return false
        }
      }
      
      // Filter by rarity count
      if (debouncedFilters.rarityType && debouncedFilters.rarityCount !== null) {
        // Count cards by rarity (same logic as display)
        const rarityCounts = new Map<string, number>()
        
        // Identify Forgeborn and Solbind (same logic as countPlayableCards)
        const forgebornId = deck.forgebornId
        const forgebornCards: any[] = []
        if (forgebornId) {
          const fb = normalizedCards.find(card => 
            card.id === forgebornId || 
            (card.id && forgebornId && card.id.includes(forgebornId)) ||
            (forgebornId && card.id && forgebornId.includes(card.id))
          )
          if (fb) forgebornCards.push(fb)
        }
        if (forgebornCards.length === 0) {
          const fb = normalizedCards.find(card =>
            card.type?.toLowerCase().includes('forgeborn') ||
            (card as any).cardType?.toLowerCase().includes('forgeborn')
          )
          if (fb) forgebornCards.push(fb)
        }
        
        const solbindCardIds = new Set<string>()
        normalizedCards.forEach(card => {
          const cardData = card as any
          if (cardData.solbindCards && Array.isArray(cardData.solbindCards)) {
            cardData.solbindCards.forEach((solbindCard: any) => {
              if (solbindCard && solbindCard.id) {
                solbindCardIds.add(solbindCard.id)
              }
            })
          }
        })
        
        const solbindCardObjects: any[] = []
        normalizedCards.forEach(card => {
          const cardData = card as any
          if (cardData.solbindCards && Array.isArray(cardData.solbindCards)) {
            cardData.solbindCards.forEach((solbindCard: any) => {
              if (solbindCard && solbindCard.id) {
                if (!solbindCardObjects.some(sb => sb.id === solbindCard.id)) {
                  solbindCardObjects.push(getCardInfo(solbindCard.id, solbindCard))
                }
              }
            })
          }
        })
        normalizedCards.forEach(card => {
          if (forgebornCards.includes(card)) return
          const cardData = card as any
          const cardId = card.id
          if (cardData.solbindCards && Array.isArray(cardData.solbindCards)) {
            return
          }
          if (solbindCardIds.has(cardId)) {
            if (!solbindCardObjects.some(sb => sb.id === cardId)) {
              solbindCardObjects.push(card)
            }
            return
          }
          if (cardData.rarity === 'Solbind' || cardData.rarity === 'solbind') {
            if (!solbindCardObjects.some(sb => sb.id === cardId)) {
              solbindCardObjects.push(card)
            }
          }
        })
        
        // Count rarity for creatures and spells
        normalizedCards.forEach(card => {
          if (forgebornCards.includes(card)) return
          const cardData = card as any
          const isSolbindCard = solbindCardObjects.some(sb => sb.id === card.id)
          if (isSolbindCard && !(cardData.solbindCards && Array.isArray(cardData.solbindCards))) {
            return
          }
          
          const rarity = cardData.rarity
          if (rarity && typeof rarity === 'string') {
            let normalizedRarity = rarity.trim()
            if (normalizedRarity.includes('Common') && normalizedRarity.includes('Rare')) {
              normalizedRarity = 'Common Rare'
            } else if (normalizedRarity.toLowerCase().includes('common')) {
              normalizedRarity = 'Common'
            } else if (normalizedRarity.toLowerCase().includes('rare')) {
              normalizedRarity = 'Rare'
                        } else if (normalizedRarity.toLowerCase().includes('ls') || normalizedRarity.toLowerCase().includes('legendary')) {
                          normalizedRarity = 'LS'
            }
            
            const currentCount = rarityCounts.get(normalizedRarity) || 0
            rarityCounts.set(normalizedRarity, currentCount + 1)
          }
        })
        
        const deckRarityCount = rarityCounts.get(debouncedFilters.rarityType) || 0
        if (deckRarityCount < debouncedFilters.rarityCount) {
          return false
        }
      }
      
      // Filter by card set number (multi-select)
      // Use getDeckSet to get the actual set (B1 if any card is from B1, otherwise deck.cardSetNo)
      if (debouncedFilters.cardSetNo.length > 0) {
        const deckSet = getDeckSet(deck)
        const deckSetStr = deckSet ? String(deckSet).trim() : null
        if (!deckSetStr || !debouncedFilters.cardSetNo.includes(deckSetStr)) {
          return false
        }
      }
      
      // Filter by ELO
      if (debouncedFilters.eloValue !== null) {
        const deckElo = (deck as any).elo !== undefined && (deck as any).elo !== null 
          ? Number((deck as any).elo) 
          : null
        
        if (deckElo === null) {
          return false // Deck has no ELO, exclude it
        }
        
        switch (debouncedFilters.eloOperator) {
          case '>=':
            if (deckElo < debouncedFilters.eloValue) return false
            break
          case '<=':
            if (deckElo > debouncedFilters.eloValue) return false
            break
          case '=':
            if (deckElo !== debouncedFilters.eloValue) return false
            break
        }
      }
      
      // Filter by deck score
      // scoreValue is stored as 0-100 (multiplied by 100, like in display)
      if (debouncedFilters.scoreValue !== null) {
        const deckScore = (deck as any).deckScore !== undefined && (deck as any).deckScore !== null 
          ? Number((deck as any).deckScore) 
          : null
        
        if (deckScore === null) {
          return false // Deck has no score, exclude it
        }
        
        // Convert deckScore to 0-100 scale (like in display)
        const deckScoreScaled = Math.round(deckScore * 100)
        
        switch (debouncedFilters.scoreOperator) {
          case '>=':
            if (deckScoreScaled < debouncedFilters.scoreValue) return false
            break
          case '<=':
            if (deckScoreScaled > debouncedFilters.scoreValue) return false
            break
          case '=':
            if (deckScoreScaled !== debouncedFilters.scoreValue) return false
            break
        }
      }
      
      return true
    })
  }, [debouncedFilters, hasActiveFilters, deckTagsMap])
  
  // Helper function to sort decks
  const sortDecks = useCallback((deckArray: Deck[]): Deck[] => {
    const sorted = [...deckArray]
    
    switch (debouncedFilters.sortBy) {
      case 'date-desc': // Newest first
        return sorted.sort((a, b) => {
          // Use updatedAt for sorting (updated at), fallback to created if updatedAt is not available
          const dateA = (a as any).updatedAt ? new Date((a as any).updatedAt).getTime() : (a.created ? new Date(a.created).getTime() : 0)
          const dateB = (b as any).updatedAt ? new Date((b as any).updatedAt).getTime() : (b.created ? new Date(b.created).getTime() : 0)
          return dateB - dateA // Descending (newest first)
        })
      case 'date-asc': // Oldest first
        return sorted.sort((a, b) => {
          // Use updatedAt for sorting (updated at), fallback to created if updatedAt is not available
          const dateA = (a as any).updatedAt ? new Date((a as any).updatedAt).getTime() : (a.created ? new Date(a.created).getTime() : 0)
          const dateB = (b as any).updatedAt ? new Date((b as any).updatedAt).getTime() : (b.created ? new Date(b.created).getTime() : 0)
          return dateA - dateB // Ascending (oldest first)
        })
      case 'name-asc': // A-Z
        return sorted.sort((a, b) => {
          const nameA = (a.name || 'Untitled').toLowerCase()
          const nameB = (b.name || 'Untitled').toLowerCase()
          return nameA.localeCompare(nameB)
        })
      case 'name-desc': // Z-A
        return sorted.sort((a, b) => {
          const nameA = (a.name || 'Untitled').toLowerCase()
          const nameB = (b.name || 'Untitled').toLowerCase()
          return nameB.localeCompare(nameA)
        })
      case 'score-desc': // Highest score first
        return sorted.sort((a, b) => {
          const scoreA = (a as any).deckScore !== undefined && (a as any).deckScore !== null ? Number((a as any).deckScore) : -Infinity
          const scoreB = (b as any).deckScore !== undefined && (b as any).deckScore !== null ? Number((b as any).deckScore) : -Infinity
          return scoreB - scoreA // Descending (highest first)
        })
      case 'score-asc': // Lowest score first
        return sorted.sort((a, b) => {
          const scoreA = (a as any).deckScore !== undefined && (a as any).deckScore !== null ? Number((a as any).deckScore) : Infinity
          const scoreB = (b as any).deckScore !== undefined && (b as any).deckScore !== null ? Number((b as any).deckScore) : Infinity
          return scoreA - scoreB // Ascending (lowest first)
        })
      case 'elo-desc': // Highest ELO first
        return sorted.sort((a, b) => {
          const eloA = (a as any).elo !== undefined && (a as any).elo !== null ? Number((a as any).elo) : -Infinity
          const eloB = (b as any).elo !== undefined && (b as any).elo !== null ? Number((b as any).elo) : -Infinity
          return eloB - eloA // Descending (highest first)
        })
      case 'elo-asc': // Lowest ELO first
        return sorted.sort((a, b) => {
          const eloA = (a as any).elo !== undefined && (a as any).elo !== null ? Number((a as any).elo) : Infinity
          const eloB = (b as any).elo !== undefined && (b as any).elo !== null ? Number((b as any).elo) : Infinity
          return eloA - eloB // Ascending (lowest first)
        })
      default:
        return sorted
    }
  }, [debouncedFilters.sortBy])
  
  // Filter half decks based on filter criteria
  const filteredHalfDecks = useMemo(() => {
    const filtered = filterDeckArray(halfDecks)
    return sortDecks(filtered)
  }, [halfDecks, filterDeckArray, sortDecks])
  
  // Filter fused decks based on filter criteria
  const filteredFusedDecks = useMemo(() => {
    const filtered = filterDeckArray(filteredFusedDecksByExpiry)
    return sortDecks(filtered)
  }, [filteredFusedDecksByExpiry, filterDeckArray, sortDecks])

  // Pagination
  const regularPageCount = Math.max(1, Math.ceil(filteredHalfDecks.length / PAGE_SIZE))
  const fusedPageCount = Math.max(1, Math.ceil(filteredFusedDecks.length / PAGE_SIZE))

  useEffect(() => {
    setRegularPage((prev) => Math.min(prev, regularPageCount))
  }, [regularPageCount])

  useEffect(() => {
    setFusedPage((prev) => Math.min(prev, fusedPageCount))
  }, [fusedPageCount])

  useEffect(() => {
    setRegularPage(1)
    setFusedPage(1)
  }, [viewMode])

  const pagedHalfDecks = useMemo(() => {
    if (regularPageCount <= 1) return filteredHalfDecks
    const start = (regularPage - 1) * PAGE_SIZE
    return filteredHalfDecks.slice(start, start + PAGE_SIZE)
  }, [filteredHalfDecks, regularPage, regularPageCount, PAGE_SIZE])

  const pagedFusedDecks = useMemo(() => {
    if (fusedPageCount <= 1) return filteredFusedDecks
    const start = (fusedPage - 1) * PAGE_SIZE
    return filteredFusedDecks.slice(start, start + PAGE_SIZE)
  }, [filteredFusedDecks, fusedPage, fusedPageCount, PAGE_SIZE])

  const clampPage = (value: number, max: number) => {
    if (!Number.isFinite(value) || value < 1) return 1
    return Math.min(Math.max(1, Math.floor(value)), Math.max(1, max))
  }

  const handleRegularPageChange = useCallback(
    (value: number | string) => {
      const next = clampPage(Number(value), regularPageCount)
      setRegularPage(next)
    },
    [regularPageCount]
  )

  const handleFusedPageChange = useCallback(
    (value: number | string) => {
      const next = clampPage(Number(value), fusedPageCount)
      setFusedPage(next)
    },
    [fusedPageCount]
  )

  const renderPageButtons = useCallback(
    (current: number, total: number, onChange: (page: number) => void) => {
      const buttons: number[] = []
      const seen = new Set<number>()
      const add = (p: number) => {
        if (p < 1 || p > total || seen.has(p)) return
        seen.add(p)
        buttons.push(p)
      }
      add(1)
      add(total)

      return (
        <Group gap="xs">
          {buttons.map((p) => (
            <Button
              key={`page-${p}`}
              size="xs"
              variant={p === current ? 'filled' : 'outline'}
              disabled={p === current}
              onClick={() => onChange(p)}
            >
              {p}
            </Button>
          ))}
        </Group>
      )
    },
    []
  )

  // Virtualization setup (after filtered decks are computed)
  const [regularListRef, rect] = useResizeObserver()
  const [fusedListRef, fusedRect] = useResizeObserver()
  const columnCount = useMemo(() => {
    const width = rect.width || 1200
    if (width < 640) return 1
    if (width < 960) return 2
    return 3
  }, [rect.width])
  const fusedColumnCount = useMemo(() => {
    const width = fusedRect.width || 1200
    if (width < 640) return 1
    if (width < 960) return 2
    return 3
  }, [fusedRect.width])
  // Fixed row height for smoother scroll without expensive measurements
  const regularRows = useMemo(() => {
    const rows: Deck[][] = []
    for (let i = 0; i < pagedHalfDecks.length; i += columnCount) {
      rows.push(pagedHalfDecks.slice(i, i + columnCount))
    }
    return rows
  }, [pagedHalfDecks, columnCount])
  const fusedRows = useMemo(() => {
    const rows: Deck[][] = []
    for (let i = 0; i < pagedFusedDecks.length; i += fusedColumnCount) {
      rows.push(pagedFusedDecks.slice(i, i + fusedColumnCount))
    }
    return rows
  }, [pagedFusedDecks, fusedColumnCount])

  // Keep min content height to avoid jump when filtering


  // Update content height and restore scroll position after filteredDecks changes
  useEffect(() => {
    if (shouldRestoreScrollRef.current) {
      const savedScroll = scrollPositionRef.current
      const totalFilteredDecks = filteredHalfDecks.length + filteredFusedDecks.length
      if (totalFilteredDecks === 0) {
        shouldRestoreScrollRef.current = false
        firstVisibleDeckIdRef.current = null
        return
      }
      shouldRestoreScrollRef.current = false
      firstVisibleDeckIdRef.current = null
      window.scrollTo(0, savedScroll)
    }
  }, [filteredHalfDecks.length, filteredFusedDecks.length, columnCount, fusedColumnCount]) // Only depend on length to avoid unnecessary runs

  return (
    <>
      <div className="w-full max-w-6xl space-y-4">
        <Group justify="space-between" align="center" className="mb-4">
          <Title order={2} className="text-white">
            Found Decks (
              {showHalfDecks ? `Decks: ${filteredHalfDecks.length}` : ''}
              {showFusedDecks ? `Fused: ${filteredFusedDecks.length}` : ''}
              {hasActiveFilters ? ` / Total: ${totalDecksCount}` : ''}
            )
          </Title>
          <Group gap="xs">
            <Group gap="xs">
              <Button
                variant={viewMode === 'decks' ? 'filled' : 'outline'}
                onClick={() => setViewMode('decks')}
                size="sm"
                color={viewMode === 'decks' ? 'blue' : 'gray'}
              >
                Decks ({filteredHalfDecks.length})
              </Button>
              <Button
                variant={viewMode === 'fused' ? 'filled' : 'outline'}
                onClick={() => setViewMode('fused')}
                size="sm"
                color={viewMode === 'fused' ? 'blue' : 'gray'}
              >
                Fused ({filteredFusedDecks.length})
              </Button>
            </Group>
            <Button
              variant={filtersOpened ? 'filled' : 'outline'}
              leftSection={<IconFilter size={16} />}
              onClick={() => setFiltersOpened(!filtersOpened)}
              size="sm"
            >
              Filters
            </Button>
            {hasActiveFilters && (
              <Button
                variant="subtle"
                leftSection={<IconX size={16} />}
                onClick={clearFilters}
                size="sm"
                color="red"
              >
                Clear
              </Button>
            )}
          </Group>
        </Group>
        
        <Collapse in={filtersOpened}>
          <Paper
            p="md"
            className="mb-4 backdrop-blur-md border border-sf-primary/30 rounded-xl"
            style={{ backgroundColor: 'rgba(30, 41, 59, 0.6)' }}
          >
            <Stack gap="md">
              <Title order={4} className="text-white">
                Filter Decks
              </Title>
              
              <Grid gutter="md">
                <Grid.Col span={{ base: 12, sm: 6, md: 4 }}>
                  <Select
                    label="Deck Name"
                    placeholder={allDeckNames.length > 0 ? "Select deck name..." : "No decks available"}
                    data={allDeckNames.map(name => ({ value: name, label: name }))}
                    value={filters.deckName || null}
                    onChange={(value) => setFilters({ ...filters, deckName: value || '' })}
                    clearable
                    searchable
                    styles={{
                      label: { color: 'white' },
                      input: { backgroundColor: 'rgba(30, 41, 59, 0.8)', color: 'white', borderColor: 'rgba(74, 144, 226, 0.3)' },
                      dropdown: { backgroundColor: 'rgba(30, 41, 59, 0.95)' },
                      option: { color: 'white' }
                    }}
                    disabled={allDeckNames.length === 0}
                  />
                </Grid.Col>
                
                <Grid.Col span={{ base: 12, sm: 6, md: 4 }}>
                  <MultiSelect
                    label="Faction"
                    placeholder="Select factions..."
                    value={filters.faction}
                    onChange={(value) => setFilters({ ...filters, faction: value })}
                    data={[
                      { value: 'Alloyin', label: 'Alloyin' },
                      { value: 'Uterra', label: 'Uterra' },
                      { value: 'Tempys', label: 'Tempys' },
                      { value: 'Nekrium', label: 'Nekrium' },
                    ]}
                    clearable
                    styles={{
                      label: { color: 'white' },
                      input: { backgroundColor: 'rgba(30, 41, 59, 0.8)', color: 'white', borderColor: 'rgba(74, 144, 226, 0.3)' }
                    }}
                  />
                </Grid.Col>
                
                <Grid.Col span={{ base: 12, sm: 6, md: 4 }}>
                  <MultiSelect
                    label="Forgeborn Name"
                    placeholder="Select Forgeborn..."
                    data={allForgebornNames}
                    value={filters.forgebornName}
                    onChange={(value) => setFilters({ ...filters, forgebornName: value })}
                    clearable
                    searchable
                    className="text-white"
                    styles={{
                      label: { color: 'white' },
                      input: { backgroundColor: 'rgba(30, 41, 59, 0.8)', color: 'white', borderColor: 'rgba(74, 144, 226, 0.3)' },
                      dropdown: { backgroundColor: 'rgba(30, 41, 59, 0.95)' },
                      option: { color: 'white' }
                    }}
                  />
                </Grid.Col>
                
                <Grid.Col span={{ base: 12, sm: 6, md: 4 }}>
                  <MultiSelect
                    label="Card Name"
                    placeholder="Select cards..."
                    value={filters.cardName}
                    onChange={(value) => {
                      // Save scroll position before changing filter
                      scrollPositionRef.current = window.scrollY || window.pageYOffset || document.documentElement.scrollTop
                      shouldRestoreScrollRef.current = true
                      setFilters({ ...filters, cardName: value })
                    }}
                    data={allCardNames.map(name => ({ value: name, label: name }))}
                    searchable
                    clearable
                    maxDropdownHeight={300}
                    styles={{
                      label: { color: 'white' },
                      input: { backgroundColor: 'rgba(30, 41, 59, 0.8)', color: 'white', borderColor: 'rgba(74, 144, 226, 0.3)' }
                    }}
                  />
                </Grid.Col>
                
                <Grid.Col span={{ base: 12, sm: 6, md: 4 }}>
                  <TextInput
                    label="Card Text"
                    placeholder="Search in card text/abilities..."
                    value={filters.cardText}
                    onChange={(e) => setFilters({ ...filters, cardText: e.target.value })}
                    className="text-white"
                    styles={{
                      label: { color: 'white' },
                      input: { backgroundColor: 'rgba(30, 41, 59, 0.8)', color: 'white', borderColor: 'rgba(74, 144, 226, 0.3)' }
                    }}
                  />
                </Grid.Col>
                
                <Grid.Col span={{ base: 12, sm: 6, md: 4 }}>
                  <MultiSelect
                    label="Tags"
                    placeholder="Select tags..."
                    data={allTags.map(tag => ({ value: tag, label: tag }))}
                    value={filters.tags}
                    onChange={(value) => setFilters({ ...filters, tags: value })}
                    clearable
                    searchable
                    styles={{
                      label: { color: 'white' },
                      input: { backgroundColor: 'rgba(30, 41, 59, 0.8)', color: 'white', borderColor: 'rgba(74, 144, 226, 0.3)' },
                      dropdown: { backgroundColor: 'rgba(30, 41, 59, 0.95)' },
                      option: { color: 'white' }
                    }}
                  />
                </Grid.Col>
                
                <Grid.Col span={{ base: 12, sm: 6, md: 4 }}>
                  <Group gap="xs" align="flex-end">
                    <Select
                      label="Creatures"
                      value={filters.creaturesOperator}
                      onChange={(value) => setFilters({ ...filters, creaturesOperator: value as any })}
                      data={[
                        { value: '>=', label: '≥' },
                        { value: '<=', label: '≤' },
                        { value: '=', label: '=' },
                      ]}
                      style={{ flex: '0 0 80px' }}
                      styles={{
                        label: { color: 'white' },
                        input: { backgroundColor: 'rgba(30, 41, 59, 0.8)', color: 'white', borderColor: 'rgba(74, 144, 226, 0.3)' }
                      }}
                    />
                    <NumberInput
                      placeholder="Count"
                      value={filters.creaturesValue ?? ''}
                      onChange={(value) =>
                        setFilters(prev => ({
                          ...prev,
                          creaturesValue: typeof value === 'number' ? value : null,
                        }))
                      }
                      min={0}
                      rightSection={filters.creaturesValue !== null ? (
                        <button
                          type="button"
                          onClick={(e) => {
                            e.preventDefault()
                            e.stopPropagation()
                            setFilters(prev => ({ ...prev, creaturesValue: null }))
                          }}
                          onMouseDown={(e) => {
                            e.preventDefault()
                            e.stopPropagation()
                          }}
                          style={{
                            background: 'none',
                            border: 'none',
                            padding: 0,
                            cursor: 'pointer',
                            display: 'flex',
                            alignItems: 'center',
                            justifyContent: 'center',
                          }}
                        >
                          <IconX
                            size={16}
                            style={{ color: 'rgba(255, 255, 255, 0.7)' }}
                          />
                        </button>
                      ) : null}
                      style={{ flex: 1 }}
                      styles={{
                        label: { color: 'white' },
                        input: { backgroundColor: 'rgba(30, 41, 59, 0.8)', color: 'white', borderColor: 'rgba(74, 144, 226, 0.3)' }
                      }}
                    />
                  </Group>
                </Grid.Col>
                
                <Grid.Col span={{ base: 12, sm: 6, md: 4 }}>
                  <Stack gap={4}>
                    <Text size="sm" className="text-white" style={{ fontWeight: 500 }}>
                      Free Creatures
                    </Text>
                    <Group gap="xs" align="flex-end" wrap="nowrap">
                      <Select
                        value={filters.freeCreaturesOperator}
                        onChange={(value) => setFilters({ ...filters, freeCreaturesOperator: value as any })}
                        data={[
                          { value: '>=', label: '≥' },
                          { value: '<=', label: '≤' },
                          { value: '=', label: '=' },
                        ]}
                        style={{ flex: '0 0 60px', minWidth: '60px' }}
                        styles={{
                          input: { backgroundColor: 'rgba(30, 41, 59, 0.8)', color: 'white', borderColor: 'rgba(74, 144, 226, 0.3)', fontSize: '14px', padding: '0 8px' }
                        }}
                      />
                      <NumberInput
                        placeholder="Count"
                        value={filters.freeCreaturesValue ?? undefined}
                        onChange={(value) => setFilters({ ...filters, freeCreaturesValue: typeof value === 'number' ? value : null })}
                        min={0}
                        rightSection={filters.freeCreaturesValue !== null && filters.freeCreaturesValue !== undefined ? (
                          <button
                            type="button"
                            onClick={(e) => {
                              e.preventDefault()
                              e.stopPropagation()
                              setFilters({ ...filters, freeCreaturesValue: null })
                            }}
                            onMouseDown={(e) => {
                              e.preventDefault()
                              e.stopPropagation()
                            }}
                            style={{
                              background: 'none',
                              border: 'none',
                              padding: 0,
                              cursor: 'pointer',
                              display: 'flex',
                              alignItems: 'center',
                              justifyContent: 'center',
                            }}
                          >
                            <IconX
                              size={16}
                              style={{ color: 'rgba(255, 255, 255, 0.7)' }}
                            />
                          </button>
                        ) : null}
                        style={{ flex: 1, minWidth: 0 }}
                        styles={{
                          input: { backgroundColor: 'rgba(30, 41, 59, 0.8)', color: 'white', borderColor: 'rgba(74, 144, 226, 0.3)', fontSize: '14px' }
                        }}
                      />
                    </Group>
                  </Stack>
                </Grid.Col>
                
                <Grid.Col span={{ base: 12, sm: 6, md: 4 }}>
                  <Group gap="xs" align="flex-end">
                    <Select
                      label="Creature Type"
                      placeholder={allCreatureTypes.length > 0 ? "Select creature type..." : "No types available"}
                      data={allCreatureTypes.map(type => ({ value: type, label: type }))}
                      value={filters.creatureType || null}
                      onChange={(value) => setFilters({ 
                        ...filters, 
                        creatureType: value || '',
                        creatureTypeCount: value ? 1 : null // Set default value to 1 when type is selected
                      })}
                      clearable
                      searchable
                      disabled={allCreatureTypes.length === 0}
                      style={{ flex: 1 }}
                      styles={{
                        label: { color: 'white' },
                        input: { backgroundColor: 'rgba(30, 41, 59, 0.8)', color: 'white', borderColor: 'rgba(74, 144, 226, 0.3)' },
                        dropdown: { backgroundColor: 'rgba(30, 41, 59, 0.95)' },
                        option: { color: 'white' }
                      }}
                    />
                    <NumberInput
                      placeholder="Min count"
                      value={filters.creatureTypeCount ?? ''}
                      onChange={(value) =>
                        setFilters(prev => ({
                          ...prev,
                          creatureTypeCount: typeof value === 'number' ? value : null,
                        }))
                      }
                      min={0}
                      rightSection={filters.creatureTypeCount !== null ? (
                        <button
                          type="button"
                          onClick={(e) => {
                            e.preventDefault()
                            e.stopPropagation()
                            setFilters(prev => ({ ...prev, creatureTypeCount: null }))
                          }}
                          onMouseDown={(e) => {
                            e.preventDefault()
                            e.stopPropagation()
                          }}
                          style={{
                            background: 'none',
                            border: 'none',
                            padding: 0,
                            cursor: 'pointer',
                            display: 'flex',
                            alignItems: 'center',
                            justifyContent: 'center',
                          }}
                        >
                          <IconX
                            size={16}
                            style={{ color: 'rgba(255, 255, 255, 0.7)' }}
                          />
                        </button>
                      ) : null}
                      style={{ flex: '0 0 120px' }}
                      disabled={!filters.creatureType}
                      styles={{
                        label: { color: 'white' },
                        input: { backgroundColor: 'rgba(30, 41, 59, 0.8)', color: 'white', borderColor: 'rgba(74, 144, 226, 0.3)' }
                      }}
                    />
                  </Group>
                </Grid.Col>
                
                <Grid.Col span={{ base: 12, sm: 6, md: 4 }}>
                  <Group gap="xs" align="flex-end">
                    <Select
                      label="Spells"
                      value={filters.spellsOperator}
                      onChange={(value) => setFilters({ ...filters, spellsOperator: value as any })}
                      data={[
                        { value: '>=', label: '≥' },
                        { value: '<=', label: '≤' },
                        { value: '=', label: '=' },
                      ]}
                      style={{ flex: '0 0 80px' }}
                      styles={{
                        label: { color: 'white' },
                        input: { backgroundColor: 'rgba(30, 41, 59, 0.8)', color: 'white', borderColor: 'rgba(74, 144, 226, 0.3)' }
                      }}
                    />
                    <NumberInput
                      placeholder="Count"
                      value={filters.spellsValue ?? ''}
                      onChange={(value) =>
                        setFilters(prev => ({
                          ...prev,
                          spellsValue: typeof value === 'number' ? value : null,
                        }))
                      }
                      min={0}
                      rightSection={filters.spellsValue !== null ? (
                        <button
                          type="button"
                          onClick={(e) => {
                            e.preventDefault()
                            e.stopPropagation()
                            setFilters(prev => ({ ...prev, spellsValue: null }))
                          }}
                          onMouseDown={(e) => {
                            e.preventDefault()
                            e.stopPropagation()
                          }}
                          style={{
                            background: 'none',
                            border: 'none',
                            padding: 0,
                            cursor: 'pointer',
                            display: 'flex',
                            alignItems: 'center',
                            justifyContent: 'center',
                          }}
                        >
                          <IconX
                            size={16}
                            style={{ color: 'rgba(255, 255, 255, 0.7)' }}
                          />
                        </button>
                      ) : null}
                      style={{ flex: 1 }}
                      styles={{
                        label: { color: 'white' },
                        input: { backgroundColor: 'rgba(30, 41, 59, 0.8)', color: 'white', borderColor: 'rgba(74, 144, 226, 0.3)' }
                      }}
                    />
                  </Group>
                </Grid.Col>
                
                <Grid.Col span={{ base: 12, sm: 6, md: 4 }}>
                  <Stack gap={4}>
                    <Text size="sm" className="text-white" style={{ fontWeight: 500 }}>
                      Free Spells
                    </Text>
                    <Group gap="xs" align="flex-end" wrap="nowrap">
                      <Select
                        value={filters.freeSpellsOperator}
                        onChange={(value) => setFilters({ ...filters, freeSpellsOperator: value as any })}
                        data={[
                          { value: '>=', label: '≥' },
                          { value: '<=', label: '≤' },
                          { value: '=', label: '=' },
                        ]}
                        style={{ flex: '0 0 60px', minWidth: '60px' }}
                        styles={{
                          input: { backgroundColor: 'rgba(30, 41, 59, 0.8)', color: 'white', borderColor: 'rgba(74, 144, 226, 0.3)', fontSize: '14px', padding: '0 8px' }
                        }}
                      />
                      <NumberInput
                        placeholder="Count"
                        value={filters.freeSpellsValue ?? undefined}
                        onChange={(value) => setFilters({ ...filters, freeSpellsValue: typeof value === 'number' ? value : null })}
                        min={0}
                        rightSection={filters.freeSpellsValue !== null && filters.freeSpellsValue !== undefined ? (
                          <button
                            type="button"
                            onClick={(e) => {
                              e.preventDefault()
                              e.stopPropagation()
                              setFilters({ ...filters, freeSpellsValue: null })
                            }}
                            onMouseDown={(e) => {
                              e.preventDefault()
                              e.stopPropagation()
                            }}
                            style={{
                              background: 'none',
                              border: 'none',
                              padding: 0,
                              cursor: 'pointer',
                              display: 'flex',
                              alignItems: 'center',
                              justifyContent: 'center',
                            }}
                          >
                            <IconX
                              size={16}
                              style={{ color: 'rgba(255, 255, 255, 0.7)' }}
                            />
                          </button>
                        ) : null}
                        style={{ flex: 1, minWidth: 0 }}
                        styles={{
                          input: { backgroundColor: 'rgba(30, 41, 59, 0.8)', color: 'white', borderColor: 'rgba(74, 144, 226, 0.3)', fontSize: '14px' }
                        }}
                      />
                    </Group>
                  </Stack>
                </Grid.Col>
                
                <Grid.Col span={{ base: 12, sm: 6, md: 4 }}>
                  <Group gap="xs" align="flex-end">
                    <Select
                      label="Spell Type"
                      placeholder={allSpellTypes.length > 0 ? "Select spell type..." : "No types available"}
                      data={allSpellTypes.map(type => ({ value: type, label: type }))}
                      value={filters.spellType || null}
                      onChange={(value) => setFilters({ 
                        ...filters, 
                        spellType: value || '',
                        spellTypeCount: value ? 1 : null // Set default value to 1 when type is selected
                      })}
                      clearable
                      searchable
                      disabled={allSpellTypes.length === 0}
                      style={{ flex: 1 }}
                      styles={{
                        label: { color: 'white' },
                        input: { backgroundColor: 'rgba(30, 41, 59, 0.8)', color: 'white', borderColor: 'rgba(74, 144, 226, 0.3)' },
                        dropdown: { backgroundColor: 'rgba(30, 41, 59, 0.95)' },
                        option: { color: 'white' }
                      }}
                    />
                    <NumberInput
                      placeholder="Min count"
                      value={filters.spellTypeCount ?? ''}
                      onChange={(value) =>
                        setFilters(prev => ({
                          ...prev,
                          spellTypeCount: typeof value === 'number' ? value : null,
                        }))
                      }
                      min={0}
                      rightSection={filters.spellTypeCount !== null ? (
                        <button
                          type="button"
                          onClick={(e) => {
                            e.preventDefault()
                            e.stopPropagation()
                            setFilters(prev => ({ ...prev, spellTypeCount: null }))
                          }}
                          onMouseDown={(e) => {
                            e.preventDefault()
                            e.stopPropagation()
                          }}
                          style={{
                            background: 'none',
                            border: 'none',
                            padding: 0,
                            cursor: 'pointer',
                            display: 'flex',
                            alignItems: 'center',
                            justifyContent: 'center',
                          }}
                        >
                          <IconX
                            size={16}
                            style={{ color: 'rgba(255, 255, 255, 0.7)' }}
                          />
                        </button>
                      ) : null}
                      style={{ flex: '0 0 120px' }}
                      disabled={!filters.spellType}
                      styles={{
                        label: { color: 'white' },
                        input: { backgroundColor: 'rgba(30, 41, 59, 0.8)', color: 'white', borderColor: 'rgba(74, 144, 226, 0.3)' }
                      }}
                    />
                  </Group>
                </Grid.Col>
                
                <Grid.Col span={{ base: 12, sm: 6, md: 4 }}>
                  <MultiSelect
                    label="Card Set"
                    placeholder="Select sets..."
                    data={allCardSetNos.map(setNo => ({ value: setNo, label: formatSetName(setNo) || `Set ${setNo}` }))}
                    value={filters.cardSetNo}
                    onChange={(value) => setFilters({ ...filters, cardSetNo: value })}
                    clearable
                    searchable
                    styles={{
                      label: { color: 'white' },
                      input: { backgroundColor: 'rgba(30, 41, 59, 0.8)', color: 'white', borderColor: 'rgba(74, 144, 226, 0.3)' },
                      dropdown: { backgroundColor: 'rgba(30, 41, 59, 0.95)' },
                      option: { color: 'white' }
                    }}
                    disabled={allCardSetNos.length === 0}
                  />
                </Grid.Col>
                
                <Grid.Col span={{ base: 12, sm: 6, md: 4 }}>
                  <Group gap="xs" align="flex-end">
                    <Select
                      label="ELO"
                      value={filters.eloOperator}
                      onChange={(value) => setFilters({ ...filters, eloOperator: value as any })}
                      data={[
                        { value: '>=', label: '≥' },
                        { value: '<=', label: '≤' },
                        { value: '=', label: '=' },
                      ]}
                      style={{ flex: '0 0 80px' }}
                      styles={{
                        label: { color: 'white' },
                        input: { backgroundColor: 'rgba(30, 41, 59, 0.8)', color: 'white', borderColor: 'rgba(74, 144, 226, 0.3)' }
                      }}
                    />
                    <NumberInput
                      placeholder="ELO value"
                      value={filters.eloValue ?? ''}
                      onChange={(value) => {
                        setFilters(prev => ({ ...prev, eloValue: typeof value === 'number' ? value : null }))
                      }}
                      min={0}
                      rightSection={filters.eloValue !== null ? (
                        <button
                          type="button"
                          onClick={(e) => {
                            e.preventDefault()
                            e.stopPropagation()
                            setFilters(prev => ({ ...prev, eloValue: null }))
                          }}
                          onMouseDown={(e) => {
                            e.preventDefault()
                            e.stopPropagation()
                          }}
                          style={{
                            background: 'none',
                            border: 'none',
                            padding: 0,
                            cursor: 'pointer',
                            display: 'flex',
                            alignItems: 'center',
                            justifyContent: 'center',
                          }}
                        >
                          <IconX
                            size={16}
                            style={{ color: 'rgba(255, 255, 255, 0.7)' }}
                          />
                        </button>
                      ) : null}
                      style={{ flex: 1 }}
                      styles={{
                        label: { color: 'white' },
                        input: { backgroundColor: 'rgba(30, 41, 59, 0.8)', color: 'white', borderColor: 'rgba(74, 144, 226, 0.3)' }
                      }}
                    />
                  </Group>
                </Grid.Col>
                
                <Grid.Col span={{ base: 12, sm: 6, md: 4 }}>
                  <Group gap="xs" align="flex-end">
                    <Select
                      label="Score"
                      value={filters.scoreOperator}
                      onChange={(value) => setFilters({ ...filters, scoreOperator: value as any })}
                      data={[
                        { value: '>=', label: '≥' },
                        { value: '<=', label: '≤' },
                        { value: '=', label: '=' },
                      ]}
                      style={{ flex: '0 0 80px' }}
                      styles={{
                        label: { color: 'white' },
                        input: { backgroundColor: 'rgba(30, 41, 59, 0.8)', color: 'white', borderColor: 'rgba(74, 144, 226, 0.3)' }
                      }}
                    />
                    <NumberInput
                      placeholder="Score value (0-100)"
                      value={filters.scoreValue ?? ''}
                      onChange={(value) =>
                        setFilters(prev => ({
                          ...prev,
                          scoreValue: typeof value === 'number' ? value : null,
                        }))
                      }
                      min={0}
                      max={100}
                      step={1}
                      rightSection={filters.scoreValue !== null ? (
                        <button
                          type="button"
                          onClick={(e) => {
                            e.preventDefault()
                            e.stopPropagation()
                            setFilters(prev => ({ ...prev, scoreValue: null }))
                          }}
                          onMouseDown={(e) => {
                            e.preventDefault()
                            e.stopPropagation()
                          }}
                          style={{
                            background: 'none',
                            border: 'none',
                            padding: 0,
                            cursor: 'pointer',
                            display: 'flex',
                            alignItems: 'center',
                            justifyContent: 'center',
                          }}
                        >
                          <IconX
                            size={16}
                            style={{ color: 'rgba(255, 255, 255, 0.7)' }}
                          />
                        </button>
                      ) : null}
                      style={{ flex: 1 }}
                      styles={{
                        label: { color: 'white' },
                        input: { backgroundColor: 'rgba(30, 41, 59, 0.8)', color: 'white', borderColor: 'rgba(74, 144, 226, 0.3)' }
                      }}
                    />
                  </Group>
                </Grid.Col>
                
                <Grid.Col span={{ base: 12, sm: 6, md: 4 }}>
                  <Group gap="xs" align="flex-end">
                    <Select
                      label="Rarity"
                      placeholder="Select rarity..."
                      value={filters.rarityType}
                      onChange={(value) => setFilters({ 
                        ...filters, 
                        rarityType: value || '',
                        rarityCount: value ? 1 : null // Set default value to 1 when rarity is selected
                      })}
                      data={[
                        { value: 'Common', label: 'Common' },
                        { value: 'Common Rare', label: 'Common Rare' },
                        { value: 'Rare', label: 'Rare' },
                        { value: 'LS', label: 'LS' },
                        { value: 'Solbind', label: 'Solbind' },
                      ]}
                      clearable
                      style={{ flex: 1 }}
                      styles={{
                        label: { color: 'white' },
                        input: { backgroundColor: 'rgba(30, 41, 59, 0.8)', color: 'white', borderColor: 'rgba(74, 144, 226, 0.3)' }
                      }}
                    />
                    <NumberInput
                      placeholder="Min count"
                      value={filters.rarityCount ?? ''}
                      onChange={(value) =>
                        setFilters(prev => ({
                          ...prev,
                          rarityCount: typeof value === 'number' ? value : null,
                        }))
                      }
                      min={0}
                      rightSection={filters.rarityCount !== null ? (
                        <button
                          type="button"
                          onClick={(e) => {
                            e.preventDefault()
                            e.stopPropagation()
                            setFilters(prev => ({ ...prev, rarityCount: null }))
                          }}
                          onMouseDown={(e) => {
                            e.preventDefault()
                            e.stopPropagation()
                          }}
                          style={{
                            background: 'none',
                            border: 'none',
                            padding: 0,
                            cursor: 'pointer',
                            display: 'flex',
                            alignItems: 'center',
                            justifyContent: 'center',
                          }}
                        >
                          <IconX
                            size={16}
                            style={{ color: 'rgba(255, 255, 255, 0.7)' }}
                          />
                        </button>
                      ) : null}
                      style={{ flex: '0 0 120px' }}
                      disabled={!filters.rarityType}
                      styles={{
                        label: { color: 'white' },
                        input: { backgroundColor: 'rgba(30, 41, 59, 0.8)', color: 'white', borderColor: 'rgba(74, 144, 226, 0.3)' }
                      }}
                    />
                  </Group>
                </Grid.Col>
                
                <Grid.Col span={{ base: 12, sm: 6, md: 4 }}>
                  <Select
                    label="Sort by"
                    value={filters.sortBy}
                    onChange={(value) => setFilters({ ...filters, sortBy: value || 'date-desc' })}
                    data={[
                      { value: 'date-desc', label: 'Date (Newest first)' },
                      { value: 'date-asc', label: 'Date (Oldest first)' },
                      { value: 'name-asc', label: 'Name (A-Z)' },
                      { value: 'name-desc', label: 'Name (Z-A)' },
                      { value: 'score-desc', label: 'Score (Highest first)' },
                      { value: 'score-asc', label: 'Score (Lowest first)' },
                      { value: 'elo-desc', label: 'ELO (Highest first)' },
                      { value: 'elo-asc', label: 'ELO (Lowest first)' },
                    ]}
                    styles={{
                      label: { color: 'white' },
                      input: { backgroundColor: 'rgba(30, 41, 59, 0.8)', color: 'white', borderColor: 'rgba(74, 144, 226, 0.3)' }
                    }}
                  />
                </Grid.Col>
                
                <Grid.Col span={{ base: 12, sm: 6, md: 4 }}>
                  <Stack gap="xs">
                    <Text size="sm" fw={500} style={{ color: 'white' }}>
                      Deck Status
                    </Text>
                    <SegmentedControl
                      value={filters.expiryFilter}
                      onChange={(value) => {
                        const expiryValue = value as 'all' | 'active' | 'expiring' | 'expired'
                        setFilters({ ...filters, expiryFilter: expiryValue })
                      }}
                      data={[
                        { label: 'All', value: 'all' },
                        { label: 'Active', value: 'active' },
                        { label: 'Expiring', value: 'expiring' },
                        { label: 'Expired', value: 'expired' },
                      ]}
                      fullWidth
                    styles={{
                        root: {
                          backgroundColor: 'rgba(30, 41, 59, 0.8)',
                        },
                        label: {
                          color: 'white',
                        },
                        indicator: {
                          backgroundColor: 'rgba(74, 144, 226, 0.8)',
                        },
                      }}
                    />
                  </Stack>
                </Grid.Col>
              </Grid>
            </Stack>
          </Paper>
          </Collapse>
        
        {((showHalfDecks && filteredHalfDecks.length === 0) || !showHalfDecks) &&
         ((showFusedDecks && filteredFusedDecks.length === 0) || !showFusedDecks) ? (
          <Paper
            p="xl"
            className="w-full backdrop-blur-md border border-sf-primary/30 rounded-xl"
            style={{ 
              backgroundColor: 'rgba(30, 41, 59, 0.6)',
            }}
          >
            <Text size="lg" className="text-center text-gray-400">
              No decks match the filters
            </Text>
          </Paper>
        ) : (
          <div ref={gridContainerRef}>
            {/* Half Decks Section */}
            {showHalfDecks && filteredHalfDecks.length > 0 && (
              <Stack gap="md" className="mb-8">
                  <Group justify="space-between" align="center">
                    <Title order={3} className="text-white">
                      Decks ({filteredHalfDecks.length})
                    </Title>
                    {regularPageCount > 1 && (
                    <Group gap="xs" align="center" justify="center">
                      <Text size="sm" className="text-gray-300">
                        Page
                      </Text>
                      <NumberInput
                        size="xs"
                        value={regularPage}
                        min={1}
                        max={regularPageCount}
                        onChange={handleRegularPageChange}
                        hideControls
                        styles={{
                          input: { width: 60, textAlign: 'center' },
                        }}
                      />
                      <Text size="sm" className="text-gray-300">
                        of {regularPageCount} ({PAGE_SIZE} per page)
                      </Text>
                      <Button
                        size="xs"
                        variant="outline"
                        disabled={regularPage <= 1}
                        onClick={() => setRegularPage((p) => Math.max(1, p - 1))}
                      >
                        Prev
                      </Button>
                      {renderPageButtons(regularPage, regularPageCount, (p) => setRegularPage(p))}
                      <Button
                        size="xs"
                        variant="outline"
                        disabled={regularPage >= regularPageCount}
                        onClick={() => setRegularPage((p) => Math.min(regularPageCount, p + 1))}
                      >
                        Next
                      </Button>
                    </Group>
                    )}
                </Group>
                <div ref={regularListRef} style={{ position: 'relative' }}>
                  {regularRows.map((rowDecks, idx) => (
                    <div key={`regular-row-${idx}`} style={{ paddingBottom: '16px' }}>
                      <Grid gutter="md">
                        {rowDecks.map((deck) => (
                          <RegularDeckCard key={deck.id} deck={deck} handleDeckClick={handleDeckClick} />
                        ))}
                      </Grid>
                    </div>
                  ))}
                </div>
                {regularPageCount > 1 && (
                  <Group gap="xs" align="center" justify="center">
                    <Text size="sm" className="text-gray-300">
                      Page
                    </Text>
                    <NumberInput
                      size="xs"
                      value={regularPage}
                      min={1}
                      max={regularPageCount}
                      onChange={handleRegularPageChange}
                      hideControls
                      styles={{
                        input: { width: 60, textAlign: 'center' },
                      }}
                    />
                    <Text size="sm" className="text-gray-300">
                      of {regularPageCount} ({PAGE_SIZE} per page)
                    </Text>
                    <Button
                      size="xs"
                      variant="outline"
                      disabled={regularPage <= 1}
                      onClick={() => setRegularPage((p) => Math.max(1, p - 1))}
                    >
                      Prev
                    </Button>
                    {renderPageButtons(regularPage, regularPageCount, (p) => setRegularPage(p))}
                    <Button
                      size="xs"
                      variant="outline"
                      disabled={regularPage >= regularPageCount}
                      onClick={() => setRegularPage((p) => Math.min(regularPageCount, p + 1))}
                    >
                      Next
                    </Button>
                  </Group>
                )}
              </Stack>
            )}
            
            {/* Fused Decks Section */}
            {showFusedDecks && filteredFusedDecks.length > 0 && (
              <Stack gap="md">
                  <Group justify="space-between" align="center">
                    <Title order={3} className="text-white">
                      Fused ({filteredFusedDecks.length})
                    </Title>
                    {fusedPageCount > 1 && (
                    <Group gap="xs" align="center" justify="center">
                      <Text size="sm" className="text-gray-300">
                        Page
                      </Text>
                      <NumberInput
                        size="xs"
                        value={fusedPage}
                        min={1}
                        max={fusedPageCount}
                        onChange={handleFusedPageChange}
                        hideControls
                        styles={{
                          input: { width: 60, textAlign: 'center' },
                        }}
                      />
                      <Text size="sm" className="text-gray-300">
                        of {fusedPageCount} ({PAGE_SIZE} per page)
                      </Text>
                      <Button
                        size="xs"
                        variant="outline"
                        disabled={fusedPage <= 1}
                        onClick={() => setFusedPage((p) => Math.max(1, p - 1))}
                      >
                        Prev
                      </Button>
                      {renderPageButtons(fusedPage, fusedPageCount, (p) => setFusedPage(p))}
                      <Button
                        size="xs"
                        variant="outline"
                        disabled={fusedPage >= fusedPageCount}
                        onClick={() => setFusedPage((p) => Math.min(fusedPageCount, p + 1))}
                      >
                        Next
                      </Button>
                    </Group>
                  )}
                </Group>
                <div ref={fusedListRef} style={{ position: 'relative' }}>
                  {fusedRows.map((rowDecks, idx) => (
                    <div key={`fused-row-${idx}`} style={{ paddingBottom: '16px' }}>
                      <Grid gutter="md">
                        {rowDecks.map((deck) => {
                          const [d1, d2] = getFusedDeckSourceDecks(deck, [...decks, ...fusedDecks])
                          return (
                            <FusedDeckCard
                              key={deck.id}
                              deck={deck}
                              sourceDecks={[d1, d2]}
                              handleDeckClick={handleDeckClick}
                              deckTagsMap={deckTagsMap}
                              allDecks={[...decks, ...fusedDecks]}
                              fusedExpiryResolver={getFusedDeckExpiryStatus}
                            />
                          )
                        })}
                      </Grid>
                    </div>
                  ))}
                </div>
                {fusedPageCount > 1 && (
                  <Group gap="xs" align="center" justify="center">
                    <Text size="sm" className="text-gray-300">
                      Page
                    </Text>
                    <NumberInput
                      size="xs"
                      value={fusedPage}
                      min={1}
                      max={fusedPageCount}
                      onChange={handleFusedPageChange}
                      hideControls
                      styles={{
                        input: { width: 60, textAlign: 'center' },
                      }}
                    />
                    <Text size="sm" className="text-gray-300">
                      of {fusedPageCount} ({PAGE_SIZE} per page)
                    </Text>
                    <Button
                      size="xs"
                      variant="outline"
                      disabled={fusedPage <= 1}
                      onClick={() => setFusedPage((p) => Math.max(1, p - 1))}
                    >
                      Prev
                    </Button>
                    {renderPageButtons(fusedPage, fusedPageCount, (p) => setFusedPage(p))}
                    <Button
                      size="xs"
                      variant="outline"
                      disabled={fusedPage >= fusedPageCount}
                      onClick={() => setFusedPage((p) => Math.min(fusedPageCount, p + 1))}
                    >
                      Next
                    </Button>
                  </Group>
                )}
              </Stack>
            )}

          </div>
        )}
      </div>
      
      <DeckDetails
        deck={selectedDeck}
        opened={detailsOpened}
        onClose={() => {
          // Close immediately (no animation delay)
          setDetailsOpened(false)
          setSelectedDeck(null)
          setParentFusedDeck(null)
        }}
        onDeckClick={(deck, parentDeck) => {
          // If clicking from DeckDetails, use the parentDeck passed from there
          // If parentDeck is explicitly null, clear parentFusedDeck
          // Otherwise, if parentDeck is provided, use it; if not, use stored parentFusedDeck
          if (parentDeck === null) {
            handleDeckClick(deck, null)
          } else {
            handleDeckClick(deck, parentDeck || parentFusedDeck)
          }
        }}
        allDecks={[...decks, ...fusedDecks]}
        parentFusedDeck={parentFusedDeck}
      />
    </>
  )
}
