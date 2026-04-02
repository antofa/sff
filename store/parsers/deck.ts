import type { Deck, DeckRaw } from '@/types'
import { buildDeckLookup, getDeckSetShortCode, resolveDeckSetCode, type ResolveDeckSetOptions } from '@/utils/deck'

export type ParseDeckOptions = ResolveDeckSetOptions

export const parseDeck = (deck: DeckRaw, options?: ParseDeckOptions): Deck => {
  const setCode = resolveDeckSetCode(deck, options)
  const setShortCode = getDeckSetShortCode(deck, options)
  return {
    ...(deck as Deck),
    setCode,
    setShortCode,
  }
}

export const parseDecks = (decks: DeckRaw[], options?: ParseDeckOptions): Deck[] => {
  if (!Array.isArray(decks)) return []
  const allDecks = options?.allDecks ?? decks
  const allDecksById = options?.allDecksById ?? buildDeckLookup(allDecks)
  return decks.map((deck) =>
    parseDeck(deck, {
      ...options,
      allDecks,
      allDecksById,
    })
  )
}
