'use client'

import { useState, useMemo, useEffect, useRef, useLayoutEffect, useTransition, useCallback, memo, ReactNode } from 'react'
import { pluralize } from '@/lib/pluralize'
import { Stack, Paper, Title, Text, Group, Badge, Grid, TextInput, NumberInput, Select, MultiSelect, Collapse, Button, SegmentedControl, Image, ActionIcon } from '@mantine/core'
import { IconCards, IconCalendar, IconFilter, IconX } from '@tabler/icons-react'
import { useRouter, useSearchParams } from 'next/navigation'
import { useDebouncedValue, useMediaQuery } from '@mantine/hooks'
import type { Deck } from '@/store/deckStore'
import { useDeckStore } from '@/store/deckStore'
import { DeckDetails } from './DeckDetails'
import { getCardInfo, type CardInfo } from '@/lib/api'
import { computeCreatureTypesForDeck } from '@/lib/creatureTypes'
import { fetchCreatureTypesForDeckId } from '@/lib/creatureTypeOverrides'

type CreatureTypeMap = Record<string, number>

const buildCreatureTypeEntries = (
  deck: Deck,
  options: { deckCreatureTypesMap?: Record<string, CreatureTypeMap>; fallbackCards?: any[] } = {}
) => {
  const deckAny = deck as any
  let creatureMap: CreatureTypeMap | undefined =
    (deck.computed?.creatureType as CreatureTypeMap | undefined) ||
    (deckAny.creatureType as CreatureTypeMap | undefined)

  if (!creatureMap && options.deckCreatureTypesMap && deck.id) {
    creatureMap = options.deckCreatureTypesMap[deck.id]
  }

  if (!creatureMap) {
    try {
      creatureMap = computeCreatureTypesForDeck(deck)
    } catch (err) {
      console.warn('[DeckList] creatureType fallback failed', err)
    }
  }

  if ((!creatureMap || Object.keys(creatureMap).length === 0) && options.fallbackCards) {
    try {
      creatureMap = computeCreatureTypesForDeck({ cards: options.fallbackCards })
    } catch {
      // ignore
    }
  }

  if (!creatureMap || typeof creatureMap !== 'object') return []

  return Object.entries(creatureMap)
    .filter(([, count]) => Number(count) > 0)
    .sort((a, b) => {
      const diff = Number(b[1]) - Number(a[1])
      if (diff !== 0) return diff
      return a[0].localeCompare(b[0])
    })
}

const isFusedDeckLike = (deck: any) => String(deck?.format || '').toLowerCase() === 'fused'
const creatureTypeOverrideRequested = new Set<string>()

const buildFusedCreatureTypeEntries = (
  deck: Deck,
  options: {
    deckCreatureTypesMap?: Record<string, CreatureTypeMap>
    allDecks?: Deck[]
    sourceDecks?: Deck[]
  } = {}
) => {
  if (!isFusedDeckLike(deck)) return []
  const deckCreatureTypesMap = options.deckCreatureTypesMap || {}
  const allDecks = options.allDecks || []
  const regularByName = new Map<string, Deck>()
  allDecks.forEach((d) => {
    if (!d?.name) return
    if (isFusedDeckLike(d)) return
    regularByName.set(d.name.trim().toLowerCase(), d)
  })
  const regularById = new Map<string, Deck>()
  allDecks.forEach((d) => {
    if (!d?.id) return
    if (isFusedDeckLike(d)) return
    regularById.set(String(d.id).trim().toLowerCase(), d)
  })

  const normalizeName = (value?: string | null) => (value ? value.trim().toLowerCase() : '')
  const normalizeId = (value?: string | null) => {
    if (!value) return ''
    return value
      .trim()
      .toLowerCase()
      .replace(/^deck[_-]?/i, '')
      .replace(/^fused[_-]?/i, '')
  }
  const hasSubtypeData = (cards?: any[]) => {
    if (!Array.isArray(cards)) return false
    return cards.some((card) => {
      if (!card || typeof card !== 'object') return false
      return Boolean(
        card.cardSubType ||
          card.CardSubType ||
          card.SubType ||
          card.subType ||
          card.SUBTYPE
      )
    })
  }

  const resolveCreatureMap = (d?: Deck | null) => {
    if (!d) return undefined
    const candidateCards =
      (Array.isArray((d as any).cardList) && (d as any).cardList) ||
      (Array.isArray((d as any).cards) && (d as any).cards) ||
      ((d as any).cards && typeof (d as any).cards === 'object' ? Object.values((d as any).cards) : [])
    if (hasSubtypeData(candidateCards)) {
      try {
        const computed = computeCreatureTypesForDeck({ cards: candidateCards })
        if (computed && Object.keys(computed).length > 0) return computed
      } catch {
        // ignore
      }
    }
    if (d.computed?.creatureType && Object.keys(d.computed.creatureType).length > 0) {
      return d.computed.creatureType as CreatureTypeMap
    }
    const mapFromStore = d.id ? deckCreatureTypesMap[d.id] : undefined
    if (mapFromStore && Object.keys(mapFromStore).length > 0) return mapFromStore
    return undefined
  }

  const sourceCandidates: Array<{ id?: string; name?: string }> = []
  const deckAny = deck as any
  if (Array.isArray(options.sourceDecks) && options.sourceDecks.length > 0) {
    options.sourceDecks.forEach((d) => {
      if (d?.id || d?.name || (d as any)?.deckId || (d as any)?.deckName) {
        sourceCandidates.push({
          id: (d as any).id || (d as any).deckId,
          name: (d as any).name || (d as any).deckName,
        })
      }
    })
  } else if (Array.isArray(deckAny.myDecks)) {
    deckAny.myDecks.forEach((d: any) => {
      if (d?.id || d?.name || d?.deckId || d?.deckName) {
        sourceCandidates.push({ id: d.id || d.deckId, name: d.name || d.deckName })
      }
    })
  } else if (Array.isArray(deckAny.fusedDeckIds)) {
    deckAny.fusedDeckIds.forEach((id: string) => sourceCandidates.push({ id }))
  }

  const seenIds = new Set<string>()
  const seenNames = new Set<string>()
  const combined: CreatureTypeMap = {}

  const addMap = (map?: CreatureTypeMap) => {
    if (!map) return
    Object.entries(map).forEach(([type, count]) => {
      if (typeof count !== 'number') return
      combined[type] = (combined[type] || 0) + count
    })
  }

  sourceCandidates.forEach(({ id, name }) => {
    if (id) {
      const normalizedId = normalizeId(String(id))
      if (normalizedId && !seenIds.has(normalizedId)) {
        seenIds.add(normalizedId)
        const byStore = deckCreatureTypesMap[id] || deckCreatureTypesMap[normalizedId]
        if (byStore) {
          addMap(byStore)
          return
        }
        const match = regularById.get(normalizedId)
        const resolved = resolveCreatureMap(match)
        if (resolved) {
          addMap(resolved)
          return
        }
      }
    }
    if (name) {
      const normalized = normalizeName(String(name))
      if (!normalized || seenNames.has(normalized)) return
      seenNames.add(normalized)
      const match = regularByName.get(normalized)
      if (match?.id) {
        const resolved = resolveCreatureMap(match)
        if (resolved) addMap(resolved)
      }
    }
  })

  if (Object.keys(combined).length === 0) return []

  return Object.entries(combined)
    .filter(([, count]) => Number(count) > 0)
    .sort((a, b) => {
      const diff = Number(b[1]) - Number(a[1])
      if (diff !== 0) return diff
      return a[0].localeCompare(b[0])
    })
}

const applyMode = (match: boolean, mode: 'include' | 'exclude') => (mode === 'include' ? match : !match)
const MODE_OPTIONS = [
  { label: 'Include', value: 'include' },
  { label: 'Exclude', value: 'exclude' },
]

// Helper function to format set name: "1" -> "S1", "2" -> "S2", "B1" -> "B1", "B2" -> "B2", "B3" -> "B3", etc.
function formatSetName(setNo: string | number | null | undefined): string | null {
  if (!setNo) return null

  const setStr = String(setNo).trim()
  
  // If it's already B1/B2/B3, return uppercase
  if (setStr.toUpperCase() === 'B1' || setStr.toLowerCase() === 'b1') {
    return 'B1'
  }
  if (setStr.toUpperCase() === 'B2' || setStr.toLowerCase() === 'b2') {
    return 'B2'
  }
  if (setStr.toUpperCase() === 'B3' || setStr.toLowerCase() === 'b3') {
    return 'B3'
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

// Helper function to detect B-set cards (B1/B2/B3)
function getBSetFromCard(card: any): 'B1' | 'B2' | 'B3' | null {
  if (!card) return null
  if (typeof card === 'string') {
    if (/^b3_/i.test(card)) return 'B3'
    if (/^b2_/i.test(card)) return 'B2'
    if (/^b1_/i.test(card)) return 'B1'
    return null
  }
  if (typeof card === 'object' && card !== null) {
    const cardSetId = card.cardSetId || card.CardSetId || card.SK || card.sk
    const cardId = card.id || card.cardId || card.name
    const setLower = cardSetId ? String(cardSetId).toLowerCase() : ''
    if (setLower === 'b3') return 'B3'
    if (setLower === 'b2') return 'B2'
    if (setLower === 'b1') return 'B1'
    if (cardId && /^b3_/i.test(cardId)) return 'B3'
    if (cardId && /^b2_/i.test(cardId)) return 'B2'
    if (cardId && /^b1_/i.test(cardId)) return 'B1'
  }
  return null
}

function getBSetFromCards(cards: any[]): 'B1' | 'B2' | 'B3' | null {
  let found: 'B1' | 'B2' | 'B3' | null = null
  for (const card of cards) {
    const bSet = getBSetFromCard(card)
    if (bSet === 'B3') return 'B3'
    if (bSet === 'B2') {
      found = 'B2'
      continue
    }
    if (bSet === 'B1' && found !== 'B2') found = 'B1'
  }
  return found
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

// Helper function to determine deck set: if any card is from B1/B2/B3, return that set, otherwise use deck.cardSetNo
function getDeckSet(deck: Deck): string | null {
  if (!deck) return null
  
  const deckAny = deck as any
  const normalizeSetValue = (value?: string | number | null): string | null => {
    if (value === undefined || value === null) return null
    const text = String(value).trim()
    if (!text) return null
    const lower = text.toLowerCase()
    if (lower === 'b3') return 'B3'
    if (lower === 'b2') return 'B2'
    if (lower === 'b1') return 'B1'
    if (lower === 'd0') return 'S99'
    return text
  }

  const explicitSet = normalizeSetValue(deckAny.cardSetId ?? deckAny.card_set_id ?? deckAny.cardSetNo ?? deckAny.card_set_no)
  if (explicitSet) return explicitSet
  if (deckAny?.computed && deckAny.computed.deckSet !== undefined) {
    return normalizeSetValue(deckAny.computed.deckSet as string | null)
  }

  const deriveSetFromId = (id?: string | null): string | null => {
    if (!id || typeof id !== 'string') return null
    const lower = id.toLowerCase()
    if (lower.startsWith('b1-') || lower.startsWith('b1_')) return 'B1'
    if (lower.startsWith('b2-') || lower.startsWith('b2_')) return 'B2'
    if (lower.startsWith('b3-') || lower.startsWith('b3_')) return 'B3'
    if (lower.startsWith('s1-')) return 'S1'
    if (lower.startsWith('s2-')) return 'S2'
    if (lower.startsWith('s3-')) return 'S3'
    if (lower.startsWith('s4-')) return 'S4'
    return null
  }
  
  // For fused decks, check cards from source decks (myDecks) if cards array is empty
  if (deckAny.format === 'Fused' && (!deck.cards || !Array.isArray(deck.cards) || deck.cards.length === 0)) {
    // Check source decks (myDecks) for explicit set first, then B1/B2 cards
    if (deckAny.myDecks && Array.isArray(deckAny.myDecks)) {
      for (const sourceDeck of deckAny.myDecks) {
        if (!sourceDeck) continue
        const explicitSet = sourceDeck.cardSetNo || sourceDeck.cardSetId || deriveSetFromId(sourceDeck.id)
        if (explicitSet) {
          return explicitSet
        }
        if (sourceDeck.cards && Array.isArray(sourceDeck.cards)) {
          const bSet = getBSetFromCards(sourceDeck.cards)
          if (bSet) return bSet
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
    return deck.cardSetNo || deckAny.cardSetId || deriveSetFromId(deckAny.id) || null
  }
  
  // Check if any card is from B1/B2/B3 set
  const bSet = getBSetFromCards(deck.cards)
  if (bSet) {
    return bSet
  }
  
  // Otherwise use deck.cardSetNo
  return deck.cardSetNo || deckAny.cardSetId || deriveSetFromId(deckAny.id) || null
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

// Extract primary Forgeborn name from a deck
function getForgebornNameFromDeck(deck: Deck): string | null {
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
  deckCreatureTypesMap,
  handleDeckClick,
}: {
  deck: Deck
  deckCreatureTypesMap?: Record<string, CreatureTypeMap>
  handleDeckClick: (deck: Deck) => void
}) {
  const [renderNow] = useState(() => Date.now())
  const computedCounts = deck.computed?.counts && deck.computed.counts.total > 0 ? deck.computed.counts : null
  // Prefer computed counts (from store) and fall back to a full local count (includes Solbind children)
  const displayCounts = computedCounts || countPlayableCards(deck)
  const forgebornName = useMemo(() => getForgebornNameFromDeck(deck), [deck])
  const expiryTs = getExpiryTimestamp(deck)
  const isExpired = expiryTs !== null && expiryTs < renderNow
  const { borderColor, hoverBorderColor } = getBorderColors(deck, renderNow)
  const creatureTypeEntries = useMemo(
    () => buildCreatureTypeEntries(deck, { deckCreatureTypesMap }),
    [deck, deckCreatureTypesMap]
  )

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
          height: '100%',
          display: 'flex',
          flexDirection: 'column',
          justifyContent: 'flex-start',
          alignItems: 'stretch',
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
        <Stack gap={6} style={{ flex: 1 }} justify="flex-start" align="stretch">
          <Group gap="xs" wrap="wrap" align="center">
            {(deck as any).playerName && (
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
            )}
            {forgebornName && (
              <Badge
                color="cyan"
                variant="light"
                size="sm"
                radius="sm"
              >
                FB: {forgebornName}
              </Badge>
            )}
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
                {new Date(expiryTs).toLocaleDateString('en-GB', {
                  day: 'numeric',
                  month: 'short',
                  year: 'numeric',
                })}
              </Badge>
            )}
          </Group>

          <Title
            order={4}
            className="text-white"
            style={{ margin: 0, lineHeight: 1.25 }}
          >
            {deck.name || 'Untitled'}
          </Title>

          <Group gap={8} style={{ marginTop: '4px' }}>
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
                          Solbind: 0,
                          Common: 1,
                          'Common Common': 2,
                          'Common Rare': 3,
                          Rare: 4,
                          'Rare Common': 5,
                          'Rare Rare': 6,
                          'Darkforge Rare': 7,
                          Darkforge: 8,
                          LS: 9,
                        }
                        return (order[a] || 99) - (order[b] || 99)
                      })
                      .map(([rarity, count]) => {
                        const getRarityColor = (rarityName: string): string => {
                          const key = rarityName.replace(/\s+/g, '').toLowerCase()
                          const map: Record<string, string> = {
                            commoncommon: '#2f92d0',
                            common: '#1096e1',
                            commonrare: '#e5b522',
                            rarecommon: '#6a5320',
                            rare: '#f0c320',
                            rarerare: '#d9a600',
                            darkforge: '#1a1a1a',
                            darkforgerare: '#101010',
                            ls: '#b00008',
                            solbind: '#2fcad0',
                          }
                          return map[key] || '#1199e3'
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

          {creatureTypeEntries.length > 0 && (
            <Group gap="xs" className="mt-1 flex-wrap">
              {creatureTypeEntries.map(([type, count]) => {
                const pretty = type.charAt(0).toUpperCase() + type.slice(1)
                return (
                  <Badge key={`${deck.id}-ctype-${type}`} color="grape" variant="outline" size="sm">
                    {`${pretty} ${count}`}
                  </Badge>
                )
              })}
            </Group>
          )}
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
  deckCreatureTypesMap,
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
  deckCreatureTypesMap?: Record<string, CreatureTypeMap>
}) {
  const [renderNow] = useState(() => Date.now())
  const fusedDeckAny = deck as any
  const [deck1, deck2] = sourceDecks || [null, null]
  const forgebornName = useMemo(() => getForgebornNameFromDeck(deck), [deck])

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
    if (lower.startsWith('b1-') || lower.startsWith('b1_')) return 'B1'
    if (lower.startsWith('b2-') || lower.startsWith('b2_')) return 'B2'
    if (lower.startsWith('b3-') || lower.startsWith('b3_')) return 'B3'
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
    const maybeAddSolbindById = (id?: string | null) => {
      if (!id) return
      const cleanId = String(id).trim()
      if (!cleanId) return
      if (solbindSet.has(cleanId)) return
      solbindSet.add(cleanId)
      solbindCards.push(getCardInfo(cleanId))
    }

    // From cards' solbindCards
    cards.forEach((card: any, idx: number) => {
      const cardData = typeof card === 'string' ? getCardInfo(card) : getCardInfo(card.id || card.cardId || card.name || `card-${idx}`, card)
      if (cardData && (cardData as any).solbindCards && Array.isArray((cardData as any).solbindCards)) {
        ;(cardData as any).solbindCards.forEach((sb: any) => maybeAddSolbind(sb))
      }
      const cardDataAny = cardData as any
      maybeAddSolbindById(cardDataAny?.solbindId1 || cardDataAny?.solbindid1)
      maybeAddSolbindById(cardDataAny?.solbindId2 || cardDataAny?.solbindid2)
    })

    // From deck forgeborn solbindCards
    if (deck && (deck as any).forgeborn && Array.isArray((deck as any).forgeborn.solbindCards)) {
      ;(deck as any).forgeborn.solbindCards.forEach((sb: any) => maybeAddSolbind(sb))
    }
    if (deck && (deck as any).forgeborn) {
      const fb: any = (deck as any).forgeborn
      maybeAddSolbindById(fb.solbindId1 || fb.solbindid1)
      maybeAddSolbindById(fb.solbindId2 || fb.solbindid2)
    }

    return [...cards, ...solbindCards]
  }, [deck, fusedDeckAny.myDecks, fusedDeckAny.fusedDeckIds, allDecksMap, pickedSources, extractCards])

  // Memoize aggregated cards to avoid recomputation across derived calculations
  const aggregatedCards = useMemo(() => aggregateCards(), [aggregateCards])
  const creatureTypeEntries = useMemo(
    () =>
      buildFusedCreatureTypeEntries(deck, {
        deckCreatureTypesMap,
        allDecks,
        sourceDecks: pickedSources,
      }),
    [deck, deckCreatureTypesMap, allDecks, pickedSources]
  )

  const halfDeckIds = useMemo(() => {
    const ids = new Set<string>()
    const addId = (value?: string | null) => {
      const trimmed = (value || '').trim()
      if (trimmed) ids.add(trimmed)
    }
    if (Array.isArray(fusedDeckAny.myDecks)) {
      fusedDeckAny.myDecks.forEach((d: any) => addId(d?.id || d?.deckId || d?.deck_id))
    }
    if (Array.isArray(fusedDeckAny.fusedDeckIds)) {
      fusedDeckAny.fusedDeckIds.forEach((id: string) => addId(id))
    }
    pickedSources.forEach((d) => addId((d as any)?.id || (d as any)?.deckId || (d as any)?.deck_id))
    return Array.from(ids)
  }, [fusedDeckAny.myDecks, fusedDeckAny.fusedDeckIds, pickedSources])

  useEffect(() => {
    if (halfDeckIds.length === 0) return
    const store = useDeckStore.getState()
    halfDeckIds.forEach((id) => {
      if (!id) return
      if (creatureTypeOverrideRequested.has(id)) return
      creatureTypeOverrideRequested.add(id)
      fetchCreatureTypesForDeckId(id).then((creatureType) => {
        if (creatureType && Object.keys(creatureType).length > 0) {
          store.setDeckCreatureType(id, creatureType)
        } else {
          creatureTypeOverrideRequested.delete(id)
        }
      })
    })
  }, [halfDeckIds, deckCreatureTypesMap])

  const fusedSetLabels = useMemo(() => {
    const setLabels = new Set<string>()
    factionSets.forEach(item => {
      if (item.setNo) {
        const label = formatSetName(item.setNo)
        if (label) setLabels.add(label)
      }
    })

    if (setLabels.size === 0) {
      const bSet = getBSetFromCards(aggregatedCards as any[])
      if (bSet) setLabels.add(formatSetName(bSet) || bSet)
      const parentSet = getDeckSet(deck)
      if (parentSet) {
        const label = formatSetName(parentSet)
        if (label) setLabels.add(label)
      }
    }

    return Array.from(setLabels)
  }, [factionSets, aggregatedCards, deck])

  const counts = useMemo(() => {
    let derived: { total: number; creatures: number; spells: number; solbind: number } | null = null

    if (aggregatedCards.length > 0) {
      let creatures = 0
      let spells = 0
      const solbindIds = new Set<string>()
      aggregatedCards.forEach((card: any, idx: number) => {
        const info = typeof card === 'string'
          ? getCardInfo(card)
          : getCardInfo(card.id || card.cardId || card.name || `card-${idx}`, card)
        const cardData = info as any

        const cardTypeRaw = (cardData.cardType || cardData.card_type || '').toLowerCase()
        const typeRaw = (cardData.type || '').toLowerCase()
        const isForgeborn = cardTypeRaw.includes('forgeborn') || typeRaw.includes('forgeborn')
        if (isForgeborn) {
          if (cardData.solbindId1 || cardData.solbindid1) solbindIds.add(cardData.solbindId1 || cardData.solbindid1)
          if (cardData.solbindId2 || cardData.solbindid2) solbindIds.add(cardData.solbindId2 || cardData.solbindid2)
          if (Array.isArray(cardData.solbindCards)) {
            cardData.solbindCards.forEach((sb: any) => {
              const sid = sb?.id || sb?.cardId || sb?.name
              if (sid) solbindIds.add(sid)
            })
          }
          return
        }

        const isParentSolbind =
          (Array.isArray(cardData.solbindCards) && cardData.solbindCards.length > 0) ||
          !!(cardData.solbindId1 || cardData.solbindid1 || cardData.solbindId2 || cardData.solbindid2)

        const isSolbindChild = solbindIds.has(cardData.id || cardData.cardId || cardData.name)
        if (isSolbindChild) return

        const isSpell = cardTypeRaw.includes('spell') && !cardTypeRaw.includes('creature')
        if (isParentSolbind) {
          if (isSpell) {
            spells += 1
          } else {
            creatures += 1
          }
          if (Array.isArray(cardData.solbindCards)) {
            cardData.solbindCards.forEach((sb: any) => {
              const sid = sb?.id || sb?.cardId || sb?.name
              if (sid) {
                solbindIds.add(sid)
              }
            })
          }
          if (cardData.solbindId1) solbindIds.add(cardData.solbindId1)
          if (cardData.solbindid1) solbindIds.add(cardData.solbindid1)
          if (cardData.solbindId2) solbindIds.add(cardData.solbindId2)
          if (cardData.solbindid2) solbindIds.add(cardData.solbindid2)
          return
        }

        if (isSpell) {
          spells += 1
        } else {
          creatures += 1
        }
      })

      const solbindTotal = solbindIds.size
      derived = { total: creatures + spells + solbindTotal, creatures, spells, solbind: solbindTotal }
    }

    if (!derived) {
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
        if (summed.total > 0) derived = summed
      }
    }

    if (!derived && deck.cards && Array.isArray(deck.cards) && deck.cards.length > 0) {
      derived = countPlayableCards(deck)
    }

    if (!derived) {
      derived = { total: 0, creatures: 0, spells: 0, solbind: 0 }
    }

    const comp = deck.computed?.counts
    if (!comp) return derived
    return {
      total: Math.max(derived.total, comp.total ?? 0),
      creatures: Math.max(derived.creatures, comp.creatures ?? 0),
      spells: Math.max(derived.spells, comp.spells ?? 0),
      solbind: Math.max(derived.solbind, comp.solbind ?? 0),
    }
  }, [aggregatedCards, deck, pickedSources])

  const rarityCounts = useMemo(() => {
    if (deck.computed?.rarityCounts) {
      return new Map(Object.entries(deck.computed.rarityCounts))
    }

    const cards = aggregatedCards
    const counts = new Map<string, number>()
    const solbindIds = new Set<string>()
    const deckAny: any = deck as any

    // Collect Solbind child IDs from cards and forgeborn hints
    cards.forEach((card: any, idx: number) => {
      const info =
        typeof card === 'string'
          ? getCardInfo(card)
          : getCardInfo(card.id || card.cardId || card.name || `card-${idx}`, card)
      const cardData = info as any
      if (cardData.solbindCards && Array.isArray(cardData.solbindCards)) {
        cardData.solbindCards.forEach((sb: any) => {
          const sid = sb?.id || sb?.cardId || sb?.name
          if (sid) solbindIds.add(sid)
        })
      }
      if (typeof cardData.solbind === 'string') {
        cardData.solbind
          .split(',')
          .map((s: string) => s.trim())
          .filter(Boolean)
          .forEach((sid: string) => solbindIds.add(sid))
      }
      if (cardData.solbindId1 || cardData.solbindid1) solbindIds.add(cardData.solbindId1 || cardData.solbindid1)
      if (cardData.solbindId2 || cardData.solbindid2) solbindIds.add(cardData.solbindId2 || cardData.solbindid2)
    })
    if (deckAny?.forgeborn && Array.isArray(deckAny.forgeborn.solbindCards)) {
      deckAny.forgeborn.solbindCards.forEach((solbindCard: any) => {
        const sid = solbindCard?.id || solbindCard?.cardId || solbindCard?.name
        if (sid) solbindIds.add(sid)
      })
    }
    if (deckAny?.forgeborn) {
      const fb: any = deckAny.forgeborn
      if (fb.solbindId1 || fb.solbindid1) solbindIds.add(fb.solbindId1 || fb.solbindid1)
      if (fb.solbindId2 || fb.solbindid2) solbindIds.add(fb.solbindId2 || fb.solbindid2)
    }

    let parentSolbindCount = 0
    cards.forEach((card: any, idx: number) => {
      const info =
        typeof card === 'string'
          ? getCardInfo(card)
          : getCardInfo(card.id || card.cardId || card.name || `card-${idx}`, card)
      const rarity = (info as any)?.rarity
      const cardData = info as any
      const cardId = cardData.id || cardData.cardId || cardData.name || `card-${idx}`
      if (solbindIds.has(cardId)) return
      const rarityLower = typeof rarity === 'string' ? rarity.toLowerCase() : ''
      const hasChildren =
        (Array.isArray(cardData.solbindCards) && cardData.solbindCards.length > 0) ||
        typeof cardData.solbind === 'string' ||
        !!(cardData.solbindId1 || cardData.solbindid1 || cardData.solbindId2 || cardData.solbindid2)
      const isParentSolbind = hasChildren && typeof rarity === 'string' && rarityLower.includes('solbind')
      if (isParentSolbind) {
        parentSolbindCount += 1
        return
      }

      if (rarity && typeof rarity === 'string') {
        let normalized = rarity.trim()
        const lower = normalized.toLowerCase()
        if (lower.includes('n/a')) return
        if (lower.includes('darkforge') && lower.includes('rare')) normalized = 'Darkforge Rare'
        else if (lower.includes('common common')) normalized = 'Common Common'
        else if (lower.includes('rare rare')) normalized = 'Rare Rare'
        else if (lower.includes('rare') && lower.includes('common')) normalized = 'Rare Common'
        else if (lower.includes('common') && lower.includes('rare')) normalized = 'Common Rare'
        else if (lower.includes('darkforge')) normalized = 'Darkforge'
        else if (lower.includes('common')) normalized = 'Common'
        else if (lower.includes('rare')) normalized = 'Rare'
        else if (lower.includes('ls') || lower.includes('legendary')) normalized = 'LS'
        else if (lower.includes('solbind')) normalized = 'Solbind'
        counts.set(normalized, (counts.get(normalized) || 0) + 1)
      }
    })

    if (parentSolbindCount > 0) {
      counts.set('Solbind', (counts.get('Solbind') || 0) + parentSolbindCount)
    }
    return counts
  }, [aggregatedCards, deck.computed, deck])

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
          height: '100%',
          display: 'flex',
          flexDirection: 'column',
          justifyContent: 'flex-start',
          alignItems: 'stretch',
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
        <Stack gap={6} style={{ flex: 1 }} justify="flex-start" align="stretch">
          <Group gap="xs" wrap="wrap" align="center">
            {(deck as any).playerName && (
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
            )}
            {forgebornName && (
              <Badge
                color="cyan"
                variant="light"
                size="sm"
                radius="sm"
              >
                FB: {forgebornName}
              </Badge>
            )}
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
                {expireLabel}
              </Badge>
            )}
          </Group>

          <Group justify="space-between" align="flex-start" wrap="nowrap">
            <Title
              order={4}
              className="text-white"
              style={{ margin: 0, lineHeight: 1.25 }}
            >
              {deck.name || 'Untitled'}
            </Title>
          </Group>

          <Group gap="xs" wrap="wrap" align="center" style={{ marginTop: '4px' }}>
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
              const key = rarityName.replace(/\s+/g, '').toLowerCase()
              const map: Record<string, string> = {
                commoncommon: '#2f92d0',
                common: '#1096e1',
                commonrare: '#e5b522',
                rarecommon: '#6a5320',
                rare: '#f0c320',
                rarerare: '#d9a600',
                darkforge: '#1a1a1a',
                darkforgerare: '#101010',
                ls: '#b00008',
                solbind: '#2fcad0',
              }
              return map[key] || '#1199e3'
            }
            return (
              <Group gap="xs" className="flex-wrap">
                {Array.from(rarityCounts.entries())
                  .sort(([a], [b]) => {
                    const order: Record<string, number> = {
                      Solbind: 0,
                      Common: 1,
                      'Common Common': 2,
                      'Common Rare': 3,
                      Rare: 4,
                      'Rare Common': 5,
                      'Rare Rare': 6,
                      'Darkforge Rare': 7,
                      Darkforge: 8,
                      LS: 9,
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

          {(() => {
            if (creatureTypeEntries.length === 0) return null
            return (
              <Group gap="xs" className="mt-1 flex-wrap">
                {creatureTypeEntries.map(([type, count]) => {
                  const pretty = type.charAt(0).toUpperCase() + type.slice(1)
                  return (
                    <Badge key={`${deck.id}-ctype-${type}`} color="grape" variant="outline" size="sm">
                      {`${pretty} ${count}`}
                    </Badge>
                  )
                })}
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
  deckCreatureTypesMap?: Record<string, CreatureTypeMap>
}

interface FilterState {
  faction: string[]
  factionMode: 'include' | 'exclude'
  forgebornName: string[]
  forgebornMode: 'include' | 'exclude'
  cardName: string[]
  cardNameMode: 'include' | 'exclude'
  cardText: string
  cardTextMode: 'include' | 'exclude'
  tags: string[]
  tagsMode: 'include' | 'exclude'
  rarityType: string
  rarityCount: number | null
  rarityMode: 'include' | 'exclude'
  expiryFilter: 'all' | 'active' | 'expiring' | 'expired'
  sortBy: string
  deckNameMode: 'include' | 'exclude'
  creaturesOperator: '>=' | '<=' | '='
  creaturesValue: number | null
  creaturesMode: 'include' | 'exclude'
  freeCreaturesOperator: '>=' | '<=' | '='
  freeCreaturesValue: number | null
  freeCreaturesMode: 'include' | 'exclude'
  creatureType: string
  creatureTypeOperator: '>=' | '<=' | '='
  creatureTypeCount: number | null
  creatureTypeMode: 'include' | 'exclude'
  spellsOperator: '>=' | '<=' | '='
  spellsValue: number | null
  spellsMode: 'include' | 'exclude'
  freeSpellsOperator: '>=' | '<=' | '='
  freeSpellsValue: number | null
  freeSpellsMode: 'include' | 'exclude'
  spellType: string
  spellTypeCount: number | null
  spellTypeMode: 'include' | 'exclude'
  deckName: string
  cardSetNo: string[]
  cardSetNoMode: 'include' | 'exclude'
  eloOperator: '>=' | '<=' | '='
  eloValue: number | null
  eloMode: 'include' | 'exclude'
  scoreOperator: '>=' | '<=' | '='
  scoreValue: number | null
  scoreMode: 'include' | 'exclude'
}

const createDefaultFilters = (): FilterState => ({
  faction: [],
  factionMode: 'include',
  forgebornName: [],
  forgebornMode: 'include',
  cardName: [],
  cardNameMode: 'include',
  cardText: '',
  cardTextMode: 'include',
  tags: [],
  tagsMode: 'include',
  rarityType: '',
  rarityCount: null,
  rarityMode: 'include',
  expiryFilter: 'active', // Default: show active decks (no dates + expiring)
  sortBy: 'date-desc', // Default: newest first
  deckNameMode: 'include',
  creaturesOperator: '>=',
  creaturesValue: null,
  creaturesMode: 'include',
  freeCreaturesOperator: '>=',
  freeCreaturesValue: null,
  freeCreaturesMode: 'include',
  creatureType: '',
  creatureTypeOperator: '>=',
  creatureTypeCount: null,
  creatureTypeMode: 'include',
  spellsOperator: '>=',
  spellsValue: null,
  spellsMode: 'include',
  freeSpellsOperator: '>=',
  freeSpellsValue: null,
  freeSpellsMode: 'include',
  spellType: '',
  spellTypeCount: null,
  spellTypeMode: 'include',
  deckName: '',
  cardSetNo: [],
  cardSetNoMode: 'include',
  eloOperator: '>=',
  eloValue: null,
  eloMode: 'include',
  scoreOperator: '>=',
  scoreValue: null,
  scoreMode: 'include',
})

type FilterBlockKey =
  | 'deck-name'
  | 'faction'
  | 'forgeborn'
  | 'card-name'
  | 'card-text'
  | 'tags'
  | 'creatures'
  | 'free-creatures'
  | 'creature-type'
  | 'spells'
  | 'free-spells'
  | 'spell-type'
  | 'card-set'
  | 'elo'
  | 'score'
  | 'rarity'
  | 'sort'
  | 'deck-status'

const FILTER_BLOCK_LABELS: Record<FilterBlockKey, string> = {
  'deck-name': 'Deck Name',
  faction: 'Faction',
  forgeborn: 'Forgeborn',
  'card-name': 'Card Name',
  'card-text': 'Card Text',
  tags: 'Tags',
  creatures: 'Creatures',
  'free-creatures': 'Free Creatures',
  'creature-type': 'Creature Type',
  spells: 'Spells',
  'free-spells': 'Free Spells',
  'spell-type': 'Spell Type',
  'card-set': 'Card Set',
  elo: 'ELO',
  score: 'Score',
  rarity: 'Rarity',
  sort: 'Sort',
  'deck-status': 'Deck Status',
}

const FILTER_BLOCK_FIELDS: Record<FilterBlockKey, (keyof FilterState)[]> = {
  'deck-name': ['deckName', 'deckNameMode'],
  faction: ['faction', 'factionMode'],
  forgeborn: ['forgebornName', 'forgebornMode'],
  'card-name': ['cardName', 'cardNameMode'],
  'card-text': ['cardText', 'cardTextMode'],
  tags: ['tags', 'tagsMode'],
  creatures: ['creaturesOperator', 'creaturesValue', 'creaturesMode'],
  'free-creatures': ['freeCreaturesOperator', 'freeCreaturesValue', 'freeCreaturesMode'],
  'creature-type': ['creatureType', 'creatureTypeOperator', 'creatureTypeCount', 'creatureTypeMode'],
  spells: ['spellsOperator', 'spellsValue', 'spellsMode'],
  'free-spells': ['freeSpellsOperator', 'freeSpellsValue', 'freeSpellsMode'],
  'spell-type': ['spellType', 'spellTypeCount', 'spellTypeMode'],
  'card-set': ['cardSetNo', 'cardSetNoMode'],
  elo: ['eloOperator', 'eloValue', 'eloMode'],
  score: ['scoreOperator', 'scoreValue', 'scoreMode'],
  rarity: ['rarityType', 'rarityCount', 'rarityMode'],
  sort: ['sortBy'],
  'deck-status': ['expiryFilter'],
}

const FILTER_BLOCK_OPTIONS: { value: FilterBlockKey; label: string }[] = [
  { value: 'deck-name', label: FILTER_BLOCK_LABELS['deck-name'] },
  { value: 'forgeborn', label: FILTER_BLOCK_LABELS.forgeborn },
  { value: 'card-name', label: FILTER_BLOCK_LABELS['card-name'] },
  { value: 'card-text', label: FILTER_BLOCK_LABELS['card-text'] },
  { value: 'tags', label: FILTER_BLOCK_LABELS.tags },
  { value: 'creatures', label: FILTER_BLOCK_LABELS.creatures },
  { value: 'free-creatures', label: FILTER_BLOCK_LABELS['free-creatures'] },
  { value: 'creature-type', label: FILTER_BLOCK_LABELS['creature-type'] },
  { value: 'spells', label: FILTER_BLOCK_LABELS.spells },
  { value: 'free-spells', label: FILTER_BLOCK_LABELS['free-spells'] },
  { value: 'spell-type', label: FILTER_BLOCK_LABELS['spell-type'] },
  { value: 'card-set', label: FILTER_BLOCK_LABELS['card-set'] },
  { value: 'elo', label: FILTER_BLOCK_LABELS.elo },
  { value: 'score', label: FILTER_BLOCK_LABELS.score },
  { value: 'rarity', label: FILTER_BLOCK_LABELS.rarity },
]
const FILTER_BLOCK_VALUES = FILTER_BLOCK_OPTIONS.map((opt) => opt.value)
const SORT_OPTIONS = [
  { value: 'date-desc', label: 'Date (Newest first)' },
  { value: 'date-asc', label: 'Date (Oldest first)' },
  { value: 'name-asc', label: 'Name (A-Z)' },
  { value: 'name-desc', label: 'Name (Z-A)' },
  { value: 'score-desc', label: 'Score (Highest first)' },
  { value: 'score-asc', label: 'Score (Lowest first)' },
  { value: 'elo-desc', label: 'ELO (Highest first)' },
  { value: 'elo-asc', label: 'ELO (Lowest first)' },
]
const FACTION_BUTTONS = [
  { value: 'Alloyin', label: 'ALLOYIN', color: 'cyan' },
  { value: 'Tempys', label: 'TEMPYS', color: 'orange' },
  { value: 'Uterra', label: 'UTERRA', color: 'green' },
  { value: 'Nekrium', label: 'NEKRIUM', color: 'grape' },
]
const FILTER_QUERY_KEYS = [
  'activeFilters',
  'deckName',
  'deckNameMode',
  'faction',
  'factionMode',
  'forgeborn',
  'forgebornMode',
  'cardName',
  'cardNameMode',
  'cardText',
  'cardTextMode',
  'tags',
  'tagsMode',
  'cardSetNo',
  'cardSetNoMode',
  'creaturesOperator',
  'creaturesValue',
  'creaturesMode',
  'freeCreaturesOperator',
  'freeCreaturesValue',
  'freeCreaturesMode',
  'creatureType',
  'creatureTypeOperator',
  'creatureTypeCount',
  'creatureTypeMode',
  'spellsOperator',
  'spellsValue',
  'spellsMode',
  'freeSpellsOperator',
  'freeSpellsValue',
  'freeSpellsMode',
  'spellType',
  'spellTypeCount',
  'spellTypeMode',
  'rarityType',
  'rarityCount',
  'rarityMode',
  'eloOperator',
  'eloValue',
  'eloMode',
  'scoreOperator',
  'scoreValue',
  'scoreMode',
  'sortBy',
  'expiryFilter',
]

type FilterBlockInstance = {
  id: string
  key: FilterBlockKey
}

type CardSetInstanceState = {
  cardSetNo: string[]
  cardSetNoMode: 'include' | 'exclude'
}

type FilterInstanceState = Partial<FilterState>

const ARRAY_FIELDS = new Set<keyof FilterState>([
  'faction',
  'forgebornName',
  'cardName',
  'tags',
  'cardSetNo',
])

const NUMBER_FIELDS = new Set<keyof FilterState>([
  'creaturesValue',
  'freeCreaturesValue',
  'creatureTypeCount',
  'spellsValue',
  'freeSpellsValue',
  'spellTypeCount',
  'rarityCount',
  'eloValue',
  'scoreValue',
])

const getDefaultsForKey = (key: FilterBlockKey): FilterInstanceState => {
  const defaults = createDefaultFilters()
  switch (key) {
    case 'deck-name':
      return { deckName: defaults.deckName, deckNameMode: defaults.deckNameMode }
    case 'faction':
      return { faction: defaults.faction, factionMode: defaults.factionMode }
    case 'forgeborn':
      return { forgebornName: defaults.forgebornName, forgebornMode: defaults.forgebornMode }
    case 'card-name':
      return { cardName: defaults.cardName, cardNameMode: defaults.cardNameMode }
    case 'card-text':
      return { cardText: defaults.cardText, cardTextMode: defaults.cardTextMode }
    case 'tags':
      return { tags: defaults.tags, tagsMode: defaults.tagsMode }
    case 'creatures':
      return {
        creaturesOperator: defaults.creaturesOperator,
        creaturesValue: defaults.creaturesValue,
        creaturesMode: defaults.creaturesMode,
      }
    case 'free-creatures':
      return {
        freeCreaturesOperator: defaults.freeCreaturesOperator,
        freeCreaturesValue: defaults.freeCreaturesValue,
        freeCreaturesMode: defaults.freeCreaturesMode,
      }
    case 'creature-type':
      return {
        creatureType: defaults.creatureType,
        creatureTypeOperator: defaults.creatureTypeOperator,
        creatureTypeCount: defaults.creatureTypeCount,
        creatureTypeMode: defaults.creatureTypeMode,
      }
    case 'spells':
      return {
        spellsOperator: defaults.spellsOperator,
        spellsValue: defaults.spellsValue,
        spellsMode: defaults.spellsMode,
      }
    case 'free-spells':
      return {
        freeSpellsOperator: defaults.freeSpellsOperator,
        freeSpellsValue: defaults.freeSpellsValue,
        freeSpellsMode: defaults.freeSpellsMode,
      }
    case 'spell-type':
      return {
        spellType: defaults.spellType,
        spellTypeCount: defaults.spellTypeCount,
        spellTypeMode: defaults.spellTypeMode,
      }
    case 'card-set':
      return {
        cardSetNo: defaults.cardSetNo,
        cardSetNoMode: defaults.cardSetNoMode,
      }
    case 'elo':
      return {
        eloOperator: defaults.eloOperator,
        eloValue: defaults.eloValue,
        eloMode: defaults.eloMode,
      }
    case 'score':
      return {
        scoreOperator: defaults.scoreOperator,
        scoreValue: defaults.scoreValue,
        scoreMode: defaults.scoreMode,
      }
    case 'rarity':
      return {
        rarityType: defaults.rarityType,
        rarityCount: defaults.rarityCount,
        rarityMode: defaults.rarityMode,
      }
    case 'sort':
      return { sortBy: defaults.sortBy }
    case 'deck-status':
      return { expiryFilter: defaults.expiryFilter }
    default:
      return {}
  }
}

const isFilterBlockKey = (value: string): value is FilterBlockKey =>
  FILTER_BLOCK_VALUES.includes(value as FilterBlockKey)

const parseFiltersFromSearch = (
  params: URLSearchParams
): {
  filters: FilterState
  activeFilterBlocks: FilterBlockInstance[]
  cardSetInstances: Record<string, CardSetInstanceState>
  instanceFilters: Record<string, FilterInstanceState>
} => {
  const next = createDefaultFilters()

  const getArray = (key: string) => {
    const raw = params.get(key)
    if (!raw) return []
    return raw.split(',').map((item) => item.trim()).filter(Boolean)
  }

  const getNumber = (key: string) => {
    const raw = params.get(key)
    if (raw === null || raw === '') return null
    const num = Number(raw)
    return Number.isFinite(num) ? num : null
  }

  // Map primitives/arrays
  next.deckName = params.get('deckName') || ''
  next.deckNameMode = (params.get('deckNameMode') as FilterState['deckNameMode']) || 'include'
  next.faction = getArray('faction')
  next.factionMode = (params.get('factionMode') as FilterState['factionMode']) || 'include'
  next.forgebornName = getArray('forgeborn')
  next.forgebornMode = (params.get('forgebornMode') as FilterState['forgebornMode']) || 'include'
  next.cardName = getArray('cardName')
  next.cardNameMode = (params.get('cardNameMode') as FilterState['cardNameMode']) || 'include'
  next.cardText = params.get('cardText') || ''
  next.cardTextMode = (params.get('cardTextMode') as FilterState['cardTextMode']) || 'include'
  next.tags = getArray('tags')
  next.tagsMode = (params.get('tagsMode') as FilterState['tagsMode']) || 'include'
  next.cardSetNo = getArray('cardSetNo')
  next.cardSetNoMode = (params.get('cardSetNoMode') as FilterState['cardSetNoMode']) || 'include'
  next.sortBy = (params.get('sortBy') as string) || 'date-desc'
  next.expiryFilter = ((params.get('expiryFilter') as FilterState['expiryFilter']) || 'active')

  // Numeric/operator pairs
  const creaturesValue = getNumber('creaturesValue')
  if (creaturesValue !== null) {
    next.creaturesValue = creaturesValue
    next.creaturesOperator = (params.get('creaturesOperator') as FilterState['creaturesOperator']) || next.creaturesOperator
    next.creaturesMode = (params.get('creaturesMode') as FilterState['creaturesMode']) || 'include'
  }

  const freeCreaturesValue = getNumber('freeCreaturesValue')
  if (freeCreaturesValue !== null) {
    next.freeCreaturesValue = freeCreaturesValue
    next.freeCreaturesOperator = (params.get('freeCreaturesOperator') as FilterState['freeCreaturesOperator']) || next.freeCreaturesOperator
    next.freeCreaturesMode = (params.get('freeCreaturesMode') as FilterState['freeCreaturesMode']) || 'include'
  }

  const creatureType = params.get('creatureType') || ''
  if (creatureType) {
    next.creatureType = creatureType
    next.creatureTypeOperator = (params.get('creatureTypeOperator') as FilterState['creatureTypeOperator']) || next.creatureTypeOperator
    const creatureTypeCount = getNumber('creatureTypeCount')
    next.creatureTypeCount = creatureTypeCount
    next.creatureTypeMode = (params.get('creatureTypeMode') as FilterState['creatureTypeMode']) || 'include'
  }

  const spellsValue = getNumber('spellsValue')
  if (spellsValue !== null) {
    next.spellsValue = spellsValue
    next.spellsOperator = (params.get('spellsOperator') as FilterState['spellsOperator']) || next.spellsOperator
    next.spellsMode = (params.get('spellsMode') as FilterState['spellsMode']) || 'include'
  }

  const freeSpellsValue = getNumber('freeSpellsValue')
  if (freeSpellsValue !== null) {
    next.freeSpellsValue = freeSpellsValue
    next.freeSpellsOperator = (params.get('freeSpellsOperator') as FilterState['freeSpellsOperator']) || next.freeSpellsOperator
    next.freeSpellsMode = (params.get('freeSpellsMode') as FilterState['freeSpellsMode']) || 'include'
  }

  const spellType = params.get('spellType') || ''
  if (spellType) {
    next.spellType = spellType
    const spellTypeCount = getNumber('spellTypeCount')
    next.spellTypeCount = spellTypeCount
    next.spellTypeMode = (params.get('spellTypeMode') as FilterState['spellTypeMode']) || 'include'
  }

  next.rarityType = params.get('rarityType') || ''
  next.rarityCount = getNumber('rarityCount')
  next.rarityMode = (params.get('rarityMode') as FilterState['rarityMode']) || 'include'

  const eloValue = getNumber('eloValue')
  if (eloValue !== null) {
    next.eloValue = eloValue
    next.eloOperator = (params.get('eloOperator') as FilterState['eloOperator']) || next.eloOperator
    next.eloMode = (params.get('eloMode') as FilterState['eloMode']) || 'include'
  }

  const scoreValue = getNumber('scoreValue')
  if (scoreValue !== null) {
    next.scoreValue = scoreValue
    next.scoreOperator = (params.get('scoreOperator') as FilterState['scoreOperator']) || next.scoreOperator
    next.scoreMode = (params.get('scoreMode') as FilterState['scoreMode']) || 'include'
  }

  // Active filter blocks (allow duplicates)
  const activeRaw = params.get('activeFilters')
  let entries = activeRaw
    ? activeRaw
        .split(',')
        .map((item) => item.trim())
        .filter(Boolean)
    : []
  if (entries.length === 0) {
    if (params.get('cardSetNo')) {
      entries.push('card-set')
    }
  }

  const activeFilterBlocks: FilterBlockInstance[] = []
  entries.forEach((entry, idx) => {
    const [rawKey, rawId] = entry.split('@')
    const key = rawKey as FilterBlockKey
    if (!isFilterBlockKey(key)) return
    const id = rawId || `${key}-${idx}`
    activeFilterBlocks.push({ key, id })
  })

  const sanitizedBlocks = activeFilterBlocks.filter(
    (block) => block.key !== 'faction' && block.key !== 'sort'
  )

  if (!sanitizedBlocks.some((block) => block.key === 'deck-status')) {
    sanitizedBlocks.unshift({ key: 'deck-status', id: 'deck-status' })
  }
  if (sanitizedBlocks.length === 0) {
    sanitizedBlocks.push({ key: 'deck-status', id: 'deck-status' })
  }

  const firstByKey = new Map<FilterBlockKey, string>()
  sanitizedBlocks.forEach((block) => {
    if (!firstByKey.has(block.key)) {
      firstByKey.set(block.key, block.id)
    }
  })

  const instanceFilters: Record<string, FilterInstanceState> = {}

  const cardSetInstances: Record<string, CardSetInstanceState> = {}
  const cardSetBlocks = sanitizedBlocks.filter((block) => block.key === 'card-set')
  cardSetBlocks.forEach((block, idx) => {
    const valuesById = getArray(`cardSetNo@${block.id}`)
    const values = valuesById.length > 0 ? valuesById : idx === 0 ? getArray('cardSetNo') : []
    const mode =
      (params.get(`cardSetNoMode@${block.id}`) as CardSetInstanceState['cardSetNoMode']) ||
      (idx === 0 ? ((params.get('cardSetNoMode') as CardSetInstanceState['cardSetNoMode']) || 'include') : 'include')
    cardSetInstances[block.id] = {
      cardSetNo: values,
      cardSetNoMode: mode || 'include',
    }
    instanceFilters[block.id] = {
      cardSetNo: values,
      cardSetNoMode: mode || 'include',
    }
  })

  sanitizedBlocks.forEach((block) => {
    if (block.key === 'card-set') return // already handled
    const defaults = getDefaultsForKey(block.key)
    const state: FilterInstanceState = { ...defaults }
    FILTER_BLOCK_FIELDS[block.key]?.forEach((field) => {
      if (field === 'cardSetNo' || field === 'cardSetNoMode') return
      const withId = params.get(`${String(field)}@${block.id}`)
      const base = params.get(String(field))
      const isFirstForKey = firstByKey.get(block.key) === block.id
      if (ARRAY_FIELDS.has(field as keyof FilterState)) {
        const arr = withId ? getArray(`${String(field)}@${block.id}`) : isFirstForKey ? getArray(String(field)) : []
        if (arr.length > 0) {
          (state as any)[field] = arr
        }
      } else if (NUMBER_FIELDS.has(field as keyof FilterState)) {
        const num = (() => {
          const raw = withId ?? (isFirstForKey ? base : null)
          if (raw === null || raw === undefined || raw === '') return null
          const n = Number(raw)
          return Number.isFinite(n) ? n : null
        })()
        if (num !== null) {
          (state as any)[field] = num
        }
      } else {
        const val = withId !== null && withId !== undefined ? withId : isFirstForKey ? base : null
        if (val !== null && val !== undefined && val !== '') {
          (state as any)[field] = val
        }
      }
    })
    instanceFilters[block.id] = state
  })

  return { filters: next, activeFilterBlocks: sanitizedBlocks, cardSetInstances, instanceFilters }
}

const buildSearchParamsFromState = (
  filters: FilterState,
  activeBlocks: FilterBlockInstance[],
  cardSetInstances: Record<string, CardSetInstanceState>,
  instanceFilters: Record<string, FilterInstanceState>,
  baseParams?: URLSearchParams
) => {
  const defaults = createDefaultFilters()
  const params = baseParams ? new URLSearchParams(baseParams) : new URLSearchParams()

  FILTER_QUERY_KEYS.forEach((key) => params.delete(key))
  // Clean any old instance-scoped params
  Array.from(params.keys()).forEach((key) => {
    if (key.includes('@')) {
      params.delete(key)
    }
  })

  const activeKeysWithId = activeBlocks.map((b) => `${b.key}@${b.id}`)
  const activeKeys = activeBlocks.map((b) => b.key)
  if (!activeKeys.includes('deck-status')) activeKeys.unshift('deck-status')
  const hasExtraBlocks = activeKeys.some((key) => key !== 'deck-status')
  if (hasExtraBlocks) {
    params.set('activeFilters', activeKeysWithId.join(','))
  }

  const setArray = (name: string, value: string[]) => {
    if (value && value.length > 0) {
      params.set(name, value.join(','))
    }
  }
  const setString = (name: string, value: string) => {
    if (value) params.set(name, value)
  }
  const setNumber = (name: string, value: number | null) => {
    if (value !== null && value !== undefined && Number.isFinite(value)) params.set(name, String(value))
  }

  const firstByKey = new Map<FilterBlockKey, string>()
  activeBlocks.forEach((block) => {
    if (!firstByKey.has(block.key)) {
      firstByKey.set(block.key, block.id)
    }
  })

  activeBlocks.forEach((block) => {
    const defaultsForKey = getDefaultsForKey(block.key)
    const state = instanceFilters[block.id] || defaultsForKey
    FILTER_BLOCK_FIELDS[block.key]?.forEach((field) => {
      const value = (state as any)[field]
      const defaultValue = (defaultsForKey as any)[field]
      const keyName = `${String(field)}@${block.id}`
      if (ARRAY_FIELDS.has(field as keyof FilterState)) {
        if (Array.isArray(value) && value.length > 0) {
          params.set(keyName, value.join(','))
          if (firstByKey.get(block.key) === block.id) {
            params.set(String(field), value.join(','))
          }
        }
      } else if (NUMBER_FIELDS.has(field as keyof FilterState)) {
        if (value !== null && value !== undefined && Number.isFinite(value)) {
          params.set(keyName, String(value))
          if (firstByKey.get(block.key) === block.id) {
            params.set(String(field), String(value))
          }
        }
      } else {
        if (value !== undefined && value !== null && value !== '' && value !== defaultValue) {
          params.set(keyName, String(value))
          if (firstByKey.get(block.key) === block.id) {
            params.set(String(field), String(value))
          }
        }
      }
    })
  })

  // Include only non-default status to keep URL short
  if (filters.faction && (filters.faction as string[]).length > 0) {
    params.set('faction', (filters.faction as string[]).join(','))
  }
  if ((filters.factionMode || defaults.factionMode) !== defaults.factionMode) {
    params.set('factionMode', filters.factionMode || defaults.factionMode)
  }
  if ((filters.sortBy || defaults.sortBy) !== defaults.sortBy) {
    params.set('sortBy', filters.sortBy || defaults.sortBy)
  }
  if ((filters.expiryFilter || defaults.expiryFilter) !== defaults.expiryFilter) {
    params.set('expiryFilter', filters.expiryFilter || defaults.expiryFilter)
  }

  return params
}

type ViewMode = 'decks' | 'fused'

export function DeckList({ decks, fusedDecks = [], precomputedTags, precomputedCardNames, precomputedDeckNames, precomputedForgebornNames, deckTagsMap = {}, deckCreatureTypesMap = {} }: DeckListProps) {
  const PAGE_SIZE = 100
  const [selectedDeck, setSelectedDeck] = useState<Deck | null>(null)
  const [detailsOpened, setDetailsOpened] = useState(false)
  const [parentFusedDeck, setParentFusedDeck] = useState<Deck | null>(null)
  const [filtersOpened, setFiltersOpened] = useState(false)
  const [viewMode, setViewMode] = useState<ViewMode>('decks')
  const [regularPage, setRegularPage] = useState(1)
  const [fusedPage, setFusedPage] = useState(1)
  const [activeFilterBlocks, setActiveFilterBlocks] = useState<FilterBlockInstance[]>([
    { id: 'deck-status', key: 'deck-status' },
  ])
  const [filterToAdd, setFilterToAdd] = useState<FilterBlockKey | null>(null)
  const [cardSetInstances, setCardSetInstances] = useState<Record<string, CardSetInstanceState>>({})
  const [instanceFilters, setInstanceFilters] = useState<Record<string, FilterInstanceState>>({})
  const [filters, setFilters] = useState<FilterState>(() => createDefaultFilters())
  const router = useRouter()
  const searchParams = useSearchParams()
  const searchParamsString = useMemo(
    () => (typeof window !== 'undefined' ? window.location.search.slice(1) : searchParams.toString()),
    [searchParams]
  )
  const lastSyncedQueryRef = useRef<string>('')
  const isHydratedRef = useRef(false)

  // Debounced filters for text inputs (0.5 second delay)
  // Use Mantine's useDebouncedValue with trailing: true (default behavior)
  const [debouncedFilters] = useDebouncedValue(filters, 500)
  const [debouncedInstanceFilters] = useDebouncedValue(instanceFilters, 500)

  const getInstanceState = useCallback(
    (block: FilterBlockInstance) => {
      const defaults = getDefaultsForKey(block.key)
      const state = instanceFilters[block.id] || {}
      return { ...defaults, ...state }
    },
    [instanceFilters]
  )
  const getDebouncedInstanceState = useCallback(
    (block: FilterBlockInstance) => {
      const defaults = getDefaultsForKey(block.key)
      const state = debouncedInstanceFilters[block.id] || instanceFilters[block.id] || {}
      return { ...defaults, ...state }
    },
    [debouncedInstanceFilters, instanceFilters]
  )
  const updateInstanceState = useCallback((block: FilterBlockInstance, payload: Partial<FilterInstanceState>) => {
    setInstanceFilters((prev) => ({
      ...prev,
      [block.id]: {
        ...(prev[block.id] || getDefaultsForKey(block.key)),
        ...payload,
      },
    }))
  }, [])

  // Hydrate filters from URL on first render
  useEffect(() => {
    if (isHydratedRef.current) return
    const paramsString = searchParamsString
    const parsed = parseFiltersFromSearch(new URLSearchParams(paramsString))
    setFilters(parsed.filters)
    setActiveFilterBlocks(parsed.activeFilterBlocks)
    setCardSetInstances(parsed.cardSetInstances)
    setInstanceFilters(parsed.instanceFilters)
    lastSyncedQueryRef.current = paramsString
    isHydratedRef.current = true
  }, [searchParamsString])

  useEffect(() => {
    if (!isHydratedRef.current) return
    const baseParams =
      typeof window !== 'undefined'
        ? new URLSearchParams(window.location.search)
        : new URLSearchParams(searchParamsString)
    const params = buildSearchParamsFromState(
      debouncedFilters,
      activeFilterBlocks,
      cardSetInstances,
      debouncedInstanceFilters,
      baseParams
    )
    const nextString = params.toString()
    if (nextString === lastSyncedQueryRef.current) return
    lastSyncedQueryRef.current = nextString
    router.replace(`?${nextString}`, { scroll: false })
  }, [debouncedFilters, activeFilterBlocks, cardSetInstances, debouncedInstanceFilters, router, searchParamsString])
  
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
  const creatureTypeIndex = useMemo(() => {
    const counts = new Map<string, number>()
    const allDecks = [...decks, ...fusedDecks]

    allDecks.forEach(deck => {
      const map =
        (deck.computed?.creatureType as Record<string, number> | undefined) ||
        ((deck as any).creatureType as Record<string, number> | undefined) ||
        computeCreatureTypesForDeck(deck)
      if (!map || typeof map !== 'object') return
      Object.entries(map).forEach(([type, value]) => {
        if (!type) return
        const key = type.toLowerCase()
        const valNum = typeof value === 'number' ? value : Number(value)
        if (Number.isNaN(valNum)) return
        counts.set(key, (counts.get(key) || 0) + valNum)
      })
    })

    return counts
  }, [decks, fusedDecks])

  const allCreatureTypes = useMemo(() => {
    return Array.from(creatureTypeIndex.entries())
      .sort((a, b) => a[0].localeCompare(b[0]))
      .map(([type, count]) => ({
        value: type,
        label: `${type.charAt(0).toUpperCase() + type.slice(1)} (${count})`,
        count,
      }))
  }, [creatureTypeIndex])
  
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
      const normalize = (value: string) => {
        const trimmed = value.trim()
        const upper = trimmed.toUpperCase()
        if (/^B\d+/.test(upper)) {
          return { group: 0, num: Number(upper.slice(1)), key: upper }
        }
        if (/^S\d+/.test(upper)) {
          return { group: 1, num: Number(upper.slice(1)), key: upper }
        }
        if (/^\d+$/.test(upper)) {
          return { group: 1, num: Number(upper), key: `S${upper}` }
        }
        return { group: 2, num: Number.NaN, key: upper }
      }

      const normA = normalize(a)
      const normB = normalize(b)
      if (normA.group !== normB.group) return normA.group - normB.group
      if (Number.isFinite(normA.num) && Number.isFinite(normB.num) && normA.num !== normB.num) {
        return normA.num - normB.num
      }
      return normA.key.localeCompare(normB.key)
    })
  }, [decks, fusedDecks])
  
  // Save scroll position when debouncedFilters change (after debounce delay)
  useEffect(() => {
    // Save scroll position and first visible deck ID before filters are applied
    scrollPositionRef.current = window.scrollY || window.pageYOffset || document.documentElement.scrollTop
    
    // No DOM scans; rely only on saved scroll position
    firstVisibleDeckIdRef.current = null
    shouldRestoreScrollRef.current = true
  }, [debouncedFilters, debouncedInstanceFilters])
  
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
  
  const resetFiltersByKeys = useCallback((keys: (keyof FilterState)[]) => {
    const defaults = createDefaultFilters()
    setFilters((prev) => {
      const next: FilterState = { ...prev }
      keys.forEach((key) => {
        ;(next as Record<keyof FilterState, FilterState[keyof FilterState]>)[key] =
          defaults[key]
      })
      return next
    })
  }, [])

  const clearFilters = useCallback(() => {
    setFilters(createDefaultFilters())
    setCardSetInstances({})
    setInstanceFilters({})
  }, [])
  
  const sortedFilterOptions = useMemo(
    () => [...FILTER_BLOCK_OPTIONS].sort((a, b) => a.label.localeCompare(b.label)),
    []
  )

  const addFilterBlock = useCallback((key: FilterBlockKey | null) => {
    if (!key) return
    const id = `${key}-${Date.now()}-${Math.random().toString(36).slice(2, 6)}`
    setActiveFilterBlocks((prev) => [...prev, { id, key }])
    if (key === 'card-set') {
      setCardSetInstances((prev) => ({
        ...prev,
        [id]: { cardSetNo: [], cardSetNoMode: 'include' },
      }))
    }
    setInstanceFilters((prev) => ({
      ...prev,
      [id]: getDefaultsForKey(key),
    }))
    setFilterToAdd(null)
  }, [])

  const removeFilterBlock = useCallback(
    (instanceId: string, key: FilterBlockKey) => {
      if (key === 'deck-status') return
    setActiveFilterBlocks((prev) => {
      const next = prev.filter((item) => item.id !== instanceId)
      const stillHasSameKey = next.some((item) => item.key === key)
      if (!stillHasSameKey) {
        const fieldsToReset = FILTER_BLOCK_FIELDS[key]
          if (fieldsToReset?.length) {
            resetFiltersByKeys(fieldsToReset)
          }
        }
        return next
      })
      if (key === 'card-set') {
        setCardSetInstances((prev) => {
          const next = { ...prev }
          delete next[instanceId]
          return next
        })
      }
      setInstanceFilters((prev) => {
        const next = { ...prev }
        delete next[instanceId]
        return next
      })
    },
    [resetFiltersByKeys]
  )

  const renderFilterCol = useCallback(
    (
      block: FilterBlockInstance,
      children: ReactNode,
      options: {
        removable?: boolean
        span?: { base: number; sm?: number; md?: number }
        actions?: ReactNode
        header?: ReactNode
      } = {}
    ) => (
      <Grid.Col key={block.id} span={options.span || { base: 12, sm: 6, md: 6 }}>
        <div className="h-full">
          <Stack gap={2}>
            {(options.header || options.actions || (options.removable !== false && block.key !== 'deck-status')) && (
              <Group justify="space-between" align="center">
                <div>{options.header}</div>
                {(options.actions || (options.removable !== false && block.key !== 'deck-status')) && (
                  <Group gap={8} align="center">
                    {options.actions}
                    {options.removable !== false && block.key !== 'deck-status' && (
                      <ActionIcon
                        variant="subtle"
                        color="gray"
                        size="sm"
                        onClick={() => removeFilterBlock(block.id, block.key)}
                        aria-label={`Remove ${FILTER_BLOCK_LABELS[block.key]} filter`}
                      >
                        <IconX size={14} />
                      </ActionIcon>
                    )}
                  </Group>
                )}
              </Group>
            )}
            {children}
          </Stack>
        </div>
      </Grid.Col>
    ),
    [removeFilterBlock]
  )

  const hasActiveFilters = useMemo(() => {
    const defaults = createDefaultFilters()
    if ((filters.faction as string[])?.length) return true
    const nonStatusBlocks = activeFilterBlocks.filter((block) => block.key !== 'deck-status' && block.key !== 'sort' && block.key !== 'faction')
    for (const block of nonStatusBlocks) {
      const state = getInstanceState(block)
      switch (block.key) {
        case 'deck-name':
          if ((state.deckName as string) && (state.deckName as string) !== defaults.deckName) return true
          break
        case 'faction':
          if ((state.faction as string[])?.length) return true
          break
        case 'forgeborn':
          if ((state.forgebornName as string[])?.length) return true
          break
        case 'card-name':
          if ((state.cardName as string[])?.length) return true
          break
        case 'card-text':
          if ((state.cardText as string)?.length) return true
          break
        case 'tags':
          if ((state.tags as string[])?.length) return true
          break
        case 'creatures':
          if (state.creaturesValue !== null && state.creaturesValue !== undefined) return true
          break
        case 'free-creatures':
          if (state.freeCreaturesValue !== null && state.freeCreaturesValue !== undefined) return true
          break
        case 'creature-type':
          if ((state.creatureType as string)?.length && state.creatureTypeCount !== null && state.creatureTypeCount !== undefined) return true
          break
        case 'spells':
          if (state.spellsValue !== null && state.spellsValue !== undefined) return true
          break
        case 'free-spells':
          if (state.freeSpellsValue !== null && state.freeSpellsValue !== undefined) return true
          break
        case 'spell-type':
          if ((state.spellType as string)?.length && state.spellTypeCount !== null && state.spellTypeCount !== undefined) return true
          break
        case 'rarity':
          if ((state.rarityType as string)?.length && state.rarityCount !== null && state.rarityCount !== undefined) return true
          break
        case 'card-set': {
          const override = cardSetInstances[block.id]
          if (override && override.cardSetNo.length > 0) return true
          if (!override && (state.cardSetNo as string[])?.length) return true
          break
        }
        case 'elo':
          if (state.eloValue !== null && state.eloValue !== undefined) return true
          break
        case 'score':
          if (state.scoreValue !== null && state.scoreValue !== undefined) return true
          break
        case 'sort':
          if ((state.sortBy as string) && state.sortBy !== defaults.sortBy) return true
          break
        default:
          break
      }
    }
    return false
  }, [activeFilterBlocks, cardSetInstances, filters.faction, getInstanceState])
  
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

    const selectedFactions = (debouncedFilters.faction as string[]) || []
    const factionMode = (debouncedFilters.factionMode as FilterState['factionMode']) || 'include'
    const blocks = activeFilterBlocks.filter((block) => block.key !== 'deck-status' && block.key !== 'sort' && block.key !== 'faction')
    const blockStates = blocks.map((block) => ({
      block,
      state: getDebouncedInstanceState(block),
    }))

    return deckArray.filter((deck) => {
      if (selectedFactions.length > 0) {
        const match =
          !!deck.faction &&
          selectedFactions.some((f) => deck.faction && deck.faction.toLowerCase() === f.toLowerCase())
        if (!applyMode(match, factionMode)) {
          return false
        }
      }

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

      let deckTagsCache: string[] | null = null
      let countsCache: ReturnType<typeof countPlayableCards> | null = null
      let deckSetCache: string | null | undefined

      const getCounts = () => {
        if (countsCache === null) {
          countsCache = countPlayableCards(deck)
        }
        return countsCache
      }

      const getDeckSetString = () => {
        if (deckSetCache !== undefined) return deckSetCache
        const deckSet = getDeckSet(deck)
        deckSetCache = deckSet ? String(deckSet).trim() : null
        return deckSetCache
      }

      const getDeckTags = () => {
        if (deckTagsCache !== null) return deckTagsCache
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

        deckTagsCache = deckTags
        return deckTagsCache
      }

      for (const { block, state } of blockStates) {
        switch (block.key) {
          case 'deck-name': {
            const currentName = (state.deckName as string) || ''
            if (currentName) {
              const match = !!deck.name && deck.name.trim() === currentName.trim()
              if (!applyMode(match, (state.deckNameMode as FilterState['deckNameMode']) || 'include')) {
                return false
              }
            }
            break
          }
          case 'faction': {
            const selected = (state.faction as string[]) || []
            if (selected.length > 0) {
              const match =
                !!deck.faction &&
                selected.some((f) => deck.faction && deck.faction.toLowerCase() === f.toLowerCase())
              if (!applyMode(match, (state.factionMode as FilterState['factionMode']) || 'include')) {
                return false
              }
            }
            break
          }
          case 'forgeborn': {
            const selected = (state.forgebornName as string[]) || []
            if (selected.length > 0) {
              const forgebornName = getForgebornNameFromDeck(deck)
              const match = !!forgebornName && selected.includes(forgebornName)
              if (!applyMode(match, (state.forgebornMode as FilterState['forgebornMode']) || 'include')) {
                return false
              }
            }
            break
          }
          case 'card-name': {
            const selected = (state.cardName as string[]) || []
            if (selected.length > 0) {
              const deckCardNames = normalizedCards
                .map(card => card.name?.toLowerCase())
                .filter((name): name is string => !!name)

              const hasAnySelectedCard = selected.some(selectedName =>
                deckCardNames.includes(selectedName.toLowerCase())
              )

              const mode = (state.cardNameMode as FilterState['cardNameMode']) || 'include'
              const match = mode === 'include' ? hasAnySelectedCard : !hasAnySelectedCard

              if (!match) {
                return false
              }
            }
            break
          }
          case 'card-text': {
            const searchValue = (state.cardText as string) || ''
            if (searchValue) {
              const searchText = searchValue.toLowerCase()
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
              if (!applyMode(hasMatchingText, (state.cardTextMode as FilterState['cardTextMode']) || 'include')) {
                return false
              }
            }
            break
          }
          case 'tags': {
            const selected = (state.tags as string[]) || []
            if (selected.length > 0) {
              const searchTags = selected.map(t => t.trim().toLowerCase()).filter(Boolean)
              const deckTags = getDeckTags()

              const hasAllTags = searchTags.every(searchTag =>
                deckTags.some(deckTag => deckTag === searchTag || deckTag.includes(searchTag))
              )
              const hasAnyTag = searchTags.some(searchTag =>
                deckTags.some(deckTag => deckTag === searchTag || deckTag.includes(searchTag))
              )
              const mode = (state.tagsMode as FilterState['tagsMode']) || 'include'
              const match =
                mode === 'include'
                  ? hasAllTags
                  : !hasAnyTag
              if (!match) {
                return false
              }
            }
            break
          }
          case 'creatures': {
            const value = state.creaturesValue as number | null | undefined
            if (value !== null && value !== undefined) {
              const counts = getCounts()
              const creaturesCount = counts.creatures

              let matches = false
              switch (state.creaturesOperator as FilterState['creaturesOperator']) {
                case '>=':
                  matches = creaturesCount >= value
                  break
                case '<=':
                  matches = creaturesCount <= value
                  break
                case '=':
                  matches = creaturesCount === value
                  break
              }
              if (!applyMode(matches, (state.creaturesMode as FilterState['creaturesMode']) || 'include')) {
                return false
              }
            }
            break
          }
          case 'free-creatures': {
            const value = state.freeCreaturesValue as number | null | undefined
            if (value !== null && value !== undefined) {
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
              switch (state.freeCreaturesOperator as FilterState['freeCreaturesOperator']) {
                case '>=':
                  matches = freeCreaturesCount >= value
                  break
                case '<=':
                  matches = freeCreaturesCount <= value
                  break
                case '=':
                  matches = freeCreaturesCount === value
                  break
              }
              if (!applyMode(matches, (state.freeCreaturesMode as FilterState['freeCreaturesMode']) || 'include')) {
                return false
              }
            }
            break
          }
          case 'creature-type': {
            const selectedTypeRaw = (state.creatureType as string) || ''
            const required = state.creatureTypeCount as number | null | undefined
            if (selectedTypeRaw && required !== null && required !== undefined) {
              const selectedType = selectedTypeRaw.toLowerCase()
              const creatureTypesMap =
                (deck.computed?.creatureType as Record<string, number> | undefined) ||
                ((deck as any).creatureType as Record<string, number> | undefined) ||
                computeCreatureTypesForDeck(deck)

              const typeCount = creatureTypesMap?.[selectedType] ?? 0
              const operator = (state.creatureTypeOperator as FilterState['creatureTypeOperator']) || '>='

              let matches = false
              switch (operator) {
                case '<=':
                  matches = typeCount <= required
                  break
                case '=':
                  matches = typeCount === required
                  break
                case '>=':
                default:
                  matches = typeCount >= required
                  break
              }

              if (!applyMode(matches, (state.creatureTypeMode as FilterState['creatureTypeMode']) || 'include')) {
                return false
              }
            }
            break
          }
          case 'spells': {
            const value = state.spellsValue as number | null | undefined
            if (value !== null && value !== undefined) {
              const counts = getCounts()
              const spellsCount = counts.spells

              let matches = false
              switch (state.spellsOperator as FilterState['spellsOperator']) {
                case '>=':
                  matches = spellsCount >= value
                  break
                case '<=':
                  matches = spellsCount <= value
                  break
                case '=':
                  matches = spellsCount === value
                  break
              }
              if (!applyMode(matches, (state.spellsMode as FilterState['spellsMode']) || 'include')) {
                return false
              }
            }
            break
          }
          case 'free-spells': {
            const value = state.freeSpellsValue as number | null | undefined
            if (value !== null && value !== undefined) {
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
              switch (state.freeSpellsOperator as FilterState['freeSpellsOperator']) {
                case '>=':
                  matches = freeSpellsCount >= value
                  break
                case '<=':
                  matches = freeSpellsCount <= value
                  break
                case '=':
                  matches = freeSpellsCount === value
                  break
              }
              if (!applyMode(matches, (state.freeSpellsMode as FilterState['freeSpellsMode']) || 'include')) {
                return false
              }
            }
            break
          }
          case 'spell-type': {
            const selectedType = (state.spellType as string) || ''
            const requiredCount = state.spellTypeCount as number | null | undefined
            if (selectedType && requiredCount !== null && requiredCount !== undefined) {
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

              // Normalize selected type for consistent comparison
              const normalizedSelectedType = selectedType && selectedType.trim()
                ? selectedType.trim().charAt(0).toUpperCase() + selectedType.trim().slice(1).toLowerCase()
                : ''

              if (!normalizedSelectedType) {
                break
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
                  const originalSubType = originalCard && typeof originalCard === 'object'
                    ? (originalCard.cardSubType || originalCard.CardSubType || originalCard.CARDSUBTYPE ||
                       originalCard.SubType || originalCard.subType || originalCard.SUBTYPE || '')
                    : ''
                  const normalizedSubType = cardData.cardSubType || cardData.CardSubType || cardData.CARDSUBTYPE ||
                                            cardData.SubType || cardData.subType || cardData.SUBTYPE || ''
                  const subType = (originalSubType || normalizedSubType || '').toString()

                  if (subType && subType.trim()) {
                    const types = subType.trim().split(/\s+/).filter((t: string) => t.length > 0)
                    const normalizedTypes = types.map((type: string) => 
                      type.charAt(0).toUpperCase() + type.slice(1).toLowerCase()
                    )
                    if (normalizedTypes.includes(normalizedSelectedType)) {
                      spellTypeCount++
                    }
                  }
                }
              })

              const matchesType = !(requiredCount > 0 && spellTypeCount < requiredCount)
              if (!applyMode(matchesType, (state.spellTypeMode as FilterState['spellTypeMode']) || 'include')) {
                return false
              }
            }
            break
          }
        case 'rarity': {
          const rarityType = (state.rarityType as string) || ''
          const rarityCount = state.rarityCount as number | null | undefined
          if (rarityType && rarityCount !== null && rarityCount !== undefined) {
            // Prefer precomputed rarity counts (base deck only)
            let deckRarityCount = (deck.computed?.rarityCounts || {})[rarityType] ?? 0

            // Fallback lightweight count on base cards if computed missing
            if (!deck.computed?.rarityCounts) {
              const baseCards = Array.isArray(deck.cardList)
                ? deck.cardList
                : Array.isArray(deck.cards)
                  ? deck.cards
                  : Array.isArray((deck as any).cardIds) && (deck as any).cards && typeof (deck as any).cards === 'object'
                    ? (deck as any).cardIds.map((id: string, idx: number) => {
                        const data = Object.values((deck as any).cards as any)[idx] as any
                        return {
                          ...((typeof data === 'object' && data) || {}),
                          id,
                          cardId: id,
                          name: (data as any)?.name || (data as any)?.title || id,
                        }
                      })
                    : []

              const normalizedBaseCards: CardInfo[] = baseCards.map((card: any, idx: number) => {
                if (typeof card === 'string') return getCardInfo(card)
                if (card && typeof card === 'object') {
                  const cardId = card.id || card.cardId || card.name || `card-${idx}`
                  return getCardInfo(cardId, card)
                }
                return getCardInfo(`card-${idx}`)
              })

              const forgebornIds = new Set<string>()
              if (deck.forgebornId) forgebornIds.add(deck.forgebornId)
              normalizedBaseCards.forEach((c: CardInfo) => {
                const typeLower = (c.cardType || c.type || '').toLowerCase()
                if (typeLower.includes('forgeborn') && c.id) forgebornIds.add(c.id)
              })

              const counts = new Map<string, number>()
              normalizedBaseCards.forEach(card => {
                if (forgebornIds.has(card.id)) return
                const rarity = (card as any).rarity
                if (rarity && typeof rarity === 'string') {
                  let normalizedRarity = rarity.trim()
                  const lower = normalizedRarity.toLowerCase()
                  if (lower.includes('solbind')) normalizedRarity = 'Solbind'
                  if (lower.includes('darkforge') && lower.includes('rare')) {
                    normalizedRarity = 'Darkforge Rare'
                  } else if (lower.includes('common common')) {
                    normalizedRarity = 'Common Common'
                  } else if (lower.includes('rare rare')) {
                    normalizedRarity = 'Rare Rare'
                  } else if (lower.includes('rare') && lower.includes('common')) {
                    normalizedRarity = 'Rare Common'
                  } else if (lower.includes('common') && lower.includes('rare')) {
                    normalizedRarity = 'Common Rare'
                  } else if (lower.includes('darkforge')) {
                    normalizedRarity = 'Darkforge'
                  } else if (lower.includes('common')) {
                    normalizedRarity = 'Common'
                  } else if (lower.includes('rare')) {
                    normalizedRarity = 'Rare'
                  } else if (lower.includes('ls') || lower.includes('legendary')) {
                    normalizedRarity = 'LS'
                  }
                  counts.set(normalizedRarity, (counts.get(normalizedRarity) || 0) + 1)
                }
              })
              deckRarityCount = counts.get(rarityType) || 0
            }

            const rarityMatch = !(deckRarityCount < rarityCount)
            if (!applyMode(rarityMatch, (state.rarityMode as FilterState['rarityMode']) || 'include')) {
              return false
            }
          }
          break
        }
          case 'card-set': {
            const cardSetState =
              cardSetInstances[block.id] || {
                cardSetNo: (state.cardSetNo as string[]) || [],
                cardSetNoMode: ((state.cardSetNoMode as 'include' | 'exclude') || 'include'),
              }
            if (cardSetState.cardSetNo.length > 0) {
              const deckSetStr = getDeckSetString()
              const match = !!deckSetStr && cardSetState.cardSetNo.includes(deckSetStr)
              if (!applyMode(match, cardSetState.cardSetNoMode || 'include')) {
                return false
              }
            }
            break
          }
          case 'elo': {
            const value = state.eloValue as number | null | undefined
            if (value !== null && value !== undefined) {
              const deckElo = (deck as any).elo !== undefined && (deck as any).elo !== null 
                ? Number((deck as any).elo) 
                : null

              if (deckElo === null) {
                return false // Deck has no ELO, exclude it
              }

              let matches = false
              switch (state.eloOperator as FilterState['eloOperator']) {
                case '>=':
                  matches = deckElo >= value
                  break
                case '<=':
                  matches = deckElo <= value
                  break
                case '=':
                  matches = deckElo === value
                  break
              }
              if (!applyMode(matches, (state.eloMode as FilterState['eloMode']) || 'include')) {
                return false
              }
            }
            break
          }
          case 'score': {
            const value = state.scoreValue as number | null | undefined
            if (value !== null && value !== undefined) {
              const deckScore = (deck as any).deckScore !== undefined && (deck as any).deckScore !== null 
                ? Number((deck as any).deckScore) 
                : null

              if (deckScore === null) {
                return false // Deck has no score, exclude it
              }

              // Convert deckScore to 0-100 scale (like in display)
              const deckScoreScaled = Math.round(deckScore * 100)

              let matches = false
              switch (state.scoreOperator as FilterState['scoreOperator']) {
                case '>=':
                  matches = deckScoreScaled >= value
                  break
                case '<=':
                  matches = deckScoreScaled <= value
                  break
                case '=':
                  matches = deckScoreScaled === value
                  break
              }
              if (!applyMode(matches, (state.scoreMode as FilterState['scoreMode']) || 'include')) {
                return false
              }
            }
            break
          }
          case 'sort':
          default:
            break
        }
      }

      return true
    })
  }, [activeFilterBlocks, cardSetInstances, deckTagsMap, getDebouncedInstanceState, hasActiveFilters, debouncedFilters.faction, debouncedFilters.factionMode])
  
  const sortByValue = useMemo(() => {
    return filters.sortBy || createDefaultFilters().sortBy
  }, [filters.sortBy])

  // Helper function to sort decks
  const sortDecks = useCallback((deckArray: Deck[]): Deck[] => {
    const sorted = [...deckArray]
    
    switch (sortByValue) {
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
  }, [sortByValue])
  
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
  const isSmUp = useMediaQuery('(min-width: 48em)')
  const isMdUp = useMediaQuery('(min-width: 62em)')
  const columnCount = useMemo(() => {
    if (isMdUp) return 3
    if (isSmUp) return 2
    return 1
  }, [isMdUp, isSmUp])
  const fusedColumnCount = useMemo(() => {
    if (isMdUp) return 3
    if (isSmUp) return 2
    return 1
  }, [isMdUp, isSmUp])
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
              <Group justify="space-between" align="center" wrap="wrap" gap="sm">
                <Title order={4} className="text-white">
                  Filter Decks
                </Title>
                <Group gap="xs" wrap="wrap" justify="flex-end">
                  {FACTION_BUTTONS.map((faction) => {
                    const isActive = (filters.faction as string[])?.includes(faction.value)
                    const activeBg = `var(--mantine-color-${faction.color}-light)`
                    const activeBorder = `var(--mantine-color-${faction.color}-filled)`
                    return (
                      <Button
                        key={faction.value}
                        size="xs"
                        variant="outline"
                        color={faction.color}
                        leftSection={
                          <Image
                            src={`/images/icons/${faction.value.toLowerCase()}.png`}
                            alt={faction.value}
                            h={16}
                            w={16}
                            fit="contain"
                            style={{
                              filter: isActive ? 'drop-shadow(0 0 2px rgba(0, 0, 0, 0.65))' : 'none',
                            }}
                          />
                        }
                        onClick={() => {
                          setFilters((prev) => {
                            const current = (prev.faction as string[]) || []
                            const next = current.includes(faction.value)
                              ? current.filter((item) => item !== faction.value)
                              : [...current, faction.value]
                            return { ...prev, faction: next, factionMode: 'include' }
                          })
                        }}
                        styles={{
                          root: {
                            backgroundColor: isActive ? activeBg : 'transparent',
                            borderColor: activeBorder,
                            boxShadow: isActive ? `0 0 0 1px ${activeBorder}` : undefined,
                            transition: 'background-color 150ms ease, box-shadow 150ms ease, border-color 150ms ease',
                          },
                          label: { textTransform: 'uppercase', letterSpacing: '0.02em' },
                        }}
                      >
                        {faction.label}
                      </Button>
                    )
                  })}
                </Group>
              </Group>

              <Group gap="md" align="flex-start" justify="space-between" wrap="nowrap">
                <Stack gap={4} style={{ flex: '0 1 420px', maxWidth: 420 }}>
                  <Text size="sm" fw={500} style={{ color: 'white' }}>
                    Add filter
                  </Text>
                  <Select
                    placeholder="Choose filter..."
                    data={sortedFilterOptions}
                    value={filterToAdd}
                    onChange={(value) => addFilterBlock((value as FilterBlockKey) || null)}
                    clearable
                    allowDeselect
                    styles={{
                      input: {
                        backgroundColor: 'rgba(30, 41, 59, 0.8)',
                        color: 'white',
                        borderColor: 'rgba(74, 144, 226, 0.3)',
                      },
                      dropdown: { backgroundColor: 'rgba(30, 41, 59, 0.95)' },
                      option: { color: 'white' },
                    }}
                  />
                </Stack>

                <Stack gap={4} style={{ flex: '0 1 280px', maxWidth: 280 }}>
                  <Text size="sm" fw={500} style={{ color: 'white' }}>
                    Sort
                  </Text>
                  <Select
                    value={filters.sortBy || 'date-desc'}
                    onChange={(value) => setFilters({ ...filters, sortBy: value || 'date-desc' })}
                    data={SORT_OPTIONS}
                    styles={{
                      input: {
                        backgroundColor: 'rgba(30, 41, 59, 0.8)',
                        color: 'white',
                        borderColor: 'rgba(74, 144, 226, 0.3)',
                      },
                      dropdown: { backgroundColor: 'rgba(30, 41, 59, 0.95)' },
                      option: { color: 'white' },
                    }}
                  />
                </Stack>

                <Stack gap={6} align="flex-end" style={{ flex: '1 1 320px', minWidth: 320 }}>
                  <Text size="sm" fw={500} style={{ color: 'white', textAlign: 'right' }}>
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
              </Group>

              <Grid gutter="md" columns={12}>

                {activeFilterBlocks
                  .filter((block) => block.key !== 'deck-status' && block.key !== 'sort' && block.key !== 'faction')
                  .map((block) => {
                    const state = getInstanceState(block) as FilterInstanceState
                    const update = (payload: Partial<FilterInstanceState>) => updateInstanceState(block, payload)
                    switch (block.key) {
                    case 'deck-name': {
                      const currentName = (state.deckName as string) || ''
                      const currentMode = (state.deckNameMode as FilterState['deckNameMode']) || 'include'
                      const header = (
                        <Text size="sm" fw={500} style={{ color: 'white' }}>
                          Deck Name
                        </Text>
                      )
                      const modeControl = (
                        <SegmentedControl
                          size="xs"
                          value={currentMode}
                          onChange={(value) => update({ deckNameMode: value as 'include' | 'exclude' })}
                          data={MODE_OPTIONS}
                        />
                      )
                      return renderFilterCol(
                        block,
                        <Stack gap={6}>
                          <Select
                            placeholder={allDeckNames.length > 0 ? "Select deck name..." : "No decks available"}
                            data={allDeckNames.map(name => ({ value: name, label: name }))}
                            value={currentName || null}
                            onChange={(value) => update({ deckName: value || '' })}
                            clearable
                            searchable
                            styles={{
                              input: { backgroundColor: 'rgba(30, 41, 59, 0.8)', color: 'white', borderColor: 'rgba(74, 144, 226, 0.3)' },
                              dropdown: { backgroundColor: 'rgba(30, 41, 59, 0.95)' },
                              option: { color: 'white' }
                            }}
                            disabled={allDeckNames.length === 0}
                          />
                        </Stack>,
                        { header, actions: modeControl }
                      )
                    }
                    case 'faction': {
                      const currentValues = (state.faction as string[]) || []
                      const currentMode = (state.factionMode as FilterState['factionMode']) || 'include'
                      const header = (
                        <Text size="sm" fw={500} style={{ color: 'white' }}>
                          Faction
                        </Text>
                      )
                      const modeControl = (
                        <SegmentedControl
                          size="xs"
                          value={currentMode}
                          onChange={(value) => update({ factionMode: value as 'include' | 'exclude' })}
                          data={MODE_OPTIONS}
                        />
                      )
                      return renderFilterCol(
                        block,
                        <Stack gap={6}>
                          <MultiSelect
                            placeholder="Select factions..."
                            value={currentValues}
                            onChange={(value) => update({ faction: value })}
                            data={[
                              { value: 'Alloyin', label: 'Alloyin' },
                              { value: 'Uterra', label: 'Uterra' },
                              { value: 'Tempys', label: 'Tempys' },
                              { value: 'Nekrium', label: 'Nekrium' },
                            ]}
                            clearable
                            styles={{
                              input: { backgroundColor: 'rgba(30, 41, 59, 0.8)', color: 'white', borderColor: 'rgba(74, 144, 226, 0.3)' }
                            }}
                          />
                        </Stack>,
                        { header, actions: modeControl }
                      )
                    }
                    case 'forgeborn': {
                      const currentValues = (state.forgebornName as string[]) || []
                      const currentMode = (state.forgebornMode as FilterState['forgebornMode']) || 'include'
                      const header = (
                        <Text size="sm" fw={500} style={{ color: 'white' }}>
                          Forgeborn Name
                        </Text>
                      )
                      const modeControl = (
                        <SegmentedControl
                          size="xs"
                          value={currentMode}
                          onChange={(value) => update({ forgebornMode: value as 'include' | 'exclude' })}
                          data={MODE_OPTIONS}
                        />
                      )
                      return renderFilterCol(
                        block,
                        <Stack gap={6}>
                          <MultiSelect
                            placeholder="Select Forgeborn..."
                            data={allForgebornNames}
                            value={currentValues}
                            onChange={(value) => update({ forgebornName: value })}
                            clearable
                            searchable
                            className="text-white"
                            styles={{
                              input: { backgroundColor: 'rgba(30, 41, 59, 0.8)', color: 'white', borderColor: 'rgba(74, 144, 226, 0.3)' },
                              dropdown: { backgroundColor: 'rgba(30, 41, 59, 0.95)' },
                              option: { color: 'white' }
                            }}
                          />
                        </Stack>,
                        { header, actions: modeControl }
                      )
                    }
                    case 'card-name': {
                      const currentValues = (state.cardName as string[]) || []
                      const currentMode = (state.cardNameMode as FilterState['cardNameMode']) || 'include'
                      const header = (
                        <Text size="sm" fw={500} style={{ color: 'white' }}>
                          Card Name
                        </Text>
                      )
                      const modeControl = (
                        <SegmentedControl
                          size="xs"
                          value={currentMode}
                          onChange={(value) => update({ cardNameMode: value as 'include' | 'exclude' })}
                          data={MODE_OPTIONS}
                        />
                      )
                      return renderFilterCol(
                        block,
                        <Stack gap={6}>
                          <MultiSelect
                            placeholder="Select cards..."
                            value={currentValues}
                            onChange={(value) => {
                              scrollPositionRef.current = window.scrollY || window.pageYOffset || document.documentElement.scrollTop
                              shouldRestoreScrollRef.current = true
                              update({ cardName: value })
                            }}
                            data={allCardNames.map(name => ({ value: name, label: name }))}
                            searchable
                            clearable
                            maxDropdownHeight={300}
                            styles={{
                              input: { backgroundColor: 'rgba(30, 41, 59, 0.8)', color: 'white', borderColor: 'rgba(74, 144, 226, 0.3)' }
                            }}
                          />
                        </Stack>,
                        { header, actions: modeControl }
                      )
                    }
                    case 'card-text': {
                      const currentValue = (state.cardText as string) || ''
                      const currentMode = (state.cardTextMode as FilterState['cardTextMode']) || 'include'
                      const header = (
                        <Text size="sm" fw={500} style={{ color: 'white' }}>
                          Card Text
                        </Text>
                      )
                      const modeControl = (
                        <SegmentedControl
                          size="xs"
                          value={currentMode}
                          onChange={(value) => update({ cardTextMode: value as 'include' | 'exclude' })}
                          data={MODE_OPTIONS}
                        />
                      )
                      return renderFilterCol(
                        block,
                        <Stack gap={6}>
                          <TextInput
                            placeholder="Search in card text/abilities..."
                            value={currentValue}
                            onChange={(e) => update({ cardText: e.target.value })}
                            className="text-white"
                            styles={{
                              input: { backgroundColor: 'rgba(30, 41, 59, 0.8)', color: 'white', borderColor: 'rgba(74, 144, 226, 0.3)' }
                            }}
                          />
                        </Stack>,
                        { header, actions: modeControl }
                      )
                    }
                    case 'tags': {
                      const currentValues = (state.tags as string[]) || []
                      const currentMode = (state.tagsMode as FilterState['tagsMode']) || 'include'
                      const header = (
                        <Text size="sm" fw={500} style={{ color: 'white' }}>
                          Tags
                        </Text>
                      )
                      const modeControl = (
                        <SegmentedControl
                          size="xs"
                          value={currentMode}
                          onChange={(value) => update({ tagsMode: value as 'include' | 'exclude' })}
                          data={MODE_OPTIONS}
                        />
                      )
                      return renderFilterCol(
                        block,
                        <Stack gap={6}>
                          <MultiSelect
                            placeholder="Select tags..."
                            data={allTags.map(tag => ({ value: tag, label: tag }))}
                            value={currentValues}
                            onChange={(value) => update({ tags: value })}
                            clearable
                            searchable
                            styles={{
                              input: { backgroundColor: 'rgba(30, 41, 59, 0.8)', color: 'white', borderColor: 'rgba(74, 144, 226, 0.3)' },
                              dropdown: { backgroundColor: 'rgba(30, 41, 59, 0.95)' },
                              option: { color: 'white' }
                            }}
                          />
                        </Stack>,
                        { header, actions: modeControl }
                      )
                    }
                    case 'creatures':
                      {
                        const currentMode = (state.creaturesMode as FilterState['creaturesMode']) || 'include'
                        const currentOperator = (state.creaturesOperator as FilterState['creaturesOperator']) || '>='
                        const currentValue = state.creaturesValue as number | null | undefined
                        const header = (
                          <Text size="sm" fw={500} style={{ color: 'white' }}>
                            Creatures
                          </Text>
                        )
                        const modeControl = (
                          <SegmentedControl
                            size="xs"
                            value={currentMode}
                            onChange={(value) => update({ creaturesMode: value as 'include' | 'exclude' })}
                            data={MODE_OPTIONS}
                          />
                        )
                      return renderFilterCol(
                        block,
                        <Stack gap={6}>
                          <Group gap="xs" align="flex-end">
                            <Select
                              value={currentOperator}
                              onChange={(value) => update({ creaturesOperator: value as any })}
                              data={[
                                { value: '>=', label: '≥' },
                                { value: '<=', label: '≤' },
                                { value: '=', label: '=' },
                              ]}
                              style={{ flex: '0 0 80px' }}
                              styles={{
                                input: { backgroundColor: 'rgba(30, 41, 59, 0.8)', color: 'white', borderColor: 'rgba(74, 144, 226, 0.3)' }
                              }}
                            />
                            <div style={{ position: 'relative', flex: 1 }}>
                              <NumberInput
                                placeholder="Count"
                                value={currentValue ?? ''}
                                onChange={(value) =>
                                  update({
                                    creaturesValue: typeof value === 'number' ? value : null,
                                  })
                                }
                                min={0}
                                style={{ width: '100%' }}
                                styles={{
                                  input: {
                                    backgroundColor: 'rgba(30, 41, 59, 0.8)',
                                    color: 'white',
                                    borderColor: 'rgba(74, 144, 226, 0.3)',
                                    paddingRight: '46px',
                                  },
                                }}
                              />
                              {currentValue !== null && currentValue !== undefined ? (
                                <button
                                  type="button"
                                  onClick={(e) => {
                                    e.preventDefault()
                                    e.stopPropagation()
                                    update({ creaturesValue: null })
                                  }}
                                  onMouseDown={(e) => {
                                    e.preventDefault()
                                    e.stopPropagation()
                                  }}
                                  style={{
                                    position: 'absolute',
                                    right: 28,
                                    top: '50%',
                                    transform: 'translateY(-50%)',
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
                            </div>
                          </Group>
                        </Stack>,
                        { header, actions: modeControl }
                      )
                      }
                    case 'free-creatures':
                      {
                        const currentMode = (state.freeCreaturesMode as FilterState['freeCreaturesMode']) || 'include'
                        const currentOperator = (state.freeCreaturesOperator as FilterState['freeCreaturesOperator']) || '>='
                        const currentValue = state.freeCreaturesValue as number | null | undefined
                        const header = (
                          <Text size="sm" className="text-white" style={{ fontWeight: 500 }}>
                            Free Creatures
                          </Text>
                        )
                        const modeControl = (
                          <SegmentedControl
                            size="xs"
                            value={currentMode}
                            onChange={(value) => update({ freeCreaturesMode: value as 'include' | 'exclude' })}
                            data={MODE_OPTIONS}
                          />
                        )
                      return renderFilterCol(
                        block,
                        <Stack gap={4}>
                          <Group gap="xs" align="flex-end" wrap="nowrap">
                            <Select
                              value={currentOperator}
                              onChange={(value) => update({ freeCreaturesOperator: value as any })}
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
                            <div style={{ position: 'relative', flex: 1, minWidth: 0 }}>
                              <NumberInput
                                placeholder="Count"
                                value={currentValue ?? undefined}
                                onChange={(value) => update({ freeCreaturesValue: typeof value === 'number' ? value : null })}
                                min={0}
                                style={{ width: '100%' }}
                                styles={{
                                  input: {
                                    backgroundColor: 'rgba(30, 41, 59, 0.8)',
                                    color: 'white',
                                    borderColor: 'rgba(74, 144, 226, 0.3)',
                                    fontSize: '14px',
                                    paddingRight: '46px',
                                  },
                                }}
                              />
                              {currentValue !== null && currentValue !== undefined ? (
                                <button
                                  type="button"
                                  onClick={(e) => {
                                    e.preventDefault()
                                    e.stopPropagation()
                                    update({ freeCreaturesValue: null })
                                  }}
                                  onMouseDown={(e) => {
                                    e.preventDefault()
                                    e.stopPropagation()
                                  }}
                                  style={{
                                    position: 'absolute',
                                    right: 28,
                                    top: '50%',
                                    transform: 'translateY(-50%)',
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
                            </div>
                          </Group>
                        </Stack>,
                        { header, actions: modeControl }
                      )
                      }
                    case 'creature-type':
                      {
                        const currentMode = (state.creatureTypeMode as FilterState['creatureTypeMode']) || 'include'
                        const currentType = (state.creatureType as string) || ''
                        const currentOperator = (state.creatureTypeOperator as FilterState['creatureTypeOperator']) || '>='
                        const currentCount = state.creatureTypeCount as number | null | undefined
                        const header = (
                          <Text size="sm" fw={500} style={{ color: 'white' }}>
                            Creature Type
                          </Text>
                        )
                        const modeControl = (
                          <SegmentedControl
                            size="xs"
                            value={currentMode}
                            onChange={(value) => update({ creatureTypeMode: value as 'include' | 'exclude' })}
                            data={MODE_OPTIONS}
                          />
                        )
                      return renderFilterCol(
                        block,
                        <Stack gap={6}>
                          <Group gap="xs" align="flex-end">
                            <Select
                              placeholder={allCreatureTypes.length > 0 ? "Select creature type..." : "No types available"}
                              data={allCreatureTypes.map(type => ({ value: type.value, label: type.label }))}
                              value={currentType || null}
                              onChange={(value) =>
                                update({
                                  creatureType: value || '',
                                  creatureTypeCount: value ? (currentCount ?? 1) : null,
                                  creatureTypeOperator: value ? currentOperator : '>=',
                                })
                              }
                              clearable
                              searchable
                              disabled={allCreatureTypes.length === 0}
                              style={{ flex: 1 }}
                              styles={{
                                input: { backgroundColor: 'rgba(30, 41, 59, 0.8)', color: 'white', borderColor: 'rgba(74, 144, 226, 0.3)' },
                                dropdown: { backgroundColor: 'rgba(30, 41, 59, 0.95)' },
                                option: { color: 'white' }
                              }}
                            />
                            <Select
                              data={[
                                { value: '>=', label: '>=' },
                                { value: '=', label: '=' },
                                { value: '<=', label: '<=' },
                              ]}
                              value={currentOperator}
                              onChange={(value) =>
                                update({
                                  creatureTypeOperator: (value as '>=' | '<=' | '=') || '>=',
                                })
                              }
                              disabled={!currentType}
                              aria-label="Operator"
                              w={90}
                              styles={{
                                input: { backgroundColor: 'rgba(30, 41, 59, 0.8)', color: 'white', borderColor: 'rgba(74, 144, 226, 0.3)' },
                                dropdown: { backgroundColor: 'rgba(30, 41, 59, 0.95)' },
                                option: { color: 'white' },
                              }}
                            />
                            <div style={{ position: 'relative', flex: '0 0 120px' }}>
                              <NumberInput
                                placeholder="Count"
                                value={currentCount ?? ''}
                                onChange={(value) =>
                                  update({
                                    creatureTypeCount: typeof value === 'number' ? value : null,
                                  })
                                }
                                min={0}
                                disabled={!currentType}
                                style={{ width: '100%' }}
                                styles={{
                                  input: {
                                    backgroundColor: 'rgba(30, 41, 59, 0.8)',
                                    color: 'white',
                                    borderColor: 'rgba(74, 144, 226, 0.3)',
                                    paddingRight: '46px',
                                  },
                                }}
                              />
                              {currentCount !== null && currentCount !== undefined ? (
                                <button
                                  type="button"
                                  onClick={(e) => {
                                    e.preventDefault()
                                    e.stopPropagation()
                                    update({ creatureTypeCount: null })
                                  }}
                                  onMouseDown={(e) => {
                                    e.preventDefault()
                                    e.stopPropagation()
                                  }}
                                  style={{
                                    position: 'absolute',
                                    right: 28,
                                    top: '50%',
                                    transform: 'translateY(-50%)',
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
                            </div>
                          </Group>
                        </Stack>,
                        { header, actions: modeControl }
                      )
                      }
                    case 'spells':
                      {
                        const currentMode = (state.spellsMode as FilterState['spellsMode']) || 'include'
                        const currentOperator = (state.spellsOperator as FilterState['spellsOperator']) || '>='
                        const currentValue = state.spellsValue as number | null | undefined
                        const header = (
                          <Text size="sm" fw={500} style={{ color: 'white' }}>
                            Spells
                          </Text>
                        )
                        const modeControl = (
                          <SegmentedControl
                            size="xs"
                            value={currentMode}
                            onChange={(value) => update({ spellsMode: value as 'include' | 'exclude' })}
                            data={MODE_OPTIONS}
                          />
                        )
                      return renderFilterCol(
                        block,
                        <Stack gap={6}>
                          <Group gap="xs" align="flex-end">
                            <Select
                              value={currentOperator}
                              onChange={(value) => update({ spellsOperator: value as any })}
                              data={[
                                { value: '>=', label: '≥' },
                                { value: '<=', label: '≤' },
                                { value: '=', label: '=' },
                              ]}
                              style={{ flex: '0 0 80px' }}
                              styles={{
                                input: { backgroundColor: 'rgba(30, 41, 59, 0.8)', color: 'white', borderColor: 'rgba(74, 144, 226, 0.3)' }
                              }}
                            />
                            <div style={{ position: 'relative', flex: 1 }}>
                              <NumberInput
                                placeholder="Count"
                                value={currentValue ?? ''}
                                onChange={(value) =>
                                  update({
                                    spellsValue: typeof value === 'number' ? value : null,
                                  })
                                }
                                min={0}
                                style={{ width: '100%' }}
                                styles={{
                                  input: {
                                    backgroundColor: 'rgba(30, 41, 59, 0.8)',
                                    color: 'white',
                                    borderColor: 'rgba(74, 144, 226, 0.3)',
                                    paddingRight: '46px',
                                  },
                                }}
                              />
                              {currentValue !== null && currentValue !== undefined ? (
                                <button
                                  type="button"
                                  onClick={(e) => {
                                    e.preventDefault()
                                    e.stopPropagation()
                                    update({ spellsValue: null })
                                  }}
                                  onMouseDown={(e) => {
                                    e.preventDefault()
                                    e.stopPropagation()
                                  }}
                                  style={{
                                    position: 'absolute',
                                    right: 28,
                                    top: '50%',
                                    transform: 'translateY(-50%)',
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
                            </div>
                          </Group>
                        </Stack>,
                        { header, actions: modeControl }
                      )
                      }
                    case 'free-spells':
                      {
                        const currentMode = (state.freeSpellsMode as FilterState['freeSpellsMode']) || 'include'
                        const currentOperator = (state.freeSpellsOperator as FilterState['freeSpellsOperator']) || '>='
                        const currentValue = state.freeSpellsValue as number | null | undefined
                        const header = (
                          <Text size="sm" className="text-white" style={{ fontWeight: 500 }}>
                            Free Spells
                          </Text>
                        )
                        const modeControl = (
                          <SegmentedControl
                            size="xs"
                            value={currentMode}
                            onChange={(value) => update({ freeSpellsMode: value as 'include' | 'exclude' })}
                            data={MODE_OPTIONS}
                          />
                        )
                      return renderFilterCol(
                        block,
                        <Stack gap={4}>
                          <Group gap="xs" align="flex-end" wrap="nowrap">
                            <Select
                              value={currentOperator}
                              onChange={(value) => update({ freeSpellsOperator: value as any })}
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
                            <div style={{ position: 'relative', flex: 1, minWidth: 0 }}>
                              <NumberInput
                                placeholder="Count"
                                value={currentValue ?? undefined}
                                onChange={(value) => update({ freeSpellsValue: typeof value === 'number' ? value : null })}
                                min={0}
                                style={{ width: '100%' }}
                                styles={{
                                  input: {
                                    backgroundColor: 'rgba(30, 41, 59, 0.8)',
                                    color: 'white',
                                    borderColor: 'rgba(74, 144, 226, 0.3)',
                                    fontSize: '14px',
                                    paddingRight: '46px',
                                  },
                                }}
                              />
                              {currentValue !== null && currentValue !== undefined ? (
                                <button
                                  type="button"
                                  onClick={(e) => {
                                    e.preventDefault()
                                    e.stopPropagation()
                                    update({ freeSpellsValue: null })
                                  }}
                                  onMouseDown={(e) => {
                                    e.preventDefault()
                                    e.stopPropagation()
                                  }}
                                  style={{
                                    position: 'absolute',
                                    right: 28,
                                    top: '50%',
                                    transform: 'translateY(-50%)',
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
                            </div>
                          </Group>
                        </Stack>,
                        { header, actions: modeControl }
                      )
                      }
                    case 'spell-type':
                      {
                        const currentMode = (state.spellTypeMode as FilterState['spellTypeMode']) || 'include'
                        const currentType = (state.spellType as string) || ''
                        const currentCount = state.spellTypeCount as number | null | undefined
                        const header = (
                          <Text size="sm" fw={500} style={{ color: 'white' }}>
                            Spell Type
                          </Text>
                        )
                        const modeControl = (
                          <SegmentedControl
                            size="xs"
                            value={currentMode}
                            onChange={(value) => update({ spellTypeMode: value as 'include' | 'exclude' })}
                            data={MODE_OPTIONS}
                          />
                        )
                      return renderFilterCol(
                        block,
                        <Stack gap={6}>
                          <Group gap="xs" align="flex-end">
                            <Select
                              placeholder={allSpellTypes.length > 0 ? "Select spell type..." : "No types available"}
                              data={allSpellTypes.map(type => ({ value: type, label: type }))}
                              value={currentType || null}
                              onChange={(value) =>
                                update({
                                  spellType: value || '',
                                  spellTypeCount: value ? (currentCount ?? 1) : null,
                                })
                              }
                              clearable
                              searchable
                              disabled={allSpellTypes.length === 0}
                              style={{ flex: 1 }}
                              styles={{
                                input: { backgroundColor: 'rgba(30, 41, 59, 0.8)', color: 'white', borderColor: 'rgba(74, 144, 226, 0.3)' },
                                dropdown: { backgroundColor: 'rgba(30, 41, 59, 0.95)' },
                                option: { color: 'white' }
                              }}
                            />
                            <div style={{ position: 'relative', flex: '0 0 120px' }}>
                              <NumberInput
                                placeholder="Min count"
                                value={currentCount ?? ''}
                                onChange={(value) =>
                                  update({
                                    spellTypeCount: typeof value === 'number' ? value : null,
                                  })
                                }
                                min={0}
                                style={{ width: '100%' }}
                                disabled={!currentType}
                                styles={{
                                  input: {
                                    backgroundColor: 'rgba(30, 41, 59, 0.8)',
                                    color: 'white',
                                    borderColor: 'rgba(74, 144, 226, 0.3)',
                                    paddingRight: '46px',
                                  },
                                }}
                              />
                              {currentCount !== null && currentCount !== undefined ? (
                                <button
                                  type="button"
                                  onClick={(e) => {
                                    e.preventDefault()
                                    e.stopPropagation()
                                    update({ spellTypeCount: null })
                                  }}
                                  onMouseDown={(e) => {
                                    e.preventDefault()
                                    e.stopPropagation()
                                  }}
                                  style={{
                                    position: 'absolute',
                                    right: 28,
                                    top: '50%',
                                    transform: 'translateY(-50%)',
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
                            </div>
                          </Group>
                        </Stack>,
                        { header, actions: modeControl }
                      )
                      }
                    case 'card-set': {
                      const cardSetState =
                        cardSetInstances[block.id] || {
                          cardSetNo: (state.cardSetNo as string[]) || [],
                          cardSetNoMode: ((state.cardSetNoMode as 'include' | 'exclude') || 'include'),
                        }
                      const header = (
                        <Text size="sm" fw={500} style={{ color: 'white' }}>
                          Card Set
                        </Text>
                      )
                      const updateCardSetState = (nextState: CardSetInstanceState) => {
                        setCardSetInstances((prev) => ({
                          ...prev,
                          [block.id]: nextState,
                        }))
                        setInstanceFilters((prev) => ({
                          ...prev,
                          [block.id]: {
                            ...(prev[block.id] || getDefaultsForKey('card-set')),
                            cardSetNo: nextState.cardSetNo,
                            cardSetNoMode: nextState.cardSetNoMode,
                          },
                        }))
                      }
                      const modeControl = (
                        <SegmentedControl
                          size="xs"
                          value={cardSetState.cardSetNoMode}
                          onChange={(value) =>
                            updateCardSetState({
                              ...cardSetState,
                              cardSetNoMode: value as 'include' | 'exclude',
                            })
                          }
                          data={MODE_OPTIONS}
                        />
                      )
                      return renderFilterCol(
                        block,
                        <Stack gap={6}>
                          <MultiSelect
                            placeholder="Select sets..."
                            data={allCardSetNos.map(setNo => ({ value: setNo, label: formatSetName(setNo) || `Set ${setNo}` }))}
                            value={cardSetState.cardSetNo}
                            onChange={(value) =>
                              updateCardSetState({
                                ...cardSetState,
                                cardSetNo: value,
                              })
                            }
                            clearable
                            searchable
                            styles={{
                              input: { backgroundColor: 'rgba(30, 41, 59, 0.8)', color: 'white', borderColor: 'rgba(74, 144, 226, 0.3)' },
                              dropdown: { backgroundColor: 'rgba(30, 41, 59, 0.95)' },
                              option: { color: 'white' }
                            }}
                            disabled={allCardSetNos.length === 0}
                          />
                        </Stack>,
                        { header, actions: modeControl }
                      )
                    }
                    case 'elo':
                      {
                        const currentMode = (state.eloMode as FilterState['eloMode']) || 'include'
                        const currentOperator = (state.eloOperator as FilterState['eloOperator']) || '>='
                        const currentValue = state.eloValue as number | null | undefined
                        const header = (
                          <Text size="sm" fw={500} style={{ color: 'white' }}>
                            ELO
                          </Text>
                        )
                        const modeControl = (
                          <SegmentedControl
                            size="xs"
                            value={currentMode}
                            onChange={(value) => update({ eloMode: value as 'include' | 'exclude' })}
                            data={MODE_OPTIONS}
                          />
                        )
                      return renderFilterCol(
                        block,
                        <Stack gap={6}>
                          <Group gap="xs" align="flex-end">
                            <Select
                              value={currentOperator}
                              onChange={(value) => update({ eloOperator: value as any })}
                              data={[
                                { value: '>=', label: '≥' },
                                { value: '<=', label: '≤' },
                                { value: '=', label: '=' },
                              ]}
                              style={{ flex: '0 0 80px' }}
                              styles={{
                                input: { backgroundColor: 'rgba(30, 41, 59, 0.8)', color: 'white', borderColor: 'rgba(74, 144, 226, 0.3)' }
                              }}
                            />
                            <div style={{ position: 'relative', flex: 1 }}>
                              <NumberInput
                                placeholder="ELO value"
                                value={currentValue ?? ''}
                                onChange={(value) => {
                                  update({ eloValue: typeof value === 'number' ? value : null })
                                }}
                                min={0}
                                style={{ width: '100%' }}
                                styles={{
                                  input: {
                                    backgroundColor: 'rgba(30, 41, 59, 0.8)',
                                    color: 'white',
                                    borderColor: 'rgba(74, 144, 226, 0.3)',
                                    paddingRight: '46px',
                                  },
                                }}
                              />
                              {currentValue !== null && currentValue !== undefined ? (
                                <button
                                  type="button"
                                  onClick={(e) => {
                                    e.preventDefault()
                                    e.stopPropagation()
                                    update({ eloValue: null })
                                  }}
                                  onMouseDown={(e) => {
                                    e.preventDefault()
                                    e.stopPropagation()
                                  }}
                                  style={{
                                    position: 'absolute',
                                    right: 28,
                                    top: '50%',
                                    transform: 'translateY(-50%)',
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
                            </div>
                          </Group>
                        </Stack>,
                        { header, actions: modeControl }
                      )
                      }
                    case 'score':
                      {
                        const currentMode = (state.scoreMode as FilterState['scoreMode']) || 'include'
                        const currentOperator = (state.scoreOperator as FilterState['scoreOperator']) || '>='
                        const currentValue = state.scoreValue as number | null | undefined
                        const header = (
                          <Text size="sm" fw={500} style={{ color: 'white' }}>
                            Score
                          </Text>
                        )
                        const modeControl = (
                          <SegmentedControl
                            size="xs"
                            value={currentMode}
                            onChange={(value) => update({ scoreMode: value as 'include' | 'exclude' })}
                            data={MODE_OPTIONS}
                          />
                        )
                      return renderFilterCol(
                        block,
                        <Stack gap={6}>
                          <Group gap="xs" align="flex-end">
                            <Select
                              value={currentOperator}
                              onChange={(value) => update({ scoreOperator: value as any })}
                              data={[
                                { value: '>=', label: '≥' },
                                { value: '<=', label: '≤' },
                                { value: '=', label: '=' },
                              ]}
                              style={{ flex: '0 0 80px' }}
                              styles={{
                                input: { backgroundColor: 'rgba(30, 41, 59, 0.8)', color: 'white', borderColor: 'rgba(74, 144, 226, 0.3)' }
                              }}
                            />
                            <div style={{ position: 'relative', flex: 1 }}>
                              <NumberInput
                                placeholder="Score value (0-100)"
                                value={currentValue ?? ''}
                                onChange={(value) =>
                                  update({
                                    scoreValue: typeof value === 'number' ? value : null,
                                  })
                                }
                                min={0}
                                max={100}
                                step={1}
                                style={{ width: '100%' }}
                                styles={{
                                  input: {
                                    backgroundColor: 'rgba(30, 41, 59, 0.8)',
                                    color: 'white',
                                    borderColor: 'rgba(74, 144, 226, 0.3)',
                                    paddingRight: '46px',
                                  },
                                }}
                              />
                              {currentValue !== null && currentValue !== undefined ? (
                                <button
                                  type="button"
                                  onClick={(e) => {
                                    e.preventDefault()
                                    e.stopPropagation()
                                    update({ scoreValue: null })
                                  }}
                                  onMouseDown={(e) => {
                                    e.preventDefault()
                                    e.stopPropagation()
                                  }}
                                  style={{
                                    position: 'absolute',
                                    right: 28,
                                    top: '50%',
                                    transform: 'translateY(-50%)',
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
                            </div>
                          </Group>
                        </Stack>,
                        { header, actions: modeControl }
                      )
                      }
                    case 'rarity':
                      {
                        const currentMode = (state.rarityMode as FilterState['rarityMode']) || 'include'
                        const currentType = (state.rarityType as string) || ''
                        const currentCount = state.rarityCount as number | null | undefined
                        const header = (
                          <Text size="sm" fw={500} style={{ color: 'white' }}>
                            Rarity
                          </Text>
                        )
                        const modeControl = (
                          <SegmentedControl
                            size="xs"
                            value={currentMode}
                            onChange={(value) => update({ rarityMode: value as 'include' | 'exclude' })}
                            data={MODE_OPTIONS}
                          />
                        )
                      return renderFilterCol(
                        block,
                        <Stack gap={6}>
                          <Group gap="xs" align="flex-end">
                            <Select
                              placeholder="Select rarity..."
                              value={currentType}
                              onChange={(value) =>
                                update({
                                  rarityType: value || '',
                                  rarityCount: value ? (currentCount ?? 1) : null,
                                })
                              }
                              data={[
                                { value: 'Common', label: 'Common' },
                                { value: 'Common Common', label: 'Common Common' },
                                { value: 'Common Rare', label: 'Common Rare' },
                                { value: 'Darkforge Rare', label: 'Darkforge Rare' },
                                { value: 'Darkforge', label: 'Darkforge' },
                                { value: 'Rare Common', label: 'Rare Common' },
                                { value: 'Rare Rare', label: 'Rare Rare' },
                                { value: 'Rare', label: 'Rare' },
                                { value: 'LS', label: 'LS' },
                                { value: 'Solbind', label: 'Solbind' },
                              ]}
                              clearable
                              style={{ flex: 1 }}
                              styles={{
                                input: { backgroundColor: 'rgba(30, 41, 59, 0.8)', color: 'white', borderColor: 'rgba(74, 144, 226, 0.3)' }
                              }}
                            />
                            <div style={{ position: 'relative', flex: '0 0 120px' }}>
                              <NumberInput
                                placeholder="Min count"
                                value={currentCount ?? ''}
                                onChange={(value) =>
                                  update({
                                    rarityCount: typeof value === 'number' ? value : null,
                                  })
                                }
                                min={0}
                                style={{ width: '100%' }}
                                disabled={!currentType}
                                styles={{
                                  input: {
                                    backgroundColor: 'rgba(30, 41, 59, 0.8)',
                                    color: 'white',
                                    borderColor: 'rgba(74, 144, 226, 0.3)',
                                    paddingRight: '46px',
                                  },
                                }}
                              />
                              {currentCount !== null && currentCount !== undefined ? (
                                <button
                                  type="button"
                                  onClick={(e) => {
                                    e.preventDefault()
                                    e.stopPropagation()
                                    update({ rarityCount: null })
                                  }}
                                  onMouseDown={(e) => {
                                    e.preventDefault()
                                    e.stopPropagation()
                                  }}
                                  style={{
                                    position: 'absolute',
                                    right: 28,
                                    top: '50%',
                                    transform: 'translateY(-50%)',
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
                            </div>
                          </Group>
                        </Stack>,
                        { header, actions: modeControl }
                      )
                      }
                    case 'sort':
                      {
                        const currentSort = (state.sortBy as string) || 'date-desc'
                        const header = (
                          <Text size="sm" fw={500} style={{ color: 'white' }}>
                            Sort
                          </Text>
                        )
                        return renderFilterCol(
                          block,
                          <Select
                            value={currentSort}
                            onChange={(value) => update({ sortBy: value || 'date-desc' })}
                            data={SORT_OPTIONS}
                            styles={{
                              input: { backgroundColor: 'rgba(30, 41, 59, 0.8)', color: 'white', borderColor: 'rgba(74, 144, 226, 0.3)' }
                            }}
                          />,
                          { header }
                        )
                      }
                    case 'deck-status':
                      return renderFilterCol(
                        block,
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
                        </Stack>,
                        { removable: false }
                      )
                    default:
                      return null
                  }
                })}
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
                <div style={{ position: 'relative' }}>
                  {regularRows.map((rowDecks, idx) => (
                    <div key={`regular-row-${idx}`} style={{ paddingBottom: '16px' }}>
                      <Grid gutter="md" align="stretch">
                        {rowDecks.map((deck) => (
                          <RegularDeckCard
                            key={deck.id}
                            deck={deck}
                            handleDeckClick={handleDeckClick}
                            deckCreatureTypesMap={deckCreatureTypesMap}
                          />
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
                <div style={{ position: 'relative' }}>
                  {fusedRows.map((rowDecks, idx) => (
                    <div key={`fused-row-${idx}`} style={{ paddingBottom: '16px' }}>
                      <Grid gutter="md" align="stretch">
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
                              deckCreatureTypesMap={deckCreatureTypesMap}
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
        deckCreatureTypesMap={deckCreatureTypesMap}
      />
    </>
  )
}
