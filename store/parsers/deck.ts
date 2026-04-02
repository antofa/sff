import { getSetShortLabel, normalizeSetCode } from '@/lib/sets'

type DeckLike = Record<string, any>

export type ParsedDeckSetFields = {
  setCode: string | null
  setShortCode: string | null
}

export type ResolveDeckSetOptions = {
  allDecks?: DeckLike[]
  fallbackCards?: any[]
}

type ResolveDeckSetInternalOptions = ResolveDeckSetOptions & {
  allDecksById?: Map<string, DeckLike>
  seenDeckLookupKeys?: Set<string>
}

const normalizeDeckLookupKey = (id: string): string =>
  id
    .trim()
    .toLowerCase()
    .replace(/^deck[_-]?/i, '')
    .replace(/^fused[_-]?/i, '')

const getDeckId = (deck: DeckLike | null | undefined): string | null => {
  if (!deck || typeof deck !== 'object') return null
  const rawId = deck.id ?? deck.deckId
  if (typeof rawId === 'string') {
    const trimmed = rawId.trim()
    return trimmed || null
  }
  if (typeof rawId === 'number' && Number.isFinite(rawId)) {
    return String(rawId)
  }
  return null
}

const buildDeckLookup = (allDecks?: DeckLike[]): Map<string, DeckLike> => {
  const map = new Map<string, DeckLike>()
  if (!Array.isArray(allDecks)) return map
  allDecks.forEach((deck) => {
    const id = getDeckId(deck)
    if (!id) return
    const normalized = normalizeDeckLookupKey(id)
    map.set(id, deck)
    map.set(id.toLowerCase(), deck)
    if (normalized) map.set(normalized, deck)
  })
  return map
}

const lookupDeckById = (allDecksById: Map<string, DeckLike>, id: string): DeckLike | null => {
  if (!id) return null
  const direct = allDecksById.get(id) || allDecksById.get(id.toLowerCase())
  if (direct) return direct
  const normalized = normalizeDeckLookupKey(id)
  if (!normalized) return null
  return allDecksById.get(normalized) || null
}

const extractCardsFromDeck = (deck: DeckLike | null | undefined): any[] => {
  if (!deck || typeof deck !== 'object') return []
  if (Array.isArray(deck.cardList) && deck.cardList.length > 0) return deck.cardList
  if (Array.isArray(deck.cards) && deck.cards.length > 0) return deck.cards
  if (deck.cards && typeof deck.cards === 'object') {
    const values = Object.values(deck.cards)
    if (values.length > 0) return values
  }
  if (Array.isArray(deck.cardIds) && deck.cardIds.length > 0) return deck.cardIds
  return []
}

const toBSetCode = (value: unknown): string | null => {
  const normalized = normalizeSetCode(value)
  if (!normalized || typeof normalized !== 'string') return null
  return /^B\d+$/i.test(normalized) ? normalized.toUpperCase() : null
}

const getBSetFromCardId = (cardId: unknown): string | null => {
  if (!cardId) return null
  const text = String(cardId).trim()
  if (!text) return null
  const match = text.match(/^b(\d+)[_-]/i)
  return match?.[1] ? `B${Number(match[1])}` : null
}

const getBSetNumber = (setCode: string): number => {
  const match = setCode.match(/^B(\d+)$/i)
  return match?.[1] ? Number(match[1]) : Number.NaN
}

export const getBSetFromCard = (card: any): string | null => {
  if (!card) return null

  if (typeof card === 'string') {
    return getBSetFromCardId(card)
  }

  if (typeof card !== 'object') return null

  const cardSetId = card.cardSetId || card.CardSetId || card.SK || card.sk
  const fromSet = toBSetCode(cardSetId)
  if (fromSet) return fromSet

  const cardId = card.id || card.cardId || card.name
  return getBSetFromCardId(cardId)
}

export const getBSetFromCards = (cards: any[]): string | null => {
  let highestBSet: string | null = null
  let highestBSetNumber = Number.NaN

  for (const card of cards) {
    const bSet = getBSetFromCard(card)
    if (!bSet) continue
    const currentNumber = getBSetNumber(bSet)
    if (!Number.isFinite(currentNumber)) continue
    if (!Number.isFinite(highestBSetNumber) || currentNumber > highestBSetNumber) {
      highestBSet = bSet
      highestBSetNumber = currentNumber
    }
  }

  return highestBSet
}

export const deriveSetFromId = (id?: string | null): string | null => {
  if (!id || typeof id !== 'string') return null
  const normalized = id.trim()
  if (!normalized) return null
  const match = normalized.match(/^([bs])(\d+)[_-]/i)
  if (!match?.[1] || !match[2]) return null
  const prefix = match[1].toUpperCase()
  const number = Number(match[2])
  return `${prefix}${number}`
}

const resolveSourceDeckSetCode = (
  sourceDeck: DeckLike,
  options: ResolveDeckSetInternalOptions
): string | null => {
  return resolveDeckSetCodeInternal(sourceDeck, {
    ...options,
    fallbackCards: undefined,
  })
}

const resolveDeckSetCodeInternal = (
  deck: DeckLike | null | undefined,
  options: ResolveDeckSetInternalOptions = {}
): string | null => {
  if (!deck || typeof deck !== 'object') return null

  const allDecksById = options.allDecksById ?? buildDeckLookup(options.allDecks)
  const seenDeckLookupKeys = options.seenDeckLookupKeys ?? new Set<string>()

  const deckId = getDeckId(deck)
  const lookupKey = deckId ? normalizeDeckLookupKey(deckId) : null
  if (lookupKey && seenDeckLookupKeys.has(lookupKey)) {
    return null
  }
  if (lookupKey) seenDeckLookupKeys.add(lookupKey)

  const explicitValue = deck.cardSetId ?? deck.card_set_id ?? deck.cardSetNo ?? deck.card_set_no
  const explicitSet = normalizeSetCode(explicitValue)

  const isFusedDeck =
    String(deck.format || '').toLowerCase().includes('fused') ||
    Boolean(deck.is_fused) ||
    String(deck.id || '').toLowerCase().startsWith('fused_') ||
    String(deck.id || '').toLowerCase().startsWith('deck_fused_') ||
    Array.isArray(deck.myDecks) ||
    Array.isArray(deck.fusedDeckIds)

  if (isFusedDeck && Array.isArray(deck.myDecks)) {
    for (const sourceDeck of deck.myDecks) {
      if (!sourceDeck || typeof sourceDeck !== 'object') continue
      const fromSource = resolveSourceDeckSetCode(sourceDeck, {
        ...options,
        allDecksById,
        seenDeckLookupKeys,
      })
      if (fromSource) return fromSource
    }
  }

  if (isFusedDeck && Array.isArray(deck.fusedDeckIds)) {
    for (const fusedDeckId of deck.fusedDeckIds) {
      if (!fusedDeckId || typeof fusedDeckId !== 'string') continue
      const sourceDeck = lookupDeckById(allDecksById, fusedDeckId)
      if (!sourceDeck) continue
      const fromSource = resolveSourceDeckSetCode(sourceDeck, {
        ...options,
        allDecksById,
        seenDeckLookupKeys,
      })
      if (fromSource) return fromSource
    }
  }

  const cards = Array.isArray(options.fallbackCards) ? options.fallbackCards : extractCardsFromDeck(deck)
  if (cards.length > 0) {
    const bSet = getBSetFromCards(cards)
    if (bSet) return bSet
  }

  if (explicitSet) return explicitSet

  const computedSet = normalizeSetCode(deck.computed?.deckSet)
  if (computedSet) return computedSet

  return normalizeSetCode(deriveSetFromId(deckId))
}

export const resolveDeckSetCode = (deck: DeckLike | null | undefined, options?: ResolveDeckSetOptions): string | null =>
  resolveDeckSetCodeInternal(deck, options)

export const getDeckSetShortCode = (deck: DeckLike | null | undefined, options?: ResolveDeckSetOptions): string | null => {
  if (!deck || typeof deck !== 'object') return null
  if (typeof deck.setShortCode === 'string' && deck.setShortCode.trim()) return deck.setShortCode
  const setCode = resolveDeckSetCode(deck, options)
  if (!setCode) return null
  return getSetShortLabel(setCode) || setCode
}

export const parseDeck = <T extends DeckLike>(deck: T, options?: ResolveDeckSetOptions): T & ParsedDeckSetFields => {
  const setCode = resolveDeckSetCode(deck, options)
  const setShortCode = setCode ? getSetShortLabel(setCode) || setCode : null
  return {
    ...deck,
    setCode,
    setShortCode,
  }
}

export const parseDecks = <T extends DeckLike>(
  decks: T[],
  options?: Omit<ResolveDeckSetOptions, 'allDecks'>
): Array<T & ParsedDeckSetFields> => {
  if (!Array.isArray(decks)) return []
  return decks.map((deck) =>
    parseDeck(deck, {
      ...options,
      allDecks: decks,
    })
  )
}
