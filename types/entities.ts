export type DeckComputed = {
  expiryTs: number | null
  deckSet?: string | null
  setShortCode?: string | null
  counts?: { total: number; creatures: number; spells: number; solbind: number }
  rarityCounts?: Record<string, number>
  creatureType?: Record<string, number>
  displayTags?: string[]
}

export type DeckCard = string | Record<string, unknown>

export type DeckRaw = {
  id: string
  name: string
  cards?: DeckCard[]
  cardList?: DeckCard[]
  cardIds?: string[]
  format?: string
  created?: string
  updatedAt?: string
  faction?: string
  forgebornId?: string
  forgeborn?: Record<string, unknown> | null
  deckRank?: string
  digital?: number | boolean | string | null
  tags?: Record<string, unknown> | null
  cardSetNo?: string | number | null
  cardSetId?: string | number | null
  myDecks?: DeckRaw[]
  fusedDeckIds?: string[]
  playerName?: string
  deckScore?: number | null
  elo?: number | null
  expireAt?: string | null
  expire?: string | null
  expire_at?: string | null
  expireDate?: string | null
  expire_date?: string | null
  pExpiry?: string | null
  is_fused?: boolean
  computed?: DeckComputed
  creatureType?: Record<string, number>
  setCode?: string | null
  setShortCode?: string | null
}

export type Deck = Omit<
  DeckRaw,
  'digital' | 'cardSetNo' | 'cardSetId' | 'myDecks' | 'computed' | 'creatureType' | 'setCode' | 'setShortCode'
> & {
  digital?: number | boolean
  cardSetNo?: string
  cardSetId?: string
  myDecks?: Deck[]
  computed?: DeckComputed
  creatureType?: Record<string, number>
  setCode?: string | null
  setShortCode?: string | null
}
