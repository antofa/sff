import { getCardInfo } from './api'

export type CreatureTypeCounts = Record<string, number>

const normalizeSubtype = (raw: unknown): string[] => {
  if (!raw || typeof raw !== 'string') return []
  return raw
    .trim()
    .split(/\s+/)
    .map((part) => part.trim().toLowerCase())
    .filter(Boolean)
}

const pickSubtype = (card: any, info: any): string | undefined => {
  const candidates = [
    card?.cardSubType,
    card?.CardSubType,
    card?.CARDSUBTYPE,
    card?.SubType,
    card?.subType,
    card?.SUBTYPE,
    info?.cardSubType,
    info?.CardSubType,
    info?.SubType,
    info?.subType,
  ]
  return candidates.find((val) => typeof val === 'string' && val.trim())
}

const isSpellCard = (cardData: any): boolean => {
  const rawType =
    cardData?.cardType ||
    cardData?.card_type ||
    cardData?.type ||
    cardData?.Type ||
    ''
  const lowerType = rawType.toString().toLowerCase()
  if (!lowerType) return false
  if (lowerType.includes('forgeborn')) return false
  return lowerType.includes('spell') && !lowerType.includes('creature')
}

export const extractCardsFromDeckLike = (deckLike: any): any[] => {
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

  let rawCards: any[] = extractCards(deckLike)
  const hasFusedHalves = Array.isArray(deckLike?.myDecks) && deckLike.myDecks.length > 0

  if ((deckLike?.format === 'Fused' || hasFusedHalves) && hasFusedHalves) {
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
    deckLike.myDecks.forEach((src: any) => addCards(extractCards(src), src?.cardIds))
    if (combined.length > 0) rawCards = combined
  }

  return rawCards
}

export const computeCreatureTypeCounts = (
  cards: any[],
  getInfo: (cardId: string, cardData?: any) => any = getCardInfo
): CreatureTypeCounts => {
  const counts: CreatureTypeCounts = {}
  if (!Array.isArray(cards)) return counts

  cards.forEach((card: any, index: number) => {
    const cardInfo =
      typeof card === 'string'
        ? getInfo(card)
        : getInfo(card?.id || card?.cardId || card?.name || `card-${index}`, card)
    if (!cardInfo) return
    const isSpell = isSpellCard(cardInfo) || isSpellCard(card)
    if (isSpell) return

    const subType = pickSubtype(card, cardInfo)
    const parts = normalizeSubtype(subType)
    parts.forEach((type) => {
      counts[type] = (counts[type] || 0) + 1
    })
  })

  return counts
}

export const computeCreatureTypesForDeck = (
  deckLike: any,
  getInfo: (cardId: string, cardData?: any) => any = getCardInfo
): CreatureTypeCounts => {
  const cards = extractCardsFromDeckLike(deckLike)
  return computeCreatureTypeCounts(cards, getInfo)
}
