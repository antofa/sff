import { create } from 'zustand'
import { z } from 'zod'

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
  })
)

const DecksResponseSchema = z.array(DeckSchema)

export type Deck = z.infer<typeof DeckSchema>

interface DeckStore {
  decks: Deck[]
  loading: boolean
  error: string | null
  fetchDecks: (playerName: string) => Promise<void>
  clearDecks: () => void
}

export const useDeckStore = create<DeckStore>((set) => ({
  decks: [],
  loading: false,
  error: null,
  fetchDecks: async (playerName: string) => {
    set({ loading: true, error: null })
    try {
      const response = await fetch(`/api/decks?player=${encodeURIComponent(playerName)}`)
      
      if (!response.ok) {
        const errorData = await response.json().catch(() => ({}))
        const errorMessage = errorData.error || `Ошибка: ${response.status} ${response.statusText}`
        throw new Error(errorMessage)
      }

      const data = await response.json()
      
      // Data validation
      try {
        const validatedDecks = DecksResponseSchema.parse(data)
        set({ decks: validatedDecks, loading: false })
      } catch (validationError) {
        console.error('[Store] Data validation error:', validationError)
        // If validation fails but data exists, still use it
        if (Array.isArray(data) && data.length > 0) {
          console.warn('[Store] Using unvalidated data')
          set({ decks: data, loading: false })
        } else {
          throw new Error('Invalid data format from server')
        }
      }
    } catch (error) {
      const errorMessage = error instanceof Error ? error.message : 'Unknown error'
      console.error('[Store] Error fetching decks:', errorMessage)
      set({
        error: errorMessage,
        loading: false,
        decks: [],
      })
      throw error
    }
  },
  clearDecks: () => set({ decks: [], error: null }),
}))

