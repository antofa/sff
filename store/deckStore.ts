import { create } from 'zustand'
import { z } from 'zod'
import { getCardInfo, type CardInfo } from '@/lib/api'
import { computeCreatureTypesForDeck } from '@/lib/creatureTypes'
import { parseDeck, parseDecks, resolveDeckSetCode } from '@/store/parsers/deck'

const CACHE_TTL_MS = 24 * 60 * 60 * 1000 // 1 day client-side cache

export type DeckComputed = {
  expiryTs: number | null
  deckSet?: string | null
  setShortCode?: string | null
  counts?: { total: number; creatures: number; spells: number; solbind: number }
  rarityCounts?: Record<string, number>
  creatureType?: Record<string, number>
  displayTags?: string[]
}

// Cache card info to avoid expensive recomputation on every render
const cardInfoCache = new Map<string, CardInfo>()

const getCardInfoCached = (cardId: string, cardData?: any): CardInfo => {
  if (!cardId) return getCardInfo(cardId, cardData)
  const cached = cardInfoCache.get(cardId)
  if (cached && !cardData) return cached
  const mergedData = cached && cardData ? { ...cached, ...cardData } : cardData
  const info = getCardInfo(cardId, mergedData)
  cardInfoCache.set(cardId, info)
  return info
}

// Resolve expiry timestamp (ms) for a deck
const getExpiryTimestamp = (deck: Deck): number | null => {
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

// Count cards as sum of creatures + spells + solbind (excluding Forgeborn)
const countPlayableCards = (deck: Deck): { total: number; creatures: number; spells: number; solbind: number } => {
  const deckAny = deck as any
  const extractCards = (d: any): any[] => {
    if (!d) return []
    if (Array.isArray(d.cardList)) return d.cardList
    if (Array.isArray(d.cards)) return d.cards
    if (Array.isArray(d.cardIds) && d.cardIds.length > 0) {
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
    if (d.cards && typeof d.cards === 'object') return Object.values(d.cards)
    return []
  }

  let rawCards: any[] = extractCards(deckAny)

  const hasFusedHalves = Array.isArray(deckAny.myDecks) && deckAny.myDecks.length > 0

  if ((deckAny.format === 'Fused' || hasFusedHalves) && hasFusedHalves) {
    const combined: any[] = []
    const seen = new Set<string>()
    const addCards = (cardsArr: any[], ids?: any[]) => {
      cardsArr.forEach((c, idx) => {
        const cardObj = { ...c }
        if (!cardObj.id && Array.isArray(ids) && ids[idx]) {
          cardObj.id = ids[idx]
        }
        if (!cardObj.id) {
          cardObj.id = cardObj.cardId || cardObj.name || cardObj.title || `card-${combined.length + idx}`
        }
        const key = cardObj?.id || cardObj?.cardId || cardObj?.name || cardObj?.title || `card-${combined.length + idx}`
        if (seen.has(key)) return
        seen.add(key)
        combined.push(cardObj)
      })
    }
    deckAny.myDecks.forEach((src: any) => addCards(extractCards(src), src.cardIds))
    if (combined.length > 0) rawCards = combined
  }

  if (!rawCards || rawCards.length === 0) return { total: 0, creatures: 0, spells: 0, solbind: 0 }

  const normalizedCards = rawCards.map((card: any, index: number) => {
    if (typeof card === 'string') return getCardInfoCached(card)
    if (typeof card === 'object' && card !== null) {
      const cardId = card.id || card.cardId || card.name || `card-${index}`
      return getCardInfoCached(cardId, card)
    }
    return getCardInfoCached(`card-${index}`)
  })

  const solbindCardIds = new Set<string>()
  normalizedCards.forEach(card => {
    const cardData = card as any
    if (cardData.solbindCards && Array.isArray(cardData.solbindCards)) {
      cardData.solbindCards.forEach((solbindCard: any, sbIdx: number) => {
        if (!solbindCard) return
        const sbId = solbindCard.id || solbindCard.cardId || solbindCard.name || `solbind-${card.id || 'card'}-${sbIdx}`
        if (sbId) solbindCardIds.add(sbId)
      })
    }
    if (cardData.solbindId1 || cardData.solbindid1) solbindCardIds.add(cardData.solbindId1 || cardData.solbindid1)
    if (cardData.solbindId2 || cardData.solbindid2) solbindCardIds.add(cardData.solbindId2 || cardData.solbindid2)
  })

  if ((deck as any).forgeborn && Array.isArray((deck as any).forgeborn.solbindCards)) {
    ;(deck as any).forgeborn.solbindCards.forEach((solbindCard: any, sbIdx: number) => {
      if (!solbindCard) return
      const sbId = solbindCard.id || solbindCard.cardId || solbindCard.name || `solbind-forgeborn-${sbIdx}`
      if (sbId) solbindCardIds.add(sbId)
    })
  }
  if ((deck as any).forgeborn) {
    const fb: any = (deck as any).forgeborn
    if (fb.solbindId1 || fb.solbindid1) solbindCardIds.add(fb.solbindId1 || fb.solbindid1)
    if (fb.solbindId2 || fb.solbindid2) solbindCardIds.add(fb.solbindId2 || fb.solbindid2)
  }

  const forgebornId = deck.forgebornId
  const forgebornCards: any[] = []
  if (forgebornId) {
    const forgeborn = normalizedCards.find(card =>
      card.id === forgebornId ||
      (card.id && forgebornId && card.id.includes(forgebornId)) ||
      (forgebornId && card.id && forgebornId.includes(card.id))
    )
    if (forgeborn) forgebornCards.push(forgeborn)
  }
  if (forgebornCards.length === 0) {
    const forgebornByType = normalizedCards.find(card =>
      card.type?.toLowerCase().includes('forgeborn') ||
      (card as any).cardType?.toLowerCase().includes('forgeborn')
    )
    if (forgebornByType) forgebornCards.push(forgebornByType)
  }

  const solbindCardObjects: any[] = []
  normalizedCards.forEach(card => {
    const cardData = card as any
    if (cardData.solbindCards && Array.isArray(cardData.solbindCards)) {
      cardData.solbindCards.forEach((solbindCard: any, sbIdx: number) => {
        if (!solbindCard) return
        const sbId = solbindCard.id || solbindCard.cardId || solbindCard.name || `solbind-${card.id || 'card'}-${sbIdx}`
        if (!solbindCardObjects.some(sb => sb.id === sbId)) {
          solbindCardObjects.push(getCardInfoCached(sbId, { ...solbindCard, id: sbId }))
        }
      })
    }
    const id1 = cardData.solbindId1 || cardData.solbindid1
    const id2 = cardData.solbindId2 || cardData.solbindid2
    if (id1 && !solbindCardObjects.some(sb => sb.id === id1)) {
      solbindCardObjects.push(getCardInfoCached(id1, { id: id1 }))
    }
    if (id2 && !solbindCardObjects.some(sb => sb.id === id2)) {
      solbindCardObjects.push(getCardInfoCached(id2, { id: id2 }))
    }
  })

  if ((deck as any).forgeborn && Array.isArray((deck as any).forgeborn.solbindCards)) {
    ;(deck as any).forgeborn.solbindCards.forEach((solbindCard: any, sbIdx: number) => {
      if (!solbindCard) return
      const sbId = solbindCard.id || solbindCard.cardId || solbindCard.name || `solbind-forgeborn-${sbIdx}`
      if (!sbId) return
      if (!solbindCardObjects.some(sb => sb.id === sbId)) {
        solbindCardObjects.push(getCardInfoCached(sbId, { ...solbindCard, id: sbId }))
      }
    })
  }
  if ((deck as any).forgeborn) {
    const fb: any = (deck as any).forgeborn
    if (fb.solbindId1 || fb.solbindid1) {
      const id = fb.solbindId1 || fb.solbindid1
      if (!solbindCardObjects.some(sb => sb.id === id)) {
        solbindCardObjects.push(getCardInfoCached(id, { id }))
      }
    }
    if (fb.solbindId2 || fb.solbindid2) {
      const id = fb.solbindId2 || fb.solbindid2
      if (!solbindCardObjects.some(sb => sb.id === id)) {
        solbindCardObjects.push(getCardInfoCached(id, { id }))
      }
    }
  }

  const solbindUniqueMap = new Map<string, any>()
  solbindCardObjects.forEach(sb => {
    if (sb?.id && !solbindUniqueMap.has(sb.id)) {
      solbindUniqueMap.set(sb.id, sb)
    }
  })
  const solbindCardsUnique = Array.from(solbindUniqueMap.values())
  const solbindCount = Math.max(solbindCardIds.size, solbindCardsUnique.length)

  const forgebornIdSet = new Set<string>()
  if (deck.forgebornId) forgebornIdSet.add(deck.forgebornId)
  normalizedCards.forEach(card => {
    const cardData = card as any
    const ct = (cardData.cardType || cardData.type || '').toLowerCase()
    if (ct.includes('forgeborn') && card.id) {
      forgebornIdSet.add(card.id)
    }
  })

  let creatures = 0
  let spells = 0
  normalizedCards.forEach(card => {
    const cardData = card as any
    const cardId = card.id
    const isForgeborn =
      forgebornIdSet.has(cardId) ||
      cardData.type?.toLowerCase().includes('forgeborn') ||
      cardData.cardType?.toLowerCase().includes('forgeborn')
    if (isForgeborn) return

    // Only count referenced solbind children as solbind; exclude them from creature/spell counts
    const isSolbindChild = solbindCardIds.has(cardId)
    if (isSolbindChild) return

    const originalCard = deck.cards && Array.isArray(deck.cards)
      ? deck.cards.find((c: any, idx: number) => {
          if (typeof c === 'string') return c === cardId
          const cId = c?.id || c?.cardId || c?.name || `card-${idx}`
          return cId === cardId
        })
      : null

    const originalCardType = originalCard && typeof originalCard === 'object'
      ? (originalCard.cardType || (originalCard as any).card_type || (originalCard as any).type || '')
      : ''
    const cardType = cardData.cardType || cardData.card_type || cardData.type || originalCardType || ''
    const lowerCardType = cardType.toLowerCase()
    const isSpell = lowerCardType.includes('spell') && !lowerCardType.includes('creature')

    if (isSpell) spells++
    else creatures++
  })

  const total = creatures + spells + solbindCount

  return { total, creatures, spells, solbind: solbindCount }
}

const computeRarityCounts = (deck: Deck): Record<string, number> => {
  const rarityCounts = new Map<string, number>()
  const deckAny = deck as any
  const extractCards = (d: any): any[] => {
    if (!d) return []
    if (Array.isArray(d.cardList)) return d.cardList
    if (Array.isArray(d.cards)) return d.cards
    if (Array.isArray(d.cardIds) && d.cardIds.length > 0) {
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
    if (d.cards && typeof d.cards === 'object') return Object.values(d.cards)
    return []
  }

  let sourceCards: any[] = extractCards(deckAny)
  const hasFusedHalves = Array.isArray(deckAny.myDecks) && deckAny.myDecks.length > 0
  if ((deckAny.format === 'Fused' || hasFusedHalves) && hasFusedHalves) {
    const combined: any[] = []
    const seen = new Set<string>()
    const addCards = (arr: any[], ids?: any[]) => {
      arr.forEach((c, idx) => {
        const cardObj = { ...c }
        if (!cardObj.id && Array.isArray(ids) && ids[idx]) {
          cardObj.id = ids[idx]
        }
        if (!cardObj.id) {
          cardObj.id = cardObj.cardId || cardObj.name || cardObj.title || `card-${combined.length + idx}`
        }
        const key = cardObj?.id || cardObj?.cardId || cardObj?.name || cardObj?.title || `card-${combined.length + idx}`
        if (seen.has(key)) return
        seen.add(key)
        combined.push(cardObj)
      })
    }
    deckAny.myDecks.forEach((src: any) => addCards(extractCards(src), src.cardIds))
    if (combined.length > 0) sourceCards = combined
  }

  if (!sourceCards || !Array.isArray(sourceCards) || sourceCards.length === 0) return {}

  const normalizedCards = sourceCards.map((card: any, index: number) => {
    if (typeof card === 'string') return getCardInfoCached(card)
    if (typeof card === 'object' && card !== null) {
      const cardId = card.id || card.cardId || card.name || `card-${index}`
      return getCardInfoCached(cardId, card)
    }
    return getCardInfoCached(`card-${index}`)
  })

  const solbindCardIds = new Set<string>()
  normalizedCards.forEach(card => {
    const cardData = card as any
    if (cardData.solbindCards && Array.isArray(cardData.solbindCards)) {
      cardData.solbindCards.forEach((solbindCard: any) => {
        const sbId = solbindCard?.id || solbindCard?.cardId || solbindCard?.name
        if (sbId) solbindCardIds.add(sbId)
      })
    }
    if (typeof cardData.solbind === 'string') {
      cardData.solbind
        .split(',')
        .map((s: string) => s.trim())
        .filter(Boolean)
        .forEach((sid: string) => solbindCardIds.add(sid))
    }
    if (cardData.solbindId1 || cardData.solbindid1) solbindCardIds.add(cardData.solbindId1 || cardData.solbindid1)
    if (cardData.solbindId2 || cardData.solbindid2) solbindCardIds.add(cardData.solbindId2 || cardData.solbindid2)
  })
  if ((deckAny as any)?.forgeborn && Array.isArray((deckAny as any).forgeborn.solbindCards)) {
    ;(deckAny as any).forgeborn.solbindCards.forEach((solbindCard: any) => {
      const sbId = solbindCard?.id || solbindCard?.cardId || solbindCard?.name
      if (sbId) solbindCardIds.add(sbId)
    })
  }
  if ((deckAny as any)?.forgeborn) {
    const fb: any = (deckAny as any).forgeborn
    if (fb.solbindId1 || fb.solbindid1) solbindCardIds.add(fb.solbindId1 || fb.solbindid1)
    if (fb.solbindId2 || fb.solbindid2) solbindCardIds.add(fb.solbindId2 || fb.solbindid2)
  }

  let parentSolbindCount = 0
  normalizedCards.forEach((card, idx) => {
    const cardData = card as any
    const cardId = card.id || cardData.cardId || cardData.name || `card-${idx}`
    if (solbindCardIds.has(cardId)) return
    const rarityRaw = cardData.rarity
    const rarityLower = typeof rarityRaw === 'string' ? rarityRaw.toLowerCase() : ''
    const hasSolbindChildren =
      (Array.isArray(cardData.solbindCards) && cardData.solbindCards.length > 0) ||
      typeof cardData.solbind === 'string' ||
      !!(cardData.solbindId1 || cardData.solbindid1 || cardData.solbindId2 || cardData.solbindid2)
    const isParentSolbind = hasSolbindChildren && typeof rarityRaw === 'string' && rarityLower.includes('solbind')
    if (isParentSolbind) {
      parentSolbindCount += 1
      return
    }

    const originalCardForType = Array.isArray(deck.cards)
      ? deck.cards.find((c: any, i: number) => {
          const cId = typeof c === 'string' ? c : (c?.id || c?.cardId || c?.name || `card-${i}`)
          return cId === card.id
        })
      : undefined
    const originalCardType = originalCardForType && typeof originalCardForType === 'object'
      ? (originalCardForType.cardType || originalCardForType.card_type || '')
      : ''
    const cardType = cardData.cardType || cardData.card_type || originalCardType || ''
    const lowerCardType = cardType.toLowerCase()
    const isSpell = lowerCardType.includes('spell') && !lowerCardType.includes('creature')
    if (rarityRaw && typeof rarityRaw === 'string') {
      let normalizedRarity = rarityRaw.trim()
      const lower = normalizedRarity.toLowerCase()
      if (lower.includes('n/a')) {
        return
      }
      if (lower.includes('darkforge') && lower.includes('rare')) {
        normalizedRarity = 'Darkforge Rare'
      } else if (lower.includes('darkforge') && lower.includes('common')) {
        normalizedRarity = 'Darkforge Common'
      } else if (lower.includes('darkforge') && (lower.includes('ls') || lower.includes('legendary'))) {
        normalizedRarity = 'Darkforge LS'
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
      const currentCount = rarityCounts.get(normalizedRarity) || 0
      rarityCounts.set(normalizedRarity, currentCount + 1)
    }
    void isSpell
  })

  if (parentSolbindCount > 0) {
    rarityCounts.set('Solbind', (rarityCounts.get('Solbind') || 0) + parentSolbindCount)
  }

  return Object.fromEntries(rarityCounts)
}

const computeCreatureTypes = (deck: Deck): Record<string, number> => {
  try {
    return computeCreatureTypesForDeck(deck, getCardInfoCached)
  } catch (err) {
    console.warn('[Store] Failed to compute creature types', err)
    return {}
  }
}

const buildDisplayTags = (deck: Deck): string[] => {
  const tagsSet = new Set<string>()
  if (deck.tags && typeof deck.tags === 'object' && !Array.isArray(deck.tags)) {
    Object.entries(deck.tags).forEach(([key, value]) => {
      if (value === null || value === undefined || value === '') return
      if (key === 'none' && (!value || value === '')) return
      if (typeof value === 'string' && value.trim() === '') return
      let tagText: string | null = null
      if (typeof value === 'string' && value.trim() !== '') {
        tagText = value.trim()
      } else if (typeof value === 'number' || typeof value === 'boolean') {
        tagText = String(value)
      } else if (key && key !== 'none' && !key.startsWith('tag_')) {
        tagText = key
      } else if (key && key.startsWith('tag_')) {
        return
      }
      if (tagText && tagText.trim() !== '') tagsSet.add(tagText.trim())
    })
  }

  // myCategories (act like tags)
  const cats = (deck as any)?.myCategories
  if (cats && typeof cats === 'object' && !Array.isArray(cats)) {
    Object.entries(cats).forEach(([key, value]) => {
      const addVal = (v?: string | null) => {
        if (!v || typeof v !== 'string') return
        const trimmed = v.trim()
        if (trimmed) tagsSet.add(trimmed)
      }
      addVal(key)
      addVal(value as any)
    })
  }

  if (tagsSet.size === 0 && deck.cards && Array.isArray(deck.cards)) {
    deck.cards.forEach((card: any) => {
      if (card && typeof card === 'object') {
        const provides = card.provides || card.Provides
        if (provides) {
          if (typeof provides === 'string') {
            provides.split(',').forEach((p: string) => {
              const trimmed = p.trim()
              if (trimmed) tagsSet.add(trimmed)
            })
          } else if (Array.isArray(provides)) {
            provides.forEach((p: string) => {
              if (p && typeof p === 'string') {
                const trimmed = p.trim()
                if (trimmed) tagsSet.add(trimmed)
              }
            })
          }
        }
      }
    })
  }

  return Array.from(tagsSet)
}

export const addComputedFields = (deck: Deck, options?: { allDecks?: Deck[] }): Deck => {
  const alreadyParsed =
    Object.prototype.hasOwnProperty.call(deck, 'setCode') &&
    Object.prototype.hasOwnProperty.call(deck, 'setShortCode')
  const parsedDeck = (
    alreadyParsed
      ? deck
      : parseDeck(deck as Record<string, any>, { allDecks: options?.allDecks as Record<string, any>[] | undefined })
  ) as Deck
  const resolvedDeckSet =
    parsedDeck.setCode ??
    resolveDeckSetCode(parsedDeck as Record<string, any>, {
      allDecks: options?.allDecks as Record<string, any>[] | undefined,
    })
  const creatureType = computeCreatureTypes(parsedDeck)
  const computed: DeckComputed = {
    expiryTs: getExpiryTimestamp(parsedDeck),
    deckSet: resolvedDeckSet || null,
    setShortCode: parsedDeck.setShortCode || null,
    counts: countPlayableCards(parsedDeck),
    rarityCounts: computeRarityCounts(parsedDeck),
    creatureType,
    displayTags: buildDisplayTags(parsedDeck),
  }
  return { ...parsedDeck, creatureType, computed }
}

const attachComputed = (decks: Deck[], options?: { allDecks?: Deck[] }): Deck[] => {
  return decks.map((deck) => addComputedFields(deck, options))
}

const attachComputedByGroup = (regularDecks: Deck[], fusedDecks: Deck[]) => {
  const allDecks = [...regularDecks, ...fusedDecks]
  const parsedRegular = parseDecks(regularDecks as Record<string, any>[], {
    allDecks: allDecks as Record<string, any>[],
  }) as Deck[]
  const parsedFused = parseDecks(fusedDecks as Record<string, any>[], {
    allDecks: allDecks as Record<string, any>[],
  }) as Deck[]
  return {
    regular: attachComputed(parsedRegular),
    fused: attachComputed(parsedFused),
  }
}

const getForgebornNameFromDeck = (deck: Deck): string | null => {
  if (deck.forgeborn && typeof deck.forgeborn === 'object' && (deck.forgeborn as any).id) {
    const info = getCardInfoCached((deck.forgeborn as any).id, deck.forgeborn)
    if (info.name) return info.name
  }

  if (deck.forgeborn && typeof deck.forgeborn === 'object') {
    const name = (deck.forgeborn as any).title || (deck.forgeborn as any).name
    if (name) return name
  }

  if (deck.cards && Array.isArray(deck.cards)) {
    const normalizedCards = deck.cards.map((card: any, index: number) => {
      if (typeof card === 'string') return getCardInfoCached(card)
      if (typeof card === 'object' && card !== null) {
        const cardId = card.id || card.cardId || card.name || `card-${index}`
        return getCardInfoCached(cardId, card)
      }
      return getCardInfoCached(`card-${index}`)
    })

    if (deck.forgebornId) {
      const forgeborn = normalizedCards.find(card =>
        card.id === deck.forgebornId ||
        (card.id && deck.forgebornId && card.id.includes(deck.forgebornId)) ||
        (deck.forgebornId && card.id && deck.forgebornId.includes(card.id))
      )
      if (forgeborn?.name) return forgeborn.name
    }

    const forgebornByType = normalizedCards.find(card =>
      card.type?.toLowerCase().includes('forgeborn') ||
      (card as any).cardType?.toLowerCase().includes('forgeborn')
    )
    if (forgebornByType?.name) return forgebornByType.name
  }

  return null
}

const buildNameIndexes = (regularDecks: Deck[], fusedDecks: Deck[]) => {
  const deckNames = new Set<string>()
  const forgebornNames = new Set<string>()
  const allDecks = [...regularDecks, ...fusedDecks]

  allDecks.forEach(deck => {
    if (deck.name && deck.name.trim()) {
      deckNames.add(deck.name.trim())
    }
    const fb = getForgebornNameFromDeck(deck)
    if (fb) forgebornNames.add(fb)
  })

  return {
    deckNameIndex: Array.from(deckNames).sort(),
    forgebornNameIndex: Array.from(forgebornNames).sort(),
  }
}

type DeckCacheEntry = {
  decks: Deck[]
  fusedDecks: Deck[]
  tagIndex?: string[]
  cardNameIndex?: string[]
  deckNameIndex?: string[]
  forgebornNameIndex?: string[]
  deckTags?: Record<string, string[]>
  deckCreatureTypes?: Record<string, Record<string, number>>
  expiresAt: number
}

// Function to convert digital to number | boolean
const preprocessDigital = (val: unknown): number | boolean | undefined => {
  if (val === undefined || val === null) return undefined
  if (typeof val === 'number') return val
  if (typeof val === 'boolean') return val
  if (typeof val === 'string') {
    if (val === 'true' || val === '1') return true
    if (val === 'false' || val === '0') return false
    const num = Number(val)
    return isNaN(num) ? false : num
  }
  return undefined
}

// Function to convert cardSetNo to string
const preprocessCardSetNo = (val: unknown): string | undefined => {
  if (val === undefined || val === null) return undefined
  if (typeof val === 'string') return val
  if (typeof val === 'number') return String(val)
  return undefined
}

const DeckSchema = z.preprocess(
  (data) => {
    if (typeof data === 'object' && data !== null) {
      const processed = { ...data }
      if ('digital' in processed) {
        processed.digital = preprocessDigital(processed.digital)
      }
      if ('cardSetNo' in processed) {
        processed.cardSetNo = preprocessCardSetNo(processed.cardSetNo)
      }
      return processed
    }
    return data
  },
  z.object({
    id: z.string(),
    name: z.string(),
    cards: z.array(z.any()).optional(),
    format: z.string().optional(),
    created: z.string().optional(),
    faction: z.string().optional(),
    forgebornId: z.string().optional(),
    forgeborn: z.any().optional(), // Full forgeborn object with abilities
    deckRank: z.string().optional(),
    digital: z.union([z.number(), z.boolean()]).optional(),
    tags: z.any().optional(),
    cardSetNo: z.string().optional(),
    cardSetId: z.string().optional(),
    // Fused deck specific fields
    myDecks: z.array(z.any()).optional(),
    fusedDeckIds: z.array(z.string()).optional(),
  }).passthrough() // Allow additional fields that are not in the schema
)

const DecksResponseSchema = z.array(DeckSchema)

export type Deck = z.infer<typeof DeckSchema> & {
  computed?: DeckComputed
  creatureType?: Record<string, number>
  setCode?: string | null
  setShortCode?: string | null
}

type ProgressStepKey = 'prepare' | 'fetchRegular' | 'fetchFused' | 'tags' | 'finalize'
type ProgressStepStatus = 'pending' | 'active' | 'done' | 'error'

type ProgressStep = {
  key: ProgressStepKey
  label: string
  status: ProgressStepStatus
  startedAt?: number
  finishedAt?: number
}

type FetchProgressStatus = 'idle' | 'running' | 'cached' | 'done' | 'error'

export type FetchProgress = {
  status: FetchProgressStatus
  steps: ProgressStep[]
  currentStepIndex: number
  totalSteps: number
  startedAt: number | null
  finishedAt: number | null
  message: string
  counters?: {
    regularCount?: number
    fusedCount?: number
    totalCount?: number
    regularPages?: number
    fusedPages?: number
    tagCount?: number
    tagProcessed?: number
    tagTotal?: number
  }
}

const PROGRESS_TEMPLATE: Array<Omit<ProgressStep, 'status'>> = [
  { key: 'prepare', label: 'Preparing request & cache check' },
  { key: 'fetchRegular', label: 'Requesting regular decks' },
  { key: 'fetchFused', label: 'Requesting fused decks' },
  { key: 'tags', label: 'Collecting tags' },
  { key: 'finalize', label: 'Validating & finalizing' },
]

const createIdleProgress = (): FetchProgress => ({
  status: 'idle',
  steps: PROGRESS_TEMPLATE.map((step) => ({ ...step, status: 'pending' as ProgressStepStatus })),
  currentStepIndex: -1,
  totalSteps: PROGRESS_TEMPLATE.length,
  startedAt: null,
  finishedAt: null,
  message: '',
  counters: {},
})

const buildTagSummary = (regularDecks: Deck[], fusedDecks: Deck[]) => {
  const tagsSet = new Set<string>()
  const allDecks = [...regularDecks, ...fusedDecks]

  allDecks.forEach((deck) => {
    if (deck.tags && typeof deck.tags === 'object' && !Array.isArray(deck.tags)) {
      Object.entries(deck.tags).forEach(([key, value]) => {
        if (value === null || value === undefined || value === '') return
        if (key === 'none' && (!value || value === '')) return
        if (typeof value === 'string' && value.trim() === '') return

        let tagText: string | null = null
        if (typeof value === 'string' && value.trim() !== '') {
          tagText = value.trim()
        } else if (typeof value === 'number' || typeof value === 'boolean') {
          tagText = String(value)
        } else if (key && key !== 'none' && !key.startsWith('tag_')) {
          tagText = key
        }

        if (tagText && tagText.trim() !== '') {
          tagsSet.add(tagText.trim())
        }
      })
    }

    if (deck.cards && Array.isArray(deck.cards)) {
      deck.cards.forEach((card: any) => {
        if (card && typeof card === 'object') {
          const provides = card.provides || card.Provides
          if (provides) {
            if (typeof provides === 'string') {
              provides.split(',').forEach((p: string) => {
                const trimmed = p.trim()
                if (trimmed) tagsSet.add(trimmed)
              })
            } else if (Array.isArray(provides)) {
              provides.forEach((p: string) => {
                if (p && typeof p === 'string') {
                  const trimmed = p.trim()
                  if (trimmed) tagsSet.add(trimmed)
                }
              })
            }
          }
        }
      })
    }
  })

  const tags = Array.from(tagsSet).sort()
  return { tags, count: tags.length }
}

interface DeckStore {
  decks: Deck[]
  fusedDecks: Deck[]
  loading: boolean
  error: string | null
  currentPlayer: string | null
  playerCache: Record<string, DeckCacheEntry>
  progress: FetchProgress
  tagIndex: string[]
  cardNameIndex: string[]
  deckNameIndex: string[]
  forgebornNameIndex: string[]
  deckTags: Record<string, string[]>
  deckCreatureTypes: Record<string, Record<string, number>>
  deckCreatureTypeOverrides: Record<string, Record<string, number>>
  currentEventSource: EventSource | null
  fetchDecks: (playerName: string, options?: { force?: boolean; keepExisting?: boolean }) => Promise<void>
  clearDecks: () => void
  setDeckCreatureType: (deckId: string, creatureType: Record<string, number>) => void
  restartFetchIfLoading: () => void
}

export const useDeckStore = create<DeckStore>((set, get) => ({
  decks: [],
  fusedDecks: [],
  loading: false,
  error: null,
  currentPlayer: null,
  playerCache: {},
  progress: createIdleProgress(),
  tagIndex: [],
  cardNameIndex: [],
  deckNameIndex: [],
  forgebornNameIndex: [],
  deckTags: {},
  deckCreatureTypes: {},
  deckCreatureTypeOverrides: {},
  currentEventSource: null,
  fetchDecks: async (playerName: string, options?: { force?: boolean; keepExisting?: boolean }) => {
    const forceRefresh = options?.force ?? false
    const keepExisting = options?.keepExisting ?? false
    const normalizedName = playerName.trim()
    if (!normalizedName) {
      set({ loading: false, error: 'Player nickname is required', decks: [], fusedDecks: [] })
      return
    }

    // Close any existing SSE before starting a new fetch
    const prevEs = get().currentEventSource
    if (prevEs) {
      try {
        prevEs.close()
      } catch {
        // ignore
      }
      set({ currentEventSource: null })
    }

    // Streaming implementation via SSE
    set({
      loading: true,
      error: null,
      progress: createIdleProgress(),
      currentPlayer: normalizedName,
      decks: keepExisting ? get().decks : [],
      fusedDecks: keepExisting ? get().fusedDecks : [],
    })

    const startedAt = Date.now()
    const normalizedPlayer = playerName.trim().toLowerCase()

    let progressSteps: ProgressStep[] = PROGRESS_TEMPLATE.map((step, idx) => ({
      ...step,
      status: idx === 0 ? 'active' : 'pending',
      startedAt: idx === 0 ? startedAt : undefined,
    }))

    const setProgressState = (updates: Partial<FetchProgress>) => {
      set((state) => ({
        progress: {
          ...state.progress,
          ...updates,
        },
      }))
    }

  const setProgressCounters = (counters: FetchProgress['counters']) => {
      set((state) => ({
        progress: {
          ...state.progress,
          counters: {
            ...state.progress.counters,
            ...counters,
          },
        },
      }))
    }

    const updateSteps = (stepKey: ProgressStepKey, statusOverride?: FetchProgressStatus, message?: string) => {
      const now = Date.now()
      progressSteps = progressSteps.map((step) => {
        if (step.key === stepKey) {
          return {
            ...step,
            status: statusOverride && statusOverride !== 'running'
              ? statusOverride === 'error' ? 'error' : 'done'
              : 'active',
            startedAt: step.startedAt ?? now,
            finishedAt: statusOverride && statusOverride !== 'running' ? now : step.finishedAt,
          }
        }
        if (step.status === 'active' && step.key !== stepKey) {
          return { ...step, status: 'done', finishedAt: now }
        }
        return step
      })

      const activeIndex = progressSteps.findIndex((s) => s.status === 'active')
      setProgressState({
        status: statusOverride ?? 'running',
        steps: progressSteps,
        currentStepIndex: activeIndex,
        totalSteps: progressSteps.length,
        startedAt,
        finishedAt: statusOverride && statusOverride !== 'running' ? now : null,
        message: message ?? get().progress.message,
      })
    }

    const finishProgress = (message: string, status: FetchProgressStatus = 'done') => {
      const now = Date.now()
      progressSteps = progressSteps.map((step) => ({
        ...step,
        status: status === 'error' && step.status === 'active' ? 'error' : 'done',
        startedAt: step.startedAt ?? startedAt,
        finishedAt: step.finishedAt ?? now,
      }))
      setProgressState({
        status,
        steps: progressSteps,
        currentStepIndex: progressSteps.length - 1,
        totalSteps: progressSteps.length,
        startedAt,
        finishedAt: now,
        message,
      })
    }

    // Start with prepare
    updateSteps('prepare', 'running', `Preparing request and checking cache for ${normalizedName}...`)

    // Cache check
    const cached = forceRefresh ? undefined : get().playerCache[normalizedPlayer]
    const now = Date.now()
    if (cached && cached.expiresAt > now) {
          const { regular: cachedRegular, fused: cachedFused } = attachComputedByGroup(cached.decks, cached.fusedDecks)
          const names = buildNameIndexes(cachedRegular, cachedFused)
          set({
            decks: cachedRegular,
            fusedDecks: cachedFused,
            loading: false,
            error: null,
            tagIndex: cached.tagIndex || [],
            cardNameIndex: cached.cardNameIndex || [],
            deckNameIndex: cached.deckNameIndex || names.deckNameIndex,
            forgebornNameIndex: cached.forgebornNameIndex || names.forgebornNameIndex,
            deckTags: cached.deckTags || {},
            deckCreatureTypes: cached.deckCreatureTypes || {},
          })
      setProgressCounters({
        regularCount: cachedRegular.length,
        fusedCount: cachedFused.length,
        totalCount: cachedRegular.length + cachedFused.length,
        regularPages: 1,
        fusedPages: cachedFused.length > 0 ? 1 : 0,
        tagCount: (cached.tagIndex || []).length,
      })
      updateSteps('fetchRegular', 'done', 'Loaded from cache')
      updateSteps('fetchFused', 'done')
      updateSteps('tags', 'done')
      updateSteps('finalize', 'done')
      finishProgress('Loaded from cache', 'cached')
      return
    }
    if (forceRefresh && get().playerCache[normalizedPlayer]) {
      set((state) => {
        const newCache = { ...state.playerCache }
        delete newCache[normalizedPlayer]
        return { playerCache: newCache }
      })
      setProgressState({
        message: 'Force refresh: cache cleared',
        status: 'running',
      })
    }

    // Switch to regular fetch step
    updateSteps('fetchRegular', 'running', 'Requesting regular decks...')

    return new Promise<void>((resolve, reject) => {
      const cacheBust = forceRefresh ? `&_=${Date.now()}` : ''
      const es = new EventSource(
        `/api/decks/stream?player=${encodeURIComponent(normalizedName)}${forceRefresh ? '&force=1' : ''}${cacheBust}`
      )
      set({ currentEventSource: es })
      let streamFinished = false
      let regularDecks: any[] = []
      let fusedDecks: any[] = []
      let meta: any = {}
      let tagsPayload: {
        uniqueTags?: string[]
        uniqueCardNames?: string[]
        perDeck?: Record<string, string[]>
        perDeckCreatureTypes?: Record<string, Record<string, number>>
      } = {}
      let latestTagMessage: string | undefined
      let terminalErrorHandled = false
      let preparedDecks:
        | {
            regular: Deck[]
            fused: Deck[]
            deckNameIndex: string[]
            forgebornNameIndex: string[]
          }
        | null = null
      const regularChunks = new Map<number, any[]>()
      const fusedChunks = new Map<number, any[]>()

      const rebuildDecksFromChunks = (chunks: Map<number, any[]>) => {
        const orderedIndexes = Array.from(chunks.keys()).sort((a, b) => a - b)
        return orderedIndexes.flatMap((index) => {
          const items = chunks.get(index)
          return Array.isArray(items) ? items : []
        })
      }

      const deckPhaseDone = () => {
        const regularStatus = progressSteps.find((s) => s.key === 'fetchRegular')?.status
        const fusedStatus = progressSteps.find((s) => s.key === 'fetchFused')?.status
        return regularStatus === 'done' && fusedStatus === 'done'
      }

      const activateTagsIfReady = (fallbackMsg?: string) => {
        if (!deckPhaseDone()) return
        const msg = latestTagMessage || fallbackMsg || 'Collecting tags...'
        updateSteps('tags', 'running', msg)
      }

      const cleanup = () => {
        try {
          es.close()
        } catch {
          // ignore
        }
        set({ currentEventSource: null })
      }

      const prepareReceivedDecks = (metaLocal: any, source: 'chunks' | 'ready') => {
        setProgressCounters({
          regularCount: regularDecks.length,
          fusedCount: fusedDecks.length,
          totalCount: regularDecks.length + fusedDecks.length,
          tagTotal: regularDecks.length + fusedDecks.length,
          regularPages: metaLocal.regularPages ?? metaLocal.pages,
          fusedPages: metaLocal.fusedPages ?? (fusedDecks.length > 0 ? 1 : 0),
        })

        updateSteps('fetchFused', 'done', source === 'chunks' ? 'Received all deck chunks' : 'Received all decks')
        updateSteps('tags', 'running', 'Collecting tags...')

        const owner = playerName.trim()
        const taggedRegular = Array.isArray(regularDecks)
          ? regularDecks.map(deck => ({ ...deck, playerName: owner }))
          : []
        const taggedFused = Array.isArray(fusedDecks)
          ? fusedDecks.map(deck => ({ ...deck, playerName: owner }))
          : []

        const validatedRegularDecks = DecksResponseSchema.parse(taggedRegular)
        const validatedFusedDecks = DecksResponseSchema.parse(taggedFused)
        const { regular: enhancedRegular, fused: enhancedFused } = attachComputedByGroup(
          validatedRegularDecks,
          validatedFusedDecks
        )
        const names = buildNameIndexes(enhancedRegular, enhancedFused)
        preparedDecks = {
          regular: enhancedRegular,
          fused: enhancedFused,
          deckNameIndex: names.deckNameIndex,
          forgebornNameIndex: names.forgebornNameIndex,
        }

        set({
          decks: enhancedRegular,
          fusedDecks: enhancedFused,
          loading: false,
          error: null,
          deckNameIndex: names.deckNameIndex,
          forgebornNameIndex: names.forgebornNameIndex,
        })
      }

      es.addEventListener('progress', (event) => {
        try {
          const data = JSON.parse((event as MessageEvent).data || '{}')
          const currentFused = get().progress.counters?.fusedCount ?? 0
          const prevPages = get().progress.counters?.regularPages ?? 0
          const pageLabel = data.page
            ? `Page ${data.page}${data.pageSize ? ` (${data.pageSize} decks)` : ''}`
            : undefined
          const countLabel = data.totalSoFar !== undefined ? `total fetched: ${data.totalSoFar}` : undefined
          const progressMsg = [pageLabel, countLabel].filter(Boolean).join(' · ')
          setProgressCounters({
            regularCount: data.totalSoFar ?? undefined,
            totalCount: (data.totalSoFar ?? 0) + currentFused,
            regularPages: data.page ? Math.max(prevPages, data.page) : prevPages,
          })
          updateSteps('fetchRegular', 'running', data.message || progressMsg || 'Fetching regular decks...')
        } catch (err) {
          console.warn('[Store] Failed to parse progress event:', err)
        }
      })

      es.addEventListener('regular-complete', (event) => {
        try {
          const data = JSON.parse((event as MessageEvent).data || '{}')
          const currentFused = get().progress.counters?.fusedCount ?? 0
          setProgressCounters({
            regularCount: data.regularCount ?? get().progress.counters?.regularCount ?? undefined,
            totalCount: (data.regularCount ?? get().progress.counters?.regularCount ?? 0) + currentFused,
            regularPages: data.regularPages ?? get().progress.counters?.regularPages,
          })
          updateSteps('fetchRegular', 'done', 'Regular decks loaded. Fetching fused decks...')
          updateSteps('fetchFused', 'running', 'Requesting fused decks...')
        } catch (err) {
          console.warn('[Store] Failed to parse regular-complete event:', err)
        }
      })

      es.addEventListener('fused', (event) => {
        try {
          const data = JSON.parse((event as MessageEvent).data || '{}')
          const currentRegular = get().progress.counters?.regularCount ?? 0
          const prevFusedPages = get().progress.counters?.fusedPages ?? 0
          const pageLabel = data.page
            ? `Fused page ${data.page}${data.pageSize ? ` (${data.pageSize} decks)` : ''}`
            : undefined
          const countLabel = data.totalSoFar !== undefined ? `total fused: ${data.totalSoFar}` : undefined
          const progressMsg = [pageLabel, countLabel].filter(Boolean).join(' · ')
          const fusedPagesNext = data.page
            ? Math.max(prevFusedPages, data.page)
            : data.totalSoFar
              ? Math.max(prevFusedPages, 1)
              : prevFusedPages
          setProgressCounters({
            fusedCount: data.totalSoFar ?? data.fusedCount ?? 0,
            totalCount: currentRegular + (data.totalSoFar ?? data.fusedCount ?? 0),
            fusedPages: fusedPagesNext,
          })
          updateSteps('fetchFused', 'running', data.message || progressMsg || 'Fetching fused decks...')
        } catch (err) {
          console.warn('[Store] Failed to parse fused event:', err)
        }
      })

      es.addEventListener('tags', (event) => {
        try {
          const data = JSON.parse((event as MessageEvent).data || '{}')
          tagsPayload = {
            uniqueTags: Array.isArray(data.uniqueTags) ? data.uniqueTags : [],
            uniqueCardNames: Array.isArray(data.uniqueCardNames) ? data.uniqueCardNames : [],
            perDeck: typeof data.perDeck === 'object' && data.perDeck !== null ? data.perDeck : {},
            perDeckCreatureTypes:
              typeof data.perDeckCreatureTypes === 'object' && data.perDeckCreatureTypes !== null
                ? data.perDeckCreatureTypes
                : tagsPayload.perDeckCreatureTypes,
          }
          setProgressCounters({
            tagCount: tagsPayload.uniqueTags?.length ?? 0,
          })
          const processed = data.processedDecks
          const totalDecks = data.totalDecks ?? get().progress.counters?.totalCount
          const isFinalPhase = data.phase === 'final'
          const tagsComplete = !!totalDecks && !!processed && processed >= totalDecks
          const doneMsg = 'Tags collected'
          const tagMsg =
            processed && totalDecks
              ? `Collecting tags... ${processed}/${totalDecks}`
              : 'Collecting tags...'

          latestTagMessage = tagsComplete || isFinalPhase ? doneMsg : tagMsg
          // Keep the latest tag message in progress for when tags become the active step.
          setProgressState({ message: tagsComplete || isFinalPhase ? doneMsg : tagMsg })

          const stepsState = get().progress.steps || []
          const fetchRegularStatus = stepsState.find((s) => s.key === 'fetchRegular')?.status
          const fetchFusedStatus = stepsState.find((s) => s.key === 'fetchFused')?.status
          const deckPhaseInFlight = [fetchRegularStatus, fetchFusedStatus].includes('active')

          setProgressCounters({
            tagProcessed: processed,
            tagTotal: totalDecks ?? get().progress.counters?.totalCount,
          })

          if (tagsComplete || isFinalPhase) {
            updateSteps('tags', 'done', doneMsg)
            return
          }

          if (deckPhaseInFlight) {
            // While decks are still loading, avoid switching the active step to tags.
            return
          } else {
            updateSteps('tags', 'running', tagMsg)
          }
        } catch (err) {
          console.warn('[Store] Failed to parse tags event:', err)
        }
      })

      es.addEventListener('fused-complete', (event) => {
        try {
          const data = JSON.parse((event as MessageEvent).data || '{}')
          const fusedCount = data.fusedCount ?? get().progress.counters?.fusedCount ?? 0
          const fusedPages = data.fusedPages ?? (fusedCount > 0 ? 1 : 0)
          const currentRegular = get().progress.counters?.regularCount ?? 0
        setProgressCounters({
          fusedCount,
          fusedPages,
          totalCount: currentRegular + fusedCount,
          tagTotal: currentRegular + fusedCount,
        })
          updateSteps('fetchFused', 'done')
          activateTagsIfReady(latestTagMessage)
        } catch (err) {
          console.warn('[Store] Failed to parse fused-complete event:', err)
        }
      })

      es.addEventListener('fused-error', (event) => {
        try {
          const data = JSON.parse((event as MessageEvent).data || '{}')
          const message = data.message || 'Fused decks unavailable'
          set({ error: message })
          updateSteps('fetchFused', 'done', message)
          activateTagsIfReady(latestTagMessage)
        } catch (err) {
          console.warn('[Store] Failed to parse fused-error event:', err)
        }
      })

      es.addEventListener('decks-chunk', (event) => {
        try {
          const data = JSON.parse((event as MessageEvent).data || '{}')
          const deckType = data.deckType === 'fused' ? 'fused' : 'regular'
          const items = Array.isArray(data.items) ? data.items : []
          const chunkIndexRaw = Number(data.chunkIndex)
          const chunkIndex = Number.isFinite(chunkIndexRaw) ? chunkIndexRaw : 0
          const chunkCount = Number(data.chunkCount) || 0
          const totalDecks = Number.isFinite(Number(data.totalDecks)) ? Number(data.totalDecks) : undefined

          if (deckType === 'fused') {
            fusedChunks.set(chunkIndex, items)
            fusedDecks = rebuildDecksFromChunks(fusedChunks)
            const currentRegular = get().progress.counters?.regularCount ?? regularDecks.length
            setProgressCounters({
              regularCount: currentRegular,
              fusedCount: fusedDecks.length,
              totalCount: currentRegular + fusedDecks.length,
            })
          } else {
            regularChunks.set(chunkIndex, items)
            regularDecks = rebuildDecksFromChunks(regularChunks)
            const currentFused = get().progress.counters?.fusedCount ?? fusedDecks.length
            setProgressCounters({
              regularCount: regularDecks.length,
              totalCount: regularDecks.length + currentFused,
            })
          }

          updateSteps(
            'fetchFused',
            'running',
            chunkCount > 0
              ? `Receiving ${deckType} decks (${chunkIndex}/${chunkCount})...`
              : `Receiving ${deckType} decks...`
          )

          if (totalDecks !== undefined) {
            const otherTypeCount = deckType === 'fused' ? regularDecks.length : fusedDecks.length
            const totalCount = totalDecks + otherTypeCount
            setProgressCounters({
              totalCount,
              tagTotal: totalCount,
            })
          }
        } catch (err) {
          console.warn('[Store] Failed to parse decks-chunk event:', err)
        }
      })

      es.addEventListener('decks-complete', (event) => {
        try {
          const data = JSON.parse((event as MessageEvent).data || '{}')
          const metaLocal = data.meta || {}
          prepareReceivedDecks(metaLocal, 'chunks')
        } catch (err) {
          console.warn('[Store] Failed to parse decks-complete event:', err)
          updateSteps('fetchFused', 'done', 'Received deck chunks (unvalidated)')
          updateSteps('tags', 'running', 'Collecting tags...')
        }
      })

      // Legacy fallback for older stream responses that still send full payload.
      es.addEventListener('decks-ready', (event) => {
        try {
          const data = JSON.parse((event as MessageEvent).data || '{}')
          regularDecks = Array.isArray(data.regular) ? data.regular : []
          fusedDecks = Array.isArray(data.fused) ? data.fused : []
          regularChunks.clear()
          fusedChunks.clear()
          regularChunks.set(1, regularDecks)
          fusedChunks.set(1, fusedDecks)
          const metaLocal = data.meta || {}
          prepareReceivedDecks(metaLocal, 'ready')
        } catch (err) {
          console.warn('[Store] Failed to parse decks-ready event:', err)
          updateSteps('fetchFused', 'done', 'Received decks (unvalidated)')
          updateSteps('tags', 'running', 'Collecting tags...')
        }
      })

      es.addEventListener('done', (event) => {
        try {
          const data = JSON.parse((event as MessageEvent).data || '{}')
          regularDecks = data.regular || regularDecks
          fusedDecks = data.fused || fusedDecks
          meta = data.meta || {}
          if (data.tags) {
            tagsPayload = {
              uniqueTags: Array.isArray(data.tags.uniqueTags) ? data.tags.uniqueTags : tagsPayload.uniqueTags,
              uniqueCardNames: Array.isArray(data.tags.uniqueCardNames) ? data.tags.uniqueCardNames : tagsPayload.uniqueCardNames,
              perDeck: typeof data.tags.perDeck === 'object' && data.tags.perDeck !== null ? data.tags.perDeck : tagsPayload.perDeck,
              perDeckCreatureTypes:
                typeof data.tags.perDeckCreatureTypes === 'object' && data.tags.perDeckCreatureTypes !== null
                  ? data.tags.perDeckCreatureTypes
                  : tagsPayload.perDeckCreatureTypes,
            }
          }
        } catch (err) {
          console.warn('[Store] Failed to parse done event:', err)
          cleanup()
          reject(err)
          return
        }
        streamFinished = true

        setProgressCounters({
          regularCount: regularDecks.length,
          fusedCount: fusedDecks.length,
          totalCount: regularDecks.length + fusedDecks.length,
          tagTotal: regularDecks.length + fusedDecks.length,
          regularPages: meta.regularPages ?? meta.pages,
          fusedPages: (() => {
            if (meta.fusedPages !== undefined) return meta.fusedPages
            if (meta.fusedCount) return 1
            const prev = get().progress.counters?.fusedPages
            if (prev !== undefined) return prev
            return fusedDecks.length > 0 ? 1 : 0
          })(),
        })

        updateSteps('tags', 'done', 'Tags prepared')

        updateSteps('finalize', 'running', 'Validating response...')

        const owner = playerName.trim()
        const cacheDecks = (
          regular: Deck[],
          fused: Deck[],
          names: { deckNameIndex: string[]; forgebornNameIndex: string[] }
        ) => {
          set((state) => ({
            decks: regular,
            fusedDecks: fused,
            loading: false,
            tagIndex: tagsPayload.uniqueTags || [],
            cardNameIndex: tagsPayload.uniqueCardNames || [],
            deckNameIndex: names.deckNameIndex,
            forgebornNameIndex: names.forgebornNameIndex,
            deckTags: tagsPayload.perDeck || {},
            deckCreatureTypes: tagsPayload.perDeckCreatureTypes || {},
            playerCache: {
              ...state.playerCache,
              [normalizedPlayer]: {
                decks: regular,
                fusedDecks: fused,
                tagIndex: tagsPayload.uniqueTags || [],
                cardNameIndex: tagsPayload.uniqueCardNames || [],
                deckNameIndex: names.deckNameIndex,
                forgebornNameIndex: names.forgebornNameIndex,
                deckTags: tagsPayload.perDeck || {},
                deckCreatureTypes: tagsPayload.perDeckCreatureTypes || {},
                expiresAt: Date.now() + CACHE_TTL_MS,
              },
            },
          }))
        }

        const canReusePreparedDecks =
          !!preparedDecks &&
          preparedDecks.regular.length === regularDecks.length &&
          preparedDecks.fused.length === fusedDecks.length

        if (canReusePreparedDecks && preparedDecks) {
          cacheDecks(preparedDecks.regular, preparedDecks.fused, {
            deckNameIndex: preparedDecks.deckNameIndex,
            forgebornNameIndex: preparedDecks.forgebornNameIndex,
          })
        } else {
          const taggedRegular = Array.isArray(regularDecks)
            ? regularDecks.map(deck => ({ ...deck, playerName: owner }))
            : []
          const taggedFused = Array.isArray(fusedDecks)
            ? fusedDecks.map(deck => ({ ...deck, playerName: owner }))
            : []

          try {
            const validatedRegularDecks = DecksResponseSchema.parse(taggedRegular)
            const validatedFusedDecks = DecksResponseSchema.parse(taggedFused)
            const { regular: enhancedRegular, fused: enhancedFused } = attachComputedByGroup(
              validatedRegularDecks,
              validatedFusedDecks
            )
            const names = buildNameIndexes(enhancedRegular, enhancedFused)
            cacheDecks(enhancedRegular, enhancedFused, names)
          } catch (validationError) {
            console.error('[Store] Data validation error:', validationError)
            if ((Array.isArray(regularDecks) && regularDecks.length > 0) || (Array.isArray(fusedDecks) && fusedDecks.length > 0)) {
              console.warn('[Store] Using unvalidated data')
              const { regular: fallbackRegular, fused: fallbackFused } = attachComputedByGroup(
                Array.isArray(regularDecks) ? regularDecks : [],
                Array.isArray(fusedDecks) ? fusedDecks : []
              )
              const names = buildNameIndexes(fallbackRegular, fallbackFused)
              cacheDecks(fallbackRegular, fallbackFused, names)
            } else {
              cleanup()
              set({ loading: false })
              finishProgress('Invalid data format from server', 'error')
              reject(validationError)
              return
            }
          }
        }

        updateSteps('finalize', 'done', 'Decks loaded (server tags)')
        finishProgress('Decks loaded', 'done')
        cleanup()
        resolve()
      })

      const describeReadyState = () => {
        switch (es.readyState) {
          case EventSource.CONNECTING:
            return 'CONNECTING'
          case EventSource.OPEN:
            return 'OPEN'
          case EventSource.CLOSED:
            return 'CLOSED'
          default:
            return `UNKNOWN(${es.readyState})`
        }
      }

      const parseErrorPayload = (event: Event) => {
        const maybeMessage = event as MessageEvent
        if (maybeMessage?.data) {
          if (typeof maybeMessage.data === 'string') {
            try {
              return JSON.parse(maybeMessage.data)
            } catch {
              return maybeMessage.data
            }
          }
          return maybeMessage.data
        }
        return null
      }

      es.addEventListener('error', (event) => {
        // Ignore errors if stream already closed or progress finished
        const progressState = get().progress.status
        if (streamFinished || es.readyState === EventSource.CLOSED || ['done', 'cached'].includes(progressState)) {
          cleanup()
          return
        }

        // If browser throttles connection in background, EventSource goes CONNECTING. Let it auto-reconnect.
        if (es.readyState === EventSource.CONNECTING) {
          updateSteps('fetchRegular', 'running', 'Reconnecting stream...')
          return
        }

        const parsed = parseErrorPayload(event)
        const readyState = describeReadyState()
        const detail =
          (parsed && typeof parsed === 'object' && 'message' in parsed && (parsed as any).message) ||
          (typeof parsed === 'string' ? parsed : null)

        console.warn('[Store] SSE error event:', {
          readyState,
          type: event?.type,
          payload: parsed,
        })

        const userMessage = detail || 'Failed to stream decks. Please try again.'
        const existingDecks = get().decks
        const existingFused = get().fusedDecks
        const hasAnyDecks = (existingDecks?.length ?? 0) + (existingFused?.length ?? 0) > 0

        if (hasAnyDecks) {
          // We already have data (e.g., received while tab was in background). Keep it visible.
          const fallbackMsg = userMessage || 'Stream interrupted; showing received decks'
          cleanup()
          set({
            error: userMessage,
            loading: false,
            decks: existingDecks,
            fusedDecks: existingFused,
          })
          finishProgress(fallbackMsg, 'done')
          resolve()
          return
        }

        if (terminalErrorHandled) return
        terminalErrorHandled = true
        cleanup()

        void (async () => {
          try {
            updateSteps('fetchRegular', 'running', 'Stream interrupted. Retrying via HTTP...')
            const cacheBust = forceRefresh ? `&_=${Date.now()}` : ''
            const res = await fetch(
              `/api/decks?player=${encodeURIComponent(normalizedName)}${forceRefresh ? '&force=1' : ''}${cacheBust}`,
              { headers: { Accept: 'application/json' }, cache: 'no-store' }
            )
            if (!res.ok) {
              throw new Error(`HTTP ${res.status}: ${res.statusText}`)
            }

            const json = await res.json()
            const rawRegular = Array.isArray(json?.regular) ? json.regular : []
            const rawFused = Array.isArray(json?.fused) ? json.fused : []
            const owner = playerName.trim()
            const taggedRegular = rawRegular.map((deck: any) => ({ ...deck, playerName: owner }))
            const taggedFused = rawFused.map((deck: any) => ({ ...deck, playerName: owner }))

            let enhancedRegular: Deck[] = []
            let enhancedFused: Deck[] = []
            try {
              const parsedRegular = DecksResponseSchema.parse(taggedRegular)
              const parsedFused = DecksResponseSchema.parse(taggedFused)
              const grouped = attachComputedByGroup(parsedRegular, parsedFused)
              enhancedRegular = grouped.regular
              enhancedFused = grouped.fused
            } catch (validationError) {
              if ((taggedRegular.length + taggedFused.length) === 0) {
                throw validationError
              }
              console.warn('[Store] HTTP fallback validation warning; using unvalidated data')
              const grouped = attachComputedByGroup(taggedRegular, taggedFused)
              enhancedRegular = grouped.regular
              enhancedFused = grouped.fused
            }

            const names = buildNameIndexes(enhancedRegular, enhancedFused)
            const allDecks = [...enhancedRegular, ...enhancedFused]
            const perDeckTags: Record<string, string[]> = {}
            const perDeckCreatureTypes: Record<string, Record<string, number>> = {}
            const uniqueTags = new Set<string>()
            const uniqueCardNames = new Set<string>()

            allDecks.forEach((deck) => {
              const deckId = deck?.id
              const displayTags = Array.isArray(deck?.computed?.displayTags) ? deck.computed!.displayTags : []
              if (deckId) {
                perDeckTags[deckId] = displayTags
                perDeckCreatureTypes[deckId] = deck.creatureType || {}
              }
              displayTags.forEach((tag) => {
                if (tag && typeof tag === 'string') uniqueTags.add(tag)
              })

              if (Array.isArray(deck.cards)) {
                deck.cards.forEach((card: any, index: number) => {
                  const cardInfo =
                    typeof card === 'string'
                      ? getCardInfoCached(card)
                      : getCardInfoCached(card?.id || card?.cardId || card?.name || `card-${index}`, card)
                  if (cardInfo?.name && typeof cardInfo.name === 'string' && cardInfo.name.trim()) {
                    uniqueCardNames.add(cardInfo.name.trim())
                  }
                })
              }
            })

            setProgressCounters({
              regularCount: enhancedRegular.length,
              fusedCount: enhancedFused.length,
              totalCount: enhancedRegular.length + enhancedFused.length,
              regularPages: json?.meta?.regularPages ?? json?.meta?.pages ?? (enhancedRegular.length > 0 ? 1 : 0),
              fusedPages: json?.meta?.fusedPages ?? (enhancedFused.length > 0 ? 1 : 0),
              tagCount: uniqueTags.size,
              tagTotal: enhancedRegular.length + enhancedFused.length,
            })
            updateSteps('fetchRegular', 'done', 'HTTP fallback complete')
            updateSteps('fetchFused', 'done')
            updateSteps('tags', 'done', 'Tags prepared')
            updateSteps('finalize', 'done', 'Decks loaded (HTTP fallback)')

            set((state) => ({
              decks: enhancedRegular,
              fusedDecks: enhancedFused,
              error: null,
              loading: false,
              tagIndex: Array.from(uniqueTags).sort(),
              cardNameIndex: Array.from(uniqueCardNames).sort(),
              deckNameIndex: names.deckNameIndex,
              forgebornNameIndex: names.forgebornNameIndex,
              deckTags: perDeckTags,
              deckCreatureTypes: perDeckCreatureTypes,
              playerCache: {
                ...state.playerCache,
                [normalizedPlayer]: {
                  decks: enhancedRegular,
                  fusedDecks: enhancedFused,
                  tagIndex: Array.from(uniqueTags).sort(),
                  cardNameIndex: Array.from(uniqueCardNames).sort(),
                  deckNameIndex: names.deckNameIndex,
                  forgebornNameIndex: names.forgebornNameIndex,
                  deckTags: perDeckTags,
                  deckCreatureTypes: perDeckCreatureTypes,
                  expiresAt: Date.now() + CACHE_TTL_MS,
                },
              },
            }))
            finishProgress('Decks loaded (HTTP fallback)', 'done')
            resolve()
          } catch (fallbackError) {
            const fallbackMessage =
              fallbackError instanceof Error ? fallbackError.message : userMessage || 'Failed to load decks.'
            set({
              error: fallbackMessage,
              loading: false,
              decks: existingDecks,
              fusedDecks: existingFused,
            })
            finishProgress(fallbackMessage, 'error')
            reject(new Error(fallbackMessage))
          }
        })()
      })
    })
  },
  clearDecks: () => {
    const prevEs = get().currentEventSource
    if (prevEs) {
      try {
        prevEs.close()
      } catch {
        // ignore
      }
    }
    set({
      decks: [],
      fusedDecks: [],
      loading: false,
      error: null,
      currentPlayer: null,
      progress: createIdleProgress(),
      tagIndex: [],
      cardNameIndex: [],
      deckNameIndex: [],
      forgebornNameIndex: [],
      deckTags: {},
      deckCreatureTypes: {},
      deckCreatureTypeOverrides: {},
      currentEventSource: null,
    })
  },
  setDeckCreatureType: (deckId: string, creatureType: Record<string, number>) => {
    if (!deckId || !creatureType) return
    const existing = get().deckCreatureTypes[deckId]
    if (existing) {
      const existingKeys = Object.keys(existing)
      const nextKeys = Object.keys(creatureType)
      if (existingKeys.length === nextKeys.length) {
        const isSame = existingKeys.every((key) => existing[key] === creatureType[key])
        if (isSame) return
      }
    }
    set((state) => ({
      deckCreatureTypes: {
        ...state.deckCreatureTypes,
        [deckId]: creatureType,
      },
      deckCreatureTypeOverrides: {
        ...state.deckCreatureTypeOverrides,
        [deckId]: creatureType,
      },
    }))
  },
  restartFetchIfLoading: () => {
    const { loading, currentPlayer, fetchDecks, currentEventSource } = get()
    if (!loading || !currentPlayer) return
    if (currentEventSource) {
      try {
        currentEventSource.close()
      } catch {
        // ignore
      }
      set({ currentEventSource: null })
    }
    void fetchDecks(currentPlayer, { force: true, keepExisting: true }).catch((err) => {
      console.warn('[Store] restartFetchIfLoading failed:', err)
    })
  },
}))
