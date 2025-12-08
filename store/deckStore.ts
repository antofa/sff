import { create } from 'zustand'
import { z } from 'zod'

const CACHE_TTL_MS = 60 * 60 * 1000 // 1 hour client-side cache

type DeckCacheEntry = {
  decks: Deck[]
  fusedDecks: Deck[]
  tagIndex?: string[]
  cardNameIndex?: string[]
  deckTags?: Record<string, string[]>
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

export type Deck = z.infer<typeof DeckSchema>

type ProgressStepKey = 'prepare' | 'cache-check' | 'fetch' | 'tags' | 'validate' | 'finalize'
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
  }
}

const PROGRESS_TEMPLATE: Array<Omit<ProgressStep, 'status'>> = [
  { key: 'prepare', label: 'Preparing request' },
  { key: 'cache-check', label: 'Checking cached results' },
  { key: 'fetch', label: 'Requesting decks' },
  { key: 'tags', label: 'Collecting tags' },
  { key: 'validate', label: 'Validating data' },
  { key: 'finalize', label: 'Finalizing' },
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
  playerCache: Record<string, DeckCacheEntry>
  progress: FetchProgress
  tagIndex: string[]
  cardNameIndex: string[]
  deckTags: Record<string, string[]>
  fetchDecks: (playerName: string, options?: { force?: boolean }) => Promise<void>
  clearDecks: () => void
}

export const useDeckStore = create<DeckStore>((set, get) => ({
  decks: [],
  fusedDecks: [],
  loading: false,
  error: null,
  playerCache: {},
  progress: createIdleProgress(),
  tagIndex: [],
  cardNameIndex: [],
  deckTags: {},
  fetchDecks: async (playerName: string, options?: { force?: boolean }) => {
    const forceRefresh = options?.force ?? false
    const normalizedName = playerName.trim()
    if (!normalizedName) {
      set({ loading: false, error: 'Player nickname is required', decks: [], fusedDecks: [] })
      return
    }

    // Streaming implementation via SSE
    set({ loading: true, error: null, progress: createIdleProgress() })

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
    updateSteps('prepare', 'running', `Preparing request for ${normalizedName}...`)
    updateSteps('cache-check', 'running', 'Checking local cache...')

    // Cache check
    const cached = forceRefresh ? undefined : get().playerCache[normalizedPlayer]
    const now = Date.now()
    if (cached && cached.expiresAt > now) {
      set({
        decks: cached.decks,
        fusedDecks: cached.fusedDecks,
        loading: false,
        error: null,
        tagIndex: cached.tagIndex || [],
        cardNameIndex: cached.cardNameIndex || [],
        deckTags: cached.deckTags || {},
      })
      setProgressCounters({
        regularCount: cached.decks.length,
        fusedCount: cached.fusedDecks.length,
        totalCount: cached.decks.length + cached.fusedDecks.length,
        regularPages: 1,
        fusedPages: cached.fusedDecks.length > 0 ? 1 : 0,
        tagCount: (cached.tagIndex || []).length,
      })
      updateSteps('fetch', 'done', 'Loaded from cache')
      updateSteps('validate', 'done')
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

    // Switch to fetch step
    updateSteps('fetch', 'running', 'Requesting decks...')

    return new Promise<void>((resolve, reject) => {
      const es = new EventSource(`/api/decks/stream?player=${encodeURIComponent(normalizedName)}`)
      let regularDecks: any[] = []
      let fusedDecks: any[] = []
      let meta: any = {}
      let tagsPayload: {
        uniqueTags?: string[]
        uniqueCardNames?: string[]
        perDeck?: Record<string, string[]>
      } = {}

      const cleanup = () => {
        es.close()
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
          setProgressState({
            message: data.message || progressMsg || 'Fetching decks...',
            status: 'running',
          })
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
          setProgressState({
            message: 'Regular decks loaded. Fetching fused decks...',
          })
        } catch (err) {
          console.warn('[Store] Failed to parse regular-complete event:', err)
        }
      })

      es.addEventListener('fused', (event) => {
        try {
          const data = JSON.parse((event as MessageEvent).data || '{}')
          const currentRegular = get().progress.counters?.regularCount ?? 0
          setProgressCounters({
            fusedCount: data.fusedCount ?? 0,
            totalCount: currentRegular + (data.fusedCount ?? 0),
          })
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
          }
          setProgressCounters({
            tagCount: tagsPayload.uniqueTags?.length ?? 0,
          })
          updateSteps('tags', 'running', 'Collecting tags on server...')
          setProgressState({
            message: 'Tags prepared on server',
            status: 'running',
          })
          updateSteps('tags', 'done')
        } catch (err) {
          console.warn('[Store] Failed to parse tags event:', err)
        }
      })

      es.addEventListener('done', (event) => {
        try {
          const data = JSON.parse((event as MessageEvent).data || '{}')
          regularDecks = data.regular || []
          fusedDecks = data.fused || []
          meta = data.meta || {}
          if (data.tags) {
            tagsPayload = {
              uniqueTags: Array.isArray(data.tags.uniqueTags) ? data.tags.uniqueTags : tagsPayload.uniqueTags,
              uniqueCardNames: Array.isArray(data.tags.uniqueCardNames) ? data.tags.uniqueCardNames : tagsPayload.uniqueCardNames,
              perDeck: typeof data.tags.perDeck === 'object' && data.tags.perDeck !== null ? data.tags.perDeck : tagsPayload.perDeck,
            }
          }
        } catch (err) {
          console.warn('[Store] Failed to parse done event:', err)
          cleanup()
          reject(err)
          return
        }

        setProgressCounters({
          regularCount: regularDecks.length,
          fusedCount: fusedDecks.length,
          totalCount: regularDecks.length + fusedDecks.length,
          regularPages: meta.regularPages ?? meta.pages,
          fusedPages: meta.fusedPages ?? (meta.fusedCount ? 1 : 0),
        })

        updateSteps('validate', 'running', 'Validating response...')

        const owner = playerName.trim()
        const taggedRegular = Array.isArray(regularDecks)
          ? regularDecks.map(deck => ({ ...deck, playerName: owner }))
          : []
        const taggedFused = Array.isArray(fusedDecks)
          ? fusedDecks.map(deck => ({ ...deck, playerName: owner }))
          : []

        try {
          const validatedRegularDecks = DecksResponseSchema.parse(taggedRegular)
          const validatedFusedDecks = DecksResponseSchema.parse(taggedFused)
          set((state) => ({
            decks: validatedRegularDecks,
            fusedDecks: validatedFusedDecks,
            loading: false,
            tagIndex: tagsPayload.uniqueTags || [],
            cardNameIndex: tagsPayload.uniqueCardNames || [],
            deckTags: tagsPayload.perDeck || {},
            playerCache: {
              ...state.playerCache,
              [normalizedPlayer]: {
                decks: validatedRegularDecks,
                fusedDecks: validatedFusedDecks,
                tagIndex: tagsPayload.uniqueTags || [],
                cardNameIndex: tagsPayload.uniqueCardNames || [],
                deckTags: tagsPayload.perDeck || {},
                expiresAt: Date.now() + CACHE_TTL_MS,
              },
            },
          }))
        } catch (validationError) {
          console.error('[Store] Data validation error:', validationError)
          if ((Array.isArray(regularDecks) && regularDecks.length > 0) || (Array.isArray(fusedDecks) && fusedDecks.length > 0)) {
            console.warn('[Store] Using unvalidated data')
          const fallbackRegular = Array.isArray(regularDecks) ? regularDecks : []
          const fallbackFused = Array.isArray(fusedDecks) ? fusedDecks : []
            set((state) => ({
              decks: fallbackRegular,
              fusedDecks: fallbackFused,
              loading: false,
              tagIndex: tagsPayload.uniqueTags || [],
              cardNameIndex: tagsPayload.uniqueCardNames || [],
              deckTags: tagsPayload.perDeck || {},
              playerCache: {
                ...state.playerCache,
                [normalizedPlayer]: {
                  decks: fallbackRegular,
                  fusedDecks: fallbackFused,
                  tagIndex: tagsPayload.uniqueTags || [],
                  cardNameIndex: tagsPayload.uniqueCardNames || [],
                  deckTags: tagsPayload.perDeck || {},
                  expiresAt: Date.now() + CACHE_TTL_MS,
                },
              },
            }))
          } else {
            cleanup()
            set({ loading: false })
            finishProgress('Invalid data format from server', 'error')
            reject(validationError)
            return
          }
        }

        updateSteps('validate', 'done')
        updateSteps('finalize', 'done', 'Decks loaded (server tags)')
        finishProgress('Decks loaded', 'done')
        cleanup()
        resolve()
      })

      es.addEventListener('error', (event) => {
        console.error('[Store] SSE error event:', event)
        cleanup()
        set({
          error: 'Failed to stream decks. Please try again.',
          loading: false,
          decks: [],
          fusedDecks: [],
        })
        finishProgress('Streaming error', 'error')
        reject(new Error('Streaming error'))
      })
    })
  },
  clearDecks: () => set({ decks: [], fusedDecks: [], error: null, progress: createIdleProgress(), tagIndex: [], cardNameIndex: [], deckTags: {} }),
}))
