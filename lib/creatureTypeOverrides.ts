import { computeCreatureTypesForDeck } from './creatureTypes'

const creatureTypeCache = new Map<string, Record<string, number>>()
const creatureTypeRequests = new Map<string, Promise<Record<string, number> | null>>()

export const fetchCreatureTypesForDeckId = async (deckId: string): Promise<Record<string, number> | null> => {
  const normalized = deckId.trim()
  if (!normalized) return null

  const cached = creatureTypeCache.get(normalized)
  if (cached) return cached

  const inFlight = creatureTypeRequests.get(normalized)
  if (inFlight) return inFlight

  const promise = (async () => {
    try {
      const res = await fetch(`/api/deck/${encodeURIComponent(normalized)}?skipOwnerMerge=1`)
      const json = await res.json()
      if (!res.ok || !json?.deck) return null
      const creatureType = computeCreatureTypesForDeck(json.deck)
      if (creatureType && Object.keys(creatureType).length > 0) {
        creatureTypeCache.set(normalized, creatureType)
        return creatureType
      }
    } catch {
      return null
    } finally {
      creatureTypeRequests.delete(normalized)
    }
    return null
  })()

  creatureTypeRequests.set(normalized, promise)
  return promise
}
